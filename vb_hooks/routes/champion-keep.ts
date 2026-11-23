// POST /api/custom/champion/:roleId/keep (TECH-SPEC §7, §11a): end the
// current champion's trial.
import { defineRoute } from "vaultbase";
import { keep } from "../lib/castings.ts";
import { ownerRoute } from "../lib/runs.ts";

export default defineRoute({
  name: "champion-keep",
  method: "POST",
  path: "/champion/:roleId/keep",
  requireAuth: true,
  handle: (ctx) => ownerRoute(ctx, async () => ({ casting: await keep(ctx.helpers as never, String(ctx.params["roleId"])) })),
});
