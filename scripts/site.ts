// Assemble the public site (site/) into _site/ for GitHub Pages.
//
// The site shares the app's brand files instead of keeping copies in git:
// tokens, fonts, icon sprite and logo are copied in from ui/src/ and
// docs/design/ here, so a brand change in the app reaches the site too.
//
//   bun scripts/site.ts            build _site/
//   bun scripts/site.ts --serve    build, then serve it on http://127.0.0.1:8095
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, "_site");

const shared: [from: string, to: string][] = [
  ["ui/src/styles/tokens.css", "assets/css/tokens.css"],
  ["ui/src/styles/fonts.css", "assets/css/fonts.css"],
  ["ui/src/fonts", "assets/fonts"],
  ["ui/src/sprite.svg", "assets/icons.svg"],
  ["docs/design/logo/audition-icon.svg", "assets/brand/audition-icon.svg"],
  ["docs/design/logo/app-icons/favicon.svg", "assets/brand/favicon.svg"],
  ["docs/design/logo/app-icons/favicon.ico", "assets/brand/favicon.ico"],
  ["docs/design/logo/app-icons/apple-touch-icon.png", "assets/brand/apple-touch-icon.png"],
];

export function build() {
  rmSync(OUT, { recursive: true, force: true });
  cpSync(join(ROOT, "site"), OUT, { recursive: true, filter: (src) => !src.endsWith("README.md") });
  for (const [from, to] of shared) {
    const src = join(ROOT, from);
    if (!existsSync(src)) throw new Error(`site: missing ${from}`);
    mkdirSync(join(OUT, to, ".."), { recursive: true });
    cpSync(src, join(OUT, to), { recursive: true });
  }
  // GitHub Pages: serve files as they are (no Jekyll).
  writeFileSync(join(OUT, ".nojekyll"), "");
  console.log(`Site built into ${OUT}`);
}

if (import.meta.main) {
  build();
  if (process.argv.includes("--serve")) {
    const port = Number(process.env["SITE_PORT"] || 8095);
    Bun.serve({
      port, hostname: "127.0.0.1",
      async fetch(req) {
        let path = decodeURIComponent(new URL(req.url).pathname);
        if (path.endsWith("/")) path += "index.html";
        const file = Bun.file(join(OUT, path));
        if (path.includes("..") || !(await file.exists())) return new Response("Not found", { status: 404 });
        return new Response(file);
      },
    });
    console.log(`Serving on http://127.0.0.1:${port}/`);
  }
}
