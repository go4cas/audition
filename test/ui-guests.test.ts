// Guest voters in the browser (TECH-SPEC §10b), against the mock provider: the
// owner makes a link on the run page, a guest with no account opens it in a
// fresh browser and rates blind, the owner switches counting on and sees the
// crowd on the judging screen and the leaderboard, a Compare link with
// images, and a closed link.
//
// Set UI_SCREENS=<folder> (and UI_THEMES=both) to save screenshots, as in
// test/ui-walkthrough.test.ts.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { boot, create, OWNER, type Harness } from "./harness.ts";
import { call, RATE_LIMIT_RULES, ROOT } from "../scripts/lib/vaultbase.ts";
import { seedReference } from "../seed/reference.ts";

const SCREENS = process.env["UI_SCREENS"];
const THEMES: ("light" | "dark" | null)[] = process.env["UI_THEMES"] === "both" ? ["light", "dark"] : [null];
const T = 30_000;
const APP = "";
let h: Harness, browser: Browser, p: Page, guestCtx: BrowserContext, g: Page;
const errors: string[] = [];
const names: string[] = [];

beforeAll(async () => {
  const b = Bun.spawnSync(["bun", join(ROOT, "scripts", "build-ui.ts")]);
  if (b.exitCode !== 0) throw new Error("UI build failed: " + b.stderr.toString());
  h = await boot();
  await h.api("admin", "PATCH", "/api/v1/admin/settings", { "rate_limit.rules": JSON.stringify(RATE_LIMIT_RULES.map((r) => (r.label.includes("guest") ? { ...r, max: 5000 } : r))) });
  await seedReference(h.url, h.adminToken);
  const mock = (await h.api("owner", "GET", `/api/v1/connections?filter=${encodeURIComponent('name = "Mock"')}`)).body.data[0];
  await create(h, "contenders", { name: "Mock Steady B", connection: mock.id, model: "mock-steady", config: { mock: { behaviour: "steady" } } });
  await create(h, "contenders", { name: "Mock Image B", connection: mock.id, model: "mock-image", config: { mock: { behaviour: "image" } } });
  names.push(...(await h.api("owner", "GET", "/api/v1/contenders?perPage=200")).body.data.map((c: { name: string }) => c.name));
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: SCREENS ? 2 : 1 });
  p = await ctx.newPage();
  p.setDefaultTimeout(T);
  p.on("pageerror", (e) => errors.push(`owner ${new URL(p.url()).pathname}: ${e}`));
  // The guest: a separate browser profile that never signed in.
  guestCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: SCREENS ? 2 : 1 });
  g = await guestCtx.newPage();
  g.setDefaultTimeout(T);
  g.on("pageerror", (e) => errors.push(`guest ${new URL(g.url()).pathname}: ${e}`));
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await h?.cleanup();
  expect(errors).toEqual([]);
});

const app = (path = "/") => `${h.url}${APP}${path}`;
async function settle(page = p) {
  await page.waitForSelector("#main section:not(.is-loading)", { state: "attached" });
  await page.waitForFunction(() => !document.querySelector("#main .skeleton"));
}
const go = async (path: string) => { await p.goto(app(path)); await settle(); };
const toastSays = (page: Page, text: string | RegExp) => page.locator("#toaster").getByText(text).first().waitFor();
const list = async (collection: string, filter: string) =>
  (await h.api("owner", "GET", `/api/v1/${collection}?perPage=500&filter=${encodeURIComponent(filter)}`)).body.data as any[];
const one = async (collection: string, filter: string) => (await list(collection, filter))[0];
const waitFor = async (fn: () => Promise<boolean>, what: string, ms = 60_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return; await Bun.sleep(300); }
  throw new Error("Timed out waiting for " + what);
};
const runStatus = async (id: string) => (await h.api("owner", "GET", `/api/v1/runs/${id}`)).body.data.status as string;
/** The guest page never names a contender or model (outside the outputs' own words, as on the owner's judging screen). */
async function blind(page: Page) {
  const text = await page.evaluate(() => {
    const c = document.body.cloneNode(true) as HTMLElement;
    c.querySelectorAll(".output__text").forEach((e) => e.remove());
    return c.innerText;
  });
  for (const n of names) expect(text, n).not.toContain(n);
  expect(text).not.toMatch(/\bmock-(steady|erratic|image)\b/);
}

