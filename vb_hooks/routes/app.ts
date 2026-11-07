// GET /api/custom/app/* serves the built UI from ui/dist (TECH-SPEC Q2).
// An unknown path serves index.html, because the UI is a single-page app
// with hash routes. T0 serves a placeholder page; T4 builds the real UI.
import { defineRoute } from "vaultbase";
import { resolveAsset, securityHeaders } from "../lib/static.ts";

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
        status: 404, headers: { "content-type": "text/plain; charset=utf-8", ...securityHeaders() },
      });
    }
    const bytes = await helpers.fs.readBytes(asset.path);
    return new Response(bytes, {
      status: 200,
      headers: {
        "content-type": asset.mime,
        "cache-control": asset.isIndex ? "no-cache" : "public, max-age=300",
        ...securityHeaders(),
      },
    });
  },
});
