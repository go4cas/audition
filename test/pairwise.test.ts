// Compare (A vs B) judging on a fresh Vaultbase (TECH-SPEC §10a): the
// per-run method and the workspace default, call counts, the AI judge's one
// call per pair, owner picks and overrides, outputs with no rival, the blind
// payload's pairs, and the leaderboard's win-share score.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { boot, create, fixtures, type Harness } from "./harness.ts";
import { GENERIC_TEMPLATE } from "../seed/reference.ts";
import { pairCount, pairScore, pairSides, record } from "../vb_hooks/lib/pairwise.ts";
import { PAIR_SCHEMA, pairPrompt, parsePairReply } from "../vb_hooks/lib/judge.ts";
import { generate } from "../vb_hooks/lib/providers/mock.ts";
import { BLIND_FORBIDDEN_KEYS } from "../vb_hooks/lib/scoring.ts";
import { until } from "./t3-helpers.ts";

describe("pure parts", () => {
  test("an output's score is 1 + 4 × its win share, a tie counting half", () => {
    expect(pairScore(2, 0, 2)).toBe(5);
    expect(pairScore(0, 0, 2)).toBe(1);
    expect(pairScore(1, 1, 2)).toBe(4);
    expect(pairScore(0, 1, 1)).toBe(3);
    expect(pairScore(1, 0, 3)).toBe(2.33);
    expect(pairScore(0, 0, 0)).toBeNull();
  });
  test("n outputs make n × (n − 1) / 2 pairs", () => {
    expect([0, 1, 2, 3, 4, 6].map(pairCount)).toEqual([0, 0, 1, 3, 6, 15]);
  });
  test("a pair's sides are shuffled but stable, whichever way round it is asked", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const [l, r] = pairSides("run1", `a${i}`, `b${i}`);
      expect(pairSides("run1", `b${i}`, `a${i}`)).toEqual([l, r]);
      seen.add(l[0]!);
    }
    expect(seen.size).toBe(2); // sometimes a first, sometimes b
  });
  test("wins, ties and losses count active picks only, from either side", () => {
    const p = (attempt: string, opponent: string, winner: "this" | "opponent" | "tie", status = "active") =>
      ({ id: "v", attempt, opponent, winner, judge_kind: "human", status, scores: null, created_at: 0 });
    const picks = [p("x", "y", "this"), p("z", "x", "tie"), p("x", "w", "opponent"), p("x", "y", "opponent", "overridden")];
    expect(record("x", picks)).toEqual({ wins: 1, ties: 1, losses: 1, played: 3, score: 3 });
    expect(record("y", picks)).toEqual({ wins: 0, ties: 0, losses: 1, played: 1, score: 1 });
  });
  test("the judge's reply names first, second or tie", () => {
    expect(parsePairReply('{"winner":"first","reason":"clearer"}')).toEqual({ winner: "this", reason: "clearer" });
    expect(parsePairReply('```json\n{"winner":"Second","reason":""}\n```')).toEqual({ winner: "opponent", reason: "" });
    expect(parsePairReply('{"winner":"tie"}')).toEqual({ winner: "tie", reason: "" });
    expect("error" in parsePairReply('{"winner":"A"}')).toBe(true);
    expect("error" in parsePairReply("not json")).toBe(true);
  });
  test("the mock judge picks the output with the higher quality marker", async () => {
    const side = (q: number) => ({ output: `answer [[mock-quality:${q}]]`, shown: [], notes: [] });
    const ask = async (a: number, b: number) => {
      const prompt = pairPrompt({ promptSent: "Do it.", rubric: [{ name: "Accuracy", weight: 100 }], first: side(a), second: side(b) });
      const r = await generate({ model: "m", config: { mock: { behaviour: "judge" } }, maxOutputTokens: 100, prompt, attachments: [], outputSchema: PAIR_SCHEMA, seed: "s" });
      return JSON.parse(r.text).winner;
    };
    expect(await ask(4, 2)).toBe("first");
    expect(await ask(2, 5)).toBe("second");
    expect(await ask(3, 3)).toBe("tie");
  });
});

let h: Harness;
let f: Awaited<ReturnType<typeof fixtures>>;
let task2: Record<string, any>;
let judge: Record<string, any>;
const C: Record<string, Record<string, any>> = {};

