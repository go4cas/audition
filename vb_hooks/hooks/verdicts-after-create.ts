import { defineHook } from "vaultbase";
import { verdictAfterCreate } from "../lib/scoring.ts";

export default defineHook({
  name: "verdicts-after-create",
  collection: "verdicts",
  event: "afterCreate",
  run: (ctx) => verdictAfterCreate(ctx),
});
