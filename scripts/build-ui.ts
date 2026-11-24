// bun run build:ui: build ui/src into ui/dist.
// Static files (html, css, svg, png, ico, webmanifest) are copied; ui/src/main.js,
// when it exists, is bundled and minified with Bun.build, with linked source
// maps (main.js.map) so browser devtools still show the original modules.
// Quiver's Bun plugin builds the `quiver:app` module from ui/src (pages/,
// middleware/, views/). Pages are loaded lazily, so `splitting` gives a small
// first-load bundle (main.js and the chunks it imports) plus one chunk per page.
// Every file that changes with a build carries a content hash in its name
// (main-<hash>.js, chunks/chunk-<hash>.js, styles/app-<hash>.css,
// fonts/<name>-<hash>.woff2), so Vaultbase's public folder caches it for a
// year; index.html, which names them, is revalidated on every load.
// ui/dist is served at the site root (VAULTBASE_PUBLIC_DIR, TECH-SPEC Q2).
// The app shows its version (lib/version.js): AUDITION_VERSION when set (the
// release bundle sets it to the tag), otherwise `git describe`, otherwise "dev".
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import quiver from "@go4cas/quiver/bun";
import { ROOT } from "./lib/vaultbase.ts";
import { APP_CSP } from "../vb_hooks/lib/static.ts";
import { ONESIGNAL_WORKER, ONESIGNAL_WORKER_JS } from "../vb_hooks/lib/push.ts";

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

let mainJs = "main.js";
const entry = join(src, "main.js");
if (existsSync(entry)) {
  const r = await Bun.build({ entrypoints: [entry], outdir: dist, target: "browser", format: "esm", minify: true, sourcemap: "linked", splitting: true, plugins: [quiver({ srcDir: src })], naming: { entry: "[name]-[hash].[ext]", chunk: "chunks/chunk-[hash].[ext]" }, define: { "AUDITION_VERSION": JSON.stringify(await uiVersion()) } });
  if (!r.success) { for (const l of r.logs) console.error(l); process.exit(1); }
  const out = r.outputs.find((o) => o.kind === "entry-point");
  if (out) mainJs = out.path.slice(dist.length + 1).split("\\").join("/");
}

// OneSignal's service worker sits next to the app, in its scope "/" (lib/push.ts).
writeFileSync(join(dist, ONESIGNAL_WORKER), ONESIGNAL_WORKER_JS);

// Cache busting for the files Bun doesn't build: the stylesheets and fonts are
// renamed to <name>-<stamp>.<ext>. Vaultbase (0.48, core/public-dir.ts) treats
// a name as hashed, and caches it for a year, only when the part after the
// last "-" or "." before the extension is 8+ characters with a digit and a
// letter, so the stamp is a 10-character window of the SHA-256 that has both.
// Bun's own [hash] for main.js and the chunks is usually such a name too; one
// without a digit is still served correctly, only revalidated on each load.
function stampOf(bytes: Uint8Array | string): string {
  const hex = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  for (let i = 0; i + 10 <= hex.length; i++) {
    const w = hex.slice(i, i + 10);
    if (/\d/.test(w) && /[a-f]/.test(w)) return w;
  }
  return "0a" + hex.slice(0, 8);
}
const renamed = new Map<string, string>(); // "styles/app.css" → "styles/app-<stamp>.css"
const stamp = (rel: string) => {
  const p = join(dist, rel);
  if (!existsSync(p)) return rel;
  const ext = extname(rel);
  const out = rel.slice(0, -ext.length) + "-" + stampOf(readFileSync(p)) + ext;
  renameSync(p, join(dist, out));
  renamed.set(rel, out);
  return out;
};
for (const f of existsSync(join(dist, "fonts")) ? readdirSync(join(dist, "fonts")) : []) if (f.endsWith(".woff2")) stamp(`fonts/${f}`);
// fonts.css names the fonts, so it is rewritten before it is stamped itself.
const fontsCss = join(dist, "styles", "fonts.css");
if (existsSync(fontsCss)) {
  writeFileSync(fontsCss, readFileSync(fontsCss, "utf8").replace(/url\(\.\.\/(fonts\/[\w.-]+\.woff2)\)/g, (m, file) => (renamed.has(file) ? `url(../${renamed.get(file)})` : m)));
}
for (const f of existsSync(join(dist, "styles")) ? readdirSync(join(dist, "styles")) : []) if (f.endsWith(".css")) stamp(`styles/${f}`);

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
const escapeAttr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const indexPath = join(dist, "index.html");
if (existsSync(indexPath)) {
  let html = readFileSync(indexPath, "utf8")
    .replace(/(href|src)="\/((?:main\.js)|(?:styles\/[\w.-]+\.css)|(?:fonts\/[\w.-]+\.woff2))"/g, (m, attr, file) => {
      const now = file === "main.js" ? mainJs : renamed.get(file);
      return now ? `${attr}="/${now}"` : m;
    })
    // The CSP as a <meta> tag, first in <head> so it covers every file after it.
    .replace(/<meta charset="utf-8">\n/, (m) => `${m}  <meta http-equiv="Content-Security-Policy" content="${escapeAttr(APP_CSP)}">\n`);
  const preloads = [...staticImports(join(dist, mainJs))]
    .map((p) => `  <link rel="modulepreload" href="/${p.slice(dist.length + 1).split("\\").join("/")}">\n`).join("");
  html = html.replace(/(  <script type="module" src="\/main)/, `${preloads}$1`);
  writeFileSync(indexPath, html);
}
console.log(`UI built into ${dist}`);
