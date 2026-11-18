// Compare (A vs B) judging (TECH-SPEC §10a). A run's `method` is "rate"
// (stars against the rubric, the default) or "compare": the judge sees two
// outputs of the same task at a time and picks the better one, or a tie.
//
// One pair decision is one verdict: method "pairwise", `attempt` is the
// output shown on the left, `opponent` the one on the right, and `winner`
// is "this" (left), "opponent" (right) or "tie". An output is judged once
// every rival on its task has finished and every pair it is in has an active
// pick. Its score is 1 + 4 × its win share (a tie counts half), so it sits
// on the same 1 to 5 scale as a star score and feeds the same leaderboard
// (the leaderboard view does the sum, schema/snapshot.json).
//
// No "vaultbase" import (F7), and no import of runs.ts or scoring.ts, which
// both import this file.
import { createHash } from "node:crypto";
import { ensureOutcomeCheck } from "./outcomes.ts";
import { updateRecord, type Sql, type Store } from "./store.ts";

export type Method = "rate" | "compare";
export const METHODS: Method[] = ["rate", "compare"];
export type Winner = "this" | "opponent" | "tie";

/** A run's method; runs from before Compare existed have none and are "rate". */
export const methodOf = (run: Record<string, unknown> | null | undefined): Method => (run?.["method"] === "compare" ? "compare" : "rate");

/** n outputs make n × (n − 1) / 2 pairs. */
export const pairCount = (n: number): number => (n < 2 ? 0 : (n * (n - 1)) / 2);

/**
 * Which output of a pair is shown on the left. Shuffled per pair but stable,
 * so the same output isn't always first: judges, people and models alike,
 * tend to favour one side.
 */
export function pairSides(runId: string, x: string, y: string): [string, string] {
  const [lo, hi] = x < y ? [x, y] : [y, x];
  const h = createHash("sha256").update(`${runId}${lo}${hi}`).digest();
  return h[0]! % 2 === 0 ? [lo, hi] : [hi, lo];
}

/** The order-free key of a pair. */
export const pairKey = (x: string, y: string): string => (x < y ? `${x}|${y}` : `${y}|${x}`);

/** 1 + 4 × (wins + ties / 2) / played, two decimals; null when nothing was played. */
export function pairScore(wins: number, ties: number, played: number): number | null {
  if (played <= 0) return null;
  return Math.round((1 + (4 * (wins + ties / 2)) / played) * 100) / 100;
}

export interface PairPick { id: string; attempt: string; opponent: string; winner: Winner; judge_kind: string; status: string; scores: unknown; created_at: number }

/** Every pairwise verdict touching these outputs, oldest first. */
export async function pairVerdicts(sql: Sql, attemptIds: string[]): Promise<PairPick[]> {
  if (!attemptIds.length) return [];
  const marks = attemptIds.map(() => "?").join(", ");
  return sql.query<PairPick>(
    `SELECT id, attempt, opponent, winner, judge_kind, status, scores, created_at FROM vb_verdicts
      WHERE method = 'pairwise' AND (attempt IN (${marks}) OR opponent IN (${marks})) ORDER BY created_at, rowid`,
    [...attemptIds, ...attemptIds]);
}

/** Wins, ties and losses of one output from active picks. */
export function record(attemptId: string, picks: PairPick[]): { wins: number; ties: number; losses: number; played: number; score: number | null } {
  let wins = 0, ties = 0, losses = 0;
  for (const p of picks) {
    if (p.status !== "active") continue;
    const side = p.attempt === attemptId ? "this" : p.opponent === attemptId ? "opponent" : null;
    if (!side) continue;
    if (p.winner === "tie") ties++;
    else if (p.winner === side) wins++;
    else losses++;
  }
  const played = wins + ties + losses;
  return { wins, ties, losses, played, score: pairScore(wins, ties, played) };
}

const IN_FLIGHT = new Set(["queued", "in_progress", "waiting"]);

/**
 * Mark judged every output of a compare run that is ready: all of its task's
 * outputs have finished, and each pair it is in has an active pick. An output
 * whose rivals all failed has nothing to be compared with: it is judged
 * without a score. Called by refreshRunStatus before it works out the run's
 * status, so it runs after every output or verdict change.
 */
export async function settleCompareRun(store: Store, runId: string): Promise<string[]> {
  const { sql } = store;
  const rows = await sql.query<{ id: string; task: string; status: string }>(`SELECT id, task, status FROM vb_attempts WHERE run = ?`, [runId]);
  const byTask = new Map<string, typeof rows>();
  for (const r of rows) byTask.set(r.task, [...(byTask.get(r.task) ?? []), r]);
  const judged: string[] = [];
  for (const list of byTask.values()) {
    if (list.some((a) => IN_FLIGHT.has(a.status))) continue;
    const live = list.filter((a) => a.status === "submitted" || a.status === "judged");
    if (!live.some((a) => a.status === "submitted")) continue;
    const picks = (await pairVerdicts(sql, live.map((a) => a.id))).filter((p) => p.status === "active");
    const decided = new Set(picks.map((p) => pairKey(p.attempt, p.opponent)));
    for (const a of live) {
      if (a.status !== "submitted") continue;
      const done = live.every((b) => b.id === a.id || decided.has(pairKey(a.id, b.id)));
      if (!done) continue;
      await updateRecord(store, "attempts", a.id, { status: "judged" });
      await ensureOutcomeCheck(store, a.id);
      judged.push(a.id);
    }
  }
  return judged;
}

/** Mark every other active pick on the same pair overridden. */
export async function overrideOtherPicks(store: Store, verdictId: string, x: string, y: string): Promise<void> {
  const others = await store.sql.query<{ id: string }>(
    `SELECT id FROM vb_verdicts WHERE method = 'pairwise' AND status = 'active' AND id != ?
       AND ((attempt = ? AND opponent = ?) OR (attempt = ? AND opponent = ?))`, [verdictId, x, y, y, x]);
  for (const o of others) await updateRecord(store, "verdicts", o.id, { status: "overridden" });
}

export interface QueueDeps {
  sql: Sql;
  enqueue(queue: string, payload: unknown, opts?: { uniqueKey?: string }): Promise<unknown>;
}

/**
 * Queue AI judging for an output that was just submitted. Rate: one job for
 * the output. Compare: one job per pair with each rival on the same task
 * that is already in, so every pair is queued once, by whichever of its two
 * outputs came in last (the unique key covers a tie).
 */
export async function queueJudging(deps: QueueDeps, run: Record<string, unknown>, attemptId: string): Promise<number> {
  if (run["judge"] !== "ai") return 0;
  if (methodOf(run) === "rate") {
    await deps.enqueue("judge", { attempt: attemptId }, { uniqueKey: `judge:${attemptId}` });
    return 1;
  }
  const runId = String(run["id"]);
  const rivals = await deps.sql.query<{ id: string }>(
    `SELECT id FROM vb_attempts WHERE run = ? AND id != ? AND status IN ('submitted', 'judged')
        AND task = (SELECT task FROM vb_attempts WHERE id = ?)`, [runId, attemptId, attemptId]);
  for (const r of rivals) {
    const [left, right] = pairSides(runId, attemptId, r.id);
    await deps.enqueue("judge", { attempt: left, opponent: right }, { uniqueKey: `judge:${left}:${right}` });
  }
  return rivals.length;
}
