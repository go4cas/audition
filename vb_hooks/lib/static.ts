// The app's security policy and the old-link redirect, kept pure so they can
// be unit-tested. The UI itself is a static folder (ui/dist) that Vaultbase
// serves at the site root as its public folder (VAULTBASE_PUBLIC_DIR, with
// VAULTBASE_PUBLIC_SPA=1), docs/TECH-SPEC.md Q2. No "vaultbase" import (F7).
import { withOneSignal } from "./push.ts";

/**
 * The app's Content Security Policy. Vaultbase's public folder sends only
 * Cache-Control, Last-Modified and nosniff (0.48.0), so scripts/build-ui.ts
 * writes this policy into index.html as a <meta http-equiv> tag, where it
 * travels with the app to any server.
 *
 * Everything comes from this origin and no inline script runs. Only inline
 * style *attributes* are allowed (style-src-attr): the Design markup sets
 * per-element custom properties such as an avatar's hue (--h) or a bar's
 * width. OneSignal's SDK origins are always listed (lib/push.ts), because
 * a static file can't follow the admin's push setting; the SDK only loads
 * once the owner turns alerts on (ui/src/lib/push.js).
 *
 * A <meta> policy can't carry frame-ancestors: framing is refused at the edge
 * instead (EDGE_HEADERS), by Cloudflare or the bundled Caddy and nginx files.
 */
export const APP_CSP = withOneSignal(
  "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'",
);

/**
 * Headers a <meta> tag can't set, added in front of Vaultbase for every page
 * that isn't /api/ or the admin (deploy/Caddyfile, deploy/nginx.conf, and a
 * Cloudflare response header rule in tunnel mode, docs/RELEASE.md).
 */
export const EDGE_HEADERS: Record<string, string> = {
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
};

/**
 * Where an old link to the app (`/api/custom/app/<page>?<query>`, before the
 * app moved to the site root) goes now: the same page at the root. `rest` is
 * the route path after `/app` as Vaultbase hands it to routes/app.ts. Anything
 * that would leave this site (`//host`, a backslash) becomes `/`.
 */
export function rootTarget(rest: string, query: Record<string, string> = {}): string {
  let page = "/" + rest.replace(/^\/app\/?/, "");
  if (page.startsWith("//") || page.includes("\\")) page = "/";
  const qs = new URLSearchParams(query).toString();
  return page + (qs ? "?" + qs : "");
}
