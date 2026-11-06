// Build the dependencies of lib/files.ts from a hook or route's helpers.
import type { FileDeps } from "./files.ts";
import type { Sql } from "./store.ts";

export interface FileHelpers {
  sql: Sql;
  fs: { write(path: string, data: Uint8Array): Promise<void> };
  os: { env(name: string): string };
}

export function fileDeps(helpers: FileHelpers): FileDeps {
  return {
    sql: helpers.sql,
    write: (p, d) => helpers.fs.write(p, d),
    dataDir: helpers.os.env("VAULTBASE_DATA_DIR") || "./vaultbase_data",
  };
}
