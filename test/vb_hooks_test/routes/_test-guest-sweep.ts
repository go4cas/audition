// Test only: POST /api/custom/test/guest-sweep { now } runs the guest clean-up
// as if the clock read `now` (unix seconds). Admin only.
import { defineRoute } from "vaultbase";
import { sweepGuests } from "../lib/guests.ts";

export default defineRoute({
  name: "test-guest-sweep",
  method: "POST",
  path: "/test/guest-sweep",
  requireAuth: true,
  async handle(ctx) {
    if (ctx.auth?.type !== "admin") { ctx.set.status = 403; return { error: "Forbidden", code: 403 }; }
    const now = Number((ctx.body as { now?: unknown })?.now);
    return { data: { deleted: await sweepGuests(ctx.helpers as never, Number.isFinite(now) ? now : undefined) } };
  },
});
