// Test only (copied into the hooks folder by test/harness.ts, never shipped):
// POST /api/custom/test/store lets a test write through vb_hooks/lib/store.ts
// as server code does. Admin only.
import { defineRoute } from "vaultbase";
import { insertRecord, updateRecord } from "../lib/store.ts";

export default defineRoute({
  name: "test-store",
  method: "POST",
  path: "/test/store",
  requireAuth: true,
  async handle(ctx) {
    if (ctx.auth?.type !== "admin") { ctx.set.status = 403; return { error: "Forbidden", code: 403 }; }
    const b = ctx.body as { op: "insert" | "update"; collection: string; data: Record<string, unknown>; id?: string };
    try {
      if (b.op === "insert") return { data: { id: await insertRecord(ctx.helpers.sql, b.collection, b.data) } };
      const ok = await updateRecord(ctx.helpers.sql, b.collection, String(b.id), b.data);
      if (!ok) { ctx.set.status = 404; return { error: "Not found", code: 404 }; }
      return { data: { id: b.id } };
    } catch (e) {
      ctx.set.status = 422;
      return { error: e instanceof Error ? e.message : String(e), code: 422 };
    }
  },
});
