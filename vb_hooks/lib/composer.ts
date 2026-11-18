// The Composer utility role (TECH-SPEC §9a): a contender, picked in the
// workspace settings, that rewrites a task's plain prompt into a sharper one
// before a run. The owner asks for it on a task; POST /tasks/:id/compose
// (requestCompose) marks the task "composing" and queues one `compose` job;
// the compose worker (runCompose) makes one call and stores the draft on
// tasks.composed_prompt for the owner to read and edit. When a task has a
// composed prompt, every contender gets that text instead of the generic
// template (lib/handoff.ts, promptForTask). No "vaultbase" import (F7).
import { deriveCost } from "./cost.ts";
import { promptForTask, type LoadHelpers } from "./handoff.ts";
import { callable, RunError, type Deps } from "./runs.ts";
import { callProvider, ProviderError, type HttpLike } from "./providers/index.ts";
import { mockSeed } from "./providers/mock.ts";
import { updateRecord } from "./store.ts";
import { parseJson } from "./validation.ts";

type Rec = Record<string, any>;

/** What tasks.compose holds (Cas approved the field on Nov 18, 2026). */
export interface ComposeInfo {
  status: "composing" | "done" | "failed";
  /** The Composer contender that was asked. */
  contender: string;
  /** When the owner asked (unix seconds). */
  asked_at: number;
  error?: string;
  tokens_in?: number | null;
  tokens_out?: number | null;
  cost?: number | null;
  duration_ms?: number;
  /** When the draft or the error landed (unix seconds). */
  done_at?: number;
}

export const COMPOSER_SYSTEM =
  "You write prompts for AI models and agents. You are given the plain prompt for one task. " +
  "Rewrite it into one clear, complete prompt that gets the best possible result on the first try. " +
  "Keep the task exactly as asked: do not add requirements, change its scope or answer it yourself. " +
  "Make it sharper: say who the reader is acting as, what the goal is, the steps or checks that matter, " +
  "the expected output format, and what a great answer looks like for each rubric criterion. " +
  "Keep every file name, repository and commit it mentions. " +
  "End with the WHEN DONE line from the plain prompt, word for word. " +
  "Write plain text, no Markdown headings. Reply with the prompt only.";

export const COMPOSER_SCHEMA = {
  type: "object", additionalProperties: false, required: ["prompt"],
  properties: { prompt: { type: "string" } },
} as const;

/** The composer's brief: the generic prompt as the draft to improve. */
export function composerBrief(plain: string): string {
  return `THE PLAIN PROMPT:\n${plain}\n\nRewrite it as described. Reply as JSON: {"prompt": "<the new prompt>"}.`;
}

/** The prompt from the Composer's reply: JSON {prompt}, or the plain text when a model ignores the schema. */
export function parseComposerReply(text: string): string {
  const raw = String(text ?? "").trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(raw);
  const body = fenced ? fenced[1]! : raw;
  const json = parseJson(body) as { prompt?: unknown } | null;
  if (json && typeof json === "object" && typeof json.prompt === "string") return json.prompt.trim();
  return body.trim();
}

export const composeOf = (task: Rec | null | undefined): ComposeInfo | null => {
  const c = parseJson(task?.["compose"]) as ComposeInfo | null;
  return c && typeof c === "object" && typeof c.status === "string" ? c : null;
};

/** True when a task's prompt is being written right now (a run must wait for it). */
export const isComposing = (task: Rec | null | undefined) => composeOf(task)?.status === "composing";

/** The workspace's Composer, checked: it must exist, be on and be one Audition calls. */
async function composerFor(deps: Deps, workspace: Rec): Promise<Rec> {
  const id = workspace["composer_contender"] as string | null;
  if (!id) throw new RunError(422, "This workspace has no Composer. Choose one in the workspace settings.");
  const c = await deps.find("contenders", id);
  if (!c) throw new RunError(422, "The workspace's Composer no longer exists. Choose another in the workspace settings.");
  if (c["mode"] !== "api") throw new RunError(422, "The Composer must be a contender Audition can call (not copy and paste).");
  if (c["enabled"] === false || c["enabled"] === 0) throw new RunError(422, `The Composer "${c["name"]}" is turned off.`);
  return c;
}

/**
 * POST /tasks/:id/compose: check the task and the workspace's Composer, mark
 * the task composing, and queue the job. The task must not be locked: a
 * composed prompt is part of the task, and a task used in a run can't change.
 */
