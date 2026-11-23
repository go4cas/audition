// The validation and locking hooks of TECH-SPEC §6. Each file in hooks/ is a
// three-line wrapper that names the collection and event and calls one of
// these. They take the hook context, so this file never imports "vaultbase".
import { isTrusted, updateRecord, type Records, type Sql } from "./store.ts";
import {
  DEFAULT_FITNESS_WEIGHTS, DEFAULT_MAX_OUTPUT_TOKENS, DEFAULT_MIN_OUTPUTS, DEFAULT_TRIAL_DAYS, DEFAULT_PASS_MARK,
  fitnessWeightsError, normaliseContenderConfig, parseJson, requiredMode, rubricError, type Provider,
} from "./validation.ts";

type Rec = Record<string, unknown>;
export interface Ctx {
  record: Rec;
  existing: Rec | null;
  auth: { id: string; type: "user" | "admin"; collection?: string } | null;
  helpers: {
    abort(message: string): never;
    find(collection: string, id: string): Promise<Rec | null>;
    sql: Sql;
    records: Records;
  };
}

const has = (r: Rec, k: string) => Object.prototype.hasOwnProperty.call(r, k);
/** The admin, or Audition's own server code (helpers.records writes carry no user). */
const trusted = (ctx: Ctx) => isTrusted(ctx.auth);
/** The record as it will be after this write. */
const merged = (ctx: Ctx): Rec => ({ ...(ctx.existing ?? {}), ...ctx.record });
const empty = (v: unknown) => v === undefined || v === null || v === "";

// ── workspaces ───────────────────────────────────────────────────────────────

export function workspaceBeforeWrite(ctx: Ctx): void {
  const { record: r } = ctx;
  if (!ctx.existing) {
    if (empty(r["default_judge"])) r["default_judge"] = "me";
    if (empty(r["default_method"])) r["default_method"] = "rate";
    if (empty(r["min_outputs"])) r["min_outputs"] = DEFAULT_MIN_OUTPUTS;
    if (empty(r["trial_days"])) r["trial_days"] = DEFAULT_TRIAL_DAYS;
    if (empty(r["fitness_weights"])) r["fitness_weights"] = DEFAULT_FITNESS_WEIGHTS;
  }
  const m = merged(ctx);
  if (has(r, "fitness_weights") || !ctx.existing) {
    const err = fitnessWeightsError(m["fitness_weights"]);
    if (err) ctx.helpers.abort(err);
  }
  if (m["default_judge"] === "ai" && empty(m["judge_contender"])) {
    ctx.helpers.abort("Choose the AI judge contender, or set the default judge to Me.");
  }
}

// ── roles ────────────────────────────────────────────────────────────────────

export async function roleBeforeWrite(ctx: Ctx): Promise<void> {
  const { record: r } = ctx;
  if (!ctx.existing) {
    if (empty(r["pass_mark"])) r["pass_mark"] = DEFAULT_PASS_MARK;
    if (empty(r["default_output_type"])) r["default_output_type"] = "text";
  }
  const m = merged(ctx);
  if (has(r, "rubric") || !ctx.existing) {
    const err = rubricError(m["rubric"]);
    if (err) ctx.helpers.abort(err);
  }
  if ((has(r, "stage") || has(r, "workspace")) && !empty(m["stage"])) {
    const stage = await ctx.helpers.find("stages", String(m["stage"]));
    if (!stage) ctx.helpers.abort("That stage does not exist.");
    if (stage!["workspace"] !== m["workspace"]) ctx.helpers.abort("The stage belongs to another workspace.");
  }
}

export async function roleBeforeDelete(ctx: Ctx): Promise<void> {
  const id = String((ctx.existing ?? ctx.record)["id"]);
  const run = await ctx.helpers.sql.queryOne(`SELECT id FROM vb_runs WHERE role = ? LIMIT 1`, [id]);
  if (run) ctx.helpers.abort("This role has runs, so it can't be deleted.");
}

// ── locking (tasks, contenders) ──────────────────────────────────────────────

/** Only Audition sets `locked` (startRun): on create it starts false, and the owner can't change it. */
function guardLocked(ctx: Ctx): void {
  const { record: r } = ctx;
  if (trusted(ctx)) {
    if (!ctx.existing && empty(r["locked"])) r["locked"] = false;
    return;
  }
  if (!ctx.existing) {
    r["locked"] = false;
    return;
  }
  if (has(r, "locked") && Boolean(r["locked"]) !== Boolean(ctx.existing["locked"])) {
    ctx.helpers.abort("Locked is set by Audition when a run starts; it can't be changed.");
  }
  if (ctx.existing["locked"]) ctx.helpers.abort("This has been used in a run, so it is read-only. Use Duplicate and edit.");
}

