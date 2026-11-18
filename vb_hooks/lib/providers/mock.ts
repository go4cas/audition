// The mock provider (TECH-SPEC §12): in-process, no HTTP, and deterministic
// from the seed, so tests and cloud sessions never need a real key.
import { createHash } from "node:crypto";
import { testImage } from "../png.ts";
import type { MOCK_BEHAVIOURS } from "../validation.ts";

export type MockBehaviour = (typeof MOCK_BEHAVIOURS)[number];

export interface FileOut { name: string; mime: string; bytes: Uint8Array }

export interface GenerateInput {
  model: string;
  config: { system_prompt?: string; effort?: string; temperature?: number; mock?: { behaviour: MockBehaviour } };
  maxOutputTokens: number;
  system?: string;
  prompt: string;
  attachments: FileOut[];
  outputSchema?: object;
  apiKey?: string;
  baseUrl?: string;
  /** mock only: sha256(task.id + contender.id + n), see mockSeed() */
  seed: string;
  /** mock only: which try of this attempt this is, from 1 (the flaky mock fails the first). */
  tryNumber?: number;
  /** mock judge only: the rubric criteria to score. */
  criteria?: string[];
  http?: unknown;
}

export interface GenerateResult {
  text: string;
  files: FileOut[];
  tokensIn: number | null;
  tokensOut: number | null;
  finishReason: string | null;
  /** mock only: a seeded stand-in for wall time, 200 to 2,000 ms. */
  durationMs?: number;
}

export class ProviderError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = "ProviderError";
  }
}

/** The seed for the n-th attempt (from 0) of a task by a contender. */
export function mockSeed(taskId: string, contenderId: string, n: number): string {
  return createHash("sha256").update(`${taskId}${contenderId}${n}`).digest("hex");
}

/** A number in [min, max] picked by 8 hex characters of the seed at `slot`. */
function pick(seed: string, slot: number, min: number, max: number): number {
  const hex = createHash("sha256").update(`${seed}:${slot}`).digest("hex").slice(0, 8);
  return min + (parseInt(hex, 16) % (max - min + 1));
}

const QUALITY_RE = /\[\[mock-quality:(\d)\]\]/;

/** The quality marker the mock writes into an output, or null. */
export function qualityMarker(text: string): number | null {
  const m = QUALITY_RE.exec(text);
  return m ? Number(m[1]) : null;
}

function titleOf(prompt: string): string {
  const m = /^TASK:\s*(.+)$/m.exec(prompt);
  return (m?.[1] ?? prompt.split("\n").find((l) => l.trim()) ?? "the task").trim().slice(0, 120);
}

function answer(prompt: string, quality: number): string {
  const title = titleOf(prompt);
  return [
    `Mock answer for: ${title}`,
    "",
    "1. A first point that addresses the task.",
    "2. A second point with a little more detail.",
    "3. A short recommendation.",
    "",
    `[[mock-quality:${quality}]]`,
  ].join("\n");
}

const tokensIn = (input: GenerateInput) => Math.ceil(((input.system ?? "").length + input.prompt.length) / 4);

/**
 * The Composer's reply (TECH-SPEC §9a), from any mock that isn't failing: the
 * plain prompt with a fixed "how to do well" block before its last line, so
 * tests can tell a composed prompt from the generic one.
 */
function composed(input: GenerateInput): string {
  const plain = (/THE PLAIN PROMPT:\n([\s\S]*?)\n\nRewrite it as described\./.exec(input.prompt)?.[1] ?? input.prompt).trim();
  const lines = plain.split("\n");
  const last = lines.pop() ?? "";
  const body = lines.join("\n").trimEnd();
  return JSON.stringify({
    prompt: `${body}\n\nHOW TO DO WELL (composed by the mock Composer):\n- Read the whole task before you start.\n- Cover every rubric criterion explicitly.\n- Check your answer against the rubric before you reply.\n\n${last}`,
  });
}

export async function generate(input: GenerateInput): Promise<GenerateResult> {
  const behaviour = input.config.mock?.behaviour ?? "steady";
  const seed = input.seed;
  const durationMs = pick(seed, 0, 200, 2000);
  const composing = !!(input.outputSchema as { properties?: Record<string, unknown> } | undefined)?.properties?.["prompt"];
  if (composing && behaviour !== "fail" && !(behaviour === "flaky" && (input.tryNumber ?? 1) <= 1)) {
    return { text: composed(input), files: [], tokensIn: tokensIn(input), tokensOut: 120, finishReason: "end_turn", durationMs };
  }
  switch (behaviour) {
    case "steady":
      return { text: answer(input.prompt, 4), files: [], tokensIn: tokensIn(input), tokensOut: 300, finishReason: "end_turn", durationMs };
    case "erratic": {
      const quality = pick(seed, 1, 2, 5);
      return { text: answer(input.prompt, quality), files: [], tokensIn: tokensIn(input), tokensOut: pick(seed, 2, 150, 600), finishReason: "end_turn", durationMs };
    }
    case "fail":
      throw new ProviderError("Mock Fail always fails.", false);
    case "flaky":
      if ((input.tryNumber ?? 1) <= 1) throw new ProviderError("Mock Flaky failed on its first try.", true);
      return { text: answer(input.prompt, 4), files: [], tokensIn: tokensIn(input), tokensOut: 300, finishReason: "end_turn", durationMs };
    case "image": {
      const count = pick(seed, 3, 1, 2);
      const quality = pick(seed, 4, 3, 4);
      const files: FileOut[] = [];
      for (let i = 0; i < count; i++) files.push({ name: `mock-image-${i + 1}.png`, mime: "image/png", bytes: testImage(pick(seed, 5 + i, 0, 1)) });
      const text = `${files.map((f) => `${f.name}: a warm-toned square image of a coffee bag.`).join("\n")}\n\n[[mock-quality:${quality}]]`;
      return { text, files, tokensIn: tokensIn(input), tokensOut: 50, finishReason: "end_turn", durationMs };
    }
    case "judge": {
      if (!input.outputSchema) throw new ProviderError("Mock Judge needs a judge schema.", false);
      if ((input.outputSchema as { properties?: Record<string, unknown> }).properties?.["winner"]) {
        // Compare: the output with the higher quality marker wins; equal is a tie.
        const [one, two] = input.prompt.split("THE SECOND OUTPUT:");
        const q1 = qualityMarker(one ?? "") ?? 3, q2 = qualityMarker(two ?? "") ?? 3;
        const winner = q1 > q2 ? "first" : q2 > q1 ? "second" : "tie";
        return { text: JSON.stringify({ winner, reason: "mock judge" }), files: [], tokensIn: tokensIn(input), tokensOut: 20, finishReason: "end_turn", durationMs };
      }
      const base = qualityMarker(input.prompt) ?? 3;
      const images = input.attachments.filter((a) => a.mime.startsWith("image/")).length;
      const criteria = (input.criteria ?? []).map((name) => ({
        name,
        stars: Math.min(5, Math.max(1, base + (name === "Visual quality" ? images : 0))),
        reason: "mock judge",
      }));
      return { text: JSON.stringify({ criteria }), files: [], tokensIn: tokensIn(input), tokensOut: 20 * criteria.length, finishReason: "end_turn", durationMs };
    }
  }
}
