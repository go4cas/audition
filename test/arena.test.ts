// Phase 2a on a fresh Vaultbase with the mock provider (docs/PHASE-2A.md):
// the stale-attempt sweep, repeating a run on a schedule, and emails.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { boot, create, fixtures, type Harness } from "./harness.ts";
import { startSink, type Sink } from "./smtp-sink.ts";
import { until } from "./t3-helpers.ts";
import { GENERIC_TEMPLATE } from "../seed/reference.ts";
import { finishedNow, repeatJobCode, scheduleOk, TIMED_OUT } from "../vb_hooks/lib/arena.ts";

describe("pure parts of lib/arena.ts", () => {
  test("only daily, weekly and monthly (1 to 28) schedules are accepted", () => {
    for (const ok of ["0 7 * * *", "30 18 * * 1", "5 0 28 * *", "59 23 1 * *"]) expect(scheduleOk(ok)).toBe(true);
    for (const bad of ["* * * * *", "*/5 * * * *", "0 * * * *", "0 7 31 * *", "0 24 * * *", "0 7 * * 7", "0 7 * * 1-5", ""]) expect(scheduleOk(bad)).toBe(false);
  });
  test("a run-finished email goes out once: Me when ready to judge, AI when done", () => {
    expect(finishedNow({ status: "running" }, { status: "judging", judge: "me" })).toBe(true);
    expect(finishedNow({ status: "judging" }, { status: "done", judge: "me" })).toBe(false);
    expect(finishedNow({ status: "running" }, { status: "done", judge: "me" })).toBe(true);
    expect(finishedNow({ status: "running" }, { status: "judging", judge: "ai" })).toBe(false);
    expect(finishedNow({ status: "judging" }, { status: "done", judge: "ai" })).toBe(true);
    expect(finishedNow({ status: "done" }, { status: "done", judge: "ai" })).toBe(false);
  });
  test("the repeat job's code only queues a repeat of its own run", () => {
    expect(repeatJobCode("abc123")).toBe(`await ctx.helpers.enqueue("repeat", { run: "abc123" }, { uniqueKey: "repeat:" + "abc123" + ":" + ctx.scheduledAt });`);
  });
});

let h: Harness;
let sink: Sink;
let f: Awaited<ReturnType<typeof fixtures>>;
let judge: Record<string, any>;

const post = (path: string, body: unknown, as: "owner" | "admin" = "owner") => h.api(as, "POST", `/api/custom${path}`, body);
const run = async (id: string) => (await h.api("owner", "GET", `/api/custom/runs/${id}`)).body.data;
const jobs = async () => (await h.api("admin", "GET", "/api/v1/admin/jobs")).body as any;
const jobList = async (): Promise<Array<Record<string, any>>> => { const j = await jobs(); return Array.isArray(j) ? j : (j.data ?? []); };

async function startAiRun(): Promise<string> {
  const r = await post("/runs", { role: f.role.id, tasks: [f.task.id], contenders: [f.contender.id], judge: "ai" });
  expect(r.status).toBe(200);
  return r.body.data.run.id;
}

beforeAll(async () => {
  sink = startSink();
  h = await boot();
  const s = await h.api("admin", "PATCH", "/api/v1/admin/settings", {
    "smtp.enabled": "true", "smtp.host": "127.0.0.1", "smtp.port": String(sink.port), "smtp.secure": "false",
    "smtp.from": "audition@test.local", "app.url": "https://audition.test",
  });
  expect(s.status).toBe(200);
  await create(h, "handoff_templates", GENERIC_TEMPLATE, "admin");
  f = await fixtures(h);
  judge = await create(h, "contenders", { name: `Mock Judge ${crypto.randomUUID().slice(0, 6)}`, connection: f.mock.id, model: "mock-judge", config: { mock: { behaviour: "judge" } } });
  // One scored output is enough data, so the first run already suggests a champion.
  expect((await h.api("owner", "PATCH", `/api/v1/workspaces/${f.workspace.id}`, { judge_contender: judge.id, default_judge: "ai", min_outputs: 1 })).status).toBe(200);
  expect((await h.api("owner", "PATCH", `/api/v1/roles/${f.role.id}`, { pass_mark: 1 })).status).toBe(200);
}, 120_000);

afterAll(async () => { await h?.cleanup(); sink?.stop(); });

