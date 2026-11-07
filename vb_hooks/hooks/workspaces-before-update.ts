import { defineHook } from "vaultbase";
import { workspaceBeforeWrite } from "../lib/hook-logic.ts";

export default defineHook({
  name: "workspaces-before-update",
  collection: "workspaces",
  event: "beforeUpdate",
  run: (ctx) => workspaceBeforeWrite(ctx),
});
