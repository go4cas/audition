// POST /api/custom/runs: start a run (TECH-SPEC §7, §8, §9).
import { defineRoute } from "vaultbase";
import { depsFrom, fallbackPromptForTask, loadPlan, ownerRoute, parseRunBody, startRun } from "../lib/runs.ts";

export default defineRoute({
  name: "runs-start",
  method: "POST",
  path: "/runs",
  requireAuth: true,
  handle: (ctx) => ownerRoute(ctx, async () => {
    const deps = depsFrom(ctx.helpers);
    const plan = await loadPlan(deps, parseRunBody(ctx.body));
    // Swap for lib/handoff.ts's promptForTask once T2 is merged.
    const id = await startRun(deps, plan, fallbackPromptForTask(deps));
    return { run: await deps.find("runs", id) };
  }),
});
