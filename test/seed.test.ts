// The four reference workspaces seed as written in SPEC, and seeding twice
// creates nothing new.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { boot, type Harness } from "./harness.ts";
import { CONTENDERS, DEMO_REPO, DEMO_COMMIT, WORKSPACES, seedReference } from "../seed/reference.ts";

let h: Harness;
let first: Awaited<ReturnType<typeof seedReference>>;
beforeAll(async () => { h = await boot(); first = await seedReference(h.url, h.adminToken); });
afterAll(async () => { await h?.cleanup(); });

const all = async (c: string, filter = "") =>
  (await h.api("owner", "GET", `/api/v1/${c}?perPage=200${filter ? `&filter=${encodeURIComponent(filter)}` : ""}`)).body.data as Array<Record<string, any>>;

test("the first seed creates everything", () => {
  const roles = WORKSPACES.reduce((n, w) => n + w.roles.length, 0);
  const tasks = WORKSPACES.reduce((n, w) => n + w.roles.reduce((m, r) => m + r.tasks.length, 0), 0);
  const groups = WORKSPACES.reduce((n, w) => n + w.groups.length, 0);
  expect(first.created.length).toBe(1 + 2 + CONTENDERS.length + WORKSPACES.length + groups + roles + tasks);
  expect(first.existing).toBe(0);
});

test("seeding twice creates nothing new", async () => {
  const counts = async () => Object.fromEntries(await Promise.all(
    ["workspaces", "groups", "roles", "tasks", "connections", "contenders", "handoff_templates"].map(async (c) => [c, (await all(c)).length] as const)));
  const before = await counts();
  const again = await seedReference(h.url, h.adminToken);
  expect(again.created).toEqual([]);
  expect(await counts()).toEqual(before);
  // attachments weren't added twice either
  const ui = (await all("tasks", 'title ~ "settings screen from"'))[0]!;
  expect(ui.attachments.length).toBe(2);
});

test("four workspaces with the spec's judges and fitness weights", async () => {
  const ws = await all("workspaces");
  const by = Object.fromEntries(ws.map((w) => [w.name, w]));
  expect(Object.keys(by).sort()).toEqual(["Marketing Pipeline", "Software Factory", "Stock Review", "Travel Research"]);
  const judge = (await all("contenders", 'name = "Mock Judge"'))[0]!;
  expect(by["Software Factory"]!.default_judge).toBe("ai");
  expect(by["Software Factory"]!.judge_contender).toBe(judge.id);
  expect(by["Software Factory"]!.fitness_weights).toEqual({ quality: 70, tokens: 20, time: 10 });
  expect(by["Stock Review"]!.default_judge).toBe("ai");
  expect(by["Marketing Pipeline"]!.default_judge).toBe("me");
  expect(by["Travel Research"]!.fitness_weights).toEqual({ quality: 100, tokens: 0, time: 0 });
});

test("Software Factory has four groups, listed in order, one role each", async () => {
  const sf = (await all("workspaces", 'name = "Software Factory"'))[0]!;
  const groups = (await all("groups", `workspace = "${sf.id}"`)).sort((a, b) => a.order - b.order);
  expect(groups.map((g) => g.name)).toEqual(["Research", "Spec", "Back-end", "UI"]);
  const roles = await all("roles", `workspace = "${sf.id}"`);
  for (const g of groups) expect(roles.filter((r) => r.group === g.id).length).toBe(1);
});

test("every role's rubric sums to 100 and matches the spec", async () => {
  const roles = await all("roles");
  expect(roles.length).toBe(9);
  for (const r of roles) expect(r.rubric.reduce((n: number, c: { weight: number }) => n + c.weight, 0)).toBe(100);
  const image = roles.find((r) => r.name === "Image maker")!;
  expect(image.pass_mark).toBe(3);
  expect(image.default_output_type).toBe("image");
  expect(image.rubric.map((c: { name: string }) => c.name)).toEqual(["Matches the brief", "Visual quality", "On brand", "Usable as-is"]);
});

test("coding tasks name the demo repo and its first commit (O2)", async () => {
  const coding = (await all("tasks")).filter((t) => t.base_ref);
  expect(coding.map((t) => t.output_type)).toEqual(["code", "code"]);
  expect(DEMO_COMMIT).toMatch(/^[0-9a-f]{40}$/);
  expect(DEMO_COMMIT).not.toBe("0000000");
  for (const t of coding) expect(t.base_ref).toEqual({ repo: DEMO_REPO, commit: DEMO_COMMIT });
});

test("Stock Review attaches the Northwind summary; the UI task its spec and mockup", async () => {
  const stock = (await all("tasks", 'title ~ "Northwind"'))[0]!;
  expect(stock.attachments.length).toBe(1);
  const res = await fetch(`${h.url}/api/v1/files/${stock.attachments[0]}`, { headers: { authorization: `Bearer ${h.ownerToken}` } });
  expect(await res.text()).toContain("Northwind Foods");
});

test("seeded contenders: four mock (api) and five manual (handoff)", async () => {
  const cs = await all("contenders");
  expect(cs.filter((c) => c.mode === "api").map((c) => c.name).sort()).toEqual(["Mock Erratic", "Mock Image", "Mock Judge", "Mock Steady"]);
  expect(cs.filter((c) => c.mode === "handoff").length).toBe(5);
  expect(cs.find((c) => c.name === "Mock Image")!.config).toEqual({ mock: { behaviour: "image" } });
});

test("one generic handoff template", async () => {
  const t = await all("handoff_templates");
  expect(t.length).toBe(1);
  expect(t[0]!.kind).toBe("generic");
  expect(t[0]!.body).toContain("{{rubric_text}}");
});
