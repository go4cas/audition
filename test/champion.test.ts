// Champion trial, keep and restore on a fresh Vaultbase (TECH-SPEC §11a):
// a contender that replaces a champion starts on trial; Keep ends the trial
// through the records API (record history keeps the change); Restore brings
// back the earlier champion with a note, and the leaderboard holds back the
// replaced contender until a newer run for the role.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { boot, create, RUBRIC, type Harness } from "./harness.ts";
import { sfx } from "./t3-helpers.ts";
import { startSink, type Sink } from "./smtp-sink.ts";
import { trialAlert } from "../vb_hooks/lib/castings.ts";
import { heldBack, previousChampion, toSeconds, type CastingInfo } from "../vb_hooks/lib/fitness.ts";

describe("pure parts", () => {
  const c = (contender: string, since: number, more: Partial<CastingInfo> = {}): CastingInfo =>
    ({ id: contender + since, role: "r", contender, since, confirmed: true, rationale: "", suggested_by: "human", trial: false, restored: false, ...more });
  test("the previous champion is the newest earlier one of a different contender", () => {
    expect(previousChampion([])).toBeNull();
    expect(previousChampion([c("a", 3)])).toBeNull();
    expect(previousChampion([c("b", 3), c("b", 2), c("a", 1)])).toBe("a");
  });
  test("after a restore the replaced contender is held back until a newer run", () => {
    const h = [c("a", 100, { restored: true }), c("b", 50, { trial: true }), c("a", 10)];
    expect(heldBack(h, "b", null)).toEqual({ contender: "b", since: 100 });
    expect(heldBack(h, "b", 90)).toEqual({ contender: "b", since: 100 });
    expect(heldBack(h, "b", 101)).toBeNull();
    expect(heldBack(h, "x", null)).toBeNull();
    expect(heldBack(h, null, null)).toBeNull();
    expect(heldBack([c("b", 50), c("a", 10)], "a", null)).toBeNull(); // not a restore
  });
  test("created values read as seconds", () => {
    expect(toSeconds(1700000000)).toBe(1700000000);
    expect(toSeconds(1700000000123)).toBe(1700000000);
    expect(toSeconds("2023-11-14 22:13:20.000Z")).toBe(1700000000);
  });
});

let h: Harness;
let sink: Sink;
beforeAll(async () => {
  sink = startSink();
  h = await boot();
  await h.api("admin", "PATCH", "/api/v1/admin/settings", {
    "smtp.enabled": "true", "smtp.host": "127.0.0.1", "smtp.port": String(sink.port), "smtp.secure": "false",
    "smtp.from": "audition@test.local", "app.url": "https://audition.test",
  });
});
afterAll(async () => { await h?.cleanup(); sink?.stop(); });

const unwrap = async (p: Promise<any>) => { const r = await p; return r.status === 200 ? { ...r, body: r.body.data } : r; };
const board = (role: string) => unwrap(h.api("owner", "GET", `/api/custom/leaderboard/${role}`));
const post = (path: string, body: object = {}, as: "owner" | "admin" | "anon" = "owner") => unwrap(h.api(as, "POST", `/api/custom${path}`, body));

/** A role with two qualifying contenders: Old scores 4s, New scores 5s (so New is suggested). */
async function seed() {
  const workspace = await create(h, "workspaces", { name: `WS ${sfx()}`, fitness_weights: { quality: 100, tokens: 0, time: 0 }, min_outputs: 2 });
  const role = await create(h, "roles", { workspace: workspace.id, name: "Coder", rubric: RUBRIC, pass_mark: 3.5 });
  const task = await create(h, "tasks", { role: role.id, title: "Code", prompt: "<p>Code.</p>" });
  const conn = await create(h, "connections", { name: `Mock ${sfx()}`, provider: "mock" });
  const mk = (name: string) => create(h, "contenders", { name, connection: conn.id, model: "mock-steady", config: { mock: { behaviour: "steady" } } });
  const oldC = await mk(`Old ${sfx()}`), newC = await mk(`New ${sfx()}`);
  const run = await h.store("insert", "runs", { workspace: workspace.id, role: role.id, tasks: [task.id], contenders: [oldC.id, newC.id], judge: "me", status: "done", call_count: 0 });
  const score = async (contender: string, s: number) => {
    const a = await h.store("insert", "attempts", { run, task: task.id, contender, mode: "api", status: "judged" });
    await h.store("insert", "verdicts", { attempt: a, run, method: "rubric", judge_kind: "human", scores: {}, rubric_snapshot: RUBRIC, score: s, status: "active" });
  };
  await score(oldC.id, 4); await score(oldC.id, 4);
  return { workspace, role, task, oldC, newC, score };
}

