// Replicate image models (TECH-SPEC §12b): the adapter against a fake http
// (create, poll, download with getBytes), the egress guard on downloads, the
// config and model checks, and one output on a fresh Vaultbase whose
// pictures land as attempt files (helpers.files.save) with thumbnails.
// No real Replicate call is made.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { callProvider, ProviderError, type CallInput } from "../vb_hooks/lib/providers/index.ts";
import { isReplicateFileHost, outputLinks, predictionRequest, replicateModelError, MAX_IMAGE_BYTES } from "../vb_hooks/lib/providers/replicate.ts";
import type { HttpLike, HttpRequest } from "../vb_hooks/lib/providers/shared.ts";
import { makesImages, normaliseContenderConfig, replicateOptionsError } from "../vb_hooks/lib/validation.ts";
import { testImage } from "../vb_hooks/lib/png.ts";
import { imageCost } from "../vb_hooks/lib/cost.ts";
import { boot, create, fixtures, type Harness } from "./harness.ts";
import { GENERIC_TEMPLATE } from "../seed/reference.ts";

const PNG = testImage(2, 32);
const PNG_B64 = Buffer.from(PNG).toString("base64");
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
const API = "https://api.replicate.com/v1";
const GET = `${API}/predictions/abc`;

type Pred = Record<string, unknown>;
/** A fake Replicate: replies in order (the last repeats), files by link. */
function fakeReplicate(replies: Array<{ status?: number; json: Pred }>, files: Record<string, Uint8Array> = {}) {
  const calls: Array<{ method: string; url: string; headers?: Record<string, string>; body?: unknown; opts?: unknown }> = [];
  let i = 0;
  const http: HttpLike = {
    async request(opts: HttpRequest) {
      calls.push({ method: opts.method ?? "GET", url: opts.url, headers: opts.headers, body: opts.body });
      const r = replies[Math.min(i++, replies.length - 1)]!;
      const status = r.status ?? 200;
      return { status, ok: status < 300, headers: {}, text: JSON.stringify(r.json), json: r.json };
    },
    async getBytes(url, _headers, opts) {
      calls.push({ method: "BYTES", url, opts });
      const f = files[url];
      if (!f) throw new Error("GET answered 404");
      return f;
    },
  };
  return { http, calls };
}
const pred = (status: string, output: unknown = null, extra: Pred = {}): Pred => ({ id: "abc", status, output, urls: { get: GET, cancel: `${GET}/cancel` }, ...extra });
const link = (n: number, ext = "png") => `https://replicate.delivery/xezq/abc/out-${n}.${ext}`;

const input = (extra: Partial<CallInput> = {}): CallInput => ({
  provider: "replicate",
  model: "black-forest-labs/flux-schnell",
  config: { system_prompt: "Brand colours: brown and cream.", image: { n: 2, format: "jpeg", aspect_ratio: "16:9" } },
  maxOutputTokens: 16000,
  prompt: "TASK: Design a coffee bag label",
  attachments: [],
  apiKey: "r8_test_fake",
  seed: "s",
  sleep: async () => {},
  ...extra,
});

