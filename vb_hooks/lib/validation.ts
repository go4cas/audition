// Pure checks shared by the hooks and the tests. No "vaultbase" import here
// (TECH-SPEC F7), so `bun test` can import this file directly.

export interface Criterion { name: string; weight: number; guidance?: string }
export interface FitnessWeights { quality: number; tokens: number; time: number }

export const DEFAULT_FITNESS_WEIGHTS: FitnessWeights = { quality: 100, tokens: 0, time: 0 };
export const DEFAULT_MIN_OUTPUTS = 5;
export const DEFAULT_PASS_MARK = 3.5;
export const DEFAULT_MAX_OUTPUT_TOKENS = 16000;
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export const MOCK_BEHAVIOURS = ["steady", "erratic", "fail", "flaky", "image", "judge"] as const;
export const OUTPUT_TYPES = ["text", "image", "file", "code"] as const;

/** JSON fields can arrive as a string (form posts) or a value. */
export function parseJson(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch { return v; }
}

/** A JSON list field (file names, ids) as a list of non-empty strings; a lone string is a list of one. */
export function listOf(v: unknown): string[] {
  const p = parseJson(v);
  if (Array.isArray(p)) return p.filter((x) => x !== null && x !== undefined && x !== "").map(String);
  return typeof p === "string" && p ? [p] : [];
}

const isWhole = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);

/** 1 to 8 criteria, unique names, whole-number weights summing to 100. Returns an error or null. */
export function rubricError(raw: unknown): string | null {
  const rubric = parseJson(raw);
  if (!Array.isArray(rubric)) return "The rubric must be a list of criteria.";
  if (rubric.length < 1 || rubric.length > 8) return "A rubric needs 1 to 8 criteria.";
  const seen = new Set<string>();
  let sum = 0;
  for (const c of rubric as Array<Partial<Criterion>>) {
    if (!c || typeof c !== "object") return "Each criterion needs a name and a weight.";
    const name = typeof c.name === "string" ? c.name.trim() : "";
    if (!name) return "Each criterion needs a name.";
    const key = name.toLowerCase();
    if (seen.has(key)) return `Two criteria are named "${name}".`;
    seen.add(key);
    if (!isWhole(c.weight) || c.weight < 1) return `The weight of "${name}" must be a whole number from 1 to 100.`;
    if (c.guidance !== undefined && c.guidance !== null && typeof c.guidance !== "string") return `The guidance of "${name}" must be text.`;
    sum += c.weight;
  }
  if (sum !== 100) return `Criterion weights must add up to 100 (they add up to ${sum}).`;
  return null;
}

/** quality, tokens and time: whole-number percentages summing to 100. */
export function fitnessWeightsError(raw: unknown): string | null {
  const w = parseJson(raw) as Partial<FitnessWeights> | null;
  if (!w || typeof w !== "object" || Array.isArray(w)) return "Fitness weights need quality, tokens and time.";
  const keys = Object.keys(w);
  const extra = keys.filter((k) => !["quality", "tokens", "time"].includes(k));
  if (extra.length) return `Unknown fitness weight: ${extra.join(", ")}.`;
  for (const k of ["quality", "tokens", "time"] as const) {
    if (!isWhole(w[k]) || w[k]! < 0 || w[k]! > 100) return `The ${k} weight must be a whole number from 0 to 100.`;
  }
  const sum = w.quality! + w.tokens! + w.time!;
  if (sum !== 100) return `Fitness weights must add up to 100 (they add up to ${sum}).`;
  return null;
}

export type Provider = "anthropic" | "openai-compatible" | "mock" | "manual";

/** The mode a contender must have on a connection of this provider. */
export function requiredMode(provider: Provider): "api" | "handoff" {
  return provider === "manual" ? "handoff" : "api";
}

/**
 * A contender's config, normalised for its provider: temperature is dropped
 * for Anthropic (TECH-SPEC F8). Returns the config, or an error.
 */
export function normaliseContenderConfig(raw: unknown, provider: Provider): { config: Record<string, unknown> } | { error: string } {
  const parsed = parseJson(raw ?? {});
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { error: "The config must be an object." };
  const config: Record<string, unknown> = { ...(parsed as Record<string, unknown>) };
  if (config["system_prompt"] !== undefined && config["system_prompt"] !== null && typeof config["system_prompt"] !== "string") {
    return { error: "The system prompt must be text." };
  }
  if (config["effort"] !== undefined && config["effort"] !== null && !(EFFORTS as readonly string[]).includes(String(config["effort"]))) {
    return { error: `Effort must be one of ${EFFORTS.join(", ")}.` };
  }
  if (provider === "anthropic") delete config["temperature"];
  else if (config["temperature"] !== undefined && config["temperature"] !== null) {
    const t = config["temperature"];
    if (typeof t !== "number" || t < 0 || t > 2) return { error: "Temperature must be a number from 0 to 2." };
  }
  if (config["mock"] !== undefined && config["mock"] !== null) {
    if (provider !== "mock") return { error: "Only a mock connection takes a mock config." };
    const b = (config["mock"] as { behaviour?: unknown }).behaviour;
    if (!(MOCK_BEHAVIOURS as readonly string[]).includes(String(b))) return { error: `Mock behaviour must be one of ${MOCK_BEHAVIOURS.join(", ")}.` };
  }
  return { config };
}
