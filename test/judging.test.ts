// T3 judging on a fresh Vaultbase: the judge worker with the mock judge,
// human verdicts and the override, a judge reply that misses a criterion,
// and the files an image output's judge request carries.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { boot, create, RUBRIC, type Harness } from "./harness.ts";
import { GENERIC_TEMPLATE } from "../seed/reference.ts";
import { aiRun, attach, enqueueJudge, testImage, until } from "./t3-helpers.ts";

let h: Harness;
let s: Awaited<ReturnType<typeof aiRun>>;
beforeAll(async () => { h = await boot(); s = await aiRun(h); });
afterAll(async () => { await h?.cleanup(); });

const get = async (c: string, id: string) => (await h.api("owner", "GET", `/api/v1/${c}/${id}`)).body.data;
const verdictsOf = async (attempt: string) =>
  (await h.api("owner", "GET", `/api/v1/verdicts?filter=${encodeURIComponent(`attempt = "${attempt}"`)}&sort=created`)).body.data as any[];

test("Done-when 1: the mock judge scores every submitted output, the run ends done, and each verdict stores the rubric", async () => {
  const submitted = s.attempts.filter((a) => a.status === "submitted");
  expect(submitted.length).toBe(6);
  expect((await get("runs", s.run)).status).toBe("judging");
  for (const a of submitted) await enqueueJudge(h, a.id);
  await until(async () => (await get("runs", s.run)).status === "done", "the run to be done");

  for (const a of submitted) {
    expect((await get("attempts", a.id)).status).toBe("judged");
    const vs = await verdictsOf(a.id);
    expect(vs.length).toBe(1);
    const v = vs[0];
    expect(v.judge_kind).toBe("ai");
    expect(v.method).toBe("rubric");
    expect(v.status).toBe("active");
    expect(v.judge_contender).toBe(s.judge.id);
    expect(v.run).toBe(s.run);
    expect(v.rubric_snapshot).toEqual(RUBRIC);
    // The mock judge gives every criterion the output's quality marker.
    expect(v.scores).toEqual({ Accuracy: { stars: a.quality, reason: "mock judge" }, Clarity: { stars: a.quality, reason: "mock judge" } });
    expect(v.score).toBe(a.quality);
  }
  // Failed outputs aren't judged.
  for (const a of s.attempts.filter((x) => x.status === "failed")) {
    expect((await get("attempts", a.id)).status).toBe("failed");
    expect((await verdictsOf(a.id)).length).toBe(0);
  }
});

test("a second judge job for an output is a no-op", async () => {
  const a = s.attempts.find((x) => x.status === "submitted")!;
  await enqueueJudge(h, a.id);
  await Bun.sleep(1500);
  expect((await verdictsOf(a.id)).length).toBe(1);
});

test("Done-when 4: an owner verdict on an AI-judged output becomes active, and the AI verdict stays as overridden", async () => {
  const a = s.attempts.find((x) => x.status === "submitted" && x.contender === s.contender.id)!;
  const r = await h.api("owner", "POST", "/api/v1/verdicts", {
    attempt: a.id, judge_kind: "ai", method: "pairwise", score: 5, status: "overridden",
    scores: { Accuracy: { stars: 2, reason: "a factual slip" }, Clarity: { stars: 5 } },
  });
  expect(r.status).toBe(200);
  // The hook decides kind, method, run, rubric snapshot and score, whatever was sent.
  expect(r.body.data.judge_kind).toBe("human");
  expect(r.body.data.method).toBe("rubric");
  expect(r.body.data.status).toBe("active");
  expect(r.body.data.run).toBe(s.run);
  expect(r.body.data.score).toBe(3.2); // (2 × 60 + 5 × 40) / 100
  expect(r.body.data.rubric_snapshot).toEqual(RUBRIC);
  expect(r.body.data.judge_contender).toBeNull();

  const vs = await until(async () => {
    const list = await verdictsOf(a.id);
    return list.find((v) => v.judge_kind === "ai")?.status === "overridden" ? list : null;
  }, "the AI verdict to be overridden");
  expect(vs.map((v) => [v.judge_kind, v.status])).toEqual([["ai", "overridden"], ["human", "active"]]);
  expect((await get("attempts", a.id)).status).toBe("judged");
  expect((await get("runs", s.run)).status).toBe("done");

  // The leaderboard counts the owner's 3.2, not the AI's 4.
  const board = (await h.api("owner", "GET", `/api/custom/leaderboard/${s.role.id}`)).body.data;
  const row = board.rows.find((x: { contender: string }) => x.contender === s.contender.id);
  expect(row.n).toBe(2);
  expect(row.mean_score).toBe(3.6); // (3.2 + 4) / 2
});

