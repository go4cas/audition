// T4 Done-when 1 and 2: a browser walks the whole Phase 1 flow through the UI,
// across all four reference workspaces, against the mock provider only.
//
// Set UI_SCREENS=<folder> to also save screenshots at 1280 and 375 px wide.
import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { boot, OWNER, type Harness } from "./harness.ts";
import { ROOT } from "../scripts/lib/vaultbase.ts";
import { seedReference } from "../seed/reference.ts";

const SCREENS = process.env["UI_SCREENS"];
const T = 30_000;
let h: Harness, browser: Browser, ctx: BrowserContext, p: Page;
const files = mkdtempSync(join(tmpdir(), "audition-ui-files-"));
const errors: string[] = [];

// A real 2x2 PNG (signature, IHDR, IDAT, IEND), so the upload's magic-byte check passes.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DwHwyBNAMDEwMDAwB+3Af5+ZCmAwAAAABJRU5ErkJggg==", "base64");

beforeAll(async () => {
  const b = Bun.spawnSync(["bun", join(ROOT, "scripts", "build-ui.ts")]);
  if (b.exitCode !== 0) throw new Error("UI build failed: " + b.stderr.toString());
  h = await boot();
  await seedReference(h.url, h.adminToken);
  writeFileSync(join(files, "sale-image.png"), PNG);
  writeFileSync(join(files, "notes.md"), "# Notes\n\nNorthwind looks steady.\n");
  browser = await chromium.launch();
  ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: SCREENS ? 2 : 1 });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: h.url });
  p = await ctx.newPage();
  p.setDefaultTimeout(T);
  p.on("pageerror", (e) => errors.push(`${new URL(p.url()).pathname}: ${e}`));
}, 180_000);

afterEach(async () => {
  // UI_DEBUG=<folder> keeps a picture of the screen after every step.
  if (p && process.env["UI_DEBUG"]) await p.screenshot({ path: join(process.env["UI_DEBUG"], `after-${Date.now()}.png`) }).catch(() => {});
});

afterAll(async () => {
  await browser?.close();
  await h?.cleanup();
});

// Real path URLs under the app's base (quiver, PLATFORM-UPGRADES part C).
const APP = "/api/custom/app";
const app = (path = "/") => `${h.url}${APP}${path}`;
const go = async (path: string) => { await p.goto(app(path)); await settle(); };
/** Wait for the page's loader to finish and check the wording on screen. */
async function settle() {
  await p.waitForSelector("#main section:not(.is-loading)", { state: "attached" });
  await p.waitForFunction(() => !document.querySelector("#main .skeleton"));
  const text = await p.evaluate(() => document.body.innerText);
  expect(text).not.toMatch(/\battempts?\b/i);
}
const toastSays = (text: string | RegExp) => p.locator("#toaster").getByText(text).first().waitFor();
async function pick(id: string, label: string) {
  await p.click(`#${id}`);
  await p.locator(".dd__menu:popover-open .dd__opt", { hasText: label }).first().click();
}
async function shot(name: string) {
  if (!SCREENS) return;
  mkdirSync(SCREENS, { recursive: true });
  await p.evaluate(() => { document.getElementById("toaster")!.style.visibility = "hidden"; });
  for (const w of [1280, 375]) {
    // Grow the window to the page's height, so fixed bars sit at the end.
    await p.setViewportSize({ width: w, height: 800 });
    await p.waitForTimeout(200);
    const height = await p.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
    await p.setViewportSize({ width: w, height: Math.min(height, 4000) });
    await p.waitForTimeout(150);
    await p.screenshot({ path: join(SCREENS, `${name}-${w}.png`) });
  }
  await p.setViewportSize({ width: 1280, height: 900 });
  await p.evaluate(() => { document.getElementById("toaster")!.style.visibility = ""; });
}
const ids = async (collection: string, filter: string) =>
  (await h.api("owner", "GET", `/api/v1/${collection}?perPage=500&filter=${encodeURIComponent(filter)}`)).body.data as any[];
