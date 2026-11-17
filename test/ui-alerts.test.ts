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

// A stand-in for OneSignal's web SDK: records the calls Audition makes.
const FAKE_SDK = `(() => {
  const calls = (window.__os = []);
  // Like OneSignal, the subscription outlives a reload.
  const sub = {
    get optedIn() { return localStorage.getItem("fake.optedIn") === "1"; },
    async optIn() { localStorage.setItem("fake.optedIn", "1"); calls.push("optIn"); },
    async optOut() { localStorage.removeItem("fake.optedIn"); calls.push("optOut"); },
  };
  const OS = {
    async init(o) { calls.push("init:" + o.appId + ":" + o.serviceWorkerPath + ":" + o.serviceWorkerParam.scope); },
    async login(id) { calls.push("login:" + id); },
    async logout() { calls.push("logout"); },
    Notifications: { async requestPermission() { calls.push("permission"); window.__grant(); }, addEventListener() {} },
    User: { PushSubscription: sub },
  };
  const q = window.OneSignalDeferred || [];
  window.OneSignalDeferred = { push: (f) => f(OS) };
  q.forEach((f) => f(OS));
})();`;

test("with OneSignal on, the owner turns alerts on for this device and off again", async () => {
  await h.api("admin", "PATCH", "/api/v1/admin/notifications/providers/onesignal", { enabled: true, app_id: "test-app", api_key: "test-key" });
  const off = await h.api("owner", "GET", "/api/custom/push");
  expect(off.body.data).toEqual({ provider: "onesignal", app_id: "test-app" });

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // Headless Chromium always reports notifications as denied: stand in for the browser's prompt.
  await ctx.addInitScript(() => {
    let perm = "default";
    Object.defineProperty(Notification, "permission", { get: () => perm });
    if (localStorage.getItem("fake.optedIn") === "1") perm = "granted";
    (window as any).__grant = () => { perm = "granted"; };
    Notification.requestPermission = async () => { perm = "granted"; (window as any).__asked = true; return "granted"; };
  });
  await ctx.addInitScript((t) => localStorage.setItem("audition.token", t), h.ownerToken);
  await ctx.route("https://cdn.onesignal.com/**", (r) => r.fulfill({ contentType: "text/javascript", body: FAKE_SDK }));
  const p = await ctx.newPage();
  p.setDefaultTimeout(20_000);
  p.on("pageerror", (e) => errors.push(String(e)));
  const csp: string[] = [];
  p.on("response", (r) => { if (r.url().endsWith(`${APP}/alerts`)) csp.push(r.headers()["content-security-policy"] ?? ""); });
  await p.goto(`${h.url}${APP}/alerts`);
  await p.locator('[data-push-action="on"]').waitFor();
  expect(csp[0]).toContain("script-src 'self' https://cdn.onesignal.com");
  expect(await p.evaluate(() => (window as any).__os)).toBeUndefined(); // no SDK until asked
  if (SHOTS) { await p.waitForTimeout(800); await p.screenshot({ path: join(SHOTS, "alerts-device-1280.png") }); }

  await p.locator('[data-push-action="on"]').click();
  await p.locator('[data-push-action="off"]').waitFor();
  expect(await p.evaluate(() => (window as any).__os)).toEqual(["init:test-app:api/custom/app/OneSignalSDKWorker.js:/api/custom/app/", `login:${owner}`, "optIn"]);
  expect(await p.evaluate(() => (window as any).__asked)).toBe(true); // asked during the tap, before the SDK

  // A later visit from this device starts the SDK again on its own.
  await p.reload();
  await p.locator('[data-push-action="off"]').waitFor();
  await p.locator('[data-push-action="off"]').click();
  await p.locator('[data-push-action="on"]').waitFor();
  expect(await p.evaluate(() => (window as any).__os)).toContain("optOut");
  await ctx.close();

  const w = await fetch(`${h.url}${APP}/OneSignalSDKWorker.js`);
  expect(w.status).toBe(200);
  expect(await w.text()).toContain('importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js")');
  expect(errors).toEqual([]);
}, 60_000);