const mockContender = (name: string, behaviour: string) =>
  create(h, "contenders", { name: `${name} ${crypto.randomUUID().slice(0, 6)}`, connection: f.mock.id, model: `mock-${behaviour}`, config: { mock: { behaviour } } });
const post = (path: string, body: unknown) => h.api("owner", "POST", `/api/custom${path}`, body);
const get = async (c: string, id: string) => (await h.api("owner", "GET", `/api/v1/${c}/${id}`)).body.data;
const judging = async (run: string, task: string) => (await h.api("owner", "GET", `/api/custom/judging/${run}/${task}`)).body.data;
const attemptsOf = async (run: string) =>
  (await h.api("owner", "GET", `/api/v1/attempts?perPage=200&filter=${encodeURIComponent(`run = "${run}"`)}`)).body.data as any[];
const picksOf = async (run: string) =>
  (await h.api("owner", "GET", `/api/v1/verdicts?perPage=200&sort=created&filter=${encodeURIComponent(`run = "${run}" && method = "pairwise"`)}`)).body.data as any[];
const quality = (a: { output?: string }) => Number(/\[\[mock-quality:(\d)\]\]/.exec(a.output ?? "")?.[1] ?? 3);

beforeAll(async () => {
  h = await boot();
  await create(h, "handoff_templates", GENERIC_TEMPLATE, "admin");
  f = await fixtures(h);
  task2 = await create(h, "tasks", { role: f.role.id, title: "Summarise the findings", prompt: "<p>Summarise.</p>" });
  C.steady = f.contender;
  C.erratic = await mockContender("Mock Erratic", "erratic");
  C.image = await mockContender("Mock Image", "image");
  C.fail = await mockContender("Mock Fail", "fail");
  judge = await mockContender("Mock Judge", "judge");
});
afterAll(async () => { await h?.cleanup(); });

const body = (extra: Record<string, unknown> = {}) => ({
  role: f.role.id, tasks: [f.task.id, task2.id], contenders: [C.steady!.id, C.erratic!.id, C.image!.id, C.fail!.id], ...extra,
});

test("a new workspace rates by default; Compare is its own choice per run or per workspace", async () => {
  expect(f.workspace.default_method).toBe("rate");
  const one = await post("/runs/preview", { ...body({ contenders: [C.steady!.id] }), method: "compare" });
  expect(one.status).toBe(422);
  expect(one.body.error).toContain("at least two contenders");
  expect((await post("/runs/preview", { ...body(), method: "pairs" })).status).toBe(422);
});

test("call count: the AI judge is called once per pair, not once per output", async () => {
  // A non-mock judge, so its calls count towards the total.
  const anthropic = await create(h, "connections", { name: `Anthropic ${crypto.randomUUID().slice(0, 6)}`, provider: "anthropic" });
  const real = await create(h, "contenders", { name: `Claude judge ${crypto.randomUUID().slice(0, 6)}`, connection: anthropic.id, model: "claude-opus-5-5" });
  const r = await h.api("owner", "PATCH", `/api/v1/workspaces/${f.workspace.id}`, { judge_contender: real.id });
  expect(r.status).toBe(200);
  const rate = (await post("/runs/preview", body({ judge: "ai" }))).body.data;
  const compare = (await post("/runs/preview", body({ judge: "ai", method: "compare" }))).body.data;
  expect(rate.judge_calls).toBe(8); // 2 tasks × 4 outputs
  expect(compare.judge_calls).toBe(12); // 2 tasks × 6 pairs of 4
  expect(compare.total_provider_calls).toBe(8 + 12);
  await h.api("owner", "PATCH", `/api/v1/workspaces/${f.workspace.id}`, { judge_contender: judge.id });
});

let aiRun = "";

