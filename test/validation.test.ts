// The validation hooks of TECH-SPEC §6, and the pure checks behind them.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { boot, create, fixtures, RUBRIC, type Harness } from "./harness.ts";
import { fitnessWeightsError, normaliseContenderConfig, rubricError } from "../vb_hooks/lib/validation.ts";

describe("pure checks", () => {
  test("rubric: 1 to 8 criteria, unique names, whole weights summing to 100", () => {
    expect(rubricError(RUBRIC)).toBeNull();
    expect(rubricError(JSON.stringify(RUBRIC))).toBeNull();
    expect(rubricError([{ name: "A", weight: 60 }, { name: "B", weight: 30 }])).toContain("add up to 100");
    expect(rubricError([{ name: "A", weight: 60 }, { name: "a", weight: 40 }])).toContain("Two criteria");
    expect(rubricError([{ name: "A", weight: 50.5 }, { name: "B", weight: 49.5 }])).toContain("whole number");
    expect(rubricError([])).toContain("1 to 8");
    expect(rubricError(Array.from({ length: 9 }, (_, i) => ({ name: `C${i}`, weight: i === 0 ? 92 : 1 })))).toContain("1 to 8");
    expect(rubricError([{ name: " ", weight: 100 }])).toContain("name");
    expect(rubricError("nope")).toContain("list");
  });
  test("fitness weights: quality, tokens, time summing to 100", () => {
    expect(fitnessWeightsError({ quality: 70, tokens: 20, time: 10 })).toBeNull();
    expect(fitnessWeightsError({ quality: 70, tokens: 20, time: 20 })).toContain("add up to 100");
    expect(fitnessWeightsError({ quality: 100, tokens: 0 })).toContain("time");
    expect(fitnessWeightsError({ quality: 100, tokens: 0, time: 0, cost: 0 })).toContain("Unknown");
  });
  test("contender config: Anthropic drops temperature (F8); effort is checked", () => {
    const a = normaliseContenderConfig({ effort: "high", temperature: 0.6 }, "anthropic");
    expect(a).toEqual({ config: { effort: "high" } });
    expect(normaliseContenderConfig({ temperature: 0.6 }, "openai-compatible")).toEqual({ config: { temperature: 0.6 } });
    expect(normaliseContenderConfig({ effort: "extreme" }, "anthropic")).toHaveProperty("error");
    expect(normaliseContenderConfig({ mock: { behaviour: "steady" } }, "anthropic")).toHaveProperty("error");
    expect(normaliseContenderConfig({ mock: { behaviour: "nope" } }, "mock")).toHaveProperty("error");
  });
});

