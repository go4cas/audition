import { defineHook } from "vaultbase";
import { connectionBeforeWrite } from "../lib/hook-logic.ts";

export default defineHook({
  name: "connections-before-create",
  collection: "connections",
  event: "beforeCreate",
  run: (ctx) => connectionBeforeWrite(ctx),
});
