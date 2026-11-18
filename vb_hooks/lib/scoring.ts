// Scoring (TECH-SPEC §10): the weighted score, star checks, the blind order,
// the blind payload, and the verdict hooks of §6. Pure apart from
// the hook functions, which take the hook context. No "vaultbase" import here
// (TECH-SPEC F7), so `bun test` can import this file directly.
import { createHash } from "node:crypto";
import { insertRecord, isTrusted, updateRecord, type Records, type Sql, type Store } from "./store.ts";
import { listOf, parseJson, type Criterion } from "./validation.ts";
import { htmlToText } from "./handoff.ts";
import { refreshRunStatus } from "./runs.ts";
import { ensureOutcomeCheck } from "./outcomes.ts";
import { methodOf, overrideOtherPicks, pairSides, pairVerdicts, record as pairRecord, type PairPick, type Winner } from "./pairwise.ts";

export interface Score { stars: number; reason?: string }
export type Scores = Record<string, Score>;

/** Σ(stars × weight) / Σ(weight), rounded to two decimals, on the 1 to 5 scale. */
export function weightedScore(scores: Scores, rubric: Criterion[]): number {
  let num = 0;
  let den = 0;
  for (const c of rubric) {
    const s = scores[c.name];
    if (!s) throw new Error(`weightedScore: no stars for "${c.name}"`);
    num += s.stars * c.weight;
    den += c.weight;
  }
  if (den === 0) throw new Error("weightedScore: the rubric has no weight");
  return Math.round((num / den) * 100) / 100;
}

/**
 * Every rubric criterion has whole stars from 1 to 5, and nothing else is
 * scored. Returns an error for the owner, or null.
 */
export function scoresError(raw: unknown, rubric: Criterion[]): string | null {
  const scores = parseJson(raw);
  if (!scores || typeof scores !== "object" || Array.isArray(scores)) return "Give stars for each criterion.";
  const s = scores as Record<string, unknown>;
  const names = new Set(rubric.map((c) => c.name));
  for (const k of Object.keys(s)) if (!names.has(k)) return `"${k}" is not a criterion of this role's rubric.`;
  for (const c of rubric) {
    const v = s[c.name] as Partial<Score> | undefined;
    if (!v || typeof v !== "object") return `Give stars for "${c.name}".`;
    if (typeof v.stars !== "number" || !Number.isInteger(v.stars) || v.stars < 1 || v.stars > 5) {
      return `Stars for "${c.name}" must be a whole number from 1 to 5.`;
    }
    if (v.reason !== undefined && v.reason !== null && typeof v.reason !== "string") return `The reason for "${c.name}" must be text.`;
  }
  return null;
}

/** Keep only { stars, reason? } per criterion, in rubric order. */
export function cleanScores(raw: unknown, rubric: Criterion[]): Scores {
  const s = parseJson(raw) as Record<string, Score>;
  const out: Scores = {};
  for (const c of rubric) {
    const v = s[c.name]!;
    out[c.name] = typeof v.reason === "string" && v.reason.trim() ? { stars: v.stars, reason: v.reason.trim() } : { stars: v.stars };
  }
  return out;
}

/** The blind sort key: SHA-256 of run id + task id + attempt id. */
export function blindKey(runId: string, taskId: string, attemptId: string): string {
  return createHash("sha256").update(`${runId}${taskId}${attemptId}`).digest("hex");
}

