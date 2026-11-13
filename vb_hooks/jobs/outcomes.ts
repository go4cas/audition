// Every day at 07:00 UTC, email and push the owner the outcome checks that came due
// since the last run (docs/PHASE-2A.md, part 3). Each check is emailed once;
// the home page keeps listing it until it is scored.
import { defineJob } from "vaultbase";
import { alertOwner, appLink } from "../lib/arena.ts";
import { DAY_S, dueEmail, dueOutcomes } from "../lib/outcomes.ts";

export default defineJob({
  name: "outcome-checks-due",
  cron: "0 7 * * *",
  async run(ctx) {
    const now = ctx.scheduledAt || Math.floor(Date.now() / 1000);
    const due = await dueOutcomes(ctx.helpers.sql, now, { since: now - DAY_S });
    const mail = dueEmail(due, await appLink(ctx.helpers.sql, "/outcomes"));
    if (!mail) return;
    await alertOwner(
      { sql: ctx.helpers.sql, email: (o) => ctx.helpers.email(o), log: (...a) => ctx.helpers.log(...a), notify: (id, p) => ctx.helpers.notify(id, p) },
      { type: "outcomes-due", subject: mail.subject, body: mail.body, push: { title: mail.title, body: mail.short, page: "/outcomes" } },
    );
  },
});
