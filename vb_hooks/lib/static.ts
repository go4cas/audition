// Static file lookup for routes/app.ts, kept pure so it can be unit-tested.
import { join, normalize, sep } from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

export function mimeFor(path: string): string {
  const i = path.lastIndexOf(".");
  return (i >= 0 && MIME[path.slice(i).toLowerCase()]) || "application/octet-stream";
}

/** Strict CSP: everything from this origin, no inline script. */
export function securityHeaders(): Record<string, string> {
  return {
    "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    "x-content-type-options": "nosniff",
    "referrer-policy": "same-origin",
  };
}

/**
 * Cache lifetime for a served UI file. index.html is never cached (it names
 * the current build). Files whose URL changes with every build, the hashed
 * chunks and anything loaded as `?v=<content hash>` (scripts/build-ui.ts), are
 * kept for a year. Everything else (icons, the manifest) gets five minutes.
 */
export function cacheControl(routePath: string, isIndex: boolean, query: Record<string, string> = {}): string {
  if (isIndex) return "no-cache";
  if (/^\/app\/chunks\/[\w-]+\.js(\.map)?$/.test(routePath) || /^[0-9a-f]{6,64}$/.test(query["v"] ?? "")) return "public, max-age=31536000, immutable";
  return "public, max-age=300";
}

export interface FsLike { exists(p: string): Promise<boolean>; isFile(p: string): Promise<boolean> }

/**
 * Map a route path (`/app/assets/x.js`) to a file in `dist`. Paths that
 * escape `dist` are refused; anything not found falls back to index.html.
 */
export async function resolveAsset(dist: string, routePath: string, fs: FsLike): Promise<{ path: string; mime: string; isIndex: boolean } | null> {
  let rel = routePath.replace(/^\/app\/?/, "");
  try { rel = decodeURIComponent(rel); } catch { rel = ""; }
  const root = normalize(dist);
  const index = join(root, "index.html");
  if (rel && !rel.includes("\0")) {
    const candidate = normalize(join(root, rel));
    if (candidate.startsWith(root + sep) && (await fs.exists(candidate)) && (await fs.isFile(candidate))) {
      return { path: candidate, mime: mimeFor(candidate), isIndex: candidate === index };
    }
  }
  if (await fs.exists(index)) return { path: index, mime: MIME[".html"]!, isIndex: true };
  return null;
}
