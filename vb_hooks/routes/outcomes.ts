// GET /api/custom/outcomes: outcome checks that are due and not scored yet,
// blind (docs/PHASE-2A.md, part 3). The home page and the outcome screen read it.
import { defineRoute } from "vaultbase";
import { dueOutcomes } from "../lib/outcomes.ts";
import { ownerRoute } from "../lib/runs.ts";

export default defineRoute({
  name: "outcomes",
  method: "GET",
  path: "/outcomes",
  requireAuth: true,
  handle: (ctx) => ownerRoute(ctx, async () => ({ due: await dueOutcomes(ctx.helpers.sql) })),
});