describe("emails to the owner", () => {
  test("an AI-judged run emails the owner once it is done, with the champion change and links", async () => {
    const id = await startAiRun();
    await until(async () => (await run(id)).run.status === "done", "run done", 30_000);
    const mail = await sink.waitFor((m) => m.body.includes(`/runs/${id}`));
    expect(mail.to).toEqual(["owner@test.local"]);
    expect(mail.subject).toBe("Audition: Researcher run finished");
    expect(mail.body).toContain("Your Researcher run has 1 output.");
    expect(mail.body).toContain("1 judged.");
    expect(mail.body).toContain(`Open the run: https://audition.test/api/custom/app/runs/${id}`);
    expect(mail.body).toContain(`Champion change: the leaderboard now suggests ${f.contender.name} and there is no champion yet.`);
    expect(mail.body).toContain(`https://audition.test/api/custom/app/leaderboard/${f.role.id}`);
  }, 60_000);

  test("no champion line once the suggested champion is confirmed", async () => {
    const c = await post("/castings", { role: f.role.id, contender: f.contender.id });
    expect(c.status).toBe(200);
    const id = await startAiRun();
    const mail = await sink.waitFor((m) => m.body.includes(`/runs/${id}`), 30_000);
    expect(mail.body).not.toContain("Champion change");
  }, 60_000);

  test("a run judged by Me emails when its outputs are ready to judge", async () => {
    const r = await post("/runs", { role: f.role.id, tasks: [f.task.id], contenders: [f.contender.id], judge: "me" });
    const id = r.body.data.run.id;
    const mail = await sink.waitFor((m) => m.body.includes(`/runs/${id}`), 30_000);
    expect(mail.subject).toBe("Audition: Researcher outputs are ready to judge");
    expect(mail.body).toContain("1 is ready for you to judge.");
  }, 60_000);
});

describe("repeating a run on a schedule", () => {
  let first: string;
  let jobId: string;

  test("a done run gets a Vaultbase cron job; bad schedules and unfinished runs are refused", async () => {
    first = await startAiRun();
    await until(async () => (await run(first)).run.status === "done", "run done", 30_000);
    expect((await post(`/runs/${first}/schedule`, { schedule: "* * * * *" })).status).toBe(422);
    expect((await post(`/runs/${first}/schedule`, { schedule: 5 })).status).toBe(422);
    expect((await post(`/runs/${first}/schedule`, { schedule: "0 7 * * 1" }, "admin")).status).toBe(403);
    const ok = await post(`/runs/${first}/schedule`, { schedule: "0 7 * * 1" });
    expect(ok.status).toBe(200);
    expect(ok.body.data.run.schedule).toBe("0 7 * * 1");
    expect((await run(first)).run.schedule).toBe("0 7 * * 1");
    const job = (await jobList()).find((j) => j.name === `repeat-${first}`);
    expect(job).toBeTruthy();
    expect(job!.cron).toBe("0 7 * * 1");
    jobId = job!.id;

    const pending = await h.store("insert", "runs", { workspace: f.workspace.id, role: f.role.id, tasks: [f.task.id], contenders: [f.contender.id], judge: "ai", status: "running" });
    expect((await post(`/runs/${pending}/schedule`, { schedule: "0 7 * * *" })).status).toBe(409);
  }, 60_000);

  test("a tick of the job starts a linked repeat that runs unattended", async () => {
    const before = await h.sql<{ id: string }>(`SELECT id FROM vb_runs WHERE rerun_of = ?`, [first]);
    const r = await h.api("admin", "POST", `/api/v1/admin/jobs/${jobId}/run`);
    expect(r.status).toBe(200);
    const repeat = await until(async () => {
      const rows = await h.sql<{ id: string; status: string; schedule: string | null }>(`SELECT id, status, schedule FROM vb_runs WHERE rerun_of = ?`, [first]);
      return rows.length > before.length && rows.find((x) => !before.some((b) => b.id === x.id)) || null;
    }, "a repeat run", 20_000);
    await until(async () => (await run(repeat.id)).run.status === "done", "repeat done", 30_000);
    const view = await run(repeat.id);
    expect(view.counts.judged).toBe(1);
    expect(view.run.schedule || "").toBe("");
    const mail = await sink.waitFor((m) => m.body.includes(`/runs/${repeat.id}`), 30_000);
    expect(mail.body).toContain("Your Researcher run (a repeat) has 1 output.");
    // The scheduled run itself is untouched.
    expect((await run(first)).run.status).toBe("done");
  }, 60_000);

  test("a repeat that can't start is skipped and emailed, and the schedule stays", async () => {
    // A used contender is locked against owner edits, so turn it off server-side.
    await h.store("update", "contenders", { enabled: false }, f.contender.id);
    try {
      expect((await h.api("admin", "POST", `/api/v1/admin/jobs/${jobId}/run`)).status).toBe(200);
      const mail = await sink.waitFor((m) => m.subject === "Audition: a repeat of Researcher was skipped", 20_000);
      expect(mail.body).toContain("is turned off.");
      expect(mail.body).toContain(`https://audition.test/api/custom/app/runs/${first}`);
      expect((await run(first)).run.schedule).toBe("0 7 * * 1");
    } finally {
      await h.store("update", "contenders", { enabled: true }, f.contender.id);
    }
  }, 60_000);

  test("stop repeating removes the job; a repeat of a repeating run can't repeat itself", async () => {
    const [rep] = await h.sql<{ id: string }>(`SELECT id FROM vb_runs WHERE rerun_of = ? LIMIT 1`, [first]);
    expect((await post(`/runs/${rep!.id}/schedule`, { schedule: "0 9 * * *" })).status).toBe(409);
    const off = await post(`/runs/${first}/schedule`, { schedule: null });
    expect(off.status).toBe(200);
    expect((await run(first)).run.schedule || "").toBe("");
    expect((await jobList()).some((j) => j.name === `repeat-${first}`)).toBe(false);
  }, 30_000);
});

