// GET /api/custom/app/* serves the built UI from ui/dist (TECH-SPEC Q2).
// An unknown path serves index.html, because the UI is a single-page app
// with real path routes (quiver, docs/PLATFORM-UPGRADES.md part C).
import { defineRoute } from "vaultbase";
import { resolveAsset, securityHeaders } from "../lib/static.ts";

// The app's CSP: the strict policy from lib/static.ts, plus inline *style
// attributes* only (style-src-attr). The Design markup sets per-element custom
// properties such as an avatar's hue (--h) or a bar's width. Inline <style>
// elements and all inline scripts stay blocked.
const APP_CSP = securityHeaders()["content-security-policy"]!.replace("style-src 'self';", "style-src 'self'; style-src-attr 'unsafe-inline';");
const headers = () => ({ ...securityHeaders(), "content-security-policy": APP_CSP });

export default defineRoute({
  name: "app",
  method: "GET",
  path: "/app/*",
  requireAuth: false,
  async handle(ctx) {
    const { helpers } = ctx;
    const dist = helpers.os.env("AUDITION_UI_DIST")
      || helpers.path.join(helpers.os.env("VAULTBASE_HOOKS_DIR") || "vb_hooks", "..", "ui", "dist");
    const asset = await resolveAsset(dist, ctx.path, {
      exists: (p) => helpers.fs.exists(p),
      isFile: async (p) => (await helpers.fs.stat(p)).isFile,
    });
    if (!asset) {
      return new Response("The UI has not been built. Run `bun run build:ui`.", {
        status: 404, headers: { "content-type": "text/plain; charset=utf-8", ...headers() },
      });
    }
    const bytes = await helpers.fs.readBytes(asset.path);
    return new Response(bytes, {
      status: 200,
      headers: {
        "content-type": asset.mime,
        "cache-control": asset.isIndex ? "no-cache" : "public, max-age=300",
        ...headers(),
      },
    });
  },
});
