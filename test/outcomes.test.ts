// Outcome checks on a fresh Vaultbase with the mock provider (docs/PHASE-2A.md,
// part 3), and the Phase 2 Done-when end to end: a scheduled role reruns
// unattended, and a delayed outcome verdict lands on its due date.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { boot, create, fixtures, RUBRIC, type Harness } from "./harness.ts";
import { startSink, type Sink } from "./smtp-sink.ts";
import { until } from "./t3-helpers.ts";
import { GENERIC_TEMPLATE } from "../seed/reference.ts";
import { DAY_S, dueEmail } from "../vb_hooks/lib/outcomes.ts";
import { BLIND_FORBIDDEN_KEYS } from "../vb_hooks/lib/scoring.ts";

let h: Harness;
let sink: Sink;
let f: Awaited<ReturnType<typeof fixtures>>;
let analyst: Record<string, any>;
let stockTask: Record<string, any>;

const post = (path: string, body: unknown, as: "owner" | "admin" = "owner") => h.api(as, "POST", `/api/custom${path}`, body);
const runView = async (id: string) => (await h.api("owner", "GET", `/api/custom/runs/${id}`)).body.data;
const outcomeOf = async (attempt: string) => h.sql<Record<string, any>>(`SELECT * FROM vb_verdicts WHERE attempt = ? AND method = 'outcome'`, [attempt]);
const board = async (role: string) => (await h.api("owner", "GET", `/api/custom/leaderboard/${role}`)).body.data;
const due = async () => (await h.api("owner", "GET", "/api/custom/outcomes")).body.data.due as any[];
const jobId = async (name: string) => {
  const j = (await h.api("admin", "GET", "/api/v1/admin/jobs")).body as any;
  return (Array.isArray(j) ? j : j.data).find((x: any) => x.name === name)?.id as string;
};
/** Pretend the due date has passed: move it back (server write, as the clock can't move). */
const makeDue = (id: string, agoS = 60) => h.store("update", "verdicts", { due_at: Math.floor(Date.now() / 1000) - agoS }, id);

async function aiRun(role: string, task: string): Promise<{ run: string; attempt: string }> {
  const r = await post("/runs", { role, tasks: [task], contenders: [f.contender.id], judge: "ai" });
  expect(r.status).toBe(200);
  const run = r.body.data.run.id;
  await until(async () => (await runView(run)).run.status === "done", "run done", 30_000);
  return { run, attempt: (await runView(run)).attempts[0].id };
}

beforeAll(async () => {
  sink = startSink();
  h = await boot();
  await h.api("admin", "PATCH", "/api/v1/admin/settings", {
    "smtp.enabled": "true", "smtp.host": "127.0.0.1", "smtp.port": String(sink.port), "smtp.secure": "false",
    "smtp.from": "audition@test.local", "app.url": "https://audition.test",
  });
  await create(h, "handoff_templates", GENERIC_TEMPLATE, "admin");
  f = await fixtures(h);
  const judge = await create(h, "contenders", { name: `Mock Judge ${crypto.randomUUID().slice(0, 6)}`, connection: f.mock.id, model: "mock-judge", config: { mock: { behaviour: "judge" } } });
  await h.api("owner", "PATCH", `/api/v1/workspaces/${f.workspace.id}`, { judge_contender: judge.id, default_judge: "ai", min_outputs: 1 });
  analyst = await create(h, "roles", { workspace: f.workspace.id, name: "Stock analyst", rubric: RUBRIC, pass_mark: 1, outcome_after_days: 28 });
  stockTask = await create(h, "tasks", { role: analyst.id, title: "Buy, hold or sell Northwind", prompt: "<p>Give a view.</p>" });
}, 120_000);

afterAll(async () => { await h?.cleanup(); sink?.stop(); });

