// Boots a fresh Vaultbase for one test file: a temp folder, a free port, the
// pinned binary with --apply-snapshot, the admin, the settings and the owner.
// The hooks folder is a copy of vb_hooks/ plus test/vb_hooks_test/ (test-only
// routes), so test code never ships in vb_hooks/.
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HOOKS_DIR, ROOT, SNAPSHOT_PATH, adminLogin, applySettings, call, ensureBinary, ensureOwner,
  ownerLogin, refuseProviderKeys, setupAdmin, startInstance, type Instance, type Res,
} from "../scripts/lib/vaultbase.ts";

export const ADMIN = { email: "admin@test.local", password: "Admin-test-pass-1!" };
export const OWNER = { email: "owner@test.local", password: "Owner-test-pass-1!" };

export type As = "owner" | "admin" | "anon";

export interface Harness {
  url: string;
  dataDir: string;
  hooksDir: string;
  inst: Instance;
  adminToken: string;
  ownerToken: string;
  api<T = any>(as: As, method: string, path: string, body?: unknown): Promise<Res<T>>;
  /** Server-side write through vb_hooks/lib/store.ts (test route). */
  store(op: "insert" | "update", collection: string, data: Record<string, unknown>, id?: string): Promise<string>;
  /** A SELECT through helpers.sql (test route). */
  sql<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Stop the server; the data folder stays until cleanup(). */
  stop(): Promise<void>;
  cleanup(): Promise<void>;
}

export function makeHooksDir(root: string): string {
  const dir = join(root, "vb_hooks");
  cpSync(HOOKS_DIR, dir, { recursive: true });
  cpSync(join(ROOT, "test", "vb_hooks_test"), dir, { recursive: true });
  return dir;
}

export async function boot(opts: { root?: string; bin?: string; dataDir?: string; hooksDir?: string } = {}): Promise<Harness> {
  refuseProviderKeys();
  const root = opts.root ?? mkdtempSync(join(tmpdir(), "audition-test-"));
  mkdirSync(root, { recursive: true });
  const bin = opts.bin ?? (await ensureBinary());
  const dataDir = opts.dataDir ?? join(root, "data");
  const hooksDir = opts.hooksDir ?? makeHooksDir(root);
  await setupAdmin(bin, dataDir, hooksDir, ADMIN.email, ADMIN.password);
  const inst = await startInstance({ bin, dataDir, hooksDir, snapshot: SNAPSHOT_PATH });
  const adminToken = await adminLogin(inst.url, ADMIN.email, ADMIN.password);
  await applySettings(inst.url, adminToken);
  await ensureOwner(inst.url, adminToken, OWNER.email, OWNER.password, "Test Owner");
  const ownerToken = await ownerLogin(inst.url, OWNER.email, OWNER.password);
  const token = (as: As) => (as === "owner" ? ownerToken : as === "admin" ? adminToken : undefined);
  const h: Harness = {
    url: inst.url, dataDir, hooksDir, inst, adminToken, ownerToken,
    api: (as, method, path, body) => call(inst.url, method, path, { token: token(as), body }),
    async store(op, collection, data, id) {
      const r = await call(inst.url, "POST", "/api/custom/test/store", { token: adminToken, body: { op, collection, data, id } });
      if (r.status !== 200) throw new Error(`store ${op} ${collection}: ${r.status} ${JSON.stringify(r.body)}`);
      return r.body.data.id as string;
    },
    async sql(sql, params) {
      const r = await call(inst.url, "POST", "/api/custom/test/sql", { token: adminToken, body: { sql, params } });
      if (r.status !== 200) throw new Error(`sql: ${r.status} ${JSON.stringify(r.body)}`);
      return r.body.data;
    },
    stop: () => inst.stop(),
    async cleanup() {
      await inst.stop();
      if (!opts.root) rmSync(root, { recursive: true, force: true });
    },
  };
  return h;
}

/** Create a record as the owner (or admin) and return it; throws on any non-200. */
export async function create(h: Harness, collection: string, data: Record<string, unknown>, as: As = "owner"): Promise<Record<string, any>> {
  const r = await h.api(as, "POST", `/api/v1/${collection}`, data);
  if (r.status !== 200 || !r.body?.data) throw new Error(`create ${collection}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data;
}

export const RUBRIC = [
  { name: "Accuracy", weight: 60, guidance: "Facts are right." },
  { name: "Clarity", weight: 40, guidance: "Easy to read." },
];

/** A small graph of records for tests: workspace, group, role, task, connections, contenders. */
export async function fixtures(h: Harness) {
  const workspace = await create(h, "workspaces", { name: `WS ${crypto.randomUUID().slice(0, 8)}` });
  const group = await create(h, "groups", { workspace: workspace.id, name: "Research", order: 1 });
  const role = await create(h, "roles", { workspace: workspace.id, group: group.id, name: "Researcher", rubric: RUBRIC });
  const task = await create(h, "tasks", { role: role.id, title: "Compare options", prompt: "<p>Compare three options.</p>" });
  const mock = await create(h, "connections", { name: `Mock ${crypto.randomUUID().slice(0, 8)}`, provider: "mock" });
  const manual = await create(h, "connections", { name: `Manual ${crypto.randomUUID().slice(0, 8)}`, provider: "manual" });
  const contender = await create(h, "contenders", { name: `Mock Steady ${crypto.randomUUID().slice(0, 8)}`, connection: mock.id, model: "mock-steady", config: { mock: { behaviour: "steady" } } });
  const handoff = await create(h, "contenders", { name: `Codex ${crypto.randomUUID().slice(0, 8)}`, connection: manual.id });
  return { workspace, group, role, task, mock, manual, contender, handoff };
}
