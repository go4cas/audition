// Shared by the scripts and the test harness: the pinned binary, starting
// an instance, and talking to it as the admin or the owner.
import { chmodSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const ROOT = resolve(import.meta.dir, "..", "..");
export const STATE_DIR = join(ROOT, ".vaultbase");
export const LOCK_PATH = join(ROOT, "vaultbase.lock.json");
export const SNAPSHOT_PATH = join(ROOT, "schema", "snapshot.json");
export const HOOKS_DIR = join(ROOT, "vb_hooks");
export const UI_DIST = join(ROOT, "ui", "dist");

export interface Lock {
  version: string;
  tag_commit?: string;
  release_url: string;
  download_base: string;
  sha256: Record<string, string>;
}

export async function readLock(path = LOCK_PATH): Promise<Lock> {
  return JSON.parse(await Bun.file(path).text()) as Lock;
}

/** The release asset for this machine. VAULTBASE_ASSET overrides (for example the musl build). */
export function platformAsset(platform = process.platform, arch = process.arch): string {
  if (process.env["VAULTBASE_ASSET"]) return process.env["VAULTBASE_ASSET"];
  if (platform === "linux" && arch === "x64") return "vaultbase-linux-x64";
  if (platform === "linux" && arch === "arm64") return "vaultbase-linux-arm64";
  if (platform === "darwin" && arch === "arm64") return "vaultbase-macos-arm64";
  if (platform === "darwin" && arch === "x64") return "vaultbase-macos-x64";
  if (platform === "win32" && arch === "x64") return "vaultbase-windows-x64.exe";
  throw new Error(`No Vaultbase release asset for ${platform}/${arch}`);
}

export async function sha256File(path: string): Promise<string> {
  const h = new Bun.CryptoHasher("sha256");
  const stream = Bun.file(path).stream();
  for await (const chunk of stream) h.update(chunk);
  return h.digest("hex");
}

export class ChecksumError extends Error {}

export function binaryPath(version: string, binDir = join(STATE_DIR, "bin")): string {
  return join(binDir, version, process.platform === "win32" ? "vaultbase.exe" : "vaultbase");
}

/**
 * Make sure the pinned binary is on disk and matches the lock file. A file
 * already there with the wrong checksum is refused, never replaced silently.
 */
export async function ensureBinary(opts: { lock?: Lock; binDir?: string; log?: (s: string) => void } = {}): Promise<string> {
  const lock = opts.lock ?? (await readLock());
  const log = opts.log ?? (() => {});
  const asset = platformAsset();
  const expected = lock.sha256[asset];
  if (!expected) throw new ChecksumError(`vaultbase.lock.json has no checksum for ${asset}`);
  const target = binaryPath(lock.version, opts.binDir);
  if (existsSync(target)) {
    const got = await sha256File(target);
    if (got !== expected) {
      throw new ChecksumError(`${target} does not match the pinned checksum (expected ${expected}, got ${got}). Refusing to run it. Delete it and run \`bun run setup\` again.`);
    }
    return target;
  }
  mkdirSync(dirname(target), { recursive: true });
  const url = lock.download_base + asset;
  log(`Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status} ${res.statusText} (${url})`);
  const tmp = `${target}.download`;
  await Bun.write(tmp, res);
  const got = await sha256File(tmp);
  if (got !== expected) {
    rmSync(tmp, { force: true });
    throw new ChecksumError(`Downloaded ${asset} does not match the pinned checksum (expected ${expected}, got ${got}). Refused.`);
  }
  chmodSync(tmp, 0o755);
  renameSync(tmp, target);
  log(`Verified ${asset} ${lock.version} (sha256 ${got}, ${statSync(target).size} bytes)`);
  return target;
}

// ── Running an instance ───────────────────────────────────────────────────────

export interface Instance {
  url: string;
  port: number;
  dataDir: string;
  hooksDir: string;
  proc: ReturnType<typeof Bun.spawn>;
  logs: () => string;
  stop: () => Promise<void>;
}

export async function freePort(): Promise<number> {
  const s = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const p = s.port;
  s.stop(true);
  return p;
}

export function vbEnv(dataDir: string, hooksDir: string, port?: number, extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !/^(ANTHROPIC|OPENAI)_/.test(k)) env[k] = v;
  env["VAULTBASE_DATA_DIR"] = dataDir;
  env["VAULTBASE_HOOKS_DIR"] = hooksDir;
  env["AUDITION_UI_DIST"] = env["AUDITION_UI_DIST"] ?? UI_DIST;
  if (port !== undefined) env["VAULTBASE_PORT"] = String(port);
  return { ...env, ...extra };
}

