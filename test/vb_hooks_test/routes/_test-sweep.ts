// Test only: POST /api/custom/test/sweep { now } runs the stale-attempt sweep
// as if the clock read `now` (unix seconds). Admin only.
import { defineRoute } from "vaultbase";
import { sweepStale } from "../lib/arena.ts";
import { depsFrom } from "../lib/runs.ts";

export default defineRoute({
  name: "test-sweep",
  method: "POST",
  path: "/test/sweep",
  requireAuth: true,
  async handle(ctx) {
    if (ctx.auth?.type !== "admin") { ctx.set.status = 403; return { error: "Forbidden", code: 403 }; }
    const now = Number((ctx.body as { now?: unknown })?.now);
    return { data: await sweepStale(depsFrom(ctx.helpers), Number.isFinite(now) ? now : undefined) };
  },
});
