// Runs: preview, start, run again, the live view, run status, and the
// generate worker's logic (TECH-SPEC §7, §8). Routes and the worker are thin
// wrappers around these functions. No "vaultbase" import (F7).
import { join } from "node:path";
import { deriveCost } from "./cost.ts";
import { attachFile } from "./files.ts";
import { callProvider, ProviderError, type ApiProvider, type FileOut, type HttpLike } from "./providers/index.ts";
import { mockSeed } from "./providers/mock.ts";
import { insertRecord, updateRecord, type Sql } from "./store.ts";
import { listOf, parseJson } from "./validation.ts";

type Rec = Record<string, any>;

export interface Deps {
  sql: Sql;
  find(collection: string, id: string): Promise<Rec | null>;
  query(collection: string, opts?: { filter?: string; sort?: string; perPage?: number }): Promise<{ data: Rec[]; totalItems: number }>;
  enqueue(queue: string, payload: unknown, opts?: { uniqueKey?: string }): Promise<unknown>;
}

export interface WorkerDeps extends Deps {
  http: HttpLike;
  readBytes(path: string): Promise<Uint8Array>;
  write(path: string, data: Uint8Array): Promise<void>;
  dataDir: string;
  log(...args: unknown[]): void;
  now?: () => number;
}

/** A prompt renderer: lib/handoff.ts's promptForTask (T2), bound to helpers. */
export type PromptForTask = (taskId: string) => Promise<string>;

export class RunError extends Error {
  constructor(readonly code: number, message: string, readonly details?: Record<string, unknown>) { super(message); }
}

export const errorBody = (e: RunError) => ({ error: e.message, code: e.code, ...(e.details ? { details: e.details } : {}) });

