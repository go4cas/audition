// Guest voters (TECH-SPEC §10b, SPEC "Guest voters"): people without an
// account rate a run's outputs through a link the owner shares.
//
// A guest is a Vaultbase anonymous session in its own auth collection,
// `guests` (POST /api/v1/auth/guests/anonymous). It is never in `users`, so
// every API rule (`collectionName = "users"`) and every owner route
// (isOwner) still refuses it. A guest reads and writes only through the
// routes in routes/guest.ts, which check the link on every call and serve a
// blind ballot: letters, never contenders, models, scores or the owner's
// verdicts.
//
// How guest votes count (Cas, Nov 18 2026, "crowd counts as one judge"): on
// a link the owner switched on, all guest votes on one output, once there are
// CROWD_MIN of them, become one more score for that output in the
// leaderboard view. The crowd never outweighs a judge, however many votes
// arrive. No "vaultbase" import (F7).
import { blindOrder, neutralName } from "./scoring.ts";
import { htmlToText } from "./handoff.ts";
import { methodOf, pairSides, type Method, type Winner } from "./pairwise.ts";
import { RunError } from "./runs.ts";
import { insertRecord, isTrusted, updateRecord, type Records, type Sql } from "./store.ts";
import { listOf, parseJson } from "./validation.ts";

type Rec = Record<string, unknown>;

export const DAY_S = 24 * 60 * 60;
/** A new link's life. */
export const LINK_DAYS = 7;
/** The longest a link can be kept open. */
export const MAX_LINK_DAYS = 30;
/** How many different guests one link takes by default. */
export const DEFAULT_MAX_GUESTS = 50;
/** Guest votes an output needs before the crowd's score counts. */
export const CROWD_MIN = 3;
/** Guest accounts are deleted this long after they were made (the sweep job). */
export const GUEST_KEEP_DAYS = MAX_LINK_DAYS + 1;

const nowS = () => Math.floor(Date.now() / 1000);
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const TOKEN = /^[A-Za-z0-9_-]{20,128}$/;
const READY = ["submitted", "judged"];

/** A guest: an anonymous session of the `guests` collection. */
export function isGuest(auth: { type?: string; collection?: string; anonymous?: boolean } | null | undefined): boolean {
  return auth?.type === "user" && auth.collection === "guests" && auth.anonymous === true;
}

/** An unguessable link token: two random UUIDs, 64 hex characters. */
export function newToken(): string {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
}

// ── guest_links hooks ────────────────────────────────────────────────────────

export interface LinkCtx {
  record: Rec;
  existing: Rec | null;
  auth: { id: string; type: "user" | "admin"; collection?: string } | null;
  helpers: { abort(message: string): never; find(collection: string, id: string): Promise<Rec | null> };
}

const has = (r: Rec, k: string) => Object.prototype.hasOwnProperty.call(r, k);
const empty = (v: unknown) => v === undefined || v === null || v === "";
const toSeconds = (v: unknown): number | null => {
  if (empty(v)) return null;
  if (typeof v === "number") return v > 1e12 ? Math.floor(v / 1000) : Math.floor(v);
  const n = Number(v);
  if (Number.isFinite(n)) return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
};

/**
 * Before a link is made or changed. The server makes the token; the run and
 * token never change; a link is open for at most MAX_LINK_DAYS from now.
 */
