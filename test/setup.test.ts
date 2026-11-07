// bun run setup refuses a binary whose checksum doesn't match the lock, and
// bun run vb:bump rewrites the lock from a release's SHA256SUMS. A local
// server stands in for GitHub Releases, so no test needs the internet.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT, binaryPath, ensureBinary, platformAsset, readLock, sha256File } from "../scripts/lib/vaultbase.ts";

const dir = mkdtempSync(join(tmpdir(), "audition-setup-"));
let realBin: string;
let server: ReturnType<typeof Bun.serve>;
const files = new Map<string, Uint8Array | string>();

beforeAll(async () => {
  realBin = await ensureBinary();
  server = Bun.serve({
    port: 0, hostname: "127.0.0.1",
    fetch(req) {
      const body = files.get(new URL(req.url).pathname);
      return body === undefined ? new Response("not found", { status: 404 }) : new Response(body);
    },
  });
});
afterAll(() => { server?.stop(true); rmSync(dir, { recursive: true, force: true }); });

async function run(script: string, args: string[]) {
  const p = Bun.spawn(["bun", join(ROOT, "scripts", script), ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, out: out + err };
}

async function lockFor(base: string, name: string) {
  const lock = await readLock();
  const path = join(dir, name);
  await Bun.write(path, JSON.stringify({ ...lock, download_base: base }));
  return { lock, path };
}

test("a good download is verified and installed", async () => {
  const bytes = new Uint8Array(await Bun.file(realBin).arrayBuffer());
  files.set(`/good/${platformAsset()}`, bytes);
  const { lock, path } = await lockFor(`http://127.0.0.1:${server.port}/good/`, "good.json");
  const binDir = join(dir, "good-bin");
  const r = await run("fetch-vaultbase.ts", ["--lock", path, "--bin-dir", binDir]);
  expect(r.code, r.out).toBe(0);
  expect(r.out).toContain("Verified");
  expect(await sha256File(binaryPath(lock.version, binDir))).toBe(lock.sha256[platformAsset()]);
}, 120_000);

test("a tampered download is refused and not kept", async () => {
  files.set(`/bad/${platformAsset()}`, "not really vaultbase");
  const { lock, path } = await lockFor(`http://127.0.0.1:${server.port}/bad/`, "bad.json");
  const binDir = join(dir, "bad-bin");
  const r = await run("fetch-vaultbase.ts", ["--lock", path, "--bin-dir", binDir]);
  expect(r.code).toBe(1);
  expect(r.out).toContain("REFUSED");
  expect(r.out).toContain("does not match the pinned checksum");
  expect(existsSync(binaryPath(lock.version, binDir))).toBe(false);
  expect(readdirSync(join(binDir, lock.version))).toEqual([]);
});

test("a tampered binary already on disk is refused, not replaced", async () => {
  const lock = await readLock();
  const binDir = join(dir, "tampered-bin");
  const target = binaryPath(lock.version, binDir);
  mkdirSync(join(binDir, lock.version), { recursive: true });
  copyFileSync(realBin, target);
  appendFileSync(target, "x");
  const r = await run("fetch-vaultbase.ts", ["--bin-dir", binDir]);
  expect(r.code).toBe(1);
  expect(r.out).toContain("REFUSED");
  expect(existsSync(target)).toBe(true);
}, 60_000);

test("vb:bump rewrites the lock file from the release's SHA256SUMS", async () => {
  const sums = [
    `${"a".repeat(64)}  vaultbase-linux-x64`, `${"b".repeat(64)}  vaultbase-linux-x64.xz`,
    `${"c".repeat(64)}  vaultbase-linux-arm64`, `${"d".repeat(64)}  vaultbase-macos-arm64`,
    `${"e".repeat(64)}  vaultbase-macos-x64`, `${"f".repeat(64)}  vaultbase-windows-x64.exe`,
    `${"1".repeat(64)}  vaultbase-linux-x64-musl`,
  ].join("\n");
  files.set("/v9.9.9/SHA256SUMS", sums);
  const out = join(dir, "bumped.json");
  const r = await run("vb-bump.ts", ["9.9.9", "--lock", out, "--base-url", `http://127.0.0.1:${server.port}/v9.9.9`]);
  expect(r.code, r.out).toBe(0);
  const lock = await Bun.file(out).json();
  expect(lock.version).toBe("9.9.9");
  expect(lock.download_base).toBe(`http://127.0.0.1:${server.port}/v9.9.9/`);
  expect(lock.sha256["vaultbase-linux-x64"]).toBe("a".repeat(64));
  expect(lock.sha256["vaultbase-linux-x64.xz"]).toBeUndefined();
  expect(Object.keys(lock.sha256).length).toBe(6);
});

test("vb:bump refuses a version with no checksum for this platform", async () => {
  const others = ["vaultbase-linux-x64", "vaultbase-linux-arm64", "vaultbase-macos-arm64", "vaultbase-macos-x64", "vaultbase-windows-x64.exe"]
    .filter((a) => a !== platformAsset());
  files.set("/v9.9.8/SHA256SUMS", others.map((a) => `${"a".repeat(64)}  ${a}`).join("\n"));
  const out = join(dir, "refused.json");
  const r = await run("vb-bump.ts", ["9.9.8", "--lock", out, "--base-url", `http://127.0.0.1:${server.port}/v9.9.8`]);
  expect(r.code).toBe(1);
  expect(r.out).toContain(`no checksum for ${platformAsset()}`);
  expect(existsSync(out)).toBe(false);
});

test("vb:bump refuses a version with no SHA256SUMS", async () => {
  const out = join(dir, "missing.json");
  const r = await run("vb-bump.ts", ["9.9.7", "--lock", out, "--base-url", `http://127.0.0.1:${server.port}/v9.9.7`]);
  expect(r.code).toBe(1);
  expect(r.out).toContain("no SHA256SUMS");
  expect(existsSync(out)).toBe(false);
});

test("the lock pins 0.40.2 with the published checksums", async () => {
  const lock = await readLock();
  expect(lock.version).toBe("0.40.2");
  expect(lock.sha256["vaultbase-linux-x64"]).toBe("b8181569514a113870bba88a26418f0c2d60ff296a1db5a97e4f413c217af757");
  expect(Object.keys(lock.sha256).length).toBe(6);
});
