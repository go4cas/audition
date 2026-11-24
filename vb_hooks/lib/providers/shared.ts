// Pieces the HTTP adapters share. No "vaultbase" import.
import { ProviderError, type FileOut } from "./mock.ts";

/** The part of helpers.http the adapters use (Vaultbase src/core/hook-helpers-extra.ts). */
export interface HttpRequest {
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: string | Uint8Array | Record<string, unknown> | null;
  retries?: number;
  timeoutMs?: number;
}
export interface HttpResponse { status: number; ok: boolean; headers: Record<string, string>; text: string; json?: unknown }
export interface HttpLike {
  request(opts: HttpRequest): Promise<HttpResponse>;
  /** GET a reply as raw bytes; throws on a non-2xx status (Vaultbase 0.48, discussion #17). */
  getBytes?(url: string, headers?: Record<string, string>, opts?: { maxBytes?: number; timeoutMs?: number; retries?: number }): Promise<Uint8Array>;
}

/** Image types the providers accept as image blocks. SVG is not one of them. */
export const IMAGE_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const TEXT_EXT = /\.(txt|md|csv|log|json)$/i;

/** Split attachments by how they are sent: as images, PDFs, inline text, or listed by name. */
export function partitionAttachments(files: FileOut[]) {
  const images: FileOut[] = [], pdfs: FileOut[] = [], texts: FileOut[] = [], listed: FileOut[] = [];
  for (const f of files) {
    const mime = f.mime.toLowerCase();
    if (IMAGE_MIMES.includes(mime)) images.push(f);
    else if (mime === "application/pdf") pdfs.push(f);
    // Text files are served as octet-stream (NOTES.md F13), so the name decides too.
    else if (mime.startsWith("text/") || mime === "application/json" || TEXT_EXT.test(f.name)) texts.push(f);
    else listed.push(f);
  }
  return { images, pdfs, texts, listed };
}

export const isRetryableStatus = (s: number) => s === 429 || s === 529 || s >= 500;

export function describeHttpError(provider: string, res: HttpResponse): string {
  const j = res.json as { error?: { message?: string } | string } | undefined;
  const msg = typeof j?.error === "string" ? j.error : j?.error?.message;
  return `${provider} answered ${res.status}${msg ? `: ${msg}` : ""}`.slice(0, 500);
}

/** A thrown http error (network, timeout, egress block) as a ProviderError. */
export function httpFailure(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  const err = e instanceof Error ? e : new Error(String(e));
  const blocked = err.name === "EgressBlockedError" || /egress/i.test(err.message);
  const timeout = err.name === "AbortError" || /abort|timed? ?out/i.test(err.message);
  const msg = timeout ? "The provider did not answer in time." : `Could not reach the provider: ${err.message}`;
  return new ProviderError(msg.slice(0, 500), !blocked);
}
