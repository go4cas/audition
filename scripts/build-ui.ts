// bun run build:ui: build ui/src into ui/dist.
// Static files (html, css, svg, png, ico, webmanifest) are copied; ui/src/main.js,
// when it exists, is bundled with Bun.build (T4 adds it).
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { ROOT } from "./lib/vaultbase.ts";

const src = join(ROOT, "ui", "src");
const dist = join(ROOT, "ui", "dist");
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const STATIC = new Set([".html", ".css", ".svg", ".png", ".ico", ".webmanifest", ".woff2", ".txt"]);
const copy = (dir: string, out: string) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { mkdirSync(join(out, name), { recursive: true }); copy(p, join(out, name)); }
    else if (STATIC.has(extname(name))) cpSync(p, join(out, name));
  }
};
copy(src, dist);

const entry = join(src, "main.js");
if (existsSync(entry)) {
  const r = await Bun.build({ entrypoints: [entry], outdir: dist, target: "browser", format: "esm", minify: false });
  if (!r.success) { for (const l of r.logs) console.error(l); process.exit(1); }
}
console.log(`UI built into ${dist}`);
