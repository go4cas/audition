// The Composer utility role on a fresh Vaultbase (TECH-SPEC §9a): the
// workspace's Composer writes a task's prompt in the background, the owner
// can edit it, every contender of a run gets it instead of the generic
// prompt, and the guards (no Composer, locked task, still composing, the
// owner can't set the status) hold. Mock provider only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { boot, create, fixtures, type Harness } from "./harness.ts";
import { GENERIC_TEMPLATE } from "../seed/reference.ts";
import { COMPOSER_SCHEMA, COMPOSER_SYSTEM, composerBrief, parseComposerReply } from "../vb_hooks/lib/composer.ts";
import { generate } from "../vb_hooks/lib/providers/mock.ts";
import { sfx, until } from "./t3-helpers.ts";

describe("pure parts", () => {
  test("the reply is JSON {prompt}, fenced JSON, or plain text", () => {
    expect(parseComposerReply('{"prompt":"  Do it well.  "}')).toBe("Do it well.");
    expect(parseComposerReply('```json\n{"prompt":"Fenced"}\n```')).toBe("Fenced");
    expect(parseComposerReply("Just a prompt.")).toBe("Just a prompt.");
    expect(parseComposerReply("  ")).toBe("");
  });
  test("the system prompt keeps the task's scope and the WHEN DONE line", () => {
    expect(COMPOSER_SYSTEM).toContain("do not add requirements");
    expect(COMPOSER_SYSTEM).toContain("WHEN DONE line");
    expect(COMPOSER_SCHEMA.required).toEqual(["prompt"]);
  });
  test("the mock Composer keeps the plain prompt and its last line, and adds a block", async () => {
    const plain = "You are acting as: Researcher.\n\nTASK: Compare\nCompare three options.\n\nWHEN DONE, reply with your answer only.";
    const r = await generate({ model: "m", config: { mock: { behaviour: "steady" } }, maxOutputTokens: 100, system: COMPOSER_SYSTEM, prompt: composerBrief(plain), attachments: [], outputSchema: COMPOSER_SCHEMA, seed: "s" });
    const p = parseComposerReply(r.text);
    expect(p.startsWith("You are acting as: Researcher.")).toBe(true);
    expect(p).toContain("HOW TO DO WELL");
    expect(p.endsWith("WHEN DONE, reply with your answer only.")).toBe(true);
    await expect(generate({ model: "m", config: { mock: { behaviour: "fail" } }, maxOutputTokens: 100, prompt: composerBrief(plain), attachments: [], outputSchema: COMPOSER_SCHEMA, seed: "s" })).rejects.toThrow();
  });
});

let h: Harness;
let f: Awaited<ReturnType<typeof fixtures>>;
let composer: Record<string, any>;

const compose = (taskId: string, as: "owner" | "admin" | "anon" = "owner") => h.api(as, "POST", `/api/custom/tasks/${taskId}/compose`);
const task = async (id: string) => (await h.api("owner", "GET", `/api/v1/tasks/${id}`)).body.data;
const settled = (id: string) => until(async () => { const t = await task(id); return t.compose?.status !== "composing" ? t : null; }, "the Composer to finish");

beforeAll(async () => {
  h = await boot();
  await create(h, "handoff_templates", GENERIC_TEMPLATE, "admin");
  f = await fixtures(h);
  composer = await create(h, "contenders", { name: `Mock Composer ${sfx()}`, connection: f.mock.id, model: "mock-steady", config: { mock: { behaviour: "steady" } }, price_in_per_mtok: 3, price_out_per_mtok: 15 });
});
afterAll(async () => { await h?.cleanup(); });

