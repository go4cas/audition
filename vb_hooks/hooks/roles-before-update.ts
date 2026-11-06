import { defineHook } from "vaultbase";
import { roleBeforeWrite } from "../lib/hook-logic.ts";

export default defineHook({
  name: "roles-before-update",
  collection: "roles",
  event: "beforeUpdate",
  run: (ctx) => roleBeforeWrite(ctx),
});
