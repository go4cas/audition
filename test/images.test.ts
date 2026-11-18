// Image-model adapters (TECH-SPEC §12a): the OpenAI-compatible Images API
// adapter against a fake http, the config checks, the run warnings, and one
// output on a fresh Vaultbase whose images land as attempt files with thumbs.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { editsBody, imagesBody, imageOptionsOf, sniffImage } from "../vb_hooks/lib/providers/openai-images.ts";
import { callProvider, ProviderError, type CallInput } from "../vb_hooks/lib/providers/index.ts";
import type { HttpLike } from "../vb_hooks/lib/providers/shared.ts";
import { imageOptionsError, makesImages, normaliseContenderConfig } from "../vb_hooks/lib/validation.ts";
import { imageMismatchWarnings } from "../vb_hooks/lib/runs.ts";
import { testImage } from "../vb_hooks/lib/png.ts";
import { boot, create, fixtures, type Harness } from "./harness.ts";
import { GENERIC_TEMPLATE } from "../seed/reference.ts";

const PNG = testImage(0, 32);
const PNG_B64 = Buffer.from(PNG).toString("base64");
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]);

interface Seen { url: string; headers?: Record<string, string>; body: any }
function fakeHttp(reply: () => { status: number; json?: unknown } = () => ({ status: 200, json: { data: [{ b64_json: PNG_B64, revised_prompt: "A coffee bag" }], usage: { input_tokens: 40, output_tokens: 4160 } } })) {
  const calls: Seen[] = [];
  const http: HttpLike = {
    async request(opts) {
      calls.push({ url: opts.url, headers: opts.headers, body: opts.body });
      const r = reply();
      return { status: r.status, ok: r.status < 300, headers: {}, text: JSON.stringify(r.json ?? null), ...(r.json !== undefined ? { json: r.json } : {}) };
    },
  };
  return { http, calls };
}

const input = (extra: Partial<CallInput> = {}): CallInput => ({
  provider: "openai-compatible",
  model: "gpt-image-1.5",
  config: { system_prompt: "Brand colours: brown and cream.", image: { size: "1024x1024", quality: "high", n: 2, format: "png" } },
  maxOutputTokens: 16000,
  prompt: "TASK: Design a coffee bag label",
  attachments: [],
  apiKey: "sk-test-fake",
  baseUrl: "https://api.openai.example/v1",
  seed: "s",
  ...extra,
});

