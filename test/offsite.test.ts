// The off-server copy of backups in Cloudflare R2 (scripts/offsite.ts,
// docs/RELEASE.md "Off-server copy"), against a local S3-compatible stand-in
// (test/fake-s3.ts). Vaultbase does the copying with its own backups.s3.*
// settings; these tests check that Audition switches it on correctly, that a
// backup lands in the bucket with its uploaded files and is pruned there too,
// and the disaster case: a new server with only the saved keys and the bucket
// gets every record and file back.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HOOKS_DIR, SNAPSHOT_PATH, ROOT, adminLogin, call, ensureBinary, ownerLogin, refuseProviderKeys, setupAdmin, startInstance, type Instance,
} from "../scripts/lib/vaultbase.ts";
import { provision } from "../scripts/provision.ts";
import { checkBucket, offsiteMain, pull, r2Endpoint, restore, targetFromEnv, turnOff, turnOn, type OffsiteTarget } from "../scripts/offsite.ts";
import { startFakeS3, type FakeS3 } from "./fake-s3.ts";

const ADMIN = { email: "admin@offsite.local", password: "Admin-offsite-pass-1!" };
const OWNER = { email: "owner@offsite.local", password: "Owner-offsite-pass-1!" };
const NEW_ADMIN = { email: "admin@offsite.local", password: "New-server-admin-pass-1!" };
const BUCKET = "audition-backups";
const root = mkdtempSync(join(tmpdir(), "audition-offsite-"));
const dataDir = join(root, "data");
let bin: string;
let inst: Instance;
let token: string;
let s3: FakeS3;
let target: OffsiteTarget;

const start = (dir: string) => startInstance({ bin, dataDir: dir, hooksDir: HOOKS_DIR, snapshot: SNAPSHOT_PATH });
const snapshotsIn = (keys: string[]) => keys.filter((k) => /^audition\/vaultbase-[\d-]+\.db$/.test(k));

beforeAll(async () => {
  refuseProviderKeys();
  bin = await ensureBinary();
  s3 = startFakeS3({ accessKeyId: "r2-key-id", buckets: [BUCKET] });
  target = { endpoint: s3.endpoint, bucket: BUCKET, accessKeyId: "r2-key-id", secretAccessKey: "r2-secret", prefix: "audition/" };
  await setupAdmin(bin, dataDir, HOOKS_DIR, ADMIN.email, ADMIN.password);
  inst = await start(dataDir);
  token = (await provision({ url: inst.url, admin: ADMIN, owner: OWNER })).token;
}, 60_000);

afterAll(async () => {
  await inst?.stop();
  s3?.stop();
  rmSync(root, { recursive: true, force: true });
});

