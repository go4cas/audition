import { defineHook } from "vaultbase";
import { contenderBeforeWrite } from "../lib/hook-logic.ts";

export default defineHook({
  name: "contenders-before-update",
  collection: "contenders",
  event: "beforeUpdate",
  run: (ctx) => contenderBeforeWrite(ctx),
});