test("a first champion is not on trial; one that replaces it is; Keep ends the trial", async () => {
  const s = await seed();
  const first = await post("/castings", { role: s.role.id, contender: s.oldC.id });
  expect(first.status).toBe(200);
  expect(first.body.casting).toMatchObject({ contender: s.oldC.id, trial: false, restored: false });
  expect((await post(`/champion/${s.role.id}/keep`)).status).toBe(422); // not on trial

  await s.score(s.newC.id, 5); await s.score(s.newC.id, 5);
  await Bun.sleep(1100); // since has 1 s resolution
  const second = await post("/castings", { role: s.role.id, contender: s.newC.id });
  expect(second.body.casting).toMatchObject({ contender: s.newC.id, trial: true, suggested_by: "system" });
  let b = (await board(s.role.id)).body;
  expect(b.casting).toMatchObject({ contender: s.newC.id, trial: true });
  expect(b.previous).toBe(s.oldC.id);

  const kept = await post(`/champion/${s.role.id}/keep`);
  expect(kept.status).toBe(200);
  expect(kept.body.casting).toMatchObject({ id: second.body.casting.id, trial: false });
  b = (await board(s.role.id)).body;
  expect(b.casting.trial).toBe(false);
  expect(b.history.length).toBe(2);
  // Keep is an update through the records API, so Vaultbase's record history has it.
  const hist = await h.api("admin", "GET", `/api/v1/castings/${second.body.casting.id}/history`);
  expect(hist.status, JSON.stringify(hist.body)).toBe(200);
  const trials = (hist.body.data.data as any[]).map((e) => e.snapshot?.trial);
  expect(trials).toContain(true);
  expect(trials).toContain(false);
});

test("Restore brings back the earlier champion with a note, and holds back the replaced one until a newer run", async () => {
  const s = await seed();
  await post("/castings", { role: s.role.id, contender: s.oldC.id });
  expect((await post(`/champion/${s.role.id}/restore`)).status).toBe(422); // nobody earlier
  await s.score(s.newC.id, 5); await s.score(s.newC.id, 5);
  await Bun.sleep(1100);
  await post("/castings", { role: s.role.id, contender: s.newC.id });
  await Bun.sleep(1100);

  expect((await post(`/champion/${s.role.id}/restore`, { rationale: 42 })).status).toBe(422);
  const r = await post(`/champion/${s.role.id}/restore`, { rationale: "  weak on real refactors  " });
  expect(r.status).toBe(200);
  expect(r.body.casting).toMatchObject({ contender: s.oldC.id, restored: true, trial: false, suggested_by: "human", rationale: "weak on real refactors" });

  let b = (await board(s.role.id)).body;
  expect(b.casting.contender).toBe(s.oldC.id);
  expect(b.history.map((c: any) => c.contender)).toEqual([s.oldC.id, s.newC.id, s.oldC.id]);
  expect(b.previous).toBe(s.newC.id);
  // New still has the best scores, but it isn't suggested again yet.
  expect(b.rows[0].contender).toBe(s.newC.id);
  expect(b.suggested).toBeNull();
  expect(b.held_back).toEqual({ contender: s.newC.id, since: r.body.casting.since });

  // A run started after the restore is new evidence: the suggestion comes back.
  await Bun.sleep(1100);
  await h.store("insert", "runs", { workspace: s.workspace.id, role: s.role.id, tasks: [s.task.id], contenders: [s.oldC.id, s.newC.id], judge: "me", status: "running", call_count: 0 });
  b = (await board(s.role.id)).body;
  expect(b.suggested).toBe(s.newC.id);
  expect(b.held_back).toBeNull();
});

