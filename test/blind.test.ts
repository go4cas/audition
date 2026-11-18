// GET /api/custom/judging/:runId/:taskId is blind (TECH-SPEC §10): the
// payload never holds a key or value that could tell who made an output,
// its order is shuffled but stable, and failed outputs are left out.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { boot, RUBRIC, type Harness } from "./harness.ts";
import { aiRun, attach, enqueueJudge, testImage, until } from "./t3-helpers.ts";
import { BLIND_FORBIDDEN_KEYS, blindKey } from "../vb_hooks/lib/scoring.ts";

let h: Harness;
let s: Awaited<ReturnType<typeof aiRun>>;
beforeAll(async () => {
  h = await boot();
  s = await aiRun(h);
  // Judge half of them, so verdicts are in the payload too.
  for (const a of s.attempts.filter((x) => x.status === "submitted" && x.task === s.task.id)) await enqueueJudge(h, a.id);
  await until(async () => {
    const r = await judging(s.run, s.task.id);
    return r.body.outputs?.every((o: { verdict: unknown }) => o.verdict);
  }, "verdicts on the first task");
});
afterAll(async () => { await h?.cleanup(); });

// Custom routes answer { data } (lib/runs.ts, ownerRoute); errors stay { error, code }.
const judging = async (runId: string, taskId: string, as: "owner" | "admin" | "anon" = "owner") => {
  const r = await h.api(as, "GET", `/api/custom/judging/${runId}/${taskId}`);
  return r.status === 200 ? { ...r, body: r.body.data } : r;
};

/** Every key and every string value anywhere in a JSON value. */
function walk(v: unknown, keys: string[] = [], values: string[] = []): { keys: string[]; values: string[] } {
  if (Array.isArray(v)) v.forEach((x) => walk(x, keys, values));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { keys.push(k); walk(x, keys, values); }
  else if (typeof v === "string") values.push(v);
  return { keys, values };
}

test("Done-when 3: no forbidden key, and no contender's name or id, anywhere in the payload", async () => {
  const contenders = (await h.api("owner", "GET", "/api/v1/contenders?perPage=200")).body.data as Array<{ id: string; name: string }>;
  const connections = (await h.api("owner", "GET", "/api/v1/connections?perPage=200")).body.data as Array<{ id: string; name: string }>;
  // Names and ids. (A model id can appear in an output's own text, as the
  // mock image's file names do; that is the output, not the payload.)
  const secrets = [
    ...contenders.flatMap((c) => [c.id, c.name]),
    ...connections.flatMap((c) => [c.id, c.name]),
  ].filter(Boolean);
  for (const task of s.tasks) {
    const r = await judging(s.run, task.id);
    expect(r.status).toBe(200);
    const { keys, values } = walk(r.body);
    for (const k of BLIND_FORBIDDEN_KEYS) expect(keys, `key ${k}`).not.toContain(k);
    for (const k of ["contender", "connection", "model", "group", "mode", "tokens", "time", "cost"]) {
      expect(keys.filter((x) => x.includes(k)), `keys like ${k}`).toEqual([]);
    }
    for (const sec of secrets) {
      for (const v of values) expect(v.includes(sec), `"${sec}" in "${v.slice(0, 80)}"`).toBe(false);
    }
  }
});

