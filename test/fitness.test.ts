// lib/fitness.ts without a server (TECH-SPEC §11): ranges, fitness, the
// dropped terms, who qualifies and the suggested champion.
import { expect, test } from "bun:test";
import { confidenceRange, leaderboard, parseViewRow, t975, type RawRow } from "../vb_hooks/lib/fitness.ts";
import { CONTENDERS, MIN_OUTPUTS, PASS_MARK, WEIGHTS, rawRow } from "./golden/leaderboard-input.ts";

const golden = await Bun.file(`${import.meta.dir}/golden/leaderboard.json`).json();
const QUALITY_ONLY = { quality: 100, tokens: 0, time: 0 };

const row = (name: string, scores: number[], extra: Partial<RawRow> = {}): RawRow => ({
  ...rawRow({ name, group: name, scores, tokensIn: 100, tokensOut: 100, durationMs: 1000, cost: null }), ...extra,
});

test("the seeded set matches the golden JSON: means, ranges, fitness, terms_used and suggested", () => {
  const board = leaderboard(CONTENDERS.map(rawRow), { weights: WEIGHTS, minOutputs: MIN_OUTPUTS, passMark: PASS_MARK });
  expect(board).toEqual(golden);
  // By hand: Alpha Q = 0.75, T = 600/1200, D = 1000/2000, so (45 − 15 − 5) / 100.
  expect(board.rows.find((r) => r.name === "Alpha")!.fitness).toBe(0.25);
  // Alpha's range: sd = √0.4, half = 2.571 × sd / √6 = 0.66.
  expect([board.rows[1]!.ci_low, board.rows[1]!.ci_high]).toEqual([3.34, 4.66]);
});

test("t-table: 1 to 30 degrees of freedom, 1.96 above", () => {
  expect(t975(1)).toBe(12.706);
  expect(t975(4)).toBe(2.776);
  expect(t975(30)).toBe(2.042);
  expect(t975(31)).toBe(1.96);
  expect(() => t975(0)).toThrow();
});

test("no range below two outputs; ranges are clamped to 1 to 5", () => {
  expect(confidenceRange(1, 4, 16)).toBeNull();
  expect(confidenceRange(2, 4.5, 41)).toEqual({ low: 1, high: 5 }); // 4 and 5: half = 12.706 × 0.707 / 1.414
});

test("one contender without token data drops the tokens term and names it", () => {
  const rows = [row("Mock Steady", [4, 4, 4, 4, 4]), row("Codex (manual)", [5, 5, 5, 5, 5], { n_tokens: 0, mean_tokens: null })];
  const board = leaderboard(rows, { weights: { quality: 70, tokens: 30, time: 0 }, minOutputs: 5, passMark: 3.5 });
  expect(board.terms_used).toEqual(["quality"]);
  expect(board.dropped).toEqual([{ term: "tokens", reason: "Codex (manual) has no token data" }]);
  // Weights are not rescaled: quality alone at 70%.
  expect(board.rows.map((r) => [r.name, r.fitness])).toEqual([["Codex (manual)", 0.7], ["Mock Steady", 0.525]]);
  expect(board.rows[0]!.mean_tokens).toBeNull();
});

test("a term with zero weight is neither used nor dropped", () => {
  const rows = [row("A", [4, 4]), row("B", [3, 3], { n_time: 0, mean_time_ms: null })];
  const board = leaderboard(rows, { weights: QUALITY_ONLY, minOutputs: 5, passMark: 3.5 });
  expect(board.terms_used).toEqual(["quality"]);
  expect(board.dropped).toEqual([]);
});

test("two contenders without time data are both named", () => {
  const rows = [row("A", [4]), row("B", [3], { n_time: 0 }), row("C", [3], { n_time: 0 })];
  const board = leaderboard(rows, { weights: { quality: 90, tokens: 0, time: 10 }, minOutputs: 1, passMark: 3.5 });
  expect(board.dropped).toEqual([{ term: "time", reason: "B and C have no time data" }]);
});

test("a champion needs min_outputs and a mean strictly above the pass mark", () => {
  const opts = { weights: QUALITY_ONLY, minOutputs: 5, passMark: 3.5 };
  // Exactly at the pass mark: not suggested.
  expect(leaderboard([row("At", [3, 4, 3, 4, 3.5])], opts).suggested).toBeNull();
  // Four outputs: not enough data yet, however good.
  const four = leaderboard([row("Four", [5, 5, 5, 5])], opts);
  expect(four.suggested).toBeNull();
  expect(four.rows[0]!.enough_data).toBe(false);
  // Stock Review: one contender, five outputs above 3.5, is suggested.
  const stock = leaderboard([row("Mock Steady", [4, 4, 4, 4, 4])], opts);
  expect(stock.suggested).toBe("Mock Steady");
  expect(stock.rows[0]!.qualifies).toBe(true);
});

test("ties go to the higher mean, then more outputs, then the name", () => {
  // Quality only: equal fitness means equal mean, so outputs then name decide.
  const opts = { weights: QUALITY_ONLY, minOutputs: 2, passMark: 3 };
  expect(leaderboard([row("B", [4, 4]), row("A", [4, 4, 4])], opts).suggested).toBe("A");
  expect(leaderboard([row("Bee", [4, 4]), row("Ant", [4, 4])], opts).suggested).toBe("Ant");
  // With tokens: same fitness, the higher mean wins.
  const t = { weights: { quality: 50, tokens: 50, time: 0 }, minOutputs: 2, passMark: 3 };
  // X: Q = 0.75, T = 0.5 → 0.125; Y: Q = 1, T = 1 → 0. Then Z: Q 1, T 0.75 → 0.125, higher mean than X.
  const b = leaderboard([row("X", [4, 4], { mean_tokens: 200 }), row("Y", [5, 5], { mean_tokens: 400 }), row("Z", [5, 5], { mean_tokens: 300 })], t);
  expect(b.rows.map((r) => r.name)).toEqual(["Z", "X", "Y"]);
  expect(b.suggested).toBe("Z");
});

test("view rows arrive as text and are parsed to numbers (O4)", () => {
  const r = parseViewRow({ contender: "c1", n: "2", mean_score: "3.5", sum_sq: "25", n_tokens: "2", mean_tokens: "450", n_time: "0", mean_time_ms: null, n_cost: "0", mean_cost: null }, "Mock", "mock");
  expect(r).toEqual({ contender: "c1", name: "Mock", group: "mock", n: 2, mean_score: 3.5, sum_sq: 25, n_tokens: 2, mean_tokens: 450, n_time: 0, mean_time_ms: null, n_cost: 0, mean_cost: null, n_outcome: 0, mean_outcome: null });
  // Phase 2a: scored outcome checks, parsed the same way.
  expect(parseViewRow({ contender: "c1", n: "1", mean_score: "4", n_outcome: "2", mean_outcome: "3.5" }, "M", "m")).toMatchObject({ n_outcome: 2, mean_outcome: 3.5 });
});