/** Custom routes need the owner, not the admin or another auth collection (§7). */
export function isOwner(auth: { type?: string; collection?: string } | null | undefined): boolean {
  return auth?.type === "user" && auth.collection === "users";
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const quote = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

// ── The run plan: validated body of POST /runs and /runs/preview ─────────────

export interface RunBody { role: string; tasks: string[]; contenders: string[]; judge?: "me" | "ai" }

export interface PlanContender { contender: Rec; connection: Rec }
export interface Plan {
  role: Rec;
  workspace: Rec;
  tasks: Rec[];
  contenders: PlanContender[];
  judge: "me" | "ai";
  judgeContender: PlanContender | null;
}

export function parseRunBody(raw: unknown): RunBody {
  const b = (raw ?? {}) as Partial<Record<keyof RunBody, unknown>>;
  const ids = (v: unknown, what: string): string[] => {
    if (!Array.isArray(v) || v.length === 0) throw new RunError(422, `Choose at least one ${what}.`);
    const out = [...new Set(v.map(String))];
    if (out.some((id) => !ID.test(id))) throw new RunError(422, `A ${what} id is not valid.`);
    return out;
  };
  if (typeof b.role !== "string" || !ID.test(b.role)) throw new RunError(422, "Choose a role.");
  if (b.judge !== undefined && b.judge !== null && b.judge !== "me" && b.judge !== "ai") throw new RunError(422, 'The judge is "me" or "ai".');
  return { role: b.role, tasks: ids(b.tasks, "task"), contenders: ids(b.contenders, "contender"), ...(b.judge ? { judge: b.judge as "me" | "ai" } : {}) };
}

async function contenderWithConnection(deps: Deps, id: string): Promise<PlanContender | null> {
  const contender = await deps.find("contenders", id);
  if (!contender) return null;
  const connection = await deps.find("connections", String(contender["connection"]));
  if (!connection) return null;
  return { contender, connection };
}

/** Load and check everything a run needs. Throws RunError (404 or 422). */
export async function loadPlan(deps: Deps, body: RunBody, judgeContenderId?: string | null): Promise<Plan> {
  const role = await deps.find("roles", body.role);
  if (!role) throw new RunError(404, "That role does not exist.");
  const workspace = await deps.find("workspaces", String(role["workspace"]));
  if (!workspace) throw new RunError(404, "That role's workspace does not exist.");

  const tasks: Rec[] = [];
  for (const id of body.tasks) {
    const t = await deps.find("tasks", id);
    if (!t) throw new RunError(404, "A chosen task does not exist.", { task: id });
    if (t["role"] !== role["id"]) throw new RunError(422, `The task "${t["title"]}" belongs to another role.`, { task: id });
    tasks.push(t);
  }

  const contenders: PlanContender[] = [];
  for (const id of body.contenders) {
    const c = await contenderWithConnection(deps, id);
    if (!c) throw new RunError(404, "A chosen contender does not exist.", { contender: id });
    if (c.contender["enabled"] === false || c.contender["enabled"] === 0) {
      throw new RunError(422, `The contender "${c.contender["name"]}" is turned off.`, { contender: id });
    }
    if (c.contender["mode"] === "runner") throw new RunError(422, `The contender "${c.contender["name"]}" uses a mode Phase 1 can't run.`, { contender: id });
    contenders.push(c);
  }

  const judge = body.judge ?? ((workspace["default_judge"] as "me" | "ai") || "me");
  let judgeContender: PlanContender | null = null;
  if (judge === "ai") {
    const jid = judgeContenderId ?? (workspace["judge_contender"] as string | null);
    if (!jid) throw new RunError(422, "This workspace has no AI judge. Choose one in the workspace settings, or judge it yourself.");
    judgeContender = await contenderWithConnection(deps, jid);
    if (!judgeContender) throw new RunError(422, "The workspace's AI judge no longer exists.");
    if (judgeContender.contender["mode"] !== "api") throw new RunError(422, "The AI judge must be a contender Audition can call (not copy and paste).");
  }
  return { role, workspace, tasks, contenders, judge, judgeContender };
}

// ── Preview: call counts and warnings ────────────────────────────────────────

export interface Preview {
  outputs: number;
  api_calls: number;
  handoff_outputs: number;
  judge_calls: number;
  total_provider_calls: number;
  warnings: string[];
}

/**
 * Call count (§8, the spending guard): API outputs, plus the outputs to be
 * judged when the judge is AI and isn't the mock. judge_calls always shows
 * how many outputs the AI judge will score; the mock judge's calls are free,
 * so they are left out of the total.
 */
export function previewOf(plan: Plan): Preview {
  const n = plan.tasks.length;
  const api = plan.contenders.filter((c) => c.contender["mode"] === "api").length;
  const handoff = plan.contenders.length - api;
  const outputs = n * plan.contenders.length;
  const judgeCalls = plan.judge === "ai" ? outputs : 0;
  const judgeIsMock = plan.judgeContender?.connection["provider"] === "mock";
  return {
    outputs,
    api_calls: n * api,
    handoff_outputs: n * handoff,
    judge_calls: judgeCalls,
    total_provider_calls: n * api + (judgeIsMock ? 0 : judgeCalls),
    warnings: plan.judgeContender ? sameProviderWarnings(plan.judgeContender, plan.contenders) : [],
  };
}

const PROVIDER_LABEL: Record<string, string> = { anthropic: "Anthropic", "openai-compatible": "OpenAI", mock: "Mock" };

/**
 * The AI judge shares a provider with an API contender when their
 * connections' providers match; a handoff contender "may share" one when its
 * name contains the judge provider's name (a heuristic, §10).
 */
export function sameProviderWarnings(judge: PlanContender, contenders: PlanContender[]): string[] {
  const provider = String(judge.connection["provider"]);
  const label = PROVIDER_LABEL[provider] ?? provider;
  const out: string[] = [];
  for (const c of contenders) {
    if (c.contender["id"] === judge.contender["id"]) {
      out.push(`The AI judge is also a contender (${c.contender["name"]}), so it judges its own output.`);
    } else if (c.contender["mode"] === "api" && c.connection["provider"] === provider) {
      out.push(`The AI judge shares a provider with ${c.contender["name"]}.`);
    } else if (c.contender["mode"] === "handoff" && String(c.contender["name"]).toLowerCase().includes(label.toLowerCase())) {
      out.push(`The AI judge may share a provider with ${c.contender["name"]}.`);
    }
  }
  return out;
}

// ── Starting a run ───────────────────────────────────────────────────────────

/**
 * Create the run and one attempt per task × contender, lock every task and
 * contender used, and enqueue each API attempt on `generate`. The prompt is
 * rendered once per task and stored on every attempt for it (§9).
 */
export async function startRun(deps: Deps, plan: Plan, render: PromptForTask, opts: { rerunOf?: string } = {}): Promise<string> {
  // Render first: a template problem must not leave half a run behind.
  const prompts = new Map<string, string>();
  for (const t of plan.tasks) prompts.set(String(t["id"]), await render(String(t["id"])));

  const preview = previewOf(plan);
  const runId = await insertRecord(deps.sql, "runs", {
    workspace: plan.workspace["id"],
    role: plan.role["id"],
    tasks: plan.tasks.map((t) => t["id"]),
    contenders: plan.contenders.map((c) => c.contender["id"]),
    judge: plan.judge,
    judge_contender: plan.judgeContender?.contender["id"] ?? null,
    rerun_of: opts.rerunOf ?? null,
    status: "running",
    call_count: preview.total_provider_calls,
  });

  const queued: string[] = [];
  for (const t of plan.tasks) {
    for (const c of plan.contenders) {
      const mode = c.contender["mode"] === "handoff" ? "handoff" : "api";
      const id = await insertRecord(deps.sql, "attempts", {
        run: runId,
        task: t["id"],
        contender: c.contender["id"],
        mode,
        status: mode === "api" ? "queued" : "waiting",
        prompt_sent: prompts.get(String(t["id"])),
      });
      if (mode === "api") queued.push(id);
    }
  }

  // Locked from their first run on: results must stay tied to exactly what ran.
  for (const t of plan.tasks) if (!t["locked"]) await updateRecord(deps.sql, "tasks", String(t["id"]), { locked: true });
  const used = [...plan.contenders, ...(plan.judgeContender ? [plan.judgeContender] : [])];
  for (const c of used) if (!c.contender["locked"]) await updateRecord(deps.sql, "contenders", String(c.contender["id"]), { locked: true });

  for (const id of queued) await deps.enqueue("generate", { attempt: id }, { uniqueKey: `generate:${id}` });
  return runId;
}

/** The body of POST /runs/:id/again: the same role, tasks, contenders and judge. */
export async function rerunPlan(deps: Deps, runId: string): Promise<Plan> {
  const run = await deps.find("runs", runId);
  if (!run) throw new RunError(404, "That run does not exist.");
  if (run["status"] !== "done") throw new RunError(409, "Run again is possible once this run is done.");
  const body: RunBody = { role: String(run["role"]), tasks: listOf(run["tasks"]), contenders: listOf(run["contenders"]), judge: run["judge"] as "me" | "ai" };
  return loadPlan(deps, body, (run["judge_contender"] as string | null) || null);
}

// ── Run status and the live view ─────────────────────────────────────────────

export type AttemptStatus = "queued" | "in_progress" | "waiting" | "submitted" | "judged" | "failed";
export type RunStatus = "running" | "judging" | "done";

/** §8: running while any output is in flight, judging while any is unjudged, then done. */
export function runStatusFrom(statuses: string[]): RunStatus {
  if (statuses.some((s) => s === "queued" || s === "in_progress" || s === "waiting")) return "running";
  if (statuses.some((s) => s === "submitted")) return "judging";
  return "done";
}

/** Recompute a run's status from its attempts. Call after every attempt change (T1, T2, T3). */
export async function refreshRunStatus(sql: Sql, runId: string): Promise<RunStatus | null> {
  const rows = await sql.query<{ status: string }>(`SELECT status FROM vb_attempts WHERE run = ?`, [runId]);
  if (rows.length === 0) return null;
  const status = runStatusFrom(rows.map((r) => r.status));
  await sql.exec(`UPDATE vb_runs SET status = ?, updated_at = ? WHERE id = ? AND (status IS NULL OR status != ?)`, [status, Math.floor(Date.now() / 1000), runId, status]);
  return status;
}

const COUNT_KEYS: AttemptStatus[] = ["queued", "in_progress", "waiting", "submitted", "judged", "failed"];

/** GET /runs/:id: not blind; for the live view to poll every 2 seconds. */
export async function runView(deps: Deps, runId: string) {
  const run = await deps.find("runs", runId);
  if (!run) throw new RunError(404, "That run does not exist.");
  const attempts = await deps.sql.query<Rec>(
    `SELECT id, task, contender, mode, status, tokens_in, tokens_out, duration_ms, cost, finish_reason, error
       FROM vb_attempts WHERE run = ? ORDER BY rowid`, [runId]);
  const counts = Object.fromEntries(COUNT_KEYS.map((k) => [k, 0])) as Record<AttemptStatus, number>;
  for (const a of attempts) if (a["status"] in counts) counts[a["status"] as AttemptStatus]++;
  return { run, counts, attempts };
}

// ── Files ────────────────────────────────────────────────────────────────────

const storedNames = listOf;

/** A task's attachments with their original names and types, for API calls. */
export async function taskAttachments(deps: WorkerDeps, task: Rec): Promise<FileOut[]> {
  const out: FileOut[] = [];
  for (const name of storedNames(task["attachments"])) {
    const row = await deps.sql.queryOne<{ original_name: string; mime_type: string }>(
      `SELECT original_name, mime_type FROM vaultbase_files WHERE filename = ?`, [name]);
    out.push({ name: row?.original_name ?? name, mime: row?.mime_type ?? "application/octet-stream", bytes: await deps.readBytes(join(deps.dataDir, "uploads", name)) });
  }
  return out;
}

// ── Calling a contender (generate worker here; judge worker in T3) ───────────

export interface Callable { contender: Rec; connection: Rec; provider: ApiProvider; apiKey?: string }

/** A contender, its connection and its key, ready for callProvider(). */
export async function callable(deps: Deps, contenderId: string): Promise<Callable> {
  const c = await contenderWithConnection(deps, contenderId);
  if (!c) throw new ProviderError("The contender or its connection no longer exists.", false);
  const provider = String(c.connection["provider"]);
  if (provider !== "anthropic" && provider !== "openai-compatible" && provider !== "mock") {
    throw new ProviderError(`A ${provider} contender is not called by Audition.`, false);
  }
  let apiKey: string | undefined;
  if (provider !== "mock") {
    // Server code reads the key; the owner never can (F2).
    const k = (await deps.query("connection_keys", { filter: `connection = ${quote(String(c.connection["id"]))}`, perPage: 1 })).data[0];
    apiKey = (k?.["api_key"] as string | undefined) || undefined;
  }
  return { ...c, provider, ...(apiKey ? { apiKey } : {}) };
}

/** n for the mock seed: earlier attempts of this task by this contender (§12). */
async function earlierAttempts(sql: Sql, a: Rec): Promise<number> {
  const row = await sql.queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM vb_attempts WHERE task = ? AND contender = ? AND rowid < (SELECT rowid FROM vb_attempts WHERE id = ?)`,
    [a["task"], a["contender"], a["id"]]);
  return Number(row?.n ?? 0);
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * The generate worker (§8). It never throws: every failure ends as a
 * `failed` attempt with an error, so the queue never spins.
 */
export async function runGenerate(deps: WorkerDeps, attemptId: string): Promise<{ status: string; calls: number }> {
  const now = deps.now ?? Date.now;
  let calls = 0;
  let runId: string | null = null;
  try {
    // Claim it: only a queued attempt moves to in_progress, and only once.
    const claim = await deps.sql.exec(
      `UPDATE vb_attempts SET status = 'in_progress', updated_at = ? WHERE id = ? AND status = 'queued'`,
      [Math.floor(now() / 1000), attemptId]);
    if (claim.changes === 0) return { status: "skipped", calls: 0 };
    const attempt = await deps.find("attempts", attemptId);
    if (!attempt) return { status: "skipped", calls: 0 };
    runId = String(attempt["run"]);
    const run = await deps.find("runs", runId);
    const task = await deps.find("tasks", String(attempt["task"]));
    if (!run || !task) throw new ProviderError("The run or task no longer exists.", false);

    let status = "failed";
    try {
      const target = await callable(deps, String(attempt["contender"]));
      const config = (parseJson(target.contender["config"]) as Rec | null) ?? {};
      const out = await callProvider({
        provider: target.provider,
        model: String(target.contender["model"] ?? ""),
        config,
        maxOutputTokens: num(target.contender["max_output_tokens"]) ?? 16000,
        prompt: String(attempt["prompt_sent"] ?? ""),
        attachments: await taskAttachments(deps, task),
        ...(target.apiKey ? { apiKey: target.apiKey } : {}),
        ...(target.connection["base_url"] ? { baseUrl: String(target.connection["base_url"]) } : {}),
        seed: mockSeed(String(attempt["task"]), String(attempt["contender"]), await earlierAttempts(deps.sql, attempt)),
        http: deps.http,
      }, now);
      calls = out.calls;
      const r = out.result;
      if (!r.text.trim() && r.files.length === 0) {
        throw new ProviderError(r.finishReason === "max_tokens"
          ? "The answer was empty: it was cut off at max output tokens."
          : "The provider returned an empty answer.", false);
      }
      for (const f of r.files) {
        await attachFile({ sql: deps.sql, write: deps.write, dataDir: deps.dataDir }, "attempts", attemptId, "output_files", f.name, f.mime, f.bytes);
      }
      await updateRecord(deps.sql, "attempts", attemptId, {
        output: r.text,
        tokens_in: r.tokensIn,
        tokens_out: r.tokensOut,
        duration_ms: Math.round(out.durationMs),
        cost: deriveCost(r.tokensIn, r.tokensOut, num(target.contender["price_in_per_mtok"]), num(target.contender["price_out_per_mtok"])),
        finish_reason: r.finishReason,
        metrics_source: "measured",
        error: null,
        status: "submitted",
        submitted_at: now(),
      });
      status = "submitted";
    } catch (e) {
      calls = (e as { calls?: number }).calls ?? calls;
      await updateRecord(deps.sql, "attempts", attemptId, { status: "failed", error: errorText(e) });
    }
    deps.log(`generate attempt=${attemptId} status=${status} calls=${calls}`);
    if (status === "submitted" && run["judge"] === "ai") {
      await deps.enqueue("judge", { attempt: attemptId }, { uniqueKey: `judge:${attemptId}` });
    }
    await refreshRunStatus(deps.sql, runId);
    return { status, calls };
  } catch (e) {
    // Anything unexpected still ends the attempt, never the queue.
    try {
      await updateRecord(deps.sql, "attempts", attemptId, { status: "failed", error: `Audition could not run this output: ${errorText(e)}` });
      if (runId) await refreshRunStatus(deps.sql, runId);
    } catch { /* nothing more to do */ }
    deps.log(`generate attempt=${attemptId} status=failed calls=${calls} error=${errorText(e)}`);
    return { status: "failed", calls };
  }
}

function errorText(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 1000);
}

// ── Wiring from Vaultbase helpers ────────────────────────────────────────────

/** Deps from a route's or worker's helpers. */
export function depsFrom(helpers: Rec): Deps & { render(t: string, v: Record<string, unknown>): string } {
  return {
    sql: helpers.sql,
    find: (c, id) => helpers.find(c, id),
    query: (c, o) => helpers.query(c, o),
    enqueue: (q, p, o) => helpers.enqueue(q, p, o),
    render: (t, v) => helpers.template.render(t, v),
  };
}

export function workerDepsFrom(helpers: Rec): WorkerDeps {
  return {
    ...depsFrom(helpers),
    http: helpers.http,
    readBytes: (p) => helpers.fs.readBytes(p),
    write: (p, d) => helpers.fs.write(p, d),
    dataDir: helpers.os.env("VAULTBASE_DATA_DIR") || "./vaultbase_data",
    log: (...a) => helpers.log(...a),
  };
}

/** Run a route handler as the owner, mapping RunError to Vaultbase-style errors. */
export async function ownerRoute(ctx: { auth: any; set: { status: number } }, fn: () => Promise<unknown>): Promise<unknown> {
  if (!isOwner(ctx.auth)) { ctx.set.status = 403; return { error: "Only the owner can do this.", code: 403 }; }
  try {
    return { data: await fn() };
  } catch (e) {
    if (e instanceof RunError) { ctx.set.status = e.code; return errorBody(e); }
    // lib/handoff.ts's HandoffError (prompt rendering) carries its own code.
    const code = (e as { code?: unknown })?.code;
    if (e instanceof Error && e.name !== "RunError" && typeof code === "number" && code >= 400 && code < 600) {
      ctx.set.status = code;
      return { error: e.message, code };
    }
    throw e;
  }
}
