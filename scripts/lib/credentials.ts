// Admin and owner sign-ins for the local instance, kept in .vaultbase/credentials.json
// (git-ignored, mode 600). The owner can be set with AUDITION_OWNER_EMAIL and
// AUDITION_OWNER_PASSWORD; anything not given is generated once and printed.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { STATE_DIR } from "./vaultbase.ts";

export interface Credentials {
  admin: { email: string; password: string };
  owner: { email: string; password: string };
}

const FILE = join(STATE_DIR, "credentials.json");
const secret = () => randomBytes(18).toString("base64url");

export function loadCredentials(): { creds: Credentials; created: boolean } {
  let creds: Credentials | null = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : null;
  let created = false;
  if (!creds) {
    creds = {
      admin: { email: "admin@audition.local", password: secret() },
      owner: { email: process.env["AUDITION_OWNER_EMAIL"] ?? "owner@audition.local", password: process.env["AUDITION_OWNER_PASSWORD"] ?? secret() },
    };
    created = true;
  }
  const envEmail = process.env["AUDITION_OWNER_EMAIL"];
  const envPass = process.env["AUDITION_OWNER_PASSWORD"];
  if (envEmail && envEmail !== creds.owner.email) { creds.owner.email = envEmail; created = true; }
  if (envPass && envPass !== creds.owner.password) { creds.owner.password = envPass; created = true; }
  if (created) {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(FILE, JSON.stringify(creds, null, 2) + "\n", { mode: 0o600 });
    chmodSync(FILE, 0o600);
  }
  return { creds, created };
}

export const CREDENTIALS_FILE = FILE;
