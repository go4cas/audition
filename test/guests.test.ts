// Guest voters on a fresh Vaultbase (TECH-SPEC §10b): anonymous guest
// sessions that can't reach anything but the guest routes, owner links with
// their checks, the blind ballot, votes, closed, expired and full links, the
// crowd's one score on the leaderboard, guest files and the clean-up.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { boot, create, fixtures, type Harness } from "./harness.ts";
import { call, RATE_LIMIT_RULES, SETTINGS } from "../scripts/lib/vaultbase.ts";
import { BLIND_FORBIDDEN_KEYS } from "../vb_hooks/lib/scoring.ts";
import { CROWD_MIN, GUEST_KEEP_DAYS, DAY_S, isGuest } from "../vb_hooks/lib/guests.ts";
import { attach, mockContender } from "./t3-helpers.ts";
import { testImage } from "../vb_hooks/lib/png.ts";

let h: Harness;
let f: Awaited<ReturnType<typeof fixtures>>;
let rival: Record<string, any>;
let third: Record<string, any>;
let rateRun: string;
let cmpRun: string;
const ATT: Record<string, string> = {}; // contender id -> attempt id (rate run)

const guest = async (): Promise<{ id: string; token: string }> => {
  const r = await call(h.url, "POST", "/api/v1/auth/guests/anonymous", {});
  if (r.status !== 200) throw new Error(`guest: ${r.status} ${JSON.stringify(r.body)}`);
  return { id: r.body.data.record.id, token: r.body.data.token };
};
const as = (token: string | undefined, method: string, path: string, body?: unknown) => call(h.url, method, path, { token, body });
const link = async (run: string, extra: Record<string, unknown> = {}) => create(h, "guest_links", { run, ...extra });
const board = async () => (await h.api("owner", "GET", `/api/custom/leaderboard/${f.role.id}`)).body.data;
const rowOf = async (contender: string) => (await board()).rows.find((r: { contender: string }) => r.contender === contender);
const view = async (contender: string) => (await h.api("owner", "GET", `/api/v1/leaderboard/${f.role.id}:${contender}`)).body.data;

beforeAll(async () => {
  h = await boot();
  // This file makes many guests from one address: lift the guest sign-in
  // limit here (the last test puts it back and checks it).
  const loose = RATE_LIMIT_RULES.map((r) => (r.label.includes("anonymous") ? { ...r, max: 1000 } : r));
  await h.api("admin", "PATCH", "/api/v1/admin/settings", { "rate_limit.rules": JSON.stringify(loose) });
  f = await fixtures(h);
  rival = await mockContender(h, f.mock.id, "erratic");
  third = await mockContender(h, f.mock.id, "image");
  const contenders = [f.contender, rival, third];
  rateRun = await h.store("insert", "runs", { workspace: f.workspace.id, role: f.role.id, tasks: [f.task.id], contenders: contenders.map((c) => c.id), judge: "me", method: "rate", status: "judging", call_count: 3 });
  cmpRun = await h.store("insert", "runs", { workspace: f.workspace.id, role: f.role.id, tasks: [f.task.id], contenders: contenders.map((c) => c.id), judge: "me", method: "compare", status: "judging", call_count: 3 });
  for (const run of [rateRun, cmpRun]) {
    for (const c of contenders) {
      const id = await h.store("insert", "attempts", { run, task: f.task.id, contender: c.id, mode: "api", status: "submitted", prompt_sent: "p", output: `Answer by ${c.name}`, tokens_in: 10, tokens_out: 20, duration_ms: 100, metrics_source: "measured" });
      if (run === rateRun) ATT[c.id] = id;
      if (c.id === third.id) await attach(h, id, `${c.name} render.png`, "image/png", testImage(4, 4, [200, 10, 10]));
    }
  }
});
afterAll(async () => { await h?.cleanup(); });

