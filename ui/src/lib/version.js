// Audition's version, baked in at build time by scripts/build-ui.ts (the
// release tag in a release bundle, `git describe` in development), so it can
// never drift from the code that is running. Vaultbase's version is read at
// runtime from its own health endpoint, so it stays right after an upgrade.
/* global AUDITION_VERSION */
import { reactive } from "@arrow-js/core";

// eslint-disable-next-line no-undef
export const APP_VERSION = typeof AUDITION_VERSION === "string" ? AUDITION_VERSION : "dev";

export const versions = reactive({ vaultbase: "" });

let asked = false;
/** Ask Vaultbase once which version it is (GET /api/health). */
export async function loadVaultbaseVersion() {
  if (asked) return;
  asked = true;
  try {
    const r = await fetch("/api/health", { headers: { accept: "application/json" } });
    const v = (await r.json())?.data?.version;
    if (typeof v === "string" && /^[\w.+-]{1,32}$/.test(v)) versions.vaultbase = v;
  } catch { asked = false; }
}
