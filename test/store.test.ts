// F1: a record written by vb_hooks/lib/store.ts reads back through REST
// exactly like the same record created through REST.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { boot, create, fixtures, type Harness } from "./harness.ts";
import { encodeForStore, StoreError } from "../vb_hooks/lib/store.ts";

let h: Harness;
let f: Awaited<ReturnType<typeof fixtures>>;
beforeAll(async () => { h = await boot(); f = await fixtures(h); });
afterAll(async () => { await h?.cleanup(); });

const strip = (r: Record<string, unknown>) => {
  const { id: _i, created: _c, updated: _u, ...rest } = r;
  return rest;
};

test("tasks: text, editor, select, json, bool and relations round-trip", async () => {
  const data = {
    role: f.role.id, title: "Round trip", prompt: "<p>Hello <strong>world</strong></p>", output_type: "code",
    base_ref: { repo: "github.com/go4cas/audition-factory-demo", commit: "abc1234" }, locked: false,
    previous_version: f.task.id, composed_prompt: null,
  };
  const viaRest = await create(h, "tasks", data, "admin");
  const id = await h.store("insert", "tasks", data);
  const viaStore = (await h.api("owner", "GET", `/api/v1/tasks/${id}`)).body.data;
  expect(strip(viaStore)).toEqual(strip(viaRest));
  expect(viaStore.created).toBeGreaterThan(0);
  expect(viaStore.updated).toBe(viaStore.created);
});

test("attempts and verdicts: numbers, dates, json lists and selects round-trip", async () => {
  const run = await h.store("insert", "runs", { workspace: f.workspace.id, role: f.role.id, tasks: [f.task.id], contenders: [f.contender.id, f.handoff.id], judge: "ai", judge_contender: f.contender.id, status: "running", call_count: 4 });
  const runRec = (await h.api("owner", "GET", `/api/v1/runs/${run}`)).body.data;
  expect(runRec.tasks).toEqual([f.task.id]);
  expect(runRec.contenders).toEqual([f.contender.id, f.handoff.id]);
  expect(runRec.call_count).toBe(4);

  const at = "2026-11-06T10:00:00.000Z";
  const attempt = { run, task: f.task.id, contender: f.contender.id, mode: "api", status: "submitted", prompt_sent: "P", output: "O", tokens_in: 12, tokens_out: 300, duration_ms: 1234, cost: 0.0042, metrics_source: "measured", finish_reason: "end_turn", submitted_at: at };
  const viaRest = await create(h, "attempts", attempt, "admin");
  const id = await h.store("insert", "attempts", attempt);
  const viaStore = (await h.api("owner", "GET", `/api/v1/attempts/${id}`)).body.data;
  expect(strip(viaStore)).toEqual(strip(viaRest));
  expect(viaStore.submitted_at).toBe(Math.floor(Date.parse(at) / 1000));

  const verdict = { attempt: id, run, method: "rubric", judge_kind: "ai", judge_contender: f.contender.id, scores: { Accuracy: { stars: 4, reason: "ok" } }, rubric_snapshot: [{ name: "Accuracy", weight: 100 }], score: 4, status: "active" };
  const vRest = await create(h, "verdicts", verdict, "admin");
  const vId = await h.store("insert", "verdicts", verdict);
  expect(strip((await h.api("owner", "GET", `/api/v1/verdicts/${vId}`)).body.data)).toEqual(strip(vRest));
});

test("updates set only the given fields and move updated_at", async () => {
  const id = await h.store("insert", "attempts", { task: f.task.id, contender: f.contender.id, mode: "api", status: "queued" });
  const before = (await h.api("owner", "GET", `/api/v1/attempts/${id}`)).body.data;
  await Bun.sleep(1100); // updated_at has 1 s resolution
  await h.store("update", "attempts", { status: "failed", error: "boom" }, id);
  const after = (await h.api("owner", "GET", `/api/v1/attempts/${id}`)).body.data;
  expect(after.status).toBe("failed");
  expect(after.error).toBe("boom");
  expect(after.mode).toBe("api");
  expect(after.updated).toBeGreaterThan(before.updated);
});

test("store refuses encrypted fields, unknown fields and views", async () => {
  expect(() => encodeForStore("k", { name: "api_key", type: "text", options: { encrypted: true } })).toThrow(StoreError);
  const r1 = await h.api("admin", "POST", "/api/custom/test/store", { op: "insert", collection: "connection_keys", data: { connection: f.mock.id, api_key: "k" } });
  expect(r1.status).toBe(422);
  const r2 = await h.api("admin", "POST", "/api/custom/test/store", { op: "insert", collection: "tasks", data: { nope: 1 } });
  expect(r2.status).toBe(422);
  const r3 = await h.api("admin", "POST", "/api/custom/test/store", { op: "insert", collection: "leaderboard", data: {} });
  expect(r3.status).toBe(422);
});
