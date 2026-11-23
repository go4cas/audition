// bun run dev: one command from a fresh clone to a running Audition.
//   1. download and verify the pinned Vaultbase binary
//   2. build the UI
//   3. create or reset the admin; migrate existing data (scripts/lib/migrate.ts);
//      start Vaultbase with the schema snapshot
//   4. apply settings, create the owner if missing, seed if needed
//   5. print the UI URL
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { seedReference } from "../seed/reference.ts";
import {
  HOOKS_DIR, ROOT, SNAPSHOT_PATH, STATE_DIR, adminLogin, applySettings, ensureBinary, ensureOwner,
  refuseProviderKeys, setupAdmin, startInstance,
} from "./lib/vaultbase.ts";
import { CREDENTIALS_FILE, loadCredentials } from "./lib/credentials.ts";
import { migrateOffline } from "./lib/migrate.ts";

refuseProviderKeys();
const port = Number(process.env["VAULTBASE_PORT"] ?? 8091);
const dataDir = process.env["VAULTBASE_DATA_DIR"] ?? join(STATE_DIR, "data");
const pidFile = join(STATE_DIR, "vaultbase.pid");

if (existsSync(pidFile)) {
  const pid = Number(readFileSync(pidFile, "utf8"));
  try { process.kill(pid, 0); console.log(`Vaultbase is already running (PID ${pid}). Run \`bun run stop\` first.`); process.exit(1); } catch { /* stale */ }
}

const bin = await ensureBinary({ log: (s) => console.log(s) });
const build = Bun.spawnSync(["bun", join(ROOT, "scripts", "build-ui.ts")], { stdout: "inherit", stderr: "inherit" });
if (build.exitCode !== 0) process.exit(1);

const { creds, created } = loadCredentials();
await setupAdmin(bin, dataDir, HOOKS_DIR, creds.admin.email, creds.admin.password);
for (const s of await migrateOffline({ bin, dataDir, admin: creds.admin })) console.log(`Migrated: ${s}`);
const inst = await startInstance({
  bin, dataDir, hooksDir: HOOKS_DIR, port, snapshot: SNAPSHOT_PATH, host: process.env["VAULTBASE_HOST"] ?? "127.0.0.1",
  logFile: join(STATE_DIR, "vaultbase.log"), detached: true,
});
writeFileSync(pidFile, String(inst.proc.pid));
writeFileSync(join(STATE_DIR, "instance.json"), JSON.stringify({ url: inst.url, pid: inst.proc.pid }) + "\n");

const token = await adminLogin(inst.url, creds.admin.email, creds.admin.password);
await applySettings(inst.url, token);
await ensureOwner(inst.url, token, creds.owner.email, creds.owner.password, "Owner");
const report = await seedReference(inst.url, token);

console.log(`\nVaultbase ${port} (PID ${inst.proc.pid}), log: .vaultbase/vaultbase.log`);
console.log(`Seed: ${report.created.length} created, ${report.existing} already there.`);
if (created) {
  console.log(`\nSign-ins (saved in ${CREDENTIALS_FILE}):`);
  console.log(`  Owner: ${creds.owner.email} / ${creds.owner.password}`);
  console.log(`  Admin (Vaultbase admin UI at ${inst.url}/_/): ${creds.admin.email} / ${creds.admin.password}`);
}
console.log(`\nAudition: ${inst.url}/api/custom/app/`);
process.exit(0);
