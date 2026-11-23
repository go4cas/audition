// GET /api/custom/leaderboard/:roleId and POST /api/custom/castings on a
// fresh Vaultbase (TECH-SPEC §7, §11).
import { afterAll, beforeAll, expect, test } from "bun:test";
import { boot, create, RUBRIC, type Harness } from "./harness.ts";
import { sfx } from "./t3-helpers.ts";
import { CONTENDERS, MIN_OUTPUTS, PASS_MARK, WEIGHTS } from "./golden/leaderboard-input.ts";

let h: Harness;
const golden = await Bun.file(`${import.meta.dir}/golden/leaderboard.json`).json();
beforeAll(async () => { h = await boot(); });
afterAll(async () => { await h?.cleanup(); });

// Custom routes answer { data } (lib/runs.ts, ownerRoute); errors stay { error, code }.
const unwrap = async (p: Promise<any>) => { const r = await p; return r.status === 200 ? { ...r, body: r.body.data } : r; };
const board = (role: string, as: "owner" | "admin" | "anon" = "owner") => unwrap(h.api(as, "GET", `/api/custom/leaderboard/${role}`));
const cast = (body: object) => unwrap(h.api("owner", "POST", "/api/custom/castings", body));

/** A role whose contenders each have the given scored outputs, written as the workers write them. */
async function seedRole(opts: { weights: object; minOutputs: number; passMark: number; contenders: Array<{ name: string; group?: string; manual?: boolean; scores: number[]; tokensIn?: number | null; tokensOut?: number | null; durationMs?: number | null; cost?: number | null }> }) {
  const workspace = await create(h, "workspaces", { name: `WS ${sfx()}`, fitness_weights: opts.weights, min_outputs: opts.minOutputs });
  const role = await create(h, "roles", { workspace: workspace.id, name: "Analyst", rubric: RUBRIC, pass_mark: opts.passMark });
  const task = await create(h, "tasks", { role: role.id, title: "Analyse", prompt: "<p>Analyse.</p>" });
  const mock = await create(h, "connections", { name: `Mock ${sfx()}`, provider: "mock" });
  const manual = await create(h, "connections", { name: `Manual ${sfx()}`, provider: "manual" });
  const ids: Record<string, string> = {};
  for (const c of opts.contenders) {
    const rec = c.manual
      ? await create(h, "contenders", { name: c.name, connection: manual.id, group: c.group })
      : await create(h, "contenders", { name: c.name, connection: mock.id, model: c.group ?? "mock-steady", group: c.group, config: { mock: { behaviour: "steady" } } });
    ids[c.name] = rec.id;
  }
  const run = await h.store("insert", "runs", { workspace: workspace.id, role: role.id, tasks: [task.id], contenders: Object.values(ids), judge: "me", status: "done", call_count: 0 });
  for (const c of opts.contenders) {
    for (const score of c.scores) {
      const a = await h.store("insert", "attempts", {
        run, task: task.id, contender: ids[c.name], mode: c.manual ? "handoff" : "api", status: "judged",
        tokens_in: c.tokensIn ?? null, tokens_out: c.tokensOut ?? null, duration_ms: c.durationMs ?? null, cost: c.cost ?? null,
      });
      await h.store("insert", "verdicts", { attempt: a, run, method: "rubric", judge_kind: "human", scores: {}, rubric_snapshot: RUBRIC, score, status: "active" });
    }
  }
  const names = Object.fromEntries(Object.entries(ids).map(([n, id]) => [id, n]));
  return { workspace, role, task, ids, names };
}

/** Replace contender ids with names, so the board compares with the golden file. */
const byName = (b: any, names: Record<string, string>) => ({
  ...b,
  rows: b.rows.map((r: any) => ({ ...r, contender: names[r.contender] })),
  suggested: b.suggested ? names[b.suggested] : null,
});

test("Done-when 2: seeded verdicts give the golden leaderboard: means, ranges, fitness, terms_used and suggested", async () => {
  const s = await seedRole({ weights: WEIGHTS, minOutputs: MIN_OUTPUTS, passMark: PASS_MARK, contenders: CONTENDERS });
  const r = await board(s.role.id);
  expect(r.status).toBe(200);
  const { casting, history, previous, held_back, ...rest } = r.body;
  expect([casting, history, previous, held_back]).toEqual([null, [], null, null]);
  expect(byName(rest, s.names)).toEqual(golden);
});

test("Done-when 5: one contender without token data drops the tokens term and names it", async () => {
  const s = await seedRole({
    weights: { quality: 70, tokens: 30, time: 0 }, minOutputs: 2, passMark: 3.5,
    contenders: [
      { name: `Mock Steady ${sfx()}`, scores: [4, 4], tokensIn: 100, tokensOut: 300, durationMs: 900 },
      { name: "Codex (manual)", manual: true, scores: [5, 4] },
    ],
  });
  const r = (await board(s.role.id)).body;
  expect(r.terms_used).toEqual(["quality"]);
  expect(r.dropped).toEqual([{ term: "tokens", reason: "Codex (manual) has no token data" }]);
  const codex = r.rows.find((x: any) => s.names[x.contender] === "Codex (manual)");
  expect(codex.mean_tokens).toBeNull();
  expect(codex.mean_time_ms).toBeNull();
  expect(codex.fitness).toBe(0.6125); // 70 × (4.5 − 1) / 4 / 100, tokens left out
});