test("an AI-judged Compare run: one pick per pair, outputs judged, the run done", async () => {
  // The workspace default decides when the body names no method.
  expect((await h.api("owner", "PATCH", `/api/v1/workspaces/${f.workspace.id}`, { default_method: "compare" })).status).toBe(200);
  const r = await post("/runs", body({ judge: "ai" }));
  expect(r.status).toBe(200);
  aiRun = r.body.data.run.id;
  expect((await get("runs", aiRun)).method).toBe("compare");
  await until(async () => (await get("runs", aiRun)).status === "done", "the compare run to be done", 40_000);

  const attempts = await attemptsOf(aiRun);
  const live = attempts.filter((a) => a.status !== "failed");
  expect(live.length).toBe(6);
  for (const a of live) expect(a.status).toBe("judged");
  const picks = await picksOf(aiRun);
  expect(picks.length).toBe(6); // 3 pairs of 3 live outputs, per task
  const by = new Map(attempts.map((a) => [a.id, a]));
  for (const p of picks) {
    expect(p.judge_kind).toBe("ai");
    expect(p.status).toBe("active");
    expect(p.judge_contender).toBe(judge.id);
    expect(p.score).toBeNull();
    const a = by.get(p.attempt)!, o = by.get(p.opponent)!;
    expect(a.task).toBe(o.task);
    // The mock judge follows the quality markers.
    expect(p.winner).toBe(quality(a) > quality(o) ? "this" : quality(o) > quality(a) ? "opponent" : "tie");
    // The pair is stored with the sides it was shown in.
    expect(pairSides(aiRun, a.id, o.id)).toEqual([a.id, o.id]);
  }
});

test("the blind payload lists every pair with its pick, and each output's record; still nothing that names a contender", async () => {
  const p = await judging(aiRun, f.task.id);
  expect(p.run.method).toBe("compare");
  expect(p.outputs.length).toBe(3);
  expect(p.pairs.map((x: any) => [x.left, x.right].sort().join(""))).toEqual(["AB", "AC", "BC"]);
  for (const x of p.pairs) {
    expect(x.ready).toBe(true);
    expect(x.pick.judge_kind).toBe("ai");
    expect(["left", "right", "tie"]).toContain(x.pick.winner);
  }
  for (const o of p.outputs) {
    expect(o.verdict).toBeNull();
    expect(o.record.played).toBe(2);
    expect(o.record.score).toBe(pairScore(o.record.wins, o.record.ties, 2));
  }
  const keys: string[] = [];
  const values: string[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { keys.push(k); walk(x); }
    else if (typeof v === "string") values.push(v);
  };
  walk(p);
  for (const k of BLIND_FORBIDDEN_KEYS) expect(keys).not.toContain(k);
  for (const c of Object.values(C)) for (const v of values) expect(v.includes(c.id) || v.includes(c.name)).toBe(false);
});

test("the leaderboard scores Compare outputs by win share, on the same 1 to 5 scale", async () => {
  const attempts = (await attemptsOf(aiRun)).filter((a) => a.status === "judged");
  const picks = await picksOf(aiRun);
  const board = (await h.api("owner", "GET", `/api/custom/leaderboard/${f.role.id}`)).body.data;
  for (const c of [C.steady!, C.erratic!, C.image!]) {
    const mine = attempts.filter((a) => a.contender === c.id);
    const scores = mine.map((a) => record(a.id, picks).score!);
    const row = board.rows.find((x: any) => x.contender === c.id);
    expect(row.n).toBe(2);
    expect(row.mean_score).toBeCloseTo(scores.reduce((s, x) => s + x, 0) / scores.length, 2);
  }
  expect(board.rows.find((x: any) => x.contender === C.fail!.id)).toBeUndefined();
});

test("the owner's pick on a pair counts, and the AI's stays as history", async () => {
  const p = await judging(aiRun, f.task.id);
  const pair = p.pairs[0];
  const flip = pair.pick.winner === "left" ? "opponent" : "this";
  const r = await h.api("owner", "POST", "/api/v1/verdicts", {
    attempt: pair.left_attempt, opponent: pair.right_attempt, winner: flip, judge_kind: "ai", score: 5, scores: { reason: "  I prefer it  " },
  });
  expect(r.status).toBe(200);
  expect(r.body.data.method).toBe("pairwise");
  expect(r.body.data.judge_kind).toBe("human");
  expect(r.body.data.score).toBeNull();
  expect(r.body.data.scores).toEqual({ reason: "I prefer it" });
  const after = await until(async () => {
    const q = await judging(aiRun, f.task.id);
    const x = q.pairs.find((y: any) => y.left_attempt === pair.left_attempt && y.right_attempt === pair.right_attempt);
    return x.pick.judge_kind === "human" ? x : null;
  }, "the owner's pick to count");
  expect(after.pick.winner).toBe(flip === "this" ? "left" : "right");
  expect(after.history.map((x: any) => [x.judge_kind, x.status])).toEqual([["ai", "overridden"], ["human", "active"]]);
  expect((await get("runs", aiRun)).status).toBe("done");

  // A second AI job for the pair doesn't replace the owner's pick.
  await h.api("admin", "POST", "/api/custom/test/enqueue", { queue: "judge", payload: { attempt: pair.left_attempt, opponent: pair.right_attempt } });
  await Bun.sleep(1200);
  expect((await picksOf(aiRun)).filter((v) => [v.attempt, v.opponent].sort().join() === [pair.left_attempt, pair.right_attempt].sort().join()).length).toBe(2);
});