async function shot(page: Page, name: string) {
  if (!SCREENS) return;
  mkdirSync(SCREENS, { recursive: true });
  await page.evaluate(() => { document.getElementById("toaster")!.style.visibility = "hidden"; });
  for (const theme of THEMES) {
    if (theme) { await page.emulateMedia({ colorScheme: theme }); await page.waitForTimeout(100); }
    for (const w of [1280, 375]) {
      await page.setViewportSize({ width: w, height: 800 });
      await page.waitForTimeout(250);
      const height = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
      await page.setViewportSize({ width: w, height: Math.min(height, 4000) });
      await page.waitForTimeout(150);
      await page.screenshot({ path: join(SCREENS, `${name}${theme ? "-" + theme : ""}-${w}.png`) });
    }
  }
  if (THEMES[0]) await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => { document.getElementById("toaster")!.style.visibility = ""; });
}

async function startRun(role: string, contenders: string[], method: "rate" | "compare") {
  const r = await one("roles", `name = "${role}"`);
  const tasks = (await list("tasks", `role = "${r.id}"`)).map((t) => t.id);
  const cs = [];
  for (const c of contenders) cs.push((await one("contenders", `name = "${c}"`)).id);
  const res = await h.api("owner", "POST", "/api/custom/runs", { role: r.id, tasks, contenders: cs, judge: "me", method });
  if (res.status !== 200) throw new Error(JSON.stringify(res.body));
  const id = res.body.data.run.id as string;
  await waitFor(async () => (await runStatus(id)) === "judging", "outputs to be ready");
  return { id, role: r, tasks };
}

let rateRun: Awaited<ReturnType<typeof startRun>>;
let linkUrl = "";

test("sign in", async () => {
  await p.goto(app("/signin"));
  await p.fill("#si-email", OWNER.email);
  await p.fill("#si-pass", OWNER.password);
  await p.getByRole("button", { name: /Sign in/ }).click();
  await p.waitForURL((u) => !u.pathname.includes("signin"));
  await settle();
}, 60_000);

test("the owner makes a guest link on the run page", async () => {
  rateRun = await startRun("Trip researcher", ["Mock Steady", "Mock Erratic", "Mock Steady B"], "rate");
  await go(`/runs/${rateRun.id}`);
  const panel = p.getByTestId("guest-panel");
  await panel.getByText("Want more opinions?").waitFor();
  await shot(p, "guests-run-empty");
  await p.getByTestId("guest-make").click();
  await toastSays(p, "Guest link ready");
  const input = panel.locator("input[aria-label='Guest link']");
  linkUrl = await input.inputValue();
  expect(linkUrl).toMatch(new RegExp(`${APP}/vote/[0-9a-f]{64}$`));
  await panel.getByText("0 guests of 50").waitFor();
  await shot(p, "guests-run-link");
  const links = await list("guest_links", `run = "${rateRun.id}"`);
  expect(links).toHaveLength(1);
  expect(links[0]).toMatchObject({ active: true, counts: false });
}, 120_000);

