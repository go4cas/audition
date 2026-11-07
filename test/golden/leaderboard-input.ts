// The seeded set behind test/golden/leaderboard.json, used by the unit test
// (test/fitness.test.ts) and the server test (test/leaderboard.test.ts).
// Weights quality 60, tokens 30, time 10; minimum 5 outputs; pass mark 3.5.
export const WEIGHTS = { quality: 60, tokens: 30, time: 10 };
export const MIN_OUTPUTS = 5;
export const PASS_MARK = 3.5;

export interface SeedContender {
  name: string; group: string;
  scores: number[]; tokensIn: number; tokensOut: number; durationMs: number; cost: number | null;
}

export const CONTENDERS: SeedContender[] = [
  // Good and cheap: the suggested champion once tokens and time count.
  { name: "Alpha", group: "alpha-model", scores: [4, 4, 5, 4, 3, 4], tokensIn: 100, tokensOut: 500, durationMs: 1000, cost: 0.01 },
  // Better quality, but twice the tokens and time.
  { name: "Beta", group: "beta-model", scores: [5, 5, 4, 5, 5], tokensIn: 200, tokensOut: 1000, durationMs: 2000, cost: null },
  // The best fitness, but only 3 outputs: not enough data yet.
  { name: "Gamma", group: "gamma-model", scores: [5, 5, 5], tokensIn: 100, tokensOut: 200, durationMs: 500, cost: null },
  // Enough outputs, but at or below the pass mark.
  { name: "Delta", group: "delta-model", scores: [3, 3, 3, 3, 3, 3, 3, 3], tokensIn: 100, tokensOut: 300, durationMs: 800, cost: null },
];

/** The view's raw row for a seeded contender, as lib/fitness.ts reads it. */
export function rawRow(c: SeedContender) {
  const n = c.scores.length;
  return {
    contender: c.name, name: c.name, group: c.group, n,
    mean_score: c.scores.reduce((a, b) => a + b, 0) / n,
    sum_sq: c.scores.reduce((a, b) => a + b * b, 0),
    n_tokens: n, mean_tokens: c.tokensIn + c.tokensOut,
    n_time: n, mean_time_ms: c.durationMs,
    n_cost: c.cost === null ? 0 : n, mean_cost: c.cost,
  };
}
