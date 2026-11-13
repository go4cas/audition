// The email queue (docs/PHASE-2A.md, part 4): emails and push alerts to the
// owner (docs/PUSH-ALERTS.md), sent off
// the write path so a slow mail server never holds up a run. Payload
// { kind: "run-finished", run }.
import { defineWorker } from "vaultbase";
import { arenaDepsFrom, runFinishedEmail } from "../lib/arena.ts";
import { depsFrom } from "../lib/runs.ts";

export default defineWorker({
  name: "email",
  queue: "email",
  concurrency: 1,
  // One try: alertOwner never throws, it logs a failed or skipped send.
  retries: 1,
  async run(ctx) {
    const p = (ctx.payload ?? {}) as { kind?: unknown; run?: unknown };
    const deps = arenaDepsFrom(ctx.helpers, depsFrom(ctx.helpers));
    if (p.kind === "run-finished" && typeof p.run === "string") await runFinishedEmail(deps, p.run);
  },
});
