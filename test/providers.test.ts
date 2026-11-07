// Provider adapters and call plumbing against a fake http (TECH-SPEC §12, F3, F5, F8).
// T1 Done-when 3 (max_tokens), 4 (Anthropic golden JSON), 5 (cost) and 9 (egress).
import { describe, expect, test } from "bun:test";
import { anthropicBody, ANTHROPIC_VERSION } from "../vb_hooks/lib/providers/anthropic.ts";
import { openaiBody } from "../vb_hooks/lib/providers/openai-compatible.ts";
import { allowedHost, callProvider, egressGuard, MOCK_TRIES, ProviderError, type CallInput } from "../vb_hooks/lib/providers/index.ts";
import type { HttpLike } from "../vb_hooks/lib/providers/shared.ts";
import { mockSeed } from "../vb_hooks/lib/providers/mock.ts";
import { deriveCost } from "../vb_hooks/lib/cost.ts";

interface Recorded { url: string; method?: string; headers?: Record<string, string>; body: any; retries?: number; timeoutMs?: number }

/** A fake helpers.http that records every request and answers with `reply`. */
function fakeHttp(reply: (req: Recorded) => { status: number; json?: unknown; text?: string } = () => ({ status: 200, json: ANTHROPIC_OK })) {
  const calls: Recorded[] = [];
  const http: HttpLike = {
    async request(opts) {
      const rec = { ...opts, body: opts.body } as Recorded;
      calls.push(rec);
      const r = reply(rec);
      return { status: r.status, ok: r.status >= 200 && r.status < 300, headers: {}, text: r.text ?? JSON.stringify(r.json ?? null), ...(r.json !== undefined ? { json: r.json } : {}) };
    },
  };
  return { http, calls };
}

const ANTHROPIC_OK = {
  id: "msg_1", type: "message", role: "assistant",
  content: [{ type: "thinking", thinking: "…" }, { type: "text", text: "Hello " }, { type: "text", text: "world" }],
  stop_reason: "end_turn",
  usage: { input_tokens: 100, output_tokens: 42, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 },
};
const OPENAI_OK = { choices: [{ message: { content: "Hi there" }, finish_reason: "stop" }], usage: { prompt_tokens: 80, completion_tokens: 20 } };

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const PDF = new TextEncoder().encode("%PDF-1.4");

const base = (extra: Partial<CallInput> = {}): CallInput => ({
  provider: "anthropic",
  model: "claude-opus-5-5",
  config: { effort: "high", system_prompt: "Be brief.", temperature: 0.6 },
  maxOutputTokens: 12345,
  prompt: "TASK: Say hello",
  attachments: [],
  apiKey: "sk-test-fake",
  seed: "s",
  ...extra,
});

