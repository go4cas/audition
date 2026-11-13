// Push alerts in the app (docs/PUSH-ALERTS.md): the bell in the top bar and
// the Alerts page read Vaultbase's notifications inbox, live over realtime.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { boot, type Harness } from "./harness.ts";
import { ROOT } from "../scripts/lib/vaultbase.ts";
import { seedReference } from "../seed/reference.ts";

const APP = "/api/custom/app";
const SHOTS = process.env.AUDITION_SHOTS; // a folder: save screenshots for the PR
let h: Harness, browser: Browser, owner: string;
const errors: string[] = [];

beforeAll(async () => {
  const b = Bun.spawnSync(["bun", join(ROOT, "scripts", "build-ui.ts")]);
  if (b.exitCode !== 0) throw new Error("UI build failed: " + b.stderr.toString());
  h = await boot();
  await seedReference(h.url, h.adminToken);
  owner = JSON.parse(atob(h.ownerToken.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"))).id;
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await h?.cleanup();
});

async function open(path: string, width = 1280) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  await ctx.addInitScript((t) => localStorage.setItem("audition.token", t), h.ownerToken);
  const p: Page = await ctx.newPage();
  p.setDefaultTimeout(20_000);
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.goto(`${h.url}${APP}${path}`);
  return { p, close: () => ctx.close() };
}

const notify = async (title: string, body: string, page: string) => {
  const r = await h.api("admin", "POST", "/api/v1/admin/notifications/test", { userId: owner, title, body, data: { type: "run-finished", page } });
  expect(r.status).toBe(200);
};

test("before notifications are on, the Alerts page says how to turn them on", async () => {
  const { p, close } = await open("/alerts");
  await p.getByText("Alerts are off.").waitFor();
  expect(await p.locator("[data-alerts-count]").count()).toBe(0);
  if (SHOTS) { await p.waitForTimeout(800); await p.screenshot({ path: join(SHOTS, "alerts-off-1280.png") }); }
  await close();
}, 60_000);

test("a new alert shows on the bell live, opens its page and is marked read", async () => {
  const r = await h.api("admin", "PATCH", "/api/v1/admin/notifications/providers/onesignal", { enabled: true, app_id: "test-app", api_key: "test-key" });
  expect(r.status).toBe(200);
  const { p, close } = await open("/");
  await p.locator("[data-alerts]").waitFor();
  await p.waitForTimeout(1500); // the realtime subscription is up
  await notify("Researcher run finished", "2 outputs, 1 failed.", "/contenders");
  await p.locator("[data-alerts-count]").getByText("1").waitFor();
  await p.locator(".toast").getByText("Researcher run finished").waitFor();
  await notify("Stock analyst outputs are ready to judge", "3 outputs.", "/");
  await p.locator("[data-alerts-count]").getByText("2").waitFor();

  await p.locator("[data-alerts]").click();
  await p.locator("[data-alert-list] .alert-item.is-unread").nth(1).waitFor();
  expect(await p.locator("[data-alert-list] .alert-item").count()).toBe(2);
  if (SHOTS) { await p.waitForTimeout(800); await p.screenshot({ path: join(SHOTS, "alerts-1280.png") }); }

  await p.locator("[data-alert-list]").getByText("Researcher run finished").click();
  await p.waitForURL(/\/contenders$/);
  await p.locator("[data-alerts-count]").getByText("1").waitFor();
  await close();

  const rows = (await h.api("owner", "GET", "/api/v1/notifications?perPage=50")).body.data;
  expect(rows.filter((n: any) => n.read_at).map((n: any) => n.title)).toEqual(["Researcher run finished"]);
}, 60_000);

test("Mark all read clears the bell, on a phone too", async () => {
  const { p, close } = await open("/alerts", 375);
  await p.getByRole("button", { name: "Mark all read" }).waitFor();
  if (SHOTS) { await p.waitForTimeout(800); await p.screenshot({ path: join(SHOTS, "alerts-375.png") }); }
  await p.getByRole("button", { name: "Mark all read" }).click();
  await p.waitForFunction(() => !document.querySelector("[data-alerts-count]"));
  expect(await p.locator(".alert-item.is-unread").count()).toBe(0);
  await close();
  expect(errors).toEqual([]);
}, 60_000);
