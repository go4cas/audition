// bun run stop: stop the instance started by `bun run dev`.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { STATE_DIR } from "./lib/vaultbase.ts";

const pidFile = join(STATE_DIR, "vaultbase.pid");
if (!existsSync(pidFile)) {
  console.log("No running instance (no PID file).");
  process.exit(0);
}
const pid = Number(readFileSync(pidFile, "utf8").trim());
try {
  process.kill(pid, "SIGTERM");
  for (let i = 0; i < 100; i++) {
    try { process.kill(pid, 0); } catch { break; }
    await Bun.sleep(100);
  }
  console.log(`Stopped Vaultbase (PID ${pid}).`);
} catch {
  console.log(`PID ${pid} was not running.`);
}
rmSync(pidFile, { force: true });
rmSync(join(STATE_DIR, "instance.json"), { force: true });
