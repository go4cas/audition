import { defineHook } from "vaultbase";
import { contenderBeforeWrite } from "../lib/hook-logic.ts";

export default defineHook({
  name: "contenders-before-create",
  collection: "contenders",
  event: "beforeCreate",
  run: (ctx) => contenderBeforeWrite(ctx),
});
