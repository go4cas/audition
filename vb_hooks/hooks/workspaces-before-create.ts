import { defineHook } from "vaultbase";
import { workspaceBeforeWrite } from "../lib/hook-logic.ts";

export default defineHook({
  name: "workspaces-before-create",
  collection: "workspaces",
  event: "beforeCreate",
  run: (ctx) => workspaceBeforeWrite(ctx),
});
