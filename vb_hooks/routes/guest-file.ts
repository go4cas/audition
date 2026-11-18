// GET /api/custom/guest/:token/files/:task/:label/:i (TECH-SPEC §10b): an
// output's file for a guest, under a neutral name (A-1.png). Vaultbase's own
// file endpoint checks the attempts view rule, which only the owner passes,
// so guests get files here, checked against the link on every request.
import { defineRoute } from "vaultbase";
import { guestFile, isGuest } from "../lib/guests.ts";
import { RunError } from "../lib/runs.ts";

export default defineRoute({
  name: "guest-file",
  method: "GET",
  path: "/guest/:token/files/:task/:label/:i",
  // Off: Vaultbase counts an anonymous session as not signed in. guestRoute / isGuest check the caller.
  requireAuth: false,
  async handle(ctx) {
    if (!isGuest(ctx.auth)) { ctx.set.status = 403; return { error: "Open the link you were sent to vote.", code: 403 }; }
    try {
      const p = ctx.params;
      const f = await guestFile(ctx.helpers as never, String(p["token"]), String(ctx.auth!.id), String(p["task"]), String(p["label"]), Number(p["i"]));
      const dataDir = ctx.helpers.os.env("VAULTBASE_DATA_DIR") || "./vaultbase_data";
      const bytes = await ctx.helpers.fs.readBytes(ctx.helpers.path.join(dataDir, "uploads", f.stored));
      return new Response(bytes, {
        status: 200,
        headers: {
          "content-type": f.mime,
          "content-disposition": `inline; filename="${f.name}"`,
          "cache-control": "private, max-age=300",
          "x-content-type-options": "nosniff",
          "content-security-policy": "default-src 'none'; sandbox",
        },
      });
    } catch (e) {
      if (e instanceof RunError) { ctx.set.status = e.code; return { error: e.message, code: e.code }; }
      throw e;
    }
  },
});
