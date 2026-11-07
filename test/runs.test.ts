// Runs end to end on a fresh Vaultbase with the mock provider (TECH-SPEC §7, §8).
// T1 Done-when 1, 2, 5, 6, 7 and 8, plus the routes' access and checks.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { boot, create, fixtures, type Harness } from "./harness.ts";
import { GENERIC_TEMPLATE } from "../seed/reference.ts";
import { isOwner, parseRunBody, runStatusFrom } from "../vb_hooks/lib/runs.ts";

describe("pure parts of lib/runs.ts", () => {
  test("run status: running while in flight, judging while unjudged, then done (§8)", () => {
    expect(runStatusFrom(["submitted", "queued"])).toBe("running");
    expect(runStatusFrom(["judged", "in_progress"])).toBe("running");
    expect(runStatusFrom(["waiting", "failed"])).toBe("running");
    expect(runStatusFrom(["submitted", "judged", "failed"])).toBe("judging");
    expect(runStatusFrom(["judged", "failed"])).toBe("done");
    expect(runStatusFrom(["failed", "failed"])).toBe("done");
  });
  test("body parsing de-duplicates ids and refuses bad input", () => {
    expect(parseRunBody({ role: "r1", tasks: ["t1", "t1", "t2"], contenders: ["c1"] })).toEqual({ role: "r1", tasks: ["t1", "t2"], contenders: ["c1"] });
    expect(() => parseRunBody({ role: "r1", tasks: ["bad id!"], contenders: ["c1"] })).toThrow();
    expect(() => parseRunBody(null)).toThrow();
  });
  test("only a users-collection user is the owner", () => {
    expect(isOwner({ type: "user", collection: "users" })).toBe(true);
    expect(isOwner({ type: "admin" })).toBe(false);
    expect(isOwner(null)).toBe(false);
  });
});

let h: Harness;
let f: Awaited<ReturnType<typeof fixtures>>;
let task2: Record<string, any>;
const C: Record<string, Record<string, any>> = {};

const mockContender = (name: string, behaviour: string, extra: Record<string, unknown> = {}) =>
  create(h, "contenders", { name: `${name} ${crypto.randomUUID().slice(0, 6)}`, connection: f.mock.id, model: `mock-${behaviour}`, config: { mock: { behaviour } }, ...extra });

async function post(path: string, body: unknown, as: "owner" | "admin" | "anon" = "owner") {
  return h.api(as, "POST", `/api/custom${path}`, body);
}

/** Poll GET /runs/:id (as the live view does) until nothing is queued or in progress. */
async function settle(runId: string, timeoutMs = 30_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const r = await h.api("owner", "GET", `/api/custom/runs/${runId}`);
    expect(r.status).toBe(200);
    const c = r.body.data.counts;
    if (c.queued === 0 && c.in_progress === 0) return r.body.data;
    if (Date.now() > end) throw new Error(`run ${runId} did not settle: ${JSON.stringify(c)}\n${h.inst.logs().slice(-3000)}`);
    await Bun.sleep(150);
  }
}

beforeAll(async () => {
  h = await boot();
  await create(h, "handoff_templates", GENERIC_TEMPLATE, "admin");
  f = await fixtures(h);
  task2 = await create(h, "tasks", { role: f.role.id, title: "Summarise the findings", prompt: "<p>Summarise in <b>three</b> bullets.</p>" });
  C.steady = f.contender;
  C.erratic = await mockContender("Mock Erratic", "erratic");
  C.flaky = await mockContender("Mock Flaky", "flaky");
  C.fail = await mockContender("Mock Fail", "fail");
  C.image = await mockContender("Mock Image", "image");
  C.judge = await mockContender("Mock Judge", "judge");
  C.priced = await mockContender("Mock Priced", "steady", { price_in_per_mtok: 3, price_out_per_mtok: 15 });
  C.halfPriced = await mockContender("Mock Half", "steady", { price_in_per_mtok: 3 });
});
afterAll(async () => { await h?.cleanup(); });

let firstRun: Record<string, any>;

