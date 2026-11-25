// The Replicate adapter (TECH-SPEC §12b). A contender on a Replicate
// connection makes images with a model hosted on Replicate (Flux, Stable
// Diffusion, Ideogram, Recraft and others):
//   1. POST {base}/models/{owner}/{name}/predictions with { input }, or
//      POST {base}/predictions with { version, input } when the model id
//      carries ":<version>". "Prefer: wait" asks Replicate to hold the reply
//      until the prediction ends (up to 60 s).
//   2. While it is still starting or processing, GET its urls.get until it
//      succeeds, fails or is canceled, up to 10 minutes; then cancel it.
//   3. Download each output link (replicate.delivery, or Replicate's
//      Cloudflare R2 output bucket) as raw bytes with
//      helpers.http.getBytes (Vaultbase 0.48, discussion #17). The generate
//      worker then stores each picture on the attempt with helpers.files.save
//      (lib/files.ts, discussion #11).
// Unit-tested against a fake http only; no real call in tests.
import { ProviderError, type FileOut, type GenerateInput, type GenerateResult } from "./mock.ts";
import { describeHttpError, httpFailure, IMAGE_MIMES, isRetryableStatus, partitionAttachments, type HttpLike } from "./shared.ts";
import { sniffImage } from "./openai-images.ts";

export const REPLICATE_DEFAULT_BASE_URL = "https://api.replicate.com/v1";

/**
 * Replicate's Cloudflare R2 output bucket: since late 2026 some models answer
 * with presigned links on ai-gateway-outputs.<account id>.r2.cloudflarestorage.com
 * instead of replicate.delivery (NOTES RP9). The account id is 32 hex digits.
 */
const REPLICATE_R2_HOST = /^ai-gateway-outputs\.[0-9a-f]{32}\.r2\.cloudflarestorage\.com$/;

/** Hosts Replicate serves output files from. Downloads may reach these and nothing else. */
export function isReplicateFileHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "replicate.delivery" || h.endsWith(".replicate.delivery") || REPLICATE_R2_HOST.test(h);
}

/** The biggest picture Audition downloads: the attempts.output_files limit. */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
/** How long a prediction may run in total before Audition cancels it. */
export const MAX_WAIT_MS = 10 * 60_000;

export interface ReplicateOptions {
  /** Pictures per output, 1 to 4: sent as num_outputs. */
  n?: number;
  /** png, jpeg or webp: sent as output_format (jpeg as "jpg"). */
  format?: string;
  /** Like "1:1" or "16:9": sent as aspect_ratio. */
  aspect_ratio?: string;
  /** The model's input name for a picture, e.g. "input_image" or "image". The task's first picture goes there. */
  image_input?: string;
  /** Any other inputs of the model, sent as they are. */
  input?: Record<string, unknown>;
  /** USD per picture, for the cost column (Replicate reports no tokens). Never sent. */
  price_per_image?: number;
}

/** "owner/name" or "owner/name:version". */
export const REPLICATE_MODEL = /^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*(:[0-9a-f]{8,64})?$/;

export function replicateModelError(model: unknown): string | null {
  return typeof model === "string" && REPLICATE_MODEL.test(model.trim())
    ? null
    : 'A Replicate model id is owner/name, like "black-forest-labs/flux-schnell", or owner/name:version.';
}

/** Where the prediction is created, and the body sent. Exported for the golden test. */
export function predictionRequest(input: GenerateInput, base: string): { url: string; body: Record<string, unknown> } {
  const opts = ((input.config.image ?? {}) as ReplicateOptions);
  const parts = partitionAttachments(input.attachments);
  const images = parts.images.filter((f) => IMAGE_MIMES.includes(f.mime.toLowerCase()));
  const sent = opts.image_input && images.length ? images[0]! : null;
  const listed = [...parts.pdfs, ...parts.texts, ...parts.listed, ...images.filter((f) => f !== sent)];
  const system = input.system ?? input.config.system_prompt;
  const prompt = [
    system?.trim(),
    listed.length ? `Attached files not shown here: ${listed.map((f) => f.name).join(", ")}` : "",
    input.prompt,
  ].filter(Boolean).join("\n\n");

  const body: Record<string, unknown> = { ...(opts.input ?? {}), prompt };
  if (opts.n) body["num_outputs"] = opts.n;
  if (opts.format) body["output_format"] = opts.format === "jpeg" ? "jpg" : opts.format;
  if (opts.aspect_ratio) body["aspect_ratio"] = opts.aspect_ratio;
  // Replicate takes a data URL wherever a model takes a file.
  if (sent) body[opts.image_input!] = `data:${sent.mime};base64,${Buffer.from(sent.bytes).toString("base64")}`;

  const [ref, version] = input.model.trim().split(":");
  return version
    ? { url: `${base}/predictions`, body: { version, input: body } }
    : { url: `${base}/models/${ref}/predictions`, body: { input: body } };
}

