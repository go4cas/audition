// The "Who judges" switch on Start a run (bug found Nov 25, 2026). Picking a
// role whose workspace lets the AI judge set the radio to AI, but the sliding
// thumb stayed on "Me", so the next click on "Me" looked like it did nothing.
// The thumb must always sit on the checked option, whoever changed it.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { boot, create, OWNER, type Harness } from "./harness.ts";
import { ROOT } from "../scripts/lib/vaultbase.ts";
import { seedReference } from "../seed/reference.ts";

let h: Harness, browser: Browser, p: Page;
let role: Record<string, any>;
const errors: string[] = [];

beforeAll(async () => {
  const b = Bun.spawnSync(["bun", join(ROOT, "scripts", "build-ui.ts")]);
  if (b.exitCode !== 0) throw new Error("UI build failed: " + b.stderr.toString());
  h = await boot();
  await seedReference(h.url, h.adminToken);
  const mock = (await h.api("owner", "GET", `/api/v1/connections?filter=${encodeURIComponent('name = "Mock"')}`)).body.data[0];
  const judge = await create(h, "contenders", { name: "Mock Judge (test)", connection: mock.id, model: "mock-steady", config: { mock: { behaviour: "steady" } } });
  const ws = (await h.api("owner", "GET", "/api/v1/workspaces?perPage=50&sort=created")).body.data[0];
  expect((await h.api("owner", "PATCH", `/api/v1/workspaces/${ws.id}`, { judge_contender: judge.id, default_judge: "ai" })).status).toBe(200);
  role = (await h.api("owner", "GET", `/api/v1/roles?perPage=1&filter=${encodeURIComponent(`workspace = "${ws.id}"`)}`)).body.data[0];

  browser = await chromium.launch();
  p = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
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

/** Which option is checked, and which label the thumb sits on, for one segmented control. */
const segState = (name: string) => p.evaluate((n) => {
  const seg = document.querySelector(`input[name="${n}"]`)!.closest(".seg")!;
  const checked = seg.querySelector("input:checked") as HTMLInputElement | null;
  const x = parseFloat((seg.querySelector(".seg__thumb") as HTMLElement | null)?.style.getPropertyValue("--x") ?? "NaN");
  const under = [...seg.querySelectorAll("label")].find((l) => (l as HTMLElement).offsetLeft === x);
  return { checked: checked?.value ?? null, thumb: under ? (seg.querySelector("#" + under.getAttribute("for")) as HTMLInputElement).value : null };
}, name);
const expectSeg = async (name: string, value: string) => {
  await p.waitForFunction(([n, v]) => {
    const seg = document.querySelector(`input[name="${n}"]`)?.closest(".seg");
    const label = seg?.querySelector(`label[for="${n}-${v}"]`) as HTMLElement | null;
    const thumb = seg?.querySelector(".seg__thumb") as HTMLElement | null;
    return !!label && !!thumb && parseFloat(thumb.style.getPropertyValue("--x")) === label.offsetLeft;
  }, [name, value], { timeout: 2000 }).catch(() => {});
  expect(await segState(name)).toEqual({ checked: value, thumb: value });
};
const open = async (roleId: string) => {
  await p.goto(`${h.url}/runs/new?role=${roleId}`);
  await p.waitForSelector("#main section:not(.is-loading)", { state: "attached" });
  await p.locator("label[for=nr-judge-ai]").waitFor();
};

test("with AI as the workspace default, one click on Me picks Me, and AI picks AI again", async () => {
  await open(role.id);
  await expectSeg("nr-judge", "ai");
  await p.locator("label[for=nr-judge-me]").click();
  await expectSeg("nr-judge", "me");
  await p.locator("label[for=nr-judge-ai]").click();
  await expectSeg("nr-judge", "ai");
});

test("after picking a role whose workspace lets the AI judge, the thumb is on AI and one click on Me picks Me", async () => {
  const roles = (await h.api("owner", "GET", `/api/v1/roles?perPage=200`)).body.data as any[];
  const other = roles.find((r) => r.workspace !== role.workspace)!;
  await open(other.id);
  await expectSeg("nr-judge", "me");
  await p.locator("#nr-role").click();
  await p.locator(".dd__opt", { hasText: role.name }).first().click();
  await expectSeg("nr-judge", "ai");
  await p.locator("label[for=nr-judge-me]").click();
  await expectSeg("nr-judge", "me");
});
