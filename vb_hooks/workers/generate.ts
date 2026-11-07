// The generate queue (TECH-SPEC §8): one API output per job. The worker's own
// retry is off (retries 1 = one try): helpers.http already retried, and
// runGenerate never throws, so a job never spins.
import { defineWorker } from "vaultbase";
import { runGenerate, workerDepsFrom } from "../lib/runs.ts";

export default defineWorker({
  name: "generate",
  queue: "generate",
  concurrency: 4,
  retries: 1,
  async run(ctx) {
    const id = (ctx.payload as { attempt?: unknown } | null)?.attempt;
    if (typeof id !== "string") return;
    await runGenerate(workerDepsFrom(ctx.helpers), id);
  },
});
