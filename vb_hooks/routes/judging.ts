// GET /api/custom/judging/:runId/:taskId (TECH-SPEC §10): the blind payload
// for the judging screen. It never holds who made an output: no contender,
// connection, model, group, mode, tokens, time or cost (test/blind.test.ts).
import { defineRoute } from "vaultbase";
import { blindPayload } from "../lib/scoring.ts";

export default defineRoute({
  name: "judging",
  method: "GET",
  path: "/judging/:runId/:taskId",
  requireAuth: true,
  async handle(ctx) {
    if (ctx.auth?.type !== "user" || ctx.auth.collection !== "users") {
      ctx.set.status = 403;
      return { error: "Only the owner can judge.", code: 403 };
    }
    const payload = await blindPayload(ctx.helpers as never, String(ctx.params["runId"]), String(ctx.params["taskId"]));
    if (!payload) {
      ctx.set.status = 404;
      return { error: "That run or task does not exist.", code: 404 };
    }
    return payload;
  },
});