describe("guest sessions", () => {
  test("anyone can start a guest session, but only in guests: never an owner account", async () => {
    const g = await guest();
    const claims = JSON.parse(atob(g.token.split(".")[1]!));
    expect(claims).toMatchObject({ collection: "guests", anonymous: true });
    expect(isGuest({ type: "user", collection: "guests", anonymous: true })).toBe(true);
    expect((await call(h.url, "POST", "/api/v1/auth/users/anonymous", {})).status).toBe(403);
    // A guest account with an email and password can't be made either.
    const reg = await call(h.url, "POST", "/api/v1/auth/guests/register", { body: { email: "walkin@test.local", password: "Walk-in-pass-123!", passwordConfirm: "Walk-in-pass-123!" } });
    expect(reg.status).toBe(403);
  });

  test("a guest can't read or write any collection, nor reach the owner's routes", async () => {
    const g = await guest();
    const lk = await link(rateRun);
    for (const c of ["users", "workspaces", "stages", "roles", "tasks", "connections", "contenders", "handoff_templates", "runs", "attempts", "verdicts", "castings", "leaderboard", "guest_links", "guest_votes"]) {
      const r = await as(g.token, "GET", `/api/v1/${c}`);
      expect(r.status === 200 ? r.body.data.length : 0, `${c} list`).toBe(0);
    }
    expect((await as(g.token, "GET", `/api/v1/connection_keys`)).status).toBe(403);
    expect((await as(g.token, "GET", `/api/v1/guest_links/${lk.id}`)).status).toBeOneOf([403, 404]);
    expect((await as(g.token, "POST", `/api/v1/guest_votes`, { link: lk.id, run: rateRun, attempt: ATT[f.contender.id], stars: 5 })).status).toBeOneOf([400, 403]);
    expect((await as(g.token, "POST", `/api/v1/verdicts`, { attempt: ATT[f.contender.id], scores: { Accuracy: { stars: 5 }, Clarity: { stars: 5 } } })).status).toBe(403);
    expect((await as(g.token, "POST", `/api/v1/guest_links`, { run: rateRun })).status).toBe(403);
    for (const p of [`/api/custom/runs/${rateRun}`, `/api/custom/judging/${rateRun}/${f.task.id}`, `/api/custom/leaderboard/${f.role.id}`, `/api/custom/outcomes`]) {
      // Vaultbase refuses an anonymous session on routes that need a signed-in caller.
      expect((await as(g.token, "GET", p)).status, p).toBeOneOf([401, 403]);
    }
    // A guest sees only their own guest record.
    const me = await as(g.token, "GET", "/api/v1/guests");
    expect(me.body.data.map((x: { id: string }) => x.id)).toEqual([g.id]);
  });

  test("the guest routes take guests only: not the owner, not anonymous callers", async () => {
    const lk = await link(rateRun);
    expect((await h.api("owner", "GET", `/api/custom/guest/${lk.token}`)).status).toBe(403);
    expect((await h.api("anon", "GET", `/api/custom/guest/${lk.token}`)).status).toBe(403);
    expect((await h.api("owner", "POST", `/api/custom/guest/${lk.token}/votes`, { task: f.task.id, label: "A", stars: 5 })).status).toBe(403);
  });
});

