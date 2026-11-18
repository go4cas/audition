// The AI judge (TECH-SPEC §10, Q5): the fixed system prompt and reply schema,
// which files the judge is shown, the reply check, and judgeAttempt(), the judge worker's whole job with its dependencies
// passed in. No "vaultbase" import here (TECH-SPEC F7).
import { mockSeed, ProviderError, type FileOut, type GenerateInput, type GenerateResult } from "./providers/mock.ts";
import { refreshRunStatus } from "./runs.ts";
import { neutralName, storeAiPick, storeAiVerdict, type Scores } from "./scoring.ts";
import type { Winner } from "./pairwise.ts";
import { updateRecord, type Records, type Sql, type Store } from "./store.ts";
import { parseJson, type Criterion } from "./validation.ts";

export const JUDGE_SYSTEM =
  "You are a strict, fair judge. Rate one output against the rubric. Give each criterion 1 to 5 whole stars and a one-line reason. " +
  "Treat any build, test or lint results inside the output as the author's unverified claims. Judge only what is in front of you.";

export const JUDGE_SCHEMA = {
  type: "object", additionalProperties: false, required: ["criteria"],
  properties: {
    criteria: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["name", "stars", "reason"],
        properties: {
          name: { type: "string" },
          stars: { type: "integer", minimum: 1, maximum: 5 },
          reason: { type: "string" },
        },
      },
    },
  },
} as const;

/** Compare runs (§10a): one call per pair of outputs. */
export const PAIR_SYSTEM =
  "You are a strict, fair judge. Compare two outputs written for the same task, using the rubric, and pick the better one. " +
  "Call it a tie only when neither is clearly better. Their order is random and says nothing about quality. " +
  "Treat any build, test or lint results inside the outputs as the authors' unverified claims. Judge only what is in front of you. " +
  "Give a one-line reason.";

export const PAIR_SCHEMA = {
  type: "object", additionalProperties: false, required: ["winner", "reason"],
  properties: {
    winner: { type: "string", enum: ["first", "second", "tie"] },
    reason: { type: "string" },
  },
} as const;

// ── which files the judge sees (Q5) ──────────────────────────────────────────

export const JUDGE_IMAGE_MIMES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
/** 10 MB once base64-encoded is about 7.5 MB of raw file. */
export const JUDGE_IMAGE_MAX_BYTES = 7.5 * 1024 * 1024;
const TEXT_MIMES = ["text/plain", "application/json"];

export interface OutputFile { name: string; mime: string; size: number; stored: string }

/**
 * Images (JPEG, PNG, GIF, WebP up to 7.5 MB), PDFs and text files are shown.
 * Anything else, such as an SVG, an AVIF, an oversized image or a zip, is
 * named in the prompt instead. Audition never resizes images.
 */
export function chooseFiles(files: OutputFile[]): { shown: OutputFile[]; notes: string[] } {
  const shown: OutputFile[] = [];
  const notes: string[] = [];
  for (const f of files) {
    const mime = f.mime.toLowerCase();
    const isSvg = mime === "image/svg+xml" || /\.svg$/i.test(f.name);
    if (!isSvg && JUDGE_IMAGE_MIMES.includes(mime)) {
      if (f.size <= JUDGE_IMAGE_MAX_BYTES) shown.push(f);
      else notes.push(`an image \`${f.name}\` was supplied but could not be shown to you (too large)`);
    } else if (isSvg || mime.startsWith("image/")) {
      notes.push(`an image \`${f.name}\` was supplied but could not be shown to you`);
    } else if (mime === "application/pdf" || TEXT_MIMES.includes(mime)) {
      shown.push(f);
    } else {
      notes.push(`a file \`${f.name}\` was supplied but could not be shown to you`);
    }
  }
  return { shown, notes };
}

export function rubricText(rubric: Criterion[]): string {
  return rubric.map((c, i) => `${i + 1}. ${c.name} (${c.weight}%)${c.guidance ? `: ${c.guidance}` : ""}`).join("\n");
}

