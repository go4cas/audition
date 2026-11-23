// Leaderboard maths (TECH-SPEC §11): confidence ranges, fitness, who
// qualifies and the suggested champion. Pure, so it is unit-tested without a
// server. Input is the leaderboard view's raw rows for one role.
import type { FitnessWeights } from "./validation.ts";

/** One leaderboard view row, numbers already parsed, plus the contender's name and group. */
export interface RawRow {
  contender: string;
  name: string;
  group: string;
  n: number;
  mean_score: number;
  sum_sq: number;
  n_tokens: number;
  mean_tokens: number | null;
  n_time: number;
  mean_time_ms: number | null;
  n_cost: number;
  mean_cost: number | null;
  /** Phase 2a outcome checks: scored ones only. Never part of quality or fitness. */
  n_outcome?: number;
  mean_outcome?: number | null;
  /** Guest voters: 1 per output where the crowd's score is one of the n scores (TECH-SPEC §10b). */
  n_guest?: number;
}

export interface Row {
  contender: string;
  name: string;
  group: string;
  n: number;
  mean_score: number;
  ci_low: number | null;
  ci_high: number | null;
  mean_tokens: number | null;
  mean_time_ms: number | null;
  mean_cost: number | null;
  fitness: number;
  n_outcome: number;
  mean_outcome: number | null;
  n_guest: number;
  qualifies: boolean;
  enough_data: boolean;
}

export type Term = "quality" | "tokens" | "time";

export interface Board {
  terms_used: Term[];
  dropped: Array<{ term: Term; reason: string }>;
  rows: Row[];
  suggested: string | null;
}

// Two-sided 95% critical values of Student's t, by degrees of freedom 1 to 30.
const T_975 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
  2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086,
  2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042,
];