describe("links", () => {
  test("the server makes the token and fills the defaults", async () => {
    const before = Math.floor(Date.now() / 1000);
    const lk = await link(rateRun, { token: "mine-mine-mine-mine-mine", active: undefined });
    expect(lk.token).toMatch(/^[0-9a-f]{64}$/);
    expect(lk.active).toBe(true);
    expect(lk.counts).toBe(false);
    expect(lk.max_guests).toBe(50);
    const exp = Number(lk.expires_at) > 1e12 ? Number(lk.expires_at) / 1000 : Number(lk.expires_at);
    expect(Math.abs(exp - (before + 7 * DAY_S))).toBeLessThan(120);
  });

  test("a link keeps its run and token, and stays open 30 days at most", async () => {
    const lk = await link(rateRun);
    expect((await h.api("owner", "PATCH", `/api/v1/guest_links/${lk.id}`, { token: "x".repeat(64) })).status).toBe(422);
    expect((await h.api("owner", "PATCH", `/api/v1/guest_links/${lk.id}`, { run: cmpRun })).status).toBe(422);
    const far = Math.floor(Date.now() / 1000) + 40 * DAY_S;
    expect((await h.api("owner", "PATCH", `/api/v1/guest_links/${lk.id}`, { expires_at: far })).status).toBe(422);
    expect((await h.api("owner", "PATCH", `/api/v1/guest_links/${lk.id}`, { max_guests: 0 })).status).toBeOneOf([400, 422]);
    const ok = await h.api("owner", "PATCH", `/api/v1/guest_links/${lk.id}`, { counts: true, active: false });
    expect(ok.status).toBe(200);
    expect((await h.api("owner", "POST", "/api/v1/guest_links", { run: "nope" })).status).toBeOneOf([400, 404, 422]);
  });

  test("anonymous callers can't see or make links", async () => {
    expect((await h.api("anon", "GET", "/api/v1/guest_links")).body.data?.length ?? 0).toBe(0);
    expect((await h.api("anon", "POST", "/api/v1/guest_links", { run: rateRun })).status).toBeOneOf([401, 403]);
  });

  test("the run view lists the run's links with guests and votes", async () => {
    const lk = await link(rateRun);
    const g = await guest();
    await as(g.token, "POST", `/api/custom/guest/${lk.token}/votes`, { task: f.task.id, label: "A", stars: 4 });
    const v = (await h.api("owner", "GET", `/api/custom/runs/${rateRun}`)).body.data;
    const mine = v.guests.find((x: { id: string }) => x.id === lk.id);
    expect(mine).toMatchObject({ token: lk.token, active: true, counts: false, guests: 1, votes: 1, state: "open", max_guests: 50 });
  });
});

describe("the ballot", () => {
  test("Rate: lettered outputs and the guest's own stars, nothing about who made them", async () => {
    const lk = await link(rateRun);
    const g = await guest();
    const r = await as(g.token, "GET", `/api/custom/guest/${lk.token}`);
    expect(r.status).toBe(200);
    const b = r.body.data;
    expect(b.method).toBe("rate");
    expect(b.tasks).toHaveLength(1);
    const t = b.tasks[0];
    expect(t.title).toBe(f.task.title);
    expect(t.prompt_text).toContain("Compare three options.");
    expect(t.outputs.map((o: { label: string }) => o.label)).toEqual(["A", "B", "C"]);
    expect(t.stars).toEqual({ A: null, B: null, C: null });
    // The owner's judging screen uses the same letters.
    const owner = (await h.api("owner", "GET", `/api/custom/judging/${rateRun}/${f.task.id}`)).body.data;
    for (const o of owner.outputs) expect(t.outputs.find((x: { label: string }) => x.label === o.label).output).toBe(o.output);
    // Blind: no attempt or contender ids, names, models or scores anywhere.
    const text = JSON.stringify(b);
    for (const id of [...Object.values(ATT), f.contender.id, rival.id, third.id, rival.model]) expect(text).not.toContain(id);
    for (const c of [f.contender, rival, third]) expect(text.replace(`Answer by ${c.name}`, "")).not.toContain(c.name);
    const keys = new Set<string>();
    const walk = (x: unknown) => { if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) { keys.add(k); walk(v); } };
    walk(b);
    for (const k of [...BLIND_FORBIDDEN_KEYS, "verdict", "score", "attempt", "history"]) expect(keys.has(k), k).toBe(false);
    // The image's file name is neutral, and the guest file route serves it.
    const img = t.outputs.flatMap((o: { files: any[] }) => o.files).find((x: { is_image: boolean }) => x.is_image);
    expect(img.name).toMatch(/^[ABC]-1\.png$/);
    const file = await fetch(h.url + img.url, { headers: { authorization: `Bearer ${g.token}` } });
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await file.arrayBuffer()).slice(1, 4)).toEqual(new TextEncoder().encode("PNG"));
    expect((await fetch(h.url + img.url, { headers: { authorization: `Bearer ${h.ownerToken}` } })).status).toBe(403);
    expect((await fetch(h.url + img.url.replace(/\/0$/, "/9"), { headers: { authorization: `Bearer ${g.token}` } })).status).toBe(404);
  });

  test("Compare: every pair, sides as the owner sees them", async () => {
    const lk = await link(cmpRun);
    const g = await guest();
    const b = (await as(g.token, "GET", `/api/custom/guest/${lk.token}`)).body.data;
    expect(b.method).toBe("compare");
    const owner = (await h.api("owner", "GET", `/api/custom/judging/${cmpRun}/${f.task.id}`)).body.data;
    expect(b.tasks[0].pairs.map((p: { left: string; right: string }) => `${p.left}${p.right}`))
      .toEqual(owner.pairs.map((p: { left: string; right: string }) => `${p.left}${p.right}`));
    expect(b.tasks[0].pairs.every((p: { pick: unknown }) => p.pick === null)).toBe(true);
  });

  test("a wrong token is a 404; a closed or expired link is a 410", async () => {
    const g = await guest();
    expect((await as(g.token, "GET", `/api/custom/guest/${"0".repeat(64)}`)).status).toBe(404);
    expect((await as(g.token, "GET", `/api/custom/guest/bad`)).status).toBe(404);
    const closed = await link(rateRun, { active: false });
    const r = await as(g.token, "GET", `/api/custom/guest/${closed.token}`);
    expect(r.status).toBe(410);
    expect(r.body.error).toContain("closed");
    const old = await link(rateRun);
    await h.store("update", "guest_links", { expires_at: Math.floor(Date.now() / 1000) - 60 }, old.id);
    expect((await as(g.token, "GET", `/api/custom/guest/${old.token}`)).status).toBe(410);
    expect((await as(g.token, "POST", `/api/custom/guest/${old.token}/votes`, { task: f.task.id, label: "A", stars: 3 })).status).toBe(410);
  });

  test("a full link turns new guests away, but lets its guests back in", async () => {
    const lk = await link(rateRun, { max_guests: 1 });
    const a = await guest(), b = await guest();
    expect((await as(a.token, "POST", `/api/custom/guest/${lk.token}/votes`, { task: f.task.id, label: "B", stars: 2 })).status).toBe(200);
    expect((await as(b.token, "GET", `/api/custom/guest/${lk.token}`)).status).toBe(410);
    expect((await as(a.token, "GET", `/api/custom/guest/${lk.token}`)).status).toBe(200);
  });
});

