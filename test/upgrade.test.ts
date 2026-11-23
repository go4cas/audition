// The upgrade check of TECH-SPEC §1: run a seeded loop on the old binary,
// stop it, start the new binary on the same data folder, and check that
// every record, file, key and sign-in is still there and the loop works.
// In T0 old and new are the same pinned binary. For a real upgrade, point
// AUDITION_UPGRADE_FROM at the previous vaultbase.lock.json (from git).
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OWNER, boot, create, makeHooksDir, type Harness } from "./harness.ts";
import { ensureBinary, ownerLogin, readLock } from "../scripts/lib/vaultbase.ts";
import { seedReference } from "../seed/reference.ts";
import { generate, mockSeed } from "../vb_hooks/lib/providers/mock.ts";

const root = mkdtempSync(join(tmpdir(), "audition-upgrade-"));
const dataDir = join(root, "data");
let hooksDir: string;
let oldBin: string, newBin: string, oldVersion: string, newVersion: string;
const COLLECTIONS = ["users", "workspaces", "groups", "roles", "tasks", "connections", "contenders", "handoff_templates", "runs", "attempts", "verdicts", "castings", "connection_keys"];
let before: Record<string, Array<Record<string, unknown>>> = {};
let files: Array<{ name: string; sha: string }> = [];
let h: Harness | null = null;

const sha = (b: ArrayBuffer) => new Bun.CryptoHasher("sha256").update(b).digest("hex");

async function dump(x: Harness) {
  const out: Record<string, Array<Record<string, unknown>>> = {};
  for (const c of COLLECTIONS) {
    const r = await x.api("admin", "GET", `/api/v1/${c}?perPage=500&sort=id`);
    expect(r.status, c).toBe(200);
    out[c] = r.body.data;
  }
  return out;
}

/** One pass of the Phase 1 loop for a role, as server code will do it: run, outputs, judge, cast. */
async function loop(x: Harness, roleName: string) {
  const role = (await x.api("owner", "GET", `/api/v1/roles?filter=${encodeURIComponent(`name = "${roleName}"`)}`)).body.data[0];
  const tasks = (await x.api("owner", "GET", `/api/v1/tasks?filter=${encodeURIComponent(`role = "${role.id}"`)}`)).body.data;
  const contenders = (await x.api("owner", "GET", `/api/v1/contenders?filter=${encodeURIComponent('name = "Mock Steady" || name = "Mock Image"')}`)).body.data;
  const run = await x.store("insert", "runs", { workspace: role.workspace, role: role.id, tasks: tasks.map((t: { id: string }) => t.id), contenders: contenders.map((c: { id: string }) => c.id), judge: "me", status: "running", call_count: tasks.length * contenders.length });
  for (const t of tasks) {
    for (const c of contenders) {
      await x.store("update", "tasks", { locked: true }, t.id);
      await x.store("update", "contenders", { locked: true }, c.id);
      const out = await generate({ model: c.model, config: c.config, maxOutputTokens: c.max_output_tokens, prompt: `TASK: ${t.title}`, attachments: [], seed: mockSeed(t.id, c.id, 0) });
      const attempt = await x.store("insert", "attempts", { run, task: t.id, contender: c.id, mode: "api", status: "submitted", prompt_sent: `TASK: ${t.title}`, output: out.text, tokens_in: out.tokensIn, tokens_out: out.tokensOut, duration_ms: out.durationMs, metrics_source: "measured", finish_reason: out.finishReason, submitted_at: Date.now() });
      for (const f of out.files) {
        const r = await x.api("admin", "POST", "/api/custom/seed/attach", { collection: "attempts", id: attempt, field: "output_files", name: f.name, mime: f.mime, data: Buffer.from(f.bytes).toString("base64") });
        expect(r.status).toBe(200);
      }
      const rubric = role.rubric as Array<{ name: string; weight: number }>;
      const scores = Object.fromEntries(rubric.map((cr) => [cr.name, { stars: 4, reason: "fine" }]));
      await x.store("insert", "verdicts", { attempt, run, method: "rubric", judge_kind: "human", scores, rubric_snapshot: rubric, score: 4, status: "active" });
      await x.store("update", "attempts", { status: "judged" }, attempt);
    }
  }
  await x.store("update", "runs", { status: "done" }, run);
  await x.store("insert", "castings", { role: role.id, contender: contenders[0].id, since: Date.now(), rationale: "upgrade test", suggested_by: "system", confirmed: true });
  return run;
}

