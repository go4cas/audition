// POST /api/custom/seed/attach: admin only. Attaches a seed fixture to a
// record through lib/files.ts, because Vaultbase 0.40.2's upload endpoint
// refuses every multipart body (docs/NOTES.md, finding F9). Only the seed
// script calls it; the owner's upload path is an open question for T2/T4.
import { defineRoute } from "vaultbase";
import { attachFile } from "../lib/files.ts";
import { fileDeps } from "../lib/route-deps.ts";

const MAX_BYTES = 25 * 1024 * 1024;

export default defineRoute({
  name: "seed-attach",
  method: "POST",
  path: "/seed/attach",
  requireAuth: true,
  async handle(ctx) {
    if (ctx.auth?.type !== "admin") {
      ctx.set.status = 403;
      return { error: "Forbidden", code: 403 };
    }
    const b = (ctx.body ?? {}) as { collection?: string; id?: string; field?: string; name?: string; mime?: string; data?: string };
    if (!b.collection || !b.id || !b.field || !b.name || !b.mime || typeof b.data !== "string") {
      ctx.set.status = 422;
      return { error: "collection, id, field, name, mime and data (base64) are required", code: 422 };
    }
    const bytes = Uint8Array.from(Buffer.from(b.data, "base64"));
    if (bytes.byteLength > MAX_BYTES) {
      ctx.set.status = 413;
      return { error: "File too large (max 25 MB)", code: 413 };
    }
    const filename = await attachFile(fileDeps(ctx.helpers), b.collection, b.id, b.field, b.name, b.mime, bytes);
    return { data: { filename } };
  },
});
