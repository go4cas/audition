// Push alerts on a fresh Vaultbase (docs/PUSH-ALERTS.md): the Phase 2a alerts
// also go through helpers.notify, so they land in the owner's notifications
// inbox and on every push provider turned on in the admin.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { boot, create, fixtures, type Harness } from "./harness.ts";
import { until } from "./t3-helpers.ts";
import { GENERIC_TEMPLATE } from "../seed/reference.ts";
import { alertOwner, type Alert } from "../vb_hooks/lib/arena.ts";

let h: Harness;
let f: Awaited<ReturnType<typeof fixtures>>;

const post = (path: string, body: unknown) => h.api("owner", "POST", `/api/custom${path}`, body);
const run = async (id: string) => (await h.api("owner", "GET", `/api/custom/runs/${id}`)).body.data;
const inbox = async (as: "owner" | "admin" = "owner") => h.api(as, "GET", "/api/v1/notifications?sort=-created_at&perPage=50");

async function startAiRun(): Promise<string> {
  const r = await post("/runs", { role: f.role.id, tasks: [f.task.id], contenders: [f.contender.id], judge: "ai" });
  expect(r.status).toBe(200);
  return r.body.data.run.id;
}

beforeAll(async () => {
  h = await boot();
  expect((await h.api("admin", "PATCH", "/api/v1/admin/settings", { "app.url": "https://audition.test" })).status).toBe(200);
  await create(h, "handoff_templates", GENERIC_TEMPLATE, "admin");
  f = await fixtures(h);
  const judge = await create(h, "contenders", { name: `Mock Judge ${crypto.randomUUID().slice(0, 6)}`, connection: f.mock.id, model: "mock-judge", config: { mock: { behaviour: "judge" } } });
  expect((await h.api("owner", "PATCH", `/api/v1/workspaces/${f.workspace.id}`, { judge_contender: judge.id, default_judge: "ai", min_outputs: 1 })).status).toBe(200);
  expect((await h.api("owner", "PATCH", `/api/v1/roles/${f.role.id}`, { pass_mark: 1 })).status).toBe(200);
}, 120_000);

afterAll(async () => { await h?.cleanup(); });

const ALERT: Alert = { type: "run-finished", subject: "s", body: "b", push: { title: "T", body: "B", page: "/runs/x" } };

describe("alertOwner never throws", () => {
  test("a failing notify or email is logged, not thrown", async () => {
    const logs: string[] = [];
    const out = await alertOwner({
      sql: { queryOne: async () => ({ id: "u1", email: "o@x" }), query: async () => [] } as never,
      email: async () => { throw new Error("smtp down"); },
      notify: async () => { throw new Error("no queue"); },
      log: (...a) => logs.push(a.join(" ")),
    }, ALERT);
    expect(out).toEqual({ email: false, push: false });
    expect(logs.some((l) => l.startsWith("push failed: T: no queue"))).toBe(true);
  });
});

describe("before notifications are turned on", () => {
  test("a run still finishes, and there is no inbox yet", async () => {
    const id = await startAiRun();
    await until(async () => (await run(id)).run.status === "done", "run done", 30_000);
    expect((await inbox()).status).toBe(404);
  }, 60_000);
});

describe("with a push provider turned on in the admin", () => {
  beforeAll(async () => {
    // Turning a provider on makes Vaultbase create its notifications inbox.
    const r = await h.api("admin", "PATCH", "/api/v1/admin/notifications/providers/onesignal", { enabled: true, app_id: "test-app", api_key: "test-key" });
    expect(r.status).toBe(200);
  });

  test("a finished run lands in the owner's inbox with a link, and is queued for push", async () => {
    const id = await startAiRun();
    await until(async () => (await run(id)).run.status === "done", "run done", 30_000);
    const row = await until(async () => ((await inbox()).body.data ?? []).find((n: any) => n.data?.page?.includes(id) || n.data?.page?.startsWith("/leaderboard/")), "inbox row", 20_000);
    expect(row.title).toBe("Researcher run finished");
    expect(row.body).toContain("1 output.");
    expect(row.type).toBe("run-finished");
    expect(row.data.url).toMatch(/^https:\/\/audition\.test\/(runs|leaderboard)\//);
    expect(row.read_at ?? null).toBeFalsy();
  }, 60_000);

  test("a run judged by Me says its outputs are ready, and links to the run", async () => {
    const r = await post("/runs", { role: f.role.id, tasks: [f.task.id], contenders: [f.contender.id], judge: "me" });
    const id = r.body.data.run.id;
    const row = await until(async () => ((await inbox()).body.data ?? []).find((n: any) => n.data?.page === `/runs/${id}`), "inbox row", 30_000);
    expect(row.title).toBe("Researcher outputs are ready to judge");
    expect(row.data.url).toBe(`https://audition.test/runs/${id}`);
  }, 60_000);

  test("the owner can mark an alert read; nobody else sees the inbox", async () => {
    const row = ((await inbox()).body.data ?? [])[0];
    const now = new Date().toISOString();
    expect((await h.api("owner", "PATCH", `/api/v1/notifications/${row.id}`, { read_at: now })).status).toBe(200);
    expect((await h.api("anon", "GET", "/api/v1/notifications")).body.data ?? []).toEqual([]);
  }, 30_000);
});
