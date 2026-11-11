// The Vaultbase behaviours TECH-SPEC §3 relies on, checked against the
// running pinned binary. docs/NOTES.md quotes these results.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { boot, create, fixtures, type Harness } from "./harness.ts";
import { SETTINGS } from "../scripts/lib/vaultbase.ts";

let h: Harness;
beforeAll(async () => { h = await boot(); });
afterAll(async () => { await h?.cleanup(); });

const probe = (q: string, body?: unknown) => h.api("admin", "POST", `/api/custom/test/probe?q=${q}`, body ?? {});

test("F1 (fixed in 0.43): hook helpers can read (find, query), run SQL, and write through helpers.records", async () => {
  const keys: string[] = (await probe("helpers")).body.data;
  expect(keys).toContain("find");
  expect(keys).toContain("query");
  expect(keys).toContain("sql");
  expect(keys).toContain("records");
});

test("F1 (fixed in 0.43): a store.ts write goes through the records API and shows in record history as system", async () => {
  const f = await fixtures(h);
  await h.api("owner", "PATCH", `/api/v1/tasks/${f.task.id}`, { title: "Via REST" });
  const viaRest = (await h.api("admin", "GET", `/api/v1/tasks/${f.task.id}/history`)).body.data.data;
  await h.store("update", "tasks", { title: "Via store" }, f.task.id);
  const viaStore = (await h.api("admin", "GET", `/api/v1/tasks/${f.task.id}/history`)).body.data.data;
  expect(viaStore.length).toBe(viaRest.length + 1);
  const newest = viaStore.find((e: { snapshot?: { title?: string } }) => e.snapshot?.title === "Via store");
  expect(newest).toBeDefined();
  expect(newest.actor_type).toBeNull();
  expect(newest.actor_id).toBeNull();
  const owner = viaRest.find((e: { snapshot?: { title?: string } }) => e.snapshot?.title === "Via REST");
  expect(owner.actor_type).toBe("user");
});

test("F2: an encrypted field comes back decrypted to whoever may read it", async () => {
  const c = await create(h, "connections", { name: "F2", provider: "mock" });
  await h.api("owner", "POST", "/api/v1/connection_keys", { connection: c.id, api_key: "sk-test-f2" });
  const r = await h.api("admin", "GET", `/api/v1/connection_keys?filter=${encodeURIComponent(`connection = "${c.id}"`)}`);
  expect(r.body.data[0].api_key).toBe("sk-test-f2");
  const raw = await h.sql<{ api_key: string }>(`SELECT api_key FROM vb_connection_keys WHERE connection = ?`, [c.id]);
  expect(raw[0]!.api_key).not.toBe("sk-test-f2");
});

test("F3: the egress guard refuses loopback and private addresses from hook code", async () => {
  for (const url of [`${h.url}/api/health`, "http://10.0.0.1/", "http://169.254.169.254/latest/meta-data/"]) {
    const r = (await probe("egress", { url })).body.data;
    expect(r.ok, url).toBe(false);
  }
});

test("F4: custom routes parse JSON and text bodies, not multipart", async () => {
  expect((await probe("body", { a: 1 })).body.data.body).toEqual({ a: 1 });
  const form = new FormData();
  form.append("file", new File(["x"], "x.txt", { type: "text/plain" }));
  const r = await fetch(`${h.url}/api/custom/test/probe?q=body`, { method: "POST", headers: { authorization: `Bearer ${h.adminToken}` }, body: form });
  expect((await r.json()).data.body).toBeNull();
});

test("F5: the queue time limit is raised to 15 minutes", async () => {
  const s = await h.api("admin", "GET", "/api/v1/admin/settings");
  expect(s.body.data["queues.timeout_ms"]).toBe(SETTINGS["queues.timeout_ms"]);
  expect(s.body.data["auth.mfa.enabled"]).toBe("true");
});

test("F6: helpers.template has {{path}} and {{#if}}, but no loops", async () => {
  const t = (await probe("template")).body.data;
  expect(t.ifTrue).toBe("yes Ada");
  expect(t.path).toBe("r");
  expect(t.loop).not.toBe("[x][y]");
});

test("F7: the hooks folder is loaded at start", () => {
  expect(h.inst.logs()).toContain(`hooks folder ${h.hooksDir}`);
  expect(h.inst.logs()).not.toContain("didn't load");
});