// Live-site bug (Nov 17 2026): the shell rendered its nav before quiver knew the
// base, so "Contenders" linked to /contenders (404). Every top-bar and phone-nav
// link must carry the app base, and "Waiting for you" opens Home's "Up next".
test("nav links carry the app base, and Waiting for you opens Home at Up next", async () => {
  for (const width of [1280, 375]) {
    const { p, close } = await open("/contenders", width);
    await p.locator("[data-screen=contenders]").waitFor();
    const hrefs = await p.locator(width === 1280 ? ".topbar a" : ".bottom-nav a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    expect(hrefs.length).toBeGreaterThan(2);
    for (const href of hrefs) expect(href!.startsWith(APP + "/")).toBe(true);
    await p.locator("[data-waiting-link]:visible").click();
    await p.waitForURL(/\/api\/custom\/app\/\?waiting=1$/);
    await p.locator("#up-next").waitFor();
    if (width === 1280) {
      await p.locator(".topbar nav").getByText("Contenders").click();
      await p.waitForURL(new RegExp(APP + "/contenders$"));
      await p.locator("[data-screen=contenders]").waitFor();
    }
    await close();
  }
  expect(errors).toEqual([]);
}, 60_000);

test("when OneSignal never answers, the panel stops waiting and says why", async () => {
  await h.api("admin", "PATCH", "/api/v1/admin/notifications/providers/onesignal", { enabled: true, app_id: "test-app", api_key: "test-key" });
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
  await ctx.addInitScript(() => {
    let perm = "default";
    Object.defineProperty(Notification, "permission", { get: () => perm });
    Notification.requestPermission = async () => { perm = "granted"; return "granted"; };
  });
  await ctx.addInitScript((t) => localStorage.setItem("audition.token", t), h.ownerToken);
  // A script that loads but never starts OneSignal, like a site address OneSignal refuses.
  await ctx.route("https://cdn.onesignal.com/**", (r) => r.fulfill({ contentType: "text/javascript", body: "/* silent */" }));
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.goto(`${h.url}${APP}/alerts`);
  await p.locator('[data-push-action="on"]').click();
  await p.locator('[data-push="busy"]').waitFor();
  await p.locator("[data-push-error]").getByText("OneSignal didn't answer").waitFor({ timeout: 30_000 });
  expect(await p.locator('[data-push-action="on"]').isVisible()).toBe(true); // can try again
  if (SHOTS) await p.screenshot({ path: join(SHOTS, "alerts-timeout-375.png") });
  await ctx.close();
  expect(errors).toEqual([]);
}, 60_000);

test("a second try after a failed OneSignal start works (OneSignal refuses a second init)", async () => {
  await h.api("admin", "PATCH", "/api/v1/admin/notifications/providers/onesignal", { enabled: true, app_id: "test-app", api_key: "test-key" });
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
  await ctx.addInitScript(() => {
    let perm = "default";
    Object.defineProperty(Notification, "permission", { get: () => perm });
    Notification.requestPermission = async () => { perm = "granted"; return "granted"; };
  });
  await ctx.addInitScript((t) => localStorage.setItem("audition.token", t), h.ownerToken);
  // Like OneSignal: the first init fails after marking itself started, every later one says so.
  const flaky = FAKE_SDK.replace(
    'async init(o) {',
    'async init(o) { if (window.__initTries = (window.__initTries || 0) + 1, window.__initTries === 1) throw new Error("Can only be used on: https://elsewhere.example"); if (window.__initTries > 1) throw new Error("SDK already initialized");',
  );
  let loads = 0;
  await ctx.route("https://cdn.onesignal.com/**", (r) => { loads++; return r.fulfill({ contentType: "text/javascript", body: flaky }); });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.goto(`${h.url}${APP}/alerts`);
  await p.locator('[data-push-action="on"]').click();
  await p.locator("[data-push-error]").getByText("Can only be used on").waitFor();
  await p.locator('[data-push-action="on"]').click();
  await p.locator('[data-push-action="off"]').waitFor();
  expect(loads).toBe(1); // the script is added once
  await ctx.close();
  expect(errors).toEqual([]);
}, 60_000);