describe("a run of 2 tasks × 3 mock contenders (Done-when 1)", () => {
  test("POST /runs creates the run and 6 attempts, and they all become submitted", async () => {
    const r = await post("/runs", { role: f.role.id, tasks: [f.task.id, task2.id], contenders: [C.steady!.id, C.erratic!.id, C.flaky!.id], judge: "me" });
    expect(r.status).toBe(200);
    firstRun = r.body.data.run;
    expect(firstRun.status).toBe("running");
    expect(firstRun.role).toBe(f.role.id);
    expect(firstRun.workspace).toBe(f.workspace.id);
    expect(firstRun.tasks).toEqual([f.task.id, task2.id]);
    expect(firstRun.contenders).toEqual([C.steady!.id, C.erratic!.id, C.flaky!.id]);
    expect(firstRun.call_count).toBe(6);

    const view = await settle(firstRun.id);
    expect(view.attempts.length).toBe(6);
    expect(view.counts).toEqual({ queued: 0, in_progress: 0, waiting: 0, submitted: 6, judged: 0, failed: 0 });
    for (const a of view.attempts) {
      expect(a.status).toBe("submitted");
      expect(a.mode).toBe("api");
      expect(a.tokens_in).toBeGreaterThan(0);
      expect(a.tokens_out).toBeGreaterThan(0);
      expect(a.duration_ms).toBeGreaterThanOrEqual(200);
      expect(a.duration_ms).toBeLessThanOrEqual(2000);
      expect(a.finish_reason).toBe("end_turn");
      expect(a.error).toBeNull();
    }
    // Every task × contender pair exactly once.
    const pairs = new Set(view.attempts.map((a: any) => `${a.task}:${a.contender}`));
    expect(pairs.size).toBe(6);
    // judge "me": the outputs wait for the owner, so the run is judging.
    expect(view.run.status).toBe("judging");
  });

  test("the flaky contender shows a retry through its call count", async () => {
    const lines = h.inst.logs().split("\n").filter((l) => l.includes("generate attempt=") && l.includes(`status=submitted`));
    const view = (await h.api("owner", "GET", `/api/custom/runs/${firstRun.id}`)).body.data;
    for (const a of view.attempts) {
      const line = lines.find((l) => l.includes(`attempt=${a.id} `));
      expect(line).toBeDefined();
      expect(line).toContain(a.contender === C.flaky!.id ? "calls=2" : "calls=1");
      // and on the output itself (attempts.provider_calls), for the run page
      expect(a.provider_calls).toBe(a.contender === C.flaky!.id ? 2 : 1);
    }
  });

  test("stored outputs: measured metrics, the mock's answer, and one prompt per task shared by its attempts", async () => {
    const rows = await h.sql<any>(`SELECT task, contender, output, prompt_sent, metrics_source, submitted_at FROM vb_attempts WHERE run = ?`, [firstRun.id]);
    for (const r of rows) {
      expect(r.metrics_source).toBe("measured");
      expect(r.submitted_at).toBeGreaterThan(0);
      expect(r.output).toContain("[[mock-quality:");
      expect(r.prompt_sent).toContain("You are acting as: Researcher.");
      expect(r.prompt_sent).not.toContain("<p>");
    }
    for (const t of [f.task.id, task2.id]) {
      const prompts = new Set(rows.filter((r: any) => r.task === t).map((r: any) => r.prompt_sent));
      expect(prompts.size).toBe(1);
    }
    expect(rows.find((r: any) => r.task === task2.id).prompt_sent).toContain("TASK: Summarise the findings\nSummarise in three bullets.");
  });

  test("the owner reads the run and its attempts through REST too", async () => {
    const r = await h.api("owner", "GET", `/api/v1/attempts?filter=${encodeURIComponent(`run = "${firstRun.id}"`)}`);
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBe(6);
  });
});

