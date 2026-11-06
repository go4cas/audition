// Attach a file to a record from server code (TECH-SPEC §12, "Mock files").
// The files API has no server-side attach, so this does what the upload
// handler does (src/api/files.ts, POST /files/:collection/:recordId/:field):
//   1. write the bytes into the upload directory as <uuid>.<ext>;
//   2. insert the file's row in vaultbase_files;
// and then what the client does after an upload:
//   3. add the stored name to the record's file field.
// GET /api/v1/files/<name> then serves it under the record's view rule.
import { join } from "node:path";
import type { Sql } from "./store.ts";

export interface FileDeps {
  sql: Sql;
  /** helpers.fs.write */
  write(path: string, data: Uint8Array): Promise<void>;
  /** The data directory (VAULTBASE_DATA_DIR). */
  dataDir: string;
}

// The upload handler's own extension table (src/api/files.ts, EXT_FOR_MIME).
const EXT_FOR_MIME: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp",
  "image/avif": "avif", "image/gif": "gif", "application/pdf": "pdf",
  "text/plain": "txt", "application/json": "json",
};

export function storedName(mime: string, id = crypto.randomUUID()): string {
  return `${id}.${EXT_FOR_MIME[mime.trim().toLowerCase()] ?? "bin"}`;
}

export async function attachFile(
  deps: FileDeps, collection: string, recordId: string, field: string,
  originalName: string, mime: string, bytes: Uint8Array,
): Promise<string> {
  const { sql } = deps;
  const col = await sql.queryOne<{ id: string; fields: string }>(`SELECT id, fields FROM vaultbase_collections WHERE name = ?`, [collection]);
  if (!col) throw new Error(`attachFile: no collection '${collection}'`);
  const def = (JSON.parse(col.fields) as Array<{ name: string; type: string; options?: { multiple?: boolean } }>).find((f) => f.name === field);
  if (!def || def.type !== "file") throw new Error(`attachFile: '${collection}.${field}' is not a file field`);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(collection) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(field)) throw new Error("attachFile: bad name");
  const row = await sql.queryOne<Record<string, unknown>>(`SELECT "${field}" AS v FROM "vb_${collection}" WHERE id = ?`, [recordId]);
  if (!row) throw new Error(`attachFile: no record ${collection}/${recordId}`);

  const id = crypto.randomUUID();
  const name = storedName(mime, id);
  await deps.write(join(deps.dataDir, "uploads", name), bytes);
  await sql.exec(
    `INSERT INTO vaultbase_files (id, collection_id, record_id, field_name, filename, original_name, mime_type, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, col.id, recordId, field, name, originalName.slice(0, 255), mime, bytes.byteLength, Math.floor(Date.now() / 1000)],
  );
  let value: string;
  if (def.options?.multiple) {
    let list: string[] = [];
    try { list = row["v"] ? JSON.parse(String(row["v"])) : []; } catch { list = []; }
    value = JSON.stringify([...list, name]);
  } else {
    value = name;
  }
  await sql.exec(`UPDATE "vb_${collection}" SET "${field}" = ?, updated_at = ? WHERE id = ?`, [value, Math.floor(Date.now() / 1000), recordId]);
  return name;
}