describe("Anthropic request (golden JSON)", () => {
  test("headers, URL, no temperature, effort in output_config, image and document blocks", async () => {
    const { http, calls } = fakeHttp();
    await callProvider(base({
      http,
      attachments: [
        { name: "logo.png", mime: "image/png", bytes: PNG },
        { name: "brief.pdf", mime: "application/pdf", bytes: PDF },
        { name: "notes.md", mime: "application/octet-stream", bytes: new TextEncoder().encode("# Notes") },
        { name: "code.zip", mime: "application/octet-stream", bytes: new Uint8Array([80, 75]) },
      ],
    }));
    expect(calls.length).toBe(1);
    const c = calls[0]!;
    expect(c.url).toBe("https://api.anthropic.com/v1/messages");
    expect(c.method).toBe("POST");
    expect(c.headers).toEqual({ "x-api-key": "sk-test-fake", "anthropic-version": "2026-10-21", "content-type": "application/json" });
    expect(c.timeoutMs).toBe(600000);
    expect(c.retries).toBe(3);
    const golden = await Bun.file(new URL("./golden/anthropic-request.json", import.meta.url)).json();
    expect(c.body).toEqual(golden);
    expect(JSON.stringify(c.body)).not.toContain("temperature");
    expect(ANTHROPIC_VERSION).toBe("2026-10-21");
  });

  test("output_config is left out when there is no effort and no schema", () => {
    const b = anthropicBody(base({ config: {} }) as never);
    expect(b).toEqual({ model: "claude-opus-5-5", max_tokens: 12345, messages: [{ role: "user", content: [{ type: "text", text: "TASK: Say hello" }] }] });
  });

  test("a judge call sends the schema as output_config.format", () => {
    const schema = { type: "object" };
    const b = anthropicBody(base({ outputSchema: schema, config: { effort: "low" } }) as never);
    expect(b["output_config"]).toEqual({ effort: "low", format: { type: "json_schema", schema } });
  });

  test("reply: text blocks joined, tokens include cache reads and writes, stop reason kept", async () => {
    const { http } = fakeHttp();
    const { result, calls } = await callProvider(base({ http }));
    expect(result).toEqual({ text: "Hello world", files: [], tokensIn: 115, tokensOut: 42, finishReason: "end_turn" });
    expect(calls).toBe(1);
  });

  test("a refusal is a non-retryable error naming the category", async () => {
    const { http } = fakeHttp(() => ({ status: 200, json: { content: [], stop_reason: "refusal", stop_details: { category: "cyber" }, usage: {} } }));
    const e = await callProvider(base({ http })).catch((x) => x);
    expect(e).toBeInstanceOf(ProviderError);
    expect(e.retryable).toBe(false);
    expect(e.message).toContain("cyber");
  });

  test("HTTP errors: 429 and 5xx are retryable (after helpers.http's own retries), 400 is not", async () => {
    for (const [status, retryable] of [[429, true], [529, true], [500, true], [400, false], [401, false]] as const) {
      const { http } = fakeHttp(() => ({ status, json: { error: { message: "nope" } } }));
      const e = await callProvider(base({ http })).catch((x) => x);
      expect(e).toBeInstanceOf(ProviderError);
      expect(e.retryable).toBe(retryable);
      expect(e.message).toContain(String(status));
    }
  });

  test("no key is a clear error and makes no call", async () => {
    const { http, calls } = fakeHttp();
    const e = await callProvider(base({ http, apiKey: undefined })).catch((x) => x);
    expect(e.message).toContain("no API key");
    expect(calls.length).toBe(0);
  });
});

describe("OpenAI-compatible request", () => {
  test("bearer auth, temperature and reasoning_effort, images as data URIs", async () => {
    const { http, calls } = fakeHttp(() => ({ status: 200, json: OPENAI_OK }));
    const { result } = await callProvider(base({
      provider: "openai-compatible", baseUrl: "https://llm.example.com/v1/", http,
      attachments: [{ name: "a.png", mime: "image/png", bytes: PNG }],
    }));
    const c = calls[0]!;
    expect(c.url).toBe("https://llm.example.com/v1/chat/completions");
    expect(c.headers!["authorization"]).toBe("Bearer sk-test-fake");
    expect(c.body).toEqual({
      model: "claude-opus-5-5",
      messages: [
        { role: "system", content: "Be brief." },
        { role: "user", content: [
          { type: "image_url", image_url: { url: `data:image/png;base64,${Buffer.from(PNG).toString("base64")}` } },
          { type: "text", text: "TASK: Say hello" },
        ] },
      ],
      max_tokens: 12345, temperature: 0.6, reasoning_effort: "high",
    });
    expect(result).toEqual({ text: "Hi there", files: [], tokensIn: 80, tokensOut: 20, finishReason: "stop" });
  });

  test("a judge call sends response_format json_schema", () => {
    const b = openaiBody(base({ provider: "openai-compatible", outputSchema: { type: "object" } }) as never);
    expect(b["response_format"]).toEqual({ type: "json_schema", json_schema: { name: "verdict", strict: true, schema: { type: "object" } } });
  });
});

