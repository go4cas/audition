// Test only: POST /api/custom/test/render { task } renders the task's prompt
// inside Vaultbase twice: with helpers.template.render (what T1's POST /runs
// uses) and with lib/handoff.ts's copy of it. Admin only.
import { defineRoute } from "vaultbase";
import { promptForTask } from "../lib/handoff.ts";

export default defineRoute({
  name: "test-render",
  method: "POST",
  path: "/test/render",
  requireAuth: true,
  async handle(ctx) {
    if (ctx.auth?.type !== "admin") { ctx.set.status = 403; return { error: "Forbidden", code: 403 }; }
    const task = String((ctx.body as { task?: string } | null)?.task ?? "");
    const server = await promptForTask(ctx.helpers, task);
    const copy = await promptForTask({ find: ctx.helpers.find, sql: ctx.helpers.sql }, task);
    return { data: { server, copy } };
  },
});
