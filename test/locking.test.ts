// Used records are read-only (SPEC "Three rules"): a locked task or
// contender can't be updated or deleted, and only Audition sets `locked`.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { boot, create, fixtures, type Harness } from "./harness.ts";

let h: Harness;
let f: Awaited<ReturnType<typeof fixtures>>;
beforeAll(async () => { h = await boot(); f = await fixtures(h); });
afterAll(async () => { await h?.cleanup(); });

for (const kind of ["tasks", "contenders"] as const) {
  test(`${kind}: new records start unlocked, even if the owner says otherwise`, async () => {
    const rec = kind === "tasks"
      ? await create(h, "tasks", { role: f.role.id, title: "Locked?", prompt: "<p>x</p>", locked: true })
      : await create(h, "contenders", { name: "Locked contender?", connection: f.mock.id, model: "m", locked: true });
    expect(rec.locked).toBe(false);
  });

  test(`${kind}: the owner can't lock or unlock`, async () => {
    const id = kind === "tasks" ? f.task.id : f.contender.id;
    const r = await h.api("owner", "PATCH", `/api/v1/${kind}/${id}`, { locked: true });
    expect(r.status).toBeOneOf([403, 422]);
    expect((await h.api("owner", "GET", `/api/v1/${kind}/${id}`)).body.data.locked).toBe(false);
  });

  test(`${kind}: a locked record can't be updated or deleted`, async () => {
    const rec = kind === "tasks"
      ? await create(h, "tasks", { role: f.role.id, title: "To lock", prompt: "<p>x</p>" })
      : await create(h, "contenders", { name: "To lock", connection: f.mock.id, model: "m" });
    // unlocked: editable
    expect((await h.api("owner", "PATCH", `/api/v1/${kind}/${rec.id}`, kind === "tasks" ? { title: "Edited" } : { group: "Edited" })).status).toBe(200);
    // a run locks it (server code, as T1's start-run route will)
    await h.store("update", kind, { locked: true }, rec.id);
    const patch = await h.api("owner", "PATCH", `/api/v1/${kind}/${rec.id}`, kind === "tasks" ? { title: "Again" } : { group: "Again" });
    expect(patch.status).toBeOneOf([403, 404, 422]);
    const unlock = await h.api("owner", "PATCH", `/api/v1/${kind}/${rec.id}`, { locked: false });
    expect(unlock.status).toBeOneOf([403, 404, 422]);
    const del = await h.api("owner", "DELETE", `/api/v1/${kind}/${rec.id}`);
    expect(del.status).toBeOneOf([403, 404]);
    const after = (await h.api("owner", "GET", `/api/v1/${kind}/${rec.id}`)).body.data;
    expect(after.locked).toBe(true);
    expect(kind === "tasks" ? after.title : after.group).toBe("Edited");
  });
}

test("Duplicate and edit: a new version points back to the locked one", async () => {
  const old = await create(h, "tasks", { role: f.role.id, title: "v1", prompt: "<p>x</p>" });
  await h.store("update", "tasks", { locked: true }, old.id);
  const v2 = await create(h, "tasks", { role: f.role.id, title: "v2", prompt: "<p>y</p>", previous_version: old.id });
  expect(v2.previous_version).toBe(old.id);
  expect(v2.locked).toBe(false);
});

test("a locked task refuses new attachments through the update rule", async () => {
  const rec = await create(h, "tasks", { role: f.role.id, title: "Attach", prompt: "<p>x</p>" });
  await h.store("update", "tasks", { locked: true }, rec.id);
  const form = new FormData();
  form.append("file", new File(["hello"], "a.txt", { type: "text/plain" }));
  const r = await fetch(`${h.url}/api/v1/files/tasks/${rec.id}/attachments`, { method: "POST", headers: { authorization: `Bearer ${h.ownerToken}` }, body: form });
  expect(r.status).toBeOneOf([403, 404]);
});
