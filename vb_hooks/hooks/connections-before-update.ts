import { defineHook } from "vaultbase";
import { connectionBeforeWrite } from "../lib/hook-logic.ts";

export default defineHook({
  name: "connections-before-update",
  collection: "connections",
  event: "beforeUpdate",
  run: (ctx) => connectionBeforeWrite(ctx),
});
