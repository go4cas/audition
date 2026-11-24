// Image-model contenders in the browser (TECH-SPEC §12a): add an
// OpenAI-compatible contender that makes images, see the mismatch warning on
// Start a run, and judge its pictures in the image grid. The provider call is
// faked by the test-only route test/generate, so no real API is called.
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
import { testImage } from "../vb_hooks/lib/png.ts";

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
async function pick(id: string, label: string) {
  await p.click(`#${id}`);
  await p.locator(".dd__menu:popover-open .dd__opt", { hasText: label }).first().click();
}

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

async function signIn() {
  await p.goto(app("/signin"));
  await p.fill("#si-email", OWNER.email);
  await p.fill("#si-pass", OWNER.password);
  await p.getByRole("button", { name: /Sign in/ }).click();
  await p.waitForURL((u) => !u.pathname.includes("signin"));
  await settle();
}

test("add an image contender, see the warning, judge its pictures", async () => {
  const conn = await create(h, "connections", { name: "OpenAI", provider: "openai-compatible", base_url: "https://api.openai.com/v1" });
  await signIn();

  // 1. The contender form: "What does it make?" → Images, with size, quality and count.
  await go("/contenders/new");
  await p.fill("#cn-name", "gpt-image, high");
  await pick("cn-conn", "OpenAI");
  await p.fill("#cn-model", "gpt-image-1.5");
  await expect(p.locator("#cn-temp").count()).resolves.toBe(1);
  await p.locator(".seg label", { hasText: "Images" }).click();
  await p.locator("#cn-size").waitFor();
  expect(await p.locator("#cn-temp").count()).toBe(0);
  await pick("cn-size", "Square");
  await pick("cn-quality", "High");
  await p.fill("#cn-n", "2");
  await shot("images-contender-form");
  await p.getByRole("button", { name: "Add contender" }).click();
  await toastSays(/added/i);
  await p.waitForURL(/:\d+\/contenders$/);
  await settle();
  const painter = await one("contenders", `name = "gpt-image, high"`);
  expect(painter.connection).toBe(conn.id);
  expect(painter.config).toEqual({ image: { size: "1024x1024", n: 2, quality: "high" } });
  await p.getByText("makes images").first().waitFor();
  await shot("images-contenders");

  // Editing keeps the choice.
  await go(`/contenders/${painter.id}/edit`);
  expect(await p.locator("#cn-n").inputValue()).toBe("2");
  await p.locator("#cn-size").waitFor();

  // 2. Start a run: a text model on an image task, and an image maker, are flagged.
  const writer = await create(h, "contenders", { name: "GPT text", connection: conn.id, model: "gpt-text" });
  const role = await one("roles", `name = "Image maker"`);
  await go(`/runs/new?role=${role.id}`);
  for (const c of ["gpt-image, high", "GPT text", "Mock Image"]) await p.locator("label.check", { hasText: c }).click();
  await p.getByText(`GPT text answers in text, but`).waitFor();
  expect(await p.getByText("gpt-image, high makes images").count()).toBe(0);
  await shot("images-start-run");

  // The workspace's AI judge and Composer pickers leave image makers out.
  await go(`/w/${role.workspace}/settings`);
  await p.locator("#ws-composer").scrollIntoViewIfNeeded();
  await p.click("#ws-composer");
  await p.locator(".dd__menu:popover-open .dd__opt").first().waitFor();
  expect(await p.locator(".dd__menu:popover-open .dd__opt", { hasText: "gpt-image, high" }).count()).toBe(0);
  expect(await p.locator(".dd__menu:popover-open .dd__opt", { hasText: "GPT text" }).count()).toBe(1);
  await p.keyboard.press("Escape");

  // 3. A run of the image maker and Mock Image, outputs made through the worker with a fake provider.
  const task = await one("tasks", `role = "${role.id}"`);
  const mockImage = await one("contenders", `name = "Mock Image"`);
  const run = await h.store("insert", "runs", { workspace: role.workspace, role: role.id, tasks: [task.id], contenders: [painter.id, mockImage.id], judge: "me", method: "rate", status: "running", call_count: 2 });
  const images = [testImage(0, 512), testImage(1, 512)].map((b) => Buffer.from(b).toString("base64"));
  for (const c of [painter.id, mockImage.id]) {
    const a = await h.store("insert", "attempts", { run, task: task.id, contender: c, mode: "api", status: "queued", prompt_sent: "TASK: Create a square social image" });
    const r = await h.api("admin", "POST", "/api/custom/test/generate", { attempt: a, images });
    expect(r.body.data.result.status).toBe("submitted");
  }
  await go(`/runs/${run}`);
  await shot("images-run");
  await go(`/judge/${run}/${task.id}`);
  await p.locator(".image-grid [data-output]").nth(1).waitFor();
  await p.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>(".image-grid img")].length >= 2 && [...document.querySelectorAll<HTMLImageElement>(".image-grid img")].every((i) => i.complete && i.naturalWidth > 0));
  await shot("images-judge");
}, 180_000);
