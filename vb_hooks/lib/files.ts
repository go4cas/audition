// Attach a file made by server code to a record (TECH-SPEC §12, "Mock files";
// seed fixtures; files a provider returns). The owner's own uploads go
// through Vaultbase's upload endpoint (POST /api/v1/files/...), which needs a
// signed-in caller and a multipart body, so server code can't use it, and
// Vaultbase has no server-side file helper yet. So this does what the upload
// handler does (src/api/files.ts, POST /files/:collection/:recordId/:field):
//   1. write the bytes into the upload directory as <uuid>.<ext>;
//   2. insert the file's row in vaultbase_files (a documented SQL bypass, F1);
// and then what a client does after an upload, through the records API:
//   3. add the stored name to the record's file field (helpers.records).
// GET /api/v1/files/<name> then serves it under the record's view rule.
import { join } from "node:path";
import { updateRecord, type Store } from "./store.ts";

type Rec = Record<string, unknown>;

export interface FileDeps extends Store {
  find(collection: string, id: string): Promise<Rec | null>;
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

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export async function attachFile(
  deps: FileDeps, collection: string, recordId: string, field: string,
  originalName: string, mime: string, bytes: Uint8Array,
): Promise<string> {
  const { sql } = deps;
  if (!NAME.test(collection) || !NAME.test(field)) throw new Error("attachFile: bad name");
  const col = await sql.queryOne<{ id: string; fields: string }>(`SELECT id, fields FROM vaultbase_collections WHERE name = ?`, [collection]);
  if (!col) throw new Error(`attachFile: no collection '${collection}'`);
  const def = (JSON.parse(col.fields) as Array<{ name: string; type: string; options?: { multiple?: boolean } }>).find((f) => f.name === field);
  if (!def || def.type !== "file") throw new Error(`attachFile: '${collection}.${field}' is not a file field`);
  const record = await deps.find(collection, recordId);
  if (!record) throw new Error(`attachFile: no record ${collection}/${recordId}`);

  const id = crypto.randomUUID();
  const name = storedName(mime, id);
  await deps.write(join(deps.dataDir, "uploads", name), bytes);
  await sql.exec(
    `INSERT INTO vaultbase_files (id, collection_id, record_id, field_name, filename, original_name, mime_type, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, col.id, recordId, field, name, originalName.slice(0, 255), mime, bytes.byteLength, Math.floor(Date.now() / 1000)],
  );
  const current = record[field];
  const value = def.options?.multiple ? [...(Array.isArray(current) ? current.map(String) : []), name] : name;
  await updateRecord(deps, collection, recordId, { [field]: value });
  return name;
}
