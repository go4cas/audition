import { defineHook } from "vaultbase";
import { linkBeforeWrite } from "../lib/guests.ts";

export default defineHook({
  name: "guest-links-before-update",
  collection: "guest_links",
  event: "beforeUpdate",
  run: (ctx) => linkBeforeWrite(ctx as never),
});
