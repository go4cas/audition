// POST /api/custom/tasks/:id/compose: ask the workspace's Composer to write
// this task's prompt (TECH-SPEC §9a). Answers at once with the task, marked
// composing; the compose worker fills composed_prompt in the background.
import { defineRoute } from "vaultbase";
import { requestCompose } from "../lib/composer.ts";
import { depsFrom, ownerRoute } from "../lib/runs.ts";

export default defineRoute({
  name: "tasks-compose",
  method: "POST",
  path: "/tasks/:id/compose",
  requireAuth: true,
  handle: (ctx) => ownerRoute(ctx, async () => ({ task: await requestCompose(depsFrom(ctx.helpers), String(ctx.params["id"])) })),
});