describe("tasks and contenders are locked after their first run (Done-when 8)", () => {
  test("locked is set on every task and contender used", async () => {
    for (const t of [f.task.id, task2.id]) expect((await h.api("owner", "GET", `/api/v1/tasks/${t}`)).body.data.locked).toBe(true);
    for (const c of [C.steady!, C.erratic!, C.flaky!]) expect((await h.api("owner", "GET", `/api/v1/contenders/${c.id}`)).body.data.locked).toBe(true);
    expect((await h.api("owner", "GET", `/api/v1/contenders/${C.fail!.id}`)).body.data.locked).toBe(false);
  });
  test("and they can no longer be edited or deleted", async () => {
    expect((await h.api("owner", "PATCH", `/api/v1/tasks/${f.task.id}`, { title: "Changed" })).status).not.toBe(200);
    expect((await h.api("owner", "PATCH", `/api/v1/contenders/${C.steady!.id}`, { model: "other" })).status).not.toBe(200);
    expect((await h.api("owner", "DELETE", `/api/v1/tasks/${task2.id}`)).status).not.toBeOneOf([200, 204]);
  });
});

describe("Run again (Done-when 2)", () => {
  test("is refused while the run isn't done", async () => {
    const r = await post(`/runs/${firstRun.id}/again`, {});
    expect(r.status).toBe(409);
  });

  test("creates a new run of 6 attempts linked by rerun_of, and leaves the first 6 byte-for-byte unchanged", async () => {
    // Stand in for judging (T3): mark the outputs judged and the run done.
    const ids = (await h.sql<{ id: string }>(`SELECT id FROM vb_attempts WHERE run = ?`, [firstRun.id])).map((r) => r.id);
    for (const id of ids) await h.store("update", "attempts", { status: "judged" }, id);
    await h.store("update", "runs", { status: "done" }, firstRun.id);
    const before = await h.sql(`SELECT * FROM vb_attempts WHERE run = ? ORDER BY id`, [firstRun.id]);
    const runBefore = await h.sql(`SELECT * FROM vb_runs WHERE id = ?`, [firstRun.id]);

    const r = await post(`/runs/${firstRun.id}/again`, {});
    expect(r.status).toBe(200);
    const again = r.body.data.run;
    expect(again.id).not.toBe(firstRun.id);
    expect(again.rerun_of).toBe(firstRun.id);
    expect(again.role).toBe(firstRun.role);
    expect(again.tasks).toEqual(firstRun.tasks);
    expect(again.contenders).toEqual(firstRun.contenders);
    expect(again.judge).toBe("me");
    const view = await settle(again.id);
    expect(view.attempts.length).toBe(6);
    expect(view.counts.submitted).toBe(6);

    const after = await h.sql(`SELECT * FROM vb_attempts WHERE run = ? ORDER BY id`, [firstRun.id]);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect(JSON.stringify(await h.sql(`SELECT * FROM vb_runs WHERE id = ?`, [firstRun.id]))).toBe(JSON.stringify(runBefore));

    // A new seed per run: the erratic contender's outputs differ from the first run's (n = 1, not 0).
    const outs = await h.sql<{ run: string; task: string; output: string; tokens_out: number }>(
      `SELECT run, task, output, tokens_out FROM vb_attempts WHERE contender = ? ORDER BY rowid`, [C.erratic!.id]);
    expect(outs.length).toBe(4);
    const first = outs.filter((o) => o.run === firstRun.id).map((o) => `${o.output}|${o.tokens_out}`);
    const second = outs.filter((o) => o.run === again.id).map((o) => `${o.output}|${o.tokens_out}`);
    expect(second).not.toEqual(first);
  });

  test("an unknown run is 404", async () => {
    expect((await post(`/runs/nope/again`, {})).status).toBe(404);
  });
});

