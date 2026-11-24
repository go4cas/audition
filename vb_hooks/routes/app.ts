// GET /api/custom/app/* redirects old links to the app at the site root.
// The app used to live here; since Vaultbase 0.48 it is the public folder
// (ui/dist served at /, TECH-SPEC Q2). Emails, push alerts, guest links and
// home-screen icons from before the move keep working. The redirect is a 302,
// not a 301, so a browser doesn't remember it if an older release is restored.
// The URL's #hash isn't sent to the server; the browser keeps it across the
// redirect, so a pre-quiver `/api/custom/app/#/runs/1` link still lands on
// `/#/runs/1`, which the app turns into `/runs/1` (ui/src/lib/nav.js).
import { defineRoute } from "vaultbase";
import { rootTarget } from "../lib/static.ts";

export default defineRoute({
  name: "app",
  method: "GET",
  path: "/app/*",
  requireAuth: false,
  handle(ctx) {
    return new Response(null, { status: 302, headers: { location: rootTarget(ctx.path, ctx.query), "cache-control": "no-store" } });
  },
});