const one = async (collection: string, filter: string) => (await ids(collection, filter))[0];

async function startRun(role: string, contenders: string[], judge: "Me" | RegExp | null, calls: number) {
  const r = await one("roles", `name = "${role}"`);
  await go(`/runs/new?role=${r.id}`);
  for (const c of contenders) await p.locator("label.check", { hasText: c }).click();
  if (judge) await p.locator(`.seg label`, { hasText: judge }).first().click();
  await p.waitForFunction((n) => document.querySelector("[data-testid=call-count]")?.textContent?.trim() === n, String(calls));
  await shot(`start-run-${role.toLowerCase().replace(/\W+/g, "-")}`);
  await p.click("#start-run");
  await p.waitForURL(/\/app\/runs\/[\w-]+$/);
  await settle();
  return p.url().split("/runs/")[1]!;
}
const waitFor = async (fn: () => Promise<boolean>, what: string, ms = 60_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return; await Bun.sleep(300); }
  throw new Error("Timed out waiting for " + what);
};
const runStatus = async (id: string) => (await h.api("owner", "GET", `/api/v1/runs/${id}`)).body.data.status as string;
const counts = async (id: string) => (await h.api("owner", "GET", `/api/custom/runs/${id}`)).body.data?.counts ?? (await h.api("owner", "GET", `/api/custom/runs/${id}`)).body.counts;

/** Copy the prompt, paste a reply (and files) for the contender shown, submit. */
async function paste(runId: string, taskId: string, reply: string, attach?: string) {
  await go(`/handoff/${runId}/${taskId}`);
  const prompt = await p.getByTestId("prompt").innerText();
  await p.getByRole("button", { name: /Copy prompt/ }).click();
  await toastSays(/Prompt copied/);
  expect(await p.evaluate(() => navigator.clipboard.readText())).toBe(prompt);
  await p.fill("#ho-reply", reply);
  if (attach) {
    await p.setInputFiles("#ho-files", join(files, attach));
    await p.locator(".files li", { hasText: attach }).waitFor();
  }
  await shot(`handoff-${attach ? "with-file" : "text"}`);
  await p.getByRole("button", { name: "Submit output" }).click();
  await p.getByRole("button", { name: "Yes, submit" }).click();
  await toastSays("Output submitted");
  return prompt;
}

test("sign in", async () => {
  await p.goto(app("/"));
  await p.waitForURL(/\/app\/signin/);
  await p.fill("#si-email", OWNER.email);
  await p.fill("#si-pass", "wrong password");
  await p.getByRole("button", { name: /Sign in/ }).click();
  await p.locator(".notice[data-state=error], #toaster .toast").first().waitFor();
  await p.fill("#si-pass", OWNER.password);
  await shot("signin");
  await p.getByRole("button", { name: /Sign in/ }).click();
  await p.waitForURL((u) => !u.pathname.includes("signin"));
  await settle();
  for (const w of ["Software Factory", "Marketing Pipeline", "Stock Review", "Travel Research"]) await p.getByText(w).first().waitFor();
  await shot("home");
}, 60_000);

