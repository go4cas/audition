// F1: server writes go through vb_hooks/lib/store.ts, a thin layer over
// Vaultbase's helpers.records. A record written there reads back through REST
// exactly like the same record created through REST, shows in record history
// as system, and sends a realtime event. Only the two documented SQL writes
// are left in vb_hooks/.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { boot, create, fixtures, type Harness } from "./harness.ts";

let h: Harness;
let f: Awaited<ReturnType<typeof fixtures>>;
beforeAll(async () => { h = await boot(); f = await fixtures(h); });
afterAll(async () => { await h?.cleanup(); });

const strip = (r: Record<string, unknown>) => {
  const { id: _i, created: _c, updated: _u, ...rest } = r;
  return rest;
};

test("tasks: text, editor, select, json, bool and relations round-trip", async () => {
  const data = {
    role: f.role.id, title: "Round trip", prompt: "<p>Hello <strong>world</strong></p>", output_type: "code",
    base_ref: { repo: "github.com/go4cas/audition-factory-demo", commit: "abc1234" }, locked: false,
    previous_version: f.task.id, composed_prompt: null,
  };
  const viaRest = await create(h, "tasks", data, "admin");
  const id = await h.store("insert", "tasks", data);
  const viaStore = (await h.api("owner", "GET", `/api/v1/tasks/${id}`)).body.data;
  expect(strip(viaStore)).toEqual(strip(viaRest));
  expect(viaStore.created).toBeGreaterThan(0);
  expect(viaStore.updated).toBe(viaStore.created);
});

test("attempts and verdicts: numbers, dates, json lists and selects round-trip", async () => {
  const run = await h.store("insert", "runs", { workspace: f.workspace.id, role: f.role.id, tasks: [f.task.id], contenders: [f.contender.id, f.handoff.id], judge: "ai", judge_contender: f.contender.id, status: "running", call_count: 4 });
  const runRec = (await h.api("owner", "GET", `/api/v1/runs/${run}`)).body.data;
  expect(runRec.tasks).toEqual([f.task.id]);
  expect(runRec.contenders).toEqual([f.contender.id, f.handoff.id]);
  expect(runRec.call_count).toBe(4);

  const at = "2026-11-06T10:00:00.000Z";
  const attempt = { run, task: f.task.id, contender: f.contender.id, mode: "api", status: "submitted", prompt_sent: "P", output: "O", tokens_in: 12, tokens_out: 300, duration_ms: 1234, cost: 0.0042, metrics_source: "measured", finish_reason: "end_turn", submitted_at: at };
  const viaRest = await create(h, "attempts", attempt, "admin");
  const id = await h.store("insert", "attempts", attempt);
  const viaStore = (await h.api("owner", "GET", `/api/v1/attempts/${id}`)).body.data;
  expect(strip(viaStore)).toEqual(strip(viaRest));
  expect(viaStore.submitted_at).toBe(Math.floor(Date.parse(at) / 1000));

  const verdict = { attempt: id, run, method: "rubric", judge_kind: "ai", judge_contender: f.contender.id, scores: { Accuracy: { stars: 4, reason: "ok" } }, rubric_snapshot: [{ name: "Accuracy", weight: 100 }], score: 4, status: "active" };
  const vRest = await create(h, "verdicts", verdict, "admin");
  const vId = await h.store("insert", "verdicts", verdict);
  expect(strip((await h.api("owner", "GET", `/api/v1/verdicts/${vId}`)).body.data)).toEqual(strip(vRest));
});

test("updates set only the given fields and move updated_at", async () => {
  const id = await h.store("insert", "attempts", { task: f.task.id, contender: f.contender.id, mode: "api", status: "queued" });
  const before = (await h.api("owner", "GET", `/api/v1/attempts/${id}`)).body.data;
  await Bun.sleep(1100); // updated_at has 1 s resolution
  await h.store("update", "attempts", { status: "failed", error: "boom" }, id);
  const after = (await h.api("owner", "GET", `/api/v1/attempts/${id}`)).body.data;
  expect(after.status).toBe("failed");
  expect(after.error).toBe("boom");
  expect(after.mode).toBe("api");
  expect(after.updated).toBeGreaterThan(before.updated);
});

test("store refuses unknown fields and views; encrypted fields are now written and encrypted by Vaultbase", async () => {
  const r1 = await h.api("admin", "POST", "/api/custom/test/store", { op: "insert", collection: "connection_keys", data: { connection: f.mock.id, api_key: "sk-store-test" } });
  expect(r1.status).toBe(200);
  const raw = await h.sql<{ api_key: string }>(`SELECT api_key FROM vb_connection_keys WHERE id = ?`, [r1.body.data.id]);
  expect(raw[0]!.api_key).not.toBe("sk-store-test");
  const r2 = await h.api("admin", "POST", "/api/custom/test/store", { op: "insert", collection: "tasks", data: { nope: 1 } });
  expect(r2.status).toBe(422);
  const r3 = await h.api("admin", "POST", "/api/custom/test/store", { op: "insert", collection: "leaderboard", data: {} });
  expect(r3.status).toBe(422);
  const r4 = await h.api("admin", "POST", "/api/custom/test/store", { op: "update", collection: "tasks", id: "no-such-task", data: { title: "x" } });
  expect(r4.status).toBe(404);
});