interface Prediction {
  id?: string;
  status?: "starting" | "processing" | "succeeded" | "failed" | "canceled" | "aborted";
  output?: unknown;
  error?: unknown;
  urls?: { get?: string; cancel?: string };
}

/** Every link in a prediction's output: a string, a list, or a list inside an object. */
export function outputLinks(output: unknown): string[] {
  if (typeof output === "string") return /^https?:\/\//i.test(output) ? [output] : [];
  if (Array.isArray(output)) return output.flatMap(outputLinks);
  if (output && typeof output === "object") return Object.values(output).flatMap(outputLinks);
  return [];
}

const sleepFor = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const DONE = ["succeeded", "failed", "canceled", "aborted"];

export async function generate(input: GenerateInput & { http: HttpLike; sleep?: (ms: number) => Promise<void>; now?: () => number }): Promise<GenerateResult> {
  const { http } = input;
  const sleep = input.sleep ?? sleepFor;
  const now = input.now ?? Date.now;
  if (!http.getBytes) throw new ProviderError("This Vaultbase can't download files (it needs 0.48 or later).", false);
  if (!input.apiKey) throw new ProviderError("This Replicate connection has no API key. Add one on the Contenders page.", false);
  const modelErr = replicateModelError(input.model);
  if (modelErr) throw new ProviderError(modelErr, false);
  const base = (input.baseUrl || REPLICATE_DEFAULT_BASE_URL).replace(/\/+$/, "");
  const auth = { authorization: `Bearer ${input.apiKey}` };
  const started = now();

  const call = async (url: string, method: "GET" | "POST", body?: Record<string, unknown>, extra: Record<string, string> = {}): Promise<Prediction> => {
    let res;
    try {
      res = await http.request({
        url, method, headers: { ...auth, ...(body ? { "content-type": "application/json" } : {}), ...extra },
        ...(body ? { body } : {}), timeoutMs: 90_000, retries: 3,
      });
    } catch (e) {
      throw httpFailure(e);
    }
    if (!res.ok) {
      const j = res.json as { detail?: string; title?: string } | undefined;
      const msg = j?.detail ? `Replicate answered ${res.status}: ${j.detail}`.slice(0, 500) : describeHttpError("Replicate", res);
      throw new ProviderError(msg, isRetryableStatus(res.status));
    }
    let p = res.json as Prediction | undefined;
    if (p === undefined) { try { p = JSON.parse(res.text); } catch { p = undefined; } }
    if (!p || typeof p !== "object") throw new ProviderError("Replicate sent a reply Audition could not read.", false);
    return p;
  };

  const req = predictionRequest(input, base);
  let p = await call(req.url, "POST", req.body, { prefer: "wait=60" });
  let delay = 1000;
  while (!DONE.includes(String(p.status))) {
    const get = p.urls?.get;
    if (!get) throw new ProviderError("Replicate's reply had no status link to follow.", false);
    if (now() - started > MAX_WAIT_MS) {
      if (p.urls?.cancel) await call(p.urls.cancel, "POST", {}).catch(() => undefined);
      throw new ProviderError("Replicate did not finish the picture in 10 minutes, so Audition canceled it.", true);
    }
    await sleep(delay);
    delay = Math.min(delay * 2, 5000);
    p = await call(get, "GET");
  }
  if (p.status !== "succeeded") {
    const why = typeof p.error === "string" ? p.error : p.error ? JSON.stringify(p.error) : p.status;
    throw new ProviderError(`Replicate's prediction ${p.status}: ${why}`.slice(0, 500), false);
  }

  const links = outputLinks(p.output);
  if (!links.length) throw new ProviderError("Replicate returned no pictures.", false);
  const files: FileOut[] = [];
  for (const [i, link] of links.entries()) {
    let bytes: Uint8Array;
    try {
      bytes = await http.getBytes(link, {}, { maxBytes: MAX_IMAGE_BYTES, timeoutMs: 120_000, retries: 3 });
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      throw new ProviderError(`Could not download Replicate's picture: ${msg}`.slice(0, 500), !/max ?bytes|too large|egress/i.test(msg));
    }
    const kind = sniffImage(bytes);
    if (!kind) throw new ProviderError("Replicate sent a file that isn't a PNG, JPEG, WebP or GIF image. Choose one of those as the output format.", false);
    files.push({ name: `image-${i + 1}.${kind.ext}`, mime: kind.mime, bytes });
  }
  return {
    text: files.map((f) => f.name).join("\n"),
    files,
    tokensIn: null,
    tokensOut: null,
    finishReason: "images",
  };
}