describe("votes", () => {
  test("Rate: stars are stored, changed by a second vote, and checked", async () => {
    const lk = await link(rateRun);
    const g = await guest();
    const url = `/api/custom/guest/${lk.token}/votes`;
    expect((await as(g.token, "POST", url, { task: f.task.id, label: "A", stars: 4 })).status).toBe(200);
    expect((await as(g.token, "POST", url, { task: f.task.id, label: "A", stars: 2 })).status).toBe(200);
    const mine = await h.sql<{ stars: number }>(`SELECT stars FROM vb_guest_votes WHERE guest = ?`, [g.id]);
    expect(mine.map((x) => x.stars)).toEqual([2]);
    const b = (await as(g.token, "GET", `/api/custom/guest/${lk.token}`)).body.data;
    expect(b.tasks[0].stars.A).toBe(2);
    for (const bad of [{ task: f.task.id, label: "A", stars: 6 }, { task: f.task.id, label: "A", stars: 2.5 }, { task: f.task.id, label: "Z", stars: 3 }, { task: "nope", label: "A", stars: 3 }, { task: f.task.id, left: "A", right: "B", pick: "left" }]) {
      expect((await as(g.token, "POST", url, bad)).status, JSON.stringify(bad)).toBe(400);
    }
  });

  test("Compare: a pick is stored once per pair, either way round", async () => {
    const lk = await link(cmpRun);
    const g = await guest();
    const url = `/api/custom/guest/${lk.token}/votes`;
    expect((await as(g.token, "POST", url, { task: f.task.id, left: "A", right: "B", pick: "left" })).status).toBe(200);
    expect((await as(g.token, "POST", url, { task: f.task.id, left: "B", right: "A", pick: "tie" })).status).toBe(200);
    const rows = await h.sql(`SELECT winner FROM vb_guest_votes WHERE guest = ?`, [g.id]);
    expect(rows.map((x: any) => x.winner)).toEqual(["tie"]);
    expect((await as(g.token, "POST", url, { task: f.task.id, left: "A", right: "A", pick: "left" })).status).toBe(400);
    expect((await as(g.token, "POST", url, { task: f.task.id, left: "A", right: "B", pick: "both" })).status).toBe(400);
  });
});

