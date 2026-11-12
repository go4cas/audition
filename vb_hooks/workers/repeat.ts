// The repeat queue (docs/PHASE-2A.md, part 2): one job per tick of a run's
// schedule, payload { run }. The tick itself is a Vaultbase cron job named
// repeat-<run id>, made by helpers.cron.add (lib/arena.ts, setSchedule).
import { defineWorker } from "vaultbase";
import { arenaDepsFrom, repeatRun } from "../lib/arena.ts";
import { promptForTask } from "../lib/handoff.ts";
import { depsFrom } from "../lib/runs.ts";

export default defineWorker({
  name: "repeat",
  queue: "repeat",
  concurrency: 1,
  retries: 1,
  async run(ctx) {
    const run = (ctx.payload as { run?: unknown } | null)?.run;
    if (typeof run !== "string") return;
    const deps = arenaDepsFrom(ctx.helpers, depsFrom(ctx.helpers));
    await repeatRun(deps, deps, (taskId) => promptForTask(ctx.helpers as never, taskId), run);
  },
});
