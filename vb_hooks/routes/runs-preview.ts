// POST /api/custom/runs/preview: call counts and warnings before a run starts (TECH-SPEC §7, §8).
import { defineRoute } from "vaultbase";
import { depsFrom, loadPlan, ownerRoute, parseRunBody, previewOf } from "../lib/runs.ts";

export default defineRoute({
  name: "runs-preview",
  method: "POST",
  path: "/runs/preview",
  requireAuth: true,
  handle: (ctx) => ownerRoute(ctx, async () => previewOf(await loadPlan(depsFrom(ctx.helpers), parseRunBody(ctx.body)))),
});
