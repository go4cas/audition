import { defineHook } from "vaultbase";
import { roleBeforeWrite } from "../lib/hook-logic.ts";

export default defineHook({
  name: "roles-before-create",
  collection: "roles",
  event: "beforeCreate",
  run: (ctx) => roleBeforeWrite(ctx),
});