export async function linkBeforeWrite(ctx: LinkCtx, now = nowS()): Promise<void> {
  const r = ctx.record;
  const abort = ctx.helpers.abort;
  if (!ctx.existing) {
    if (empty(r["run"]) || !(await ctx.helpers.find("runs", String(r["run"])))) abort("That run does not exist.");
    // Whatever was sent, the server picks the token (the admin may set one, for tests and seeding).
    if (!(isTrusted(ctx.auth) && typeof r["token"] === "string" && TOKEN.test(r["token"]))) r["token"] = newToken();
    if (empty(r["active"])) r["active"] = true;
    if (empty(r["counts"])) r["counts"] = false;
    if (empty(r["max_guests"])) r["max_guests"] = DEFAULT_MAX_GUESTS;
    if (empty(r["expires_at"])) r["expires_at"] = now + LINK_DAYS * DAY_S;
  } else {
    if (has(r, "run") && String(r["run"]) !== String(ctx.existing["run"])) abort("A link stays with its run. Make a new link instead.");
    if (has(r, "token") && String(r["token"]) !== String(ctx.existing["token"])) abort("A link's address can't change. Make a new link instead.");
  }
  if (has(r, "expires_at") || !ctx.existing) {
    const exp = toSeconds(r["expires_at"]);
    if (exp === null) abort("Give the link an end date.");
    if (exp! > now + MAX_LINK_DAYS * DAY_S + 60) abort(`A link can stay open for at most ${MAX_LINK_DAYS} days.`);
  }
  if (has(r, "max_guests") || !ctx.existing) {
    const n = Number(r["max_guests"]);
    if (!Number.isInteger(n) || n < 1 || n > 500) abort("A link takes 1 to 500 guests.");
  }
}

// ── the link a guest opened ──────────────────────────────────────────────────

export interface GuestDeps {
  sql: Sql;
  records: Records;
  find(collection: string, id: string): Promise<Rec | null>;
}

interface LinkRow { id: string; run: string; token: string; active: number | boolean; expires_at: number | null; max_guests: number | null; counts: number | boolean }

const truthy = (v: unknown) => v === true || v === 1 || v === "1" || v === "true";

/**
 * The link behind a token, checked for this guest: open, not past its date,
 * and with room for one more guest (a guest who already voted always gets back in).
 */
export async function openLink(deps: GuestDeps, token: string, guestId: string, now = nowS()): Promise<{ link: LinkRow; run: Rec }> {
  if (!TOKEN.test(token)) throw new RunError(404, "This link doesn't work. Ask the person who sent it for a new one.");
  const link = await deps.sql.queryOne<LinkRow>(
    `SELECT id, run, token, active, expires_at, max_guests, counts FROM vb_guest_links WHERE token = ?`, [token]);
  if (!link) throw new RunError(404, "This link doesn't work. Ask the person who sent it for a new one.");
  if (!truthy(link.active)) throw new RunError(410, "This link has been closed. Thanks for stopping by.");
  if (link.expires_at !== null && Number(link.expires_at) <= now) throw new RunError(410, "This link has expired. Thanks for stopping by.");
  const seen = await deps.sql.queryOne(`SELECT id FROM vb_guest_votes WHERE link = ? AND guest = ? LIMIT 1`, [link.id, guestId]);
  if (!seen) {
    const n = await deps.sql.queryOne<{ n: number }>(`SELECT COUNT(DISTINCT guest) AS n FROM vb_guest_votes WHERE link = ?`, [link.id]);
    if (Number(n?.n ?? 0) >= Number(link.max_guests ?? DEFAULT_MAX_GUESTS)) {
      throw new RunError(410, "This link has all the votes it needs. Thanks for stopping by.");
    }
  }
  const run = await deps.find("runs", link.run);
  if (!run) throw new RunError(404, "This link doesn't work. Ask the person who sent it for a new one.");
  return { link, run };
}

// ── the blind ballot ─────────────────────────────────────────────────────────

interface Out { attempt: string; label: string; output: string; files: Array<{ name: string; mime: string; is_image: boolean; stored: string }> }

/** A task's ready outputs in the run, lettered as the owner's judging screen letters them. */
async function taskOutputs(deps: GuestDeps, runId: string, taskId: string): Promise<Out[]> {
  const attempts = await deps.sql.query<{ id: string; output: string | null; output_files: string | null }>(
    `SELECT id, output, output_files FROM vb_attempts WHERE run = ? AND task = ? AND status IN ('submitted', 'judged')`, [runId, taskId]);
  const ids = attempts.map((a) => a.id);
  const files = ids.length
    ? await deps.sql.query<{ record_id: string; filename: string; original_name: string; mime_type: string }>(
      `SELECT record_id, filename, original_name, mime_type FROM vaultbase_files WHERE field_name = 'output_files' AND record_id IN (${ids.map(() => "?").join(", ")})`, ids)
    : [];
  return blindOrder(runId, taskId, attempts).map(({ attempt: a, label }) => {
    const meta = new Map(files.filter((f) => f.record_id === a.id).map((f) => [f.filename, f]));
    return {
      attempt: a.id,
      label,
      output: a.output ?? "",
      files: listOf(a.output_files).map((stored, i) => {
        const m = meta.get(stored);
        const mime = m?.mime_type || "application/octet-stream";
        return { name: neutralName(label, i, m?.original_name || stored), mime, is_image: mime.startsWith("image/"), stored };
      }),
    };
  });
}