describe("a failing contender (Done-when 6)", () => {
  test("gives a failed attempt with an error, and the other attempts still finish", async () => {
    const r = await post("/runs", { role: f.role.id, tasks: [f.task.id], contenders: [C.fail!.id, C.steady!.id, C.image!.id], judge: "me" });
    expect(r.status).toBe(200);
    const view = await settle(r.body.data.run.id);
    const byC = Object.fromEntries(view.attempts.map((a: any) => [a.contender, a]));
    expect(byC[C.fail!.id].status).toBe("failed");
    expect(byC[C.fail!.id].error).toBe("Mock Fail always fails.");
    expect(byC[C.fail!.id].provider_calls).toBe(1);
    expect(byC[C.steady!.id].status).toBe("submitted");
    expect(byC[C.image!.id].status).toBe("submitted");
    expect(view.counts).toMatchObject({ failed: 1, submitted: 2 });
    expect(view.run.status).toBe("judging");
    // The queue job ended normally: the worker didn't throw.
    const jobs = await h.sql<{ status: string; error: string | null }>(`SELECT status, error FROM vaultbase_jobs_log WHERE queue = 'generate' AND payload LIKE ?`, [`%${byC[C.fail!.id].id}%`]);
    expect(jobs).toEqual([{ status: "succeeded", error: null }]);
  });

  test("a run where every output fails ends done", async () => {
    const r = await post("/runs", { role: f.role.id, tasks: [f.task.id], contenders: [C.fail!.id], judge: "me" });
    const view = await settle(r.body.data.run.id);
    expect(view.counts.failed).toBe(1);
    expect(view.run.status).toBe("done");
  });

  test("an Anthropic contender with no key fails with a clear error and makes no call", async () => {
    const conn = await create(h, "connections", { name: `Anthropic ${crypto.randomUUID().slice(0, 6)}`, provider: "anthropic" });
    const c = await create(h, "contenders", { name: `Opus ${crypto.randomUUID().slice(0, 6)}`, connection: conn.id, model: "claude-opus-5-5", config: { effort: "high" } });
    const r = await post("/runs", { role: f.role.id, tasks: [f.task.id], contenders: [c.id], judge: "me" });
    const view = await settle(r.body.data.run.id);
    expect(view.attempts[0].status).toBe("failed");
    expect(view.attempts[0].error).toContain("no API key");
  });

  test("the image mock's files are attached to the output and served to the owner", async () => {
    const rows = await h.sql<{ output_files: string }>(`SELECT output_files FROM vb_attempts WHERE contender = ?`, [C.image!.id]);
    const names = JSON.parse(rows[0]!.output_files) as string[];
    expect(names.length).toBeGreaterThanOrEqual(1);
    const res = await fetch(`${h.url}/api/v1/files/${names[0]}`, { headers: { authorization: `Bearer ${h.ownerToken}` } });
    expect(res.status).toBe(200);
    expect([...new Uint8Array(await res.arrayBuffer()).slice(0, 4)]).toEqual([137, 80, 78, 71]);
  });
});

describe("cost (Done-when 5)", () => {
  test("derived when both prices are set, empty otherwise", async () => {
    const r = await post("/runs", { role: f.role.id, tasks: [f.task.id], contenders: [C.priced!.id, C.halfPriced!.id], judge: "me" });
    const view = await settle(r.body.data.run.id);
    const byC = Object.fromEntries(view.attempts.map((a: any) => [a.contender, a]));
    const p = byC[C.priced!.id];
    expect(p.cost).toBeCloseTo((p.tokens_in * 3 + p.tokens_out * 15) / 1e6, 6);
    expect(p.cost).toBeGreaterThan(0);
    expect(byC[C.halfPriced!.id].cost).toBeNull();
    expect(byC[C.halfPriced!.id].tokens_out).toBe(300);
  });
});

describe("handoff contenders", () => {
  test("their attempts wait with the same prompt as the API attempts on the task", async () => {
    const r = await post("/runs", { role: f.role.id, tasks: [f.task.id], contenders: [f.handoff.id, C.steady!.id], judge: "me" });
    expect(r.status).toBe(200);
    const view = await settle(r.body.data.run.id);
    const ho = view.attempts.find((a: any) => a.contender === f.handoff.id);
    expect(ho.mode).toBe("handoff");
    expect(ho.status).toBe("waiting");
    expect(ho.provider_calls).toBeNull();
    expect(view.run.status).toBe("running");
    const rows = await h.sql<{ prompt_sent: string }>(`SELECT prompt_sent FROM vb_attempts WHERE run = ?`, [view.run.id]);
    expect(new Set(rows.map((x) => x.prompt_sent)).size).toBe(1);
    // No generate job for the handoff attempt.
    expect((await h.sql(`SELECT id FROM vaultbase_jobs_log WHERE payload LIKE ?`, [`%${ho.id}%`])).length).toBe(0);
  });
});

