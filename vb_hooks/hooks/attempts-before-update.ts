import { defineHook } from "vaultbase";
import { attemptBeforeUpdate } from "../lib/handoff.ts";

export default defineHook({
  name: "attempts-before-update",
  collection: "attempts",
  event: "beforeUpdate",
  run: (ctx) => attemptBeforeUpdate(ctx),
});
