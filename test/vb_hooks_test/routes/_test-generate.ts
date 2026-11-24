// Test only: POST /api/custom/test/generate runs lib/runs.ts runGenerate on
// the real database and file store, with a fake helpers.http in place of the
// network. The fake answers like an OpenAI-compatible Images API with the
// given base64 images, and the route returns every request it saw. Admin only.
// With { replicate: true } it answers like Replicate instead: the prediction
// is still processing, then succeeds with links on replicate.delivery, and
// getBytes serves the given images from those links (§12b).
import { defineRoute } from "vaultbase";
import { runGenerate, workerDepsFrom } from "../lib/runs.ts";

export default defineRoute({
  name: "test-generate",
  method: "POST",
  path: "/test/generate",
  requireAuth: true,
  async handle(ctx) {
    if (ctx.auth?.type !== "admin") { ctx.set.status = 403; return { error: "Forbidden", code: 403 }; }
    const b = ctx.body as { attempt: string; images: string[]; usage?: Record<string, number>; replicate?: boolean };
    const seen: Array<{ url: string; contentType: string; json?: unknown; bytes?: number; method?: string }> = [];
    const deps = workerDepsFrom(ctx.helpers);
    if (b.replicate) {
      const links = b.images.map((_, i) => `https://replicate.delivery/xezq/test/out-${i}.png`);
      const get = "https://api.replicate.com/v1/predictions/p1";
      let polls = 0;
      deps.http = {
        async request(opts) {
          seen.push({ url: opts.url, method: opts.method ?? "GET", contentType: opts.headers?.["content-type"] ?? "", ...(opts.body ? { json: opts.body } : {}) });
          const done = opts.method === "GET" && ++polls >= 1;
          const json = { id: "p1", status: done ? "succeeded" : "processing", output: done ? links : null, urls: { get, cancel: `${get}/cancel` } };
          return { status: opts.method === "POST" ? 201 : 200, ok: true, headers: { "content-type": "application/json" }, text: JSON.stringify(json), json };
        },
        async getBytes(url) {
          seen.push({ url, method: "GET bytes", contentType: "" });
          const i = links.indexOf(url);
          if (i < 0) throw new Error("404 Not Found");
          return new Uint8Array(Buffer.from(b.images[i]!, "base64"));
        },
      };
      const result = await runGenerate({ ...deps, sleep: async () => {} }, b.attempt);
      return { data: { result, seen } };
    }
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