test("a store write runs the collection's hooks (field validation and before-hooks apply)", async () => {
  const r = await h.api("admin", "POST", "/api/custom/test/store", { op: "insert", collection: "workspaces", data: { name: "Hooked", fitness_weights: { quality: 2 } } });
  expect(r.status).toBe(422);
  expect(r.body.error).not.toContain("store:");
});

const historyOf = async (collection: string, id: string) =>
  (await h.api("admin", "GET", `/api/v1/${collection}/${id}/history`)).body.data.data as Array<Record<string, any>>;

test("every server write shows in record history as system (runs, attempts, verdicts, castings)", async () => {
  const run = await h.store("insert", "runs", { workspace: f.workspace.id, role: f.role.id, tasks: [f.task.id], contenders: [f.contender.id], judge: "me", status: "running", call_count: 1 });
  await h.store("update", "runs", { status: "judging" }, run);
  const attempt = await h.store("insert", "attempts", { run, task: f.task.id, contender: f.contender.id, mode: "api", status: "queued" });
  const verdict = await h.store("insert", "verdicts", { attempt, run, method: "rubric", judge_kind: "ai", judge_contender: f.contender.id, scores: {}, rubric_snapshot: [], score: 3, status: "active" });
  const casting = await h.store("insert", "castings", { role: f.role.id, contender: f.contender.id, since: Math.floor(Date.now() / 1000), suggested_by: "system", confirmed: true });
  for (const [c, id, n] of [["runs", run, 2], ["attempts", attempt, 1], ["verdicts", verdict, 1], ["castings", casting, 1]] as const) {
    const entries = await historyOf(c, id);
    expect(entries.length, c).toBe(n);
    for (const e of entries) {
      expect(e.actor_type, c).toBeNull();
      expect(e.actor_id, c).toBeNull();
    }
  }
});

test("a store write sends a realtime event to a signed-in subscriber", async () => {
  const ws = new WebSocket(h.url.replace(/^http/, "ws") + "/realtime");
  const messages: any[] = [];
  const waitFor = async (pred: (m: any) => boolean, ms = 5000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const m = messages.find(pred);
      if (m) return m;
      await Bun.sleep(25);
    }
    throw new Error(`no realtime message; got ${JSON.stringify(messages)}`);
  };
  ws.onmessage = (e) => messages.push(JSON.parse(String(e.data)));
  try {
    await waitFor((m) => m.type === "connected");
    ws.send(JSON.stringify({ type: "auth", token: h.ownerToken }));
    ws.send(JSON.stringify({ type: "subscribe", topics: ["runs"] }));
    await waitFor((m) => m.type === "subscribed");
    const run = await h.store("insert", "runs", { workspace: f.workspace.id, role: f.role.id, tasks: [f.task.id], contenders: [f.contender.id], judge: "me", status: "running", call_count: 0 });
    await waitFor((m) => m.type === "create" && m.record?.id === run);
    await h.store("update", "runs", { status: "done" }, run);
    const upd = await waitFor((m) => m.type === "update" && m.record?.id === run);
    expect(upd.record.status).toBe("done");
  } finally {
    ws.close();
  }
});

// Done-when of docs/PLATFORM-UPGRADES.md part B, finished with Vaultbase 0.48:
// no SQL write is left in vb_hooks/. The worker's claim left SQL with
// helpers.records { filter } (#13), server-made files with helpers.files.save
// (#11, lib/files.ts) (SPEC "Waiting on Vaultbase").
test("no SQL write is left in vb_hooks/", () => {
  const root = join(import.meta.dir, "..", "vb_hooks");
  const files: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (n.endsWith(".ts")) files.push(p);
    }
  };
  walk(root);
  const writes: string[] = [];
  for (const p of files) {
    const text = readFileSync(p, "utf8");
    const name = p.slice(root.length + 1);
    const calls = [...text.matchAll(/\.exec\s*\(\s*([\s\S]{0,80})/g)].filter((m) => /^[`"']/.test(m[1]!));
    for (const m of calls) {
      const sql = /^[`"']\s*(\w+)\s+(?:INTO\s+|FROM\s+)?"?(\w+)/i.exec(m[1]!);
      writes.push(sql ? `${name}: ${sql[1]!.toUpperCase()} ${sql[2]}` : `${name}: ${m[1]!.slice(0, 40)}`);
    }
    // helpers.sql under another name, or SQL built elsewhere, would slip past this.
    expect(/sql\.exec\(\s*[^`"'\s]/.test(text), name).toBe(false);
  }
  expect(writes.sort()).toEqual([]);
});
