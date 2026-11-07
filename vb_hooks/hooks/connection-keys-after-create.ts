import { defineHook } from "vaultbase";
import { syncHasKey } from "../lib/hook-logic.ts";

export default defineHook({
  name: "connection-keys-after-create",
  collection: "connection_keys",
  event: "afterCreate",
  run: (ctx) => syncHasKey(ctx, true),
});
