// POST /api/custom/castings (TECH-SPEC §7, §11a): make a contender the role's
// champion. Refused unless the contender qualifies. The casting is
// suggested_by "system" when it was the suggested champion, else "human", and
// on trial when it replaces an earlier champion. The logic is lib/castings.ts.
import { defineRoute } from "vaultbase";
import { crown } from "../lib/castings.ts";
import { ownerRoute } from "../lib/runs.ts";

export default defineRoute({
  name: "castings",
  method: "POST",
  path: "/castings",
  requireAuth: true,
  handle: (ctx) => ownerRoute(ctx, async () => ({ casting: await crown(ctx.helpers as never, (ctx.body ?? {}) as never) })),
});
