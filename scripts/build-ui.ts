// bun run build:ui: build ui/src into ui/dist.
// Static files (html, css, svg, png, ico, webmanifest) are copied; ui/src/main.js,
// when it exists, is bundled and minified with Bun.build, with linked source
// maps (main.js.map) so browser devtools still show the original modules.
// Quiver's Bun plugin builds the `quiver:app` module from ui/src (pages/,
// middleware/, views/). Pages are loaded lazily, so `splitting` gives a small
// first-load bundle (main.js and the chunks it imports) plus one chunk per page.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import quiver from "@go4cas/quiver/bun";
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
  const r = await Bun.build({ entrypoints: [entry], outdir: dist, target: "browser", format: "esm", minify: true, sourcemap: "linked", splitting: true, plugins: [quiver({ srcDir: src })], naming: { entry: "[name].[ext]", chunk: "chunks/[hash].[ext]" } });
  if (!r.success) { for (const l of r.logs) console.error(l); process.exit(1); }
}
console.log(`UI built into ${dist}`);
