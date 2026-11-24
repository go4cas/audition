// Attach a file made by server code to a record (TECH-SPEC §12, "Mock files";
// seed fixtures; files a provider returns; the owner upload route). Since
// Vaultbase 0.48 this is helpers.files.save (discussion #11), which does what
// an upload does, in one call:
//   - the upload checks (allowed types, max upload size, the field's maxSize
//     and mimeTypes; a 422 ValidationError otherwise);
//   - writes the bytes through the configured File storage (local or S3) and
//     adds the file's vaultbase_files row;
//   - appends the stored name to the record's field (or replaces it on a
//     single-file field) through helpers.records, so hooks, record history,
//     realtime and webhooks run.
// GET /api/v1/files/<name> then serves it under the record's view rule.
// Before 0.48 this file wrote the bytes and the vaultbase_files row itself
// (a SQL bypass, NOTES W4); that is gone (NOTES FS1).

export interface SavedFile { id: string; filename: string; originalName: string; size: number; mimeType: string }

/** helpers.files: Vaultbase's server-side file helper (0.48+). */
export interface Files {
  save(
    collection: string, recordId: string, field: string,
    data: Uint8Array, opts?: { name?: string; type?: string },
  ): Promise<{ file: SavedFile; record: Record<string, unknown> }>;
}

export interface FileDeps { files: Files }

/** A file Vaultbase's upload checks refused (its ValidationError, made readable). */
export class FileRefused extends Error {
  readonly code = 422;
  constructor(readonly fileName: string, readonly reason: string) {
    super(`Vaultbase refused the file "${fileName}": ${reason}`);
    this.name = "FileRefused";
  }
}

/** Store `bytes` on `collection/recordId`'s file field `field`; returns the stored name. */
export async function attachFile(
  deps: FileDeps, collection: string, recordId: string, field: string,
  originalName: string, mime: string, bytes: Uint8Array,
): Promise<string> {
  try {
    const { file } = await deps.files.save(collection, recordId, field, bytes, { name: originalName, type: mime });
    return file.filename;
  } catch (e) {
    // helpers.files.save throws Vaultbase's ValidationError ("Validation
    // failed", with { field: reason } in details) when a check refuses it.
    const details = (e as { details?: unknown })?.details;
    if (details && typeof details === "object") {
      throw new FileRefused(originalName, Object.values(details as Record<string, unknown>).map(String).join("; ") || "not allowed");
    }
    throw e;
  }
}
