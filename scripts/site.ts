// Assemble the public site (site/) into _site/ for GitHub Pages.
//
// The site shares the app's brand files instead of keeping copies in git:
// tokens, fonts, icon sprite and logo are copied in from ui/src/ and
// docs/design/ here, so a brand change in the app reaches the site too.
//
// Versions: {{AUDITION_VERSION}} and {{VAULTBASE_VERSION}} in the HTML are
// filled in here. Audition's is AUDITION_VERSION when set, otherwise the newest
// release tag (`git describe`; the Website workflow also runs when a release is
// published), otherwise GitHub's latest release. Vaultbase's is the pinned one
// in vaultbase.lock.json, so the site follows a Vaultbase upgrade by itself.
//
//   bun scripts/site.ts            build _site/
//   bun scripts/site.ts --serve    build, then serve it on http://127.0.0.1:8095
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
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

const VERSION_RE = /^v?\d+\.\d+\.\d+[\w.+-]*$/;

/** The newest Audition release tag, or "" when none can be found. */
export async function latestRelease(): Promise<string> {
  const env = process.env["AUDITION_VERSION"];
  if (env && VERSION_RE.test(env)) return env;
  try {
    const p = Bun.spawnSync(["git", "describe", "--tags", "--abbrev=0", "--match", "v[0-9]*"], { cwd: ROOT, stderr: "ignore" });
    const tag = p.stdout.toString().trim();
    if (p.exitCode === 0 && VERSION_RE.test(tag)) return tag;
  } catch {}
  try {
    const r = await fetch("https://api.github.com/repos/go4cas/audition/releases/latest", { headers: { accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(5000) });
    const tag = r.ok ? String((await r.json()).tag_name || "") : "";
    if (VERSION_RE.test(tag)) return tag;
  } catch {}
  return "";
}

/** The pinned Vaultbase version. */
export function vaultbaseVersion(): string {
  return String(JSON.parse(readFileSync(join(ROOT, "vaultbase.lock.json"), "utf8")).version);
}

/** Fill the version placeholders in every HTML file under dir. */
function fillVersions(dir: string, audition: string, vaultbase: string) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { fillVersions(p, audition, vaultbase); continue; }
    if (!name.endsWith(".html")) continue;
    const html = readFileSync(p, "utf8");
    const out = html.replaceAll("{{AUDITION_VERSION}}", audition).replaceAll("{{VAULTBASE_VERSION}}", vaultbase);
    if (out !== html) writeFileSync(p, out);
  }
}

export async function build() {
  rmSync(OUT, { recursive: true, force: true });
  cpSync(join(ROOT, "site"), OUT, { recursive: true, filter: (src) => !src.endsWith("README.md") });
  for (const [from, to] of shared) {
    const src = join(ROOT, from);
    if (!existsSync(src)) throw new Error(`site: missing ${from}`);
    mkdirSync(join(OUT, to, ".."), { recursive: true });
    cpSync(src, join(OUT, to), { recursive: true });
  }
  const audition = await latestRelease();
  const vaultbase = vaultbaseVersion();
  fillVersions(OUT, audition || "latest", vaultbase);
  // GitHub Pages: serve files as they are (no Jekyll).
  writeFileSync(join(OUT, ".nojekyll"), "");
  console.log(`Site built into ${OUT} (Audition ${audition || "version unknown"}, Vaultbase ${vaultbase})`);
}

if (import.meta.main) {
  await build();
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
