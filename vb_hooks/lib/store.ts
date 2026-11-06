// Every server-side write goes through here (TECH-SPEC F1). Hook, route and
// worker helpers can read records but not create or update them, so writes
// use helpers.sql. A SQL write skips record hooks, record history and
// realtime events: callers must not rely on any of those.
//
// The storage form of each field is read from the collection's own schema,
// so a value written here reads back through REST exactly like one written
// through REST (checked by test/store.test.ts).

export interface Sql {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
  exec(sql: string, params?: unknown[]): Promise<{ changes: number }>;
}

interface FieldDef { name: string; type: string; options?: { multiple?: boolean; encrypted?: boolean } }

const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const q = (name: string) => {
  if (!IDENT.test(name)) throw new Error(`store: invalid name '${name}'`);
  return `"${name}"`;
};

export class StoreError extends Error {}

async function fieldsOf(sql: Sql, collection: string): Promise<Map<string, FieldDef>> {
  const row = await sql.queryOne<{ fields: string; type: string }>(
    `SELECT fields, type FROM vaultbase_collections WHERE name = ?`, [collection],
  );
  if (!row) throw new StoreError(`store: no collection '${collection}'`);
  if (row.type !== "base") throw new StoreError(`store: '${collection}' is a ${row.type} collection; store writes base collections only`);
  const list = JSON.parse(row.fields) as FieldDef[];
  return new Map(list.map((f) => [f.name, f]));
}

/** A value in the form the records API stores it (src/core/records.ts, encodeValue). */
export function encodeForStore(value: unknown, field: FieldDef): unknown {
  if (value === undefined || value === null) return null;
  if (field.options?.encrypted) throw new StoreError(`store: '${field.name}' is encrypted; write it through the records API`);
  switch (field.type) {
    case "bool": return value ? 1 : 0;
    case "number": {
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n)) throw new StoreError(`store: '${field.name}' needs a number`);
      return n;
    }
    case "date":
    case "autodate": {
      if (typeof value === "number") return Math.floor(value > 1e11 ? value / 1000 : value);
      const ms = value instanceof Date ? value.getTime() : Date.parse(String(value));
      if (!Number.isFinite(ms)) throw new StoreError(`store: '${field.name}' needs a date`);
      return Math.floor(ms / 1000);
    }
    case "json": return typeof value === "string" ? value : JSON.stringify(value);
    case "select":
    case "file":
      if (field.options?.multiple) return typeof value === "string" ? value : JSON.stringify(value);
      return String(value);
    case "relation":
      return String(value);
    default:
      return typeof value === "string" ? value : String(value);
  }
}

function columns(fields: Map<string, FieldDef>, data: Record<string, unknown>): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = [];
  for (const [k, v] of Object.entries(data)) {
    if (k === "id" || k === "created_at" || k === "updated_at") continue;
    const f = fields.get(k);
    if (!f) throw new StoreError(`store: unknown field '${k}'`);
    out.push([k, encodeForStore(v, f)]);
  }
  return out;
}

const now = () => Math.floor(Date.now() / 1000);

export async function insertRecord(sql: Sql, collection: string, data: Record<string, unknown>): Promise<string> {
  const fields = await fieldsOf(sql, collection);
  const id = typeof data["id"] === "string" && data["id"] ? data["id"] : crypto.randomUUID();
  const cols = columns(fields, data);
  const t = now();
  const names = ["id", ...cols.map(([k]) => k), "created_at", "updated_at"];
  const values = [id, ...cols.map(([, v]) => v), t, t];
  await sql.exec(
    `INSERT INTO ${q(`vb_${collection}`)} (${names.map(q).join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
    values,
  );
  return id;
}

/** Update some fields of one record. Always sets updated_at. Returns false when there is no such record. */
export async function updateRecord(sql: Sql, collection: string, id: string, data: Record<string, unknown>): Promise<boolean> {
  const fields = await fieldsOf(sql, collection);
  const cols = columns(fields, data);
  const sets = [...cols.map(([k]) => `${q(k)} = ?`), `"updated_at" = ?`];
  const r = await sql.exec(
    `UPDATE ${q(`vb_${collection}`)} SET ${sets.join(", ")} WHERE "id" = ?`,
    [...cols.map(([, v]) => v), now(), id],
  );
  return r.changes > 0;
}