describe("OpenAI-compatible Images adapter", () => {
  test("no attachments: JSON to /images/generations with the image options and the system prompt first", async () => {
    const { http, calls } = fakeHttp();
    const out = await callProvider(input({ http }));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.openai.example/v1/images/generations");
    expect(calls[0]!.headers).toEqual({ authorization: "Bearer sk-test-fake", "content-type": "application/json" });
    expect(calls[0]!.body).toEqual({
      model: "gpt-image-1.5", n: 2, size: "1024x1024", quality: "high", output_format: "png",
      prompt: "Brand colours: brown and cream.\n\nTASK: Design a coffee bag label",
    });
    expect(out.result.files).toHaveLength(1);
    expect(out.result.files[0]!.name).toBe("image-1.png");
    expect(out.result.files[0]!.mime).toBe("image/png");
    expect(out.result.files[0]!.bytes).toEqual(PNG);
    expect(out.result.text).toBe("image-1.png: A coffee bag");
    expect(out.result.tokensIn).toBe(40);
    expect(out.result.tokensOut).toBe(4160);
  });

  test("ask_b64 adds response_format; temperature is never sent", () => {
    const body = imagesBody({ ...input(), config: { temperature: 1, image: { ask_b64: true } } } as any, { ask_b64: true });
    expect(body["response_format"]).toBe("b64_json");
    expect(body["temperature"]).toBeUndefined();
    expect(body["n"]).toBe(1);
  });

  test("image attachments: multipart to /images/edits, other files only named in the prompt", async () => {
    const { http, calls } = fakeHttp();
    await callProvider(input({
      http,
      attachments: [
        { name: "logo.png", mime: "image/png", bytes: PNG },
        { name: "photo.jpg", mime: "image/jpeg", bytes: JPEG },
        { name: "brief.pdf", mime: "application/pdf", bytes: new Uint8Array([37, 80, 68, 70]) },
      ],
    }));
    expect(calls[0]!.url).toBe("https://api.openai.example/v1/images/edits");
    const ct = calls[0]!.headers!["content-type"]!;
    expect(ct).toMatch(/^multipart\/form-data; boundary=audition-/);
    const text = new TextDecoder("latin1").decode(calls[0]!.body as Uint8Array);
    const boundary = ct.split("boundary=")[1]!;
    expect(text).toContain(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\ngpt-image-1.5\r\n`);
    expect(text).toContain(`name="image[]"; filename="logo.png"\r\nContent-Type: image/png`);
    expect(text).toContain(`name="image[]"; filename="photo.jpg"\r\nContent-Type: image/jpeg`);
    expect(text).toContain("Attached files not shown here: brief.pdf");
    expect(text).not.toContain('filename="brief.pdf"');
    expect(text.endsWith(`--${boundary}--\r\n`)).toBe(true);
  });

  test("one image attachment uses the field name image", () => {
    const body = new TextDecoder().decode(editsBody(input() as any, {}, [{ name: "a.png", mime: "image/png", bytes: PNG }], "B"));
    expect(body).toContain('name="image"; filename="a.png"');
    expect(body).not.toContain("image[]");
  });

  test("links instead of bytes, no images, junk bytes and HTTP errors are clear failures", async () => {
    const run = (json: unknown, status = 200) => callProvider(input({ http: fakeHttp(() => ({ status, json })).http }));
    await expect(run({ data: [{ url: "https://cdn.example/x.png" }] })).rejects.toThrow(/links instead of image data/);
    await expect(run({ data: [] })).rejects.toThrow(/returned no images/);
    await expect(run({ data: [{ b64_json: Buffer.from("hello").toString("base64") }] })).rejects.toThrow(/isn't a PNG/);
    await expect(run({ nope: true })).rejects.toThrow(/could not read/);
    const err = await run({ error: { message: "Your request was rejected by the safety system." } }, 400).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toBe("The image provider answered 400: Your request was rejected by the safety system.");
    expect(err.retryable).toBe(false);
    expect((await run({}, 503).catch((e) => e)).retryable).toBe(true);
  });

  test("the egress guard still holds: only the connection's host is called", async () => {
    const { http, calls } = fakeHttp();
    const out = await callProvider(input({ http, baseUrl: "https://images.example.org/v1" }));
    expect(out.calls).toBe(1);
    expect(new URL(calls[0]!.url).host).toBe("images.example.org");
  });

  test("an image maker can't judge or compose (a JSON schema is asked for)", async () => {
    const { http, calls } = fakeHttp();
    await expect(callProvider(input({ http, outputSchema: { type: "object" } }))).rejects.toThrow(/makes images, so it can't judge or compose/);
    expect(calls).toHaveLength(0);
  });

  test("a text contender on the same connection still uses Chat Completions", async () => {
    const { http, calls } = fakeHttp(() => ({ status: 200, json: { choices: [{ message: { content: "hi" }, finish_reason: "stop" }] } }));
    await callProvider(input({ http, config: {} }));
    expect(calls[0]!.url).toBe("https://api.openai.example/v1/chat/completions");
  });

  test("file type sniffing", () => {
    expect(sniffImage(PNG)?.mime).toBe("image/png");
    expect(sniffImage(JPEG)?.ext).toBe("jpg");
    expect(sniffImage(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))?.mime).toBe("image/webp");
    expect(sniffImage(new TextEncoder().encode("GIF89a"))?.mime).toBe("image/gif");
    expect(sniffImage(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(imageOptionsOf({ image: { n: 1 } })).toEqual({ n: 1 });
    expect(imageOptionsOf({})).toBeNull();
  });
});

describe("image config checks", () => {
  test("valid options pass; temperature is dropped for an image maker", () => {
    expect(imageOptionsError({})).toBeNull();
    expect(imageOptionsError({ size: "1536x1024", quality: "hd", n: 4, format: "webp", background: "transparent", ask_b64: true })).toBeNull();
    expect(normaliseContenderConfig({ temperature: 1, image: { n: 2 } }, "openai-compatible")).toEqual({ config: { image: { n: 2 } } });
    expect(makesImages({ config: { image: {} } })).toBe(true);
    expect(makesImages({ config: JSON.stringify({ image: { n: 1 } }) })).toBe(true);
    expect(makesImages({ config: {} })).toBe(false);
  });
  test("bad options and other providers are refused", () => {
    expect(imageOptionsError({ size: "big" })).toMatch(/width x height/);
    expect(imageOptionsError({ n: 5 })).toMatch(/1 to 4/);
    expect(imageOptionsError({ n: 1.5 })).toMatch(/1 to 4/);
    expect(imageOptionsError({ quality: "ultra" })).toMatch(/quality/);
    expect(imageOptionsError({ format: "tiff" })).toMatch(/format/);
    expect(imageOptionsError({ style: "vivid" })).toMatch(/Unknown image option: style/);
    expect(imageOptionsError([])).toMatch(/object/);
    expect(normaliseContenderConfig({ image: {} }, "anthropic")).toEqual({ error: "Only an OpenAI-compatible connection makes images through the Images API." });
    expect(normaliseContenderConfig({ image: {} }, "mock")).toHaveProperty("error");
  });
});

describe("run warnings", () => {
  const c = (name: string, config: object, provider = "openai-compatible") => ({ contender: { name, mode: "api", config }, connection: { provider } });
  test("an image maker on a text task, and a text model on an image task, are flagged", () => {
    const tasks = [{ title: "Label", output_type: "image" }, { title: "Tagline", output_type: "text" }];
    expect(imageMismatchWarnings({ tasks, contenders: [c("Painter", { image: {} }), c("Writer", {}), c("Claude", {}, "anthropic")] })).toEqual([
      'Painter makes images, but "Tagline" asks for something else.',
      'Writer answers in text, but "Label" asks for an image.',
    ]);
    expect(imageMismatchWarnings({ tasks: [tasks[0]!], contenders: [c("Painter", { image: {} })] })).toEqual([]);
  });
});

describe("on a fresh Vaultbase", () => {
  let h: Harness;
  let f: Awaited<ReturnType<typeof fixtures>>;
  let conn: Record<string, any>;
  let painter: Record<string, any>;
  beforeAll(async () => {
    h = await boot();
    await create(h, "handoff_templates", GENERIC_TEMPLATE, "admin");
    f = await fixtures(h);
    conn = await create(h, "connections", { name: `Images ${crypto.randomUUID().slice(0, 6)}`, provider: "openai-compatible", base_url: "https://images.example.org/v1" });
    painter = await create(h, "contenders", { name: `Painter ${crypto.randomUUID().slice(0, 6)}`, connection: conn.id, model: "gpt-image-1.5", config: { temperature: 0.5, image: { size: "1024x1024", n: 2 } }, price_in_per_mtok: 5, price_out_per_mtok: 40 });
  });
  afterAll(async () => { await h?.cleanup(); });

  test("the contender hook keeps the image options and drops temperature", () => {
    expect(painter.config).toEqual({ image: { size: "1024x1024", n: 2 } });
  });

  test("the contender hook refuses bad image options", async () => {
    const r = await h.api("owner", "POST", "/api/v1/contenders", { name: `Bad ${crypto.randomUUID().slice(0, 6)}`, connection: conn.id, model: "m", config: { image: { n: 9 } } });
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.body)).toContain("1 to 4");
    const r2 = await h.api("owner", "POST", "/api/v1/contenders", { name: `Bad2 ${crypto.randomUUID().slice(0, 6)}`, connection: f.mock.id, model: "m", config: { image: {} } });
    expect(r2.status).toBe(422);
  });

  test("an image output: two images become attempt files with thumbnails, tokens and cost measured", async () => {
    const run = await h.store("insert", "runs", { workspace: f.workspace.id, role: f.role.id, tasks: [f.task.id], contenders: [painter.id], judge: "me", method: "rate", status: "running", call_count: 1 });
    const attempt = await h.store("insert", "attempts", { run, task: f.task.id, contender: painter.id, mode: "api", status: "queued", prompt_sent: "TASK: Design a coffee bag label" });
    const r = await h.api("admin", "POST", "/api/custom/test/generate", { attempt, images: [PNG_B64, Buffer.from(testImage(1, 32)).toString("base64")] });
    expect(r.status).toBe(200);
    expect(r.body.data.result).toEqual({ status: "submitted", calls: 1 });
    expect(r.body.data.seen).toHaveLength(1);
    expect(r.body.data.seen[0].url).toBe("https://images.example.org/v1/images/generations");
    expect(r.body.data.seen[0].json).toMatchObject({ model: "gpt-image-1.5", n: 2, size: "1024x1024" });

    const a = (await h.api("owner", "GET", `/api/v1/attempts/${attempt}`)).body.data;
    expect(a.status).toBe("submitted");
    expect(a.output).toBe("image-1.png\nimage-2.png");
    expect(a.output_files).toHaveLength(2);
    expect(a.tokens_in).toBe(50);
    expect(a.tokens_out).toBe(4160);
    expect(a.cost).toBeCloseTo((50 * 5 + 4160 * 40) / 1e6, 6);
    expect(a.finish_reason).toBe("images");
    const files = await h.sql<{ original_name: string; mime_type: string }>(`SELECT original_name, mime_type FROM vaultbase_files WHERE record_id = ? ORDER BY original_name`, [attempt]);
    expect(files).toEqual([{ original_name: "image-1.png", mime_type: "image/png" }, { original_name: "image-2.png", mime_type: "image/png" }]);
    // The owner can open the image and its thumbnail, as the judging screen does.
    const tok = (await h.api("owner", "POST", "/api/v1/files/token", {})).body?.data?.token;
    const q = tok ? `?token=${tok}` : "";
    const full = await fetch(`${h.url}/api/v1/files/${a.output_files[0]}${q}`, { headers: { authorization: `Bearer ${h.ownerToken}` } });
    expect(full.status).toBe(200);
    expect(new Uint8Array(await full.arrayBuffer())).toEqual(PNG);
    const thumb = await fetch(`${h.url}/api/v1/files/${a.output_files[0]}?thumb=160x120_cover${tok ? `&token=${tok}` : ""}`, { headers: { authorization: `Bearer ${h.ownerToken}` } });
    expect(thumb.status).toBe(200);
  });

  test("an image maker can't be the AI judge of a run", async () => {
    await h.api("owner", "PATCH", `/api/v1/workspaces/${f.workspace.id}`, { judge_contender: painter.id });
    const r = await h.api("owner", "POST", "/api/custom/runs/preview", { role: f.role.id, tasks: [f.task.id], contenders: [f.contender.id], judge: "ai" });
    expect(r.status).toBe(422);
    expect(r.body.error).toContain("makes images, so it can't judge");
  });

  test("the preview warns when an image maker gets a text task", async () => {
    const r = await h.api("owner", "POST", "/api/custom/runs/preview", { role: f.role.id, tasks: [f.task.id], contenders: [painter.id], judge: "me" });
    expect(r.status).toBe(200);
    expect(r.body.data.warnings).toContain(`${painter.name} makes images, but "${f.task.title}" asks for something else.`);
  });
});
