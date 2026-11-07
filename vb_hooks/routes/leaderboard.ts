// GET /api/custom/leaderboard/:roleId (TECH-SPEC §7, §11): the role's
// contenders with means, ranges, fitness, who qualifies, the suggested
// champion and the current casting. The maths is lib/fitness.ts.
import { defineRoute } from "vaultbase";
import { roleBoard } from "../lib/fitness.ts";

export default defineRoute({
  name: "leaderboard",
  method: "GET",
  path: "/leaderboard/:roleId",
  requireAuth: true,
  async handle(ctx) {
    if (ctx.auth?.type !== "user" || ctx.auth.collection !== "users") {
      ctx.set.status = 403;
      return { error: "Only the owner can see the leaderboard.", code: 403 };
    }
    const board = await roleBoard(ctx.helpers as never, String(ctx.params["roleId"]));
    if (!board) {
      ctx.set.status = 404;
      return { error: "That role does not exist.", code: 404 };
    }
    return board;
  },
});
