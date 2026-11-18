// bun run provision: set up a production instance that is already running
// (docs/RELEASE.md). Unlike `bun run dev` it starts nothing and writes no
// credentials file: it signs in with the admin given in the environment,
// applies Audition's settings plus the backup schedule, creates the owner if
// missing and runs the idempotent seed (the generic handoff template, the
// mock connection and the example workspaces).
//
//   AUDITION_URL               default http://127.0.0.1:8091
//   AUDITION_ADMIN_EMAIL       the admin made with `vaultbase setup-admin`
//   AUDITION_ADMIN_PASSWORD
//   AUDITION_OWNER_EMAIL       the person who uses Audition
//   AUDITION_OWNER_PASSWORD    only used when the owner is created
//   AUDITION_APP_URL           optional, e.g. https://audition.example.com: sets
//                              Vaultbase's App URL, so links in emails open the app
//
// deploy/install.sh runs it compiled (bin/audition-setup in the release
// bundle, scripts/bundle.ts), so the server needs no Bun. The same tool's
// `offsite` command (scripts/offsite.ts) turns on the off-server R2 copy.
import { SETTINGS, adminLogin, applySettings, call, ensureOwner, refuseProviderKeys } from "./lib/vaultbase.ts";
import { seedReference } from "../seed/reference.ts";
import { offsiteMain } from "./offsite.ts";

/**
 * Vaultbase's own scheduled backups (Settings, Backups in the admin): a
 * VACUUM INTO snapshot plus the uploaded files, daily at 03:00 UTC, the
 * last 14 kept in <data dir>/backups/.
 */
export const BACKUP_SETTINGS = {
  "backups.enabled": "1",
  "backups.cron": "0 3 * * *",
  "backups.keep": "14",
  "backups.files": "1",
};

export interface ProvisionOpts {
  url: string;
  admin: { email: string; password: string };
  owner: { email: string; password: string };
  appUrl?: string;
}

export async function provision(o: ProvisionOpts) {
  const token = await adminLogin(o.url, o.admin.email, o.admin.password);
  await applySettings(o.url, token);
  const r = await call(o.url, "PATCH", "/api/v1/admin/settings", { token, body: BACKUP_SETTINGS });
  if (r.status !== 200) throw new Error(`backup settings failed: ${r.status} ${JSON.stringify(r.body)}`);
  if (o.appUrl) {
    const u = await call(o.url, "PATCH", "/api/v1/admin/settings", { token, body: { "app.url": o.appUrl } });
    if (u.status !== 200) throw new Error(`app.url failed: ${u.status} ${JSON.stringify(u.body)}`);
  }
  await ensureOwner(o.url, token, o.owner.email, o.owner.password, "Owner");
  const seed = await seedReference(o.url, token);
  const backups = await call(o.url, "GET", "/api/v1/admin/backups", { token });
  return { token, seed, backupStatus: backups.body?.data?.status };
}

if (import.meta.main && process.argv[2] === "settings") {
  // `install.sh` upgrades run this: Audition's Vaultbase settings (SETTINGS)
  // again, so a release that adds one (guest voters: anonymous sessions and
  // rate limits) takes effect without a fresh install. Idempotent.
  const url = (process.env["AUDITION_URL"] ?? "http://127.0.0.1:8091").replace(/\/$/, "");
  const email = process.env["AUDITION_ADMIN_EMAIL"], password = process.env["AUDITION_ADMIN_PASSWORD"];
  if (!email || !password) { console.error("Set AUDITION_ADMIN_EMAIL and AUDITION_ADMIN_PASSWORD."); process.exit(2); }
  await applySettings(url, await adminLogin(url, email, password));
  console.log(`Settings applied: ${Object.keys(SETTINGS).join(", ")}`);
  process.exit(0);
}

if (import.meta.main && process.argv[2] === "offsite") {
  // The off-server backup copy (scripts/offsite.ts), in the same compiled tool.
  process.exit(await offsiteMain(process.argv.slice(3)));
}

if (import.meta.main) {
  refuseProviderKeys();
  const need = (k: string) => {
    const v = process.env[k];
    if (!v) { console.error(`Set ${k} (see docs/RELEASE.md).`); process.exit(2); }
    return v;
  };
  const out = await provision({
    url: (process.env["AUDITION_URL"] ?? "http://127.0.0.1:8091").replace(/\/$/, ""),
    admin: { email: need("AUDITION_ADMIN_EMAIL"), password: need("AUDITION_ADMIN_PASSWORD") },
    owner: { email: need("AUDITION_OWNER_EMAIL"), password: need("AUDITION_OWNER_PASSWORD") },
    appUrl: process.env["AUDITION_APP_URL"] || undefined,
  });
  if (process.env["AUDITION_APP_URL"]) console.log(`App URL: ${process.env["AUDITION_APP_URL"]}`);
  console.log(`Settings applied: ${Object.keys({ ...SETTINGS, ...BACKUP_SETTINGS }).join(", ")}`);
  console.log(`Seed: ${out.seed.created.length} created, ${out.seed.existing} already there.`);
  const s = out.backupStatus;
  if (s) console.log(`Backups: ${s.enabled ? "on" : "OFF"}, cron "${s.cron}" (UTC), keep ${s.keep}, files ${s.files ? "kept" : "NOT kept"}, next ${s.next_run_at ? new Date(s.next_run_at * 1000).toISOString() : "not planned"}`);
  process.exit(0);
}
