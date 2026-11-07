// POST /api/custom/runs/:id/again: the same run once more, linked by rerun_of (TECH-SPEC §7).
import { defineRoute } from "vaultbase";
import { promptForTask } from "../lib/handoff.ts";
import { depsFrom, ownerRoute, rerunPlan, startRun } from "../lib/runs.ts";

export default defineRoute({
  name: "runs-again",
  method: "POST",
  path: "/runs/:id/again",
  requireAuth: true,
  handle: (ctx) => ownerRoute(ctx, async () => {
    const deps = depsFrom(ctx.helpers);
    const runId = String(ctx.params["id"]);
    const plan = await rerunPlan(deps, runId);
    const id = await startRun(deps, plan, (taskId) => promptForTask(ctx.helpers, taskId), { rerunOf: runId });
    return { run: await deps.find("runs", id) };
  }),
});
