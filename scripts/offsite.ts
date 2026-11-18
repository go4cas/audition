// The off-server copy of Audition's backups, in Cloudflare R2 (docs/RELEASE.md
// "Off-server copy"). Vaultbase does the copying itself: with its
// `backups.s3.*` settings on, every scheduled or on-demand backup is also
// uploaded to the bucket, with the uploaded files, and the bucket is pruned to
// the same `backups.keep`. This module only switches that on (after checking
// the bucket and keys work), and, for a new server, pulls the bucket's copy
// back into the backups folder so the admin can restore it like a local backup.
//
// deploy/install.sh runs it through the compiled setup tool:
//   audition-setup offsite on        check the bucket, save the settings, take a backup now
//   audition-setup offsite off       stop copying (what's in the bucket stays)
//   audition-setup offsite pull DIR  download the bucket's backups into DIR
//   audition-setup offsite restore NAME   restore that backup (admin API)
// Settings come from the environment: R2_ACCOUNT_ID (or a full S3 API URL),
// R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PREFIX (default
// "audition/"), plus AUDITION_URL and AUDITION_ADMIN_EMAIL/PASSWORD for on,
// off and restore.
import { existsSync, mkdirSync, renameSync, statSync, utimesSync } from "node:fs";
import { dirname, join } from "node:path";
import { call } from "./lib/vaultbase.ts";

export interface OffsiteTarget {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix: string;
}

export const DEFAULT_PREFIX = "audition/";
const CHECK_KEY = ".audition-check";
const SNAPSHOT_RE = /^vaultbase-\d{8}-\d{6}-\d{3}\.(db|dump)$/;
const MANIFEST_RE = /^vaultbase-\d{8}-\d{6}-\d{3}\.files\.json$/;
const BLOB_RE = /^files\/([0-9a-f]{2})\/(\1[0-9a-f]{62})$/;

/**
 * The bucket's S3 endpoint from what the owner pastes: the account ID, or the
 * "S3 API" URL Cloudflare shows on the bucket's page (with or without the
 * bucket name on the end, and the EU form `<id>.eu.r2...`).
 */
export function r2Endpoint(accountOrUrl: string): string {
  const v = accountOrUrl.trim();
  if (/^[0-9a-f]{32}$/i.test(v)) return `https://${v.toLowerCase()}.r2.cloudflarestorage.com`;
  let u: URL;
  try { u = new URL(v); } catch { throw new Error("R2 account ID: paste the 32-character Account ID, or the bucket's S3 API URL"); }
  if (u.protocol !== "https:" && u.hostname !== "127.0.0.1") throw new Error("R2 S3 API URL must start with https://");
  return `${u.protocol}//${u.host}`;
}

export function targetFromEnv(env: Record<string, string | undefined> = process.env): OffsiteTarget {
  const need = (k: string) => {
    const v = env[k]?.trim();
    if (!v) throw new Error(`${k} is missing`);
    return v;
  };
  const account = env["R2_ENDPOINT"]?.trim() || need("R2_ACCOUNT_ID");
  const bucket = need("R2_BUCKET");
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error(`"${bucket}" isn't an R2 bucket name (lowercase letters, digits and dashes)`);
  let prefix = (env["R2_PREFIX"]?.trim() || DEFAULT_PREFIX).replace(/^\/+/, "");
  if (!prefix.endsWith("/")) prefix += "/";
  return { endpoint: r2Endpoint(account), bucket, accessKeyId: need("R2_ACCESS_KEY_ID"), secretAccessKey: need("R2_SECRET_ACCESS_KEY"), prefix };
}

function client(t: OffsiteTarget): Bun.S3Client {
  return new Bun.S3Client({ endpoint: t.endpoint, bucket: t.bucket, accessKeyId: t.accessKeyId, secretAccessKey: t.secretAccessKey, region: "auto" });
}

/** A plain-words reason for an R2 failure. */
export function explain(e: unknown, t: OffsiteTarget): string {
  const code = (e as { code?: string })?.code ?? "";
  if (code === "NoSuchBucket") return `R2 has no bucket named "${t.bucket}" in that account. Check the name and the account ID.`;
  if (["InvalidAccessKeyId", "SignatureDoesNotMatch", "AccessDenied", "Unauthorized"].includes(code)) {
    return `R2 refused the keys (${code}). Check the Access Key ID and Secret, and that the token has "Object Read & Write" on "${t.bucket}".`;
  }
  const msg = e instanceof Error ? e.message : String(e);
  return `couldn't reach R2 at ${t.endpoint}: ${code ? `${code} ` : ""}${msg}`;
}

