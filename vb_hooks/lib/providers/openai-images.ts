// The OpenAI-compatible Images adapter (TECH-SPEC §12a). A contender on an
// OpenAI-compatible connection whose config has an `image` block makes images:
// Audition calls POST {base}/images/generations, or POST {base}/images/edits
// when the task has image attachments, and stores each returned image as an
// attempt file. Unit-tested against a fake http only; no real call in tests.
//
// helpers.http reads every reply as text (Vaultbase 0.46 and 0.47), so image bytes
// can't be downloaded from a link. The adapter asks for base64 in the JSON
// reply (gpt-image models always answer that way) and refuses a reply that
// only carries links, with a hint to set the format.
import { ProviderError, type FileOut, type GenerateInput, type GenerateResult } from "./mock.ts";
import { describeHttpError, httpFailure, IMAGE_MIMES, isRetryableStatus, partitionAttachments, type HttpLike } from "./shared.ts";

export interface ImageOptions {
  /** "auto" or WIDTHxHEIGHT, e.g. "1024x1024". */
  size?: string;
  /** auto, low, medium, high (gpt-image) or standard, hd (dall-e-3). */
  quality?: string;
  /** How many images per output, 1 to 4. */
  n?: number;
  /** png, jpeg or webp (gpt-image). */
  format?: string;
  /** transparent, opaque or auto (gpt-image). */
  background?: string;
  /** Ask for base64 explicitly. Needed for dall-e-2/3 and some compatible servers; gpt-image rejects it. */
  ask_b64?: boolean;
}

/** The image options of a contender's config, or null when it makes text. */
export function imageOptionsOf(config: unknown): ImageOptions | null {
  const img = (config as { image?: unknown } | null)?.image;
  return img && typeof img === "object" && !Array.isArray(img) ? (img as ImageOptions) : null;
}

/** The prompt sent: the contender's system prompt (the Images API has none) before the task prompt. */
export function imagePrompt(input: GenerateInput): string {
  const system = input.system ?? input.config.system_prompt;
  const parts = partitionAttachments(input.attachments);
  const listed = [...parts.pdfs, ...parts.texts, ...parts.listed];
  return [
    system?.trim(),
    listed.length ? `Attached files not shown here: ${listed.map((f) => f.name).join(", ")}` : "",
    input.prompt,
  ].filter(Boolean).join("\n\n");
}

/** The JSON body of /images/generations, exactly as sent. Exported for the golden test. */
export function imagesBody(input: GenerateInput, opts: ImageOptions): Record<string, unknown> {
  const body: Record<string, unknown> = { model: input.model, prompt: imagePrompt(input), n: opts.n ?? 1 };
  if (opts.size) body["size"] = opts.size;
  if (opts.quality) body["quality"] = opts.quality;
  if (opts.format) body["output_format"] = opts.format;
  if (opts.background) body["background"] = opts.background;
  if (opts.ask_b64) body["response_format"] = "b64_json";
  return body;
}

/** The multipart body of /images/edits: the task's images plus the same fields as text parts. */
export function editsBody(input: GenerateInput, opts: ImageOptions, images: FileOut[], boundary: string): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const field = (name: string, value: string) => chunks.push(enc.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  for (const [k, v] of Object.entries(imagesBody(input, opts))) field(k, String(v));
  const name = images.length > 1 ? "image[]" : "image";
  for (const f of images) {
    const safe = f.name.replace(/["\r\n]/g, "_");
    chunks.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${safe}"\r\nContent-Type: ${f.mime}\r\n\r\n`));
    chunks.push(f.bytes);
    chunks.push(enc.encode("\r\n"));
  }
  chunks.push(enc.encode(`--${boundary}--\r\n`));
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}

/** The image type from the file's first bytes (the reply doesn't always say). */
export function sniffImage(bytes: Uint8Array): { mime: string; ext: string } | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { mime: "image/png", ext: "png" };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { mime: "image/webp", ext: "webp" };
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { mime: "image/gif", ext: "gif" };
  return null;
}

interface ImagesReply {
  data?: Array<{ b64_json?: string | null; url?: string | null; revised_prompt?: string | null }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export async function generate(input: GenerateInput & { http: HttpLike }): Promise<GenerateResult> {
  if (!input.baseUrl) throw new ProviderError("This connection needs a base URL.", false);
  const opts = imageOptionsOf(input.config) ?? {};
  const base = input.baseUrl.replace(/\/+$/, "");
  const images = partitionAttachments(input.attachments).images.filter((f) => IMAGE_MIMES.includes(f.mime.toLowerCase()));
  const headers: Record<string, string> = {};
  if (input.apiKey) headers["authorization"] = `Bearer ${input.apiKey}`;
  let url: string, body: Uint8Array | Record<string, unknown>;
  if (images.length) {
    const boundary = `audition-${crypto.randomUUID()}`;
    headers["content-type"] = `multipart/form-data; boundary=${boundary}`;
    url = `${base}/images/edits`;
    body = editsBody(input, opts, images, boundary);
  } else {
    headers["content-type"] = "application/json";
    url = `${base}/images/generations`;
    body = imagesBody(input, opts);
  }
  let res;
  try {
    res = await input.http.request({ url, method: "POST", headers, body, timeoutMs: 600_000, retries: 3 });
  } catch (e) {
    throw httpFailure(e);
  }
  if (!res.ok) throw new ProviderError(describeHttpError("The image provider", res), isRetryableStatus(res.status));
  let reply = res.json as ImagesReply | undefined;
  if (reply === undefined) { try { reply = JSON.parse(res.text); } catch { reply = undefined; } }
  if (!reply || !Array.isArray(reply.data)) throw new ProviderError("The image provider sent a reply Audition could not read.", false);

  const files: FileOut[] = [];
  const lines: string[] = [];
  let links = 0;
  for (const [i, d] of reply.data.entries()) {
    if (!d?.b64_json) { if (d?.url) links++; continue; }
    const bytes = new Uint8Array(Buffer.from(d.b64_json, "base64"));
    const kind = sniffImage(bytes);
    if (!kind) throw new ProviderError("The image provider sent a file that isn't a PNG, JPEG, WebP or GIF image.", false);
    const name = `image-${i + 1}.${kind.ext}`;
    files.push({ name, mime: kind.mime, bytes });
    lines.push(d.revised_prompt ? `${name}: ${d.revised_prompt}` : name);
  }
  if (!files.length) {
    throw new ProviderError(links
      ? "The image provider sent links instead of image data. Turn on \"Ask for base64\" for this contender."
      : "The image provider returned no images.", false);
  }
  const u = reply.usage ?? {};
  return {
    text: lines.join("\n"),
    files,
    tokensIn: typeof u.input_tokens === "number" ? u.input_tokens : null,
    tokensOut: typeof u.output_tokens === "number" ? u.output_tokens : null,
    finishReason: "images",
  };
}