beforeAll(async () => {
  const fromLock = process.env["AUDITION_UPGRADE_FROM"] ? await readLock(process.env["AUDITION_UPGRADE_FROM"]) : await readLock();
  const toLock = await readLock();
  oldVersion = fromLock.version; newVersion = toLock.version;
  oldBin = await ensureBinary({ lock: fromLock });
  newBin = await ensureBinary({ lock: toLock });
  hooksDir = makeHooksDir(root);
}, 300_000);
afterAll(async () => { await h?.stop(); rmSync(root, { recursive: true, force: true }); });

test("a seeded loop on the old binary", async () => {
  h = await boot({ root, bin: oldBin, dataDir, hooksDir });
  expect((await h.api("anon", "GET", "/api/health")).body.data.version).toBe(oldVersion);
  await seedReference(h.url, h.adminToken);
  await loop(h, "Image maker");
  const conn = (await h.api("owner", "GET", `/api/v1/connections?filter=${encodeURIComponent('name = "Mock"')}`)).body.data[0];
  expect((await h.api("owner", "POST", "/api/v1/connection_keys", { connection: conn.id, api_key: "sk-test-upgrade-key" })).status).toBe(200);
  await Bun.sleep(300);
  before = await dump(h);
  expect(before["attempts"]!.length).toBeGreaterThan(0);
  for (const a of before["attempts"]!) for (const name of (a["output_files"] as string[] | null) ?? []) {
    const r = await fetch(`${h.url}/api/v1/files/${name}`, { headers: { authorization: `Bearer ${h.ownerToken}` } });
    files.push({ name, sha: sha(await r.arrayBuffer()) });
  }
  for (const t of before["tasks"]!) for (const name of (t["attachments"] as string[] | null) ?? []) {
    const r = await fetch(`${h.url}/api/v1/files/${name}`, { headers: { authorization: `Bearer ${h.ownerToken}` } });
    files.push({ name, sha: sha(await r.arrayBuffer()) });
  }
  expect(files.length).toBeGreaterThan(3);
  await h.stop();
}, 120_000);

test("the new binary on the same data folder keeps every record, file, key and sign-in", async () => {
  h = await boot({ root, bin: newBin, dataDir, hooksDir });
  expect((await h.api("anon", "GET", "/api/health")).body.data.version).toBe(newVersion);
  const after = await dump(h);
  expect(after).toEqual(before);
  for (const f of files) {
    const r = await fetch(`${h.url}/api/v1/files/${f.name}`, { headers: { authorization: `Bearer ${h.ownerToken}` } });
    expect(r.status, f.name).toBe(200);
    expect(sha(await r.arrayBuffer()), f.name).toBe(f.sha);
  }
  expect(after["connection_keys"]![0]!["api_key"]).toBe("sk-test-upgrade-key");
  expect(await ownerLogin(h.url, OWNER.email, OWNER.password)).toBeTruthy();
}, 120_000);

test("the loop still works after the upgrade", async () => {
  await loop(h!, "Stock analyst");
  const board = await h!.api("owner", "GET", "/api/v1/leaderboard");
  expect(board.body.data.length).toBeGreaterThanOrEqual(2);
  const ws = (await h!.api("owner", "GET", "/api/v1/workspaces?perPage=1")).body.data[0];
  expect((await create(h!, "groups", { workspace: ws.id, name: "After upgrade" })).name).toBe("After upgrade");
}, 120_000);
