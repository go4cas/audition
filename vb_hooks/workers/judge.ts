// The judge queue (TECH-SPEC §8): one job per submitted output of an
// AI-judged run, payload { attempt }. Enqueued by T1's generate worker and
// T2's attempt submit hook. All the work is in lib/judge.ts, judgeAttempt.
import { defineWorker } from "vaultbase";
import { judgeAttempt, type Generate } from "../lib/judge.ts";
import { generate as mock } from "../lib/providers/mock.ts";

// Adapters by connection provider. T1 adds lib/providers/index.ts with the
// Anthropic and OpenAI-compatible adapters; T5 points this at it.
const PROVIDERS: Record<string, Generate> = { mock };

export default defineWorker({
  name: "judge",
  queue: "judge",
  concurrency: 2,
  // judgeAttempt never throws for a provider or reply problem; it retries a
  // bad reply once itself and records the failure on the output.
  retries: 0,
  async run(ctx) {
    const { helpers } = ctx;
    const attempt = String((ctx.payload as { attempt?: unknown } | null)?.attempt ?? "");
    if (!attempt) return { outcome: "skipped", reason: "no attempt in the payload" };
    const dataDir = helpers.os.env("VAULTBASE_DATA_DIR") || "./vaultbase_data";
    return judgeAttempt({
      sql: helpers.sql,
      find: (c: string, id: string) => helpers.find(c, id),
      readFile: (stored: string) => helpers.fs.readBytes(helpers.path.join(dataDir, "uploads", stored)),
      provider: (name: string) => PROVIDERS[name] ?? null,
      http: helpers.http,
    }, attempt);
  },
});
