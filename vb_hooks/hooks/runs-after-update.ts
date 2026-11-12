// When a run finishes (or its outputs are ready for you to judge), queue an
// email to the owner (docs/PHASE-2A.md, part 4).
import { defineHook } from "vaultbase";
import { finishedNow } from "../lib/arena.ts";

export default defineHook({
  name: "runs-after-update",
  collection: "runs",
  event: "afterUpdate",
  async run(ctx) {
    if (!finishedNow(ctx.existing, ctx.record)) return;
    const id = String(ctx.record["id"]);
    await ctx.helpers.enqueue("email", { kind: "run-finished", run: id }, { uniqueKey: `run-finished:${id}:${ctx.record["status"]}` });
  },
});
