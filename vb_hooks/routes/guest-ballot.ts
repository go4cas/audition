// GET /api/custom/guest/:token (TECH-SPEC §10b): a guest's blind ballot. Only
// an anonymous session of the `guests` collection gets in, and only while the
// link is open. Never holds who made an output (test/guests.test.ts).
import { defineRoute } from "vaultbase";
import { ballot, guestRoute } from "../lib/guests.ts";

export default defineRoute({
  name: "guest-ballot",
  method: "GET",
  path: "/guest/:token",
  // Off: Vaultbase counts an anonymous session as not signed in. guestRoute / isGuest check the caller.
  requireAuth: false,
  handle: (ctx) => guestRoute(ctx, (guest) => ballot(ctx.helpers as never, String(ctx.params["token"]), guest)),
});
