// One entry point for every provider call (TECH-SPEC §8, §12, F3). The
// generate worker and the judge worker (T3) both call callProvider().
import * as anthropic from "./anthropic.ts";
import * as mock from "./mock.ts";
import * as openai from "./openai-compatible.ts";
import * as openaiImages from "./openai-images.ts";
import * as replicate from "./replicate.ts";
import { ProviderError, type GenerateInput, type GenerateResult } from "./mock.ts";
import type { HttpLike, HttpRequest } from "./shared.ts";

export { ProviderError } from "./mock.ts";
export type { GenerateInput, GenerateResult, FileOut } from "./mock.ts";
export type { HttpLike } from "./shared.ts";

export type ApiProvider = "anthropic" | "openai-compatible" | "replicate" | "mock";

/** The base URL a connection's calls go to. */
export function effectiveBaseUrl(provider: string, baseUrl?: string | null): string | null {
  if (baseUrl) return baseUrl;
  if (provider === "anthropic") return anthropic.ANTHROPIC_DEFAULT_BASE_URL;
  if (provider === "replicate") return replicate.REPLICATE_DEFAULT_BASE_URL;
  return null;
}

/** The only host a connection's calls may reach, or null for the mock (no HTTP). */
export function allowedHost(provider: string, baseUrl?: string | null): string | null {
  if (provider === "mock") return null;
  const url = effectiveBaseUrl(provider, baseUrl);
  if (!url) throw new ProviderError("This connection has no base URL.", false);
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    throw new ProviderError(`The connection's base URL is not a valid URL: ${url}`, false);
  }
}

/**
 * Audition's own egress check (F3), on top of Vaultbase's private-range
 * denylist: a request whose host isn't the connection's is refused before
 * it is sent. Redirects are followed by Vaultbase's guarded fetch, which
 * checks every hop against the denylist.
 *
 * Downloads (getBytes) may reach only the hosts `fileHost` allows: a
 * Replicate connection's pictures come from replicate.delivery or
 * Replicate's R2 output bucket (§12b).
 * Every other connection downloads nothing.
 */
export function egressGuard(http: HttpLike, host: string, fileHost: (h: string) => boolean = () => false): HttpLike {
  const hostOf = (url: string): string => {
    try { return new URL(url).host.toLowerCase(); } catch { throw new ProviderError(`Refused a malformed provider URL: ${url}`, false); }
  };
  const guarded: HttpLike = {
    request(opts: HttpRequest) {
      const target = hostOf(opts.url);
      if (target !== host) {
        throw new ProviderError(`Refused a call to ${target}: this connection may only reach ${host}.`, false);
      }
      return http.request(opts);
    },
  };
  if (http.getBytes) {
    const getBytes = http.getBytes.bind(http);
    guarded.getBytes = async (url, headers, opts) => {
      const target = hostOf(url);
      if (!url.toLowerCase().startsWith("https://") || !fileHost(target)) {
        throw new ProviderError(`Refused a download from ${target}: this connection may not download from there.`, false);
      }
      return getBytes(url, headers, opts);
    };
  }
  return guarded;
}

export interface CallInput extends Omit<GenerateInput, "http" | "tryNumber"> {
  provider: ApiProvider;
  http?: HttpLike;
  /** Replicate's wait between status checks; tests pass a no-op. */
  sleep?: (ms: number) => Promise<void>;
}

export interface CallOutput {
  result: GenerateResult;
  /** How many times the provider was called for this output (the mock's retries show here). */
  calls: number;
  /** Wall time of the successful call, or the mock's seeded stand-in. */
  durationMs: number;
}

/** Tries for the in-process mock. Real providers retry inside helpers.http (F5). */
export const MOCK_TRIES = 3;

/**
 * Call the contender's provider. Throws ProviderError on failure, with
 * `calls` set on it, so the worker can record how many calls were made.
 */
export async function callProvider(input: CallInput, now: () => number = Date.now): Promise<CallOutput> {
  const { provider, http, ...rest } = input;
  if (provider === "mock") {
    let calls = 0;
    for (;;) {
      calls++;
      const started = now();
      try {
        const result = await mock.generate({ ...rest, tryNumber: calls });
        return { result, calls, durationMs: result.durationMs ?? now() - started };
      } catch (e) {
        const err = asProviderError(e);
        if (!err.retryable || calls >= MOCK_TRIES) throw withCalls(err, calls);
      }
    }
  }
  if (!http) throw new ProviderError("No HTTP client.", false);
  const host = allowedHost(provider, rest.baseUrl);
  const guarded = egressGuard(http, host!, provider === "replicate" ? replicate.isReplicateFileHost : undefined);
  const baseUrl = effectiveBaseUrl(provider, rest.baseUrl) ?? undefined;
  // An image maker (config.image) answers through the Images API; it can't
  // judge or compose, which need a text answer in a set JSON shape (§12a).
  const images = provider === "openai-compatible" && openaiImages.imageOptionsOf(rest.config) !== null;
  if ((images || provider === "replicate") && rest.outputSchema) throw withCalls(new ProviderError("This contender makes images, so it can't judge or compose.", false), 0);
  const started = now();
  try {
    const result = images
      ? await openaiImages.generate({ ...rest, baseUrl, http: guarded })
      : provider === "replicate"
      ? await replicate.generate({ ...rest, baseUrl, http: guarded, now })
      : provider === "anthropic"
      ? await anthropic.generate({ ...rest, baseUrl, http: guarded })
      : provider === "openai-compatible"
        ? await openai.generate({ ...rest, baseUrl, http: guarded })
        : unknownProvider(provider);
    return { result, calls: 1, durationMs: now() - started };
  } catch (e) {
    throw withCalls(asProviderError(e), 1);
  }
}

function unknownProvider(p: string): never {
  throw new ProviderError(`Audition can't call a "${p}" connection.`, false);
}

function asProviderError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  return new ProviderError(e instanceof Error ? e.message : String(e), false);
}

function withCalls(e: ProviderError, calls: number): ProviderError {
  (e as ProviderError & { calls?: number }).calls = calls;
  return e;
}
