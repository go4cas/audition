// Every day at 07:00 UTC, email the owner the outcome checks that came due
// since the last run (docs/PHASE-2A.md, part 3). Each check is emailed once;
// the home page keeps listing it until it is scored.
import { defineJob } from "vaultbase";
import { appLink, emailOwner } from "../lib/arena.ts";
import { DAY_S, dueEmail, dueOutcomes } from "../lib/outcomes.ts";

export default defineJob({
  name: "outcome-checks-due",
  cron: "0 7 * * *",
  async run(ctx) {
    const now = ctx.scheduledAt || Math.floor(Date.now() / 1000);
    const due = await dueOutcomes(ctx.helpers.sql, now, { since: now - DAY_S });
    const mail = dueEmail(due, await appLink(ctx.helpers.sql, "/outcomes"));
    if (mail) await emailOwner({ sql: ctx.helpers.sql, email: (o) => ctx.helpers.email(o), log: (...a) => ctx.helpers.log(...a) }, mail.subject, mail.body);
  },
});
