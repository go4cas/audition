// The stale-attempt sweep (docs/PHASE-2A.md, part 1): every 5 minutes, fail
// API outputs that lost their worker, so no run hangs in "running".
import { defineJob } from "vaultbase";
import { sweepStale } from "../lib/arena.ts";
import { depsFrom } from "../lib/runs.ts";

export default defineJob({
  name: "sweep-stale-outputs",
  cron: "*/5 * * * *",
  async run(ctx) {
    const { failed } = await sweepStale(depsFrom(ctx.helpers));
    if (failed.length) ctx.helpers.log(`sweep: ${failed.length} stuck output(s) marked failed: ${failed.join(", ")}`);
  },
});
