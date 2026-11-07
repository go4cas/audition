import { defineHook } from "vaultbase";
import { syncHasKey } from "../lib/hook-logic.ts";

export default defineHook({
  name: "connection-keys-after-update",
  collection: "connection_keys",
  event: "afterUpdate",
  run: (ctx) => syncHasKey(ctx, true),
});