test("Done-when 6: a champion only at min_outputs and strictly above the pass mark; castings refuse one that doesn't qualify", async () => {
  const s = await seedRole({
    weights: { quality: 100, tokens: 0, time: 0 }, minOutputs: 5, passMark: 3.5,
    contenders: [
      { name: `Good ${sfx()}`, scores: [4, 4, 4, 4, 4] },
      { name: `Fine ${sfx()}`, scores: [4, 4, 4, 4, 3.8] },
      { name: `At the mark ${sfx()}`, scores: [3.5, 3.5, 3.5, 3.5, 3.5] },
      { name: `Too few ${sfx()}`, scores: [5, 5, 5, 5] },
    ],
  });
  const [good, fine, at, few] = Object.values(s.ids);
  const r = (await board(s.role.id)).body;
  expect(r.suggested).toBe(good);
  const q = Object.fromEntries(r.rows.map((x: any) => [x.contender, [x.qualifies, x.enough_data]]));
  expect(q).toEqual({ [good!]: [true, true], [fine!]: [true, true], [at!]: [false, true], [few!]: [false, false] });

  const refusedAt = await cast({ role: s.role.id, contender: at });
  expect(refusedAt.status).toBe(422);
  expect(refusedAt.body.error).toContain("pass mark");
  const refusedFew = await cast({ role: s.role.id, contender: few });
  expect(refusedFew.status).toBe(422);
  expect(refusedFew.body.error).toContain("4 scored outputs");
  expect((await cast({ role: s.role.id, contender: crypto.randomUUID() })).status).toBe(422);
  expect((await cast({ role: s.role.id })).status).toBe(422);

  // A qualifying contender that isn't the suggestion is the owner's own pick.
  const human = await cast({ role: s.role.id, contender: fine, rationale: "  cheaper to run  " });
  expect(human.status).toBe(200);
  expect(human.body.casting).toMatchObject({ role: s.role.id, contender: fine, suggested_by: "human", confirmed: true, rationale: "cheaper to run" });
  await Bun.sleep(1100); // since has 1 s resolution
  const system = await cast({ role: s.role.id, contender: good });
  expect(system.body.casting.suggested_by).toBe("system");

  // The newest confirmed casting is current; older ones stay as history.
  const after = (await board(s.role.id)).body;
  expect(after.casting).toMatchObject({ contender: good, since: system.body.casting.since, trial: true, restored: false });
  expect(after.history.map((c: any) => c.contender)).toEqual([good, fine]);
  expect(after.previous).toBe(fine);
  const all = (await h.api("owner", "GET", `/api/v1/castings?filter=${encodeURIComponent(`role = "${s.role.id}"`)}`)).body.data;
  expect(all.length).toBe(2);
  // The owner can't write castings directly.
  expect((await h.api("owner", "POST", "/api/v1/castings", { role: s.role.id, contender: at, suggested_by: "human", confirmed: true })).status).toBeOneOf([401, 403]);
});

test("Done-when 6: Stock Review's single contender is suggested with five outputs above 3.5", async () => {
  const s = await seedRole({
    weights: { quality: 100, tokens: 0, time: 0 }, minOutputs: 5, passMark: 3.5,
    contenders: [{ name: `Mock Steady ${sfx()}`, scores: [4, 4, 3.6, 4, 4], tokensIn: 100, tokensOut: 300, durationMs: 700 }],
  });
  const only = Object.values(s.ids)[0];
  const r = (await board(s.role.id)).body;
  expect(r.rows.length).toBe(1);
  expect(r.suggested).toBe(only);
  const c = await cast({ role: s.role.id, contender: only });
  expect(c.status).toBe(200);
  expect(c.body.casting.suggested_by).toBe("system");
});

test("a role with no scored outputs has an empty board; only the owner; unknown role is 404", async () => {
  const s = await seedRole({ weights: { quality: 100, tokens: 0, time: 0 }, minOutputs: 5, passMark: 3.5, contenders: [] });
  expect((await board(s.role.id)).body).toEqual({ terms_used: ["quality"], dropped: [], rows: [], suggested: null, casting: null, history: [], previous: null, held_back: null });
  expect((await board(s.role.id, "anon")).status).toBeOneOf([401, 403]);
  expect((await board(s.role.id, "admin")).status).toBe(403);
  expect((await board("nope")).status).toBe(404);
  expect((await board('x" || role != "')).status).toBe(404);
});

test("GET /leaderboards answers every role's board in one request, or one workspace's; only the owner", async () => {
  const a = await seedRole({
    weights: { quality: 100, tokens: 0, time: 0 }, minOutputs: 5, passMark: 3.5,
    contenders: [{ name: `Mock Steady ${sfx()}`, scores: [4, 4, 3.6, 4, 4] }],
  });
  const b = await seedRole({ weights: { quality: 100, tokens: 0, time: 0 }, minOutputs: 5, passMark: 3.5, contenders: [] });
  const all = await unwrap(h.api("owner", "GET", "/api/custom/leaderboards"));
  expect(all.status).toBe(200);
  // The same board as the one-role route.
  expect(all.body[a.role.id]).toEqual((await board(a.role.id)).body);
  expect(all.body[b.role.id]).toEqual((await board(b.role.id)).body);
  expect(all.body[a.role.id].suggested).toBe(Object.values(a.ids)[0]);
  const one = await unwrap(h.api("owner", "GET", `/api/custom/leaderboards?workspace=${a.workspace.id}`));
  expect(Object.keys(one.body)).toEqual([a.role.id]);
  expect((await unwrap(h.api("owner", "GET", `/api/custom/leaderboards?workspace=${encodeURIComponent('x" || id != "')}`))).body).toEqual({});
  expect((await h.api("anon", "GET", "/api/custom/leaderboards")).status).toBeOneOf([401, 403]);
  expect((await h.api("admin", "GET", "/api/custom/leaderboards")).status).toBe(403);
});
