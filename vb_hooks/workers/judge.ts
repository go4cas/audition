// The judge queue (TECH-SPEC §8): one job per submitted output of an
// AI-judged run, payload { attempt }. Enqueued by the generate worker
// (lib/runs.ts) and the attempt submit hook (lib/handoff.ts). All the work is
// in lib/judge.ts, judgeAttempt; the adapters are lib/providers/index.ts.
import { defineWorker } from "vaultbase";
import { judgeAttempt } from "../lib/judge.ts";
import { callProvider, type ApiProvider } from "../lib/providers/index.ts";

const CALLED: string[] = ["anthropic", "openai-compatible", "mock"];

export default defineWorker({
  name: "judge",
  queue: "judge",
  concurrency: 2,
  // One try (F17): judgeAttempt never throws for a provider or reply
  // problem; it retries a bad reply once itself and records the failure.
  retries: 1,
  async run(ctx) {
    const { helpers } = ctx;
    const attempt = String((ctx.payload as { attempt?: unknown } | null)?.attempt ?? "");
    if (!attempt) return { outcome: "skipped", reason: "no attempt in the payload" };
    const dataDir = helpers.os.env("VAULTBASE_DATA_DIR") || "./vaultbase_data";
    const result = await judgeAttempt({
      sql: helpers.sql,
      find: (c: string, id: string) => helpers.find(c, id),
      query: (c: string, o: object) => helpers.query(c, o),
      readFile: (stored: string) => helpers.fs.readBytes(helpers.path.join(dataDir, "uploads", stored)),
      provider: (name: string) => CALLED.includes(name)
        ? async (input) => (await callProvider({ ...input, provider: name as ApiProvider, http: helpers.http })).result
        : null,
    }, attempt);
    helpers.log(`judge attempt=${attempt} outcome=${result.outcome}`);
    return result;
  },
});
