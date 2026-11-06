import { defineHook } from "vaultbase";
import { roleBeforeDelete } from "../lib/hook-logic.ts";

export default defineHook({
  name: "roles-before-delete",
  collection: "roles",
  event: "beforeDelete",
  run: (ctx) => roleBeforeDelete(ctx),
});