describe("the crowd on the leaderboard", () => {
  test(`counts as one score once the owner switches it on and ${CROWD_MIN} guests voted`, async () => {
    // A clean role, so earlier tests' votes don't mix in.
    const role = await create(h, "roles", { workspace: f.workspace.id, name: "Crowd", rubric: [{ name: "Overall", weight: 100 }] });
    const task = await create(h, "tasks", { role: role.id, title: "Crowd task", prompt: "<p>Go.</p>" });
    const run = await h.store("insert", "runs", { workspace: f.workspace.id, role: role.id, tasks: [task.id], contenders: [f.contender.id], judge: "me", method: "rate", status: "judging", call_count: 1 });
    const att = await h.store("insert", "attempts", { run, task: task.id, contender: f.contender.id, mode: "api", status: "submitted", prompt_sent: "p", output: "o", tokens_in: 10, tokens_out: 20, duration_ms: 100 });
    // The owner's verdict: 2 stars.
    expect((await h.api("owner", "POST", "/api/v1/verdicts", { attempt: att, scores: { Overall: { stars: 2 } } })).status).toBe(200);
    const row = async () => (await h.api("owner", "GET", `/api/v1/leaderboard/${role.id}:${f.contender.id}`)).body.data;
    expect(row()).resolves.toMatchObject({ n: expect.anything() });
    expect(Number((await row()).n)).toBe(1);

    const lk = await link(run);
    const vote = async (stars: number) => { const g = await guest(); expect((await as(g.token, "POST", `/api/custom/guest/${lk.token}/votes`, { task: task.id, label: "A", stars })).status).toBe(200); };
    for (const s of [5, 5, 5]) await vote(s);
    // Not switched on yet: nothing changes.
    expect(Number((await row()).n)).toBe(1);
    expect(Number((await row()).mean_score)).toBe(2);
    await h.api("owner", "PATCH", `/api/v1/guest_links/${lk.id}`, { counts: true });
    let r = await row();
    expect(Number(r.n)).toBe(2);
    expect(Number(r.n_guest)).toBe(1);
    expect(Number(r.mean_score)).toBe(3.5); // (2 + 5) / 2: the crowd is one judge
    // Tokens and time still count the output once.
    expect(Number(r.n_tokens)).toBe(1);
    expect(Number(r.mean_tokens)).toBe(30);
    // More guests move the crowd's score, never its weight.
    for (const s of [1, 1, 1, 1, 1]) await vote(s);
    r = await row();
    expect(Number(r.n)).toBe(2);
    expect(Number(r.mean_score)).toBe(2.25); // (2 + 2.5) / 2
    // The board route carries it through.
    const b = (await h.api("owner", "GET", `/api/custom/leaderboard/${role.id}`)).body.data;
    expect(b.rows[0]).toMatchObject({ n: 2, n_guest: 1, mean_score: 2.25 });
    // Switched off again: back to the owner alone.
    await h.api("owner", "PATCH", `/api/v1/guest_links/${lk.id}`, { counts: false });
    expect(Number((await row()).n)).toBe(1);
  });

  test(`fewer than ${CROWD_MIN} guest votes don't count`, async () => {
    const role = await create(h, "roles", { workspace: f.workspace.id, name: "Few", rubric: [{ name: "Overall", weight: 100 }] });
    const task = await create(h, "tasks", { role: role.id, title: "Few task", prompt: "<p>Go.</p>" });
    const run = await h.store("insert", "runs", { workspace: f.workspace.id, role: role.id, tasks: [task.id], contenders: [f.contender.id], judge: "me", method: "rate", status: "judging", call_count: 1 });
    await h.store("insert", "attempts", { run, task: task.id, contender: f.contender.id, mode: "api", status: "submitted", prompt_sent: "p", output: "o" });
    const lk = await link(run, { counts: true });
    for (let i = 0; i < CROWD_MIN - 1; i++) { const g = await guest(); await as(g.token, "POST", `/api/custom/guest/${lk.token}/votes`, { task: task.id, label: "A", stars: 5 }); }
    expect((await h.api("owner", "GET", `/api/v1/leaderboard/${role.id}:${f.contender.id}`)).status).toBe(404);
  });

  test("Compare: the crowd's win share becomes its score", async () => {
    const role = await create(h, "roles", { workspace: f.workspace.id, name: "Duel", rubric: [{ name: "Overall", weight: 100 }] });
    const task = await create(h, "tasks", { role: role.id, title: "Duel task", prompt: "<p>Go.</p>" });
    const run = await h.store("insert", "runs", { workspace: f.workspace.id, role: role.id, tasks: [task.id], contenders: [f.contender.id, rival.id], judge: "me", method: "compare", status: "judging", call_count: 1 });
    const x = await h.store("insert", "attempts", { run, task: task.id, contender: f.contender.id, mode: "api", status: "submitted", prompt_sent: "p", output: "x" });
    await h.store("insert", "attempts", { run, task: task.id, contender: rival.id, mode: "api", status: "submitted", prompt_sent: "p", output: "y" });
    const lk = await link(run, { counts: true });
    const owner = (await h.api("owner", "GET", `/api/custom/judging/${run}/${task.id}`)).body.data;
    const xLabel = owner.outputs.find((o: { attempt: string }) => o.attempt === x).label;
    const yLabel = xLabel === "A" ? "B" : "A";
    // Two guests pick x, one calls it even: x has 2.5 of 3, so 1 + 4 × 2.5 / 3.
    for (const pick of ["x", "x", "tie"]) {
      const g = await guest();
      const r = await as(g.token, "POST", `/api/custom/guest/${lk.token}/votes`, { task: task.id, left: xLabel, right: yLabel, pick: pick === "tie" ? "tie" : "left" });
      expect(r.status).toBe(200);
    }
    const rx = (await h.api("owner", "GET", `/api/v1/leaderboard/${role.id}:${f.contender.id}`)).body.data;
    const ry = (await h.api("owner", "GET", `/api/v1/leaderboard/${role.id}:${rival.id}`)).body.data;
    expect(Number(rx.mean_score)).toBe(4.33);
    expect(Number(ry.mean_score)).toBe(1.67);
    expect(Number(rx.n_guest)).toBe(1);
    // The owner's judging screen shows the crowd beside each output.
    const j = (await h.api("owner", "GET", `/api/custom/judging/${run}/${task.id}`)).body.data;
    expect(j.outputs.find((o: { attempt: string }) => o.attempt === x).guests).toEqual({ votes: 3, score: 4.33, counts: true });
  });
});

