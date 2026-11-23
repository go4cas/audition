// POST /api/custom/champion/:roleId/restore (TECH-SPEC §7, §11a): bring back
// the champion before the current one, with an optional note on why.
import { defineRoute } from "vaultbase";
import { restore } from "../lib/castings.ts";
import { ownerRoute } from "../lib/runs.ts";

export default defineRoute({
  name: "champion-restore",
  method: "POST",
  path: "/champion/:roleId/restore",
  requireAuth: true,
  handle: (ctx) => ownerRoute(ctx, async () => ({ casting: await restore(ctx.helpers as never, String(ctx.params["roleId"]), (ctx.body ?? {}) as never) })),
});
