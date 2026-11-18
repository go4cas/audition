// Test only: POST /api/custom/test/generate runs lib/runs.ts runGenerate on
// the real database and file store, with a fake helpers.http in place of the
// network. The fake answers like an OpenAI-compatible Images API with the
// given base64 images, and the route returns every request it saw. Admin only.
import { defineRoute } from "vaultbase";
import { runGenerate, workerDepsFrom } from "../lib/runs.ts";

export default defineRoute({
  name: "test-generate",
  method: "POST",
  path: "/test/generate",
  requireAuth: true,
  async handle(ctx) {
    if (ctx.auth?.type !== "admin") { ctx.set.status = 403; return { error: "Forbidden", code: 403 }; }
    const b = ctx.body as { attempt: string; images: string[]; usage?: Record<string, number> };
    const seen: Array<{ url: string; contentType: string; json?: unknown; bytes?: number }> = [];
    const deps = workerDepsFrom(ctx.helpers);
    deps.http = {
      async request(opts) {
        const ct = opts.headers?.["content-type"] ?? "";
        seen.push({ url: opts.url, contentType: ct, ...(opts.body instanceof Uint8Array ? { bytes: opts.body.byteLength } : { json: opts.body }) });
        const json = { created: 1, data: b.images.map((b64_json) => ({ b64_json })), usage: b.usage ?? { input_tokens: 50, output_tokens: 4160 } };
        return { status: 200, ok: true, headers: { "content-type": "application/json" }, text: JSON.stringify(json), json };
      },
    };
    const result = await runGenerate(deps, b.attempt);
    return { data: { result, seen } };
  },
});