// ── tasks ────────────────────────────────────────────────────────────────────

export async function taskBeforeWrite(ctx: Ctx): Promise<void> {
  guardLocked(ctx);
  const { record: r } = ctx;
  // tasks.compose is the Composer's status, written only by Audition (§9a).
  if (!trusted(ctx) && has(r, "compose") && JSON.stringify(parseJson(r["compose"]) ?? null) !== JSON.stringify(parseJson(ctx.existing?.["compose"]) ?? null)) {
    ctx.helpers.abort("The Composer's status is set by Audition. Use Compose on the task instead.");
  }
  const m = merged(ctx);
  if (!ctx.existing && empty(r["output_type"])) {
    const role = await ctx.helpers.find("roles", String(m["role"] ?? ""));
    r["output_type"] = (role?.["default_output_type"] as string) || "text";
  }
  if (has(r, "base_ref") && !empty(r["base_ref"])) {
    const ref = parseJson(r["base_ref"]) as { repo?: unknown; commit?: unknown } | null;
    if (!ref || typeof ref !== "object" || typeof ref.repo !== "string" || typeof ref.commit !== "string" || !ref.repo || !ref.commit) {
      ctx.helpers.abort("A repository reference needs a repo and a commit.");
    }
  }
}

// ── connections ──────────────────────────────────────────────────────────────

export function connectionBeforeWrite(ctx: Ctx): void {
  const { record: r } = ctx;
  if (!trusted(ctx)) {
    if (!ctx.existing) r["has_key"] = false;
    else if (has(r, "has_key") && Boolean(r["has_key"]) !== Boolean(ctx.existing["has_key"])) {
      ctx.helpers.abort("Whether a key is set is maintained by Audition; add or remove the key instead.");
    }
  } else if (!ctx.existing && empty(r["has_key"])) {
    r["has_key"] = false;
  }
  const m = merged(ctx);
  if (m["provider"] === "openai-compatible" && empty(m["base_url"])) {
    ctx.helpers.abort("An OpenAI-compatible connection needs a base URL.");
  }
  if (ctx.existing && has(r, "provider") && r["provider"] !== ctx.existing["provider"]) {
    ctx.helpers.abort("A connection's provider can't change. Create a new connection instead.");
  }
}

/** connection_keys after create, update and delete: keep connections.has_key in step. */
export async function syncHasKey(ctx: Ctx, value: boolean): Promise<void> {
  const id = (ctx.record["connection"] ?? ctx.existing?.["connection"]) as string | undefined;
  if (!id) return;
  const conn = await ctx.helpers.find("connections", id);
  if (conn && Boolean(conn["has_key"]) !== value) await updateRecord(ctx.helpers, "connections", id, { has_key: value });
}

// ── contenders ───────────────────────────────────────────────────────────────

export async function contenderBeforeWrite(ctx: Ctx): Promise<void> {
  guardLocked(ctx);
  const { record: r } = ctx;
  if (!ctx.existing) {
    if (empty(r["enabled"])) r["enabled"] = true;
    if (empty(r["config"])) r["config"] = {};
  }
  const m = merged(ctx);
  const conn = await ctx.helpers.find("connections", String(m["connection"] ?? ""));
  if (!conn) ctx.helpers.abort("That connection does not exist.");
  const provider = conn!["provider"] as Provider;
  const mode = requiredMode(provider);
  if (empty(m["mode"])) r["mode"] = mode;
  else if (m["mode"] !== mode) {
    ctx.helpers.abort(mode === "handoff"
      ? "A Manual connection's contenders work by copy and paste (handoff)."
      : `A ${provider} connection's contenders are called by Audition (api).`);
  }
  if (mode === "api") {
    if (empty(m["model"])) ctx.helpers.abort("Enter the provider's model id.");
    if (empty(m["max_output_tokens"])) r["max_output_tokens"] = DEFAULT_MAX_OUTPUT_TOKENS;
  }
  if (!ctx.existing && empty(r["group"])) r["group"] = (m["model"] as string) || (m["name"] as string);
  if (has(r, "config") || has(r, "connection") || !ctx.existing) {
    const out = normaliseContenderConfig(m["config"], provider);
    if ("error" in out) ctx.helpers.abort(out.error);
    else r["config"] = out.config;
  }
}
