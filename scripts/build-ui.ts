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
// Cache busting: main.js, the stylesheets and the fonts keep their names, so
// index.html (served no-cache) loads them as `?v=<content hash>`, and
// fonts.css does the same for the font files. A browser or Cloudflare holding
// an old copy gets the new file the first time the page loads after an
// upgrade. Chunks are already named by hash. routes/app.ts serves all of these
// with a one-year cache lifetime (lib/static.ts cacheControl).
const hashOf = (p: string) => new Bun.CryptoHasher("sha256").update(readFileSync(p)).digest("hex").slice(0, 10);
const fontsCss = join(dist, "styles", "fonts.css");
if (existsSync(fontsCss)) {
  writeFileSync(fontsCss, readFileSync(fontsCss, "utf8").replace(/url\(\.\.\/(fonts\/[\w.-]+\.woff2)\)/g, (m, file) => {
    const p = join(dist, file);
    return existsSync(p) ? `url(../${file}?v=${hashOf(p)})` : m;
  }));
}
// Static imports of main.js, followed through the chunks they import. The
// browser would only find each one after the previous file arrived; listing
// them as <link rel="modulepreload"> in index.html fetches them all at once
// (Lighthouse: network dependency tree, LCP). Lazy page chunks (import()) are
// left out; Bun's own preload helper fetches their imports when a page loads.
function staticImports(file: string, seen = new Set<string>()): Set<string> {
  if (!existsSync(file)) return seen;
  const code = readFileSync(file, "utf8");
  for (const m of code.matchAll(/(?:\bfrom|\bimport)\s*"(\.{1,2}\/[^"]+\.js)"/g)) {
    const target = join(file, "..", m[1]!);
    if (seen.has(target)) continue;
    seen.add(target);
    staticImports(target, seen);
  }
  return seen;
}
const indexPath = join(dist, "index.html");
if (existsSync(indexPath)) {
  let html = readFileSync(indexPath, "utf8").replace(/(href|src)="(\/api\/custom\/app\/)((?:main\.js)|(?:styles\/[\w.-]+\.css)|(?:fonts\/[\w.-]+\.woff2))"/g, (m, attr, base, file) => {
    const p = join(dist, file);
    if (!existsSync(p)) return m;
    return `${attr}="${base}${file}?v=${hashOf(p)}"`;
  });
  const preloads = [...staticImports(join(dist, "main.js"))]
    .map((p) => `  <link rel="modulepreload" href="/api/custom/app/${p.slice(dist.length + 1).split("\\").join("/")}">\n`).join("");
  html = html.replace(/(  <script type="module" src="\/api\/custom\/app\/main\.js)/, `${preloads}$1`);
  writeFileSync(indexPath, html);
}
console.log(`UI built into ${dist}`);
