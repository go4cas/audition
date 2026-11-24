// Phase 2a, living arena lite (docs/PHASE-2A.md): the stale-attempt sweep,
// repeating runs on a schedule, and emails to the owner. Jobs, hooks, routes
// and the repeat worker are thin wrappers around these functions. No
// "vaultbase" import (F7).
import { roleBoard, type BoardDeps } from "./fitness.ts";
import { refreshRunStatus, rerunPlan, RunError, startRun, type Deps, type PromptForTask } from "./runs.ts";
import { claimRecord, updateRecord, type Sql } from "./store.ts";

type Rec = Record<string, any>;

// ── Email to the owner ───────────────────────────────────────────────────────

export interface Mailer {
  sql: Sql;
  email(opts: { to: string; subject: string; body: string }): Promise<void>;
  log(...args: unknown[]): void;
  /** Vaultbase's helpers.notify: an inbox row (realtime) plus push to every enabled provider. */
  notify?(userId: string, payload: { title: string; body: string; data?: Record<string, unknown> }): Promise<unknown>;
}

/** What one alert says: the email's subject and text, and a short push version. */
export interface Alert {
  type: "run-finished" | "repeat-skipped" | "outcomes-due" | "trial-ended";
  subject: string;
  body: string;
  push: { title: string; body: string; page: string };
}

/** The single owner's user id (the first account in users). */
export async function ownerId(sql: Sql): Promise<string | null> {
  const row = await sql.queryOne<{ id: string }>(`SELECT id FROM vb_users ORDER BY created_at, rowid LIMIT 1`);
  return row?.id ?? null;
}

/** The single owner's email address (the first account in users). */
export async function ownerEmail(sql: Sql): Promise<string | null> {
  const row = await sql.queryOne<{ email: string }>(`SELECT email FROM vb_users ORDER BY created_at, rowid LIMIT 1`);
  return row?.email ?? null;
}

/** A link into the app: Vaultbase's app.url setting plus the page, or the bare page. */
export async function appLink(sql: Sql, page: string): Promise<string> {
  let base = "";
  try {
    const row = await sql.queryOne<{ value: string }>(`SELECT value FROM vaultbase_settings WHERE key = 'app.url'`);
    base = String(row?.value ?? "").replace(/\/+$/, "");
  } catch { /* no settings table access: the bare page will do */ }
  return `${base}${page}`;
}

/**
 * Email the owner through Vaultbase's SMTP settings. Never throws: with SMTP
 * not set up (EmailNotConfiguredError) or any send error, it logs one line and
 * returns false, so a run or a job never fails because of an email.
 */
export async function emailOwner(m: Mailer, subject: string, body: string): Promise<boolean> {
  try {
    const to = await ownerEmail(m.sql);
    if (!to) { m.log("email skipped: no owner account"); return false; }
    await m.email({ to, subject, body });
    m.log(`email sent: ${subject}`);
    return true;
  } catch (e) {
    const name = (e as { name?: string })?.name ?? "";
    const msg = e instanceof Error ? e.message : String(e);
    m.log(name === "EmailNotConfiguredError" || /not configured/i.test(msg)
      ? `email skipped (SMTP is not set up): ${subject}`
      : `email failed: ${subject}: ${msg}`);
    return false;
  }
}

/**
 * Push an alert to the owner through Vaultbase's helpers.notify: a row in the
 * notifications inbox (the app's bell, live over realtime) and a push to every
 * provider turned on in the admin (Settings, Notifications). Never throws;
 * without notifications set up, Vaultbase skips both and this logs one line.
 */