test("a later owner verdict replaces the owner's earlier one", async () => {
  const a = s.attempts.find((x) => x.status === "submitted" && x.contender === s.contender.id)!;
  const r = await h.api("owner", "POST", "/api/v1/verdicts", { attempt: a.id, scores: { Accuracy: { stars: 3 }, Clarity: { stars: 3 } } });
  expect(r.status).toBe(200);
  const vs = await until(async () => {
    const list = await verdictsOf(a.id);
    return list.filter((v) => v.status === "active").length === 1 && list.length === 3 ? list : null;
  }, "one active verdict");
  expect(vs.filter((v) => v.status === "overridden").length).toBe(2);
  expect(vs.find((v) => v.status === "active").id).toBe(r.body.data.id);
});

test("human verdicts are checked: every criterion, whole stars 1 to 5, a submitted output", async () => {
  const a = s.attempts.find((x) => x.status === "submitted")!;
  const post = (body: object) => h.api("owner", "POST", "/api/v1/verdicts", body);
  const bad = [
    { attempt: a.id, scores: { Accuracy: { stars: 4 } } },
    { attempt: a.id, scores: { Accuracy: { stars: 6 }, Clarity: { stars: 3 } } },
    { attempt: a.id, scores: { Accuracy: { stars: 3.5 }, Clarity: { stars: 3 } } },
    { attempt: a.id, scores: { Accuracy: { stars: 4 }, Clarity: { stars: 3 }, Style: { stars: 3 } } },
    { attempt: "nope", scores: { Accuracy: { stars: 4 }, Clarity: { stars: 3 } } },
  ];
  for (const b of bad) expect((await post(b)).status, JSON.stringify(b)).toBeOneOf([400, 422]);
  const failed = s.attempts.find((x) => x.status === "failed")!;
  const r = await post({ attempt: failed.id, scores: { Accuracy: { stars: 4 }, Clarity: { stars: 3 } } });
  expect(r.status).toBeOneOf([400, 422]);
  expect(JSON.stringify(r.body)).toContain("submitted");
  // Verdicts can't be edited or deleted by the owner.
  const v = (await verdictsOf(a.id))[0];
  expect((await h.api("owner", "PATCH", `/api/v1/verdicts/${v.id}`, { score: 5 })).status).toBeOneOf([403, 404]);
  expect((await h.api("owner", "DELETE", `/api/v1/verdicts/${v.id}`)).status).toBeOneOf([403, 404]);
});

test("Done-when 8: a judge reply that misses a criterion is retried once, then recorded on the output", async () => {
  const id = await h.store("insert", "attempts", { run: s.run, task: s.task.id, contender: s.erratic.id, mode: "api", status: "submitted", prompt_sent: "P", output: "An answer" });
  const r = await h.api("admin", "POST", "/api/custom/test/judge", { attempt: id, fake: "miss" });
  expect(r.status).toBe(200);
  expect(r.body.data.calls.length).toBe(2);
  expect(r.body.data.result).toEqual({ outcome: "failed", error: 'AI judging failed: the reply missed "Clarity" (after one retry)', tries: 2 });
  const a = await get("attempts", id);
  expect(a.status).toBe("submitted");
  expect(a.error).toBe('AI judging failed: the reply missed "Clarity" (after one retry)');
  expect((await verdictsOf(id)).length).toBe(0);
  // Left for the owner, so the run waits in judging.
  expect((await get("runs", s.run)).status).toBe("judging");
  // The owner judges it by hand, and the run is done again.
  expect((await h.api("owner", "POST", "/api/v1/verdicts", { attempt: id, scores: { Accuracy: { stars: 3 }, Clarity: { stars: 3 } } })).status).toBe(200);
  await until(async () => (await get("runs", s.run)).status === "done", "the run to be done");
});

