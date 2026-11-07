// The schema on a fresh instance matches schema/snapshot.json, the "later"
// fields exist and are nullable, and the leaderboard view reads the tables.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { boot, create, fixtures, type Harness } from "./harness.ts";
import { SNAPSHOT_PATH } from "../scripts/lib/vaultbase.ts";

let h: Harness;
const snapshot = await Bun.file(SNAPSHOT_PATH).json();
beforeAll(async () => { h = await boot(); });
afterAll(async () => { await h?.cleanup(); });

test("migrations/diff between the instance and the snapshot is empty", async () => {
  const r = await h.api("admin", "POST", "/api/v1/admin/migrations/diff", { snapshot });
  expect(r.status).toBe(200);
  expect(r.body.data.added).toEqual([]);
  expect(r.body.data.modified).toEqual([]);
  expect(r.body.data.removed).toEqual([]);
  expect(r.body.data.unchanged.map((c: { name: string }) => c.name).sort()).toEqual(snapshot.collections.map((c: { name: string }) => c.name).sort());
});

test("13 base or auth collections plus the leaderboard view", () => {
  const kinds = snapshot.collections.map((c: { type: string }) => c.type);
  expect(kinds.filter((k: string) => k !== "view").length).toBe(13);
  expect(snapshot.collections.filter((c: { type: string }) => c.type === "view").map((c: { name: string }) => c.name)).toEqual(["leaderboard"]);
});

test("every collection states all five rules and history_enabled", () => {
  for (const c of snapshot.collections) {
    for (const r of ["list_rule", "view_rule", "create_rule", "update_rule", "delete_rule"]) expect(c[r], `${c.name}.${r}`).not.toBeUndefined();
    expect(typeof c.history_enabled, c.name).toBe("boolean");
  }
  const history = snapshot.collections.filter((c: { history_enabled: boolean }) => c.history_enabled).map((c: { name: string }) => c.name).sort();
  expect(history).toEqual(["contenders", "roles", "tasks"]);
});

const LATER: Array<[string, string]> = [
  ["workspaces", "composer_contender"], ["tasks", "composed_prompt"], ["runs", "schedule"],
  ["verdicts", "opponent"], ["verdicts", "winner"], ["verdicts", "due_at"],
];

test("every later field exists and is nullable", () => {
  for (const [col, name] of LATER) {
    const c = snapshot.collections.find((x: { name: string }) => x.name === col);
    const f = c.fields.find((x: { name: string }) => x.name === name);
    expect(f, `${col}.${name}`).toBeDefined();
    expect(f.required ?? false, `${col}.${name} required`).toBe(false);
  }
  const values = (col: string, name: string) => snapshot.collections.find((x: { name: string }) => x.name === col).fields.find((x: { name: string }) => x.name === name).options.values;
  expect(values("verdicts", "method")).toEqual(["rubric", "pairwise", "outcome"]);
  expect(values("contenders", "mode")).toContain("runner");
  expect(values("handoff_templates", "kind")).toEqual(["generic", "coding-harness", "app"]);
});

test("later fields read back as null on new records", async () => {
  const f = await fixtures(h);
  expect(f.workspace.composer_contender).toBeNull();
  expect(f.task.composed_prompt).toBeNull();
  const run = await h.store("insert", "runs", { workspace: f.workspace.id, role: f.role.id, tasks: [f.task.id], contenders: [f.contender.id], judge: "me", status: "running", call_count: 1 });
  const r = await h.api("owner", "GET", `/api/v1/runs/${run}`);
  expect(r.body.data.schedule).toBeNull();
});

test("the leaderboard view aggregates active verdicts per role and contender (O4)", async () => {
  const f = await fixtures(h);
  const run = await h.store("insert", "runs", { workspace: f.workspace.id, role: f.role.id, tasks: [f.task.id], contenders: [f.contender.id], judge: "me", status: "done", call_count: 2 });
  const scores = [4, 3];
  for (const [i, score] of scores.entries()) {
    const a = await h.store("insert", "attempts", { run, task: f.task.id, contender: f.contender.id, mode: "api", status: "judged", tokens_in: 100, tokens_out: 300 + i * 100, duration_ms: 1000 + i * 1000 });
    await h.store("insert", "verdicts", { attempt: a, run, method: "rubric", judge_kind: "human", scores: {}, rubric_snapshot: [], score, status: "active" });
    // an overridden verdict never counts
    await h.store("insert", "verdicts", { attempt: a, run, method: "rubric", judge_kind: "ai", scores: {}, rubric_snapshot: [], score: 1, status: "overridden" });
  }
  const r = await h.api("owner", "GET", `/api/v1/leaderboard?filter=${encodeURIComponent(`role = "${f.role.id}"`)}`);
  expect(r.status).toBe(200);
  expect(r.body.data.length).toBe(1);
  const row = r.body.data[0];
  expect(row.id).toBe(`${f.role.id}:${f.contender.id}`);
  expect(row.contender).toBe(f.contender.id);
  expect(Number(row.n)).toBe(2);
  expect(Number(row.mean_score)).toBe(3.5);
  expect(Number(row.sum_sq)).toBe(25);
  expect(Number(row.n_tokens)).toBe(2);
  expect(Number(row.mean_tokens)).toBe(450);
  expect(Number(row.mean_time_ms)).toBe(1500);
  expect(Number(row.n_cost)).toBe(0);
  expect(row.mean_cost).toBeNull();
  const anon = await h.api("anon", "GET", "/api/v1/leaderboard");
  expect(anon.body?.data?.length ?? 0).toBe(0);
});
