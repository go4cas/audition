// Runs once before any test file (bunfig.toml [test] preload). On a fresh
// clone the first boot() would otherwise download the pinned binary inside a
// file's beforeAll and outlast bun's 5-second hook limit (NOTES.md T5-F3).
import { ensureBinary } from "../scripts/lib/vaultbase.ts";

await ensureBinary({ log: (s) => console.log(s) });

// The app is Vaultbase's public folder (ui/dist, TECH-SPEC Q2): build it once
// here, so every instance a test boots serves it at the site root. Vaultbase
// only gets VAULTBASE_PUBLIC_DIR when the folder exists (scripts/lib/vaultbase.ts).
const ui = Bun.spawnSync(["bun", new URL("../scripts/build-ui.ts", import.meta.url).pathname], { stdout: "ignore", stderr: "pipe" });
if (ui.exitCode !== 0) throw new Error(`building the UI failed:\n${ui.stderr.toString()}`);
