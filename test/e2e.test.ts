// T5 end to end (TECH-SPEC §15 T5, Done-when 1): every seeded reference
// workspace goes through tasks → runs → judging → casting against the mock,
// through the same owner routes the UI uses. The test has no workspace-specific
// code path: it reads each workspace's own judge, roles, rubrics and output
// types from the API and does the same thing for all of them. It names no
// workspace either; the last test checks that for the app's code.
// A workspace whose seed lists its own contenders (the spec's table) is also
// run with exactly those: one API contender, or copy-and-paste contenders only.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { boot, type Harness } from "./harness.ts";
import { until } from "./t3-helpers.ts";
import { WORKSPACES, seedReference } from "../seed/reference.ts";
import { testImage } from "../vb_hooks/lib/png.ts";
import { qualityMarker } from "../vb_hooks/lib/providers/mock.ts";

type Rec = Record<string, any>;

let h: Harness;
let contenders: Rec[];
let connections: Map<string, Rec>;

beforeAll(async () => {
  h = await boot();
  await seedReference(h.url, h.adminToken);
  contenders = await list("contenders");
  connections = new Map((await list("connections")).map((c) => [c.id, c]));
}, 120_000);
afterAll(async () => { await h?.cleanup(); });

/**
 * An owner API call that waits out Vaultbase's default rate limit (60 creates
 * per 5 s) as any client would: on 429 it sleeps for Retry-After and tries again.
 * The end-to-end runs make more creates than a person would, in bursts.
 */
async function api(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  for (let i = 0; ; i++) {
    const r = await h.api("owner", method, path, body);
    if (r.status !== 429 || i >= 10) return r;
    await Bun.sleep(1000);
  }
}

async function list(collection: string, filter = ""): Promise<Rec[]> {
  const r = await api("GET", `/api/v1/${collection}?perPage=200${filter ? `&filter=${encodeURIComponent(filter)}` : ""}`);
  expect(r.status, `list ${collection}`).toBe(200);
  return r.body.data;
}

/** A custom route's `{ data }`, failing the test with the body on any non-200. */
async function route(method: string, path: string, body?: unknown): Promise<any> {
  const r = await api(method, path, body);
  expect(r.status, `${method} ${path}: ${JSON.stringify(r.body)}`).toBe(200);
  return r.body.data;
}

const behaviour = (c: Rec): string | undefined => c.config?.mock?.behaviour;
const byBehaviour = (b: string) => contenders.find((c) => behaviour(c) === b)!;
const handoffContender = () => contenders.find((c) => connections.get(c.connection)?.provider === "manual")!;

/** The contenders a role is tried with: by output type, never by workspace. */
function castFor(role: Rec): Rec[] {
  const api = role.default_output_type === "image" ? [byBehaviour("image")] : [byBehaviour("steady"), byBehaviour("erratic")];
  return [...api, handoffContender()];
}

/** How the owner rates an output when judging by hand: the mock's own quality, else 3 stars. */
const starsFor = (output: string) => qualityMarker(output) ?? 3;

/**
 * Paste every waiting handoff output. `rate` is the stars the owner will give a
 * contender's pasted output, written into it as the mock's quality marker; by
 * default nothing is written and the owner gives 3 stars.
 */
