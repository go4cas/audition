// T2 Handoff against a fresh Vaultbase (TECH-SPEC §15, T2 Done-when 1 to 5).
// Runs are created here the way T1's POST /runs creates them: one prompt per
// task (promptForTask), stored on every attempt, handoff attempts `waiting`.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { boot, create, type Harness } from "./harness.ts";
import { seedReference, DEMO_REPO, DEMO_COMMIT } from "../seed/reference.ts";
import { testImage } from "../vb_hooks/lib/png.ts";

let h: Harness;
const byName = new Map<string, Record<string, any>>();

beforeAll(async () => {
  h = await boot();
  await seedReference(h.url, h.adminToken);
  for (const c of (await h.api("owner", "GET", "/api/v1/contenders?perPage=200")).body.data) byName.set(c.name, c);
});
afterAll(async () => { await h?.cleanup(); });

const sha = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");
const one = async (collection: string, filter: string) =>
  (await h.api("owner", "GET", `/api/v1/${collection}?perPage=1&filter=${encodeURIComponent(filter)}`)).body.data[0] as Record<string, any>;
const render = async (task: string) => {
  const r = await h.api("admin", "POST", "/api/custom/test/render", { task });
  if (r.status !== 200) throw new Error(`render: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data as { server: string; copy: string };
};
const waitFor = async <T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 5000): Promise<T> => {
  const end = Date.now() + ms;
  let v = await fn();
  while (!ok(v) && Date.now() < end) { await Bun.sleep(50); v = await fn(); }
  return v;
};

/** A run as T1 creates it: one rendered prompt per task, stored on every attempt. */
async function startRun(task: Record<string, any>, contenderNames: string[], judge: "me" | "ai" = "me") {
  const role = (await h.api("owner", "GET", `/api/v1/roles/${task.role}`)).body.data;
  const prompt = (await render(task.id)).server;
  const contenders = contenderNames.map((n) => byName.get(n)!);
  const run = await h.store("insert", "runs", {
    workspace: role.workspace, role: role.id, tasks: [task.id], contenders: contenders.map((c) => c.id), judge, status: "running",
  });
  const attempts: Record<string, string> = {};
  for (const c of contenders) {
    attempts[c.name] = await h.store("insert", "attempts", {
      run, task: task.id, contender: c.id, mode: c.mode, status: c.mode === "handoff" ? "waiting" : "queued", prompt_sent: prompt,
    });
  }
  return { run, attempts, prompt };
}

const patch = (id: string, body: unknown) => h.api("owner", "PATCH", `/api/v1/attempts/${id}`, body);
const get = async (id: string) => (await h.api("owner", "GET", `/api/v1/attempts/${id}`)).body.data;
const upload = async (collection: string, id: string, field: string, files: File[], token = h.ownerToken) => {
  const form = new FormData();
  for (const f of files) form.append("file", f);
  const r = await fetch(`${h.url}/api/custom/files/${collection}/${id}/${field}`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
  return { status: r.status, body: await r.json() as any };
};

// ── Done-when 1 ──────────────────────────────────────────────────────────────

const BACKEND_PROMPT = [
  "You are acting as: Back-end engineer.",
  "Role description: Builds small, tested server features.",
  "",
  "TASK: Add a REST endpoint that saves and reads user settings, with tests",
  "Add a REST endpoint that saves and reads user settings (PUT and GET /api/settings), with tests.",
  "",
  `Work in the repository ${DEMO_REPO}, starting from commit ${DEMO_COMMIT}.`,
  "",
  "You will be judged on:",
  "1. Correctness (40%): Does what the task asks, including edge cases.",
  "2. Tests included and passing (25%): New tests cover the change and pass.",
  "3. Code quality (20%): Readable, small, consistent with the repo.",
  "4. Error handling (15%): Bad input gets a clear error, not a crash.",
  "",
  "WHEN DONE, reply with: a short summary of what you built; the branch name or diff; build, test and lint results (pass or fail, with counts); any screenshots, as files.",
].join("\n");

test("1. a seeded Software Factory coding task renders one prompt with role, task, repo, rubric and code instructions", async () => {
  const task = await one("tasks", 'title ~ "Add a REST endpoint"');
  const { server, copy } = await render(task.id);
  expect(server).toBe(BACKEND_PROMPT);
  expect(copy).toBe(server); // lib/handoff.ts's renderer copy matches helpers.template.render
  expect(server).not.toMatch(/<[a-z/]/i);
});

test("1. every handoff and API attempt on that run and task stores the identical string (by hash)", async () => {
  const task = await one("tasks", 'title ~ "Add a REST endpoint"');
  const { run, attempts, prompt } = await startRun(task, ["Mock Steady", "Claude Code (manual)", "Codex (manual)"]);
  const rows = await h.sql<{ prompt_sent: string; mode: string }>(`SELECT prompt_sent, mode FROM vb_attempts WHERE run = ? AND task = ?`, [run, task.id]);
  expect(rows.length).toBe(3);
  expect(new Set(rows.map((r) => r.mode))).toEqual(new Set(["api", "handoff"]));
  expect(new Set(rows.map((r) => sha(r.prompt_sent)))).toEqual(new Set([sha(BACKEND_PROMPT)]));

  const r = await h.api("owner", "GET", `/api/custom/handoff/${run}/${task.id}`);
  expect(r.status).toBe(200);
  expect(sha(r.body.prompt)).toBe(sha(prompt));
  expect(r.body.attachments).toEqual([]);
  expect(r.body.waiting.map((w: any) => w.contender_name).sort()).toEqual(["Claude Code (manual)", "Codex (manual)"]);
  expect(r.body.waiting.map((w: any) => w.attempt).sort()).toEqual([attempts["Claude Code (manual)"], attempts["Codex (manual)"]].sort());
});

test("the handoff route lists task attachments with their names and URLs, and is owner only", async () => {
  const task = await one("tasks", 'title ~ "settings screen from"');
  const { run, prompt } = await startRun(task, ["Codex (manual)"]);
  expect(prompt).toContain("Attached files: settings-spec.md, mockup.png");
  const r = await h.api("owner", "GET", `/api/custom/handoff/${run}/${task.id}`);
  expect(r.body.attachments.map((a: any) => a.name)).toEqual(["settings-spec.md", "mockup.png"]);
  const file = await fetch(`${h.url}${r.body.attachments[1].url}`, { headers: { authorization: `Bearer ${h.ownerToken}` } });
  expect(file.status).toBe(200);
  expect(file.headers.get("content-type")).toBe("image/png");

  expect((await h.api("anon", "GET", `/api/custom/handoff/${run}/${task.id}`)).status).toBeOneOf([401, 403]);
  expect((await h.api("admin", "GET", `/api/custom/handoff/${run}/${task.id}`)).status).toBe(403);
  expect((await h.api("owner", "GET", `/api/custom/handoff/${run}/nope`)).status).toBe(404);
});

// ── Done-when 2 ──────────────────────────────────────────────────────────────

test("2. text, image and file tasks get their own return instructions; no base_ref, no repo line", async () => {
  const text = await one("tasks", 'title ~ "Compare three ways to store"');
  const image = await one("tasks", 'title ~ "square social image"');
  const ws = await create(h, "workspaces", { name: "Files WS" });
  const role = await create(h, "roles", { workspace: ws.id, name: "Packager", description: "Bundles files.", rubric: [{ name: "Complete", weight: 100, guidance: "All files." }], default_output_type: "file" });
  const file = await create(h, "tasks", { role: role.id, title: "Bundle the docs", prompt: "<p>Bundle them.</p>" });
  expect(file.output_type).toBe("file");

  const p = { text: (await render(text.id)).server, image: (await render(image.id)).server, file: (await render(file.id)).server };
  expect(p.text.endsWith("\n\nWHEN DONE, reply with your answer only.")).toBe(true);
  expect(p.image.endsWith("\n\nWHEN DONE, return the image files and a one-line description of each.")).toBe(true);
  expect(p.file.endsWith("\n\nWHEN DONE, return the files and a short summary of what each contains.")).toBe(true);
  for (const s of Object.values(p)) expect(s).not.toContain("Work in the repository");
  expect(p.image).toContain("Create a square social image for the Ember & Oak spring sale"); // &amp; decoded
  expect(p.file).toBe([
    "You are acting as: Packager.", "Role description: Bundles files.", "", "TASK: Bundle the docs", "Bundle them.", "",
    "You will be judged on:", "1. Complete (100%): All files.", "", "WHEN DONE, return the files and a short summary of what each contains.",
  ].join("\n"));
});

// ── Done-when 3 and 4 ────────────────────────────────────────────────────────

test("3 and 4. a pasted output submits once, with optional tokens and time saved as manual", async () => {
  const task = await one("tasks", 'title ~ "Compare three ways to store"');
  const { run, attempts } = await startRun(task, ["Mock Steady", "ChatGPT (manual)"]);
  const id = attempts["ChatGPT (manual)"]!;

  // a draft while waiting is fine, and is not yet a submit
  expect((await patch(id, { output: "draft" })).status).toBe(200);
  expect((await get(id)).status).toBe("waiting");

  const r = await patch(id, { output: "Use SQLite.", tokens_in: 1200, tokens_out: 800, duration_ms: 45000, status: "submitted" });
  expect(r.status).toBe(200);
  const a = await get(id);
  expect(a.status).toBe("submitted");
  expect(a.output).toBe("Use SQLite.");
  expect([a.tokens_in, a.tokens_out, a.duration_ms]).toEqual([1200, 800, 45000]);
  expect(a.metrics_source).toBe("manual");
  expect(a.submitted_at).toBeTruthy();
  expect(a.cost ?? null).toBeNull(); // no prices on the contender: N/A

  // a second PATCH is refused and changes nothing
  const again = await patch(id, { output: "Changed my mind" });
  expect(again.status).toBeOneOf([403, 404]);
  expect((await get(id)).output).toBe("Use SQLite.");
  expect((await patch(id, { status: "waiting" })).status).toBeOneOf([403, 404]);

  // a PATCH on a non-handoff attempt is refused, even while it is waiting
  const api = attempts["Mock Steady"]!;
  expect((await patch(api, { output: "x", status: "submitted" })).status).toBeOneOf([403, 404]);
  await h.store("update", "attempts", { status: "waiting" }, api);
  expect((await patch(api, { output: "x", status: "submitted" })).status).toBeOneOf([403, 404]);
  expect((await get(api)).output ?? "").toBe("");

  // the run still has an api attempt waiting, so it stays running
  expect((await h.api("owner", "GET", `/api/v1/runs/${run}`)).body.data.status).toBe("running");
});

test("3. a PATCH that changes contender, task or a server field is refused", async () => {
  const task = await one("tasks", 'title ~ "Compare three ways to store"');
  const other = await one("tasks", 'title ~ "SQLite versus Postgres"');
  const { attempts } = await startRun(task, ["Perplexity (manual)"]);
  const id = attempts["Perplexity (manual)"]!;
  for (const body of [
    { contender: byName.get("Codex (manual)")!.id },
    { task: other.id },
    { output: "x", contender: byName.get("Codex (manual)")!.id, status: "submitted" },
    { prompt_sent: "something else" },
    { metrics_source: "measured" },
    { cost: 1 },
    { status: "judged" },
    { tokens_in: -1 },
    { tokens_in: 1.5 },
  ]) {
    const r = await patch(id, body);
    // the update rule refuses any status but waiting → submitted (403); the hook refuses the rest (422)
    expect(r.status, JSON.stringify(body)).toBe("status" in body && body.status === "judged" ? 403 : 422);
  }
  const a = await get(id);
  expect([a.status, a.task, a.contender]).toEqual(["waiting", task.id, byName.get("Perplexity (manual)")!.id]);
  // sending the unchanged values is harmless
  expect((await patch(id, { task: task.id, contender: a.contender, output: "ok" })).status).toBe(200);
});

test("3. submitting with no output and no files is refused", async () => {
  const task = await one("tasks", 'title ~ "Compare three ways to store"');
  const { attempts } = await startRun(task, ["Codex (manual)"]);
  const id = attempts["Codex (manual)"]!;
  expect((await patch(id, { status: "submitted" })).status).toBe(422);
  expect((await patch(id, { output: "   ", status: "submitted" })).status).toBe(422);
  expect((await get(id)).status).toBe("waiting");
});

test("4. cost is derived on submit when the contender has both prices", async () => {
  const manual = (await h.api("owner", "GET", `/api/v1/connections?filter=${encodeURIComponent('name = "Manual"')}`)).body.data[0];
  await create(h, "contenders", { name: "Priced (manual)", connection: manual.id, price_in_per_mtok: 3, price_out_per_mtok: 15 });
  byName.set("Priced (manual)", (await h.api("owner", "GET", `/api/v1/contenders?filter=${encodeURIComponent('name = "Priced (manual)"')}`)).body.data[0]);
  const task = await one("tasks", 'title ~ "Compare three ways to store"');
  const { attempts } = await startRun(task, ["Priced (manual)"]);
  const id = attempts["Priced (manual)"]!;
  expect((await patch(id, { output: "x", tokens_in: 1000, tokens_out: 2000, status: "submitted" })).status).toBe(200);
  expect((await get(id)).cost).toBeCloseTo(0.033, 10);
});

test("submitting the last handoff output refreshes the run, and queues AI judging when the judge is AI", async () => {
  const task = await one("tasks", 'title ~ "Compare three ways to store"');
  const { run, attempts } = await startRun(task, ["Claude Code (manual)", "Codex (manual)"], "ai");
  expect((await patch(attempts["Claude Code (manual)"]!, { output: "a", status: "submitted" })).status).toBe(200);
  expect((await patch(attempts["Codex (manual)"]!, { output: "b", status: "submitted" })).status).toBe(200);
  const status = await waitFor(async () => (await h.api("owner", "GET", `/api/v1/runs/${run}`)).body.data.status, (s) => s === "judging");
  expect(status).toBe("judging");
  const jobs = await waitFor(
    () => h.sql<{ payload: string }>(`SELECT payload FROM vaultbase_jobs_log WHERE queue = 'judge'`),
    (rows) => Object.values(attempts).every((id) => rows.some((r) => JSON.parse(r.payload).attempt === id)),
  );
  for (const id of Object.values(attempts)) expect(jobs.some((r) => JSON.parse(r.payload).attempt === id)).toBe(true);
});

test("a human-judged run queues no judging", async () => {
  const task = await one("tasks", 'title ~ "SQLite versus Postgres"');
  const { run, attempts } = await startRun(task, ["Codex (manual)"], "me");
  expect((await patch(attempts["Codex (manual)"]!, { output: "a", status: "submitted" })).status).toBe(200);
  expect(await waitFor(async () => (await h.api("owner", "GET", `/api/v1/runs/${run}`)).body.data.status, (s) => s === "judging")).toBe("judging");
  const jobs = await h.sql<{ payload: string }>(`SELECT payload FROM vaultbase_jobs_log WHERE queue = 'judge'`);
  expect(jobs.some((r) => JSON.parse(r.payload).attempt === attempts["Codex (manual)"])).toBe(false);
});

// ── Done-when 5 ──────────────────────────────────────────────────────────────

const PDF = new TextEncoder().encode("%PDF-1.4\n%âã\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
// A minimal empty zip archive (end-of-central-directory record only).
const ZIP = new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]);

test("5. text, PNG, PDF and zip uploads are accepted, served back, and can be submitted without pasted text", async () => {
  const task = await one("tasks", 'title ~ "square social image"');
  const { attempts } = await startRun(task, ["Midjourney (manual)"]);
  const id = attempts["Midjourney (manual)"]!;
  const png = testImage(2);
  const r = await upload("attempts", id, "output_files", [
    new File(["notes"], "notes.md", { type: "text/markdown" }),
    new File([png], "image.png", { type: "image/png" }),
    new File([PDF], "brief.pdf", { type: "application/pdf" }),
    new File([ZIP], "bundle.zip", { type: "application/zip" }),
  ]);
  expect(r.status).toBe(200);
  expect(r.body.data.output_files.length).toBe(4);
  const names = await h.sql<{ original_name: string; mime_type: string }>(
    `SELECT original_name, mime_type FROM vaultbase_files WHERE record_id = ? ORDER BY original_name`, [id]);
  expect(names).toEqual([
    { original_name: "brief.pdf", mime_type: "application/pdf" },
    { original_name: "bundle.zip", mime_type: "application/octet-stream" },
    { original_name: "image.png", mime_type: "image/png" },
    { original_name: "notes.md", mime_type: "text/plain" },
  ]);
  const imgName = r.body.data.output_files[1];
  const served = await fetch(`${h.url}/api/v1/files/${imgName}`, { headers: { authorization: `Bearer ${h.ownerToken}` } });
  expect(new Uint8Array(await served.arrayBuffer())).toEqual(png);

  expect((await patch(id, { status: "submitted" })).status).toBe(200);
  expect((await get(id)).status).toBe("submitted");
});

test("5. a 26 MB upload, a .exe declared as application/octet-stream, and an upload after submit are refused", async () => {
  const task = await one("tasks", 'title ~ "square social image"');
  const { attempts } = await startRun(task, ["Midjourney (manual)", "Mock Image"]);
  const id = attempts["Midjourney (manual)"]!;

  const big = await upload("attempts", id, "output_files", [new File([new Uint8Array(26 * 1024 * 1024)], "big.txt", { type: "text/plain" })]);
  expect(big.status).toBe(413);
  const exe = await upload("attempts", id, "output_files", [new File([new Uint8Array([0x4d, 0x5a, 0x90, 0])], "tool.exe", { type: "application/octet-stream" })]);
  expect(exe.status).toBe(415);
  const fake = await upload("attempts", id, "output_files", [new File(["not a png"], "fake.png", { type: "image/png" })]);
  expect(fake.status).toBe(415);
  // all or nothing: one bad file refuses the whole upload
  const mixed = await upload("attempts", id, "output_files", [new File(["ok"], "ok.txt"), new File(["MZ"], "bad.exe")]);
  expect(mixed.status).toBe(415);
  expect(fileCount(await get(id))).toBe(0);

  expect((await upload("attempts", id, "output_files", [new File(["ok"], "ok.txt", { type: "text/plain" })])).status).toBe(200);
  expect((await patch(id, { output: "done", status: "submitted" })).status).toBe(200);
  const after = await upload("attempts", id, "output_files", [new File(["late"], "late.txt", { type: "text/plain" })]);
  expect(after.status).toBe(409);
  expect(fileCount(await get(id))).toBe(1);

  // not a handoff output, not the owner, not an upload target
  expect((await upload("attempts", attempts["Mock Image"]!, "output_files", [new File(["x"], "x.txt")])).status).toBe(403);
  expect((await upload("attempts", id, "output_files", [new File(["x"], "x.txt")], h.adminToken)).status).toBe(403);
  expect((await upload("attempts", id, "prompt_sent", [new File(["x"], "x.txt")])).status).toBe(404);
  expect((await upload("contenders", byName.get("Codex (manual)")!.id, "config", [new File(["x"], "x.txt")])).status).toBe(404);
  const anon = await fetch(`${h.url}/api/custom/files/attempts/${id}/output_files`, { method: "POST", body: new FormData() });
  expect(anon.status).toBeOneOf([401, 403]);
});

test("5. a PATCH can't claim a file that wasn't uploaded to this output", async () => {
  const task = await one("tasks", 'title ~ "settings screen from"');
  const { attempts } = await startRun(task, ["Claude Code (manual)"]);
  const id = attempts["Claude Code (manual)"]!;
  const attachment = task.attachments[0];
  const r = await patch(id, { output_files: [attachment] });
  expect(r.status).toBe(422);
  expect(fileCount(await get(id))).toBe(0);
});

test("task attachments upload through the same route while the task is unlocked", async () => {
  const role = await one("roles", 'name = "Researcher"');
  const task = await create(h, "tasks", { role: role.id, title: "With a file", prompt: "<p>See the file.</p>" });
  const r = await upload("tasks", task.id, "attachments", [new File(["context"], "context.txt", { type: "text/plain" })]);
  expect(r.status).toBe(200);
  expect(r.body.data.attachments.length).toBe(1);
  expect((await render(task.id)).server).toContain("Attached files: context.txt");
  await h.store("update", "tasks", { locked: true }, task.id);
  expect((await upload("tasks", task.id, "attachments", [new File(["more"], "more.txt")])).status).toBe(403);
});

function fileCount(a: Record<string, any>): number {
  return Array.isArray(a.output_files) ? a.output_files.length : a.output_files ? 1 : 0;
}