test("an owner pick must name another output of the same run and task, and a winner", async () => {
  const live = (await attemptsOf(aiRun)).filter((a) => a.status === "judged");
  const [a, b] = live.filter((x) => x.task === f.task.id);
  const other = live.find((x) => x.task === task2.id)!;
  const bad = async (data: Record<string, unknown>, msg: string) => {
    const r = await h.api("owner", "POST", "/api/v1/verdicts", data);
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.body)).toContain(msg);
  };
  await bad({ attempt: a.id, scores: { Accuracy: { stars: 3 }, Clarity: { stars: 3 } } }, "Pick the output to compare it with.");
  await bad({ attempt: a.id, opponent: a.id, winner: "tie" }, "not with itself");
  await bad({ attempt: a.id, opponent: other.id, winner: "tie" }, "same run and task");
  await bad({ attempt: a.id, opponent: b.id, winner: "both" }, "call it a tie");
});

test("judged by me: the run waits for my picks; an output whose rivals all failed is judged without a score", async () => {
  const r = await post("/runs", { role: f.role.id, tasks: [f.task.id], contenders: [C.steady!.id, C.erratic!.id, C.fail!.id], judge: "me", method: "compare" });
  expect(r.status).toBe(200);
  const run = r.body.data.run.id;
  await until(async () => (await get("runs", run)).status === "judging", "outputs to be ready for me");
  const p = await judging(run, f.task.id);
  expect(p.pairs.length).toBe(1);
  expect(p.pairs[0].pick).toBeNull();
  const x = p.pairs[0];
  const v = await h.api("owner", "POST", "/api/v1/verdicts", { attempt: x.left_attempt, opponent: x.right_attempt, winner: "tie" });
  expect(v.status).toBe(200);
  await until(async () => (await get("runs", run)).status === "done", "the run to be done");
  for (const a of (await attemptsOf(run)).filter((y) => y.status !== "failed")) expect(a.status).toBe("judged");

  // Run again keeps the method.
  const again = await post(`/runs/${run}/again`, {});
  expect(again.status).toBe(200);
  expect((await get("runs", again.body.data.run.id)).method).toBe("compare");

  // A lone survivor: its only rival failed.
  const lone = await post("/runs", { role: f.role.id, tasks: [task2.id], contenders: [C.steady!.id, C.fail!.id], judge: "me", method: "compare" });
  expect(lone.status).toBe(200);
  await until(async () => (await get("runs", lone.body.data.run.id)).status === "done", "the lone run to be done");
  const [survivor] = (await attemptsOf(lone.body.data.run.id)).filter((y) => y.status !== "failed");
  expect(survivor.status).toBe("judged");
  expect((await judging(lone.body.data.run.id, task2.id)).outputs[0].record).toEqual({ wins: 0, ties: 0, losses: 0, played: 0, score: null });
});

test("on a Rate run the pair fields are ignored: the run's method decides", async () => {
  const r = await post("/runs", { role: f.role.id, tasks: [f.task.id], contenders: [C.steady!.id, C.erratic!.id], judge: "me", method: "rate" });
  const run = r.body.data.run.id;
  await until(async () => (await get("runs", run)).status === "judging", "outputs to be ready");
  const [a, b] = await attemptsOf(run);
  const v = await h.api("owner", "POST", "/api/v1/verdicts", { attempt: a.id, opponent: b.id, winner: "this", scores: { Accuracy: { stars: 4 }, Clarity: { stars: 4 } } });
  expect(v.status).toBe(200);
  expect(v.body.data.method).toBe("rubric");
  expect(v.body.data.opponent).toBeNull();
  expect(v.body.data.winner).toBeNull();
  expect((await judging(run, f.task.id)).pairs).toBeUndefined();
});
