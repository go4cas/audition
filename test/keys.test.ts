// Provider keys are write-only to the owner (TECH-SPEC F2): api_key is never
// returned by create, update, list, view, expand or batch, and has_key follows.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { boot, create, type Harness } from "./harness.ts";

let h: Harness;
const SECRET = "sk-test-not-a-real-key-123456";
let conn: Record<string, any>;
const seen: string[] = [];
const record = (r: { body: unknown }) => { seen.push(JSON.stringify(r.body)); return r; };

beforeAll(async () => {
  h = await boot();
  conn = await create(h, "connections", { name: "Keyed", provider: "anthropic" });
});
afterAll(async () => { await h?.cleanup(); });

test("creating a key returns no key, and has_key turns on", async () => {
  expect(conn.has_key).toBe(false);
  const r = record(await h.api("owner", "POST", "/api/v1/connection_keys", { connection: conn.id, api_key: SECRET }));
  expect(r.status).toBe(200);
  expect(r.body.data).toBeNull();
  await Bun.sleep(300); // after-hooks run after the response
  expect((await h.api("owner", "GET", `/api/v1/connections/${conn.id}`)).body.data.has_key).toBe(true);
});

test("the stored value is encrypted at rest", async () => {
  const rows = await h.sql<{ api_key: string }>("SELECT api_key FROM vb_connection_keys");
  expect(rows.length).toBe(1);
  expect(rows[0]!.api_key).not.toContain(SECRET);
  expect(rows[0]!.api_key.length).toBeGreaterThan(SECRET.length);
});

test("list, view, expand and batch never return api_key to the owner", async () => {
  const keyId = (await h.api("admin", "GET", "/api/v1/connection_keys")).body.data[0].id;
  record(await h.api("owner", "GET", "/api/v1/connection_keys"));
  record(await h.api("owner", "GET", `/api/v1/connection_keys/${keyId}`));
  record(await h.api("owner", "GET", `/api/v1/connection_keys?filter=${encodeURIComponent(`api_key = "${SECRET}"`)}`));
  record(await h.api("owner", "GET", `/api/v1/connections/${conn.id}?expand=connection_keys_via_connection`));
  record(await h.api("owner", "GET", `/api/v1/connections?expand=connection_keys_via_connection`));
  record(await h.api("owner", "POST", "/api/v1/batch", { requests: [
    { method: "GET", url: "/api/v1/connection_keys" },
    { method: "GET", url: `/api/v1/connection_keys/${keyId}` },
    { method: "GET", url: `/api/v1/connections?expand=connection_keys_via_connection` },
  ] }));
  for (const body of seen) expect(body).not.toContain(SECRET);
  // a filter on the key can't be used to guess it either
  const probe = await h.api("owner", "GET", `/api/v1/connection_keys?filter=${encodeURIComponent(`api_key = "${SECRET}"`)}`);
  expect(probe.status === 200 ? probe.body.data.length : 0).toBe(0);
});

test("updating the key returns no key", async () => {
  const keyId = (await h.api("admin", "GET", "/api/v1/connection_keys")).body.data[0].id;
  const r = record(await h.api("owner", "PATCH", `/api/v1/connection_keys/${keyId}`, { api_key: "sk-test-other-654321" }));
  expect(r.status).toBe(200);
  expect(JSON.stringify(r.body)).not.toContain("sk-test-other-654321");
  expect(JSON.stringify(r.body)).not.toContain(SECRET);
});

test("only server code reads the key (the admin, as a stand-in, gets it decrypted)", async () => {
  const r = await h.api("admin", "GET", "/api/v1/connection_keys");
  expect(r.body.data[0].api_key).toBe("sk-test-other-654321");
});

test("the owner can't set has_key by hand", async () => {
  const r = await h.api("owner", "PATCH", `/api/v1/connections/${conn.id}`, { has_key: false });
  expect(r.status).toBe(422);
});

test("deleting the key turns has_key off", async () => {
  const keyId = (await h.api("admin", "GET", "/api/v1/connection_keys")).body.data[0].id;
  const r = await h.api("owner", "DELETE", `/api/v1/connection_keys/${keyId}`);
  expect(r.status).toBeOneOf([200, 204]);
  await Bun.sleep(300);
  expect((await h.api("owner", "GET", `/api/v1/connections/${conn.id}`)).body.data.has_key).toBe(false);
});

test("one key per connection", async () => {
  expect((await h.api("owner", "POST", "/api/v1/connection_keys", { connection: conn.id, api_key: "a" })).status).toBe(200);
  expect((await h.api("owner", "POST", "/api/v1/connection_keys", { connection: conn.id, api_key: "b" })).status).not.toBe(200);
});