async function listObjects(c: Bun.S3Client, prefix: string): Promise<{ key: string; size: number }[]> {
  const out: { key: string; size: number }[] = [];
  let token: string | undefined;
  do {
    const page = await c.list({ prefix, ...(token ? { continuationToken: token } : {}) });
    for (const o of page.contents ?? []) out.push({ key: o.key, size: o.size ?? 0 });
    token = page.isTruncated ? page.nextContinuationToken : undefined;
  } while (token);
  return out;
}

/** Write, read back and delete a small file, so wrong keys fail here with a clear message instead of in tonight's backup. */
export async function checkBucket(t: OffsiteTarget): Promise<void> {
  const c = client(t);
  const key = `${t.prefix}${CHECK_KEY}`;
  const stamp = `audition ${new Date().toISOString()}`;
  try {
    await c.write(key, stamp);
    if ((await c.file(key).text()) !== stamp) throw new Error("the test file read back different");
    await c.delete(key);
  } catch (e) {
    throw new Error(explain(e, t));
  }
}

async function admin(url: string, email: string, password: string): Promise<string> {
  const r = await call(url, "POST", "/api/v1/admin/auth/login", { body: { email, password } });
  if (r.status !== 200) throw new Error(`Vaultbase admin sign-in failed (${r.status})`);
  return r.body.data.token as string;
}

export interface OnResult { backup: string; files: number; inBucket: number; keep: number }

/**
 * Turn the copy on: check the bucket, save Vaultbase's `backups.s3.*`
 * settings (the secret is stored encrypted and shown masked), take a backup
 * now, and confirm it reached the bucket.
 */
export async function turnOn(url: string, token: string, t: OffsiteTarget): Promise<OnResult> {
  await checkBucket(t);
  const s = await call(url, "PATCH", "/api/v1/admin/settings", {
    token,
    body: {
      "backups.s3.enabled": "1",
      "backups.s3.endpoint": t.endpoint,
      "backups.s3.bucket": t.bucket,
      "backups.s3.region": "auto",
      "backups.s3.access_key_id": t.accessKeyId,
      "backups.s3.secret_access_key": t.secretAccessKey,
      "backups.s3.prefix": t.prefix,
    },
  });
  if (s.status !== 200) throw new Error(`saving the settings failed: ${s.status} ${JSON.stringify(s.body)}`);
  const b = await call(url, "POST", "/api/v1/admin/backups", { token });
  if (b.status !== 200) throw new Error(`the first backup failed: ${b.body?.error ?? b.status}`);
  const name = b.body.data.name as string;
  const keys = (await listObjects(client(t), t.prefix).catch((e) => { throw new Error(explain(e, t)); })).map((o) => o.key);
  if (!keys.includes(`${t.prefix}${name}`)) throw new Error(`backup ${name} was taken but isn't in the bucket`);
  const status = (await call(url, "GET", "/api/v1/admin/backups", { token })).body?.data?.status;
  return {
    backup: name,
    files: b.body.data.files?.count ?? 0,
    inBucket: keys.filter((k) => SNAPSHOT_RE.test(k.slice(t.prefix.length))).length,
    keep: status?.keep ?? 0,
  };
}

export async function turnOff(url: string, token: string): Promise<void> {
  const r = await call(url, "PATCH", "/api/v1/admin/settings", { token, body: { "backups.s3.enabled": "0" } });
  if (r.status !== 200) throw new Error(`turning the copy off failed: ${r.status}`);
}

/** When a backup was taken, from its name (vaultbase-YYYYMMDD-HHMMSS-mmm.db). */
function stampOf(name: string): Date {
  const m = /^vaultbase-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(\d{3})/.exec(name)!;
  return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!, +m[7]!));
}

export interface PullResult { snapshots: string[]; downloaded: number; kept: number }

/**
 * Download the bucket's backups into `dir` (a server's backups folder), in
 * Vaultbase's own layout: snapshots, their file manifests, and `files/`.
 * Only those names are written, so nothing in the bucket can write outside
 * `dir`. Files already there with the same size are left alone, so a pull
 * that stopped can run again. Newest snapshot first in the result.
 */