/** Every pair of a task's outputs, sides as the owner sees them. */
function pairsOf(runId: string, outs: Out[]): Array<{ left: Out; right: Out }> {
  const pairs: Array<{ left: Out; right: Out }> = [];
  for (let i = 0; i < outs.length; i++) {
    for (let j = i + 1; j < outs.length; j++) {
      const [l] = pairSides(runId, outs[i]!.attempt, outs[j]!.attempt);
      pairs.push(l === outs[i]!.attempt ? { left: outs[i]!, right: outs[j]! } : { left: outs[j]!, right: outs[i]! });
    }
  }
  return pairs;
}

interface VoteRow { id: string; attempt: string; opponent: string | null; stars: number | null; winner: Winner | null }

const guestVotes = (deps: GuestDeps, runId: string, guestId: string) =>
  deps.sql.query<VoteRow>(`SELECT id, attempt, opponent, stars, winner FROM vb_guest_votes WHERE run = ? AND guest = ?`, [runId, guestId]);

/**
 * GET /guest/:token: what a guest sees. Task titles and prompts, the outputs
 * by letter, the rubric as guidance, and the guest's own votes. Nothing
 * about who made an output, and no one else's votes or verdicts
 * (test/guests.test.ts checks the shape).
 */
export async function ballot(deps: GuestDeps, token: string, guestId: string, now = nowS()) {
  const { link, run } = await openLink(deps, token, guestId, now);
  const runId = String(run["id"]);
  const method: Method = methodOf(run);
  const role = await deps.find("roles", String(run["role"]));
  const rubric = ((role ? parseJson(role["rubric"]) : []) as Array<{ name: string; guidance?: string }> | null ?? [])
    .map((c) => ({ name: String(c.name), guidance: String(c.guidance ?? "") }));
  const mine = await guestVotes(deps, runId, guestId);
  const tasks = [];
  for (const taskId of listOf(run["tasks"])) {
    const task = await deps.find("tasks", taskId);
    if (!task) continue;
    const outs = await taskOutputs(deps, runId, taskId);
    if (!outs.length) continue;
    const show = (o: Out) => ({
      label: o.label,
      output: o.output,
      files: o.files.map((f, i) => ({ name: f.name, mime: f.mime, is_image: f.is_image, url: `/api/custom/guest/${token}/files/${taskId}/${o.label}/${i}` })),
    });
    const base = {
      id: taskId,
      title: String(task["title"] ?? ""),
      prompt_text: htmlToText(String(task["composed_prompt"] || task["prompt"] || "")),
      output_type: String(task["output_type"] ?? "text"),
      outputs: outs.map(show),
    };
    if (method === "compare") {
      tasks.push({
        ...base,
        pairs: pairsOf(runId, outs).map(({ left, right }) => {
          const v = mine.find((x) => (x.attempt === left.attempt && x.opponent === right.attempt) || (x.attempt === right.attempt && x.opponent === left.attempt));
          let pick: "left" | "right" | "tie" | null = null;
          if (v?.winner === "tie") pick = "tie";
          else if (v?.winner) pick = (v.winner === "this") === (v.attempt === left.attempt) ? "left" : "right";
          return { left: left.label, right: right.label, pick };
        }),
      });
    } else {
      tasks.push({
        ...base,
        stars: Object.fromEntries(outs.map((o) => [o.label, mine.find((x) => x.attempt === o.attempt && !x.opponent)?.stars ?? null])),
      });
    }
  }
  return {
    method,
    role: String(role?.["name"] ?? ""),
    rubric,
    expires_at: link.expires_at === null ? null : Number(link.expires_at),
    tasks,
  };
}

// ── voting ───────────────────────────────────────────────────────────────────