describe("what the owner pastes", () => {
  test("the account ID or the bucket's S3 API URL becomes the endpoint", () => {
    const id = "0123456789abcdef0123456789abcdef";
    expect(r2Endpoint(id)).toBe(`https://${id}.r2.cloudflarestorage.com`);
    expect(r2Endpoint(`https://${id}.r2.cloudflarestorage.com/audition-backups`)).toBe(`https://${id}.r2.cloudflarestorage.com`);
    expect(r2Endpoint(`https://${id}.eu.r2.cloudflarestorage.com`)).toBe(`https://${id}.eu.r2.cloudflarestorage.com`);
    expect(() => r2Endpoint("not an id")).toThrow("Account ID");
    expect(() => r2Endpoint(`http://${id}.r2.cloudflarestorage.com`)).toThrow("https://");
  });

  test("the environment gives the target, with a default prefix", () => {
    const t = targetFromEnv({ R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef", R2_BUCKET: "audition-backups", R2_ACCESS_KEY_ID: "a", R2_SECRET_ACCESS_KEY: "b" });
    expect(t.prefix).toBe("audition/");
    expect(targetFromEnv({ R2_ENDPOINT: "https://x.r2.cloudflarestorage.com", R2_BUCKET: "abc", R2_ACCESS_KEY_ID: "a", R2_SECRET_ACCESS_KEY: "b", R2_PREFIX: "/prod" }).prefix).toBe("prod/");
    expect(() => targetFromEnv({ R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef", R2_BUCKET: "Bad_Name", R2_ACCESS_KEY_ID: "a", R2_SECRET_ACCESS_KEY: "b" })).toThrow("bucket name");
    expect(() => targetFromEnv({ R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef", R2_BUCKET: "abc" })).toThrow("R2_ACCESS_KEY_ID is missing");
  });
});

test("wrong keys or a wrong bucket stop before anything is saved, in plain words", async () => {
  await expect(checkBucket({ ...target, accessKeyId: "wrong" })).rejects.toThrow("R2 refused the keys");
  await expect(checkBucket({ ...target, bucket: "no-such-bucket" })).rejects.toThrow('no bucket named "no-such-bucket"');
  await expect(turnOn(inst.url, token, { ...target, accessKeyId: "wrong" })).rejects.toThrow("R2 refused the keys");
  const settings = (await call(inst.url, "GET", "/api/v1/admin/settings", { token })).body.data;
  expect(settings["backups.s3.enabled"] ?? "0").toBe("0");
  expect(s3.keys(BUCKET)).toEqual([]);
});

test("turning it on saves Vaultbase's S3 settings, and the first backup reaches the bucket with its files", async () => {
  const r = await turnOn(inst.url, token, target);
  expect(r.backup).toMatch(/^vaultbase-\d{8}-\d{6}-\d{3}\.db$/);
  expect(r.files).toBeGreaterThan(0); // the seed's mock images
  expect(r.inBucket).toBe(1);
  expect(r.keep).toBe(14);
  const keys = s3.keys(BUCKET);
  expect(keys).toContain(`audition/${r.backup}`);
  expect(keys).toContain(`audition/${r.backup.replace(/\.db$/, ".files.json")}`);
  expect(keys.filter((k) => k.startsWith("audition/files/")).length).toBe(r.files);
  expect(keys).not.toContain("audition/.audition-check");
  // Vaultbase stores the secret encrypted and only ever shows it masked.
  const settings = (await call(inst.url, "GET", "/api/v1/admin/settings", { token })).body.data;
  expect(settings["backups.s3.enabled"]).toBe("1");
  expect(settings["backups.s3.endpoint"]).toBe(s3.endpoint);
  expect(settings["backups.s3.secret_access_key"]).toBe("********");
  const status = (await call(inst.url, "GET", "/api/v1/admin/backups", { token })).body.data.status;
  expect(status).toMatchObject({ enabled: true, s3: true, last_error: null });
}, 60_000);

test("every later backup is copied too, and the bucket keeps the same number as the server", async () => {
  const keep = await call(inst.url, "PATCH", "/api/v1/admin/settings", { token, body: { "backups.keep": "2" } });
  expect(keep.status).toBe(200);
  for (let i = 0; i < 2; i++) expect((await call(inst.url, "POST", "/api/v1/admin/backups", { token })).status).toBe(200);
  const local = (await call(inst.url, "GET", "/api/v1/admin/backups", { token })).body.data.items.map((b: { name: string }) => b.name);
  expect(local.length).toBe(2);
  expect(snapshotsIn(s3.keys(BUCKET)).map((k) => k.slice("audition/".length)).sort()).toEqual([...local].sort());
  await call(inst.url, "PATCH", "/api/v1/admin/settings", { token, body: { "backups.keep": "14" } });
}, 60_000);

test("a new server with only the saved keys and the bucket gets every record and file back", async () => {
  // A change that only the newest backup holds.
  const ws = (await call(inst.url, "GET", "/api/v1/workspaces?perPage=50&sort=name", { token })).body.data[0];
  expect((await call(inst.url, "PATCH", `/api/v1/workspaces/${ws.id}`, { token, body: { name: "Kept off the server" } })).status).toBe(200);
  const last = await call(inst.url, "POST", "/api/v1/admin/backups", { token });
  expect(last.status).toBe(200);
  const fileCount = last.body.data.files.count as number;

  // The old server is gone. The new one is a fresh install (its own admin,
  // keys and seed), as `install.sh` leaves it.
  await inst.stop();
  const newData = join(root, "new-server");
  await setupAdmin(bin, newData, HOOKS_DIR, NEW_ADMIN.email, NEW_ADMIN.password);
  let fresh = await start(newData);
  await provision({ url: fresh.url, admin: NEW_ADMIN, owner: { email: "someone@new.local", password: "Someone-new-pass-1!" } });
  await fresh.stop();
  // install.sh restore-offsite: the saved keys go in while it's stopped...
  for (const f of [".encryption-key", ".secret"]) copyFileSync(join(dataDir, f), join(newData, f));
  fresh = await start(newData);
  try {
    // ...then the bucket's backups are pulled in, the newest restored, and
    // the admin reset to the new server's credentials file.
    const p = await pull(target, join(newData, "backups"));
    expect(p.snapshots[0]).toBe(last.body.data.name);
    expect(p.downloaded).toBeGreaterThan(fileCount);
    const again = await pull(target, join(newData, "backups"));
    expect(again.downloaded).toBe(0);
    const listed = (await call(fresh.url, "GET", "/api/v1/admin/backups", { token: await adminLogin(fresh.url, NEW_ADMIN.email, NEW_ADMIN.password) })).body.data.items;
    expect(listed[0].name).toBe(last.body.data.name);
    expect(listed[0].files.count).toBe(fileCount);

    const t = await adminLogin(fresh.url, NEW_ADMIN.email, NEW_ADMIN.password);
    const msg = await restore(fresh.url, t, p.snapshots[0]!);
    expect(msg).toMatch(/Restore complete|Restore of .* sent/);
    // The data folder's install record follows the restored database as the
    // restore's last step; when Vaultbase closed the connection early (RL1)
    // that can still be under way, and setup-admin refuses until it's done.
    // install.sh retries the same way.
    for (let i = 0; ; i++) {
      try { await setupAdmin(bin, newData, HOOKS_DIR, NEW_ADMIN.email, NEW_ADMIN.password); break; } catch (e) {
        if (i >= 30 || !String(e).includes("another install")) throw e;
        await Bun.sleep(500);
      }
    }
    // It starts again on the restored database.
    await fresh.stop();
    fresh = await start(newData);

    const t2 = await adminLogin(fresh.url, NEW_ADMIN.email, NEW_ADMIN.password);
    const back = await call(fresh.url, "GET", `/api/v1/workspaces/${ws.id}`, { token: t2 });
    expect(back.body.data.name).toBe("Kept off the server");
    expect(await ownerLogin(fresh.url, OWNER.email, OWNER.password)).toBeTruthy();
    // The uploaded files are back in the upload folder.
    const uploads = join(newData, "uploads");
    expect(existsSync(uploads)).toBe(true);
    const count = (dir: string): number => readdirSync(dir, { withFileTypes: true })
      .filter((e) => !e.name.startsWith("."))
      .reduce((n, e) => n + (e.isDirectory() ? count(join(dir, e.name)) : 1), 0);
    expect(count(uploads)).toBeGreaterThanOrEqual(fileCount);
    // The copy's settings came back with the backup and still decrypt, so the
    // new server keeps copying to the bucket.
    const before = snapshotsIn(s3.keys(BUCKET)).length;
    const b = await call(fresh.url, "POST", "/api/v1/admin/backups", { token: t2 });
    expect(b.status).toBe(200);
    expect(s3.keys(BUCKET)).toContain(`audition/${b.body.data.name}`);
    expect(snapshotsIn(s3.keys(BUCKET)).length).toBe(before + 1);

    await turnOff(fresh.url, t2);
    const off = await call(fresh.url, "POST", "/api/v1/admin/backups", { token: t2 });
    expect(s3.keys(BUCKET)).not.toContain(`audition/${off.body.data.name}`);
  } finally {
    await fresh.stop();
  }
}, 120_000);

test("the setup tool's offsite command explains bad input and refuses unknown names", async () => {
  const quiet = { log: console.log, error: console.error };
  const lines: string[] = [];
  console.log = console.error = (s: string) => { lines.push(s); };
  try {
    expect(await offsiteMain([])).toBe(2);
    expect(await offsiteMain(["pull", join(root, "x")], { R2_BUCKET: "abc" })).toBe(1);
    expect(await offsiteMain(["restore", "../../etc/passwd"], { AUDITION_ADMIN_EMAIL: "a", AUDITION_ADMIN_PASSWORD: "b", AUDITION_URL: "http://127.0.0.1:9" })).toBe(1);
  } finally {
    console.log = quiet.log; console.error = quiet.error;
  }
  expect(lines.join("\n")).toContain("usage: audition-setup offsite");
  expect(lines.join("\n")).toContain("R2_ACCOUNT_ID is missing");
  expect(lines.join("\n")).toContain(`"../../etc/passwd" isn't a backup name`);
  // The compiled tool and `bun scripts/provision.ts` take the same command.
  const p = Bun.spawn(["bun", "scripts/provision.ts", "offsite"], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  expect(await p.exited).toBe(2);
});
