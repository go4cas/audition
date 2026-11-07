// API rules per collection (TECH-SPEC §5, §6): anonymous is refused
// everywhere, and the owner has exactly the access the spec gives.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { boot, create, fixtures, type Harness } from "./harness.ts";

let h: Harness;
let ids: Record<string, string> = {};
// For each collection, a valid body for create and a harmless patch for update.
let bodies: Record<string, { create: Record<string, unknown>; update: Record<string, unknown> }> = {};

beforeAll(async () => {
  h = await boot();
  const f = await fixtures(h);
  const run = await h.store("insert", "runs", { workspace: f.workspace.id, role: f.role.id, tasks: [f.task.id], contenders: [f.handoff.id], judge: "me", status: "running", call_count: 0 });
  const attempt = await h.store("insert", "attempts", { run, task: f.task.id, contender: f.handoff.id, mode: "handoff", status: "waiting", prompt_sent: "x" });
  const verdict = await h.store("insert", "verdicts", { attempt, run, method: "rubric", judge_kind: "human", scores: {}, rubric_snapshot: [], score: 3, status: "active" });
  // The owner judges submitted outputs only, with stars for every criterion (T3's verdict hooks).
  const submitted = await h.store("insert", "attempts", { run, task: f.task.id, contender: f.handoff.id, mode: "handoff", status: "submitted", prompt_sent: "x", output: "y" });
  const casting = await h.store("insert", "castings", { role: f.role.id, contender: f.contender.id, since: Date.now(), suggested_by: "human", confirmed: true });
  const template = (await create(h, "handoff_templates", { name: "Generic", kind: "generic", body: "x" }, "admin")).id;
  await h.api("owner", "POST", "/api/v1/connection_keys", { connection: f.mock.id, api_key: "k" });
  const key = (await h.api("admin", "GET", "/api/v1/connection_keys")).body.data[0].id;
  const owner = (await h.api("owner", "GET", "/api/v1/users")).body.data[0].id;
  ids = {
    users: owner, workspaces: f.workspace.id, stages: f.stage.id, roles: f.role.id, tasks: f.task.id,
    connections: f.mock.id, connection_keys: key, contenders: f.contender.id, handoff_templates: template,
    runs: run, attempts: attempt, verdicts: verdict, castings: casting,
  };
  const u = () => crypto.randomUUID().slice(0, 8);
  bodies = {
    users: { create: { email: `x${u()}@test.local`, password: "Pass-word-123!", passwordConfirm: "Pass-word-123!" }, update: { name: "New name" } },
    workspaces: { create: { name: `W ${u()}` }, update: { description: "d" } },
    stages: { create: { workspace: f.workspace.id, name: "S" }, update: { order: 2 } },
    roles: { create: { workspace: f.workspace.id, name: "R", rubric: [{ name: "A", weight: 100 }] }, update: { description: "d" } },
    tasks: { create: { role: f.role.id, title: "T", prompt: "<p>p</p>" }, update: { title: "T2" } },
    connections: { create: { name: `C ${u()}`, provider: "mock" }, update: { notes: "n" } },
    connection_keys: { create: { connection: f.manual.id, api_key: "k2" }, update: { api_key: "k3" } },
    contenders: { create: { name: `K ${u()}`, connection: f.mock.id, model: "m" }, update: { group: "g" } },
    handoff_templates: { create: { name: "Other", kind: "generic", body: "b" }, update: { return_instructions: "r" } },
    runs: { create: { workspace: f.workspace.id, role: f.role.id, judge: "me", status: "running" }, update: { status: "done" } },
    attempts: { create: { run, task: f.task.id, contender: f.handoff.id, mode: "handoff", status: "waiting" }, update: { output: "pasted" } },
    verdicts: { create: { attempt: submitted, scores: { Accuracy: { stars: 4 }, Clarity: { stars: 3 } } }, update: { score: 5 } },
    castings: { create: { role: f.role.id, contender: f.contender.id, suggested_by: "human", confirmed: true }, update: { rationale: "r" } },
  };
});
afterAll(async () => { await h?.cleanup(); });

type Access = { list: boolean; view: boolean; create: boolean; update: boolean; delete: boolean };
const ALL: Access = { list: true, view: true, create: true, update: true, delete: true };
const READ: Access = { list: true, view: true, create: false, update: false, delete: false };

// TECH-SPEC §6, as the owner sees it.
const OWNER_ACCESS: Record<string, Access> = {
  users: { list: true, view: true, create: false, update: true, delete: false },
  workspaces: ALL, stages: ALL, roles: ALL, tasks: ALL, connections: ALL, contenders: ALL,
  connection_keys: { list: false, view: false, create: true, update: true, delete: true },
  handoff_templates: { list: true, view: true, create: false, update: true, delete: false },
  runs: READ, castings: READ,
  // update: only a waiting handoff output (the fixture attempt is one)
  attempts: { list: true, view: true, create: false, update: true, delete: false },
  // create: human verdicts (their checks are T3's hooks)
  verdicts: { list: true, view: true, create: true, update: false, delete: false },
};

