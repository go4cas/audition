// Error toasts and the Start a run form (Cas, Nov 26, 2026). Errors from an
// action show as a toast that stays long enough to read, is read out at once
// and can be closed, instead of a notice at the bottom of a long form. Also:
// switching to a role whose workspace has no AI judge used to keep the old
// "AI · <judge>" label and the old role's tasks (Arrow recycling, NOTES T1).
import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { boot, create, OWNER, type Harness } from "./harness.ts";
import { ROOT } from "../scripts/lib/vaultbase.ts";
import { seedReference } from "../seed/reference.ts";

let h: Harness, browser: Browser, p: Page;
let role: Record<string, any>, other: Record<string, any>;
const errors: string[] = [];

beforeAll(async () => {
  const b = Bun.spawnSync(["bun", join(ROOT, "scripts", "build-ui.ts")]);
  if (b.exitCode !== 0) throw new Error("UI build failed: " + b.stderr.toString());
  h = await boot();
  await seedReference(h.url, h.adminToken);
  const mock = (await h.api("owner", "GET", `/api/v1/connections?filter=${encodeURIComponent('name = "Mock"')}`)).body.data[0];
  const judge = await create(h, "contenders", { name: "Mock Judge (toasts)", connection: mock.id, model: "mock-steady", config: { mock: { behaviour: "steady" } } });
  const ws = (await h.api("owner", "GET", "/api/v1/workspaces?perPage=50&sort=created")).body.data[0];
  expect((await h.api("owner", "PATCH", `/api/v1/workspaces/${ws.id}`, { judge_contender: judge.id, default_judge: "ai" })).status).toBe(200);
  const roles = (await h.api("owner", "GET", "/api/v1/roles?perPage=200")).body.data as any[];
  role = roles.find((r) => r.workspace === ws.id)!;
  other = roles.find((r) => r.workspace !== ws.id)!;

  browser = await chromium.launch();
  p = await (await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true })).newPage();
  p.setDefaultTimeout(30_000);
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.goto(`${h.url}/signin`);
  await p.fill("input[type=email]", OWNER.email);
  await p.fill("input[type=password]", OWNER.password);
  await p.locator("button[type=submit]").click();
  await p.waitForURL((u) => !u.pathname.endsWith("/signin"));
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await h?.cleanup();
  expect(errors).toEqual([]);
});

const open = async (roleId: string) => {
  await p.goto(`${h.url}/runs/new?role=${roleId}`);
  await p.locator("label[for=nr-judge-ai]").waitFor();
};
const taskTitles = () => p.locator("fieldset").first().locator(".check strong").allTextContents();

test("switching to a role with no AI judge shows plain AI, disabled, Me picked, and the new role's tasks", async () => {
  await open(role.id);
  await p.waitForFunction(() => document.querySelector("label[for=nr-judge-ai]")?.textContent === "AI · Mock Judge (toasts)", null, { timeout: 2000 }).catch(() => {});
  expect(await p.locator("label[for=nr-judge-ai]").textContent()).toBe("AI · Mock Judge (toasts)");
  expect(await p.locator("#nr-judge-ai").isChecked()).toBe(true);

  await p.locator("#nr-role").click();
  await p.locator(".dd__opt", { hasText: other.name }).first().click();
  await p.waitForFunction(() => document.querySelector("label[for=nr-judge-ai]")?.textContent === "AI", null, { timeout: 2000 }).catch(() => {});
  expect(await p.locator("label[for=nr-judge-ai]").textContent()).toBe("AI");
  expect(await p.locator("#nr-judge-ai").isDisabled()).toBe(true);
  expect(await p.locator("#nr-judge-me").isChecked()).toBe(true);
  expect(await p.getByText("To let an AI judge, pick one in the").isVisible()).toBe(true);

  const tasks = (await h.api("owner", "GET", `/api/v1/tasks?perPage=200&filter=${encodeURIComponent(`role = "${other.id}"`)}`)).body.data as any[];
  const latest = tasks.filter((t) => !tasks.some((n) => n.previous_version === t.id)).map((t) => t.title).sort();
  await p.waitForTimeout(300);
  expect((await taskTitles()).sort()).toEqual(latest);
  expect(await p.locator("fieldset").first().locator("input:checked").count()).toBe(latest.length);
});

test("a run that can't start shows a toast: read out, closable, above the phone tab bar, nothing inline", async () => {
  await p.route("**/runs/preview", (r) => r.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "This run can't start (test)." }) }));
  await open(other.id);
  await p.locator("fieldset").nth(1).locator(".check").first().click();
  const t = p.locator("#toaster .toast[data-tone=error]", { hasText: "This run can't start (test)." });
  await t.waitFor();
  expect(await t.getAttribute("role")).toBe("alert");
  expect(await p.locator("form .notice[data-state=error]").count()).toBe(0);
  // Shown once per reason, not on every change.
  await p.locator("fieldset").nth(1).locator(".check").nth(1).click();
  await p.waitForTimeout(600);
  expect(await p.locator("#toaster .toast[data-tone=error]:not(.is-leaving)").count()).toBe(1);
  // Sits above the bottom tab bar and fits the screen.
  const box = (await t.boundingBox())!, nav = (await p.locator(".bottom-nav").boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(nav.y);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(375);
  // Stays while you read it (a done toast goes after 3 s), then the close button takes it away.
  await p.waitForTimeout(3500);
  expect(await t.isVisible()).toBe(true);
  await t.getByRole("button", { name: "Dismiss" }).click();
  await t.waitFor({ state: "detached" });
  await p.unroute("**/runs/preview");
});

test("pressing Start run when the server refuses shows the reason as a toast", async () => {
  const refuse = /\/runs(\?.*)?$/;
  await p.route(refuse, (r) => r.request().method() !== "POST" ? r.continue() : r.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "Nope, not now (test)." }) }));
  await open(other.id);
  await p.locator("fieldset").nth(1).locator(".check").first().click();
  await p.locator("#start-run").click();
  await p.locator("#toaster .toast[data-tone=error]", { hasText: "Nope, not now (test)." }).waitFor();
  expect(new URL(p.url()).pathname.endsWith("/runs/new")).toBe(true);
  await p.unroute(refuse);
});
