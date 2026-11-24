// Compare (A vs B) judging in the browser (TECH-SPEC §10a), against the mock
// provider: the workspace default, the run choice and its call count, picking
// pair by pair as the owner, the AI's picks and an override, image pairs, and
// the leaderboard.
//
// Set UI_SCREENS=<folder> (and UI_THEMES=both) to save screenshots, as in
// test/ui-walkthrough.test.ts.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { boot, create, OWNER, type Harness } from "./harness.ts";
import { ROOT } from "../scripts/lib/vaultbase.ts";
import { seedReference } from "../seed/reference.ts";

const SCREENS = process.env["UI_SCREENS"];
const THEMES: ("light" | "dark" | null)[] = process.env["UI_THEMES"] === "both" ? ["light", "dark"] : [null];
const T = 30_000;
const APP = "";
let h: Harness, browser: Browser, p: Page;
const errors: string[] = [];

beforeAll(async () => {
  const b = Bun.spawnSync(["bun", join(ROOT, "scripts", "build-ui.ts")]);
  if (b.exitCode !== 0) throw new Error("UI build failed: " + b.stderr.toString());
  h = await boot();
  await seedReference(h.url, h.adminToken);
  // A third text contender and a second image contender, so pairs exist.
  const mock = (await h.api("owner", "GET", `/api/v1/connections?filter=${encodeURIComponent('name = "Mock"')}`)).body.data[0];
  await create(h, "contenders", { name: "Mock Steady B", connection: mock.id, model: "mock-steady", config: { mock: { behaviour: "steady" } } });
  await create(h, "contenders", { name: "Mock Image B", connection: mock.id, model: "mock-image", config: { mock: { behaviour: "image" } } });
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: SCREENS ? 2 : 1 });
  p = await ctx.newPage();
  p.setDefaultTimeout(T);
  p.on("pageerror", (e) => errors.push(`${new URL(p.url()).pathname}: ${e}`));
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await h?.cleanup();
  expect(errors).toEqual([]);
});

const app = (path = "/") => `${h.url}${APP}${path}`;
async function settle() {
  await p.waitForSelector("#main section:not(.is-loading)", { state: "attached" });
  await p.waitForFunction(() => !document.querySelector("#main .skeleton"));
  expect(await p.evaluate(() => document.body.innerText)).not.toMatch(/\battempts?\b/i);
}
const go = async (path: string) => { await p.goto(app(path)); await settle(); };
const toastSays = (text: string | RegExp) => p.locator("#toaster").getByText(text).first().waitFor();
const list = async (collection: string, filter: string) =>
  (await h.api("owner", "GET", `/api/v1/${collection}?perPage=500&filter=${encodeURIComponent(filter)}`)).body.data as any[];
const one = async (collection: string, filter: string) => (await list(collection, filter))[0];
const waitFor = async (fn: () => Promise<boolean>, what: string, ms = 60_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return; await Bun.sleep(300); }
  throw new Error("Timed out waiting for " + what);
};
const costSays = (text: string) => p.waitForFunction((t) => (document.querySelector("[data-testid=both-cost]") as HTMLElement | null)?.innerText.includes(t), text);
const runStatus = async (id: string) => (await h.api("owner", "GET", `/api/v1/runs/${id}`)).body.data.status as string;

async function shot(name: string) {
  if (!SCREENS) return;
  mkdirSync(SCREENS, { recursive: true });
  await p.evaluate(() => { document.getElementById("toaster")!.style.visibility = "hidden"; });
  for (const theme of THEMES) {
    if (theme) { await p.emulateMedia({ colorScheme: theme }); await p.waitForTimeout(100); }
    for (const w of [1280, 375]) {
      await p.setViewportSize({ width: w, height: 800 });
      await p.waitForTimeout(200);
      const height = await p.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
      await p.setViewportSize({ width: w, height: Math.min(height, 4000) });
      await p.waitForTimeout(150);
      await p.screenshot({ path: join(SCREENS, `${name}${theme ? "-" + theme : ""}-${w}.png`) });
    }
  }
  if (THEMES[0]) await p.emulateMedia({ colorScheme: "light" });
  await p.setViewportSize({ width: 1280, height: 900 });
  await p.evaluate(() => { document.getElementById("toaster")!.style.visibility = ""; });
}