describe("hooks on a running instance", () => {
  let h: Harness;
  let f: Awaited<ReturnType<typeof fixtures>>;
  beforeAll(async () => { h = await boot(); f = await fixtures(h); });
  afterAll(async () => { await h?.cleanup(); });

  test("rubric weights must sum to 100", async () => {
    const bad = await h.api("owner", "POST", "/api/v1/roles", { workspace: f.workspace.id, name: "Bad", rubric: [{ name: "A", weight: 90 }] });
    expect(bad.status).toBe(422);
    expect(JSON.stringify(bad.body)).toContain("add up to 100");
    const fix = await h.api("owner", "PATCH", `/api/v1/roles/${f.role.id}`, { rubric: [{ name: "A", weight: 50 }, { name: "B", weight: 40 }] });
    expect(fix.status).toBe(422);
    expect((await h.api("owner", "PATCH", `/api/v1/roles/${f.role.id}`, { rubric: [{ name: "A", weight: 50 }, { name: "B", weight: 50 }] })).status).toBe(200);
  });

  test("workspace defaults: judge me, 5 outputs, quality only", () => {
    expect(f.workspace.default_judge).toBe("me");
    expect(f.workspace.min_outputs).toBe(5);
    expect(f.workspace.fitness_weights).toEqual({ quality: 100, tokens: 0, time: 0 });
  });

  test("an AI default judge needs a judge contender", async () => {
    expect((await h.api("owner", "POST", "/api/v1/workspaces", { name: "AI ws", default_judge: "ai" })).status).toBe(422);
    expect((await h.api("owner", "POST", "/api/v1/workspaces", { name: "AI ws", default_judge: "ai", judge_contender: f.contender.id })).status).toBe(200);
  });

  test("fitness weights must sum to 100", async () => {
    expect((await h.api("owner", "PATCH", `/api/v1/workspaces/${f.workspace.id}`, { fitness_weights: { quality: 80, tokens: 0, time: 0 } })).status).toBe(422);
  });

  test("role defaults and group check", async () => {
    expect(f.role.pass_mark).toBe(3.5);
    expect(f.role.default_output_type).toBe("text");
    const other = await create(h, "workspaces", { name: "Other ws" });
    const otherGroup = await create(h, "groups", { workspace: other.id, name: "Elsewhere" });
    const r = await h.api("owner", "POST", "/api/v1/roles", { workspace: f.workspace.id, group: otherGroup.id, name: "X", rubric: RUBRIC });
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.body)).toContain("another workspace");
  });

  test("a role with runs can't be deleted", async () => {
    const role = await create(h, "roles", { workspace: f.workspace.id, name: "Has runs", rubric: RUBRIC });
    await h.store("insert", "runs", { workspace: f.workspace.id, role: role.id, judge: "me", status: "done" });
    // the restrict relation (runs.role) answers 409 even before the hook does
    expect((await h.api("owner", "DELETE", `/api/v1/roles/${role.id}`)).status).toBeOneOf([409, 422]);
    const free = await create(h, "roles", { workspace: f.workspace.id, name: "No runs", rubric: RUBRIC });
    expect((await h.api("owner", "DELETE", `/api/v1/roles/${free.id}`)).status).toBeOneOf([200, 204]);
  });

  test("tasks take the role's default output type", () => {
    expect(f.task.output_type).toBe("text");
  });

  test("contenders: mode follows the connection, api needs a model, defaults apply", async () => {
    expect(f.contender.mode).toBe("api");
    expect(f.contender.max_output_tokens).toBe(16000);
    expect(f.contender.enabled).toBe(true);
    expect(f.contender.group).toBe("mock-steady");
    expect(f.handoff.mode).toBe("handoff");
    expect((await h.api("owner", "POST", "/api/v1/contenders", { name: "Wrong mode", connection: f.manual.id, mode: "api", model: "x" })).status).toBe(422);
    expect((await h.api("owner", "POST", "/api/v1/contenders", { name: "No model", connection: f.mock.id })).status).toBe(422);
    expect((await h.api("owner", "POST", "/api/v1/contenders", { name: "Runner", connection: f.mock.id, mode: "runner", model: "m" })).status).toBe(422);
  });

  test("Anthropic contenders lose temperature (F8)", async () => {
    const conn = await create(h, "connections", { name: "Anthropic", provider: "anthropic" });
    const c = await create(h, "contenders", { name: "Opus 5.5 high", connection: conn.id, model: "claude-opus-5-5", config: { effort: "high", temperature: 0.6 } });
    expect(c.config).toEqual({ effort: "high" });
  });

  test("OpenAI-compatible connections need a base URL", async () => {
    expect((await h.api("owner", "POST", "/api/v1/connections", { name: "OAI", provider: "openai-compatible" })).status).toBe(422);
    expect((await h.api("owner", "POST", "/api/v1/connections", { name: "OAI", provider: "openai-compatible", base_url: "https://api.example.com/v1" })).status).toBe(200);
  });

  test("a coding task's repo reference needs a repo and a commit", async () => {
    expect((await h.api("owner", "POST", "/api/v1/tasks", { role: f.role.id, title: "Code", prompt: "<p>x</p>", base_ref: { repo: "github.com/x/y" } })).status).toBe(422);
  });
  // Vaultbase 0.44 answers 400 to unknown body keys on create and update
  // (they used to be ignored). A record the UI fetched and saves back as it
  // came, system fields included, must still be accepted.
  test("a fetched record saved back as it came is accepted (0.44 unknown-key check)", async () => {
    const got = (await h.api("owner", "GET", `/api/v1/contenders/${f.contender.id}`)).body.data;
    const r = await h.api("owner", "PATCH", `/api/v1/contenders/${f.contender.id}`, { ...got, name: "Saved back" });
    expect(r.status).toBe(200);
    expect(r.body.data.name).toBe("Saved back");
    expect((await h.api("owner", "PATCH", `/api/v1/contenders/${f.contender.id}`, { not_a_field: 1 })).status).toBe(400);
  });
});
