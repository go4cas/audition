// The Release step (docs/RELEASE.md), on a fresh instance laid out like
// production: the real vb_hooks/ only (no test routes), read-only, a
// separate data folder. Checks `bun run provision`, Vaultbase's own backups
// (with the uploaded files), a restore from the admin backups API, the cold
// copy used before an upgrade, and the auth rate limit (review finding R6).
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, cpSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HOOKS_DIR, SNAPSHOT_PATH, call, ensureBinary, ownerLogin, refuseProviderKeys, setupAdmin, startInstance, type Instance,
} from "../scripts/lib/vaultbase.ts";
import { BACKUP_SETTINGS, provision } from "../scripts/provision.ts";

const ADMIN = { email: "admin@release.local", password: "Admin-release-pass-1!" };
const OWNER = { email: "owner@release.local", password: "Owner-release-pass-1!" };
const root = mkdtempSync(join(tmpdir(), "audition-release-"));
const dataDir = join(root, "data");
const hooksDir = join(root, "app", "vb_hooks");
let bin: string;
let inst: Instance;
let token: string;

function readOnly(dir: string) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) readOnly(p); else chmodSync(p, 0o444);
  }
  chmodSync(dir, 0o555);
}
function writable(dir: string) {
  chmodSync(dir, 0o755);
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) writable(p); else chmodSync(p, 0o644);
  }
}
const start = (dir = dataDir) => startInstance({ bin, dataDir: dir, hooksDir, snapshot: SNAPSHOT_PATH });

beforeAll(async () => {
  refuseProviderKeys();
  bin = await ensureBinary();
  cpSync(HOOKS_DIR, hooksDir, { recursive: true });
  readOnly(hooksDir);
  await setupAdmin(bin, dataDir, hooksDir, ADMIN.email, ADMIN.password);
  inst = await start();
}, 60_000);

afterAll(async () => {
  await inst?.stop();
  writable(hooksDir);
  rmSync(root, { recursive: true, force: true });
});

test("provision applies settings and the backup schedule, creates the owner and seeds, twice without change", async () => {
  const first = await provision({ url: inst.url, admin: ADMIN, owner: OWNER });
  token = first.token;
  expect(first.seed.created.length).toBeGreaterThan(0);
  expect(first.backupStatus).toMatchObject({ enabled: true, cron: BACKUP_SETTINGS["backups.cron"], keep: 14, files: true });
  expect(first.backupStatus.next_run_at).toBeGreaterThan(0);
  const settings = (await call(inst.url, "GET", "/api/v1/admin/settings", { token })).body.data;
  expect(settings["queues.timeout_ms"]).toBe("900000");
  expect(settings["backups.enabled"]).toBe("1");
  const again = await provision({ url: inst.url, admin: ADMIN, owner: OWNER });
  expect(again.seed.created).toEqual([]);
  expect(await ownerLogin(inst.url, OWNER.email, OWNER.password)).toBeTruthy();
  const tpl = await call(inst.url, "GET", "/api/v1/handoff_templates", { token });
  expect(tpl.body.data.some((t: { kind: string }) => t.kind === "generic")).toBe(true);
  const ui = await fetch(`${inst.url}/`);
  expect(ui.status).toBe(200);
}, 60_000);

test("a Vaultbase backup keeps the uploaded files, and a restore from it undoes a later change", async () => {
  const b = await call(inst.url, "POST", "/api/v1/admin/backups", { token });
  expect(b.status).toBe(200);
  expect(b.body.data.name).toMatch(/^vaultbase-\d{8}-\d{6}-\d{3}\.db$/);
  expect(b.body.data.files.count).toBeGreaterThan(0);
  const list = await call(inst.url, "GET", "/api/v1/admin/backups", { token });
  expect(list.body.data.items.map((i: { name: string }) => i.name)).toContain(b.body.data.name);

  const ws = (await call(inst.url, "GET", "/api/v1/workspaces?perPage=50", { token })).body.data[0];
  const renamed = await call(inst.url, "PATCH", `/api/v1/workspaces/${ws.id}`, { token, body: { name: "Changed after the backup" } });
  expect(renamed.status).toBe(200);

  // RL1: in 0.40.2 the restore sometimes closes the HTTP connection before it
  // answers (read workers restart on the shared port), although it completes.
  // The restore's answer is checked when it arrives; the data is checked always.
  const r = await call(inst.url, "POST", `/api/v1/admin/backups/${b.body.data.name}/restore`, { token })
    .catch((e: Error) => { expect(e.message).toContain("ECONNRESET"); return null; });
  if (r) {
    expect(r.status).toBe(200);
    expect(r.body.data.message).toContain("Restore complete");
  }
  expect((await fetch(`${inst.url}/_/ready`)).status).toBe(200);
  const back = await call(inst.url, "GET", `/api/v1/workspaces/${ws.id}`, { token });
  expect(back.status).toBe(200);
  expect(back.body.data.name).toBe(ws.name);
  // Sessions survive; the owner can still sign in after the restore.
  expect(await ownerLogin(inst.url, OWNER.email, OWNER.password)).toBeTruthy();
}, 60_000);

test("a cold copy of the data folder (the pre-upgrade backup) starts on its own with every record and key", async () => {
  const before = (await call(inst.url, "GET", "/api/v1/workspaces?perPage=50&sort=id", { token })).body.data.map((w: { id: string }) => w.id);
  await inst.stop();
  const copy = join(root, "data-copy");
  cpSync(dataDir, copy, { recursive: true });
  for (const f of [".encryption-key", ".secret"]) expect(statSync(join(copy, f)).isFile()).toBe(true);
  const other = await start(copy);
  try {
    const t = (await call(other.url, "POST", "/api/v1/admin/auth/login", { body: ADMIN })).body.data.token;
    const after = (await call(other.url, "GET", "/api/v1/workspaces?perPage=50&sort=id", { token: t })).body.data.map((w: { id: string }) => w.id);
    expect(after).toEqual(before);
    expect(await ownerLogin(other.url, OWNER.email, OWNER.password)).toBeTruthy();
  } finally {
    await other.stop();
  }
  inst = await start();
  token = (await call(inst.url, "POST", "/api/v1/admin/auth/login", { body: ADMIN })).body.data.token;
}, 90_000);

test("R6: wrong owner passwords hit Vaultbase's auth rate limit (429) before the 20th try", async () => {
  const codes: number[] = [];
  for (let i = 0; i < 20; i++) {
    const r = await call(inst.url, "POST", "/api/v1/auth/users/login", { body: { email: OWNER.email, password: `wrong-${i}` } });
    codes.push(r.status);
    if (r.status === 429) break;
  }
  expect(codes).toContain(429);
  expect(codes.filter((c) => c !== 429).every((c) => c === 400 || c === 401)).toBe(true);
}, 60_000);
