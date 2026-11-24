// T5 (PR #9 follow-up): the same-provider warning reaches the owner before a
// run starts. The server side is tested in test/runs.test.ts (preview
// warnings); this checks the "Start a run" screen shows it in the browser,
// and shows none when the judge's provider differs. Mock provider only: the
// Anthropic contender is never called, because no run is started.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { boot, create, OWNER, type Harness } from "./harness.ts";
import { ROOT } from "../scripts/lib/vaultbase.ts";
import { seedReference } from "../seed/reference.ts";

let h: Harness, browser: Browser, p: Page;
let role: Record<string, any>, judge: Record<string, any>, sibling: Record<string, any>;

beforeAll(async () => {
  const b = Bun.spawnSync(["bun", join(ROOT, "scripts", "build-ui.ts")]);
  if (b.exitCode !== 0) throw new Error("UI build failed: " + b.stderr.toString());
  h = await boot();
  await seedReference(h.url, h.adminToken);
  const conn = await create(h, "connections", { name: "Anthropic (test)", provider: "anthropic" });
  judge = await create(h, "contenders", { name: "Judge model (test)", connection: conn.id, model: "claude-opus-5-5", config: { effort: "high" } });
  sibling = await create(h, "contenders", { name: "Sibling model (test)", connection: conn.id, model: "claude-sonnet-5-5", config: { effort: "medium" } });
  // Any seeded workspace will do: the first one, by creation order.
  const ws = (await h.api("owner", "GET", "/api/v1/workspaces?perPage=50&sort=created")).body.data[0];
  expect((await h.api("owner", "PATCH", `/api/v1/workspaces/${ws.id}`, { judge_contender: judge.id })).status).toBe(200);
  role = (await h.api("owner", "GET", `/api/v1/roles?perPage=1&filter=${encodeURIComponent(`workspace = "${ws.id}"`)}`)).body.data[0];

  browser = await chromium.launch();
  p = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  p.setDefaultTimeout(30_000);
  await p.goto(`${h.url}/signin`);
  await p.fill("input[type=email]", OWNER.email);
  await p.fill("input[type=password]", OWNER.password);
  await p.locator("button[type=submit]").click();
  await p.waitForURL((u) => !u.pathname.endsWith("/signin"));
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await h?.cleanup();
});

async function openStartRun(contender: string) {
  // A full load, so nothing chosen on an earlier visit carries over.
  await p.goto(`${h.url}/runs/new?role=${role.id}`);
  await p.reload();
  await p.waitForSelector("#main section:not(.is-loading)", { state: "attached" });
  await p.locator("label.check", { hasText: contender }).click();
  await p.locator(".seg label", { hasText: /AI/ }).first().click();
}

test("an API contender on the judge's provider shows the warning before the run starts", async () => {
  await openStartRun(sibling.name);
  const notice = p.locator(".notice[data-state=warning]", { hasText: "shares a provider" });
  await notice.waitFor();
  expect(await notice.innerText()).toContain(sibling.name);
  expect(await notice.innerText()).toContain("judge this run yourself");
});

test("a mock contender with the same judge shows no warning", async () => {
  await openStartRun("Mock Steady");
  await p.waitForFunction(() => document.querySelector("[data-testid=call-count]")?.textContent?.trim() !== "");
  // Give the debounced preview time to answer, then check nothing warns.
  await p.waitForTimeout(800);
  expect(await p.locator(".notice[data-state=warning]").allInnerTexts()).toEqual([]);
});

test("an old #/ link opens the same page at its path URL", async () => {
  // Bookmarks from before quiver (PLATFORM-UPGRADES part C) keep working, also
  // from before the app moved to the site root: the server redirects
  // /api/custom/app/ to / and the browser keeps the #/ route.
  await p.goto(`${h.url}/api/custom/app/#/runs/new?role=${role.id}`);
  await p.waitForURL((u) => u.pathname === "/runs/new" && u.search === `?role=${role.id}` && !u.hash);
  await p.locator("label.check", { hasText: "Mock Steady" }).waitFor();
});

test("signed out, a deep link goes to sign-in and back after it", async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const q = await ctx.newPage();
  await q.goto(`${h.url}/r/${role.id}`);
  await q.waitForURL((u) => u.pathname === "/signin" && u.searchParams.get("next") === `/r/${role.id}`);
  await q.fill("#si-email", OWNER.email);
  await q.fill("#si-pass", OWNER.password);
  await q.getByRole("button", { name: /Sign in/ }).click();
  await q.waitForURL((u) => u.pathname === `/r/${role.id}`);
  await q.waitForFunction(() => document.title === "Role · Audition"); // quiver sets it from the route's meta.title
  await ctx.close();
});
