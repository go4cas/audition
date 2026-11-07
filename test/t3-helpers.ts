// Shared set-up for the T3 server tests: an AI-judged run whose outputs were
// made by the mock provider, written the way T1's generate worker writes them.
import { create, fixtures, type Harness } from "./harness.ts";
import { generate, mockSeed } from "../vb_hooks/lib/providers/mock.ts";
import { testImage } from "../vb_hooks/lib/png.ts";

export const sfx = () => crypto.randomUUID().slice(0, 8);

export async function attach(h: Harness, attempt: string, name: string, mime: string, bytes: Uint8Array): Promise<string> {
  const r = await h.api("admin", "POST", "/api/custom/seed/attach", { collection: "attempts", id: attempt, field: "output_files", name, mime, data: Buffer.from(bytes).toString("base64") });
  if (r.status !== 200) throw new Error(`attach: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data.filename;
}

export async function mockContender(h: Harness, connection: string, behaviour: string, name = `Mock ${behaviour} ${sfx()}`) {
  return create(h, "contenders", { name, connection, model: `mock-${behaviour}`, config: { mock: { behaviour } } });
}

/** 2 tasks × (steady, erratic, image, one failed) on an AI-judged run, every output submitted. */
export async function aiRun(h: Harness) {
  const f = await fixtures(h);
  const task2 = await create(h, "tasks", { role: f.role.id, title: "Summarise findings", prompt: "<p>Summarise.</p>" });
  const judge = await mockContender(h, f.mock.id, "judge", `Mock Judge ${sfx()}`);
  const erratic = await mockContender(h, f.mock.id, "erratic");
  const image = await mockContender(h, f.mock.id, "image");
  const failing = await mockContender(h, f.mock.id, "fail");
  const tasks = [f.task, task2];
  const contenders = [f.contender, erratic, image, failing];
  const run = await h.store("insert", "runs", {
    workspace: f.workspace.id, role: f.role.id, tasks: tasks.map((t) => t.id), contenders: contenders.map((c) => c.id),
    judge: "ai", judge_contender: judge.id, status: "judging", call_count: 14,
  });
  const attempts: Array<{ id: string; task: string; contender: string; status: string; quality: number | null }> = [];
  for (const t of tasks) {
    const prompt = `You are acting as: Researcher.\n\nTASK: ${t.title}\n${t.title}.`;
    for (const c of contenders) {
      const behaviour = c.config.mock.behaviour;
      if (behaviour === "fail") {
        const id = await h.store("insert", "attempts", { run, task: t.id, contender: c.id, mode: "api", status: "failed", prompt_sent: prompt, error: "Mock Fail always fails." });
        attempts.push({ id, task: t.id, contender: c.id, status: "failed", quality: null });
        continue;
      }
      const out = await generate({ model: c.model, config: c.config, maxOutputTokens: 16000, prompt, attachments: [], seed: mockSeed(t.id, c.id, 0) });
      const id = await h.store("insert", "attempts", {
        run, task: t.id, contender: c.id, mode: "api", status: "submitted", prompt_sent: prompt, output: out.text,
        tokens_in: out.tokensIn, tokens_out: out.tokensOut, duration_ms: out.durationMs, metrics_source: "measured",
        finish_reason: out.finishReason, submitted_at: Date.now(),
      });
      for (const file of out.files) await attach(h, id, file.name, file.mime, file.bytes);
      const m = /\[\[mock-quality:(\d)\]\]/.exec(out.text);
      attempts.push({ id, task: t.id, contender: c.id, status: "submitted", quality: m ? Number(m[1]) : null });
    }
  }
  return { ...f, task2, judge, erratic, image, failing, tasks, contenders, run, attempts };
}

export async function enqueueJudge(h: Harness, attempt: string) {
  const r = await h.api("admin", "POST", "/api/custom/test/enqueue", { queue: "judge", payload: { attempt } });
  if (r.status !== 200) throw new Error(`enqueue: ${r.status} ${JSON.stringify(r.body)}`);
}

/** Poll until check() is truthy (after-hooks and workers run in the background). */
export async function until<T>(check: () => Promise<T>, what: string, ms = 20000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(150);
  }
}

export { testImage };
