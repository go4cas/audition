// lib/files.ts attaches a file from server code that GET /api/v1/files/…
// serves (TECH-SPEC §12, "Mock files"). Also records finding F9: the
// 0.38-0.41.0 upload endpoint refused every multipart body; 0.41.1 fixed it.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { boot, fixtures, type Harness } from "./harness.ts";
import { testImage } from "../vb_hooks/lib/png.ts";
import { storedName } from "../vb_hooks/lib/files.ts";

let h: Harness;
let f: Awaited<ReturnType<typeof fixtures>>;
beforeAll(async () => { h = await boot(); f = await fixtures(h); });
afterAll(async () => { await h?.cleanup(); });

const attach = (collection: string, id: string, field: string, name: string, mime: string, bytes: Uint8Array) =>
  h.api("admin", "POST", "/api/custom/seed/attach", { collection, id, field, name, mime, data: Buffer.from(bytes).toString("base64") });

test("stored names follow the upload handler's extensions", () => {
  expect(storedName("image/png", "abc")).toBe("abc.png");
  expect(storedName("text/plain", "abc")).toBe("abc.txt");
  expect(storedName("application/zip", "abc")).toBe("abc.bin");
});

test("an attached image is listed on the record and served to the owner, byte for byte", async () => {
  const png = testImage(0);
  const r = await attach("tasks", f.task.id, "attachments", "coffee.png", "image/png", png);
  expect(r.status).toBe(200);
  const name = r.body.data.filename as string;
  expect(name).toMatch(/^[0-9a-f-]{36}\.png$/);

  const task = (await h.api("owner", "GET", `/api/v1/tasks/${f.task.id}`)).body.data;
  expect(task.attachments).toEqual([name]);

  const res = await fetch(`${h.url}/api/v1/files/${name}`, { headers: { authorization: `Bearer ${h.ownerToken}` } });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("image/png");
  expect(new Uint8Array(await res.arrayBuffer())).toEqual(png);

  expect((await fetch(`${h.url}/api/v1/files/${name}`)).status).toBeOneOf([401, 403, 404]);
});

test("a second file is appended to a multiple field", async () => {
  const r = await attach("tasks", f.task.id, "attachments", "notes.txt", "text/plain", new TextEncoder().encode("hello"));
  const task = (await h.api("owner", "GET", `/api/v1/tasks/${f.task.id}`)).body.data;
  expect(task.attachments.length).toBe(2);
  expect(task.attachments[1]).toBe(r.body.data.filename);
  const res = await fetch(`${h.url}/api/v1/files/${r.body.data.filename}`, { headers: { authorization: `Bearer ${h.ownerToken}` } });
  expect(await res.text()).toBe("hello");
});

test("files on attempts work too (the image mock's path)", async () => {
  const attempt = await h.store("insert", "attempts", { task: f.task.id, contender: f.contender.id, mode: "api", status: "submitted" });
  const r = await attach("attempts", attempt, "output_files", "mock-image-1.png", "image/png", testImage(1));
  expect(r.status).toBe(200);
  const res = await fetch(`${h.url}/api/v1/files/${r.body.data.filename}`, { headers: { authorization: `Bearer ${h.ownerToken}` } });
  expect(res.status).toBe(200);
});

test("the seed route is admin only", async () => {
  const r = await h.api("owner", "POST", "/api/custom/seed/attach", { collection: "tasks", id: f.task.id, field: "attachments", name: "x.txt", mime: "text/plain", data: "aGk=" });
  expect(r.status).toBe(403);
});

// Vaultbase's own upload stores the file only; as its admin does, the client
// then saves the returned name into the record's field with a PATCH.
test("F9 (fixed in 0.41.1): the owner uploads through Vaultbase's own endpoint, then saves the name on the record", async () => {
  const form = new FormData();
  form.append("file", new File(["hello from the owner"], "owner.txt", { type: "text/plain" }));
  const r = await fetch(`${h.url}/api/v1/files/tasks/${f.task.id}/attachments`, { method: "POST", headers: { authorization: `Bearer ${h.ownerToken}` }, body: form });
  const body = await r.json();
  expect(r.status).toBe(200);
  const up = (Array.isArray(body.data) ? body.data : [body.data])[0];
  expect(up.filename).toMatch(/^[0-9a-f-]{36}\.txt$/);

  const before = (await h.api("owner", "GET", `/api/v1/tasks/${f.task.id}`)).body.data;
  expect(before.attachments).not.toContain(up.filename);
  const saved = await h.api("owner", "PATCH", `/api/v1/tasks/${f.task.id}`, { attachments: [...before.attachments, up.filename] });
  expect(saved.status).toBe(200);
  expect(saved.body.data.attachments).toContain(up.filename);
  const res = await fetch(`${h.url}/api/v1/files/${up.filename}`, { headers: { authorization: `Bearer ${h.ownerToken}` } });
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("hello from the owner");
});