const createPath = (c: string) => (c === "users" ? "/api/v1/auth/users/register" : `/api/v1/${c}`);

describe("anonymous is refused everywhere", () => {
  for (const c of [...Object.keys(OWNER_ACCESS), "leaderboard"]) {
    test(c, async () => {
      const list = await h.api("anon", "GET", `/api/v1/${c}`);
      expect(list.status === 200 ? list.body.data.length : 0, `${c} list`).toBe(0);
      if (c === "leaderboard") return;
      const id = ids[c]!;
      expect((await h.api("anon", "GET", `/api/v1/${c}/${id}`)).status, `${c} view`).toBeOneOf([401, 403, 404]);
      expect((await h.api("anon", "POST", createPath(c), bodies[c]!.create)).status, `${c} create`).toBeOneOf([401, 403]);
      expect((await h.api("anon", "PATCH", `/api/v1/${c}/${id}`, bodies[c]!.update)).status, `${c} update`).toBeOneOf([401, 403, 404]);
      expect((await h.api("anon", "DELETE", `/api/v1/${c}/${id}`)).status, `${c} delete`).toBeOneOf([401, 403, 404]);
      // still there
      expect((await h.api("admin", "GET", `/api/v1/${c}/${id}`)).status).toBe(200);
    });
  }
});

describe("the owner has exactly the access in TECH-SPEC §6", () => {
  for (const [c, want] of Object.entries(OWNER_ACCESS)) {
    test(c, async () => {
      const id = ids[c]!;
      const list = await h.api("owner", "GET", `/api/v1/${c}`);
      const listed = list.status === 200 && list.body.data.some((r: { id: string }) => r.id === id);
      expect(listed, `${c} list`).toBe(want.list);

      const view = await h.api("owner", "GET", `/api/v1/${c}/${id}`);
      expect(view.status === 200, `${c} view (${view.status})`).toBe(want.view);

      const created = await h.api("owner", "POST", createPath(c), bodies[c]!.create);
      expect(created.status === 200, `${c} create (${created.status} ${JSON.stringify(created.body)})`).toBe(want.create);

      const updated = await h.api("owner", "PATCH", `/api/v1/${c}/${id}`, bodies[c]!.update);
      expect(updated.status === 200, `${c} update (${updated.status} ${JSON.stringify(updated.body)})`).toBe(want.update);

      // Delete a throwaway record where one can be made; otherwise the fixture.
      let target = id;
      if (want.create && created.status === 200 && created.body.data?.id) target = created.body.data.id;
      else if (want.delete && c === "connection_keys") target = (await h.api("admin", "GET", `/api/v1/connection_keys?filter=${encodeURIComponent(`id != "${id}"`)}`)).body.data[0]?.id ?? id;
      const deleted = await h.api("owner", "DELETE", `/api/v1/${c}/${target}`);
      expect(deleted.status === 200 || deleted.status === 204, `${c} delete (${deleted.status} ${JSON.stringify(deleted.body)})`).toBe(want.delete);
    });
  }
});

test("the owner sees only their own user record", async () => {
  const r = await h.api("admin", "POST", "/api/v1/auth/users/register", { email: "other@test.local", password: "Other-pass-123!", passwordConfirm: "Other-pass-123!" });
  expect(r.status).toBe(200);
  const list = await h.api("owner", "GET", "/api/v1/users");
  expect(list.body.data.map((u: { email: string }) => u.email)).toEqual(["owner@test.local"]);
  expect((await h.api("owner", "GET", `/api/v1/users/${r.body.data.id}`)).status).toBeOneOf([403, 404]);
});

test("sign-up is closed: nobody registers without the admin", async () => {
  const r = await h.api("anon", "POST", "/api/v1/auth/users/register", { email: "walkin@test.local", password: "Walk-in-123!", passwordConfirm: "Walk-in-123!" });
  expect(r.status).toBe(403);
});

test("the owner can update an attempt only while it is a waiting handoff output", async () => {
  const a = await h.api("admin", "GET", `/api/v1/attempts/${ids["attempts"]}`);
  const api = await h.store("insert", "attempts", { run: a.body.data.run, task: a.body.data.task, contender: a.body.data.contender, mode: "api", status: "queued" });
  expect((await h.api("owner", "PATCH", `/api/v1/attempts/${api}`, { output: "x" })).status).toBeOneOf([403, 404]);
  const done = await h.store("insert", "attempts", { run: a.body.data.run, task: a.body.data.task, contender: a.body.data.contender, mode: "handoff", status: "submitted" });
  expect((await h.api("owner", "PATCH", `/api/v1/attempts/${done}`, { output: "x" })).status).toBeOneOf([403, 404]);
});
