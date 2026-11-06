// bun run seed: seed the reference workspaces into the running dev instance.
// Idempotent by name. Needs `bun run dev` to be running.
import { seedReference } from "../seed/reference.ts";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { STATE_DIR, adminLogin } from "./lib/vaultbase.ts";
import { loadCredentials } from "./lib/credentials.ts";

const instanceFile = join(STATE_DIR, "instance.json");
const base = process.env["AUDITION_URL"]
  ?? (existsSync(instanceFile) ? (JSON.parse(readFileSync(instanceFile, "utf8")) as { url: string }).url : "http://127.0.0.1:8091");
const { creds } = loadCredentials();
const token = await adminLogin(base, creds.admin.email, creds.admin.password);
const report = await seedReference(base, token);
console.log(`Seeded: ${report.created.length} created, ${report.existing} already there.`);
for (const c of report.created) console.log(`  + ${c}`);
