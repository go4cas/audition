import { defineHook } from "vaultbase";
import { taskBeforeWrite } from "../lib/hook-logic.ts";

export default defineHook({
  name: "tasks-before-create",
  collection: "tasks",
  event: "beforeCreate",
  run: (ctx) => taskBeforeWrite(ctx),
});
