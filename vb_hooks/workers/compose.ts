// The compose queue (TECH-SPEC §9a): one job per "Compose" press, payload
// { task }. All the work is in lib/composer.ts, runCompose, which never
// throws: a failure ends on tasks.compose, so the queue never spins.
import { defineWorker } from "vaultbase";
import { runCompose } from "../lib/composer.ts";
import { depsFrom } from "../lib/runs.ts";

export default defineWorker({
  name: "compose",
  queue: "compose",
  concurrency: 2,
  retries: 1,
  async run(ctx) {
    const { helpers } = ctx;
    const task = (ctx.payload as { task?: unknown } | null)?.task;
    if (typeof task !== "string") return { outcome: "skipped" };
    const result = await runCompose({ ...depsFrom(helpers), http: helpers.http, promptHelpers: helpers as never, log: (...a: unknown[]) => helpers.log(...a) }, task);
    return result;
  },
});
