// GET /api/custom/runs/:id: the run, counts per status and every attempt, for the live view (TECH-SPEC §7, F1).
import { defineRoute } from "vaultbase";
import { depsFrom, ownerRoute, runView } from "../lib/runs.ts";

export default defineRoute({
  name: "runs-get",
  method: "GET",
  path: "/runs/:id",
  requireAuth: true,
  handle: (ctx) => ownerRoute(ctx, () => runView(depsFrom(ctx.helpers), String(ctx.params["id"]))),
});
