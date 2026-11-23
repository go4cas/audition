// Data migrations that must run before a release's schema snapshot.
//
// Vaultbase applies schema/snapshot.json when it starts (`--apply-snapshot
// ... --snapshot-mode sync`), and a snapshot can't say "rename": it finds
// collections by name, so a renamed collection would be created empty next to
// the old one, and a renamed field would be dropped with its data and added
// again empty. Renames therefore go through Vaultbase's own collection API
// first, which keeps every record, id and timestamp:
//
//   - PATCH /api/v1/collections/:name { name }   renames the table, and points
//     every relation field that targeted the old name at the new one
//   - PATCH /api/v1/collections/:name { fields } with `renamedFrom` on a field
//     renames its column (Vaultbase strips `renamedFrom` when it saves)
//
// `migrateOffline` does this on a data folder while Audition is stopped: it
// starts the binary on that folder with no snapshot and no hooks, on a free
// local port, signs in as the admin, migrates, and stops. After that the
// release's snapshot finds everything already in place. deploy/install.sh
// runs it on every upgrade (`audition-setup migrate`), `bun run dev` before
// it starts Vaultbase, and test/migrate.test.ts checks it. Each step looks
// before it acts, so running it again, or on a new install, changes nothing.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { adminLogin, call, startInstance } from "./vaultbase.ts";

type Field = { name: string; type: string; collection?: string; renamedFrom?: string; [k: string]: unknown };

async function collectionNames(url: string, token: string): Promise<Set<string>> {
  const r = await call(url, "GET", "/api/v1/collections", { token });
  if (r.status !== 200) throw new Error(`listing collections failed: ${r.status} ${JSON.stringify(r.body)}`);
  return new Set((r.body.data as Array<{ name: string }>).map((c) => c.name));
}

async function fieldsOf(url: string, token: string, name: string): Promise<Field[]> {
  const r = await call(url, "GET", `/api/v1/collections/${name}`, { token });
  if (r.status !== 200) throw new Error(`reading ${name} failed: ${r.status} ${JSON.stringify(r.body)}`);
  const f = r.body.data.fields;
  return typeof f === "string" ? JSON.parse(f) : f;
}

async function patchCollection(url: string, token: string, name: string, body: Record<string, unknown>) {
  const r = await call(url, "PATCH", `/api/v1/collections/${name}`, { token, body });
  if (r.status !== 200) throw new Error(`updating ${name} failed: ${r.status} ${JSON.stringify(r.body)}`);
}

/**
 * Nov 23, 2026 (Cas): "Stages" became "Groups". A stage implied a sequence,
 * but they only ever grouped roles (a Travel planner's Visa, Weather and
 * Accommodation have no order). Collection `stages` -> `groups`, and the
 * field `roles.stage` -> `roles.group`.
 */
async function stagesToGroups(url: string, token: string, log: string[]) {
  const names = await collectionNames(url, token);
  if (names.has("stages")) {
    if (names.has("groups")) {
      // The new snapshot was applied before this migration (a start that
      // skipped it): it made an empty `groups`. Drop that one, then rename.
      const r = await call(url, "GET", "/api/v1/groups?perPage=1", { token });
      if (r.status !== 200) throw new Error(`reading groups failed: ${r.status} ${JSON.stringify(r.body)}`);
      if ((r.body.data as unknown[]).length > 0) {
        throw new Error("Both `stages` and `groups` hold records, so neither can be renamed. Move the groups into stages in the Vaultbase admin (or roll back) and run this again.");
      }
      const d = await call(url, "DELETE", "/api/v1/collections/groups", { token });
      if (d.status !== 200 && d.status !== 204) throw new Error(`removing the empty groups failed: ${d.status} ${JSON.stringify(d.body)}`);
      log.push("removed an empty `groups` collection made before the migration");
    }
    await patchCollection(url, token, "stages", { name: "groups" });
    log.push("renamed the collection `stages` to `groups`");
  }
  if (names.has("roles")) {
    const fields = await fieldsOf(url, token, "roles");
    const has = (n: string) => fields.some((f) => f.name === n);
    if (has("stage") && !has("group")) {
      await patchCollection(url, token, "roles", {
        fields: fields.map((f) => (f.name === "stage" ? { ...f, name: "group", renamedFrom: "stage", collection: "groups" } : f)),
      });
      log.push("renamed the field `roles.stage` to `roles.group`");
    } else if (has("stage") && has("group")) {
      throw new Error("`roles` has both a `stage` and a `group` field. Copy stage into group in the Vaultbase admin, remove stage, and run this again.");
    }
  }
}

/** Every migration, oldest first. Each one checks before it acts. */
const MIGRATIONS = [stagesToGroups];

/** Run the migrations against a running instance. Returns what was done (empty when nothing was needed). */
export async function migrate(url: string, adminToken: string): Promise<string[]> {
  const log: string[] = [];
  for (const m of MIGRATIONS) await m(url, adminToken, log);
  return log;
}

export interface OfflineOpts {
  bin: string;
  dataDir: string;
  admin: { email: string; password: string };
}

/**
 * Run the migrations on a stopped data folder: start Vaultbase on it with no
 * snapshot and no hooks, migrate, stop. A folder with no database yet (a new
 * install) needs nothing.
 */
export async function migrateOffline(o: OfflineOpts): Promise<string[]> {
  if (!existsSync(join(o.dataDir, "data.db"))) return [];
  const inst = await startInstance({ bin: o.bin, dataDir: o.dataDir, hooksDir: "off" });
  try {
    const token = await adminLogin(inst.url, o.admin.email, o.admin.password);
    return await migrate(inst.url, token);
  } finally {
    await inst.stop();
  }
}