export async function requestCompose(deps: Deps, taskId: string, now: () => number = Date.now): Promise<Rec> {
  const task = await deps.find("tasks", taskId);
  if (!task) throw new RunError(404, "That task does not exist.");
  if (task["locked"]) throw new RunError(409, "This task was used in a run, so its prompt can't change. Use Duplicate and edit.");
  if (isComposing(task)) throw new RunError(409, "The Composer is already writing this prompt.");
  const role = await deps.find("roles", String(task["role"]));
  if (!role) throw new RunError(404, "This task's role no longer exists.");
  const workspace = await deps.find("workspaces", String(role["workspace"]));
  if (!workspace) throw new RunError(404, "This task's workspace no longer exists.");
  const composer = await composerFor(deps, workspace);
  const asked = Math.floor(now() / 1000);
  const info: ComposeInfo = { status: "composing", contender: String(composer["id"]), asked_at: asked };
  await updateRecord(deps, "tasks", taskId, { compose: info });
  await deps.enqueue("compose", { task: taskId }, { uniqueKey: `compose:${taskId}:${asked}` });
  return (await deps.find("tasks", taskId))!;
}

export interface ComposeDeps extends Deps {
  http?: HttpLike;
  /** helpers.template etc., for the generic prompt (lib/handoff.ts). */
  promptHelpers: LoadHelpers;
  log(...args: unknown[]): void;
  now?: () => number;
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * The compose worker: one call to the Composer with the task's generic
 * prompt, then the draft on tasks.composed_prompt (or the error on
 * tasks.compose). Never throws, so the queue never spins. A task that was
 * locked meanwhile (a run started) keeps the prompt it ran with.
 */
export async function runCompose(deps: ComposeDeps, taskId: string): Promise<{ outcome: string; error?: string }> {
  const now = deps.now ?? Date.now;
  const task = await deps.find("tasks", taskId);
  if (!task) return { outcome: "skipped" };
  const info = composeOf(task);
  if (!info || info.status !== "composing") return { outcome: "skipped" };
  if (task["locked"]) {
    await updateRecord(deps, "tasks", taskId, { compose: { ...info, status: "failed", error: "A run started first, so this task keeps the prompt it ran with.", done_at: Math.floor(now() / 1000) } });
    return { outcome: "skipped" };
  }
  const fail = async (error: string) => {
    await updateRecord(deps, "tasks", taskId, { compose: { ...info, status: "failed", error: error.slice(0, 500), done_at: Math.floor(now() / 1000) } });
    deps.log(`compose task=${taskId} outcome=failed error=${error}`);
    return { outcome: "failed", error };
  };
  try {
    // Ask the generic renderer for the plain prompt: composed_prompt is ignored here.
    const plain = await promptForTask(deps.promptHelpers, taskId, { generic: true });
    const target = await callable(deps, info.contender);
    if (target.provider !== "mock" && !target.apiKey) return await fail(`The connection ${String(target.connection["name"])} has no key.`);
    const config = (parseJson(target.contender["config"]) as Rec | null) ?? {};
    const out = await callProvider({
      provider: target.provider,
      model: String(target.contender["model"] ?? ""),
      config,
      maxOutputTokens: num(target.contender["max_output_tokens"]) ?? 16000,
      system: COMPOSER_SYSTEM,
      prompt: composerBrief(plain),
      attachments: [],
      outputSchema: COMPOSER_SCHEMA,
      ...(target.apiKey ? { apiKey: target.apiKey } : {}),
      ...(target.connection["base_url"] ? { baseUrl: String(target.connection["base_url"]) } : {}),
      seed: mockSeed(taskId, info.contender, info.asked_at),
      http: deps.http,
    }, now);
    const r = out.result;
    const prompt = parseComposerReply(r.text);
    if (!prompt) return await fail(r.finishReason === "max_tokens" ? "The Composer's answer was cut off at its max output tokens." : "The Composer returned an empty answer.");
    const fresh = await deps.find("tasks", taskId);
    if (!fresh || fresh["locked"] || composeOf(fresh)?.asked_at !== info.asked_at) return { outcome: "skipped" };
    await updateRecord(deps, "tasks", taskId, {
      composed_prompt: prompt,
      compose: {
        ...info, status: "done", error: undefined,
        tokens_in: r.tokensIn, tokens_out: r.tokensOut,
        cost: deriveCost(r.tokensIn, r.tokensOut, num(target.contender["price_in_per_mtok"]), num(target.contender["price_out_per_mtok"])),
        duration_ms: Math.round(out.durationMs), done_at: Math.floor(now() / 1000),
      },
    });
    deps.log(`compose task=${taskId} outcome=done tokens_out=${r.tokensOut}`);
    return { outcome: "done" };
  } catch (e) {
    return fail(e instanceof ProviderError || e instanceof Error ? e.message : String(e));
  }
}
