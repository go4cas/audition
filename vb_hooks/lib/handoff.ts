// The generic prompt (TECH-SPEC §9) and the handoff submit rules (§6, attempts).
// One prompt is rendered per task when a run starts; T1's POST /runs stores it
// as `prompt_sent` on every attempt of that task, API and handoff alike, so
// every contender sees the identical text. No "vaultbase" import (F7).
import { parseJson, type Criterion } from "./validation.ts";
import type { Sql } from "./store.ts";
import { deriveCost } from "./cost.ts";
import { refreshRunStatus } from "./runs.ts";

type Rec = Record<string, unknown>;
export type Render = (template: string, vars: Rec) => string;

export interface PromptInput {
  template: { body: string; return_instructions?: string | null };
  role: { name: string; description?: string | null; rubric: unknown };
  task: {
    title: string;
    /** Editor HTML; converted to plain text here. */
    prompt: string;
    output_type?: string | null;
    base_ref?: unknown;
    /** Display names (the files' original names), in the task's order. */
    attachments?: string[] | null;
  };
  /** helpers.template.render inside Vaultbase; defaults to the copy below. */
  render?: Render;
}

// ── the renderer (a copy of Vaultbase 0.40.2's helpers.template.render) ─────
// src/core/hook-helpers-extra.ts, makeTemplate. test/handoff.test.ts checks
// that this copy and the server's give the same string.

function resolvePath(vars: Rec, path: string): unknown {
  let v: unknown = vars;
  for (const part of path.split(".")) {
    if (v == null || typeof v !== "object") return undefined;
    v = (v as Rec)[part];
  }
  return v;
}

function isTruthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return false;
  if (Array.isArray(v) && v.length === 0) return false;
  return true;
}

export const renderTemplate: Render = (template, vars) =>
  template
    .replace(/\{\{#if\s+([\w.]+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_m, path: string, body: string) =>
      isTruthy(resolvePath(vars, path)) ? body : "")
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, path: string) => {
      const v = resolvePath(vars, path);
      return v === undefined || v === null ? "" : String(v);
    });