export async function pushOwner(m: Mailer, a: Alert): Promise<boolean> {
  if (!m.notify) return false;
  try {
    const id = await ownerId(m.sql);
    if (!id) { m.log("push skipped: no owner account"); return false; }
    const url = await appLink(m.sql, a.push.page);
    const out = await m.notify(id, { title: a.push.title, body: a.push.body, data: { type: a.type, page: a.push.page, url } }) as
      { inboxRowId?: string | null; enqueued?: unknown[] } | undefined;
    const sent = !!out?.inboxRowId || (out?.enqueued?.length ?? 0) > 0;
    m.log(sent ? `push sent: ${a.push.title}` : `push skipped (notifications are not set up): ${a.push.title}`);
    return sent;
  } catch (e) {
    m.log(`push failed: ${a.push.title}: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

/** Alert the owner: the email and the push, each on its own, neither ever throws. */
export async function alertOwner(m: Mailer, a: Alert): Promise<{ email: boolean; push: boolean }> {
  const email = await emailOwner(m, a.subject, a.body);
  const push = await pushOwner(m, a);
  return { email, push };
}

// ── Stale-attempt sweep ──────────────────────────────────────────────────────

/** An API output in progress this long has lost its worker (queues.timeout_ms is 15 minutes). */
export const STALE_IN_PROGRESS_S = 20 * 60;
/** An API output still queued this long was never picked up. */
export const STALE_QUEUED_S = 60 * 60;
export const TIMED_OUT = "Timed out: Audition got no answer for this output, so it stopped waiting. Use Run again for a fresh one.";

/**
 * Fail API outputs that are stuck, then refresh their runs' status. Handoff
 * outputs (waiting for you) are never touched. The writes go through the
 * records API, so record history shows each one as system.
 */
export async function sweepStale(deps: Deps, nowS = Math.floor(Date.now() / 1000)): Promise<{ failed: string[] }> {
  const rows = await deps.sql.query<{ id: string; run: string; status: string }>(
    `SELECT id, run, status FROM vb_attempts
      WHERE mode = 'api'
        AND ((status = 'in_progress' AND updated_at < ?) OR (status = 'queued' AND created_at < ?))
      ORDER BY rowid`,
    [nowS - STALE_IN_PROGRESS_S, nowS - STALE_QUEUED_S]);
  const runs = new Set<string>();
  const failed: string[] = [];
  for (const r of rows) {
    // Only if it hasn't moved since the read: a worker that claims or
    // finishes it in between keeps its result (helpers.records { filter }).
    const rec = await claimRecord(deps, "attempts", r.id, `status = ${JSON.stringify(r.status)}`, { status: "failed", error: TIMED_OUT });
    if (!rec) continue;
    failed.push(r.id);
    runs.add(r.run);
  }
  for (const run of runs) await refreshRunStatus(deps, run);
  return { failed };
}

// ── Repeating a run on a schedule ────────────────────────────────────────────

export interface CronHelpers {
  add(opts: { name: string; schedule: string; code: string }): Promise<{ id: string }>;
  remove(name: string): Promise<boolean>;
}

export const repeatJobName = (runId: string) => `repeat-${runId}`;

/** The runtime job's code: put one repeat of this run on the repeat queue. */
export function repeatJobCode(runId: string): string {
  const id = JSON.stringify(runId);
  return `await ctx.helpers.enqueue("repeat", { run: ${id} }, { uniqueKey: "repeat:" + ${id} + ":" + ctx.scheduledAt });`;
}

const MIN = "([0-5]?[0-9])";
const HOUR = "(1?[0-9]|2[0-3])";
// Only what the Repeat dialog makes: daily, weekly on one day, monthly on one date.
const SHAPES = [
  new RegExp(`^${MIN} ${HOUR} \\* \\* \\*$`),
  new RegExp(`^${MIN} ${HOUR} \\* \\* [0-6]$`),
  new RegExp(`^${MIN} ${HOUR} ([1-9]|1[0-9]|2[0-8]) \\* \\*$`),
];

/** True for a schedule Audition accepts (at most daily, so a repeat can't run up a bill). */
export function scheduleOk(schedule: string): boolean {
  return SHAPES.some((re) => re.test(schedule.trim()));
}

/**
 * Set or clear a run's repeat. Setting needs a done run and a daily, weekly or
 * monthly schedule; it creates (or replaces) a Vaultbase cron job named
 * repeat-<run id>. Clearing removes the job. runs.schedule holds the cron text.
 */
export async function setSchedule(deps: Deps, cron: CronHelpers, runId: string, schedule: string | null): Promise<Rec> {
  const run = await deps.find("runs", runId);
  if (!run) throw new RunError(404, "That run does not exist.");
  const s = (schedule ?? "").trim();
  if (!s) {
    await cron.remove(repeatJobName(runId));
    await updateRecord(deps, "runs", runId, { schedule: "" });
    return { ...run, schedule: "" };
  }
  if (run["rerun_of"] && (await deps.find("runs", String(run["rerun_of"])))?.["schedule"]) {
    throw new RunError(409, "This run is a repeat of a run that already repeats. Change the schedule on that run.");
  }
  if (run["status"] !== "done") throw new RunError(409, "A run can repeat once it is done.");
  if (!scheduleOk(s)) throw new RunError(422, "Choose every day, every week on one day, or every month on a date from 1 to 28.");
  await cron.add({ name: repeatJobName(runId), schedule: s, code: repeatJobCode(runId) });
  await updateRecord(deps, "runs", runId, { schedule: s });
  return { ...run, schedule: s };
}

/**
 * One tick of a repeat: Run again of the scheduled run, linked by rerun_of.
 * When it can't start (a contender turned off, the judge removed), it skips
 * this time and emails the owner the reason. Returns the new run's id or null.
 */
export async function repeatRun(deps: Deps, mail: Mailer, render: PromptForTask, runId: string): Promise<string | null> {
  const run = await deps.find("runs", runId);
  if (!run || !String(run["schedule"] ?? "").trim()) {
    mail.log(`repeat skipped: run ${runId} no longer repeats`);
    return null;
  }
  try {
    const plan = await rerunPlan(deps, runId);
    const id = await startRun(deps, plan, render, { rerunOf: runId });
    mail.log(`repeat run=${runId} new=${id}`);
    return id;
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    const role = await deps.find("roles", String(run["role"]));
    const link = await appLink(deps.sql, `/runs/${runId}`);
    await alertOwner(mail, {
      type: "repeat-skipped",
      subject: `Audition: a repeat of ${roleName(role)} was skipped`,
      body: `The scheduled repeat of the ${roleName(role)} run could not start:\n\n${why}\n\nThe schedule stays on, and the next repeat will try again. Change it or stop it here:\n${link}\n`,
      push: { title: `A repeat of ${roleName(role)} was skipped`, body: why, page: `/runs/${runId}` },
    });
    return null;
  }
}

const roleName = (role: Rec | null) => String(role?.["name"] ?? "a role");

// ── The run-finished email ───────────────────────────────────────────────────

/**
 * Whether a run's status change is worth an email: with judge "Me" when its
 * outputs are ready for you (judging), with the AI judge when it is done.
 */
export function finishedNow(before: Rec | null, after: Rec): boolean {
  if (!before || before["status"] === after["status"]) return false;
  if (after["judge"] === "me") return after["status"] === "judging" || (after["status"] === "done" && before["status"] === "running");
  return after["status"] === "done";
}

export type ArenaDeps = Deps & BoardDeps & Mailer;

/** Email the owner that a run finished, and whether the suggested champion changed. */
export async function runFinishedEmail(deps: ArenaDeps, runId: string): Promise<boolean> {
  const run = await deps.find("runs", runId);
  if (!run) return false;
  const role = await deps.find("roles", String(run["role"]));
  const rows = await deps.sql.query<{ status: string; mode: string }>(`SELECT status, mode FROM vb_attempts WHERE run = ?`, [runId]);
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  const lines: string[] = [];
  const repeat = run["rerun_of"] ? " (a repeat)" : "";
  lines.push(`Your ${roleName(role)} run${repeat} has ${rows.length} output${rows.length === 1 ? "" : "s"}.`);
  if (run["status"] === "judging") lines.push(`${count("submitted")} ${count("submitted") === 1 ? "is" : "are"} ready for you to judge.`);
  if (count("judged")) lines.push(`${count("judged")} judged.`);
  if (count("failed")) lines.push(`${count("failed")} failed.`);
  lines.push("", `Open the run: ${await appLink(deps.sql, `/runs/${runId}`)}`);

  const champ = await championNote(deps, String(run["role"]));
  if (champ) lines.push("", champ);

  const judging = run["status"] === "judging";
  const title = judging ? `${roleName(role)} outputs are ready to judge` : `${roleName(role)} run finished`;
  const short = [
    `${rows.length} output${rows.length === 1 ? "" : "s"}${count("failed") ? `, ${count("failed")} failed` : ""}.`,
    champ ? "The leaderboard suggests a new champion." : "",
  ].filter(Boolean).join(" ");
  const sent = await alertOwner(deps, {
    type: "run-finished",
    subject: `Audition: ${title}`,
    body: lines.join("\n") + "\n",
    push: { title, body: short, page: champ && !judging ? `/leaderboard/${String(run["role"])}` : `/runs/${runId}` },
  });
  return sent.email;
}

/** A line when the leaderboard suggests a champion other than the confirmed one; else null. */
export async function championNote(deps: ArenaDeps, roleId: string): Promise<string | null> {
  const board = await roleBoard(deps, roleId);
  if (!board?.suggested) return null;
  if (board.casting?.contender === board.suggested) return null;
  const name = (id: string) => board.rows.find((r) => r.contender === id)?.name ?? id;
  const now = board.casting ? `instead of ${name(board.casting.contender)}, the current champion` : "and there is no champion yet";
  return `Champion change: the leaderboard now suggests ${name(board.suggested)} ${now}. Confirm it here: ${await appLink(deps.sql, `/leaderboard/${roleId}`)}`;
}

/** Deps for this file from a hook's, job's, route's or worker's helpers. */
export function arenaDepsFrom(helpers: Rec, base: Deps): ArenaDeps {
  return {
    ...base,
    email: (o) => helpers.email(o),
    log: (...a) => helpers.log(...a),
    notify: (id, p) => helpers.notify(id, p),
  };
}
