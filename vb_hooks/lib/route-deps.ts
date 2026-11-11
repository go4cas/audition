// Build the dependencies of lib/files.ts from a hook or route's helpers.
import type { FileDeps } from "./files.ts";
import type { Records, Sql } from "./store.ts";

export interface FileHelpers {
  sql: Sql;
  records: Records;
  find(collection: string, id: string): Promise<Record<string, unknown> | null>;
  fs: { write(path: string, data: Uint8Array): Promise<void> };
  os: { env(name: string): string };
}

export function fileDeps(helpers: FileHelpers): FileDeps {
  return {
    sql: helpers.sql,
    records: helpers.records,
    find: (c, id) => helpers.find(c, id),
    write: (p, d) => helpers.fs.write(p, d),
    dataDir: helpers.os.env("VAULTBASE_DATA_DIR") || "./vaultbase_data",
  };
}
