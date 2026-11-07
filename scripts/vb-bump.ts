// bun run vb:bump <version>: rewrite vaultbase.lock.json for another release,
// from that release's SHA256SUMS. Part of the upgrade policy (TECH-SPEC §1):
// Cas approves every bump, and bun test must pass on the new version.
// Usage: bun scripts/vb-bump.ts <version> [--lock <file>] [--base-url <url>]
import { LOCK_PATH, platformAsset, type Lock } from "./lib/vaultbase.ts";

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const version = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1]!.startsWith("--")))?.replace(/^v/, "");
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Usage: bun run vb:bump <version>   (for example 0.41.0)");
  process.exit(2);
}
const lockPath = opt("--lock") ?? LOCK_PATH;
const base = (opt("--base-url") ?? `https://github.com/vaultbase-sh/vaultbase/releases/download/v${version}`).replace(/\/$/, "") + "/";

const res = await fetch(base + "SHA256SUMS");
if (!res.ok) {
  console.error(`REFUSED: no SHA256SUMS for ${version} (${res.status} from ${base}SHA256SUMS)`);
  process.exit(1);
}
const sha256: Record<string, string> = {};
for (const line of (await res.text()).split("\n")) {
  const m = line.trim().match(/^([0-9a-f]{64})\s+\*?(\S+)$/);
  if (m && !m[2]!.endsWith(".xz")) sha256[m[2]!] = m[1]!;
}
const asset = platformAsset();
if (!sha256[asset]) {
  console.error(`REFUSED: SHA256SUMS for ${version} has no checksum for ${asset}`);
  process.exit(1);
}
const lock: Lock = {
  version,
  release_url: `https://github.com/vaultbase-sh/vaultbase/releases/tag/v${version}`,
  download_base: base,
  sha256,
};
await Bun.write(lockPath, JSON.stringify(lock, null, 2) + "\n");
console.log(`vaultbase.lock.json now pins ${version} (${Object.keys(sha256).length} assets). Next: bun run setup && bun test`);
