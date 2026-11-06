import { defineHook } from "vaultbase";
import { syncHasKey } from "../lib/hook-logic.ts";

export default defineHook({
  name: "connection-keys-after-delete",
  collection: "connection_keys",
  event: "afterDelete",
  run: (ctx) => syncHasKey(ctx, false),
});