test("Software Factory: edit the workspace, a stage, a role's rubric and a task", async () => {
  const ws = await one("workspaces", `name = "Software Factory"`);
  await go(`/w/${ws.id}`);
  await shot("workspace");
  await go(`/w/${ws.id}/settings`);
  await p.fill("#ws-desc", "Agents that research, spec and build small web features.");
  await p.getByLabel("Stage 2", { exact: true }).fill("Specification");
  await p.click("button[type=submit]");
  await toastSays("Settings saved");
  await p.waitForURL(new RegExp(`/app/w/${ws.id}$`));
  expect((await one("workspaces", `id = "${ws.id}"`)).description).toBe("Agents that research, spec and build small web features.");
  expect((await one("stages", `workspace = "${ws.id}" && name = "Specification"`))).toBeTruthy();

  const role = await one("roles", `name = "Researcher"`);
  await go(`/r/${role.id}`);
  await p.getByLabel("Guidance 1", { exact: true }).fill("Facts are right and every claim has a source");
  await p.getByRole("button", { name: "Save role" }).click();
  // Wait for this save's own toast: "Settings saved" may still be showing.
  await toastSays("Role saved");
  const saved = await one("roles", `id = "${role.id}"`);
  expect(saved.rubric[0].guidance).toBe("Facts are right and every claim has a source");
  await shot("role");

  const task = await one("tasks", `role = "${role.id}" && title ~ "SQLite"`);
  await go(`/t/${task.id}`);
  await p.fill("#tk-title", "Summarise SQLite versus Postgres for a single-user app");
  await p.getByRole("button", { name: "Save task" }).click();
  // This save's own toast, not an earlier one still showing: the page moves on
  // right after it, and the next step must not race that.
  await toastSays("Task saved");
  expect((await one("tasks", `id = "${task.id}"`)).title).toBe("Summarise SQLite versus Postgres for a single-user app");
}, 90_000);

let sfRun = "";
test("Software Factory: run with the AI judge, paste one output, override a verdict, Run again", async () => {
  const role = await one("roles", `name = "Researcher"`);
  // 2 tasks × (1 mock API + 1 copy-and-paste); the mock judge makes no provider calls.
  sfRun = await startRun("Researcher", ["Mock Steady", "Claude Code (manual)"], null, 2);
  await p.getByText("Live").first().waitFor();
  await shot("run-live");
  const tasks = await ids("tasks", `role = "${role.id}"`);
  for (const t of tasks) {
    await p.locator(`a[href="${APP}/handoff/${sfRun}/${t.id}"]`).first().waitFor();
    const prompt = await paste(sfRun, t.id, `Recommendation for: ${t.title}\n\nUse SQLite. Sources: sqlite.org, postgresql.org.`);
    expect(prompt).toContain("You are acting as: Researcher");
  }
  await waitFor(async () => (await runStatus(sfRun)) === "done", "the AI judge to finish");
  await go(`/runs/${sfRun}`);
  await p.getByText("Finished").first().waitFor();
  await shot("run-done");

  // Repeat (Phase 2a): every Monday at 09:00 local becomes a Vaultbase cron job.
  await pick("rp-day", "Monday");
  await p.fill("#rp-time", "09:00");
  await p.getByRole("button", { name: "Repeat", exact: true }).click();
  await toastSays("Repeats every Monday at 09:00");
  await p.getByText("Repeats every Monday at 09:00").first().waitFor();
  expect((await one("runs", `id = "${sfRun}"`)).schedule).toMatch(/^0 \d+ \* \* [0-6]$/);
  await shot("run-repeat");
  await p.getByRole("button", { name: "Stop repeating" }).click();
  await toastSays("Stopped repeating");
  expect((await one("runs", `id = "${sfRun}"`)).schedule || "").toBe("");

  // Blind judging with AI verdicts: change one output's stars.
  const t0 = tasks[0];
  await go(`/judge/${sfRun}/${t0.id}`);
  await p.getByText("Judged by AI").first().waitFor();
  expect(await p.locator("[data-output]").count()).toBe(2);
  const body = await p.evaluate(() => document.querySelector("#main")!.textContent!);
  for (const name of ["Mock Steady", "Claude Code"]) expect(body).not.toContain(name);
  await shot("judge-ai");
  const card = p.locator("[data-output]").first();
  await card.getByRole("button", { name: "Change stars" }).click();
  const radios = card.locator(".star-input");
  for (let i = 0; i < await radios.count(); i++) await radios.nth(i).locator("label").first().click(); // 5 stars
  await card.getByRole("button", { name: "Done" }).click();
  await toastSays(/Your stars count now/);
  await p.locator(".judge-tag", { hasText: "Your stars count" }).waitFor();
  const humans = await h.sql<{ n: number }>(`SELECT COUNT(*) AS n FROM vb_verdicts WHERE judge_kind = 'human'`);
  expect(Number(humans[0]!.n)).toBe(1);
  await shot("judge-override");

  await go(`/runs/${sfRun}`);
  await p.getByRole("button", { name: "Run again" }).click();
  await toastSays("New run started");
  await p.waitForURL((u) => !u.pathname.endsWith(sfRun));
  const again = p.url().split("/runs/")[1]!;
  expect((await one("runs", `id = "${again}"`)).rerun_of).toBe(sfRun);
}, 180_000);

