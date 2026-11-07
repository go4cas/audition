// The OpenAI-compatible Chat Completions adapter (TECH-SPEC §12). Unit-tested
// against a fake http only; Phase 1 makes no real call with it.
import { ProviderError, type GenerateInput, type GenerateResult } from "./mock.ts";
import { describeHttpError, httpFailure, isRetryableStatus, partitionAttachments, type HttpLike } from "./shared.ts";

export function openaiBody(input: GenerateInput): Record<string, unknown> {
  const parts = partitionAttachments(input.attachments);
  const content: Array<Record<string, unknown>> = [];
  for (const f of parts.images) content.push({ type: "image_url", image_url: { url: `data:${f.mime};base64,${Buffer.from(f.bytes).toString("base64")}` } });
  for (const f of parts.texts) content.push({ type: "text", text: `File: ${f.name}\n\n${new TextDecoder().decode(f.bytes)}` });
  const listed = [...parts.pdfs, ...parts.listed];
  if (listed.length) content.push({ type: "text", text: `Attached files not shown here: ${listed.map((f) => f.name).join(", ")}` });
  content.push({ type: "text", text: input.prompt });

  const messages: Array<Record<string, unknown>> = [];
  const system = input.system ?? input.config.system_prompt;
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content });

  const body: Record<string, unknown> = { model: input.model, messages, max_tokens: input.maxOutputTokens };
  if (typeof input.config.temperature === "number") body["temperature"] = input.config.temperature;
  if (input.config.effort) body["reasoning_effort"] = input.config.effort;
  if (input.outputSchema) body["response_format"] = { type: "json_schema", json_schema: { name: "verdict", strict: true, schema: input.outputSchema } };
  return body;
}

interface ChatReply {
  choices?: Array<{ message?: { content?: string | null; refusal?: string | null }; finish_reason?: string | null }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export async function generate(input: GenerateInput & { http: HttpLike }): Promise<GenerateResult> {
  if (!input.baseUrl) throw new ProviderError("This connection needs a base URL.", false);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (input.apiKey) headers["authorization"] = `Bearer ${input.apiKey}`;
  let res;
  try {
    res = await input.http.request({
      url: `${input.baseUrl.replace(/\/+$/, "")}/chat/completions`,
      method: "POST", headers, body: openaiBody(input), timeoutMs: 600_000, retries: 3,
    });
  } catch (e) {
    throw httpFailure(e);
  }
  if (!res.ok) throw new ProviderError(describeHttpError("The provider", res), isRetryableStatus(res.status));
  let reply = res.json as ChatReply | undefined;
  if (reply === undefined) { try { reply = JSON.parse(res.text); } catch { reply = undefined; } }
  const choice = reply?.choices?.[0];
  if (!choice?.message) throw new ProviderError("The provider sent a reply Audition could not read.", false);
  if (choice.message.refusal) throw new ProviderError(`The model refused: ${choice.message.refusal}`.slice(0, 500), false);
  if (choice.finish_reason === "content_filter") throw new ProviderError("The provider's content filter stopped the answer.", false);
  return {
    text: choice.message.content ?? "",
    files: [],
    tokensIn: typeof reply?.usage?.prompt_tokens === "number" ? reply.usage.prompt_tokens : null,
    tokensOut: typeof reply?.usage?.completion_tokens === "number" ? reply.usage.completion_tokens : null,
    finishReason: choice.finish_reason ?? null,
  };
}