/** t(0.975, df): the table for 1 to 30, 1.96 above. */
export function t975(df: number): number {
  if (!Number.isInteger(df) || df < 1) throw new Error(`t975: df must be a whole number ≥ 1, got ${df}`);
  return df <= 30 ? T_975[df - 1]! : 1.96;
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
const clamp = (x: number) => Math.min(5, Math.max(1, x));

/** The 95% range of the mean score, clamped to 1 to 5; null below 2 outputs. */
export function confidenceRange(n: number, mean: number, sumSq: number): { low: number; high: number } | null {
  if (n < 2) return null;
  // Rounding in the view can make the variance a hair below zero.
  const variance = Math.max(0, (sumSq - n * mean * mean) / (n - 1));
  const half = (t975(n - 1) * Math.sqrt(variance)) / Math.sqrt(n);
  return { low: round(clamp(mean - half), 2), high: round(clamp(mean + half), 2) };
}

const listNames = (names: string[]) =>
  names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

export function leaderboard(raw: RawRow[], opts: { weights: FitnessWeights; minOutputs: number; passMark: number }): Board {
  const { weights, minOutputs, passMark } = opts;
  const terms_used: Term[] = ["quality"];
  const dropped: Board["dropped"] = [];

  const checkTerm = (term: "tokens" | "time", count: (r: RawRow) => number, what: string): boolean => {
    if (weights[term] <= 0) return false;
    const missing = raw.filter((r) => count(r) < 1).map((r) => r.name);
    if (missing.length) {
      dropped.push({ term, reason: `${listNames(missing)} ${missing.length === 1 ? "has" : "have"} no ${what} data` });
      return false;
    }
    terms_used.push(term);
    return true;
  };
  const useTokens = checkTerm("tokens", (r) => r.n_tokens, "token");
  const useTime = checkTerm("time", (r) => r.n_time, "time");

  const max = (f: (r: RawRow) => number | null) => Math.max(0, ...raw.map((r) => f(r) ?? 0));
  const maxTokens = max((r) => r.mean_tokens);
  const maxTime = max((r) => r.mean_time_ms);

  const rows: Row[] = raw.map((r) => {
    const Q = (r.mean_score - 1) / 4;
    const T = useTokens && maxTokens > 0 ? (r.mean_tokens ?? 0) / maxTokens : 0;
    const D = useTime && maxTime > 0 ? (r.mean_time_ms ?? 0) / maxTime : 0;
    const fitness = (weights.quality * Q - (useTokens ? weights.tokens * T : 0) - (useTime ? weights.time * D : 0)) / 100;
    const ci = confidenceRange(r.n, r.mean_score, r.sum_sq);
    const enough_data = r.n >= minOutputs;
    return {
      contender: r.contender,
      name: r.name,
      group: r.group,
      n: r.n,
      mean_score: round(r.mean_score, 2),
      ci_low: ci?.low ?? null,
      ci_high: ci?.high ?? null,
      mean_tokens: r.n_tokens > 0 && r.mean_tokens !== null ? round(r.mean_tokens, 0) : null,
      mean_time_ms: r.n_time > 0 && r.mean_time_ms !== null ? round(r.mean_time_ms, 0) : null,
      mean_cost: r.n_cost > 0 && r.mean_cost !== null ? round(r.mean_cost, 6) : null,
      fitness: round(fitness, 4),
      n_outcome: r.n_outcome ?? 0,
      mean_outcome: r.n_outcome && r.mean_outcome != null ? round(r.mean_outcome, 2) : null,
      n_guest: r.n_guest ?? 0,
      qualifies: enough_data && r.mean_score > passMark,
      enough_data,
    };
  });

  // Best first: fitness, then mean score, then more outputs, then name.
  rows.sort((a, b) => b.fitness - a.fitness || b.mean_score - a.mean_score || b.n - a.n || a.name.localeCompare(b.name));
  const suggested = rows.find((r) => r.qualifies)?.contender ?? null;
  return { terms_used, dropped, rows, suggested };
}

/** A leaderboard view row as Vaultbase returns it (view columns are text, O4). */
export function parseViewRow(v: Record<string, unknown>, name: string, group: string): RawRow {
  const num = (x: unknown) => (x === null || x === undefined || x === "" ? null : Number(x));
  return {
    contender: String(v["contender"]),
    name,
    group,
    n: num(v["n"]) ?? 0,
    mean_score: num(v["mean_score"]) ?? 0,
    sum_sq: num(v["sum_sq"]) ?? 0,
    n_tokens: num(v["n_tokens"]) ?? 0,
    mean_tokens: num(v["mean_tokens"]),
    n_time: num(v["n_time"]) ?? 0,
    mean_time_ms: num(v["mean_time_ms"]),
    n_cost: num(v["n_cost"]) ?? 0,
    mean_cost: num(v["mean_cost"]),
    n_outcome: num(v["n_outcome"]) ?? 0,
    mean_outcome: num(v["mean_outcome"]),
    n_guest: num(v["n_guest"]) ?? 0,
  };
}

// ── one role's board, as the leaderboard and castings routes serve it ───────

type Rec = Record<string, unknown>;
export interface BoardDeps {
  find(collection: string, id: string): Promise<Rec | null>;
  query(collection: string, opts: { filter?: string; sort?: string; perPage?: number }): Promise<{ data: Rec[] }>;
}

/** One champion change for a role: each Make champion or Restore adds a casting (TECH-SPEC §11a). */
export interface CastingInfo {
  id: string;
  role: string;
  contender: string;
  since: number;
  rationale: string;
  suggested_by: string;
  trial: boolean;
  restored: boolean;
  confirmed: boolean;
}

export interface RoleBoard extends Board {
  /** The current champion: the newest confirmed casting. */
  casting: CastingInfo | null;
  /** Every champion change, newest first (the current one first). */
  history: CastingInfo[];
  /** The champion before the current one, by contender: who Restore brings back. */
  previous: string | null;
  /** Set while the leaderboard holds back a suggestion just after a restore. */
  held_back: { contender: string; since: number } | null;
}

const yes = (v: unknown) => v === true || v === 1 || v === "1" || v === "true";

/** Seconds from a record's created value (unix seconds, unix ms or an ISO date). */
export function toSeconds(v: unknown): number {
  if (typeof v === "number") return v > 1e11 ? Math.floor(v / 1000) : v;
  const n = Number(v);
  if (Number.isFinite(n) && String(v).trim() !== "") return n > 1e11 ? Math.floor(n / 1000) : n;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}

export function castingInfo(r: Rec): CastingInfo {
  return {
    id: String(r["id"]),
    role: String(r["role"]),
    contender: String(r["contender"]),
    since: Number(r["since"]),
    rationale: String(r["rationale"] ?? ""),
    suggested_by: String(r["suggested_by"] ?? ""),
    trial: yes(r["trial"]),
    restored: yes(r["restored"]),
    confirmed: yes(r["confirmed"]),
  };
}

/** The champion before the current one: the newest earlier casting of a different contender. */
export function previousChampion(history: CastingInfo[]): string | null {
  const now = history[0];
  return now ? history.find((c) => c.contender !== now.contender)?.contender ?? null : null;
}

/**
 * Right after a restore, the contender it replaced is not suggested again
 * until a run for the role starts after the restore: the owner's real-world
 * verdict stands until there is new evidence.
 */
export function heldBack(history: CastingInfo[], suggested: string | null, newestRunAt: number | null): { contender: string; since: number } | null {
  const now = history[0];
  if (!now?.restored || !suggested) return null;
  const dropped = history[1]?.contender;
  if (!dropped || dropped !== suggested) return null;
  if (newestRunAt != null && newestRunAt > now.since) return null;
  return { contender: dropped, since: now.since };
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The leaderboard for a role, or null when there is no such role. */
export async function roleBoard(deps: BoardDeps, roleId: string): Promise<RoleBoard | null> {
  if (!ID.test(roleId)) return null;
  const role = await deps.find("roles", roleId);
  if (!role) return null;
  const ws = await deps.find("workspaces", String(role["workspace"]));
  const w = (typeof ws?.["fitness_weights"] === "string" ? JSON.parse(String(ws["fitness_weights"])) : ws?.["fitness_weights"]) as FitnessWeights | null;
  const weights: FitnessWeights = w && typeof w === "object" ? w : { quality: 100, tokens: 0, time: 0 };
  const minOutputs = Number(ws?.["min_outputs"] ?? 5) || 5;
  const passMark = Number(role["pass_mark"] ?? 3.5);

  const view = await deps.query("leaderboard", { filter: `role = "${roleId}"`, perPage: 500 });
  const raw: RawRow[] = [];
  for (const v of view.data) {
    const c = await deps.find("contenders", String(v["contender"]));
    const name = String(c?.["name"] ?? v["contender"]);
    raw.push(parseViewRow(v, name, String(c?.["group"] || c?.["model"] || name)));
  }
  const board = leaderboard(raw, { weights, minOutputs, passMark });

  const casts = await deps.query("castings", { filter: `role = "${roleId}" && confirmed = true`, sort: "-created", perPage: 50 });
  const history = casts.data.map(castingInfo);
  const casting = history[0] ?? null;
  let held: RoleBoard["held_back"] = null;
  if (casting?.restored) {
    const runs = await deps.query("runs", { filter: `role = "${roleId}"`, sort: "-created", perPage: 1 });
    held = heldBack(history, board.suggested, runs.data[0] ? toSeconds(runs.data[0]["created"]) : null);
  }
  return { ...board, suggested: held ? null : board.suggested, casting, history, previous: previousChampion(history), held_back: held };
}

/**
 * Every role's leaderboard in one go (Home, the workspace page), keyed by role
 * id; only one workspace's roles when `workspaceId` is given. One request
 * instead of one per role (NOTES H1).
 */
export async function roleBoards(deps: BoardDeps, workspaceId?: string | null): Promise<Record<string, RoleBoard>> {
  if (workspaceId && !ID.test(workspaceId)) return {};
  const roles = await deps.query("roles", { ...(workspaceId ? { filter: `workspace = "${workspaceId}"` } : {}), perPage: 500 });
  const boards = await Promise.all(roles.data.map((r) => roleBoard(deps, String(r["id"]))));
  const out: Record<string, RoleBoard> = {};
  roles.data.forEach((r, i) => { if (boards[i]) out[String(r["id"])] = boards[i]!; });
  return out;
}