test("a guest with no account rates every answer, blind", async () => {
  await g.goto(linkUrl);
  await settle(g);
  await g.getByText("Help pick the best answer").waitFor();
  // No app chrome, no sign-in.
  expect(await g.locator(".topbar").isVisible()).toBe(false);
  expect(g.url()).not.toContain("signin");
  await blind(g);
  const outs = g.locator("[data-output]");
  const n = await outs.count();
  expect(n).toBe(rateRun.tasks.length * 3);
  await shot(g, "guests-vote-rate");
  for (let i = 0; i < n; i++) {
    const stars = 1 + ((i * 2) % 5);
    await outs.nth(i).locator(`label[for$="-${stars}"]`).click();
    await toastSays(g, /Saved:/);
  }
  await g.getByTestId("vote-thanks").waitFor();
  await blind(g);
  await shot(g, "guests-vote-done");
  const votes = await h.sql("SELECT stars FROM vb_guest_votes WHERE run = ?", [rateRun.id]);
  expect(votes).toHaveLength(n);
  // Back again later: the votes are still there.
  await g.reload();
  await settle(g);
  await g.getByTestId("vote-thanks").waitFor();
}, 120_000);

test("the owner counts the guests, and sees them on the judging screen and the leaderboard", async () => {
  // Two more guests vote on every answer, so each has 3 guest votes.
  const token = linkUrl.split("/vote/")[1]!;
  const b = (await (async () => { const s = await call(h.url, "POST", "/api/v1/auth/guests/anonymous", {}); return call(h.url, "GET", `/api/custom/guest/${token}`, { token: s.body.data.token }); })()).body.data;
  for (let k = 0; k < 2; k++) {
    const s = await call(h.url, "POST", "/api/v1/auth/guests/anonymous", {});
    for (const t of b.tasks) for (const o of t.outputs) {
      const r = await call(h.url, "POST", `/api/custom/guest/${token}/votes`, { token: s.body.data.token, body: { task: t.id, label: o.label, stars: 4 } });
      expect(r.status).toBe(200);
    }
  }
  await go(`/runs/${rateRun.id}`);
  const panel = p.getByTestId("guest-panel");
  await panel.getByText("3 guests of 50").waitFor();
  await panel.locator("label.switch").click();
  await toastSays(p, "Guest votes from this link now count");
  expect((await list("guest_links", `run = "${rateRun.id}"`))[0].counts).toBe(true);
  await shot(p, "guests-run-counting");

  await go(`/judge/${rateRun.id}/${rateRun.tasks[0]}`);
  await p.getByTestId("guest-crowd").first().waitFor();
  expect(await p.getByTestId("guest-crowd").count()).toBe(3);
  await shot(p, "guests-judge");

  await go(`/leaderboard/${rateRun.role.id}`);
  await p.getByTestId("guest-n").first().waitFor();
  await shot(p, "guests-leaderboard");
}, 120_000);

test("Compare with images: the guest picks between two pictures", async () => {
  const run = await startRun("Image maker", ["Mock Image", "Mock Image B"], "compare");
  const lk = await create(h, "guest_links", { run: run.id });
  await g.goto(app(`/vote/${lk.token}`));
  await settle(g);
  await g.getByText("Look at two answers at a time").waitFor();
  await g.waitForFunction(() => {
    const imgs = [...document.querySelectorAll<HTMLImageElement>(".pair img")];
    // The mock image maker makes one or more images per answer.
    return imgs.length >= 2 && imgs.every((i) => i.complete && i.naturalWidth > 0);
  });
  await blind(g);
  await shot(g, "guests-vote-compare");
  await g.locator(".pair__buttons button").first().click();
  await toastSays(g, "Saved");
  await g.getByTestId("vote-thanks").waitFor();
  const v = await h.sql<{ winner: string }>("SELECT winner FROM vb_guest_votes WHERE run = ?", [run.id]);
  expect(v.map((x) => x.winner)).toEqual(["this"]);
}, 120_000);

test("a closed link tells the guest, kindly", async () => {
  await go(`/runs/${rateRun.id}`);
  await p.getByTestId("guest-panel").getByRole("button", { name: "Close link" }).click();
  await toastSays(p, "Link closed");
  await p.getByTestId("guest-make").waitFor();
  await shot(p, "guests-run-closed");
  await g.goto(linkUrl);
  await settle(g);
  await g.getByText("Voting is closed").waitFor();
  await g.getByText("This link has been closed").waitFor();
  await shot(g, "guests-vote-closed");
}, 60_000);
