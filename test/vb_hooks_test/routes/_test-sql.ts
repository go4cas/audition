// Test only: POST /api/custom/test/sql runs one SELECT through helpers.sql,
// so tests can look at stored values. Admin only.
import { defineRoute } from "vaultbase";

export default defineRoute({
  name: "test-sql",
  method: "POST",
  path: "/test/sql",
  requireAuth: true,
  async handle(ctx) {
    if (ctx.auth?.type !== "admin") { ctx.set.status = 403; return { error: "Forbidden", code: 403 }; }
    const b = ctx.body as { sql: string; params?: unknown[] };
    if (!/^\s*select\b/i.test(b.sql)) { ctx.set.status = 422; return { error: "SELECT only", code: 422 }; }
    return { data: await ctx.helpers.sql.query(b.sql, b.params ?? []) };
  },
});
