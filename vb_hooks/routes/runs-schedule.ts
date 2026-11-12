// POST /api/custom/runs/:id/schedule { schedule: "<cron>" | null }: repeat a
// done run daily, weekly or monthly, or stop repeating (docs/PHASE-2A.md,
// part 2). Each schedule is a Vaultbase cron job named repeat-<run id>.
import { defineRoute } from "vaultbase";
import { setSchedule } from "../lib/arena.ts";
import { depsFrom, ownerRoute, RunError } from "../lib/runs.ts";

export default defineRoute({
  name: "runs-schedule",
  method: "POST",
  path: "/runs/:id/schedule",
  requireAuth: true,
  handle: (ctx) => ownerRoute(ctx, async () => {
    const raw = (ctx.body ?? {}) as { schedule?: unknown };
    if (raw.schedule !== null && raw.schedule !== undefined && typeof raw.schedule !== "string") {
      throw new RunError(422, "schedule must be text or null.");
    }
    const run = await setSchedule(depsFrom(ctx.helpers), ctx.helpers.cron, String(ctx.params["id"]), (raw.schedule as string | null) ?? null);
    return { run };
  }),
});