export async function pull(t: OffsiteTarget, dir: string): Promise<PullResult> {
  const c = client(t);
  let objects: { key: string; size: number }[];
  try { objects = await listObjects(c, t.prefix); } catch (e) { throw new Error(explain(e, t)); }
  let downloaded = 0, kept = 0;
  const snapshots: string[] = [];
  for (const { key, size } of objects) {
    const rel = key.slice(t.prefix.length);
    const isSnap = SNAPSHOT_RE.test(rel);
    if (!isSnap && !MANIFEST_RE.test(rel) && !BLOB_RE.test(rel)) continue;
    const dest = join(dir, rel);
    if (existsSync(dest) && statSync(dest).size === size) kept++;
    else {
      mkdirSync(dirname(dest), { recursive: true });
      const tmp = `${dest}.part`;
      try { await Bun.write(tmp, await c.file(key).arrayBuffer()); } catch (e) { throw new Error(explain(e, t)); }
      renameSync(tmp, dest);
      downloaded++;
    }
    if (isSnap) {
      // Vaultbase lists a backup's date from the file's time.
      const at = stampOf(rel);
      utimesSync(dest, at, at);
      snapshots.push(rel);
    }
  }
  return { snapshots: snapshots.sort().reverse(), downloaded, kept };
}

export async function restore(url: string, token: string, name: string): Promise<string> {
  if (!SNAPSHOT_RE.test(name)) throw new Error(`"${name}" isn't a backup name`);
  // NOTES RL1: Vaultbase sometimes closes the connection before it answers a
  // restore (its workers restart on the shared port), although the restore
  // completes. Wait for it to be ready again and say so.
  const r = await call(url, "POST", `/api/v1/admin/backups/${name}/restore`, { token }).catch(async (e: Error) => {
    if (!/ECONNRESET|socket connection was closed/.test(e.message)) throw e;
    for (let i = 0; i < 100; i++) {
      if (await fetch(`${url}/_/ready`).then((x) => x.ok, () => false)) break;
      await Bun.sleep(200);
    }
    return null;
  });
  if (r === null) return `Restore of ${name} sent; Vaultbase closed the connection before answering, which it sometimes does while it completes a restore (NOTES RL1). Check the app.`;
  if (r.status !== 200) throw new Error(`restore failed: ${r.body?.error ?? r.status}`);
  return r.body.data.message as string;
}

/** The `offsite` command of the setup tool. Returns the exit code. */
export async function offsiteMain(args: string[], env: Record<string, string | undefined> = process.env): Promise<number> {
  const [sub, arg] = args;
  const url = (env["AUDITION_URL"] ?? "http://127.0.0.1:8091").replace(/\/$/, "");
  const signIn = () => {
    const e = env["AUDITION_ADMIN_EMAIL"], p = env["AUDITION_ADMIN_PASSWORD"];
    if (!e || !p) throw new Error("AUDITION_ADMIN_EMAIL and AUDITION_ADMIN_PASSWORD are missing");
    return admin(url, e, p);
  };
  try {
    if (sub === "on") {
      const t = targetFromEnv(env);
      const r = await turnOn(url, await signIn(), t);
      console.log(`Bucket ${t.bucket} works (wrote, read back and deleted a test file).`);
      console.log(`Backup ${r.backup} taken now and copied to r2://${t.bucket}/${t.prefix}, with ${r.files} uploaded files.`);
      console.log(`The bucket holds ${r.inBucket} backup(s); Vaultbase keeps the newest ${r.keep} there, the same as on the server.`);
      return 0;
    }
    if (sub === "off") {
      await turnOff(url, await signIn());
      console.log("Off-server copy is off. Backups stay on the server; what's in the bucket stays there.");
      return 0;
    }
    if (sub === "pull" && arg) {
      const t = targetFromEnv(env);
      const r = await pull(t, arg);
      if (r.snapshots.length === 0) throw new Error(`no backups in r2://${t.bucket}/${t.prefix}`);
      console.log(`${r.snapshots.length} backup(s) in the bucket; ${r.downloaded} file(s) downloaded, ${r.kept} already here.`);
      console.log(`newest: ${r.snapshots[0]}`);
      return 0;
    }
    if (sub === "restore" && arg) {
      if (!SNAPSHOT_RE.test(arg)) throw new Error(`"${arg}" isn't a backup name`);
      console.log(await restore(url, await signIn(), arg));
      return 0;
    }
    console.error("usage: audition-setup offsite on | off | pull DIR | restore NAME");
    return 2;
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
}
