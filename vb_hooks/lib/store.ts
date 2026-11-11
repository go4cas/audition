// Every server-side record write goes through here, and through Vaultbase's
// records API: helpers.records (Vaultbase 0.43+, TECH-SPEC F1). A write takes
// the same path as /api/v1/...: field validation, the collection's own
// before- and after-hooks, record history, realtime events and webhooks. No
// API rules apply (trusted server code), and Vaultbase passes no user, so the
// hooks see `auth === null` and record history shows the write as system.
//
// Two writes still use helpers.sql, on purpose (docs/NOTES.md, F1):
//   - the generate worker's claim of a queued attempt (lib/runs.ts): it needs
//     "only if still queued", which helpers.records.update has no form of;
//   - storing a file made by server code (lib/files.ts): Vaultbase has no
//     server-side file helper, so the file and its vaultbase_files row are
//     written directly. The record's file field is set through here.
// test/store.test.ts holds the grep test that keeps it at those two.

export interface Sql {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
  exec(sql: string, params?: unknown[]): Promise<{ changes: number }>;
}

type Rec = Record<string, unknown>;

/** helpers.records: Vaultbase's server-side records API. */
export interface Records {
  create(collection: string, data: Rec): Promise<Rec>;
  update(collection: string, id: string, data: Rec): Promise<Rec>;
  delete(collection: string, id: string): Promise<void>;
}

/** What a write needs: helpers.records, and helpers.sql to read the schema. */
export interface Store {
  sql: Sql;
  records: Records;
}

export class StoreError extends Error {}

/**
 * Who a hook is running for: the admin, or Audition's own server code (a
 * helpers.records write carries no user, so `auth` is null). Every API rule
 * of the collections Audition's hooks guard needs a signed-in caller, so an
 * anonymous REST request is refused before it reaches a hook
 * (test/rules.test.ts).
 */
export const isTrusted = (auth: { type?: string } | null | undefined): boolean => !auth || auth.type === "admin";

const SYSTEM = new Set(["id", "created", "updated", "created_at", "updated_at", "collectionId", "collectionName", "expand"]);

/**
 * helpers.records ignores keys that aren't fields (the REST API answers 400
 * for them since 0.44). Server code should never send one, so a typo fails
 * loudly here instead of being dropped.
 */
async function checkFields(sql: Sql, collection: string, data: Rec): Promise<void> {
  const row = await sql.queryOne<{ fields: string; type: string }>(
    `SELECT fields, type FROM vaultbase_collections WHERE name = ?`, [collection],
  );
  if (!row) throw new StoreError(`store: no collection '${collection}'`);
  if (row.type !== "base") throw new StoreError(`store: '${collection}' is a ${row.type} collection; store writes base collections only`);
  const names = new Set((JSON.parse(row.fields) as Array<{ name: string }>).map((f) => f.name));
  for (const k of Object.keys(data)) {
    if (SYSTEM.has(k)) throw new StoreError(`store: '${k}' is set by Vaultbase`);
    if (!names.has(k)) throw new StoreError(`store: unknown field '${k}'`);
  }
}

/** Create a record through helpers.records. Returns its id. */
export async function insertRecord(store: Store, collection: string, data: Rec): Promise<string> {
  await checkFields(store.sql, collection, data);
  const rec = await store.records.create(collection, { ...data });
  return String(rec["id"]);
}

/** Update some fields of one record through helpers.records. Returns the record as saved. */
export async function updateRecord(store: Store, collection: string, id: string, data: Rec): Promise<Rec> {
  await checkFields(store.sql, collection, data);
  return store.records.update(collection, id, { ...data });
}

/** Delete one record through helpers.records (with the collection's cascades and hooks). */
export async function deleteRecord(store: Store, collection: string, id: string): Promise<void> {
  await store.records.delete(collection, id);
}