/** A, B, …, Z, AA, AB, … */
export function label(i: number): string {
  let s = "";
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** Shuffled but stable: sorted by blindKey, then labelled A, B, C, … */
export function blindOrder<T extends { id: string }>(runId: string, taskId: string, attempts: T[]): Array<{ attempt: T; label: string }> {
  return attempts
    .map((a) => ({ a, k: blindKey(runId, taskId, a.id) }))
    .sort((x, y) => (x.k < y.k ? -1 : x.k > y.k ? 1 : 0))
    .map(({ a }, i) => ({ attempt: a, label: label(i) }));
}

// ── verdicts ─────────────────────────────────────────────────────────────────

/** Mark every other active verdict on the attempt overridden, and the attempt judged. */
export async function activateVerdict(store: Store, attemptId: string, verdictId: string): Promise<void> {
  const { sql } = store;
  const others = await sql.query<{ id: string }>(
    `SELECT id FROM vb_verdicts WHERE attempt = ? AND status = 'active' AND id != ? AND COALESCE(method, 'rubric') = 'rubric'`, [attemptId, verdictId],
  );
  for (const o of others) await updateRecord(store, "verdicts", o.id, { status: "overridden" });
  const a = await sql.queryOne<{ status: string; run: string | null }>(`SELECT status, run FROM vb_attempts WHERE id = ?`, [attemptId]);
  if (a && a.status !== "judged" && a.status !== "failed") await updateRecord(store, "attempts", attemptId, { status: "judged" });
  if (a?.run) await refreshRunStatus(store, a.run);
  // Phase 2a: a role with "check the outcome after N days" gets its check now.
  await ensureOutcomeCheck(store, attemptId);
}

/** Store an AI verdict from the judge worker, and make it the active one. */
export async function storeAiVerdict(store: Store, v: {
  attempt: string; run: string; judgeContender: string; scores: Scores; rubric: Criterion[];
}): Promise<{ id: string; status: "active" | "overridden" }> {
  // A human verdict that is already there wins: the AI one is kept as history.
  const human = await store.sql.queryOne(`SELECT id FROM vb_verdicts WHERE attempt = ? AND status = 'active' AND judge_kind = 'human' AND COALESCE(method, 'rubric') = 'rubric'`, [v.attempt]);
  const status = human ? "overridden" : "active";
  const id = await insertRecord(store, "verdicts", {
    attempt: v.attempt, run: v.run, method: "rubric", judge_kind: "ai", judge_contender: v.judgeContender,
    scores: v.scores, rubric_snapshot: v.rubric, score: weightedScore(v.scores, v.rubric), status,
  });
  // Done here, not left to verdicts-after-create (which skips server writes):
  // after-hooks run in the background, and the worker's result must be final.
  if (status === "active") await activateVerdict(store, v.attempt, id);
  return { id, status };
}

/**
 * Store an AI pick from the judge worker for one pair (Compare). A pick the
 * owner already made for the pair wins: the AI's is kept as history.
 */
export async function storeAiPick(store: Store, v: {
  left: string; right: string; run: string; judgeContender: string; winner: Winner; reason: string;
}): Promise<{ id: string; status: "active" | "overridden" }> {
  const human = await store.sql.queryOne(
    `SELECT id FROM vb_verdicts WHERE method = 'pairwise' AND status = 'active' AND judge_kind = 'human'
       AND ((attempt = ? AND opponent = ?) OR (attempt = ? AND opponent = ?))`, [v.left, v.right, v.right, v.left]);
  const status = human ? "overridden" : "active";
  const id = await insertRecord(store, "verdicts", {
    attempt: v.left, opponent: v.right, run: v.run, method: "pairwise", judge_kind: "ai", judge_contender: v.judgeContender,
    winner: v.winner, scores: v.reason ? { reason: v.reason } : null, status,
  });
  if (status === "active") {
    await overrideOtherPicks(store, id, v.left, v.right);
    await refreshRunStatus(store, v.run);
  }
  return { id, status };
}

type Rec = Record<string, unknown>;
export interface VerdictCtx {
  record: Rec;
  existing: Rec | null;
  auth: { id: string; type: "user" | "admin"; collection?: string } | null;
  helpers: { abort(message: string): never; find(collection: string, id: string): Promise<Rec | null>; sql: Sql; records: Records };
}

/**
 * verdicts beforeCreate (TECH-SPEC §6). The owner creates human rubric
 * verdicts only: the hook fills run, rubric_snapshot, score and status, and
 * checks the stars. The admin (seeding, F12) and the judge worker
 * (storeAiVerdict) are let through as written.
 */
export async function verdictBeforeCreate(ctx: VerdictCtx): Promise<void> {
  if (isTrusted(ctx.auth)) return;
  const r = ctx.record;
  const { abort, find } = ctx.helpers;
  const attempt = await find("attempts", String(r["attempt"] ?? ""));
  if (!attempt) abort("That output does not exist.");
  if (attempt!["status"] !== "submitted" && attempt!["status"] !== "judged") abort("Only a submitted output can be judged.");
  const run = attempt!["run"] ? await find("runs", String(attempt!["run"])) : null;
  if (!run) abort("That output has no run.");
  if (methodOf(run) === "compare") return pairBeforeCreate(ctx, attempt!, run!);
  const role = await find("roles", String(run!["role"]));
  if (!role) abort("That run's role does not exist.");
  const rubric = parseJson(role!["rubric"]) as Criterion[];
  const err = scoresError(r["scores"], rubric);
  if (err) abort(err);
  const scores = cleanScores(r["scores"], rubric);
  r["judge_kind"] = "human";
  r["method"] = "rubric";
  r["judge_contender"] = null;
  r["run"] = run!["id"];
  r["scores"] = scores;
  r["rubric_snapshot"] = rubric.map((c) => ({ name: c.name, weight: c.weight, guidance: c.guidance ?? "" }));
  r["score"] = weightedScore(scores, rubric);
  r["status"] = "active";
  r["opponent"] = null;
  r["winner"] = null;
  r["due_at"] = null;
}

/**
 * An owner's pick on a Compare run: `attempt` against `opponent`, both
 * outputs of the same task in this run, and `winner` is "this", "opponent"
 * or "tie". An optional one-line reason goes in scores.reason.
 */
async function pairBeforeCreate(ctx: VerdictCtx, attempt: Rec, run: Rec): Promise<void> {
  const r = ctx.record;
  const { abort, find } = ctx.helpers;
  const opponentId = String(r["opponent"] ?? "");
  if (!opponentId) abort("Pick the output to compare it with.");
  if (opponentId === attempt["id"]) abort("Compare an output with another one, not with itself.");
  const opponent = await find("attempts", opponentId);
  if (!opponent || opponent["run"] !== attempt["run"] || opponent["task"] !== attempt["task"]) abort("Both outputs must be from the same run and task.");
  if (opponent!["status"] !== "submitted" && opponent!["status"] !== "judged") abort("Only a submitted output can be judged.");
  const winner = r["winner"];
  if (winner !== "this" && winner !== "opponent" && winner !== "tie") abort("Pick the better output, or call it a tie.");
  const raw = parseJson(r["scores"]) as { reason?: unknown } | null;
  const reason = typeof raw?.reason === "string" ? raw.reason.trim().slice(0, 500) : "";
  r["judge_kind"] = "human";
  r["method"] = "pairwise";
  r["judge_contender"] = null;
  r["run"] = run["id"];
  r["scores"] = reason ? { reason } : null;
  r["rubric_snapshot"] = null;
  r["score"] = null;
  r["status"] = "active";
  r["due_at"] = null;
}

/**
 * verdicts afterCreate: the new verdict is the active one, and the output is
 * judged. Server writes are skipped: storeAiVerdict activates its own verdict
 * before the worker finishes, and this hook runs in the background.
 */
export async function verdictAfterCreate(ctx: VerdictCtx): Promise<void> {
  if (!ctx.auth) return;
  const r = ctx.record;
  if (r["status"] !== "active" || !r["attempt"] || !r["id"]) return;
  if (r["method"] === "pairwise") {
    await overrideOtherPicks(ctx.helpers, String(r["id"]), String(r["attempt"]), String(r["opponent"]));
    await refreshRunStatus(ctx.helpers, String(r["run"]));
    return;
  }
  await activateVerdict(ctx.helpers, String(r["attempt"]), String(r["id"]));
}

// ── the blind judging payload (TECH-SPEC §10) ────────────────────────────────

/** Keys the blind payload must never hold: they can reveal who made an output. */
export const BLIND_FORBIDDEN_KEYS = [
  "contender", "contenders", "contender_name", "judge_contender", "connection", "provider", "model", "group", "mode",
  "tokens", "tokens_in", "tokens_out", "time", "duration_ms", "cost", "metrics_source", "finish_reason", "prompt_sent",
];

export interface BlindDeps {
  sql: Sql;
  find(collection: string, id: string): Promise<Rec | null>;
}

/** `<prefix>-<n>.<ext>`, n from 1 in upload order, keeping the original extension (lower case). */
export function neutralName(prefix: string, index: number, original: string): string {
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(original);
  return `${prefix}-${index + 1}${m ? `.${m[1]!.toLowerCase()}` : ""}`;
}

export interface BlindFile { name: string; url: string; mime: string; is_image: boolean }

const asList = listOf;

/** The judging screen's data for one run and task, or null when either is missing. */
export async function blindPayload(deps: BlindDeps, runId: string, taskId: string) {
  const { sql, find } = deps;
  const run = await find("runs", runId);
  if (!run) return null;
  const task = await find("tasks", taskId);
  if (!task) return null;
  const role = await find("roles", String(run["role"]));
  const rubric = ((role ? parseJson(role["rubric"]) : []) as Criterion[]).map((c) => ({ name: c.name, weight: c.weight, guidance: c.guidance ?? "" }));

  const attempts = await sql.query<{ id: string; status: string; output: string | null; output_files: string | null }>(
    `SELECT id, status, output, output_files FROM vb_attempts WHERE run = ? AND task = ? AND status != 'failed'`, [runId, taskId],
  );
  if (!attempts.length) {
    // A task that isn't in this run.
    const inRun = asList(run["tasks"]).includes(taskId);
    if (!inRun) return null;
  }
  const ids = attempts.map((a) => a.id);
  const marks = ids.map(() => "?").join(", ");
  const files = ids.length
    ? await sql.query<{ record_id: string; filename: string; original_name: string; mime_type: string }>(
      `SELECT record_id, filename, original_name, mime_type FROM vaultbase_files WHERE field_name = 'output_files' AND record_id IN (${marks})`, ids)
    : [];
  const verdicts = ids.length
    ? await sql.query<{ id: string; attempt: string; judge_kind: string; scores: string; score: number; status: string; created_at: number }>(
      `SELECT id, attempt, judge_kind, scores, score, status, created_at FROM vb_verdicts WHERE attempt IN (${marks}) AND COALESCE(method, 'rubric') = 'rubric' ORDER BY created_at, rowid`, ids)
    : [];

  const outputs = blindOrder(runId, taskId, attempts).map(({ attempt: a, label }) => {
    const meta = new Map(files.filter((f) => f.record_id === a.id).map((f) => [f.filename, f]));
    const fileList: BlindFile[] = asList(a.output_files).map((stored, i) => {
      const m = meta.get(stored);
      const mime = m?.mime_type || "application/octet-stream";
      // A neutral name (A-1.png): an uploaded file's own name could say which tool made it.
      return { name: neutralName(label, i, m?.original_name || stored), url: `/api/v1/files/${stored}`, mime, is_image: mime.startsWith("image/") };
    });
    const mine = verdicts.filter((v) => v.attempt === a.id);
    const active = mine.find((v) => v.status === "active");
    return {
      attempt: a.id,
      label,
      status: a.status,
      output: a.output ?? "",
      files: fileList,
      claims_note: task["output_type"] === "code",
      verdict: active
        ? {
          judge_kind: active.judge_kind,
          scores: parseJson(active.scores) as Scores,
          score: Number(active.score),
          history: mine.map((v) => ({ judge_kind: v.judge_kind, score: Number(v.score), status: v.status })),
        }
        : null,
    };
  });

  const method = methodOf(run);
  const compare = method === "compare" ? await comparePairs(sql, String(run["id"]), outputs) : null;

  return {
    run: { id: String(run["id"]), judge: String(run["judge"]), method, status: String(run["status"]) },
    task: { id: String(task["id"]), title: String(task["title"] ?? ""), prompt_text: htmlToText(String(task["prompt"] ?? "")), output_type: String(task["output_type"] ?? "text") },
    rubric,
    outputs: compare ? outputs.map((o) => ({ ...o, record: compare.records.get(o.attempt)! })) : outputs,
    ...(compare ? { pairs: compare.pairs } : {}),
  };
}

const READY = new Set(["submitted", "judged"]);
export type Side = "left" | "right" | "tie";

/**
 * Compare runs: every pair of the task's outputs in label order (A vs B,
 * A vs C, B vs C, …), each with its sides shuffled by pairSides, its active
 * pick and the pick history; and each output's wins, ties and losses.
 * Picks are told as "left", "right" or "tie", never by attempt.
 */
async function comparePairs(sql: Sql, runId: string, outputs: Array<{ attempt: string; label: string; status: string }>) {
  const picks = await pairVerdicts(sql, outputs.map((o) => o.attempt));
  const side = (p: PairPick, left: string): Side => (p.winner === "tie" ? "tie" : (p.winner === "this") === (p.attempt === left) ? "left" : "right");
  const reason = (p: PairPick) => String((parseJson(p.scores) as { reason?: string } | null)?.reason ?? "");
  const by = new Map(outputs.map((o) => [o.attempt, o]));
  const pairs = [];
  for (let i = 0; i < outputs.length; i++) {
    for (let j = i + 1; j < outputs.length; j++) {
      const [l, r] = pairSides(runId, outputs[i]!.attempt, outputs[j]!.attempt);
      const left = by.get(l)!, right = by.get(r)!;
      const mine = picks.filter((p) => (p.attempt === l && p.opponent === r) || (p.attempt === r && p.opponent === l));
      const active = mine.find((p) => p.status === "active");
      pairs.push({
        left: left.label, right: right.label, left_attempt: l, right_attempt: r,
        ready: READY.has(left.status) && READY.has(right.status),
        pick: active ? { judge_kind: active.judge_kind, winner: side(active, l), reason: reason(active) } : null,
        history: mine.map((p) => ({ judge_kind: p.judge_kind, winner: side(p, l), status: p.status })),
      });
    }
  }
  const records = new Map(outputs.map((o) => [o.attempt, pairRecord(o.attempt, picks)]));
  return { pairs, records };
}