describe("the stale-attempt sweep", () => {
  test("the sweep is a file job in Vaultbase, every 5 minutes", async () => {
    const job = (await jobList()).find((j) => j.name === "sweep-stale-outputs");
    expect(job?.cron).toBe("*/5 * * * *");
  });

  test("stuck API outputs fail and their run moves on; handoff outputs wait", async () => {
    const id = await h.store("insert", "runs", { workspace: f.workspace.id, role: f.role.id, tasks: [f.task.id], contenders: [f.contender.id, f.handoff.id], judge: "me", status: "running" });
    const stuck = await h.store("insert", "attempts", { run: id, task: f.task.id, contender: f.contender.id, mode: "api", status: "in_progress", prompt_sent: "p" });
    const waiting = await h.store("insert", "attempts", { run: id, task: f.task.id, contender: f.handoff.id, mode: "handoff", status: "waiting", prompt_sent: "p" });
    const now = Math.floor(Date.now() / 1000);

    const early = await post("/test/sweep", { now: now + 10 * 60 }, "admin");
    expect(early.body.data.failed).toEqual([]);

    const late = await post("/test/sweep", { now: now + 21 * 60 }, "admin");
    expect(late.body.data.failed).toEqual([stuck]);
    const [a] = await h.sql<{ status: string; error: string }>(`SELECT status, error FROM vb_attempts WHERE id = ?`, [stuck]);
    expect(a).toEqual({ status: "failed", error: TIMED_OUT });
    const [w] = await h.sql<{ status: string }>(`SELECT status FROM vb_attempts WHERE id = ?`, [waiting]);
    expect(w!.status).toBe("waiting");
  }, 30_000);

  test("a queued API output is swept only after an hour", async () => {
    const id = await h.store("insert", "runs", { workspace: f.workspace.id, role: f.role.id, tasks: [f.task.id], contenders: [f.contender.id], judge: "ai", status: "running" });
    // Not on the generate queue, so no worker picks it up.
    const queued = await h.store("insert", "attempts", { run: id, task: f.task.id, contender: f.contender.id, mode: "api", status: "queued", prompt_sent: "p" });
    const now = Math.floor(Date.now() / 1000);
    expect((await post("/test/sweep", { now: now + 30 * 60 }, "admin")).body.data.failed).toEqual([]);
    expect((await post("/test/sweep", { now: now + 61 * 60 }, "admin")).body.data.failed).toEqual([queued]);
    expect((await run(id)).run.status).toBe("done");
  }, 30_000);
});

describe("email with SMTP off", () => {
  test("a run still finishes, and nothing is sent", async () => {
    expect((await h.api("admin", "PATCH", "/api/v1/admin/settings", { "smtp.enabled": "false" })).status).toBe(200);
    const sent = sink.mails.length;
    const id = await startAiRun();
    await until(async () => (await run(id)).run.status === "done", "run done", 30_000);
    await Bun.sleep(1500);
    expect(sink.mails.length).toBe(sent);
  }, 60_000);
});