describe("Replicate adapter", () => {
  test("creates the prediction on the model, waits, polls, then downloads each picture as bytes", async () => {
    const { http, calls } = fakeReplicate([
      { status: 201, json: pred("starting") },
      { json: pred("processing") },
      { json: pred("succeeded", [link(0), link(1, "webp")]) },
    ], { [link(0)]: PNG, [link(1, "webp")]: WEBP });
    const out = await callProvider(input({ http }));
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `POST ${API}/models/black-forest-labs/flux-schnell/predictions`,
      `GET ${GET}`,
      `GET ${GET}`,
      `BYTES ${link(0)}`,
      `BYTES ${link(1, "webp")}`,
    ]);
    expect(calls[0]!.headers).toEqual({ authorization: "Bearer r8_test_fake", "content-type": "application/json", prefer: "wait=60" });
    expect(calls[0]!.body).toEqual({ input: {
      prompt: "Brand colours: brown and cream.\n\nTASK: Design a coffee bag label",
      num_outputs: 2, output_format: "jpg", aspect_ratio: "16:9",
    } });
    expect(calls[1]!.headers).toEqual({ authorization: "Bearer r8_test_fake" });
    // The key never goes to the file host; the download is capped at the field's size.
    expect(calls[3]!.opts).toMatchObject({ maxBytes: MAX_IMAGE_BYTES });
    expect(out.calls).toBe(1);
    expect(out.result.files.map((f) => [f.name, f.mime])).toEqual([["image-1.png", "image/png"], ["image-2.webp", "image/webp"]]);
    expect(out.result.files[0]!.bytes).toEqual(PNG);
    expect(out.result.text).toBe("image-1.png\nimage-2.webp");
    expect(out.result.tokensIn).toBeNull();
    expect(out.result.finishReason).toBe("images");
  });

  test("a pinned version goes to /predictions; a single link output works", async () => {
    const { http, calls } = fakeReplicate([{ status: 201, json: pred("succeeded", link(0)) }], { [link(0)]: PNG });
    const v = "5599ed30703defd1d160a25a63321b4dec97101d98b4674bcc56e41f62f35637";
    const out = await callProvider(input({ http, model: `stability-ai/sdxl:${v}`, config: { image: {} } }));
    expect(calls[0]!.url).toBe(`${API}/predictions`);
    expect(calls[0]!.body).toEqual({ version: v, input: { prompt: "TASK: Design a coffee bag label" } });
    expect(out.result.files).toHaveLength(1);
  });

  test("the task's first image goes to the picture input as a data URL; other files are named", () => {
    const req = predictionRequest({
      ...input(), config: { image: { image_input: "input_image", input: { seed: 7, go_fast: true } } },
      attachments: [
        { name: "ref.png", mime: "image/png", bytes: PNG },
        { name: "second.png", mime: "image/png", bytes: PNG },
        { name: "brief.md", mime: "text/markdown", bytes: new TextEncoder().encode("hi") },
      ],
    } as never, API);
    const body = (req.body as { input: Record<string, unknown> }).input;
    expect(body["input_image"]).toBe(`data:image/png;base64,${PNG_B64}`);
    expect(body["seed"]).toBe(7);
    expect(body["go_fast"]).toBe(true);
    expect(body["prompt"]).toBe("Attached files not shown here: brief.md, second.png\n\nTASK: Design a coffee bag label");
    // Without a picture input every file is only named.
    const plain = predictionRequest({ ...input(), config: { image: {} }, attachments: [{ name: "ref.png", mime: "image/png", bytes: PNG }] } as never, API);
    expect((plain.body as { input: Record<string, unknown> }).input).toEqual({ prompt: "Attached files not shown here: ref.png\n\nTASK: Design a coffee bag label" });
  });

  test("output links are found in strings, lists and objects", () => {
    expect(outputLinks(link(0))).toEqual([link(0)]);
    expect(outputLinks([link(0), null, "not a link"])).toEqual([link(0)]);
    expect(outputLinks({ images: [link(0)], seed: 3 })).toEqual([link(0)]);
    expect(outputLinks(null)).toEqual([]);
  });

  test("a failed or canceled prediction, an HTTP error and no pictures are clear failures", async () => {
    const fail = async (replies: Array<{ status?: number; json: Pred }>, files = {}) => {
      const { http } = fakeReplicate(replies, files);
      try { await callProvider(input({ http })); } catch (e) { return e as ProviderError & { calls: number }; }
      throw new Error("expected a failure");
    };
    const e1 = await fail([{ status: 201, json: pred("failed", null, { error: "NSFW content detected" }) }]);
    expect(e1.message).toBe("Replicate's prediction failed: NSFW content detected");
    expect(e1.retryable).toBe(false);
    expect(e1.calls).toBe(1);
    expect((await fail([{ status: 201, json: pred("canceled") }])).message).toContain("canceled");
    const e3 = await fail([{ status: 422, json: { title: "Invalid input", detail: "num_outputs must be at most 4" } }]);
    expect(e3.message).toBe("Replicate answered 422: num_outputs must be at most 4");
    expect(e3.retryable).toBe(false);
    expect((await fail([{ status: 429, json: { detail: "Request was throttled" } }])).retryable).toBe(true);
    expect((await fail([{ status: 201, json: pred("succeeded", []) }])).message).toBe("Replicate returned no pictures.");
  });

  test("an SVG or other non-image file is refused (the file fields take PNG, JPEG, WebP and GIF only)", async () => {
    const { http } = fakeReplicate([{ json: pred("succeeded", [link(0, "svg")]) }], { [link(0, "svg")]: SVG });
    await expect(callProvider(input({ http }))).rejects.toThrow("isn't a PNG, JPEG, WebP or GIF image");
  });

  test("a prediction still running after 10 minutes is canceled", async () => {
    const { http, calls } = fakeReplicate([{ status: 201, json: pred("processing") }]);
    let t = 0;
    const out = callProvider(input({ http, sleep: async (ms) => { t += ms; } }), () => t);
    await expect(out).rejects.toThrow("did not finish the picture in 10 minutes");
    expect(calls.at(-1)).toMatchObject({ method: "POST", url: `${GET}/cancel` });
  });

  test("egress: downloads only from replicate.delivery over https; calls only to the connection's host", async () => {
    for (const bad of ["https://evil.example/x.png", "http://replicate.delivery/x.png", "https://replicate.delivery.evil.example/x.png"]) {
      const { http, calls } = fakeReplicate([{ json: pred("succeeded", [bad]) }], { [bad]: PNG });
      await expect(callProvider(input({ http }))).rejects.toThrow("Refused a download");
      expect(calls.some((c) => c.method === "BYTES")).toBe(false);
    }
    const { http, calls } = fakeReplicate([{ status: 201, json: { ...pred("processing"), urls: { get: "https://evil.example/poll" } } }]);
    await expect(callProvider(input({ http }))).rejects.toThrow("Refused a call to evil.example");
    expect(calls).toHaveLength(1);
    expect(isReplicateFileHost("pbxt.replicate.delivery")).toBe(true);
    expect(isReplicateFileHost("replicate.com")).toBe(false);
    // Other connections may not download anything.
    const other = fakeReplicate([{ json: {} }], { [link(0)]: PNG });
    const { egressGuard } = await import("../vb_hooks/lib/providers/index.ts");
    await expect(egressGuard(other.http, "api.openai.example").getBytes!(link(0))).rejects.toThrow("Refused a download");
  });

  test("no key, a bad model id, no bytes helper, and judging are refused before any call", async () => {
    const { http, calls } = fakeReplicate([{ json: pred("succeeded", [link(0)]) }], { [link(0)]: PNG });
    await expect(callProvider(input({ http, apiKey: undefined }))).rejects.toThrow("has no API key");
    await expect(callProvider(input({ http, model: "flux-schnell" }))).rejects.toThrow("owner/name");
    await expect(callProvider(input({ http, outputSchema: {} }))).rejects.toThrow("makes images, so it can't judge or compose");
    await expect(callProvider(input({ http: { request: http.request } }))).rejects.toThrow("needs 0.48 or later");
    expect(calls).toHaveLength(0);
  });
});