test("Done-when 9: an image output's judge request carries the images and names an SVG it skipped", async () => {
  const id = await h.store("insert", "attempts", { run: s.run, task: s.task.id, contender: s.image.id, mode: "api", status: "submitted", prompt_sent: "TASK: Draw", output: "Two images" });
  await attach(h, id, "bag.png", "image/png", testImage(0));
  await attach(h, id, "logo.svg", "image/svg+xml", new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"));
  await attach(h, id, "label.png", "image/png", testImage(1));
  const r = await h.api("admin", "POST", "/api/custom/test/judge", { attempt: id, fake: "record" });
  expect(r.status).toBe(200);
  const [call] = r.body.data.calls;
  expect(call.attachments).toEqual([
    { name: "bag.png", mime: "image/png", bytes: testImage(0).byteLength },
    { name: "label.png", mime: "image/png", bytes: testImage(1).byteLength },
  ]);
  expect(call.prompt).toContain("an image `logo.svg` was supplied but could not be shown to you");
  expect(call.prompt).toContain("TASK: Draw");
  expect(call.hasSchema).toBe(true);
  expect(call.system).toContain("strict, fair judge");
  expect(r.body.data.result.outcome).toBe("judged");
});

test("the mock judge adds one star per image to Visual quality, capped at 5", async () => {
  const role = await h.api("owner", "POST", "/api/v1/roles", { workspace: s.workspace.id, name: "Designer", rubric: [{ name: "Matches the brief", weight: 50 }, { name: "Visual quality", weight: 50 }] });
  const run = await h.store("insert", "runs", { workspace: s.workspace.id, role: role.body.data.id, tasks: [s.task.id], contenders: [s.image.id], judge: "ai", judge_contender: s.judge.id, status: "judging", call_count: 2 });
  const id = await h.store("insert", "attempts", { run, task: s.task.id, contender: s.image.id, mode: "api", status: "submitted", prompt_sent: "TASK: Draw", output: "img [[mock-quality:3]]" });
  await attach(h, id, "a.png", "image/png", testImage(0));
  await enqueueJudge(h, id);
  const v = await until(async () => (await verdictsOf(id))[0], "a verdict");
  expect(v.scores["Matches the brief"].stars).toBe(3);
  expect(v.scores["Visual quality"].stars).toBe(4);
  expect(v.score).toBe(3.5);
});

test("Done-when 1, end to end: POST /runs with the AI judge ends done, every submitted output judged by the mock judge", async () => {
  await create(h, "handoff_templates", GENERIC_TEMPLATE, "admin");
  expect((await h.api("owner", "PATCH", `/api/v1/workspaces/${s.workspace.id}`, { judge_contender: s.judge.id })).status).toBe(200);
  const r = await h.api("owner", "POST", "/api/custom/runs", { role: s.role.id, tasks: [s.task.id, s.task2.id], contenders: [s.contender.id, s.erratic.id, s.failing.id], judge: "ai" });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  const runId = r.body.data.run.id;
  await until(async () => (await get("runs", runId)).status === "done", "the started run to be done", 30000);
  const attempts = (await h.api("owner", "GET", `/api/v1/attempts?filter=${encodeURIComponent(`run = "${runId}"`)}&perPage=50`)).body.data as any[];
  expect(attempts.length).toBe(6);
  expect(attempts.filter((a) => a.status === "judged").length).toBe(4);
  expect(attempts.filter((a) => a.status === "failed").length).toBe(2);
  for (const a of attempts.filter((x) => x.status === "judged")) {
    const [v] = await verdictsOf(a.id);
    expect(v.judge_kind).toBe("ai");
    expect(v.rubric_snapshot).toEqual(RUBRIC);
    const marker = Number(/\[\[mock-quality:(\d)\]\]/.exec(a.output)![1]);
    expect(v.score).toBe(marker);
  }
});
