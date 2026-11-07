// The Anthropic Messages API adapter (TECH-SPEC §12, F5, F8).
// No "vaultbase" import: http is injected, so tests pass a fake.
import { ProviderError, type FileOut, type GenerateInput, type GenerateResult } from "./mock.ts";
import { describeHttpError, httpFailure, isRetryableStatus, partitionAttachments, type HttpLike } from "./shared.ts";

export const ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com";
export const ANTHROPIC_VERSION = "2026-10-21";

/** The request body, exactly as sent. Exported for the golden test. */
export function anthropicBody(input: GenerateInput): Record<string, unknown> {
  const content: Array<Record<string, unknown>> = [];
  const parts = partitionAttachments(input.attachments);
  for (const f of parts.images) content.push({ type: "image", source: { type: "base64", media_type: f.mime, data: b64(f) } });
  for (const f of parts.pdfs) content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64(f) }, title: f.name });
  for (const f of parts.texts) content.push({ type: "text", text: `File: ${f.name}\n\n${new TextDecoder().decode(f.bytes)}` });
  if (parts.listed.length) content.push({ type: "text", text: `Attached files not shown here: ${parts.listed.map((f) => f.name).join(", ")}` });
  content.push({ type: "text", text: input.prompt });

  const body: Record<string, unknown> = { model: input.model, max_tokens: input.maxOutputTokens };
  const system = input.system ?? input.config.system_prompt;
  if (system) body["system"] = system;
  body["messages"] = [{ role: "user", content }];
  const outputConfig: Record<string, unknown> = {};
  if (input.config.effort) outputConfig["effort"] = input.config.effort;
  if (input.outputSchema) outputConfig["format"] = { type: "json_schema", schema: input.outputSchema };
  if (Object.keys(outputConfig).length) body["output_config"] = outputConfig;
  // Never temperature, top_p or top_k: API version 2026-10-21 rejects them (F8).
  return body;
}

const b64 = (f: FileOut) => Buffer.from(f.bytes).toString("base64");

interface AnthropicReply {
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string | null;
  stop_details?: { category?: string } | null;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
}

export async function generate(input: GenerateInput & { http: HttpLike }): Promise<GenerateResult> {
  if (!input.apiKey) throw new ProviderError("This Anthropic connection has no API key. Add one on the connection.", false);
  const base = (input.baseUrl || ANTHROPIC_DEFAULT_BASE_URL).replace(/\/+$/, "");
  let res;
  try {
    res = await input.http.request({
      url: `${base}/v1/messages`,
      method: "POST",
      headers: { "x-api-key": input.apiKey, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" },
      body: anthropicBody(input),
      timeoutMs: 600_000,
      retries: 3,
    });
  } catch (e) {
    throw httpFailure(e);
  }
  if (!res.ok) throw new ProviderError(describeHttpError("Anthropic", res), isRetryableStatus(res.status));
  const reply = (res.json ?? safeJson(res.text)) as AnthropicReply | undefined;
  if (!reply || !Array.isArray(reply.content)) throw new ProviderError("Anthropic sent a reply Audition could not read.", false);
  if (reply.stop_reason === "refusal") {
    const cat = reply.stop_details?.category;
    throw new ProviderError(`The model refused${cat ? ` (${cat})` : ""}.`, false);
  }
  const u = reply.usage ?? {};
  const tokensIn = typeof u.input_tokens === "number"
    ? u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
    : null;
  return {
    text: reply.content.filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text).join(""),
    files: [],
    tokensIn,
    tokensOut: typeof u.output_tokens === "number" ? u.output_tokens : null,
    finishReason: reply.stop_reason ?? null,
  };
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return undefined; }
}
