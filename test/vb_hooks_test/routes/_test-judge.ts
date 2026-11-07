// Test only: POST /api/custom/test/judge runs lib/judge.ts judgeAttempt on
// the real database with a fake provider in place of the judge's adapter,
// and returns what that provider was called with. Admin only.
//   fake "miss":   every reply leaves out the rubric's last criterion
//   fake "record": answers 3 stars everywhere and records each request
import { defineRoute } from "vaultbase";
import { judgeAttempt, type Generate } from "../lib/judge.ts";

export default defineRoute({
  name: "test-judge",
  method: "POST",
  path: "/test/judge",
  requireAuth: true,
  async handle(ctx) {
    if (ctx.auth?.type !== "admin") { ctx.set.status = 403; return { error: "Forbidden", code: 403 }; }
    const b = ctx.body as { attempt: string; fake: "miss" | "record" };
    const calls: unknown[] = [];
    const fake: Generate = async (input) => {
      calls.push({
        system: input.system, prompt: input.prompt, hasSchema: !!input.outputSchema, model: input.model,
        attachments: input.attachments.map((a) => ({ name: a.name, mime: a.mime, bytes: a.bytes.byteLength })),
      });
      const names = input.criteria ?? [];
      const keep = b.fake === "miss" ? names.slice(0, -1) : names;
      return { text: JSON.stringify({ criteria: keep.map((name) => ({ name, stars: 3, reason: "fake" })) }), files: [], tokensIn: 1, tokensOut: 1, finishReason: "end_turn" };
    };
    const dataDir = ctx.helpers.os.env("VAULTBASE_DATA_DIR") || "./vaultbase_data";
    const result = await judgeAttempt({
      sql: ctx.helpers.sql,
      find: (c: string, id: string) => ctx.helpers.find(c, id),
      readFile: (s: string) => ctx.helpers.fs.readBytes(ctx.helpers.path.join(dataDir, "uploads", s)),
      provider: () => fake,
    }, b.attempt);
    return { data: { result, calls } };
  },
});
