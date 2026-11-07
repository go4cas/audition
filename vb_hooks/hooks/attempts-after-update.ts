import { defineHook } from "vaultbase";
import { attemptAfterUpdate } from "../lib/handoff.ts";

export default defineHook({
  name: "attempts-after-update",
  collection: "attempts",
  event: "afterUpdate",
  run: (ctx) => attemptAfterUpdate(ctx),
});
