// bun run build:ui: build ui/src into ui/dist.
// Static files (html, css, svg, png, ico, webmanifest) are copied; ui/src/main.js,
// when it exists, is bundled and minified with Bun.build, with linked source
// maps (main.js.map) so browser devtools still show the original modules.
// Quiver's Bun plugin builds the `quiver:app` module from ui/src (pages/,
// middleware/, views/). Pages are loaded lazily, so `splitting` gives a small
// first-load bundle (main.js and the chunks it imports) plus one chunk per page.
// index.html loads main.js and the stylesheets with ?v=<content hash> (cache busting).
// The app shows its version (lib/version.js): AUDITION_VERSION when set (the
// release bundle sets it to the tag), otherwise `git describe`, otherwise "dev".
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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

export async function uiVersion(): Promise<string> {
  const env = process.env["AUDITION_VERSION"];
  if (env) return env;
  try {
    const p = Bun.spawn(["git", "describe", "--tags", "--always", "--dirty"], { cwd: ROOT, stdout: "pipe", stderr: "ignore" });
    const v = (await new Response(p.stdout).text()).trim();
    if ((await p.exited) === 0 && v) return v;
  } catch {}
  return "dev";
}

const entry = join(src, "main.js");
if (existsSync(entry)) {
  const r = await Bun.build({ entrypoints: [entry], outdir: dist, target: "browser", format: "esm", minify: true, sourcemap: "linked", splitting: true, plugins: [quiver({ srcDir: src })], naming: { entry: "[name].[ext]", chunk: "chunks/[hash].[ext]" }, define: { "AUDITION_VERSION": JSON.stringify(await uiVersion()) } });
  if (!r.success) { for (const l of r.logs) console.error(l); process.exit(1); }
}
// Cache busting: main.js and the stylesheets keep their names, so index.html
// (served no-cache) loads them as `?v=<content hash>`. A browser or Cloudflare
// holding an old copy (Cloudflare's browser cache TTL can be hours) gets the
// new file the first time the page loads after an upgrade. Chunks are already
// named by hash.
const indexPath = join(dist, "index.html");
if (existsSync(indexPath)) {
  const html = readFileSync(indexPath, "utf8").replace(/(href|src)="(\/api\/custom\/app\/)((?:main\.js)|(?:styles\/[\w.-]+\.css))"/g, (m, attr, base, file) => {
    const p = join(dist, file);
    if (!existsSync(p)) return m;
    const v = new Bun.CryptoHasher("sha256").update(readFileSync(p)).digest("hex").slice(0, 10);
    return `${attr}="${base}${file}?v=${v}"`;
  });
  writeFileSync(indexPath, html);
}
console.log(`UI built into ${dist}`);