/** The user message: the task as sent, the rubric, the output, and the files not shown. */
export function judgePrompt(p: { promptSent: string; rubric: Criterion[]; output: string; shown: string[]; notes: string[] }): string {
  const parts = [
    "THE TASK, AS IT WAS GIVEN TO THE AUTHOR:",
    p.promptSent.trim() || "(no prompt was stored)",
    "",
    "THE RUBRIC:",
    rubricText(p.rubric),
    "",
    "THE OUTPUT TO JUDGE:",
    p.output.trim() || "(the output has no text)",
  ];
  if (p.shown.length) parts.push("", `Files attached to this output and shown to you: ${p.shown.map((n) => `\`${n}\``).join(", ")}.`);
  if (p.notes.length) parts.push("", "Files not shown:", ...p.notes.map((n) => `- ${n}.`));
  parts.push("", `Rate each of these criteria exactly once, by name: ${p.rubric.map((c) => c.name).join(", ")}.`);
  return parts.join("\n");
}

/** The user message for a pair: the task, the rubric, then both outputs and their files. */
export function pairPrompt(p: {
  promptSent: string; rubric: Criterion[];
  first: { output: string; shown: string[]; notes: string[] };
  second: { output: string; shown: string[]; notes: string[] };
}): string {
  const side = (title: string, o: { output: string; shown: string[]; notes: string[] }) => {
    const out = [title, o.output.trim() || "(this output has no text)"];
    if (o.shown.length) out.push("", `Files of this output shown to you: ${o.shown.map((n) => `\`${n}\``).join(", ")}.`);
    if (o.notes.length) out.push("", "Files of this output not shown:", ...o.notes.map((n) => `- ${n}.`));
    return out;
  };
  return [
    "THE TASK, AS IT WAS GIVEN TO BOTH AUTHORS:",
    p.promptSent.trim() || "(no prompt was stored)",
    "",
    "THE RUBRIC (weigh the criteria by their percentages):",
    rubricText(p.rubric),
    "",
    ...side("THE FIRST OUTPUT:", p.first),
    "",
    ...side("THE SECOND OUTPUT:", p.second),
    "",
    'Reply with the winner: "first", "second" or "tie".',
  ].join("\n");
}

/** { winner: first | second | tie, reason } → the pick from the first output's side. */
export function parsePairReply(text: string): { winner: Winner; reason: string } | { error: string } {
  let body: unknown;
  try {
    body = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  } catch {
    return { error: "the reply was not JSON" };
  }
  const b = body as { winner?: unknown; reason?: unknown } | null;
  const w = typeof b?.winner === "string" ? b.winner.trim().toLowerCase() : "";
  const winner: Winner | null = w === "first" ? "this" : w === "second" ? "opponent" : w === "tie" ? "tie" : null;
  if (!winner) return { error: 'the reply has no winner of "first", "second" or "tie"' };
  return { winner, reason: typeof b?.reason === "string" ? b.reason.trim() : "" };
}

// ── the reply ────────────────────────────────────────────────────────────────

/** Every rubric name present exactly once, with whole stars from 1 to 5. */
export function parseJudgeReply(text: string, rubric: Criterion[]): { scores: Scores } | { error: string } {
  let body: unknown;
  try {
    // Some models wrap JSON in a code fence even when asked not to.
    body = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  } catch {
    return { error: "the reply was not JSON" };
  }
  const list = (body as { criteria?: unknown })?.criteria;
  if (!Array.isArray(list)) return { error: "the reply has no criteria list" };
  const scores: Scores = {};
  const names = new Set(rubric.map((c) => c.name));
  for (const item of list as Array<{ name?: unknown; stars?: unknown; reason?: unknown }>) {
    const name = typeof item?.name === "string" ? item.name : "";
    if (!names.has(name)) return { error: `the reply scored an unknown criterion "${name}"` };
    if (scores[name]) return { error: `the reply scored "${name}" twice` };
    if (typeof item.stars !== "number" || !Number.isInteger(item.stars) || item.stars < 1 || item.stars > 5) {
      return { error: `the stars for "${name}" are not a whole number from 1 to 5` };
    }
    scores[name] = { stars: item.stars, reason: typeof item.reason === "string" ? item.reason.trim() : "" };
  }
  const missing = rubric.filter((c) => !scores[c.name]).map((c) => c.name);
  if (missing.length) return { error: `the reply missed ${missing.map((m) => `"${m}"`).join(", ")}` };
  // Rubric order, so stored scores read the same way every time.
  return { scores: Object.fromEntries(rubric.map((c) => [c.name, scores[c.name]!])) };
}

// ── the judge worker's job ───────────────────────────────────────────────────

type Rec = Record<string, unknown>;
export type Generate = (input: GenerateInput) => Promise<GenerateResult>;

export interface JudgeDeps extends Store {
  sql: Sql;
  /** helpers.records: verdicts and attempts are written through the records API. */
  records: Records;
  /** helpers.find: decoded records. */
  find(collection: string, id: string): Promise<Rec | null>;
  /** helpers.query: used for the judge's key on connection_keys (F16). */
  query(collection: string, opts: { filter?: string; perPage?: number }): Promise<{ data: Rec[] }>;
  /** The bytes of an uploaded file, by its stored name. */
  readFile(stored: string): Promise<Uint8Array>;
  /** The adapter for a connection provider, or null when there is none. */
  provider(name: string): Generate | null;
  http?: unknown;
}

export type JudgeOutcome =
  | { outcome: "judged"; verdict: string; status: "active" | "overridden"; tries: number }
  | { outcome: "skipped"; reason: string }
  | { outcome: "failed"; error: string; tries: number };

const list = (v: unknown): string[] => {
  const x = parseJson(v);
  return Array.isArray(x) ? x.map(String) : typeof x === "string" && x ? [x] : [];
};

/** The output's files with their original names and types (vaultbase_files). */
async function outputFiles(sql: Sql, attemptId: string, stored: string[]): Promise<OutputFile[]> {
  if (!stored.length) return [];
  const rows = await sql.query<{ filename: string; original_name: string; mime_type: string; size: number }>(
    `SELECT filename, original_name, mime_type, size FROM vaultbase_files WHERE record_id = ? AND field_name = 'output_files'`, [attemptId],
  );
  const by = new Map(rows.map((r) => [r.filename, r]));
  return stored.map((s, i) => {
    const r = by.get(s);
    // The judge sees neutral names (file-1.png), so a file's own name can't sway it.
    return { stored: s, name: neutralName("file", i, r?.original_name || s), mime: r?.mime_type || "application/octet-stream", size: Number(r?.size ?? 0) };
  });
}

/**
 * Judge one submitted output with its run's AI judge: one call per output,
 * the reply retried once if it doesn't match the rubric, then either an
 * active AI verdict or "AI judging failed: …" on attempt.error. Never throws
 * for a provider or reply problem, so the queue never spins.
 */
export async function judgeAttempt(deps: JudgeDeps, attemptId: string): Promise<JudgeOutcome> {
  const { sql, find } = deps;
  const attempt = await find("attempts", attemptId);
  if (!attempt) return { outcome: "skipped", reason: "no such output" };
  if (attempt["status"] !== "submitted") return { outcome: "skipped", reason: `the output is ${attempt["status"]}` };
  const run = attempt["run"] ? await find("runs", String(attempt["run"])) : null;
  if (!run) return { outcome: "skipped", reason: "the output has no run" };
  if (run["judge"] !== "ai" || !run["judge_contender"]) return { outcome: "skipped", reason: "the run is not AI-judged" };
  const existing = await sql.queryOne(`SELECT id FROM vb_verdicts WHERE attempt = ? AND status = 'active' AND COALESCE(method, 'rubric') = 'rubric'`, [attemptId]);
  if (existing) return { outcome: "skipped", reason: "the output already has a verdict" };

  const fail = async (error: string, tries: number): Promise<JudgeOutcome> => {
    const message = `AI judging failed: ${error}`;
    await updateRecord(deps, "attempts", attemptId, { error: message });
    await refreshRunStatus(deps, String(run["id"]));
    return { outcome: "failed", error: message, tries };
  };

  const role = await find("roles", String(run["role"]));
  const rubric = (role ? parseJson(role["rubric"]) : null) as Criterion[] | null;
  if (!Array.isArray(rubric) || !rubric.length) return fail("the role has no rubric", 0);
  const judge = await find("contenders", String(run["judge_contender"]));
  if (!judge) return fail("the judge contender does not exist", 0);
  const conn = await find("connections", String(judge["connection"]));
  if (!conn) return fail("the judge's connection does not exist", 0);
  const provider = String(conn["provider"]);
  const generate = deps.provider(provider);
  if (!generate) return fail(`there is no adapter for the ${provider} provider`, 0);

  let apiKey: string | undefined;
  if (provider !== "mock") {
    // Server code reads the key through helpers.query (F16); the owner never can.
    const key = (await deps.query("connection_keys", { filter: `connection = "${String(conn["id"])}"`, perPage: 1 })).data[0];
    apiKey = (key?.["api_key"] as string | undefined) || undefined;
    if (!apiKey) return fail(`the connection ${String(conn["name"])} has no key`, 0);
  }

  const files = await outputFiles(sql, attemptId, list(attempt["output_files"]));
  const { shown, notes } = chooseFiles(files);
  const attachments: FileOut[] = [];
  for (const f of shown) attachments.push({ name: f.name, mime: f.mime, bytes: await deps.readFile(f.stored) });
  const prompt = judgePrompt({
    promptSent: String(attempt["prompt_sent"] ?? ""), rubric, output: String(attempt["output"] ?? ""),
    shown: shown.map((f) => f.name), notes,
  });
  const config = (parseJson(judge["config"]) ?? {}) as GenerateInput["config"];

  let lastError = "";
  for (let tryNumber = 1; tryNumber <= 2; tryNumber++) {
    let result: GenerateResult;
    try {
      result = await generate({
        model: String(judge["model"] ?? ""), config, maxOutputTokens: Number(judge["max_output_tokens"] ?? 16000),
        system: JUDGE_SYSTEM, prompt, attachments, outputSchema: JUDGE_SCHEMA,
        apiKey, baseUrl: (conn["base_url"] as string) || undefined,
        seed: mockSeed(attemptId, String(judge["id"]), tryNumber - 1), tryNumber,
        criteria: rubric.map((c) => c.name), http: deps.http,
      });
    } catch (e) {
      // helpers.http already retried the network; a provider error is final.
      const msg = e instanceof ProviderError || e instanceof Error ? e.message : String(e);
      return fail(msg, tryNumber);
    }
    const parsed = parseJudgeReply(result.text, rubric);
    if ("error" in parsed) {
      lastError = parsed.error;
      continue;
    }
    const snapshot = rubric.map((c) => ({ name: c.name, weight: c.weight, guidance: c.guidance ?? "" }));
    const v = await storeAiVerdict(deps, { attempt: attemptId, run: String(run["id"]), judgeContender: String(judge["id"]), scores: parsed.scores, rubric: snapshot });
    if (v.status === "overridden") await refreshRunStatus(deps, String(run["id"]));
    return { outcome: "judged", verdict: v.id, status: v.status, tries: tryNumber };
  }
  return fail(`${lastError} (after one retry)`, 2);
}

/** What a judge call needs: the judge contender, its adapter and its key. */
async function judgeCaller(deps: JudgeDeps, run: Rec): Promise<
  { judge: Rec; conn: Rec; generate: Generate; apiKey: string | undefined; rubric: Criterion[] } | { error: string }> {
  const role = await deps.find("roles", String(run["role"]));
  const rubric = (role ? parseJson(role["rubric"]) : null) as Criterion[] | null;
  if (!Array.isArray(rubric) || !rubric.length) return { error: "the role has no rubric" };
  const judge = await deps.find("contenders", String(run["judge_contender"]));
  if (!judge) return { error: "the judge contender does not exist" };
  const conn = await deps.find("connections", String(judge["connection"]));
  if (!conn) return { error: "the judge's connection does not exist" };
  const provider = String(conn["provider"]);
  const generate = deps.provider(provider);
  if (!generate) return { error: `there is no adapter for the ${provider} provider` };
  let apiKey: string | undefined;
  if (provider !== "mock") {
    const key = (await deps.query("connection_keys", { filter: `connection = "${String(conn["id"])}"`, perPage: 1 })).data[0];
    apiKey = (key?.["api_key"] as string | undefined) || undefined;
    if (!apiKey) return { error: `the connection ${String(conn["name"])} has no key` };
  }
  return { judge, conn, generate, apiKey, rubric };
}

/**
 * Compare runs (§10a): judge one pair with the run's AI judge, one call
 * that shows both outputs, `left` as the first and `right` as the second
 * (pairSides chose that order). The reply is retried once if it doesn't
 * parse; after that "AI judging failed: …" goes on both outputs and the
 * owner picks by hand. Never throws for a provider or reply problem.
 */
export async function judgePair(deps: JudgeDeps, leftId: string, rightId: string): Promise<JudgeOutcome> {
  const { sql, find } = deps;
  const left = await find("attempts", leftId);
  const right = await find("attempts", rightId);
  if (!left || !right) return { outcome: "skipped", reason: "no such output" };
  const ready = (a: Rec) => a["status"] === "submitted" || a["status"] === "judged";
  if (!ready(left) || !ready(right)) return { outcome: "skipped", reason: "both outputs must be submitted" };
  if (left["run"] !== right["run"] || left["task"] !== right["task"]) return { outcome: "skipped", reason: "the outputs are not from the same run and task" };
  const run = await find("runs", String(left["run"]));
  if (!run) return { outcome: "skipped", reason: "the output has no run" };
  if (run["judge"] !== "ai" || !run["judge_contender"]) return { outcome: "skipped", reason: "the run is not AI-judged" };
  if (run["method"] !== "compare") return { outcome: "skipped", reason: "the run rates outputs with stars" };
  const existing = await sql.queryOne(
    `SELECT id FROM vb_verdicts WHERE method = 'pairwise' AND status = 'active'
       AND ((attempt = ? AND opponent = ?) OR (attempt = ? AND opponent = ?))`, [leftId, rightId, rightId, leftId]);
  if (existing) return { outcome: "skipped", reason: "the pair already has a pick" };

  const fail = async (error: string, tries: number): Promise<JudgeOutcome> => {
    const message = `AI judging failed: ${error}`;
    for (const a of [left, right]) {
      const now = await find("attempts", String(a["id"]));
      if (now?.["status"] === "submitted") await updateRecord(deps, "attempts", String(a["id"]), { error: message });
    }
    await refreshRunStatus(deps, String(run["id"]));
    return { outcome: "failed", error: message, tries };
  };

  const caller = await judgeCaller(deps, run);
  if ("error" in caller) return fail(caller.error, 0);
  const { judge, conn, generate, apiKey, rubric } = caller;

  // Each output's text and files, named for the slot it is shown in (first-1.png, second-1.png).
  const sideOf = async (a: Rec, prefix: string) => {
    const files = (await outputFiles(sql, String(a["id"]), list(a["output_files"]))).map((f, i) => ({ ...f, name: neutralName(prefix, i, f.name) }));
    const { shown, notes } = chooseFiles(files);
    const attachments: FileOut[] = [];
    for (const f of shown) attachments.push({ name: f.name, mime: f.mime, bytes: await deps.readFile(f.stored) });
    return { output: String(a["output"] ?? ""), shown: shown.map((f) => f.name), notes, attachments };
  };
  const config = (parseJson(judge["config"]) ?? {}) as GenerateInput["config"];

  /** One judge call with `first` shown first; the pick from `first`'s side, or an error. */
  const ask = async (first: Rec, second: Rec, order: number): Promise<{ winner: Winner; reason: string; tries: number } | { error: string; tries: number; final: boolean }> => {
    const a = await sideOf(first, "first"), b = await sideOf(second, "second");
    const prompt = pairPrompt({ promptSent: String(left["prompt_sent"] ?? ""), rubric, first: a, second: b });
    let lastError = "";
    for (let tryNumber = 1; tryNumber <= 2; tryNumber++) {
      let result: GenerateResult;
      try {
        result = await generate({
          model: String(judge["model"] ?? ""), config, maxOutputTokens: Number(judge["max_output_tokens"] ?? 16000),
          system: PAIR_SYSTEM, prompt, attachments: [...a.attachments, ...b.attachments], outputSchema: PAIR_SCHEMA,
          apiKey, baseUrl: (conn["base_url"] as string) || undefined,
          seed: mockSeed(`${String(first["id"])}${String(second["id"])}`, String(judge["id"]), order * 2 + tryNumber - 1), tryNumber, http: deps.http,
        });
      } catch (e) {
        // helpers.http already retried the network; a provider error is final.
        return { error: e instanceof Error ? e.message : String(e), tries: tryNumber, final: true };
      }
      const parsed = parsePairReply(result.text);
      if (!("error" in parsed)) return { ...parsed, tries: tryNumber };
      lastError = parsed.error;
    }
    return { error: `${lastError} (after one retry)`, tries: 2, final: false };
  };

  const one = await ask(left, right, 0);
  if ("error" in one) return fail(one.error, one.tries);
  let winner = one.winner, reason = one.reason, tries = one.tries;
  if (run["both_orders"] === true || run["both_orders"] === 1) {
    // Both ways (§10a): ask again with the sides swapped, and keep the pick only if the two agree.
    const two = await ask(right, left, 1);
    if ("error" in two) return fail(two.error, one.tries + two.tries);
    const back: Winner = two.winner === "tie" ? "tie" : two.winner === "this" ? "opponent" : "this";
    winner = combineOrders(one.winner, back);
    reason = winner === one.winner && one.winner === back ? one.reason : `The two orders disagreed, so it counts as a tie. ${one.reason}`.trim();
    tries += two.tries;
  }
  const v = await storeAiPick(deps, { left: leftId, right: rightId, run: String(run["id"]), judgeContender: String(judge["id"]), winner, reason });
  return { outcome: "judged", verdict: v.id, status: v.status, tries };
}

/** Two picks of one pair, both from the left output's side: kept when they agree, else a tie. */
export function combineOrders(a: Winner, b: Winner): Winner {
  return a === b ? a : "tie";
}