test("the payload has the run, the task as text, the rubric, and labelled outputs", async () => {
  const r = (await judging(s.run, s.task.id)).body;
  expect(r.run).toEqual({ id: s.run, judge: "ai", method: "rate", status: "judging" });
  expect(r.task).toEqual({ id: s.task.id, title: "Compare options", prompt_text: "Compare three options.", output_type: "text" });
  expect(r.rubric).toEqual(RUBRIC);
  expect(r.outputs.map((o: { label: string }) => o.label)).toEqual(["A", "B", "C"]);
  const img = r.outputs.find((o: { files: unknown[] }) => o.files.length > 0);
  expect(img.files[0]).toMatchObject({ name: `${img.label}-1.png`, mime: "image/png", is_image: true });
  expect(img.files[0].url).toMatch(/^\/api\/v1\/files\/[0-9a-f-]{36}\.png$/);
  // The file URL serves the image to the owner.
  const res = await fetch(`${h.url}${img.files[0].url}`, { headers: { authorization: `Bearer ${h.ownerToken}` } });
  expect(res.status).toBe(200);
  for (const o of r.outputs) {
    expect(o.status).toBe("judged");
    expect(o.claims_note).toBe(false);
    expect(o.verdict.judge_kind).toBe("ai");
    expect(o.verdict.history).toEqual([{ judge_kind: "ai", score: o.verdict.score, status: "active" }]);
    expect(Object.keys(o.verdict.scores)).toEqual(["Accuracy", "Clarity"]);
  }
  // Not yet judged on the second task.
  const r2 = (await judging(s.run, s.task2.id)).body;
  for (const o of r2.outputs) { expect(o.status).toBe("submitted"); expect(o.verdict).toBeNull(); }
});

test("failed outputs are left out, and the order is by SHA-256 of run + task + attempt, stable across calls", async () => {
  const one = (await judging(s.run, s.task.id)).body;
  const two = (await judging(s.run, s.task.id)).body;
  expect(two).toEqual(one);
  const ids = one.outputs.map((o: { attempt: string }) => o.attempt);
  const expected = s.attempts.filter((a) => a.task === s.task.id && a.status !== "failed").map((a) => a.id)
    .sort((x, y) => (blindKey(s.run, s.task.id, x) < blindKey(s.run, s.task.id, y) ? -1 : 1));
  expect(ids).toEqual(expected);
  expect(ids).not.toContain(s.attempts.find((a) => a.status === "failed")!.id);
});

test("uploaded file names are replaced by neutral ones (A-1.png), so a name can't say which tool made it", async () => {
  const run = await h.store("insert", "runs", { workspace: s.workspace.id, role: s.role.id, tasks: [s.task.id], contenders: [s.handoff.id], judge: "me", status: "judging", call_count: 0 });
  const id = await h.store("insert", "attempts", { run, task: s.task.id, contender: s.handoff.id, mode: "handoff", status: "submitted", output: "See files" });
  await attach(h, id, "chatgpt-image.PNG", "image/png", testImage(0));
  await attach(h, id, "Midjourney notes", "text/plain", new TextEncoder().encode("hi"));
  await attach(h, id, "perplexity-sources.pdf", "application/pdf", new TextEncoder().encode("%PDF-1.4"));
  const r = (await judging(run, s.task.id)).body;
  expect(r.outputs[0].files.map((f: { name: string }) => f.name)).toEqual(["A-1.png", "A-2", "A-3.pdf"]);
  const text = JSON.stringify(r).toLowerCase();
  for (const word of ["chatgpt", "midjourney", "perplexity"]) expect(text).not.toContain(word);
});

test("code tasks carry the claims note", async () => {
  const task = await h.api("owner", "POST", "/api/v1/tasks", { role: s.role.id, title: "Build it", prompt: "<p>Build.</p>", output_type: "code" });
  const run = await h.store("insert", "runs", { workspace: s.workspace.id, role: s.role.id, tasks: [task.body.data.id], contenders: [s.contender.id], judge: "me", status: "judging", call_count: 1 });
  await h.store("insert", "attempts", { run, task: task.body.data.id, contender: s.contender.id, mode: "api", status: "submitted", output: "Done. Tests: 3 passed." });
  const r = (await judging(run, task.body.data.id)).body;
  expect(r.outputs[0].claims_note).toBe(true);
});

test("only the owner; unknown runs and tasks are 404", async () => {
  expect((await judging(s.run, s.task.id, "anon")).status).toBeOneOf([401, 403]);
  expect((await judging(s.run, s.task.id, "admin")).status).toBe(403);
  expect((await judging("nope", s.task.id)).status).toBe(404);
  expect((await judging(s.run, "nope")).status).toBe(404);
  const other = await h.api("owner", "POST", "/api/v1/tasks", { role: s.role.id, title: "Not in the run", prompt: "<p>x</p>" });
  expect((await judging(s.run, other.body.data.id)).status).toBe(404);
});