/** Start a run from the UI; method and judge null keep what the page preselected. */
async function startRun(role: string, contenders: string[], o: { judge?: "Me" | "AI"; method?: "Rate (stars)" | "Compare (A vs B)"; calls: number; screen?: string }) {
  const r = await one("roles", `name = "${role}"`);
  await go(`/runs/new?role=${r.id}`);
  for (const c of contenders) await p.locator("label.check").filter({ has: p.locator("strong", { hasText: new RegExp(`^${c}$`) }) }).click();
  if (o.judge) await p.locator(`label[for^="nr-judge-"]`, { hasText: o.judge }).first().click();
  if (o.method) await p.locator(`label[for^="nr-method-"]`, { hasText: o.method }).click();
  await p.waitForFunction((n) => document.querySelector("[data-testid=call-count]")?.textContent?.trim() === n, String(o.calls));
  if (o.screen) await shot(o.screen);
  await p.click("#start-run");
  await p.waitForURL(/:\d+\/runs\/[\w-]+$/);
  await settle();
  return p.url().split("/runs/")[1]!;
}

test("sign in", async () => {
  await p.goto(app("/signin"));
  await p.fill("#si-email", OWNER.email);
  await p.fill("#si-pass", OWNER.password);
  await p.getByRole("button", { name: /Sign in/ }).click();
  await p.waitForURL((u) => !u.pathname.includes("signin"));
  await settle();
}, 60_000);

test("Travel Research: Compare as the workspace default, then pick pair by pair as me", async () => {
  const ws = await one("workspaces", `name = "Travel Research"`);
  expect(ws.default_method).toBe("rate");
  await go(`/w/${ws.id}/settings`);
  await p.locator(`label[for="ws-method-compare"]`).click();
  await p.getByText("Two outputs side by side").first().waitFor();
  await shot("compare-workspace-settings");
  await p.click("button[type=submit]");
  await toastSays("Settings saved");
  expect((await one("workspaces", `id = "${ws.id}"`)).default_method).toBe("compare");

  const role = await one("roles", `name = "Trip researcher"`);
  const tasks = await list("tasks", `role = "${role.id}"`);
  // Compare is preselected from the workspace; three API contenders, no AI judge calls.
  const run = await startRun("Trip researcher", ["Mock Steady", "Mock Erratic", "Mock Steady B"], { judge: "Me", calls: tasks.length * 3, screen: "compare-start-run" });
  expect((await one("runs", `id = "${run}"`)).method).toBe("compare");
  await p.getByText("Compare (A vs B)").first().waitFor();
  await waitFor(async () => (await runStatus(run)) === "judging", "outputs to be ready");

  for (const [n, t] of tasks.entries()) {
    await go(`/judge/${run}/${t.id}`);
    await p.getByText("0 of 3 pairs decided").waitFor();
    expect(await p.locator(".pair-chip").count()).toBe(3);
    if (n === 0) await shot("compare-judge-me");
    for (let i = 0; i < 3; i++) {
      // Left is better, a tie, right is better: one of each.
      await p.locator(".pair__buttons button").nth(i).click();
      await toastSays("Pick saved");
      await p.getByText(`${i + 1} of 3 pairs decided`).waitFor();
    }
    if (n === 0) await shot("compare-judge-me-done");
  }
  await waitFor(async () => (await runStatus(run)) === "done", "the run to be done");
  for (const a of await list("attempts", `run = "${run}"`)) expect(a.status).toBe("judged");
}, 180_000);