export interface VoteBody { task?: unknown; label?: unknown; stars?: unknown; left?: unknown; right?: unknown; pick?: unknown }

/**
 * POST /guest/:token/votes: one star rating ({task, label, stars}) or one
 * pick ({task, left, right, pick}). A guest who votes again on the same
 * output or pair changes their vote; there is one per guest.
 */
export async function castVote(deps: GuestDeps, token: string, guestId: string, body: VoteBody, now = nowS()) {
  const { link, run } = await openLink(deps, token, guestId, now);
  const runId = String(run["id"]);
  const taskId = String(body.task ?? "");
  if (!ID.test(taskId) || !listOf(run["tasks"]).includes(taskId)) throw new RunError(400, "That task isn't part of this vote.");
  const outs = await taskOutputs(deps, runId, taskId);
  const byLabel = (l: unknown) => outs.find((o) => o.label === String(l ?? ""));
  const method = methodOf(run);
  const base = { link: link.id, run: runId, task: taskId, guest: guestId };

  if (method === "rate") {
    const o = byLabel(body.label);
    if (!o) throw new RunError(400, "That output isn't part of this vote.");
    const stars = Number(body.stars);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new RunError(400, "Give 1 to 5 stars.");
    const old = await deps.sql.queryOne<{ id: string }>(
      `SELECT id FROM vb_guest_votes WHERE run = ? AND guest = ? AND attempt = ? AND opponent IS NULL`, [runId, guestId, o.attempt]);
    if (old) await updateRecord(deps, "guest_votes", old.id, { stars, link: link.id });
    else await insertRecord(deps, "guest_votes", { ...base, attempt: o.attempt, stars });
    return { task: taskId, label: o.label, stars };
  }

  const l = byLabel(body.left), r = byLabel(body.right);
  if (!l || !r || l === r) throw new RunError(400, "That pair isn't part of this vote.");
  const pick = String(body.pick ?? "");
  if (!["left", "right", "tie"].includes(pick)) throw new RunError(400, "Pick left, right or about the same.");
  const winner: Winner = pick === "tie" ? "tie" : pick === "left" ? "this" : "opponent";
  const old = await deps.sql.queryOne<{ id: string }>(
    `SELECT id FROM vb_guest_votes WHERE run = ? AND guest = ? AND ((attempt = ? AND opponent = ?) OR (attempt = ? AND opponent = ?))`,
    [runId, guestId, l.attempt, r.attempt, r.attempt, l.attempt]);
  if (old) await updateRecord(deps, "guest_votes", old.id, { attempt: l.attempt, opponent: r.attempt, winner, link: link.id });
  else await insertRecord(deps, "guest_votes", { ...base, attempt: l.attempt, opponent: r.attempt, winner });
  return { task: taskId, left: l.label, right: r.label, pick };
}

/** GET /guest/:token/files/:task/:label/:i: where an output file is kept, for the route to send. */
export async function guestFile(deps: GuestDeps, token: string, guestId: string, taskId: string, label: string, index: number, now = nowS()) {
  const { run } = await openLink(deps, token, guestId, now);
  if (!ID.test(taskId) || !listOf(run["tasks"]).includes(taskId)) throw new RunError(404, "No such file.");
  const o = (await taskOutputs(deps, String(run["id"]), taskId)).find((x) => x.label === label);
  const f = o?.files[index];
  if (!f || !/^[A-Za-z0-9._-]+$/.test(f.stored)) throw new RunError(404, "No such file.");
  return { stored: f.stored, name: f.name, mime: f.mime };
}

// ── what the owner sees ──────────────────────────────────────────────────────

