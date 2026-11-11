// DELETE /api/custom/connections/:id/key: remove a connection's stored key (TECH-SPEC F2).
// The owner can't view connection_keys, so can't find the record's id; this does it server-side.
// The key is deleted through the records API, so the connection_keys hooks
// and record history see it; has_key is also set here, because the
// after-delete hook runs in the background and the answer must be final.
import { defineRoute } from "vaultbase";
import { ownerRoute, RunError } from "../lib/runs.ts";
import { deleteRecord, updateRecord } from "../lib/store.ts";

export default defineRoute({
  name: "connections-key",
  method: "DELETE",
  path: "/connections/:id/key",
  requireAuth: true,
  handle: (ctx) => ownerRoute(ctx, async () => {
    const id = String(ctx.params["id"]);
    const conn = await ctx.helpers.find("connections", id);
    if (!conn) throw new RunError(404, "That connection does not exist.");
    const keys = await ctx.helpers.sql.query(`SELECT id FROM vb_connection_keys WHERE connection = ?`, [id]) as Array<{ id: string }>;
    for (const k of keys) await deleteRecord(ctx.helpers, "connection_keys", k.id);
    if (conn["has_key"]) await updateRecord(ctx.helpers, "connections", id, { has_key: false });
    return { connection: id, has_key: false, removed: keys.length > 0 };
  }),
});
