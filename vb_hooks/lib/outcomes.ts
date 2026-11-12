// Outcome checks (docs/PHASE-2A.md, part 3): "was the call right N days
// later?". A role with outcome_after_days gets one outcome verdict per output
// when the output is first judged: method "outcome", due_at set, no score.
// On its due date it is listed (home page, daily email); the owner scores it
// with one star question. The leaderboard shows outcomes in their own column.
// No "vaultbase" import (F7).
import { insertRecord, updateRecord, type Sql, type Store } from "./store.ts";

// The same neutral file names as the judging screen (lib/scoring.ts), kept
// here so this file and scoring.ts don't import each other.
interface BlindFile { name: string; url: string; mime: string; is_image: boolean }
const neutralName = (prefix: string, index: number, original: string) => {
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(original);
  return `${prefix}-${index + 1}${m ? `.${m[1]!.toLowerCase()}` : ""}`;
};

type Rec = Record<string, any>;

export const DAY_S = 24 * 60 * 60;
export const OUTCOME_QUESTION = "Was the call right?";
const nowS = () => Math.floor(Date.now() / 1000);

/**
 * Create the output's outcome check when its role asks for one and it has
 * none yet. Called whenever a rubric verdict becomes active (lib/scoring.ts),
 * so an owner override never adds a second check.
 */
export async function ensureOutcomeCheck(store: Store, attemptId: string, now = nowS()): Promise<string | null> {
  const { sql } = store;
  const row = await sql.queryOne<{ run: string; days: number | null }>(
    `SELECT a.run AS run, ro.outcome_after_days AS days
       FROM vb_attempts a JOIN vb_runs r ON r.id = a.run JOIN vb_roles ro ON ro.id = r.role
      WHERE a.id = ?`, [attemptId]);
  const days = Number(row?.days ?? 0);
  if (!row || !(days >= 1)) return null;
  const existing = await sql.queryOne(`SELECT id FROM vb_verdicts WHERE attempt = ? AND method = 'outcome'`, [attemptId]);
  if (existing) return null;
  return insertRecord(store, "verdicts", {
    attempt: attemptId, run: row.run, method: "outcome", judge_kind: "human", status: "active",
    due_at: now + days * DAY_S,
  });
}

export interface OutcomeDue {
  id: string;
  due_at: number;
  role: string;
  role_name: string;
  workspace_name: string;
  task: string;
  task_title: string;
  run: string;
  judged_score: number | null;
  output: string;
  files: BlindFile[];
}

/**
 * Outcome checks that are due and not scored yet, oldest first. Blind like
 * judging: the output and its files, never who made it.
 */
export async function dueOutcomes(sql: Sql, now = nowS(), opts: { since?: number } = {}): Promise<OutcomeDue[]> {
  const rows = await sql.query<Rec>(
    `SELECT v.id, v.due_at, v.run, a.id AS attempt, a.output, a.output_files, t.id AS task, t.title AS task_title,
            ro.id AS role, ro.name AS role_name, w.name AS workspace_name,
            (SELECT j.score FROM vb_verdicts j WHERE j.attempt = a.id AND j.status = 'active' AND COALESCE(j.method, 'rubric') = 'rubric' LIMIT 1) AS judged_score
       FROM vb_verdicts v
       JOIN vb_attempts a ON a.id = v.attempt
       JOIN vb_tasks t ON t.id = a.task
       JOIN vb_runs r ON r.id = a.run
       JOIN vb_roles ro ON ro.id = r.role
       JOIN vb_workspaces w ON w.id = ro.workspace
      WHERE v.method = 'outcome' AND v.status = 'active' AND v.score IS NULL
        AND v.due_at <= ? AND v.due_at > ?
      ORDER BY v.due_at, v.rowid`, [now, opts.since ?? 0]);
  const out: OutcomeDue[] = [];
  for (const r of rows) {
    const names = parseList(r["output_files"]);
    const meta = names.length
      ? await sql.query<{ filename: string; original_name: string; mime_type: string }>(
        `SELECT filename, original_name, mime_type FROM vaultbase_files WHERE field_name = 'output_files' AND record_id = ?`, [r["attempt"]])
      : [];
    const files = names.map((stored, i) => {
      const m = meta.find((x) => x.filename === stored);
      const mime = m?.mime_type || "application/octet-stream";
      return { name: neutralName("Output", i, m?.original_name || stored), url: `/api/v1/files/${stored}`, mime, is_image: mime.startsWith("image/") };
    });
    out.push({
      id: String(r["id"]), due_at: Number(r["due_at"]), role: String(r["role"]), role_name: String(r["role_name"] ?? ""),
      workspace_name: String(r["workspace_name"] ?? ""), task: String(r["task"]), task_title: String(r["task_title"] ?? ""),
      run: String(r["run"]), judged_score: r["judged_score"] == null ? null : Number(r["judged_score"]),
      output: String(r["output"] ?? ""), files,
    });
  }
  return out;
}

export class OutcomeError extends Error {
  constructor(readonly code: number, message: string) { super(message); }
}

/** Score a due outcome check: 1 to 5 stars and an optional one-line note. Once only. */
export async function scoreOutcome(store: Store, id: string, body: unknown, now = nowS()): Promise<Rec> {
  const b = (body ?? {}) as { stars?: unknown; note?: unknown };
  const stars = Number(b.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new OutcomeError(422, "Give 1 to 5 stars.");
  if (b.note !== undefined && b.note !== null && typeof b.note !== "string") throw new OutcomeError(422, "The note must be text.");
  const note = String(b.note ?? "").trim().slice(0, 300);
  const v = await store.sql.queryOne<Rec>(`SELECT id, method, score, due_at, status FROM vb_verdicts WHERE id = ?`, [id]);
  if (!v || v["method"] !== "outcome") throw new OutcomeError(404, "That outcome check does not exist.");
  if (v["score"] != null) throw new OutcomeError(409, "This outcome is already scored.");
  if (Number(v["due_at"]) > now) throw new OutcomeError(409, "This outcome check isn't due yet.");
  return updateRecord(store, "verdicts", id, {
    score: stars,
    scores: { [OUTCOME_QUESTION]: { stars, reason: note } },
    rubric_snapshot: [{ name: OUTCOME_QUESTION, weight: 100, guidance: "Judged on what happened after the due date." }],
  });
}

/** The daily email's text, or null when nothing came due. */
export function dueEmail(due: OutcomeDue[], link: string): { subject: string; body: string } | null {
  if (!due.length) return null;
  const lines = due.map((d) => `- ${d.role_name} (${d.workspace_name}): ${d.task_title}`);
  return {
    subject: `Audition: ${due.length} outcome check${due.length === 1 ? "" : "s"} due`,
    body: `${due.length === 1 ? "This call is" : "These calls are"} ready to check. ${OUTCOME_QUESTION}\n\n${lines.join("\n")}\n\nCheck them here: ${link}\n`,
  };
}

function parseList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v.startsWith("[")) { try { return (JSON.parse(v) as unknown[]).map(String); } catch { return []; } }
  return typeof v === "string" && v ? [v] : [];
}
