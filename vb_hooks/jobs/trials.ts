// Every day at 07:00 UTC, alert the owner (email and push) about each new
// champion whose trial ended since the last run (TECH-SPEC §11a). Home keeps
// listing it in "Waiting for you" until the owner keeps or restores.
import { defineJob } from "vaultbase";
import { alertOwner, appLink } from "../lib/arena.ts";
import { trialAlert, trialsEnded } from "../lib/castings.ts";

export default defineJob({
  name: "champion-trials-ended",
  cron: "5 7 * * *",
  async run(ctx) {
    const now = ctx.scheduledAt || Math.floor(Date.now() / 1000);
    const m = { sql: ctx.helpers.sql, email: (o: never) => ctx.helpers.email(o), log: (...a: unknown[]) => ctx.helpers.log(...a), notify: (id: string, p: never) => ctx.helpers.notify(id, p) };
    for (const t of await trialsEnded(ctx.helpers.sql, now)) {
      await alertOwner(m as never, trialAlert(t, await appLink(ctx.helpers.sql, `/leaderboard/${t.role}`)));
    }
  },
});