// ── pieces built in TypeScript (F6: the template has no loops) ───────────────

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Editor HTML to plain text with line breaks, so the copied block holds no tags. */
export function htmlToText(html: string): string {
  return String(html ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/<\s*(script|style)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*li\b[^>]*>/gi, "\n- ")
    .replace(/<\s*\/\s*(p|div|h[1-6]|ul|ol|blockquote|pre|tr|table)\s*>/gi, "\n")
    .replace(/<\s*(p|div|h[1-6]|ul|ol|blockquote|pre|tr|table)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .split("\n").map((l) => l.replace(/[ \t]+$/g, "")).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** One line per criterion: `1. Accuracy (40%): <guidance>`. */
export function rubricText(raw: unknown): string {
  const rubric = parseJson(raw);
  if (!Array.isArray(rubric)) return "";
  return (rubric as Criterion[])
    .map((c, i) => {
      const guidance = typeof c.guidance === "string" ? c.guidance.trim() : "";
      return `${i + 1}. ${c.name} (${c.weight}%)${guidance ? `: ${guidance}` : ""}`;
    })
    .join("\n");
}

export const DEFAULT_RETURN_INSTRUCTIONS: Record<string, string> = {
  text: "WHEN DONE, reply with your answer only.",
  image: "WHEN DONE, return the image files and a one-line description of each.",
  file: "WHEN DONE, return the files and a short summary of what each contains.",
  code: "WHEN DONE, reply with: a short summary of what you built; the branch name or diff; build, test and lint results (pass or fail, with counts); any screenshots, as files.",
};

/**
 * The template's `return_instructions` holds one `type: text` line per output
 * type (T0 seed). Pick the task's line. A template whose instructions have no
 * type prefixes applies to every type. A missing line falls back to the spec's.
 */
export function returnInstructionsFor(raw: string | null | undefined, outputType: string | null | undefined): string {
  const type = outputType || "text";
  const text = String(raw ?? "").trim();
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const typed = new Map<string, string>();
  for (const l of lines) {
    const m = /^(text|image|file|code)\s*:\s*(.*)$/i.exec(l);
    if (m) typed.set(m[1]!.toLowerCase(), m[2]!.trim());
  }
  if (typed.size === 0 && text) return text;
  return typed.get(type) ?? DEFAULT_RETURN_INSTRUCTIONS[type] ?? DEFAULT_RETURN_INSTRUCTIONS["text"]!;
}

function baseRef(raw: unknown): { repo: string; commit: string } | null {
  const ref = parseJson(raw) as { repo?: unknown; commit?: unknown } | null;
  if (!ref || typeof ref !== "object") return null;
  if (typeof ref.repo !== "string" || typeof ref.commit !== "string" || !ref.repo || !ref.commit) return null;
  return { repo: ref.repo, commit: ref.commit };
}

/** The one prompt for a task (TECH-SPEC §9). Pure: same input, same string. */
export function renderPrompt(input: PromptInput): string {
  const { template, role, task } = input;
  const render = input.render ?? renderTemplate;
  const names = (task.attachments ?? []).filter((n) => typeof n === "string" && n);
  const vars = {
    role: { name: role.name, description: role.description ?? "" },
    task: { title: task.title, prompt: htmlToText(task.prompt), base_ref: baseRef(task.base_ref) },
    attachments_text: names.join(", "),
    rubric_text: rubricText(role.rubric),
    return_instructions: returnInstructionsFor(template.return_instructions, task.output_type),
  };
  return render(template.body, vars);
}

// ── loading what the prompt needs, from a hook, route or worker ──────────────

export interface LoadHelpers {
  find(collection: string, id: string): Promise<Rec | null>;
  sql: Sql;
  template?: { render: Render };
}

export class HandoffError extends Error {
  constructor(message: string, readonly code = 422) { super(message); }
}

/** A multiple file field's value as a list of stored names. */
export function fileList(v: unknown): string[] {
  const parsed = parseJson(v);
  if (Array.isArray(parsed)) return parsed.filter((n): n is string => typeof n === "string" && n !== "");
  return typeof parsed === "string" && parsed ? [parsed] : [];
}

/** Original names of stored files, in the given order (vaultbase_files). */
export async function originalNames(sql: Sql, stored: string[]): Promise<Map<string, { original: string; mime: string; record: string; field: string }>> {
  const out = new Map<string, { original: string; mime: string; record: string; field: string }>();
  if (stored.length === 0) return out;
  const rows = await sql.query<{ filename: string; original_name: string | null; mime_type: string | null; record_id: string; field_name: string }>(
    `SELECT filename, original_name, mime_type, record_id, field_name FROM vaultbase_files WHERE filename IN (${stored.map(() => "?").join(", ")})`,
    stored,
  );
  for (const r of rows) out.set(r.filename, { original: r.original_name || r.filename, mime: r.mime_type || "", record: r.record_id, field: r.field_name });
  return out;
}

/** The generic template: the oldest `kind = generic` row (T0 seeds one). */
export async function genericTemplate(sql: Sql): Promise<{ body: string; return_instructions: string | null }> {
  const row = await sql.queryOne<{ body: string; return_instructions: string | null }>(
    `SELECT body, return_instructions FROM vb_handoff_templates WHERE kind = 'generic' ORDER BY created_at, id LIMIT 1`,
  );
  if (!row || !row.body) throw new HandoffError("There is no generic handoff template. Run the seed.", 500);
  return row;
}

/**
 * Load a task, its role, the generic template and the attachments' names, and
 * render the prompt. T1's POST /runs calls this once per task.
 */
export async function promptForTask(helpers: LoadHelpers, taskId: string): Promise<string> {
  const task = await helpers.find("tasks", taskId);
  if (!task) throw new HandoffError(`Task ${taskId} does not exist.`, 404);
  const role = await helpers.find("roles", String(task["role"] ?? ""));
  if (!role) throw new HandoffError(`The role of task ${taskId} does not exist.`, 404);
  const template = await genericTemplate(helpers.sql);
  const stored = fileList(task["attachments"]);
  const names = await originalNames(helpers.sql, stored);
  return renderPrompt({
    template,
    role: { name: String(role["name"] ?? ""), description: (role["description"] as string) ?? "", rubric: role["rubric"] },
    task: {
      title: String(task["title"] ?? ""),
      prompt: String(task["prompt"] ?? ""),
      output_type: (task["output_type"] as string) ?? "text",
      base_ref: task["base_ref"],
      attachments: stored.map((s) => names.get(s)?.original ?? s),
    },
    render: helpers.template ? (t, v) => helpers.template!.render(t, v) : undefined,
  });
}

// ── submitting a handoff output (attempts beforeUpdate / afterUpdate) ────────

/** The fields the owner may send on a handoff PATCH (TECH-SPEC §6, attempts). */
export const OWNER_FIELDS = new Set(["output", "output_files", "tokens_in", "tokens_out", "duration_ms", "status"]);
/** Keys Vaultbase itself may carry on an update. */
const SYSTEM_KEYS = new Set(["id", "created", "updated", "created_at", "updated_at", "collectionId", "collectionName", "expand"]);

const sameValue = (a: unknown, b: unknown) => JSON.stringify(parseJson(a) ?? null) === JSON.stringify(parseJson(b) ?? null);

/** A stored number, or null when it is empty or not a number. */
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

export interface SubmitCtx {
  record: Rec;
  existing: Rec | null;
  auth: { id: string; type: "user" | "admin"; collection?: string } | null;
  helpers: { abort(message: string): never; find(collection: string, id: string): Promise<Rec | null>; sql: Sql };
}

const isMetric = (v: unknown) => v === null || v === "" || (typeof v === "number" && Number.isInteger(v) && v >= 0);

/**
 * attempts beforeUpdate. The admin (operations) passes; server code writes
 * through store.ts and never reaches this hook. The owner may only fill a
 * waiting handoff output and submit it once.
 */
export async function attemptBeforeUpdate(ctx: SubmitCtx): Promise<void> {
  if (ctx.auth?.type === "admin") return;
  const { record: r, existing } = ctx;
  const abort = ctx.helpers.abort;
  if (!existing) abort("That output does not exist.");
  if (existing!["mode"] !== "handoff") abort("Only copy-and-paste (handoff) outputs can be filled in by hand.");
  if (existing!["status"] !== "waiting") abort("This output has already been submitted.");

  for (const [k, v] of Object.entries(r)) {
    if (OWNER_FIELDS.has(k) || SYSTEM_KEYS.has(k)) continue;
    if (k === "contender" || k === "task" || k === "run" || k === "mode") {
      if (!sameValue(v, existing![k])) abort(`An output's ${k} can't change.`);
      continue;
    }
    if (!sameValue(v, existing![k])) abort(`${k} is set by Audition and can't be changed here.`);
  }

  for (const k of ["tokens_in", "tokens_out", "duration_ms"]) {
    if (k in r && !isMetric(r[k])) abort(`${k.replace("_", " ")} must be a whole number of 0 or more.`);
  }

  const files = fileList("output_files" in r ? r["output_files"] : existing!["output_files"]);
  if ("output_files" in r) {
    // Files are attached by the upload route; a PATCH may only keep or drop them.
    const had = new Set(fileList(existing!["output_files"]));
    for (const f of files) if (!had.has(f)) abort("Upload files with the upload button, not by name.");
  }

  const status = "status" in r ? r["status"] : existing!["status"];
  if (status === "waiting") return;
  if (status !== "submitted") abort("A handoff output can only go from waiting to submitted.");

  const merged = { ...existing!, ...r };
  const output = typeof merged["output"] === "string" ? merged["output"].trim() : "";
  if (!output && files.length === 0) abort("Paste the output or attach at least one file before submitting.");

  // F4: re-check every attached file against the Phase 1 list on submit.
  const meta = await originalNames(ctx.helpers.sql, files);
  const id = String(existing!["id"]);
  for (const f of files) {
    const m = meta.get(f);
    if (!m || m.record !== id || m.field !== "output_files") abort("An attached file doesn't belong to this output.");
    const err = uploadTypeError(m!.original, m!.mime);
    if (err) abort(err);
  }

  r["status"] = "submitted";
  r["metrics_source"] = "manual";
  r["submitted_at"] = Math.floor(Date.now() / 1000);
  const contender = await ctx.helpers.find("contenders", String(existing!["contender"]));
  const cost = deriveCost(numOrNull(merged["tokens_in"]), numOrNull(merged["tokens_out"]), numOrNull(contender?.["price_in_per_mtok"]), numOrNull(contender?.["price_out_per_mtok"]));
  r["cost"] = cost;
}

// ── upload checks (Phase 1 list: text, images, PDF, zip) ─────────────────────

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Extension → the MIME type stored for it (F4: zip goes up as octet-stream). */
export const UPLOAD_TYPES: Record<string, string> = {
  txt: "text/plain", md: "text/plain", csv: "text/plain", log: "text/plain",
  json: "application/json",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  pdf: "application/pdf",
  zip: "application/octet-stream",
};

export const extOf = (name: string) => {
  const m = /\.([A-Za-z0-9]+)$/.exec(name.trim());
  return m ? m[1]!.toLowerCase() : "";
};

/** null when the name and declared type are on the Phase 1 list. */
export function uploadTypeError(name: string, mime: string): string | null {
  const ext = extOf(name);
  const stored = UPLOAD_TYPES[ext];
  if (!stored) return `"${name}" isn't a supported file. Use text, an image (PNG, JPEG, GIF, WebP), a PDF or a zip.`;
  const declared = (mime || "").split(";")[0]!.trim().toLowerCase();
  const ok = declared === "" || declared === stored || declared === "application/octet-stream"
    || (ext === "zip" && (declared === "application/zip" || declared === "application/x-zip-compressed"))
    || (stored === "text/plain" && declared.startsWith("text/"))
    || (ext === "json" && declared === "text/plain");
  return ok ? null : `"${name}" says it is ${declared}, which doesn't match its name.`;
}

/** The first bytes must match for binary types, so a renamed file is caught. */
export function contentError(name: string, bytes: Uint8Array): string | null {
  const ext = extOf(name);
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  const ok: Record<string, () => boolean> = {
    png: () => starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    jpg: () => starts(0xff, 0xd8, 0xff),
    jpeg: () => starts(0xff, 0xd8, 0xff),
    gif: () => starts(0x47, 0x49, 0x46, 0x38),
    webp: () => starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50,
    pdf: () => starts(0x25, 0x50, 0x44, 0x46),
    zip: () => starts(0x50, 0x4b) && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07),
  };
  const check = ok[ext];
  return check && !check() ? `"${name}" isn't really a ${ext.toUpperCase()} file.` : null;
}

export const storedMime = (name: string) => UPLOAD_TYPES[extOf(name)] ?? "application/octet-stream";

/** Every check on one uploaded file: size, name and declared type, content. */
export function checkUpload(name: string, mime: string, size: number, bytes: Uint8Array): { code: number; error: string } | null {
  if (size > MAX_UPLOAD_BYTES) return { code: 413, error: `"${name}" is larger than 25 MB.` };
  if (size === 0) return { code: 422, error: `"${name}" is empty.` };
  const type = uploadTypeError(name, mime);
  if (type) return { code: 415, error: type };
  const content = contentError(name, bytes);
  return content ? { code: 415, error: content } : null;
}

/**
 * Where the owner may upload: a waiting handoff output's files, or an
 * unlocked task's attachments (the same as those records' update rules).
 */
export function uploadTargetError(collection: string, field: string, record: Rec | null): { code: number; error: string } | null {
  if (collection === "attempts" && field === "output_files") {
    if (!record) return { code: 404, error: "That output does not exist." };
    if (record["mode"] !== "handoff") return { code: 403, error: "Only copy-and-paste (handoff) outputs take uploaded files." };
    if (record["status"] !== "waiting") return { code: 409, error: "This output has already been submitted." };
    return null;
  }
  if (collection === "tasks" && field === "attachments") {
    if (!record) return { code: 404, error: "That task does not exist." };
    if (record["locked"]) return { code: 403, error: "This task has been used in a run, so it is read-only. Use Duplicate and edit." };
    return null;
  }
  return { code: 404, error: "Files can be uploaded only to an output or a task." };
}

export interface AfterCtx {
  record: Rec;
  existing: Rec | null;
  helpers: {
    find(collection: string, id: string): Promise<Rec | null>;
    sql: Sql;
    enqueue(queue: string, payload: unknown, opts?: { uniqueKey?: string }): Promise<unknown>;
  };
}

/**
 * attempts afterUpdate: when a handoff output is submitted, queue AI judging
 * if the run's judge is AI, then refresh the run's status. Runs after the
 * response (Vaultbase fires after-hooks without waiting).
 */
export async function attemptAfterUpdate(ctx: AfterCtx): Promise<void> {
  const before = ctx.existing?.["status"];
  const after = ctx.record["status"];
  if (before !== "waiting" || after !== "submitted") return;
  const attemptId = String(ctx.record["id"] ?? ctx.existing?.["id"]);
  const runId = String(ctx.record["run"] ?? ctx.existing?.["run"] ?? "");
  if (!runId) return;
  const run = await ctx.helpers.find("runs", runId);
  if (!run) return;
  if (run["judge"] === "ai") await ctx.helpers.enqueue("judge", { attempt: attemptId }, { uniqueKey: `judge:${attemptId}` });
  await refreshRunStatus(ctx.helpers.sql, runId);
}