describe("the outcome setting", () => {
  test("roles.outcome_after_days is an optional number from 1 to 365", async () => {
    expect(analyst.outcome_after_days).toBe(28);
    expect((await h.api("owner", "PATCH", `/api/v1/roles/${analyst.id}`, { outcome_after_days: 0 })).status).toBe(422);
    expect((await h.api("owner", "PATCH", `/api/v1/roles/${analyst.id}`, { outcome_after_days: 400 })).status).toBe(422);
    expect(f.role.outcome_after_days ?? null).toBeNull();
  });

  test("the daily email text names each due call and links to the checks", () => {
    expect(dueEmail([], "x")).toBeNull();
    const m = dueEmail([{ role_name: "Stock analyst", workspace_name: "Stock Review", task_title: "Northwind" } as never], "https://a/outcomes")!;
    expect(m.subject).toBe("Audition: 1 outcome check due");
    expect(m.body).toContain("- Stock analyst (Stock Review): Northwind");
    expect(m.body).toContain("Check them here: https://a/outcomes");
  });
});

describe("outcome checks", () => {
  let first: { run: string; attempt: string };
  let check: Record<string, any>;

  test("judging an output in such a role creates one check, due in 28 days, with no score", async () => {
    const before = Math.floor(Date.now() / 1000);
    first = await aiRun(analyst.id, stockTask.id);
    const [c, ...more] = await until(async () => { const r = await outcomeOf(first.attempt); return r.length ? r : null; }, "outcome check");
    expect(more).toEqual([]);
    check = c!;
    expect(check.status).toBe("active");
    expect(check.score).toBeNull();
    expect(check.judge_kind).toBe("human");
    expect(Number(check.due_at)).toBeGreaterThanOrEqual(before + 28 * DAY_S);
    expect(Number(check.due_at)).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 28 * DAY_S);
  }, 60_000);

  test("before its due date it is not listed and can't be scored, and the leaderboard ignores it", async () => {
    expect(await due()).toEqual([]);
    expect((await post(`/outcomes/${check.id}`, { stars: 4 })).status).toBe(409);
    const b = await board(analyst.id);
    expect(b.rows[0].n).toBe(1);
    expect(b.rows[0].n_outcome).toBe(0);
    expect(b.rows[0].mean_outcome).toBeNull();
  });

  test("an owner override keeps the one check, and the check doesn't hide the active rubric verdict", async () => {
    const r = await h.api("owner", "POST", "/api/v1/verdicts", { attempt: first.attempt, scores: { Accuracy: { stars: 5 }, Clarity: { stars: 5 } } });
    expect(r.status).toBe(200);
    await until(async () => (await h.sql(`SELECT id FROM vb_verdicts WHERE attempt = ? AND judge_kind = 'ai' AND status = 'overridden'`, [first.attempt])).length, "AI verdict overridden");
    const checks = await outcomeOf(first.attempt);
    expect(checks.map((c) => [c.id, c.status])).toEqual([[check.id, "active"]]);
    const judging = await h.api("owner", "GET", `/api/custom/judging/${first.run}/${stockTask.id}`);
    expect(judging.body.data.outputs[0].verdict.judge_kind).toBe("human");
    const b = await board(analyst.id);
    expect(b.rows[0].n).toBe(1);
    expect(b.rows[0].mean_score).toBe(5);
  }, 30_000);

  test("on its due date it is listed, blind, with the output", async () => {
    await makeDue(check.id);
    const list = await due();
    expect(list.map((d) => d.id)).toEqual([check.id]);
    const d = list[0];
    expect(d.role_name).toBe("Stock analyst");
    expect(d.task_title).toBe("Buy, hold or sell Northwind");
    expect(d.output.length).toBeGreaterThan(0);
    expect(d.judged_score).toBe(5);
    for (const k of BLIND_FORBIDDEN_KEYS) expect(Object.keys(d)).not.toContain(k);
    expect(JSON.stringify(d)).not.toContain(f.contender.id);
  });

  test("scoring it: stars 1 to 5 once, shown in the Outcome column and not in quality", async () => {
    expect((await post(`/outcomes/${check.id}`, { stars: 6 })).status).toBe(422);
    expect((await post(`/outcomes/${check.id}`, { stars: 3, note: 7 })).status).toBe(422);
    expect((await post(`/outcomes/${check.id}`, { stars: 4 }, "admin")).status).toBe(403);
    const ok = await post(`/outcomes/${check.id}`, { stars: 4, note: "  Fell 12%, so sell was right  " });
    expect(ok.status).toBe(200);
    expect(ok.body.data.verdict.score).toBe(4);
    expect(ok.body.data.verdict.scores).toEqual({ "Was the call right?": { stars: 4, reason: "Fell 12%, so sell was right" } });
    expect((await post(`/outcomes/${check.id}`, { stars: 2 })).status).toBe(409);
    expect((await post(`/outcomes/nope123`, { stars: 2 })).status).toBe(404);
    expect(await due()).toEqual([]);
    const b = await board(analyst.id);
    expect(b.rows[0]).toMatchObject({ n: 1, mean_score: 5, n_outcome: 1, mean_outcome: 4 });
  });

  test("a role without the setting gets no check", async () => {
    const r = await aiRun(f.role.id, f.task.id);
    await Bun.sleep(500);
    expect(await outcomeOf(r.attempt)).toEqual([]);
  }, 60_000);

  test("the daily job emails the checks that came due since yesterday, once", async () => {
    const r = await aiRun(analyst.id, stockTask.id);
    const [c] = await until(async () => { const x = await outcomeOf(r.attempt); return x.length ? x : null; }, "outcome check");
    await makeDue(c!.id, 3600);
    const id = await jobId("outcome-checks-due");
    expect(id).toBeTruthy();
    expect((await h.api("admin", "POST", `/api/v1/admin/jobs/${id}/run`)).status).toBe(200);
    const mail = await sink.waitFor((m) => m.subject === "Audition: 1 outcome check due");
    expect(mail.body).toContain("- Stock analyst (");
    expect(mail.body).toContain("Check them here: https://audition.test/outcomes");
    // A check that came due two days ago was in an earlier email: not again.
    await makeDue(c!.id, 2 * DAY_S);
    const dueMails = () => sink.mails.filter((m) => /outcome checks? due/.test(m.subject)).length;
    const n = dueMails();
    await h.api("admin", "POST", `/api/v1/admin/jobs/${id}/run`);
    await Bun.sleep(1500);
    expect(dueMails()).toBe(n);
    // It stays on the list until it is scored.
    expect((await due()).map((d) => d.id)).toContain(c!.id);
  }, 60_000);
});

