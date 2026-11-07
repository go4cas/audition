// DELETE /api/custom/connections/:id/key: remove a connection's stored key (TECH-SPEC F2).
// The owner can't view connection_keys, so can't find the record's id; this does it server-side.
import { defineRoute } from "vaultbase";
import { ownerRoute, RunError } from "../lib/runs.ts";
import { updateRecord } from "../lib/store.ts";

export default defineRoute({
  name: "connections-key",
  method: "DELETE",
  path: "/connections/:id/key",
  requireAuth: true,
  handle: (ctx) => ownerRoute(ctx, async () => {
    const id = String(ctx.params["id"]);
    const conn = await ctx.helpers.find("connections", id);
    if (!conn) throw new RunError(404, "That connection does not exist.");
    const r = await ctx.helpers.sql.exec(`DELETE FROM vb_connection_keys WHERE connection = ?`, [id]);
    // A SQL delete skips the connection_keys hooks, so has_key is set here.
    await updateRecord(ctx.helpers.sql, "connections", id, { has_key: false });
    return { connection: id, has_key: false, removed: r.changes > 0 };
  }),
});
