// POST /api/custom/guest/:token/votes (TECH-SPEC §10b): one guest vote, stars
// for an output or a pick for a pair. Written through helpers.records, so the
// guest never writes a collection directly (guest_votes allows no REST writes).
import { defineRoute } from "vaultbase";
import { castVote, guestRoute } from "../lib/guests.ts";

export default defineRoute({
  name: "guest-vote",
  method: "POST",
  path: "/guest/:token/votes",
  // Off: Vaultbase counts an anonymous session as not signed in. guestRoute / isGuest check the caller.
  requireAuth: false,
  handle: (ctx) => guestRoute(ctx, (guest) => castVote(ctx.helpers as never, String(ctx.params["token"]), guest, (ctx.body ?? {}) as never)),
});
