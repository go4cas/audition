import { defineHook } from "vaultbase";
import { taskBeforeWrite } from "../lib/hook-logic.ts";

export default defineHook({
  name: "tasks-before-update",
  collection: "tasks",
  event: "beforeUpdate",
  run: (ctx) => taskBeforeWrite(ctx),
});
