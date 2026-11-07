// GET /api/custom/judging/:runId/:taskId (TECH-SPEC §10): the blind payload
// for the judging screen. It never holds who made an output: no contender,
// connection, model, group, mode, tokens, time or cost (test/blind.test.ts).
import { defineRoute } from "vaultbase";
import { ownerRoute, RunError } from "../lib/runs.ts";
import { blindPayload } from "../lib/scoring.ts";

export default defineRoute({
  name: "judging",
  method: "GET",
  path: "/judging/:runId/:taskId",
  requireAuth: true,
  handle: (ctx) => ownerRoute(ctx, async () => {
    const payload = await blindPayload(ctx.helpers as never, String(ctx.params["runId"]), String(ctx.params["taskId"]));
    if (!payload) throw new RunError(404, "That run or task does not exist.");
    return payload;
  }),
});
