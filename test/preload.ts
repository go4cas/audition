// Runs once before any test file (bunfig.toml [test] preload). On a fresh
// clone the first boot() would otherwise download the pinned binary inside a
// file's beforeAll and outlast bun's 5-second hook limit (NOTES.md T5-F3).
import { ensureBinary } from "../scripts/lib/vaultbase.ts";

await ensureBinary({ log: (s) => console.log(s) });