describe("an AI-judged run", () => {
  test("enqueues one judge job per submitted output (the judge worker is T3's)", async () => {
    const r = await post("/runs", { role: f.role.id, tasks: [f.task.id], contenders: [C.steady!.id, C.fail!.id], judge: "ai" });
    expect(r.status).toBe(422); // the workspace has no AI judge yet
    expect((await h.api("owner", "PATCH", `/api/v1/workspaces/${f.workspace.id}`, { judge_contender: C.judge!.id })).status).toBe(200);
    const ok = await post("/runs", { role: f.role.id, tasks: [f.task.id], contenders: [C.steady!.id, C.fail!.id], judge: "ai" });
    expect(ok.status).toBe(200);
    expect(ok.body.data.run.judge_contender).toBe(C.judge!.id);
    const view = await settle(ok.body.data.run.id);
    const submitted = view.attempts.find((a: any) => a.status === "submitted");
    const failed = view.attempts.find((a: any) => a.status === "failed");
    expect((await h.sql(`SELECT id FROM vaultbase_jobs_log WHERE queue = 'judge' AND payload LIKE ?`, [`%${submitted.id}%`])).length).toBe(1);
    expect((await h.sql(`SELECT id FROM vaultbase_jobs_log WHERE queue = 'judge' AND payload LIKE ?`, [`%${failed.id}%`])).length).toBe(0);
    // The judge contender is used by the run, so it is locked too.
    expect((await h.api("owner", "GET", `/api/v1/contenders/${C.judge!.id}`)).body.data.locked).toBe(true);
  });
});