test("Software Factory: a task used in a run is read-only; Duplicate and edit makes version 2", async () => {
  const role = await one("roles", `name = "Researcher"`);
  const task = await one("tasks", `role = "${role.id}" && title ~ "settings"`);
  expect(task.locked).toBe(true);
  await go(`/t/${task.id}`);
  await p.getByText("This task was used in a run").waitFor();
  expect(await p.locator("#tk-title").getAttribute("readonly")).not.toBeNull();
  await shot("task-locked");
  await p.getByRole("button", { name: "Duplicate and edit" }).click();
  await p.waitForFunction(() => document.activeElement?.id === "tk-prompt"); // the draft focuses the prompt
  await p.fill("#tk-title", "Compare three ways to store user settings and recommend one, with sources");
  await p.getByRole("button", { name: "Save version 2" }).click();
  await toastSays(/saved|version/i);
  const v2 = await one("tasks", `previous_version = "${task.id}"`);
  expect(v2.title).toBe("Compare three ways to store user settings and recommend one, with sources");
  expect((await one("tasks", `id = "${task.id}"`)).title).toBe(task.title);
}, 60_000);

test("Stock Review: add a connection with a key and a contender; paste an output with a file", async () => {
  await go("/contenders");
  await p.getByRole("button", { name: "Add connection" }).click();
  await p.fill("#cx-name", "Anthropic (test)");
  const key = "sk-ant-test-0123456789abcdefghij";
  await p.fill("#cx-key", key);
  await p.getByRole("button", { name: "Save connection" }).click();
  await toastSays(/won't be shown again/);
  await p.getByText("API key saved").first().waitFor();
  expect(await p.content()).not.toContain(key);
  expect(await p.evaluate((k) => JSON.stringify(localStorage) + document.body.innerHTML, key)).not.toContain(key);
  const conn = await one("connections", `name = "Anthropic (test)"`);
  expect(conn.has_key).toBe(true);
  expect(JSON.stringify(conn)).not.toContain(key);
  await shot("contenders");

  await go("/contenders/new");
  await p.fill("#cn-name", "Claude on a test key");
  await pick("cn-conn", "Anthropic (test)");
  await p.fill("#cn-model", "claude-test-model");
  await shot("contender-new");
  await p.getByRole("button", { name: "Add contender" }).click();
  await toastSays(/added/i);
  await p.waitForURL(/\/app\/contenders$/);
  await settle();
  const c = await one("contenders", `name = "Claude on a test key"`);
  expect(c.mode).toBe("api");
  expect(c.connection).toBe(conn.id);

  // The run itself uses mock and copy-and-paste contenders only.
  const role = await one("roles", `name = "Stock analyst"`);
  const run = await startRun("Stock analyst", ["Mock Erratic", "ChatGPT (manual)"], null, 1);
  const task = await one("tasks", `role = "${role.id}"`);
  await p.locator(`a[href="${APP}/handoff/${run}/${task.id}"]`).first().waitFor();
  await go(`/handoff/${run}/${task.id}`);
  await p.getByText("northwind-foods-q3.txt").first().waitFor();
  const prompt = await paste(run, task.id, "Hold. Revenue is flat, margins improved, and debt is falling.", "notes.md");
  expect(prompt).toContain("northwind-foods-q3.txt");
  await waitFor(async () => (await runStatus(run)) === "done", "the Stock Review run to be judged");
  await go(`/judge/${run}/${task.id}`);
  // Blind judging shows a neutral name (A-1.md), never the uploaded "notes.md".
  await p.getByText(/^[A-Z]-1\.md$/).first().waitFor();
  expect(await p.getByText("notes.md").count()).toBe(0);
  await p.getByText("Judged by AI").first().waitFor();
}, 180_000);

test("Marketing Pipeline: an image run judged blind in the image grid", async () => {
  const role = await one("roles", `name = "Image maker"`);
  const run = await startRun("Image maker", ["Mock Image", "Midjourney (manual)"], null, 1);
  const task = await one("tasks", `role = "${role.id}"`);
  await p.locator(`a[href="${APP}/handoff/${run}/${task.id}"]`).first().waitFor();
  await paste(run, task.id, "Warm tones, a coffee bag on a wooden table.", "sale-image.png");
  await waitFor(async () => { const c = await counts(run); return (c?.submitted || 0) === 2; }, "both image outputs");
  await go(`/judge/${run}/${task.id}`);
  await p.locator(".image-grid [data-output]").nth(1).waitFor();
  expect(await p.locator(".image-grid [data-output]").count()).toBe(2);
  await p.waitForFunction(() => [...document.querySelectorAll(".image-grid img")].length === 2 && [...document.querySelectorAll<HTMLImageElement>(".image-grid img")].every((i) => i.src.startsWith("blob:") && i.complete && i.naturalWidth > 0));
  await shot("judge-images");
  await p.locator(".image-card__img").first().click();
  await p.locator("#lightbox[open] img").waitFor();
  await p.keyboard.press("Escape");
  const cards = p.locator(".image-grid [data-output]");
  for (let i = 0; i < 2; i++) {
    const stars = cards.nth(i).locator(".star-input");
    for (let k = 0; k < await stars.count(); k++) await stars.nth(k).locator("label").nth(i === 0 ? 0 : 2).click(); // 5 and 3
  }
  await p.getByRole("button", { name: "Save stars" }).click();
  await toastSays(/Stars saved/);
  await waitFor(async () => (await runStatus(run)) === "done", "the image run to finish");
}, 180_000);

test("Travel Research: judge as me, then confirm a champion on the leaderboard", async () => {
  const ws = await one("workspaces", `name = "Travel Research"`);
  await go(`/w/${ws.id}/settings`);
  await p.fill("#ws-min", "2");
  await p.click("button[type=submit]");
  await toastSays("Settings saved");
  expect((await one("workspaces", `id = "${ws.id}"`)).min_outputs).toBe(2);

  const role = await one("roles", `name = "Trip researcher"`);
  const run = await startRun("Trip researcher", ["Mock Steady", "Mock Erratic"], null, 4);
  await waitFor(async () => { const c = await counts(run); return (c?.submitted || 0) === 4; }, "four outputs");
  for (const t of await ids("tasks", `role = "${role.id}"`)) {
    await go(`/judge/${run}/${t.id}`);
    await p.getByText("Not rated yet").first().waitFor();
    const cards = p.locator(".outputs [data-output]");
    expect(await cards.count()).toBe(2);
    for (let i = 0; i < 2; i++) {
      const stars = cards.nth(i).locator(".star-input");
      for (let k = 0; k < await stars.count(); k++) await stars.nth(k).locator("label").nth(i === 0 ? 0 : 1).click(); // 5 and 4
    }
    await shot("judge-me");
    await p.getByRole("button", { name: "Save stars" }).click();
    await toastSays(/Stars saved/);
  }
  await waitFor(async () => (await runStatus(run)) === "done", "the Travel run to finish");

  await go(`/leaderboard/${role.id}`);
  await p.getByText("Suggested champion").waitFor();
  await shot("leaderboard");
  await p.locator("#champ-box").getByRole("button", { name: "Make champion" }).click();
  await toastSays(/is now the Trip researcher champion/);
  await p.getByText(/Champion since/).waitFor();
  const casting = await one("castings", `role = "${role.id}"`);
  expect(casting).toBeTruthy();
  await shot("leaderboard-champion");
}, 180_000);

test("the browser saw no script errors", () => {
  expect(errors).toEqual([]);
});
