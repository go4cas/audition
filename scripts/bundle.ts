// bun run bundle: build the release bundles that deploy/install.sh installs
// (docs/RELEASE.md). The server then needs no Bun, no git and no build step.
//
//   bun run bundle [--version v0.3.0] [--arch x64|arm64|all] [--out release-dist]
//
// For each Linux architecture it writes audition-<version>-linux-<arch>.tar.gz:
//
//   audition/
//     VERSION                  the release tag
//     vaultbase.lock.json      the pinned Vaultbase version and checksums
//     vb_hooks/ schema/        what Vaultbase loads
//     ui/dist/                 the built UI
//     seed/fixtures/           files the seed attaches
//     bin/audition-setup       provision (settings, backups, owner, seed), compiled with Bun
//     deploy/                  install.sh, preflight.sh, the unit and proxy templates
//
// plus install.sh (with the version filled in), preflight.sh and SHA256SUMS. The Vaultbase
// binary is not in the bundle: install.sh downloads it from Vaultbase's own
// release and checks it against vaultbase.lock.json.
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ROOT, sha256File } from "./lib/vaultbase.ts";

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };

async function gitDescribe(): Promise<string> {
  const p = Bun.spawn(["git", "describe", "--tags", "--always", "--dirty"], { cwd: ROOT, stdout: "pipe", stderr: "ignore" });
  return (await new Response(p.stdout).text()).trim() || "dev";
}

const version = opt("version") ?? process.env["AUDITION_VERSION"] ?? (await gitDescribe());
if (!/^[A-Za-z0-9._-]+$/.test(version)) throw new Error(`Bad version "${version}"`);
const archOpt = opt("arch") ?? "all";
const arches = archOpt === "all" ? ["x64", "arm64"] : [archOpt];
for (const a of arches) if (a !== "x64" && a !== "arm64") throw new Error(`Unknown arch "${a}" (x64 or arm64)`);
const out = resolve(ROOT, opt("out") ?? "release-dist");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// The UI is the same for every architecture: build it once.
{
  const p = Bun.spawn(["bun", "scripts/build-ui.ts"], { cwd: ROOT, stdout: "inherit", stderr: "inherit", env: { ...process.env, AUDITION_VERSION: version } });
  if ((await p.exited) !== 0) throw new Error("build:ui failed");
}

const assets: string[] = [];
for (const arch of arches) {
  const stage = join(out, `stage-${arch}`, "audition");
  mkdirSync(join(stage, "bin"), { recursive: true });
  for (const dir of ["vb_hooks", "schema", "ui/dist", "seed/fixtures"]) {
    cpSync(join(ROOT, dir), join(stage, dir), { recursive: true });
  }
  mkdirSync(join(stage, "deploy"), { recursive: true });
  for (const f of ["install.sh", "preflight.sh", "audition.service", "audition.env.example", "Caddyfile", "nginx.conf"]) {
    cpSync(join(ROOT, "deploy", f), join(stage, "deploy", f));
  }
  cpSync(join(ROOT, "vaultbase.lock.json"), join(stage, "vaultbase.lock.json"));
  writeFileSync(join(stage, "VERSION"), `${version}\n`);

  const setup = join(stage, "bin", "audition-setup");
  const b = Bun.spawn([
    "bun", "build", "--compile", `--target=bun-linux-${arch}`, "--minify", "--sourcemap=none",
    join(ROOT, "scripts", "provision.ts"), "--outfile", setup,
  ], { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
  if ((await b.exited) !== 0) throw new Error(`compiling audition-setup for ${arch} failed`);
  chmodSync(setup, 0o755);

  const name = `audition-${version}-linux-${arch}.tar.gz`;
  const t = Bun.spawn(["tar", "-czf", join(out, name), "--owner=0", "--group=0", "-C", join(out, `stage-${arch}`), "audition"], { stdout: "inherit", stderr: "inherit" });
  if ((await t.exited) !== 0) throw new Error(`tar for ${arch} failed`);
  rmSync(join(out, `stage-${arch}`), { recursive: true, force: true });
  assets.push(name);
}

// install.sh with this release's version as its default.
const installer = readFileSync(join(ROOT, "deploy", "install.sh"), "utf8").replace(/^AUDITION_VERSION_DEFAULT=.*$/m, `AUDITION_VERSION_DEFAULT="${version}"`);
writeFileSync(join(out, "install.sh"), installer);
chmodSync(join(out, "install.sh"), 0o755);
assets.push("install.sh");
cpSync(join(ROOT, "deploy", "preflight.sh"), join(out, "preflight.sh"));
assets.push("preflight.sh");

const sums: string[] = [];
for (const a of assets) sums.push(`${await sha256File(join(out, a))}  ${a}`);
writeFileSync(join(out, "SHA256SUMS"), sums.join("\n") + "\n");
console.log(`Release ${version} in ${out}:\n  ${[...assets, "SHA256SUMS"].join("\n  ")}`);
if (!existsSync(join(out, "SHA256SUMS"))) process.exit(1);