describe("Replicate config checks", () => {
  test("a Replicate contender always makes images; temperature is dropped", () => {
    const out = normaliseContenderConfig({ temperature: 0.7 }, "replicate");
    expect(out).toEqual({ config: { image: {} } });
    expect(makesImages(out as { config: object })).toBe(true);
    expect(normaliseContenderConfig({ image: { n: 2, format: "webp", aspect_ratio: "3:2", image_input: "image", input: { seed: 1 } } }, "replicate"))
      .toEqual({ config: { image: { n: 2, format: "webp", aspect_ratio: "3:2", image_input: "image", input: { seed: 1 } } } });
  });

  test("bad options are refused with plain messages", () => {
    expect(replicateOptionsError({ size: "1024x1024" })).toBe("Unknown Replicate option: size.");
    expect(replicateOptionsError({ n: 5 })).toContain("1 to 4");
    expect(replicateOptionsError({ format: "svg" })).toContain("png, jpeg, webp");
    expect(replicateOptionsError({ aspect_ratio: "wide" })).toContain("width:height");
    expect(replicateOptionsError({ image_input: "bad name" })).toContain("input name");
    expect(replicateOptionsError({ input: [1] })).toContain("must be an object");
    expect(replicateOptionsError({ price_per_image: -1 })).toContain("price per image");
    expect(replicateOptionsError({ price_per_image: "0.01" })).toContain("price per image");
    expect(replicateOptionsError({ price_per_image: 0.04 })).toBeNull();
    expect(replicateOptionsError({ input: { prompt: "x" } })).toContain("can't set prompt");
    expect(replicateOptionsError({ input: { big: "x".repeat(10_001) } })).toContain("too long");
    // OpenAI's options still don't fit a Replicate contender, and the other way round.
    expect(normaliseContenderConfig({ image: { aspect_ratio: "1:1" } }, "openai-compatible")).toEqual({ error: "Unknown image option: aspect_ratio." });
    expect(normaliseContenderConfig({ image: {} }, "anthropic")).toEqual({ error: "Only an OpenAI-compatible or Replicate connection makes images." });
  });

  test("price per image: pictures × price, never sent to Replicate", () => {
    expect(imageCost(3, 0.04)).toBeCloseTo(0.12, 6);
    expect(imageCost(2, undefined)).toBeNull();
    const req = predictionRequest({ ...input(), config: { image: { price_per_image: 0.04 } } } as never, API);
    expect(JSON.stringify(req.body)).not.toContain("price");
  });

  test("model ids", () => {
    expect(replicateModelError("black-forest-labs/flux-1.1-pro")).toBeNull();
    expect(replicateModelError("stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b")).toBeNull();
    expect(replicateModelError("flux")).not.toBeNull();
    expect(replicateModelError("a/b/c")).not.toBeNull();
    expect(replicateModelError("a/b:not-hex")).not.toBeNull();
  });
});