/** `vaultbase setup-admin`: creates (or resets) the admin on a data folder. */
export async function setupAdmin(bin: string, dataDir: string, hooksDir: string, email: string, password: string): Promise<string> {
  const p = Bun.spawn([bin, "setup-admin", "--email", email, "--password", password, "--force"], {
    env: vbEnv(dataDir, hooksDir), stdout: "pipe", stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) throw new Error(`setup-admin failed (${code}): ${out}${err}`);
  return (out + err).trim();
}

export async function startInstance(opts: {
  bin: string; dataDir: string; hooksDir: string; port?: number; snapshot?: string; host?: string;
  logFile?: string; detached?: boolean; env?: Record<string, string>;
}): Promise<Instance> {
  const port = opts.port ?? (await freePort());
  mkdirSync(opts.dataDir, { recursive: true });
  const args = [opts.bin];
  if (opts.snapshot) args.push("--apply-snapshot", opts.snapshot, "--snapshot-mode", "sync");
  const env = vbEnv(opts.dataDir, opts.hooksDir, port, { VAULTBASE_HOST: opts.host ?? "127.0.0.1", ...(opts.env ?? {}) });
  let buf = "";
  const fd = opts.logFile ? openSync(opts.logFile, "a") : null;
  const proc = fd !== null
    ? Bun.spawn(args, { env, stdout: fd, stderr: fd, stdin: "ignore" })
    : Bun.spawn(args, { env, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  if (!opts.logFile) {
    const pump = async (s: ReadableStream<Uint8Array>) => { for await (const c of s) buf += new TextDecoder().decode(c); };
    void pump(proc.stdout as ReadableStream<Uint8Array>);
    void pump(proc.stderr as ReadableStream<Uint8Array>);
  }
  if (opts.detached) proc.unref();
  const url = `http://127.0.0.1:${port}`;
  const logs = () => (opts.logFile ? (existsSync(opts.logFile) ? readFileSync(opts.logFile, "utf8") : "") : buf);
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (proc.exitCode !== null) throw new Error(`Vaultbase exited (${proc.exitCode}) during start:\n${logs()}`);
    try {
      const r = await fetch(`${url}/_/ready`);
      if (r.ok) break;
    } catch { /* not listening yet */ }
    if (Date.now() > deadline) { proc.kill(); throw new Error(`Vaultbase did not become ready:\n${logs()}`); }
    await Bun.sleep(100);
  }
  return {
    url, port, dataDir: opts.dataDir, hooksDir: opts.hooksDir, proc, logs,
    async stop() {
      if (proc.exitCode !== null) return;
      proc.kill("SIGTERM");
      const t = setTimeout(() => proc.kill("SIGKILL"), 10_000);
      await proc.exited;
      clearTimeout(t);
    },
  };
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

export interface Res<T = any> { status: number; body: T; headers: Headers }

export async function call<T = any>(base: string, method: string, path: string, opts: { token?: string; body?: unknown; form?: FormData } = {}): Promise<Res<T>> {
  const headers: Record<string, string> = {};
  if (opts.token) headers["authorization"] = `Bearer ${opts.token}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(opts.body); }
  const r = await fetch(base + path, { method, headers, body });
  const text = await r.text();
  let parsed: unknown = text;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { status: r.status, body: parsed as T, headers: r.headers };
}

export async function adminLogin(base: string, email: string, password: string): Promise<string> {
  const r = await call(base, "POST", "/api/v1/admin/auth/login", { body: { email, password } });
  if (r.status !== 200) throw new Error(`admin login failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data.token as string;
}

export async function ownerLogin(base: string, email: string, password: string): Promise<string> {
  const r = await call(base, "POST", "/api/v1/auth/users/login", { body: { email, password } });
  if (r.status !== 200) throw new Error(`owner login failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data.token as string;
}

/** Settings Audition needs (TECH-SPEC §4). */
export const SETTINGS = {
  "queues.timeout_ms": "900000",
  "auth.mfa.enabled": "true",
};

export async function applySettings(base: string, adminToken: string): Promise<void> {
  const r = await call(base, "PATCH", "/api/v1/admin/settings", { token: adminToken, body: SETTINGS });
  if (r.status !== 200) throw new Error(`settings failed: ${r.status} ${JSON.stringify(r.body)}`);
}

/** Create the owner unless one with this email exists. Sign-up is closed, so the admin does it. */
export async function ensureOwner(base: string, adminToken: string, email: string, password: string, name = "Owner"): Promise<void> {
  const list = await call(base, "GET", `/api/v1/users?filter=${encodeURIComponent(`email = "${email}"`)}`, { token: adminToken });
  if (list.status === 200 && list.body.totalItems > 0) return;
  const r = await call(base, "POST", "/api/v1/auth/users/register", {
    token: adminToken, body: { email, password, passwordConfirm: password, name },
  });
  if (r.status !== 200) throw new Error(`owner create failed: ${r.status} ${JSON.stringify(r.body)}`);
}

/**
 * Fail fast if a provider key is in the environment (TECH-SPEC §13). Only
 * key-like names count (…KEY, …TOKEN, …SECRET): a Claude Code session sets
 * ANTHROPIC_BASE_URL for itself, which holds no key. Vaultbase never sees
 * any ANTHROPIC_* or OPENAI_* variable either way (see vbEnv).
 */
export function refuseProviderKeys(env = process.env): void {
  const bad = Object.keys(env).filter((k) => /^(ANTHROPIC|OPENAI)_.*(KEY|TOKEN|SECRET)/.test(k));
  if (bad.length > 0) throw new Error(`Provider variables are set (${bad.join(", ")}). Audition never reads keys from the environment; unset them.`);
}
