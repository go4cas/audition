// Test only: POST /api/custom/test/enqueue puts one job on a queue through
// helpers.enqueue, as T1's generate worker and T2's submit hook will. Admin only.
import { defineRoute } from "vaultbase";

export default defineRoute({
  name: "test-enqueue",
  method: "POST",
  path: "/test/enqueue",
  requireAuth: true,
  async handle(ctx) {
    if (ctx.auth?.type !== "admin") { ctx.set.status = 403; return { error: "Forbidden", code: 403 }; }
    const b = ctx.body as { queue: string; payload: unknown };
    return { data: await ctx.helpers.enqueue(b.queue, b.payload) };
  },
});