describe("max_tokens is the contender's max_output_tokens on every call (Done-when 3)", () => {
  test("Anthropic and OpenAI-compatible, generate and judge calls, several limits", async () => {
    const { http, calls } = fakeHttp((req) => ({ status: 200, json: req.url.includes("chat/completions") ? OPENAI_OK : ANTHROPIC_OK }));
    const limits = [1, 4096, 16000, 64000];
    for (const n of limits) {
      await callProvider(base({ http, maxOutputTokens: n }));
      await callProvider(base({ http, maxOutputTokens: n, outputSchema: { type: "object" } }));
      await callProvider(base({ http, maxOutputTokens: n, provider: "openai-compatible", baseUrl: "https://llm.example.com/v1" }));
    }
    expect(calls.length).toBe(limits.length * 3);
    expect(calls.map((c) => c.body.max_tokens)).toEqual(limits.flatMap((n) => [n, n, n]));
  });
});

describe("egress check (Done-when 9)", () => {
  test("the allowed host is the connection's base URL host, or api.anthropic.com", () => {
    expect(allowedHost("anthropic", null)).toBe("api.anthropic.com");
    expect(allowedHost("anthropic", "https://proxy.example.com/anthropic")).toBe("proxy.example.com");
    expect(allowedHost("openai-compatible", "https://LLM.example.com:8443/v1")).toBe("llm.example.com:8443");
    expect(allowedHost("mock", null)).toBeNull();
    expect(() => allowedHost("openai-compatible", null)).toThrow(ProviderError);
  });

  test("a URL whose host isn't the connection's is refused before anything is sent", async () => {
    const { http, calls } = fakeHttp();
    const guarded = egressGuard(http, "api.anthropic.com");
    expect(() => guarded.request({ url: "https://evil.example.com/v1/messages" })).toThrow(/Refused a call to evil\.example\.com/);
    expect(() => guarded.request({ url: "https://api.anthropic.com.evil.example.com/x" })).toThrow(ProviderError);
    expect(() => guarded.request({ url: "not a url" })).toThrow(ProviderError);
    expect(calls.length).toBe(0);
    await guarded.request({ url: "https://api.anthropic.com/v1/messages" });
    expect(calls.length).toBe(1);
  });

  test("callProvider calls only the connection's host", async () => {
    const { http, calls } = fakeHttp();
    await callProvider(base({ http, baseUrl: "https://proxy.example.com/" }));
    expect(calls.map((c) => new URL(c.url).host)).toEqual(["proxy.example.com"]);
  });
});

describe("mock retries", () => {
  const mockInput = (behaviour: string): CallInput => ({ ...base({ provider: "mock", config: { mock: { behaviour: behaviour as never } }, seed: mockSeed("t", "c", 0) }), apiKey: undefined });
  test("flaky: one retry, so two calls, then a steady answer", async () => {
    const r = await callProvider(mockInput("flaky"));
    expect(r.calls).toBe(2);
    expect(r.result.text).toContain("[[mock-quality:4]]");
    expect(r.durationMs).toBeGreaterThanOrEqual(200);
  });
  test("steady: one call; fail: one call, not retried", async () => {
    expect((await callProvider(mockInput("steady"))).calls).toBe(1);
    const e = await callProvider(mockInput("fail")).catch((x) => x);
    expect(e).toBeInstanceOf(ProviderError);
    expect(e.calls).toBe(1);
    expect(MOCK_TRIES).toBe(3);
  });
});

describe("cost (Done-when 5)", () => {
  test("derived when both prices and both token counts are set", () => {
    expect(deriveCost(1_000_000, 500_000, 5, 25)).toBe(17.5);
    expect(deriveCost(1200, 300, 3, 15)).toBe(0.0081);
    expect(deriveCost(1200, 300, 0, 0)).toBe(0);
  });
  test("empty otherwise", () => {
    expect(deriveCost(1200, 300, null, 15)).toBeNull();
    expect(deriveCost(1200, 300, 3, undefined)).toBeNull();
    expect(deriveCost(null, 300, 3, 15)).toBeNull();
    expect(deriveCost(1200, null, 3, 15)).toBeNull();
  });
});