test("a new workspace keeps a champion on trial 3 days before the reminder, and the owner can change it", async () => {
  const ws = await create(h, "workspaces", { name: `WS ${sfx()}` });
  expect(ws.trial_days).toBe(3);
  const set = await h.api("owner", "PATCH", `/api/v1/workspaces/${ws.id}`, { trial_days: 7 });
  expect(set.status).toBe(200);
  expect((await h.api("owner", "PATCH", `/api/v1/workspaces/${ws.id}`, { trial_days: 0 })).status).toBe(422);
});

test("the daily job alerts once when a trial ends (the workspace's trial_days)", async () => {
  const s = await seed();
  await h.api("owner", "PATCH", `/api/v1/workspaces/${s.workspace.id}`, { trial_days: 5 });
  await post("/castings", { role: s.role.id, contender: s.oldC.id });
  await s.score(s.newC.id, 5); await s.score(s.newC.id, 5);
  await Bun.sleep(1100);
  const c = (await post("/castings", { role: s.role.id, contender: s.newC.id })).body.casting;
  const jobs = (await h.api("admin", "GET", "/api/v1/admin/jobs")).body as any;
  const id = (Array.isArray(jobs) ? jobs : jobs.data).find((x: any) => x.name === "champion-trials-ended")?.id;
  expect(id).toBeTruthy();
  const subject = `Audition: ${s.newC.name}'s trial as Coder is over`;
  const count = () => sink.mails.filter((m) => m.subject === subject).length;
  const now = Math.floor(Date.now() / 1000);
  // Four days in: not over yet.
  await h.store("update", "castings", { since: now - 4 * 86400 }, c.id);
  await h.api("admin", "POST", `/api/v1/admin/jobs/${id}/run`);
  await Bun.sleep(1000);
  expect(count()).toBe(0);
  // Ended an hour ago: one alert, with a link to the leaderboard.
  await h.store("update", "castings", { since: now - 5 * 86400 - 3600 }, c.id);
  expect((await h.api("admin", "POST", `/api/v1/admin/jobs/${id}/run`)).status).toBe(200);
  const mail = await sink.waitFor((m) => m.subject === subject);
  expect(mail.body).toContain(`on trial for 5 days`);
  expect(mail.body).toContain(`https://audition.test/api/custom/app/leaderboard/${s.role.id}`);
  // Ended two days ago: it was in an earlier alert, so not again.
  await h.store("update", "castings", { since: now - 7 * 86400 }, c.id);
  await h.api("admin", "POST", `/api/v1/admin/jobs/${id}/run`);
  await Bun.sleep(1000);
  expect(count()).toBe(1);
}, 60_000);

test("the trial alert's push opens the leaderboard", () => {
  const a = trialAlert({ role: "r1", role_name: "Coder", contender_name: "GPT", since: 0, days: 1 }, "https://x/lb");
  expect(a).toMatchObject({ type: "trial-ended", subject: "Audition: GPT's trial as Coder is over", push: { page: "/leaderboard/r1" } });
  expect(a.body).toContain("for 1 day.");
});

test("only the owner; unknown role is 404", async () => {
  const s = await seed();
  expect((await post(`/champion/${s.role.id}/keep`, {}, "anon")).status).toBeOneOf([401, 403]);
  expect((await post(`/champion/${s.role.id}/restore`, {}, "admin")).status).toBe(403);
  expect((await post("/champion/nope/restore")).status).toBe(404);
  expect((await post("/champion/nope/keep")).status).toBe(404);
});
