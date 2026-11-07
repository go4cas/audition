// POST /api/custom/castings (TECH-SPEC §7, §11): confirm a contender as a
// role's champion. Refused unless the contender qualifies. The casting is
// suggested_by "system" when it was the suggested champion, else "human".
import { defineRoute } from "vaultbase";
import { roleBoard } from "../lib/fitness.ts";
import { insertRecord } from "../lib/store.ts";

export default defineRoute({
  name: "castings",
  method: "POST",
  path: "/castings",
  requireAuth: true,
  async handle(ctx) {
    if (ctx.auth?.type !== "user" || ctx.auth.collection !== "users") {
      ctx.set.status = 403;
      return { error: "Only the owner can confirm a champion.", code: 403 };
    }
    const b = (ctx.body ?? {}) as { role?: unknown; contender?: unknown; rationale?: unknown };
    if (typeof b.role !== "string" || typeof b.contender !== "string" || !b.role || !b.contender) {
      ctx.set.status = 422;
      return { error: "role and contender are required.", code: 422 };
    }
    if (b.rationale !== undefined && b.rationale !== null && typeof b.rationale !== "string") {
      ctx.set.status = 422;
      return { error: "rationale must be text.", code: 422 };
    }
    const board = await roleBoard(ctx.helpers as never, b.role);
    if (!board) {
      ctx.set.status = 404;
      return { error: "That role does not exist.", code: 404 };
    }
    const row = board.rows.find((r) => r.contender === b.contender);
    if (!row || !row.qualifies) {
      ctx.set.status = 422;
      const why = !row
        ? "it has no scored outputs for this role"
        : !row.enough_data
          ? `it has ${row.n} scored outputs and needs at least the workspace minimum`
          : `its average ${row.mean_score} is not above the role's pass mark`;
      return { error: `That contender doesn't qualify as champion: ${why}.`, code: 422 };
    }
    const since = Math.floor(Date.now() / 1000);
    const suggested_by = board.suggested === b.contender ? "system" : "human";
    const rationale = typeof b.rationale === "string" ? b.rationale.trim() : "";
    const id = await insertRecord(ctx.helpers.sql, "castings", {
      role: b.role, contender: b.contender, since, rationale, suggested_by, confirmed: true,
    });
    return { casting: { id, role: b.role, contender: b.contender, since, rationale, suggested_by, confirmed: true } };
  },
});
