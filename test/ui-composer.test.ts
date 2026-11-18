// The Composer utility role in the browser (TECH-SPEC §9a), against the mock
// provider: pick a Composer in the workspace settings, compose a task's
// prompt, edit it, see it marked on Start a run, and check every contender
// got that exact text. Then the read-only view once the task has run, and a
// failing Composer's error.
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
const APP = "/api/custom/app";
let h: Harness, browser: Browser, p: Page;
const errors: string[] = [];

beforeAll(async () => {
  const b = Bun.spawnSync(["bun", join(ROOT, "scripts", "build-ui.ts")]);
  if (b.exitCode !== 0) throw new Error("UI build failed: " + b.stderr.toString());
  h = await boot();
  await seedReference(h.url, h.adminToken);
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
}
const go = async (path: string) => { await p.goto(app(path)); await settle(); };
const toastSays = (text: string | RegExp) => p.locator("#toaster").getByText(text).first().waitFor();
const list = async (collection: string, filter: string) =>
  (await h.api("owner", "GET", `/api/v1/${collection}?perPage=500&filter=${encodeURIComponent(filter)}`)).body.data as any[];
const one = async (collection: string, filter: string) => (await list(collection, filter))[0];

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

async function pickComposer(wsId: string, name: string) {
  await go(`/w/${wsId}/settings`);
  await p.locator("#ws-composer").scrollIntoViewIfNeeded();
  await p.click("#ws-composer");
  if (process.env["DEBUG_SHOT"]) await p.screenshot({ path: process.env["DEBUG_SHOT"] });
  await p.locator(".dd__menu:popover-open .dd__opt", { hasText: name }).first().click();
  return true;
}

test("sign in", async () => {
  await p.goto(app("/signin"));
  await p.fill("#si-email", OWNER.email);
  await p.fill("#si-pass", OWNER.password);
  await p.getByRole("button", { name: /Sign in/ }).click();
  await p.waitForURL((u) => !u.pathname.includes("signin"));
  await settle();
}, 60_000);

let taskId = "";

test("a task without a Composer points to the workspace settings", async () => {
  const role = await one("roles", `name = "Trip researcher"`);
  const task = (await list("tasks", `role = "${role.id}"`))[0];
  taskId = task.id;
  await go(`/t/${taskId}`);
  const panel = p.locator("[data-testid=prompt-panel]");
  await panel.getByText("Plain").first().waitFor();
  await panel.getByRole("link", { name: "workspace settings" }).waitFor();
  expect(await p.locator("#tk-compose").count()).toBe(0);
}, 60_000);

test("pick a Composer in the workspace settings", async () => {
  const ws = await one("workspaces", `name = "Travel Research"`);
  await pickComposer(ws.id, "Mock Steady");
  await p.locator("#ws-composer").getByText("Mock Steady").waitFor();
  await p.locator("[data-testid=composer-panel]").scrollIntoViewIfNeeded();
  await shot("composer-workspace-settings");
  await p.click("button[type=submit]");
  await toastSays("Settings saved");
  const steady = await one("contenders", `name = "Mock Steady"`);
  expect((await one("workspaces", `id = "${ws.id}"`)).composer_contender).toBe(steady.id);
}, 60_000);

test("compose the prompt, edit it and save", async () => {
  await go(`/t/${taskId}`);
  await shot("composer-task-plain");
  await p.click("#tk-compose");
  await p.locator("#tk-composed").waitFor({ state: "visible" });
  await p.waitForFunction(() => (document.querySelector("#tk-composed") as HTMLTextAreaElement)?.value.includes("HOW TO DO WELL"));
  await p.locator("[data-testid=compose-meta]").getByText(/Written by Mock Steady · .* tokens in, 120 out · cost/).waitFor();
  await shot("composer-task-composed");
  const box = p.locator("#tk-composed");
  const text = await box.inputValue();
  await box.fill(text.replace("HOW TO DO WELL", "HOW TO DO WELL (checked by me)"));
  await p.getByRole("button", { name: "Save task" }).click();
  await toastSays("Task saved");
  const t = await one("tasks", `id = "${taskId}"`);
  expect(t.composed_prompt).toContain("HOW TO DO WELL (checked by me)");
  expect(t.compose.status).toBe("done");
}, 60_000);

test("Start a run marks the composed task, and every contender gets that text", async () => {
  const role = await one("roles", `name = "Trip researcher"`);
  await go(`/runs/new?role=${role.id}`);
  await p.getByText("Composed prompt").first().waitFor();
  for (const c of ["Mock Steady", "Mock Erratic"]) await p.locator("label.check").filter({ has: p.locator("strong", { hasText: new RegExp(`^${c}$`) }) }).click();
  await shot("composer-start-run");
  await p.click("#start-run");
  await p.waitForURL(/\/app\/runs\/[\w-]+$/);
  const run = p.url().split("/runs/")[1]!;
  const attempts = await list("attempts", `run = "${run}" && task = "${taskId}"`);
  expect(attempts.length).toBe(2);
  for (const a of attempts) expect(a.prompt_sent).toContain("HOW TO DO WELL (checked by me)");
}, 60_000);

test("once the task has run, its composed prompt is read-only", async () => {
  await go(`/t/${taskId}`);
  await p.locator("#tk-composed").waitFor({ state: "visible" });
  expect(await p.locator("#tk-composed").getAttribute("readonly")).not.toBeNull();
  await p.getByText("Every contender got exactly this text.").waitFor();
  expect(await p.locator("#tk-compose").isVisible()).toBe(false);
  await shot("composer-task-locked");
}, 60_000);

test("a failing Composer shows its error on the task", async () => {
  const ws = await one("workspaces", `name = "Travel Research"`);
  const mock = await one("connections", `name = "Mock"`);
  await create(h, "contenders", { name: "Mock Fail", connection: mock.id, model: "mock-fail", config: { mock: { behaviour: "fail" } } });
  await pickComposer(ws.id, "Mock Fail");
  await p.click("button[type=submit]");
  await toastSays("Settings saved");
  const role = await one("roles", `name = "Trip researcher"`);
  const fresh = await create(h, "tasks", { role: role.id, title: "A weekend in Porto", prompt: "<p>Plan two days in Porto for a couple who like food and walking.</p>" });
  await go(`/t/${fresh.id}`);
  await p.click("#tk-compose");
  await p.getByText("The Composer couldn't write it.").waitFor();
  await p.getByText("Mock Fail always fails.").waitFor();
  await shot("composer-task-failed");
}, 60_000);