async function pasteHandoffOutputs(runId: string, tasks: Rec[], rate?: (contenderName: string) => number) {
  for (const t of tasks) {
    const handoff = await route("GET", `/api/custom/handoff/${runId}/${t.id}`);
    expect(handoff.prompt).toContain(t.title);
    for (const w of handoff.waiting) {
      if (t.output_type === "image") {
        const form = new FormData();
        form.append("file", new File([testImage(1)], "result.png", { type: "image/png" }));
        const up = await fetch(`${h.url}/api/custom/files/attempts/${w.attempt}/output_files`, {
          method: "POST", headers: { authorization: `Bearer ${h.ownerToken}` }, body: form,
        });
        expect(up.status, await up.clone().text()).toBe(200);
      }
      const r = await api("PATCH", `/api/v1/attempts/${w.attempt}`, {
        output: `Pasted from another tool for: ${t.title}${rate ? `\n\n[[mock-quality:${rate(w.contender_name)}]]` : ""}`, tokens_in: 900, tokens_out: 400, duration_ms: 30_000, status: "submitted",
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    }
  }
}

async function judgeByHand(runId: string, tasks: Rec[]) {
  for (const t of tasks) {
    const blind = await route("GET", `/api/custom/judging/${runId}/${t.id}`);
    expect(blind.outputs.length).toBeGreaterThan(0);
    for (const o of blind.outputs) {
      if (o.verdict) continue;
      const stars = starsFor(o.output);
      const scores = Object.fromEntries(blind.rubric.map((c: Rec) => [c.name, { stars, reason: "e2e" }]));
      const r = await api("POST", "/api/v1/verdicts", { attempt: o.attempt, scores });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    }
  }
}

/** One run from start to done: API outputs generate, handoff outputs are pasted, then judging. */
async function driveRun(runId: string, tasks: Rec[], judge: string, rate?: (contenderName: string) => number) {
  await until(async () => {
    const v = await route("GET", `/api/custom/runs/${runId}`);
    return v.counts.queued === 0 && v.counts.in_progress === 0;
  }, `run ${runId} to generate`, 30_000);
  await pasteHandoffOutputs(runId, tasks, rate);
  if (judge === "me") {
    await until(async () => (await route("GET", `/api/custom/runs/${runId}`)).run.status === "judging", `run ${runId} to wait for judging`);
    await judgeByHand(runId, tasks);
  }
  const done = await until(async () => {
    const v = await route("GET", `/api/custom/runs/${runId}`);
    return v.run.status === "done" ? v : null;
  }, `run ${runId} to be done`, 45_000);
  // Nothing was left behind: every output was made and judged.
  expect(done.counts.failed).toBe(0);
  expect(done.counts.judged).toBe(done.attempts.length);
  await checkHistory(runId, done.attempts);
}

/**
 * Record history (docs/PLATFORM-UPGRADES.md part B): server writes go through
 * the records API, so the run's status changes and each output's way to
 * "judged" are in Vaultbase's record history, the server's writes as system.
 */
async function checkHistory(runId: string, attempts: Rec[]) {
  const historyOf = async (c: string, id: string) => {
    const r = await h.api("admin", "GET", `/api/v1/${c}/${id}/history`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body.data.data as Rec[];
  };
  const run = await historyOf("runs", runId);
  const runStatuses = new Set(run.map((e) => e.snapshot?.status));
  expect(runStatuses.has("running") && runStatuses.has("done"), [...runStatuses].join(",")).toBe(true);
  for (const e of run) expect(e.actor_type).toBeNull();
  // One output of each mode: a history call per output would hit the API rate limit.
  const sample = ["api", "handoff"].map((m) => attempts.find((a) => a.mode === m)).filter(Boolean) as Rec[];
  for (const a of sample) {
    const steps = await historyOf("attempts", a.id);
    const statuses = new Set(steps.map((e) => e.snapshot?.status));
    expect(statuses.has("judged"), `${a.mode} attempt: ${[...statuses].join(",")}`).toBe(true);
    if (a.mode === "api") {
      expect(statuses.has("submitted")).toBe(true);
      // The worker's claim goes through the records API too (Vaultbase 0.48 { filter }).
      expect(statuses.has("in_progress"), [...statuses].join(",")).toBe(true);
      for (const e of steps) expect(e.actor_type).toBeNull();
    } else {
      // The owner's own submit is the one write made as the owner.
      expect(steps.filter((e) => e.actor_type === "user").map((e) => e.snapshot?.status)).toContain("submitted");
    }
  }
}

/** The workspace seeded i-th, in creation order. */
async function workspaceAt(i: number): Promise<Rec> {
  return (await list("workspaces", "")).sort((a, b) => a.created - b.created || a.id.localeCompare(b.id))[i]!;
}

/**
 * Tasks → runs → judging → casting for one role with the given contenders.
 * Outputs a contender already had (from an earlier test) are counted first, so
 * the leaderboard check holds whatever ran before.
 */
async function castRole(ws: Rec, role: Rec, cast: Rec[], opts: { addTask: boolean; rate?: (contenderName: string) => number }) {
  const judge = ws.default_judge as string;
  if (opts.addTask) {
    // Tasks: the seeded ones, plus one the owner adds now.
    const created = await api("POST", "/api/v1/tasks", {
      role: role.id, title: `A new task for the ${role.name}`, prompt: `<p>Another task for the ${role.name}, written during the end-to-end test.</p>`,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    expect(created.body.data.output_type).toBe(role.default_output_type);
  }
  const tasks = await list("tasks", `role = "${role.id}"`);
  expect(tasks.length).toBeGreaterThanOrEqual(opts.addTask ? 2 : 1);
  const handoffs = cast.filter((c) => connections.get(c.connection)?.provider === "manual").length;
  const body = { role: role.id, tasks: tasks.map((t) => t.id), contenders: cast.map((c) => c.id), judge };
  const before = await route("GET", `/api/custom/leaderboard/${role.id}`);
  const had = (id: string) => before.rows.find((r: Rec) => r.contender === id)?.n ?? 0;

  // The preview counts what the run will cost before it starts.
  const preview = await route("POST", "/api/custom/runs/preview", body);
  expect(preview.outputs).toBe(tasks.length * cast.length);
  expect(preview.handoff_outputs).toBe(tasks.length * handoffs);

  // Runs: the first, then Run again until every contender has the workspace minimum.
  const runsNeeded = Math.ceil(ws.min_outputs / tasks.length);
  let run = (await route("POST", "/api/custom/runs", body)).run;
  expect(run.call_count).toBe(preview.total_provider_calls);
  await driveRun(run.id, tasks, judge, opts.rate);
  for (let n = 1; n < runsNeeded; n++) {
    const again = (await route("POST", `/api/custom/runs/${run.id}/again`)).run;
    expect(again.rerun_of).toBe(run.id);
    run = again;
    await driveRun(run.id, tasks, judge, opts.rate);
  }

  // Tasks and contenders used are locked now.
  for (const t of tasks) expect((await route("GET", `/api/v1/tasks/${t.id}`)).locked).toBe(true);

  // Judging was by the workspace's own judge.
  // Rubric verdicts: a role that checks outcomes also gets one outcome check per output (Phase 2a).
  const verdicts = await list("verdicts", `run = "${run.id}" && status = "active" && method = "rubric"`);
  expect(verdicts.length).toBe(tasks.length * cast.length);
  for (const v of verdicts) expect(v.judge_kind).toBe(judge === "ai" ? "ai" : "human");

  // Casting: the leaderboard suggests a champion with enough outputs, and the owner confirms it.
  const board = await route("GET", `/api/custom/leaderboard/${role.id}`);
  for (const c of cast) expect(board.rows.find((r: Rec) => r.contender === c.id)?.n).toBe(had(c.id) + tasks.length * runsNeeded);
  expect(board.suggested, `a suggested champion for role ${role.id}`).toBeTruthy();
  const champ = board.rows.find((r: Rec) => r.contender === board.suggested);
  expect(champ.qualifies).toBe(true);
  expect(champ.mean_score).toBeGreaterThan(role.pass_mark);
  const { casting } = await route("POST", "/api/custom/castings", { role: role.id, contender: board.suggested, rationale: "Best fitness in the end-to-end test." });
  expect(casting.suggested_by).toBe("system");
  const after = await route("GET", `/api/custom/leaderboard/${role.id}`);
  expect(after.casting?.contender).toBe(board.suggested);
  return { board, cast };
}

// The spec's table gives some workspaces their own contenders (SPEC "Reference
// workspaces"): one API contender, or copy-and-paste contenders only. Run each
// such workspace with exactly those, read from the seed, never by name. These
// run first, so the role has no other contender's outputs yet.
for (const [i, def] of WORKSPACES.entries()) {
  if (!def.contenders) continue;
  test(`reference workspace ${i + 1}: runs with only its own ${def.contenders.length} contender(s)`, async () => {
    const ws = await workspaceAt(i);
    const own = def.contenders!.map((name) => contenders.find((c) => c.name === name)!);
    expect(own.every(Boolean)).toBe(true);
    // The owner rates the first pasted contender 4 stars and the rest 3, so a
    // copy-and-paste-only role still has a champion above the pass mark.
    const first = own[0]!.name;
    const rate = (name: string) => (name === first ? 4 : 3);
    const roles = await list("roles", `workspace = "${ws.id}"`);
    for (const role of roles) {
      const { board } = await castRole(ws, role, own, { addTask: false, rate });
      if (own.length === 1) expect(board.suggested).toBe(own[0]!.id);
      if (own.every((c) => connections.get(c.connection)?.provider === "manual")) expect(board.suggested).toBe(own[0]!.id);
    }
  }, 300_000);
}

for (const [i] of WORKSPACES.entries()) {
  test(`reference workspace ${i + 1}: tasks → runs → judging → casting, against the mock`, async () => {
    const ws = await workspaceAt(i);
    const roles = await list("roles", `workspace = "${ws.id}"`);
    expect(roles.length).toBeGreaterThan(0);
    await Promise.all(roles.map((role) => castRole(ws, role, castFor(role), { addTask: true })));
  }, 300_000);
}

// Done-when 1, second half: no workspace name appears in the app's code.
// seed/ holds the reference content; tests that check that content may name it.
test("no reference workspace name appears outside seed/ in the app's code", () => {
  const root = join(import.meta.dir, "..");
  const dirs = ["vb_hooks", "ui/src", "ui/index.html", "scripts", "test/e2e.test.ts"];
  const names = WORKSPACES.map((w) => w.name);
  const hits: string[] = [];
  const walk = (p: string) => {
    const s = statSync(p);
    if (s.isDirectory()) { for (const e of readdirSync(p)) walk(join(p, e)); return; }
    const text = readFileSync(p, "utf8");
    for (const n of names) if (text.includes(n)) hits.push(`${relative(root, p)}: ${n}`);
  };
  for (const d of dirs) { try { walk(join(root, d)); } catch (e: any) { if (e.code !== "ENOENT") throw e; } }
  expect(hits).toEqual([]);
});
