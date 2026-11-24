// POST /api/custom/seed/attach: admin only. Attaches a seed fixture to a
// record through lib/files.ts (helpers.files.save), so seeded files are stored exactly as the
// files server code makes (provider outputs). Only the seed script calls it;
// the owner uploads through files-upload.ts.
import { defineRoute } from "vaultbase";
import { attachFile, FileRefused } from "../lib/files.ts";
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
    try {
      const filename = await attachFile(fileDeps(ctx.helpers), b.collection, b.id, b.field, b.name, b.mime, bytes);
      return { data: { filename } };
    } catch (e) {
      if (!(e instanceof FileRefused)) throw e;
      ctx.set.status = 422;
      return { error: e.message, code: 422 };
    }
  },
});
