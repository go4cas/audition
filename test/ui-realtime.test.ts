// PLATFORM-UPGRADES B3: the run page follows a live run through Vaultbase's
// realtime events, and falls back to polling GET /api/custom/runs/:id every
// 2 seconds when the realtime connection is down.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { boot, type Harness } from "./harness.ts";
import { ROOT } from "../scripts/lib/vaultbase.ts";
import { seedReference } from "../seed/reference.ts";

const APP = "";
let h: Harness, browser: Browser;
const errors: string[] = [];

beforeAll(async () => {
  const b = Bun.spawnSync(["bun", join(ROOT, "scripts", "build-ui.ts")]);
  if (b.exitCode !== 0) throw new Error("UI build failed: " + b.stderr.toString());
  h = await boot();
  await seedReference(h.url, h.adminToken);
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await h?.cleanup();
});

async function data(method: string, path: string, body?: unknown) {
  const r = await h.api("owner", method, path, body);
  expect(r.status, `${method} ${path}: ${JSON.stringify(r.body)}`).toBe(200);
  return r.body.data;
}
const list = (c: string, filter: string) => data("GET", `/api/v1/${c}?perPage=200&filter=${encodeURIComponent(filter)}`);

/** A copy-and-paste run judged by the owner: every output waits, nothing moves on its own. */
async function startHandoffRun() {
  const role = (await list("roles", `name = "Researcher"`))[0];
  const tasks = await list("tasks", `role = "${role.id}"`);
  const manual = (await list("connections", `provider = "manual"`))[0];
  const contender = (await list("contenders", `connection = "${manual.id}"`))[0];
  expect(tasks.length).toBeGreaterThanOrEqual(2);
  const r = await data("POST", "/api/custom/runs", { role: role.id, tasks: tasks.map((t: any) => t.id), contenders: [contender.id], judge: "me" });
  return { run: r.run.id as string, total: tasks.length };
}

/** Paste one output and give it stars, through the REST API like the UI does. */
async function pasteAndJudgeOne(run: string) {
  const a = (await list("attempts", `run = "${run}" && status = "waiting"`))[0];
  await data("PATCH", `/api/v1/attempts/${a.id}`, { output: "Pasted output", tokens_in: 10, tokens_out: 20, duration_ms: 1000, status: "submitted" });
  const blind = await data("GET", `/api/custom/judging/${run}/${a.task}`);
  const scores = Object.fromEntries(blind.rubric.map((c: any) => [c.name, { stars: 4, reason: "test" }]));
  await data("POST", "/api/v1/verdicts", { attempt: a.id, scores });
}

/** The owner's page on the run, counting its reads of the run route. */
async function openRun(run: string, opts: { blockRealtime?: boolean } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript((t) => localStorage.setItem("audition.token", t), h.ownerToken);
  const p: Page = await ctx.newPage();
  p.setDefaultTimeout(30_000);
  p.on("pageerror", (e) => errors.push(String(e)));
  if (opts.blockRealtime) await p.routeWebSocket(/\/realtime$/, (ws) => ws.close());
  const reads = { n: 0 };
  p.on("request", (r) => { if (new URL(r.url()).pathname === `/api/custom/runs/${run}`) reads.n++; });
  await p.goto(`${h.url}${APP}/runs/${run}`);
  await p.getByText("Live").first().waitFor();
  return { p, reads, close: () => ctx.close() };
}
const judgedText = (n: number, total: number) => `${n} of ${total} outputs judged`;

test("the run page updates from realtime events, without polling", async () => {
  const { run, total } = await startHandoffRun();
  const { p, reads, close } = await openRun(run);
  try {
    await p.locator('[data-live="realtime"]').waitFor();
    await p.getByText(judgedText(0, total)).waitFor();
    // Connected and caught up: no reads while nothing changes.
    await p.waitForTimeout(1000);
    const quiet = reads.n;
    await p.waitForTimeout(4500);
    expect(reads.n).toBe(quiet);
    // A change on the server reaches the page well inside one polling period.
    const t0 = Date.now();
    await pasteAndJudgeOne(run);
    await p.getByText(judgedText(1, total)).waitFor({ timeout: 5000 });
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(reads.n).toBeGreaterThan(quiet);
  } finally {
    await close();
  }
  expect(errors).toEqual([]);
}, 90_000);

test("with realtime down, the run page falls back to polling every 2 seconds", async () => {
  const { run, total } = await startHandoffRun();
  const { p, reads, close } = await openRun(run, { blockRealtime: true });
  try {
    await p.locator('[data-live="polling"]').waitFor();
    const before = reads.n;
    await p.waitForTimeout(4500);
    expect(reads.n - before).toBeGreaterThanOrEqual(2);
    await pasteAndJudgeOne(run);
    await p.getByText(judgedText(1, total)).waitFor({ timeout: 6000 });
    expect(await p.locator('[data-live="realtime"]').count()).toBe(0);
  } finally {
    await close();
  }
  expect(errors).toEqual([]);
}, 90_000);