describe("on a server", () => {
  test("without a Composer in the workspace, Compose says where to pick one", async () => {
    const r = await compose(f.task.id);
    expect(r.status).toBe(422);
    expect(r.body.error).toContain("workspace settings");
  });

  test("a copy-and-paste contender can't be the Composer", async () => {
    await h.api("owner", "PATCH", `/api/v1/workspaces/${f.workspace.id}`, { composer_contender: f.handoff.id });
    const r = await compose(f.task.id);
    expect(r.status).toBe(422);
    expect(r.body.error).toContain("Audition can call");
  });

  test("Compose marks the task composing, then the draft lands with its tokens and cost", async () => {
    expect((await h.api("owner", "PATCH", `/api/v1/workspaces/${f.workspace.id}`, { composer_contender: composer.id })).status).toBe(200);
    const r = await compose(f.task.id);
    expect(r.status).toBe(200);
    expect(r.body.data.task.compose.status).toBe("composing");
    expect(r.body.data.task.compose.contender).toBe(composer.id);
    const t = await settled(f.task.id);
    expect(t.compose.status).toBe("done");
    expect(t.compose.tokens_out).toBe(120);
    expect(t.compose.cost).toBeGreaterThan(0);
    expect(t.composed_prompt).toContain("TASK: Compare options");
    expect(t.composed_prompt).toContain("1. Accuracy (60%): Facts are right.");
    expect(t.composed_prompt).toContain("HOW TO DO WELL");
    expect(t.composed_prompt.trim().endsWith("WHEN DONE, reply with your answer only.")).toBe(true);
  });

  test("the owner can edit the composed prompt, but not the Composer's status", async () => {
    const t = await task(f.task.id);
    const edited = t.composed_prompt.replace("HOW TO DO WELL", "HOW TO DO WELL (edited)");
    expect((await h.api("owner", "PATCH", `/api/v1/tasks/${f.task.id}`, { composed_prompt: edited })).status).toBe(200);
    const bad = await h.api("owner", "PATCH", `/api/v1/tasks/${f.task.id}`, { compose: { status: "done", contender: "x", asked_at: 1 } });
    expect(bad.status).toBe(422);
    expect(JSON.stringify(bad.body)).toContain("set by Audition");
    const created = await h.api("owner", "POST", "/api/v1/tasks", { role: f.role.id, title: "Sneaky", prompt: "<p>x</p>", compose: { status: "composing" } });
    expect(created.status).toBe(422);
  });

  test("a run sends the composed prompt to every contender; other tasks keep the generic prompt", async () => {
    const plain = await create(h, "tasks", { role: f.role.id, title: "Plain task", prompt: "<p>Do the plain thing.</p>" });
    const r = await h.api("owner", "POST", "/api/custom/runs", { role: f.role.id, tasks: [f.task.id, plain.id], contenders: [f.contender.id, f.handoff.id], judge: "me" });
    expect(r.status).toBe(200);
    const run = r.body.data.run.id;
    const attempts = (await h.api("owner", "GET", `/api/v1/attempts?filter=${encodeURIComponent(`run = "${run}"`)}`)).body.data;
    const composed = attempts.filter((a: any) => a.task === f.task.id);
    expect(composed.length).toBe(2);
    for (const a of composed) expect(a.prompt_sent).toContain("HOW TO DO WELL (edited)");
    for (const a of attempts.filter((a: any) => a.task === plain.id)) {
      expect(a.prompt_sent).toContain("You will be judged on:");
      expect(a.prompt_sent).not.toContain("HOW TO DO WELL");
    }
  });

  test("a task used in a run can't be composed again, and its prompt can't change", async () => {
    const r = await compose(f.task.id);
    expect(r.status).toBe(409);
    expect((await h.api("owner", "PATCH", `/api/v1/tasks/${f.task.id}`, { composed_prompt: "new" })).status).not.toBe(200);
  });

  test("Duplicate and edit can carry the composed prompt into the next version", async () => {
    const t = await task(f.task.id);
    const v2 = await create(h, "tasks", { role: f.role.id, title: t.title, prompt: t.prompt, previous_version: t.id, composed_prompt: t.composed_prompt });
    expect(v2.composed_prompt).toBe(t.composed_prompt);
    expect(v2.compose).toBeNull();
  });

  test("a run can't start while the Composer is still writing", async () => {
    const t = await create(h, "tasks", { role: f.role.id, title: "Waiting task", prompt: "<p>Wait.</p>" });
    await h.store("update", "tasks", { compose: { status: "composing", contender: composer.id, asked_at: 1 } }, t.id);
    const r = await h.api("owner", "POST", "/api/custom/runs", { role: f.role.id, tasks: [t.id], contenders: [f.contender.id], judge: "me" });
    expect(r.status).toBe(409);
    expect(r.body.error).toContain("still writing");
    expect((await compose(t.id)).status).toBe(409);
  });

  test("a failing Composer leaves the error on the task and the prompt untouched", async () => {
    const failing = await create(h, "contenders", { name: `Mock Fail ${sfx()}`, connection: f.mock.id, model: "mock-fail", config: { mock: { behaviour: "fail" } } });
    expect((await h.api("owner", "PATCH", `/api/v1/workspaces/${f.workspace.id}`, { composer_contender: failing.id })).status).toBe(200);
    const t = await create(h, "tasks", { role: f.role.id, title: "Fails", prompt: "<p>Fails.</p>", composed_prompt: "keep me" });
    expect((await compose(t.id)).status).toBe(200);
    const done = await settled(t.id);
    expect(done.compose.status).toBe("failed");
    expect(done.compose.error).toContain("Mock Fail");
    expect(done.composed_prompt).toBe("keep me");
  });

  test("only the owner may ask", async () => {
    expect((await compose(f.task.id, "anon")).status).toBe(401);
    expect((await compose(f.task.id, "admin")).status).toBe(403);
  });
});