/** The run's links with their guests and votes, for the run page (owner only). */
export async function linkSummary(sql: Sql, runId: string, now = nowS()) {
  const links = await sql.query<LinkRow & { created_at: number }>(
    `SELECT id, run, token, active, expires_at, max_guests, counts, created_at FROM vb_guest_links WHERE run = ? ORDER BY created_at DESC, rowid DESC`, [runId]);
  const out = [];
  for (const l of links) {
    const c = await sql.queryOne<{ guests: number; votes: number }>(
      `SELECT COUNT(DISTINCT guest) AS guests, COUNT(*) AS votes FROM vb_guest_votes WHERE link = ?`, [l.id]);
    const expired = l.expires_at !== null && Number(l.expires_at) <= now;
    const full = Number(c?.guests ?? 0) >= Number(l.max_guests ?? DEFAULT_MAX_GUESTS);
    out.push({
      id: l.id,
      token: l.token,
      active: truthy(l.active),
      counts: truthy(l.counts),
      expires_at: l.expires_at === null ? null : Number(l.expires_at),
      max_guests: Number(l.max_guests ?? DEFAULT_MAX_GUESTS),
      created: Number(l.created_at),
      guests: Number(c?.guests ?? 0),
      votes: Number(c?.votes ?? 0),
      state: !truthy(l.active) ? "closed" : expired ? "expired" : full ? "full" : "open",
    });
  }
  return out;
}

/**
 * The crowd's view of each output of a task, for the owner's judging screen:
 * the guests' average stars (Rate) or their 1-to-5 Compare score, the number
 * of votes, and whether it counts on the leaderboard (a counting link and
 * CROWD_MIN votes or more).
 */
export async function crowdScores(sql: Sql, attemptIds: string[]): Promise<Map<string, { votes: number; score: number | null; counts: boolean }>> {
  const out = new Map<string, { votes: number; score: number | null; counts: boolean }>();
  if (!attemptIds.length) return out;
  const marks = attemptIds.map(() => "?").join(", ");
  const rows = await sql.query<{ attempt: string; opponent: string | null; stars: number | null; winner: Winner | null; counts: number }>(
    `SELECT g.attempt, g.opponent, g.stars, g.winner, l.counts FROM vb_guest_votes g JOIN vb_guest_links l ON l.id = g.link
      WHERE g.attempt IN (${marks}) OR g.opponent IN (${marks})`, [...attemptIds, ...attemptIds]);
  for (const id of attemptIds) {
    const pts: Array<{ v: number; counts: boolean }> = [];
    for (const r of rows) {
      const counts = truthy(r.counts);
      if (!r.opponent && r.attempt === id && r.stars !== null) pts.push({ v: Number(r.stars), counts });
      else if (r.opponent && r.winner && (r.attempt === id || r.opponent === id)) {
        const mineIsThis = r.attempt === id;
        const p = r.winner === "tie" ? 0.5 : (r.winner === "this") === mineIsThis ? 1 : 0;
        pts.push({ v: 1 + 4 * p, counts });
      }
    }
    if (!pts.length) continue;
    const counted = pts.filter((p) => p.counts);
    const avg = (xs: Array<{ v: number }>) => Math.round((xs.reduce((s, x) => s + x.v, 0) / xs.length) * 100) / 100;
    out.set(id, { votes: pts.length, score: avg(pts), counts: counted.length >= CROWD_MIN });
  }
  return out;
}

// ── clean-up ─────────────────────────────────────────────────────────────────

/** Delete guest accounts older than GUEST_KEEP_DAYS (their votes stay, without the guest). */
export async function sweepGuests(deps: { sql: Sql; records: Records }, now = nowS(), max = 500): Promise<number> {
  const old = await deps.sql.query<{ id: string }>(
    `SELECT id FROM vb_guests WHERE created_at < ? ORDER BY created_at LIMIT ?`, [now - GUEST_KEEP_DAYS * DAY_S, max]);
  for (const g of old) await deps.records.delete("guests", g.id);
  return old.length;
}

// ── route wrapper ────────────────────────────────────────────────────────────

/** Run a guest route: a guest session only, RunError mapped to Vaultbase-style errors. */
export async function guestRoute(ctx: { auth: any; set: { status: number } }, fn: (guestId: string) => Promise<unknown>): Promise<unknown> {
  if (!isGuest(ctx.auth)) { ctx.set.status = 403; return { error: "Open the link you were sent to vote.", code: 403 }; }
  try {
    return { data: await fn(String(ctx.auth.id)) };
  } catch (e) {
    if (e instanceof RunError) { ctx.set.status = e.code; return { error: e.message, code: e.code }; }
    throw e;
  }
}
