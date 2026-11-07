// POST /api/custom/castings (TECH-SPEC §7, §11): confirm a contender as a
// role's champion. Refused unless the contender qualifies. The casting is
// suggested_by "system" when it was the suggested champion, else "human".
import { defineRoute } from "vaultbase";
import { roleBoard } from "../lib/fitness.ts";
import { ownerRoute, RunError } from "../lib/runs.ts";
import { insertRecord } from "../lib/store.ts";

export default defineRoute({
  name: "castings",
  method: "POST",
  path: "/castings",
  requireAuth: true,
  handle: (ctx) => ownerRoute(ctx, async () => {
    const b = (ctx.body ?? {}) as { role?: unknown; contender?: unknown; rationale?: unknown };
    if (typeof b.role !== "string" || typeof b.contender !== "string" || !b.role || !b.contender) {
      throw new RunError(422, "role and contender are required.");
    }
    if (b.rationale !== undefined && b.rationale !== null && typeof b.rationale !== "string") {
      throw new RunError(422, "rationale must be text.");
    }
    const board = await roleBoard(ctx.helpers as never, b.role);
    if (!board) throw new RunError(404, "That role does not exist.");
    const row = board.rows.find((r) => r.contender === b.contender);
    if (!row || !row.qualifies) {
      const why = !row
        ? "it has no scored outputs for this role"
        : !row.enough_data
          ? `it has ${row.n} scored outputs and needs at least the workspace minimum`
          : `its average ${row.mean_score} is not above the role's pass mark`;
      throw new RunError(422, `That contender doesn't qualify as champion: ${why}.`);
    }
    const since = Math.floor(Date.now() / 1000);
    const suggested_by = board.suggested === b.contender ? "system" : "human";
    const rationale = typeof b.rationale === "string" ? b.rationale.trim() : "";
    const id = await insertRecord(ctx.helpers.sql, "castings", {
      role: b.role, contender: b.contender, since, rationale, suggested_by, confirmed: true,
    });
    return { casting: { id, role: b.role, contender: b.contender, since, rationale, suggested_by, confirmed: true } };
  }),
});
