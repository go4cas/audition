// The one-command server install (deploy/install.sh, docs/RELEASE.md): the
// release bundle from `bun run bundle`, and the steps install.sh runs inside
// it, on a fresh Vaultbase laid out from the bundle alone. The installer's
// system steps (user, systemd, proxy) need root and a real server; they were
// run by hand in a scratch Linux machine (PR notes).
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT, call, ensureBinary, ownerLogin, sha256File, startInstance, type Instance } from "../scripts/lib/vaultbase.ts";

const root = mkdtempSync(join(tmpdir(), "audition-install-"));
const out = join(root, "release");
const arch = process.arch === "arm64" ? "arm64" : "x64";
const VERSION = "v9.9.9-test";
const app = join(root, "audition");
let inst: Instance;

async function run(cmd: string[], env: Record<string, string> = {}) {
  const p = Bun.spawn(cmd, { cwd: ROOT, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  const [o, e, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, out: o + e };
}

beforeAll(async () => {
  const b = await run(["bun", "scripts/bundle.ts", "--version", VERSION, "--arch", arch, "--out", out]);
  if (b.code !== 0) throw new Error(b.out);
  const t = await run(["tar", "-xzf", join(out, `audition-${VERSION}-linux-${arch}.tar.gz`), "-C", root]);
  if (t.code !== 0) throw new Error(t.out);
}, 180_000);

afterAll(async () => {
  await inst?.stop();
  rmSync(root, { recursive: true, force: true });
});

test("the bundle holds everything the server needs, and nothing to build", () => {
  for (const p of [
    "VERSION", "vaultbase.lock.json", "vb_hooks/routes/app.ts", "schema/snapshot.json", "ui/dist/index.html",
    "seed/fixtures/mockup.png", "bin/audition-setup", "deploy/install.sh", "deploy/preflight.sh",
    "deploy/audition.service", "deploy/audition.env.example", "deploy/Caddyfile", "deploy/nginx.conf",
  ]) expect(existsSync(join(app, p))).toBe(true);
  expect(readFileSync(join(app, "VERSION"), "utf8").trim()).toBe(VERSION);
  expect(existsSync(join(app, "node_modules"))).toBe(false);
  expect(existsSync(join(app, "scripts"))).toBe(false);
});

test("SHA256SUMS covers every asset, and install.sh defaults to this release", async () => {
  const sums = readFileSync(join(out, "SHA256SUMS"), "utf8").trim().split("\n").map((l) => l.split(/\s+/));
  expect(sums.map((s) => s[1]).sort()).toEqual([`audition-${VERSION}-linux-${arch}.tar.gz`, "install.sh", "preflight.sh"].sort());
  for (const [hash, name] of sums) expect(await sha256File(join(out, name!))).toBe(hash!);
  expect(readFileSync(join(out, "install.sh"), "utf8")).toContain(`AUDITION_VERSION_DEFAULT="${VERSION}"`);
});

test("install.sh and preflight.sh parse, and templates keep placeholders out of comments", async () => {
  for (const f of ["deploy/install.sh", "deploy/preflight.sh"]) expect((await run(["bash", "-n", f])).code).toBe(0);
  for (const f of ["deploy/Caddyfile", "deploy/nginx.conf", "deploy/audition.env.example", "deploy/audition.service"]) {
    for (const line of readFileSync(join(ROOT, f), "utf8").split("\n")) {
      if (line.trimStart().startsWith("#")) expect(line).not.toMatch(/__[A-Z]+__/);
    }
  }
  // Nothing outside Audition's own paths.
  const unit = readFileSync(join(ROOT, "deploy/audition.service"), "utf8");
  expect(unit).toContain("ExecStart=/opt/audition/bin/vaultbase ");
  expect(unit).not.toContain("/usr/local");
  expect(unit).toMatch(/^MemoryMax=/m);
});

test("install steps: admin through the setup key, then the compiled setup tool", async () => {
  const bin = await ensureBinary();
  inst = await startInstance({
    bin, dataDir: join(root, "data"), hooksDir: join(app, "vb_hooks"),
    snapshot: join(app, "schema", "snapshot.json"),
    env: { AUDITION_UI_DIST: join(app, "ui", "dist") },
  });

  // As install.sh: Vaultbase writes its setup key when asked for setup status.
  await call(inst.url, "GET", "/api/v1/admin/setup/status");
  const keyFile = join(inst.dataDir, ".setup-key");
  for (let i = 0; i < 20 && !existsSync(keyFile); i++) await Bun.sleep(100);
  const key = readFileSync(keyFile, "utf8").trim();
  const email = "owner@install.local";
  const adminPw = "Admin-install-pass-1-xyz";
  const noKey = await fetch(`${inst.url}/api/v1/admin/setup`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: adminPw }),
  });
  expect(noKey.status).toBe(401);
  const setup = await fetch(`${inst.url}/api/v1/admin/setup`, {
    method: "POST", headers: { "content-type": "application/json", "x-setup-key": key }, body: JSON.stringify({ email, password: adminPw }),
  });
  expect(setup.status).toBe(200);

  const r = await run([join(app, "bin", "audition-setup")], {
    AUDITION_URL: inst.url, AUDITION_APP_URL: "https://audition.example.com",
    AUDITION_ADMIN_EMAIL: email, AUDITION_ADMIN_PASSWORD: adminPw,
    AUDITION_OWNER_EMAIL: email, AUDITION_OWNER_PASSWORD: "Owner-install-pass-1",
    AUDITION_SEED_FIXTURES: join(app, "seed", "fixtures"),
    HTTP_PROXY: "", HTTPS_PROXY: "", http_proxy: "", https_proxy: "",
  });
  expect(r.code).toBe(0);
  expect(r.out).toContain("App URL: https://audition.example.com");
  expect(r.out).toMatch(/Backups: on/);

  const owner = await ownerLogin(inst.url, email, "Owner-install-pass-1");
  const ws = await call(inst.url, "GET", "/api/v1/workspaces", { token: owner });
  expect(ws.body.totalItems).toBe(4);
  const ui = await fetch(`${inst.url}/api/custom/app/`);
  expect(ui.status).toBe(200);
}, 120_000);
