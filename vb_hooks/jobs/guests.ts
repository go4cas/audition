// Daily clean-up of guest accounts (TECH-SPEC §10b): an anonymous guest is
// deleted GUEST_KEEP_DAYS after it was made. Its votes stay, without the guest.
import { defineJob } from "vaultbase";
import { sweepGuests } from "../lib/guests.ts";

export default defineJob({
  name: "sweep-guests",
  cron: "17 4 * * *",
  async run(ctx) {
    const n = await sweepGuests(ctx.helpers as never);
    if (n) ctx.helpers.log(`guests: ${n} old guest account(s) deleted`);
  },
});
