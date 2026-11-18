// GET /api/custom/runs/:id: the run, counts per status and every attempt, for
// the live view (TECH-SPEC §7, F1), plus the run's guest links (§10b).
import { defineRoute } from "vaultbase";
import { linkSummary } from "../lib/guests.ts";
import { depsFrom, ownerRoute, runView } from "../lib/runs.ts";

export default defineRoute({
  name: "runs-get",
  method: "GET",
  path: "/runs/:id",
  requireAuth: true,
  handle: (ctx) => ownerRoute(ctx, async () => {
    const view = await runView(depsFrom(ctx.helpers), String(ctx.params["id"]));
    return { ...view, guests: await linkSummary(ctx.helpers.sql as never, String(ctx.params["id"])) };
  }),
});