describe("POST /runs/preview (Done-when 7)", () => {
  let anthropicJudge: Record<string, any>;
  let ws2: Record<string, any>, role2: Record<string, any>, t2a: Record<string, any>, t2b: Record<string, any>, ho2: Record<string, any>;
  beforeAll(async () => {
    const conn = await create(h, "connections", { name: `Anthropic J ${crypto.randomUUID().slice(0, 6)}`, provider: "anthropic" });
    anthropicJudge = await create(h, "contenders", { name: `Opus Judge ${crypto.randomUUID().slice(0, 6)}`, connection: conn.id, model: "claude-opus-5-5" });
    ws2 = await create(h, "workspaces", { name: `Preview WS ${crypto.randomUUID().slice(0, 6)}`, default_judge: "ai", judge_contender: anthropicJudge.id });
    role2 = await create(h, "roles", { workspace: ws2.id, name: "Writer", rubric: [{ name: "Clarity", weight: 100 }] });
    t2a = await create(h, "tasks", { role: role2.id, title: "A", prompt: "<p>A</p>" });
    t2b = await create(h, "tasks", { role: role2.id, title: "B", prompt: "<p>B</p>" });
    ho2 = await create(h, "contenders", { name: `Claude Code (manual) ${crypto.randomUUID().slice(0, 6)}`, connection: f.manual.id });
  });
  const preview = (body: Record<string, unknown>) => post("/runs/preview", body);

  test("API only, judged by me", async () => {
    const r = await preview({ role: f.role.id, tasks: [f.task.id, task2.id], contenders: [C.steady!.id, C.erratic!.id], judge: "me" });
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ outputs: 4, api_calls: 4, handoff_outputs: 0, judge_calls: 0, total_provider_calls: 4, warnings: [] });
  });

  test("handoff only, judged by me: no provider calls", async () => {
    const r = await preview({ role: f.role.id, tasks: [f.task.id, task2.id], contenders: [f.handoff.id], judge: "me" });
    expect(r.body.data).toEqual({ outputs: 2, api_calls: 0, handoff_outputs: 2, judge_calls: 0, total_provider_calls: 0, warnings: [] });
  });

  test("mixed, judged by me", async () => {
    const r = await preview({ role: f.role.id, tasks: [f.task.id, task2.id], contenders: [f.handoff.id, C.steady!.id, C.erratic!.id], judge: "me" });
    expect(r.body.data).toEqual({ outputs: 6, api_calls: 4, handoff_outputs: 2, judge_calls: 0, total_provider_calls: 4, warnings: [] });
  });

  test("with a real AI judge, every output (handoff ones too) is a judge call", async () => {
    const api = await preview({ role: role2.id, tasks: [t2a.id, t2b.id], contenders: [C.steady!.id] });
    expect(api.body.data).toMatchObject({ outputs: 2, api_calls: 2, handoff_outputs: 0, judge_calls: 2, total_provider_calls: 4 });
    const ho = await preview({ role: role2.id, tasks: [t2a.id, t2b.id], contenders: [ho2.id], judge: "ai" });
    expect(ho.body.data).toMatchObject({ outputs: 2, api_calls: 0, handoff_outputs: 2, judge_calls: 2, total_provider_calls: 2 });
    const mixed = await preview({ role: role2.id, tasks: [t2a.id, t2b.id], contenders: [ho2.id, C.steady!.id, C.erratic!.id], judge: "ai" });
    expect(mixed.body.data).toMatchObject({ outputs: 6, api_calls: 4, handoff_outputs: 2, judge_calls: 6, total_provider_calls: 10 });
  });

  test("the mock judge's calls are free, so they stay out of the total", async () => {
    const r = await preview({ role: f.role.id, tasks: [f.task.id, task2.id], contenders: [f.handoff.id, C.steady!.id], judge: "ai" });
    expect(r.body.data).toMatchObject({ outputs: 4, api_calls: 2, handoff_outputs: 2, judge_calls: 4, total_provider_calls: 2 });
  });

  test("warnings: the AI judge shares a provider with an API contender, or may share one with a handoff contender", async () => {
    const mock = await preview({ role: f.role.id, tasks: [f.task.id], contenders: [C.steady!.id], judge: "ai" });
    expect(mock.body.data.warnings).toEqual([`The AI judge shares a provider with ${C.steady!.name}.`]);
    const ho = await preview({ role: role2.id, tasks: [t2a.id], contenders: [ho2.id, C.steady!.id] });
    expect(ho.body.data.warnings).toEqual([]);
    const claude = await create(h, "contenders", { name: `Anthropic Claude (manual) ${crypto.randomUUID().slice(0, 6)}`, connection: f.manual.id });
    const hit = await preview({ role: role2.id, tasks: [t2a.id], contenders: [claude.id] });
    expect(hit.body.data.warnings).toEqual([`The AI judge may share a provider with ${claude.name}.`]);
  });

  test("the start route stores the same total as call_count", async () => {
    const r = await post("/runs", { role: f.role.id, tasks: [f.task.id, task2.id], contenders: [f.handoff.id, C.steady!.id], judge: "me" });
    expect(r.body.data.run.call_count).toBe(2);
  });
});

describe("checks and access", () => {
  test("a task from another role, a turned-off contender, or nothing chosen is refused", async () => {
    const other = await create(h, "roles", { workspace: f.workspace.id, name: "Other", rubric: [{ name: "X", weight: 100 }] });
    const foreign = await create(h, "tasks", { role: other.id, title: "Elsewhere", prompt: "<p>x</p>" });
    expect((await post("/runs", { role: f.role.id, tasks: [foreign.id], contenders: [C.steady!.id] })).status).toBe(422);
    const off = await mockContender("Mock Off", "steady", { enabled: false });
    const r = await post("/runs", { role: f.role.id, tasks: [f.task.id], contenders: [off.id] });
    expect(r.status).toBe(422);
    expect(r.body.error).toContain("turned off");
    expect((await post("/runs", { role: f.role.id, tasks: [], contenders: [C.steady!.id] })).status).toBe(422);
    expect((await post("/runs", { role: f.role.id, tasks: [f.task.id], contenders: [] })).status).toBe(422);
    expect((await post("/runs", { role: "missing", tasks: [f.task.id], contenders: [C.steady!.id] })).status).toBe(404);
    expect((await post("/runs/preview", { role: f.role.id, tasks: [f.task.id], contenders: [C.steady!.id], judge: "robot" })).status).toBe(422);
    // A refused start leaves nothing behind and locks nothing.
    expect((await h.api("owner", "GET", `/api/v1/contenders/${off.id}`)).body.data.locked).toBe(false);
    expect((await h.api("owner", "GET", `/api/v1/tasks/${foreign.id}`)).body.data.locked).toBe(false);
  });

  test("only the owner can use the run routes", async () => {
    const body = { role: f.role.id, tasks: [f.task.id], contenders: [C.steady!.id] };
    for (const as of ["anon", "admin"] as const) {
      expect((await post("/runs", body, as)).status).toBeOneOf([401, 403]);
      expect((await post("/runs/preview", body, as)).status).toBeOneOf([401, 403]);
      expect((await post(`/runs/${firstRun.id}/again`, {}, as)).status).toBeOneOf([401, 403]);
      expect((await h.api(as, "GET", `/api/custom/runs/${firstRun.id}`)).status).toBeOneOf([401, 403]);
      expect((await h.api(as, "DELETE", `/api/custom/connections/${f.mock.id}/key`)).status).toBeOneOf([401, 403]);
    }
    expect((await h.api("owner", "GET", `/api/custom/runs/missing`)).status).toBe(404);
  });

  test("the owner can't create runs or attempts through REST", async () => {
    expect((await h.api("owner", "POST", "/api/v1/runs", { role: f.role.id, judge: "me", status: "done" })).status).not.toBe(200);
    expect((await h.api("owner", "POST", "/api/v1/attempts", { run: firstRun.id, task: f.task.id, contender: C.steady!.id })).status).not.toBe(200);
  });
});