test("old guest accounts are cleaned up; their votes stay", async () => {
  const lk = await link(rateRun);
  const g = await guest();
  await as(g.token, "POST", `/api/custom/guest/${lk.token}/votes`, { task: f.task.id, label: "C", stars: 3 });
  const later = Math.floor(Date.now() / 1000) + (GUEST_KEEP_DAYS + 1) * DAY_S;
  const r = await h.api("admin", "POST", "/api/custom/test/guest-sweep", { now: later });
  expect(r.status).toBe(200);
  expect(r.body.data.deleted).toBeGreaterThanOrEqual(1);
  expect((await h.sql(`SELECT id FROM vb_guests WHERE id = ?`, [g.id])).length).toBe(0);
  const votes = await h.sql<{ guest: string | null }>(`SELECT guest FROM vb_guest_votes WHERE link = ?`, [lk.id]);
  expect(votes).toHaveLength(1);
  expect(votes[0]!.guest ?? null).toBeNull();
});

test("guest sign-ins are rate limited per address", { timeout: 20_000 }, async () => {
  await h.api("admin", "PATCH", "/api/v1/admin/settings", { "rate_limit.rules": SETTINGS["rate_limit.rules"] });
  await Bun.sleep(5500); // Vaultbase caches the rules for 5 seconds
  const codes: number[] = [];
  for (let i = 0; i < 12; i++) codes.push((await call(h.url, "POST", "/api/v1/auth/guests/anonymous", {})).status);
  expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
  expect(codes.slice(10)).toEqual([429, 429]);
});
