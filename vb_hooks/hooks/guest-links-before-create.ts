import { defineHook } from "vaultbase";
import { linkBeforeWrite } from "../lib/guests.ts";

export default defineHook({
  name: "guest-links-before-create",
  collection: "guest_links",
  event: "beforeCreate",
  run: (ctx) => linkBeforeWrite(ctx as never),
});