describe("DELETE /connections/:id/key", () => {
  test("removes the stored key and turns has_key off", async () => {
    const conn = await create(h, "connections", { name: `Keyed ${crypto.randomUUID().slice(0, 6)}`, provider: "anthropic" });
    expect((await h.api("owner", "POST", "/api/v1/connection_keys", { connection: conn.id, api_key: "sk-test-fake-1" })).status).toBe(200);
    await Bun.sleep(300); // after-hooks run after the response
    expect((await h.api("owner", "GET", `/api/v1/connections/${conn.id}`)).body.data.has_key).toBe(true);

    const r = await h.api("owner", "DELETE", `/api/custom/connections/${conn.id}/key`);
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ connection: conn.id, has_key: false, removed: true });
    expect(JSON.stringify(r.body)).not.toContain("sk-test-fake-1");
    expect((await h.sql(`SELECT id FROM vb_connection_keys WHERE connection = ?`, [conn.id])).length).toBe(0);
    expect((await h.api("owner", "GET", `/api/v1/connections/${conn.id}`)).body.data.has_key).toBe(false);
    // A new key can be added afterwards (the replace flow).
    expect((await h.api("owner", "POST", "/api/v1/connection_keys", { connection: conn.id, api_key: "sk-test-fake-2" })).status).toBe(200);
    // Deleting when there's no key is fine; an unknown connection is 404.
    expect((await h.api("owner", "DELETE", `/api/custom/connections/${f.mock.id}/key`)).body.data.removed).toBe(false);
    expect((await h.api("owner", "DELETE", `/api/custom/connections/missing/key`)).status).toBe(404);
  });

  test("the worker reads the key server-side (and the owner still can't)", async () => {
    const conn = await create(h, "connections", { name: `Keyed2 ${crypto.randomUUID().slice(0, 6)}`, provider: "openai-compatible", base_url: "https://127.0.0.1:1/v1" });
    expect((await h.api("owner", "POST", "/api/v1/connection_keys", { connection: conn.id, api_key: "sk-test-fake-3" })).status).toBe(200);
    const c = await create(h, "contenders", { name: `Local ${crypto.randomUUID().slice(0, 6)}`, connection: conn.id, model: "m" });
    const r = await post("/runs", { role: f.role.id, tasks: [f.task.id], contenders: [c.id], judge: "me" });
    const view = await settle(r.body.data.run.id);
    // With a key it gets as far as the network, where Vaultbase's denylist stops loopback (F3).
    expect(view.attempts[0].status).toBe("failed");
    expect(view.attempts[0].error).not.toContain("no API key");
    expect(view.attempts[0].error.toLowerCase()).toContain("egress");
    expect(JSON.stringify(view)).not.toContain("sk-test-fake-3");
  });
});
