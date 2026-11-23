// GET /api/custom/leaderboards[?workspace=<id>] (TECH-SPEC §7): every role's
// leaderboard keyed by role id, the same board as GET /leaderboard/:roleId.
// Home and the workspace page make this one request instead of one per role.
import { defineRoute } from "vaultbase";
import { roleBoards } from "../lib/fitness.ts";
import { ownerRoute } from "../lib/runs.ts";

export default defineRoute({
  name: "leaderboards",
  method: "GET",
  path: "/leaderboards",
  requireAuth: true,
  handle: (ctx) => ownerRoute(ctx, async () => roleBoards(ctx.helpers as never, ctx.query["workspace"] || null)),
});
