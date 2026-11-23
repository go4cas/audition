// Champion on trial, keep and restore in the browser (TECH-SPEC §11a), with
// Cas's example: Claude Sonnet is the Coder champion, GPT takes over on
// trial, GPT is restored away from, crowned again, nudged on Home after a few
// days, and kept.
//
// Set UI_SCREENS=<folder> (and UI_THEMES=both) to save screenshots, as in
// test/ui-walkthrough.test.ts.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { boot, create, OWNER, RUBRIC, type Harness } from "./harness.ts";
import { ROOT } from "../scripts/lib/vaultbase.ts";

const SCREENS = process.env["UI_SCREENS"];
const THEMES: ("light" | "dark" | null)[] = process.env["UI_THEMES"] === "both" ? ["light", "dark"] : [null];
const T = 30_000;
const APP = "/api/custom/app";
let h: Harness, browser: Browser, p: Page;
const errors: string[] = [];
const S: Record<string, any> = {};

beforeAll(async () => {
  const b = Bun.spawnSync(["bun", join(ROOT, "scripts", "build-ui.ts")]);
  if (b.exitCode !== 0) throw new Error("UI build failed: " + b.stderr.toString());
  h = await boot();
  // A Software factory whose Coder role has two qualifying contenders.
  const ws = await create(h, "workspaces", { name: "Software factory", fitness_weights: { quality: 100, tokens: 0, time: 0 }, min_outputs: 3 });
  const role = await create(h, "roles", { workspace: ws.id, name: "Coder", rubric: RUBRIC, pass_mark: 3.5 });
  const task = await create(h, "tasks", { role: role.id, title: "Fix the login bug", prompt: "<p>Fix it.</p>" });
  const conn = await create(h, "connections", { name: "Mock", provider: "mock" });
  const mk = (name: string) => create(h, "contenders", { name, connection: conn.id, model: "mock-steady", config: { mock: { behaviour: "steady" } } });
  const sonnet = await mk("Claude Sonnet"), gpt = await mk("GPT");
  const run = await h.store("insert", "runs", { workspace: ws.id, role: role.id, tasks: [task.id], contenders: [sonnet.id, gpt.id], judge: "me", status: "done", call_count: 0 });
  for (const [c, scores] of [[sonnet, [4, 4, 3.8, 4]], [gpt, [5, 4.6, 5, 4.4]]] as const) {
    for (const score of scores) {
      const a = await h.store("insert", "attempts", { run, task: task.id, contender: c.id, mode: "api", status: "judged" });
      await h.store("insert", "verdicts", { attempt: a, run, method: "rubric", judge_kind: "human", scores: {}, rubric_snapshot: RUBRIC, score, status: "active" });
    }
  }
  Object.assign(S, { ws, role, sonnet, gpt });
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
const castings = async () =>
  (await h.api("owner", "GET", `/api/v1/castings?perPage=50&sort=-created&filter=${encodeURIComponent(`role = "${S.role.id}"`)}`)).body.data as any[];

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

test("sign in", async () => {
  await p.goto(app("/signin"));
  await p.fill("#si-email", OWNER.email);
  await p.fill("#si-pass", OWNER.password);
  await p.getByRole("button", { name: /Sign in/ }).click();
  await p.waitForURL((u) => !u.pathname.includes("signin"));
  await settle();
}, 60_000);

test("a new champion that replaces Claude Sonnet starts on trial", async () => {
  // Claude Sonnet was the Coder champion before GPT's results came in.
  expect((await h.api("owner", "POST", "/api/custom/castings", { role: S.role.id, contender: S.sonnet.id })).status).toBe(200);
  await Bun.sleep(1100); // since has 1 s resolution
  await go(`/leaderboard/${S.role.id}`);
  await p.locator("#champ-box").getByText("GPT").waitFor();
  await p.locator("#champ-current").getByText("Claude Sonnet").waitFor();
  await shot("champion-suggested");
  await p.locator("#champ-box").getByRole("button", { name: "Make champion" }).click();
  await toastSays(/GPT is now the Coder champion/);
  await p.locator("#champ-box").getByText("On trial").first().waitFor();
  await p.locator("#champ-box").getByRole("button", { name: "Keep as champion" }).waitFor();
  await p.locator("#champ-box").getByRole("button", { name: "Restore Claude Sonnet" }).waitFor();
  expect(await p.locator("#champ-box").getByRole("link", { name: /Run again with new settings/ }).getAttribute("href")).toBe(`${APP}/runs/new?role=${S.role.id}`);
  await p.locator("#champ-history").getByText("Claude Sonnet").waitFor();
  await shot("champion-on-trial");
  expect((await castings())[0]).toMatchObject({ contender: S.gpt.id, trial: true });
  // The workspace page shows the trial too.
  await go(`/w/${S.ws.id}`);
  await p.getByText(/On trial since/).waitFor();
}, 60_000);

test("restore Claude Sonnet with a note; GPT is held back", async () => {
  await Bun.sleep(1100);
  await go(`/leaderboard/${S.role.id}`);
  await p.locator("#champ-box").getByRole("button", { name: "Restore Claude Sonnet" }).click();
  await p.fill("#restore-note", "Weak on real refactors");
  await shot("champion-restore-form");
  await p.locator("#restore-form").getByRole("button", { name: "Restore Claude Sonnet" }).click();
  await toastSays(/Claude Sonnet is the Coder champion again/);
  await p.locator("#held-back").waitFor();
  await p.locator("#champ-box").getByText("Restored since").waitFor();
  await p.locator("#champ-box").getByText("Weak on real refactors").waitFor();
  expect(await p.locator("#champ-box").getByRole("button", { name: "Restore GPT" }).count()).toBe(1);
  await shot("champion-restored");
  expect((await castings())[0]).toMatchObject({ contender: S.sonnet.id, restored: true, rationale: "Weak on real refactors" });
}, 60_000);

test("crown GPT again by hand; after a few days on trial Home nudges; keep it", async () => {
  await Bun.sleep(1100);
  const row = p.locator("tr", { hasText: "GPT" });
  await row.getByRole("button", { name: "Make champion" }).click();
  await toastSays(/GPT is now the Coder champion/);
  await p.locator("#champ-box").getByRole("button", { name: "Keep as champion" }).waitFor();
  // The workspace waits 5 days: after 4 there is no reminder yet, after 6 there is.
  await p.goto(app(`/w/${S.ws.id}/settings`)); await settle();
  await p.fill("#ws-trial", "5");
  await shot("champion-workspace-setting");
  await p.click("button[type=submit]");
  await toastSays("Settings saved");
  expect((await h.api("owner", "GET", `/api/v1/workspaces/${S.ws.id}`)).body.data.trial_days).toBe(5);
  const cur = (await castings())[0];
  await h.store("update", "castings", { since: cur.since - 4 * 86400 }, cur.id);
  await go("/");
  expect(await p.getByText("Keep or restore: GPT is on trial").count()).toBe(0);
  await h.store("update", "castings", { since: cur.since - 6 * 86400 }, cur.id);
  await go("/");
  await p.getByText("Keep or restore: GPT is on trial").first().waitFor();
  await shot("champion-trial-home");
  await p.locator("#up-next").getByRole("link", { name: /Start/ }).click();
  await p.waitForURL((u) => u.pathname.includes("/leaderboard/"));
  await settle();
  if (process.env["DEBUG_SHOT"]) await p.screenshot({ path: process.env["DEBUG_SHOT"], fullPage: true });
  await p.locator("#champ-box").getByRole("button", { name: "Keep as champion" }).click();
  await toastSays(/GPT stays the Coder champion/);
  await p.locator("#champ-box").getByText("Champion", { exact: true }).waitFor();
  expect(await p.locator("#champ-box").getByRole("button", { name: "Keep as champion" }).count()).toBe(0);
  await shot("champion-kept");
  expect((await castings()).map((c) => [c.contender === S.gpt.id ? "gpt" : "sonnet", !!c.trial, !!c.restored])).toEqual([
    ["gpt", false, false], ["sonnet", false, true], ["gpt", true, false], ["sonnet", false, false],
  ]);
}, 60_000);