describe("on a fresh Vaultbase", () => {
  let h: Harness;
  let f: Awaited<ReturnType<typeof fixtures>>;
  let conn: Record<string, any>;
  let flux: Record<string, any>;
  beforeAll(async () => {
    h = await boot();
    await create(h, "handoff_templates", GENERIC_TEMPLATE, "admin");
    f = await fixtures(h);
    // No base URL: a Replicate connection defaults to api.replicate.com.
    conn = await create(h, "connections", { name: `Replicate ${crypto.randomUUID().slice(0, 6)}`, provider: "replicate" });
    // The key is write-only: the create answers 200 with no record (F2).
    expect((await h.api("owner", "POST", "/api/v1/connection_keys", { connection: conn.id, api_key: "r8_test_fake" })).status).toBe(200);
    flux = await create(h, "contenders", { name: `Flux ${crypto.randomUUID().slice(0, 6)}`, connection: conn.id, model: "black-forest-labs/flux-schnell", config: { temperature: 1, image: { n: 2, price_per_image: 0.003 } } });
  });
  afterAll(async () => { await h?.cleanup(); });

  test("the contender hook keeps the options, drops temperature, and refuses a bad model id", async () => {
    expect(flux.mode).toBe("api");
    expect(flux.config).toEqual({ image: { n: 2, price_per_image: 0.003 } });
    const plain = await create(h, "contenders", { name: `Plain ${crypto.randomUUID().slice(0, 6)}`, connection: conn.id, model: "black-forest-labs/flux-dev" });
    expect(plain.config).toEqual({ image: {} });
    const bad = await h.api("owner", "POST", "/api/v1/contenders", { name: `Bad ${crypto.randomUUID().slice(0, 6)}`, connection: conn.id, model: "flux" });
    expect(bad.status).toBe(422);
    expect(JSON.stringify(bad.body)).toContain("owner/name");
    const badOpt = await h.api("owner", "POST", "/api/v1/contenders", { name: `Bad2 ${crypto.randomUUID().slice(0, 6)}`, connection: conn.id, model: "a/b", config: { image: { size: "1024x1024" } } });
    expect(badOpt.status).toBe(422);
  });

  test("a Replicate output: the pictures are downloaded and saved on the attempt with thumbnails", async () => {
    const run = await h.store("insert", "runs", { workspace: f.workspace.id, role: f.role.id, tasks: [f.task.id], contenders: [flux.id], judge: "me", method: "rate", status: "running", call_count: 1 });
    const attempt = await h.store("insert", "attempts", { run, task: f.task.id, contender: flux.id, mode: "api", status: "queued", prompt_sent: "TASK: Design a coffee bag label" });
    const r = await h.api("admin", "POST", "/api/custom/test/generate", { attempt, replicate: true, images: [PNG_B64, Buffer.from(testImage(3, 32)).toString("base64")] });
    expect(r.status).toBe(200);
    expect(r.body.data.result).toEqual({ status: "submitted", calls: 1 });
    const seen = r.body.data.seen as Array<{ url: string; method: string; json?: any }>;
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual([
      "POST https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions",
      "GET https://api.replicate.com/v1/predictions/p1",
      "GET bytes https://replicate.delivery/xezq/test/out-0.png",
      "GET bytes https://replicate.delivery/xezq/test/out-1.png",
    ]);
    expect(seen[0]!.json).toEqual({ input: { prompt: "TASK: Design a coffee bag label", num_outputs: 2 } });

    const a = (await h.api("owner", "GET", `/api/v1/attempts/${attempt}`)).body.data;
    expect(a.status).toBe("submitted");
    expect(a.output).toBe("image-1.png\nimage-2.png");
    expect(a.output_files).toHaveLength(2);
    expect(a.tokens_in ?? null).toBeNull();
    // Priced per picture: 2 × $0.003.
    expect(a.cost).toBeCloseTo(0.006, 6);
    expect(a.finish_reason).toBe("images");
    const files = await h.sql<{ original_name: string; mime_type: string }>(`SELECT original_name, mime_type FROM vaultbase_files WHERE record_id = ? ORDER BY original_name`, [attempt]);
    expect(files).toEqual([{ original_name: "image-1.png", mime_type: "image/png" }, { original_name: "image-2.png", mime_type: "image/png" }]);
    const tok = (await h.api("owner", "POST", "/api/v1/files/token", {})).body?.data?.token;
    const q = tok ? `?token=${tok}` : "";
    const full = await fetch(`${h.url}/api/v1/files/${a.output_files[0]}${q}`, { headers: { authorization: `Bearer ${h.ownerToken}` } });
    expect(full.status).toBe(200);
    expect(new Uint8Array(await full.arrayBuffer())).toEqual(PNG);
    const thumb = await fetch(`${h.url}/api/v1/files/${a.output_files[0]}?thumb=160x120_cover${tok ? `&token=${tok}` : ""}`, { headers: { authorization: `Bearer ${h.ownerToken}` } });
    expect(thumb.status).toBe(200);
  });

  test("the preview warns when a Replicate contender gets a text task", async () => {
    const r = await h.api("owner", "POST", "/api/custom/runs/preview", { role: f.role.id, tasks: [f.task.id], contenders: [flux.id], judge: "me" });
    expect(r.status).toBe(200);
    expect(r.body.data.warnings).toContain(`${flux.name} makes images, but "${f.task.title}" asks for something else.`);
  });

  test("a Replicate contender can't be the AI judge of a run", async () => {
    await h.api("owner", "PATCH", `/api/v1/workspaces/${f.workspace.id}`, { judge_contender: flux.id });
    const r = await h.api("owner", "POST", "/api/custom/runs/preview", { role: f.role.id, tasks: [f.task.id], contenders: [f.contender.id], judge: "ai" });
    expect(r.status).toBe(422);
    expect(r.body.error).toContain("makes images, so it can't judge");
  });
});
