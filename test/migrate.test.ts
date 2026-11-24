// The data migrations that run before a release's schema (scripts/lib/migrate.ts),
// on a data folder made with the schema before the change:
// stages -> groups (Nov 23, 2026). Every stage, its id and dates, and every
// role's link to it must come through, and the new schema must then match.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ADMIN, OWNER, RUBRIC, boot, create, makeHooksDir, type Harness } from "./harness.ts";
import { SNAPSHOT_PATH, adminLogin, call, ensureBinary, ensureOwner, ownerLogin, setupAdmin, startInstance } from "../scripts/lib/vaultbase.ts";
import { migrate, migrateOffline } from "../scripts/lib/migrate.ts";

const OLD_SNAPSHOT = join(import.meta.dir, "golden", "snapshot-before-groups.json");
const roots: string[] = [];
let bin: string;
let h: Harness | null = null;

beforeAll(async () => { bin = await ensureBinary(); }, 300_000);
afterAll(async () => {
  await h?.stop();
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

type Rec = Record<string, any>;

/** A data folder on the old schema: a workspace with two stages, roles in each, one role with none. */
async function oldData() {
  const root = mkdtempSync(join(tmpdir(), "audition-migrate-"));
  roots.push(root);
  const dataDir = join(root, "data");
  await setupAdmin(bin, dataDir, "off", ADMIN.email, ADMIN.password);
  const inst = await startInstance({ bin, dataDir, hooksDir: "off", snapshot: OLD_SNAPSHOT });
  const token = await adminLogin(inst.url, ADMIN.email, ADMIN.password);
  await ensureOwner(inst.url, token, OWNER.email, OWNER.password, "Owner");
  const owner = await ownerLogin(inst.url, OWNER.email, OWNER.password);
  const post = async (c: string, body: Rec) => {
    const r = await call(inst.url, "POST", `/api/v1/${c}`, { token: owner, body });
    if (r.status !== 200) throw new Error(`${c}: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.data as Rec;
  };
  const ws = await post("workspaces", { name: "Travel planner" });
  const visa = await post("stages", { workspace: ws.id, name: "Visa", order: 1 });
  const weather = await post("stages", { workspace: ws.id, name: "Weather", order: 2 });
  const roles = [
    await post("roles", { workspace: ws.id, stage: visa.id, name: "Visa checker", rubric: RUBRIC }),
    await post("roles", { workspace: ws.id, stage: weather.id, name: "Forecaster", rubric: RUBRIC }),
    await post("roles", { workspace: ws.id, name: "On its own", rubric: RUBRIC }),
  ];
  const stages = (await call(inst.url, "GET", "/api/v1/stages?sort=order", { token: owner })).body.data as Rec[];
  await inst.stop();
  return { root, dataDir, ws, stages, roles };
}

test("stages become groups with their ids, dates and role links", async () => {
  const old = await oldData();
  const done = await migrateOffline({ bin, dataDir: old.dataDir, admin: ADMIN });
  expect(done).toEqual(["renamed the collection `stages` to `groups`", "renamed the field `roles.stage` to `roles.group`"]);

  h = await boot({ root: old.root, bin, dataDir: old.dataDir, hooksDir: makeHooksDir(old.root) });
  const diff = await h.api("admin", "POST", "/api/v1/admin/migrations/diff", { snapshot: await Bun.file(SNAPSHOT_PATH).json() });
  expect(diff.body.data.added).toEqual([]);
  expect(diff.body.data.modified).toEqual([]);
  expect(diff.body.data.removed).toEqual([]);

  const groups = (await h.api("owner", "GET", "/api/v1/groups?sort=order")).body.data as Rec[];
  const strip = (r: Rec) => { const { collectionId: _c, collectionName: _n, ...rest } = r; return rest; };
  expect(groups.map(strip)).toEqual(old.stages.map(strip));
  const roles = (await h.api("owner", "GET", "/api/v1/roles?sort=created&expand=group")).body.data as Rec[];
  expect(roles.map((r) => [r.name, r.group ?? null])).toEqual(old.roles.map((r) => [r.name, r.stage ?? null]));
  expect(roles.map((r) => r.created)).toEqual(old.roles.map((r) => r.created));
  expect(roles[0]!.expand.group.name).toBe("Visa");
  expect((await h.api("owner", "GET", "/api/v1/stages")).status).toBe(404);

  // The role hook checks the group, as it checked the stage.
  const other = await create(h, "workspaces", { name: "Elsewhere" });
  const elsewhere = await create(h, "groups", { workspace: other.id, name: "Accommodation" });
  const bad = await h.api("owner", "POST", "/api/v1/roles", { workspace: old.ws.id, group: elsewhere.id, name: "X", rubric: RUBRIC });
  expect(bad.status).toBe(422);
  expect(JSON.stringify(bad.body)).toContain("another workspace");

  // A second run (and so every later upgrade) changes nothing.
  expect(await migrate(h.url, h.adminToken)).toEqual([]);
  await h.stop();
  h = null;
}, 120_000);

test("a new install has nothing to migrate", async () => {
  const root = mkdtempSync(join(tmpdir(), "audition-migrate-"));
  roots.push(root);
  expect(await migrateOffline({ bin, dataDir: join(root, "data"), admin: ADMIN })).toEqual([]);
  h = await boot({ root, bin });
  expect(await migrate(h.url, h.adminToken)).toEqual([]);
  await h.stop();
  h = null;
}, 120_000);

test("if the new schema started first, the groups still come back", async () => {
  // A start that skipped the migration: the snapshot made an empty `groups`
  // and, finding no `group` field on roles, replaced `stage` with an empty one.
  const old = await oldData();
  h = await boot({ root: old.root, bin, dataDir: old.dataDir, hooksDir: makeHooksDir(old.root) });
  expect((await h.api("owner", "GET", "/api/v1/groups")).body.data).toEqual([]);
  const done = await migrate(h.url, h.adminToken);
  expect(done).toEqual(["removed an empty `groups` collection made before the migration", "renamed the collection `stages` to `groups`"]);
  const groups = (await h.api("owner", "GET", "/api/v1/groups?sort=order")).body.data as Rec[];
  expect(groups.map((g) => [g.id, g.name])).toEqual(old.stages.map((s) => [s.id, s.name]));
  await h.stop();
  h = null;
}, 120_000);

// Owner uploads through Vaultbase's own endpoint (Nov 24, 2026, NOTES UP1):
// the file fields' mimeTypes widen. That is an option change, which the
// service applies from the new snapshot when it starts (`--snapshot-mode
// sync`), so it needs no step in scripts/lib/migrate.ts. Data made with the
// schema before it keeps its files, and the fields take Markdown, CSV and zip.
const BEFORE_UPLOAD_TYPES = join(import.meta.dir, "golden", "snapshot-before-upload-types.json");
test("the wider file types reach a data folder made with the schema before them", async () => {
  const root = mkdtempSync(join(tmpdir(), "audition-migrate-"));
  roots.push(root);
  const dataDir = join(root, "data");
  await setupAdmin(bin, dataDir, "off", ADMIN.email, ADMIN.password);
  const inst = await startInstance({ bin, dataDir, hooksDir: "off", snapshot: BEFORE_UPLOAD_TYPES });
  const token = await adminLogin(inst.url, ADMIN.email, ADMIN.password);
  await ensureOwner(inst.url, token, OWNER.email, OWNER.password, "Owner");
  const owner = await ownerLogin(inst.url, OWNER.email, OWNER.password);
  const ws = (await call(inst.url, "POST", "/api/v1/workspaces", { token: owner, body: { name: "Docs" } })).body.data as Rec;
  const role = (await call(inst.url, "POST", "/api/v1/roles", { token: owner, body: { workspace: ws.id, name: "Writer", rubric: RUBRIC } })).body.data as Rec;
  const task = (await call(inst.url, "POST", "/api/v1/tasks", { token: owner, body: { role: role.id, title: "Old", prompt: "<p>x</p>", locked: false } })).body.data as Rec;
  const send = (url: string, name: string, tok: string) => {
    const form = new FormData();
    form.append("file", new File(["# notes"], name, { type: "text/plain" }));
    return fetch(`${url}/api/v1/files/tasks/${task.id}/attachments`, { method: "POST", headers: { authorization: `Bearer ${tok}` }, body: form });
  };
  expect((await send(inst.url, "before.md", owner)).status).toBe(422);
  const txt = await send(inst.url, "before.txt", owner);
  expect(txt.status).toBe(200);
  const kept = ((await txt.json()) as { data: Array<{ filename: string }> }).data[0]!.filename;
  expect((await call(inst.url, "PATCH", `/api/v1/tasks/${task.id}`, { token: owner, body: { attachments: [kept] } })).status).toBe(200);
  await inst.stop();

  expect(await migrateOffline({ bin, dataDir, admin: ADMIN })).toEqual([]);
  h = await boot({ root, bin, dataDir, hooksDir: makeHooksDir(root) });
  const diff = await h.api("admin", "POST", "/api/v1/admin/migrations/diff", { snapshot: await Bun.file(SNAPSHOT_PATH).json() });
  expect(diff.status).toBe(200);
  expect(JSON.stringify(diff.body.data)).not.toContain("attachments");
  for (const name of ["after.md", "after.csv", "after.zip"]) expect((await send(h.url, name, h.ownerToken)).status, name).toBe(200);
  const served = await fetch(`${h.url}/api/v1/files/${kept}`, { headers: { authorization: `Bearer ${h.ownerToken}` } });
  expect(await served.text()).toBe("# notes");
  await h.stop();
  h = null;
}, 120_000);
