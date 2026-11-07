import { defineHook } from "vaultbase";
import { verdictBeforeCreate } from "../lib/scoring.ts";

export default defineHook({
  name: "verdicts-before-create",
  collection: "verdicts",
  event: "beforeCreate",
  run: (ctx) => verdictBeforeCreate(ctx),
});
