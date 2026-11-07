import { defineHook } from "vaultbase";
import { attemptAfterUpdate } from "../lib/handoff.ts";
import { updateRecord } from "../lib/store.ts";

export default defineHook({
  name: "attempts-after-update",
  collection: "attempts",
  event: "afterUpdate",
  run: (ctx) => attemptAfterUpdate(ctx, (c, id, data) => updateRecord(ctx.helpers.sql, c, id, data)),
});
