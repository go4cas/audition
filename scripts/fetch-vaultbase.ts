// bun run setup: download the pinned Vaultbase binary and check its SHA-256.
// Usage: bun scripts/fetch-vaultbase.ts [--bin-dir <dir>] [--lock <file>]
import { ChecksumError, ensureBinary, readLock } from "./lib/vaultbase.ts";

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

try {
  const lock = await readLock(opt("--lock"));
  const path = await ensureBinary({ lock, binDir: opt("--bin-dir"), log: (s) => console.log(s) });
  console.log(`Vaultbase ${lock.version} ready at ${path}`);
} catch (e) {
  console.error(e instanceof ChecksumError ? `REFUSED: ${e.message}` : `Failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
