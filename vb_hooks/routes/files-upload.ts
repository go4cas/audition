// POST /api/custom/files/:collection/:id/:field: the owner's upload path.
// It takes a normal form upload (one or more parts named `file`) and applies
// the checks the files API and the update rules would: owner only, the record
// must be writable, 25 MB per file, and the Phase 1 types by extension with a
// magic-byte check (F4). Nothing is attached unless every file passes. The
// record's field is then set through the records API (lib/files.ts).
//
// Why not Vaultbase's own upload endpoint, now that F9 is fixed (0.41.1)?
// Checked for PLATFORM-UPGRADES Q1 (docs/NOTES.md, W1): Bun's multipart
// parser replaces each part's declared type with the type of its file name
// (notes.md arrives as text/markdown, bundle.zip as application/zip), and
// Vaultbase's global upload allowlist has neither, nor text/csv. So the
// built-in endpoint refuses four of the Phase 1 types, whatever the client
// declares. This route stays until Vaultbase can take them.
import { defineRoute } from "vaultbase";
import { attachFile } from "../lib/files.ts";
import { uploadTargetError, checkUpload, storedMime } from "../lib/handoff.ts";
import { fileDeps } from "../lib/route-deps.ts";
import { isOwner } from "../lib/runs.ts";

const fail = (ctx: { set: { status: number } }, code: number, error: string) => {
  ctx.set.status = code;
  return { error, code };
};

export default defineRoute({
  name: "files-upload",
  method: "POST",
  path: "/files/:collection/:id/:field",
  requireAuth: true,
  async handle(ctx) {
    if (!isOwner(ctx.auth)) return fail(ctx, 403, "Forbidden");
    const { collection = "", id = "", field = "" } = ctx.params;
    const record = await ctx.helpers.find(collection === "attempts" || collection === "tasks" ? collection : "", id).catch(() => null);
    const target = uploadTargetError(collection, field, record);
    if (target) return fail(ctx, target.code, target.error);

    if (!(ctx.req.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) {
      return fail(ctx, 400, "Send the files as multipart/form-data, in a field named 'file'.");
    }
    let form: FormData;
    try { form = await ctx.req.formData(); } catch { return fail(ctx, 400, "The upload could not be read."); }
    const files = form.getAll("file").filter((v): v is File => v instanceof File);
    if (files.length === 0) return fail(ctx, 400, "Send the files as multipart/form-data, in a field named 'file'.");

    const loaded: Array<{ name: string; bytes: Uint8Array }> = [];
    for (const f of files) {
      const bytes = f.size > 0 && f.size <= 25 * 1024 * 1024 ? new Uint8Array(await f.arrayBuffer()) : new Uint8Array(0);
      const err = checkUpload(f.name, f.type, f.size, bytes);
      if (err) return fail(ctx, err.code, err.error);
      loaded.push({ name: f.name, bytes });
    }
    const deps = fileDeps(ctx.helpers);
    for (const { name, bytes } of loaded) await attachFile(deps, collection, id, field, name, storedMime(name), bytes);
    return { data: await ctx.helpers.find(collection, id) };
  },
});