test("Software Factory: the AI compares, and my pick overrules one of its picks", async () => {
  const role = await one("roles", `name = "Researcher"`);
  const tasks = await list("tasks", `role = "${role.id}"`);
  // Mock Judge is the AI judge here and costs no calls: 3 outputs per task, 3 pairs per task.
  // "Ask the AI judge both ways" shows its cost before you tick it, and doubles the judge calls when ticked.
  const r = await one("roles", `name = "Researcher"`);
  await go(`/runs/new?role=${r.id}`);
  for (const c of ["Mock Steady", "Mock Erratic", "Mock Steady B"]) await p.locator("label.check").filter({ has: p.locator("strong", { hasText: new RegExp(`^${c}$`) }) }).click();
  await p.locator(`label[for^="nr-judge-"]`, { hasText: "AI" }).first().click();
  await p.locator(`label[for^="nr-method-"]`, { hasText: "Compare (A vs B)" }).click();
  const once = tasks.length * 3;
  await costSays(`will make ${once} calls`);
  await p.locator("label.check", { hasText: "Ask the AI judge both ways" }).click();
  await costSays(`Both ways: ${once * 2} AI judge calls instead of ${once}.`);
  await shot("compare-both-ways");
  await p.locator("label.check", { hasText: "Ask the AI judge both ways" }).click();
  await costSays(`will make ${once} calls`);
  const run = await startRun("Researcher", ["Mock Steady", "Mock Erratic", "Mock Steady B"], { judge: "AI", method: "Compare (A vs B)", calls: tasks.length * 3 });
  await waitFor(async () => (await runStatus(run)) === "done", "the AI to compare every pair");
  const t = tasks[0];
  await go(`/judge/${run}/${t.id}`);
  await p.getByText("3 of 3 pairs decided").waitFor();
  await p.getByText(/The AI picked/).waitFor();
  await shot("compare-judge-ai");
  // Pick the opposite of the AI on the pair shown.
  const pressed = await p.locator(".pair__buttons button[aria-pressed=true]").textContent();
  const other = pressed?.includes("same") ? 0 : 1;
  await p.locator(".pair__buttons button").nth(other).click();
  await toastSays("Your pick counts now. The AI's stays in history.");
  await p.getByText(/Your pick counts; the AI had picked/).waitFor();
  await shot("compare-judge-override");
  const picks = await list("verdicts", `run = "${run}" && method = "pairwise"`);
  expect(picks.filter((v) => v.judge_kind === "human" && v.status === "active").length).toBe(1);
  expect(picks.filter((v) => v.judge_kind === "ai" && v.status === "overridden").length).toBe(1);

  await go(`/leaderboard/${role.id}`);
  await p.getByText("Outputs from Compare runs score 1 to 5").waitFor();
  await p.getByRole("button", { name: "How is this score worked out?" }).click();
  await p.locator(".pop:popover-open").getByText("1 + 4 × 0.75 = 4.0").waitFor();
  if (SCREENS) for (const theme of ["light", "dark"] as const) {
    await p.emulateMedia({ colorScheme: theme });
    await p.waitForTimeout(150);
    await p.screenshot({ path: join(SCREENS, `compare-score-help-${theme}-1280.png`) });
  }
  await p.emulateMedia({ colorScheme: null });
  await p.keyboard.press("Escape");
  await shot("compare-leaderboard");
}, 180_000);

test("Marketing Pipeline: two images side by side", async () => {
  const role = await one("roles", `name = "Image maker"`);
  const [task] = await list("tasks", `role = "${role.id}"`);
  const run = await startRun("Image maker", ["Mock Image", "Mock Image B"], { judge: "Me", method: "Compare (A vs B)", calls: 2 });
  await waitFor(async () => (await runStatus(run)) === "judging", "both images");
  await go(`/judge/${run}/${task.id}`);
  await p.waitForFunction(() => {
    const imgs = [...document.querySelectorAll<HTMLImageElement>(".pair img")];
    return imgs.length >= 2 && imgs.every((i) => i.src.startsWith("blob:") && i.complete && i.naturalWidth > 0);
  });
  await shot("compare-judge-images");
  await p.locator(".pair__buttons button").nth(2).click();
  await toastSays("Pick saved");
  await waitFor(async () => (await runStatus(run)) === "done", "the image run to be done");
}, 180_000);