describe("the Phase 2 Done-when", () => {
  test("a scheduled role reruns unattended, and a delayed outcome verdict lands on its due date", async () => {
    const r = await aiRun(analyst.id, stockTask.id);
    expect((await post(`/runs/${r.run}/schedule`, { schedule: "0 6 * * 1" })).status).toBe(200);
    const id = await jobId(`repeat-${r.run}`);
    expect((await h.api("admin", "POST", `/api/v1/admin/jobs/${id}/run`)).status).toBe(200);
    const repeat = await until(async () => (await h.sql<{ id: string }>(`SELECT id FROM vb_runs WHERE rerun_of = ?`, [r.run]))[0], "the repeat run");
    await until(async () => (await runView(repeat.id)).run.status === "done", "the repeat done unattended", 30_000);
    const attempt = (await runView(repeat.id)).attempts[0].id;
    const [c] = await until(async () => { const x = await outcomeOf(attempt); return x.length ? x : null; }, "outcome check on the repeat");
    expect((await due()).map((d) => d.id)).not.toContain(c!.id);
    await makeDue(c!.id);
    expect((await due()).map((d) => d.id)).toContain(c!.id);
    expect((await post(`/outcomes/${c!.id}`, { stars: 2 })).status).toBe(200);
    expect((await board(analyst.id)).rows[0].n_outcome).toBe(2);
  }, 90_000);
});
