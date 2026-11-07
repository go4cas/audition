// GET /api/custom/leaderboard/:roleId (TECH-SPEC §7, §11): the role's
// contenders with means, ranges, fitness, who qualifies, the suggested
// champion and the current casting. The maths is lib/fitness.ts.
import { defineRoute } from "vaultbase";
import { roleBoard } from "../lib/fitness.ts";
import { ownerRoute, RunError } from "../lib/runs.ts";

export default defineRoute({
  name: "leaderboard",
  method: "GET",
  path: "/leaderboard/:roleId",
  requireAuth: true,
  handle: (ctx) => ownerRoute(ctx, async () => {
    const board = await roleBoard(ctx.helpers as never, String(ctx.params["roleId"]));
    if (!board) throw new RunError(404, "That role does not exist.");
    return board;
  }),
});
