// POST /api/custom/outcomes/:id { stars, note? }: score a due outcome check
// once (docs/PHASE-2A.md, part 3). Written through the records API, so record
// history keeps it.
import { defineRoute } from "vaultbase";
import { OutcomeError, scoreOutcome } from "../lib/outcomes.ts";
import { depsFrom, ownerRoute, RunError } from "../lib/runs.ts";

export default defineRoute({
  name: "outcomes-score",
  method: "POST",
  path: "/outcomes/:id",
  requireAuth: true,
  handle: (ctx) => ownerRoute(ctx, async () => {
    try {
      return { verdict: await scoreOutcome(depsFrom(ctx.helpers), String(ctx.params["id"]), ctx.body) };
    } catch (e) {
      if (e instanceof OutcomeError) throw new RunError(e.code, e.message);
      throw e;
    }
  }),
});
