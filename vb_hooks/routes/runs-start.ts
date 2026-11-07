// POST /api/custom/runs: start a run (TECH-SPEC §7, §8, §9).
import { defineRoute } from "vaultbase";
import { promptForTask } from "../lib/handoff.ts";
import { depsFrom, loadPlan, ownerRoute, parseRunBody, startRun } from "../lib/runs.ts";

export default defineRoute({
  name: "runs-start",
  method: "POST",
  path: "/runs",
  requireAuth: true,
  handle: (ctx) => ownerRoute(ctx, async () => {
    const deps = depsFrom(ctx.helpers);
    const plan = await loadPlan(deps, parseRunBody(ctx.body));
    const id = await startRun(deps, plan, (taskId) => promptForTask(ctx.helpers, taskId));
    return { run: await deps.find("runs", id) };
  }),
});
