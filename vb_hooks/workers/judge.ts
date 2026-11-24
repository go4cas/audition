// The judge queue (TECH-SPEC §8): one job per submitted output of an
// AI-judged run, payload { attempt }; on a Compare run one job per pair,
// payload { attempt, opponent } (§10a). Enqueued by the generate worker
// (lib/runs.ts) and the attempt submit hook (lib/handoff.ts). All the work is
// in lib/judge.ts, judgeAttempt; the adapters are lib/providers/index.ts.
import { defineWorker } from "vaultbase";
import { judgeAttempt, judgePair, type JudgeDeps } from "../lib/judge.ts";
import { callProvider, type ApiProvider } from "../lib/providers/index.ts";

const CALLED: string[] = ["anthropic", "openai-compatible", "replicate", "mock"];

export default defineWorker({
  name: "judge",
  queue: "judge",
  concurrency: 2,
  // One try (F17): judgeAttempt never throws for a provider or reply
  // problem; it retries a bad reply once itself and records the failure.
  retries: 1,
  async run(ctx) {
    const { helpers } = ctx;
    const payload = (ctx.payload ?? {}) as { attempt?: unknown; opponent?: unknown };
    const attempt = String(payload.attempt ?? "");
    // Compare runs queue { attempt, opponent }: one job per pair (lib/pairwise.ts).
    const opponent = payload.opponent ? String(payload.opponent) : "";
    if (!attempt) return { outcome: "skipped", reason: "no attempt in the payload" };
    const dataDir = helpers.os.env("VAULTBASE_DATA_DIR") || "./vaultbase_data";
    const deps: JudgeDeps = {
      sql: helpers.sql,
      records: helpers.records,
      find: (c: string, id: string) => helpers.find(c, id),
      query: (c: string, o: object) => helpers.query(c, o),
      readFile: (stored: string) => helpers.fs.readBytes(helpers.path.join(dataDir, "uploads", stored)),
      provider: (name: string) => CALLED.includes(name)
        ? async (input) => (await callProvider({ ...input, provider: name as ApiProvider, http: helpers.http })).result
        : null,
    };
    const result = opponent ? await judgePair(deps, attempt, opponent) : await judgeAttempt(deps, attempt);
    helpers.log(`judge attempt=${attempt}${opponent ? ` opponent=${opponent}` : ""} outcome=${result.outcome}`);
    return result;
  },
});
