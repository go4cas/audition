// Test only: POST /api/custom/test/probe answers questions about the hook
// runtime for test/findings.test.ts (F1, F3, F4, F6). Admin only.
import { defineRoute } from "vaultbase";

export default defineRoute({
  name: "test-probe",
  method: "POST",
  path: "/test/probe",
  requireAuth: true,
  async handle(ctx) {
    if (ctx.auth?.type !== "admin") { ctx.set.status = 403; return { error: "Forbidden", code: 403 }; }
    const q = ctx.query["q"];
    if (q === "helpers") return { data: Object.keys(ctx.helpers).sort() };
    if (q === "body") return { data: { body: ctx.body ?? null, type: typeof ctx.body } };
    if (q === "template") {
      const vars = { a: true, name: "Ada", list: ["x", "y"], nested: { repo: "r" } };
      return { data: {
        ifTrue: ctx.helpers.template.render("{{#if a}}yes {{name}}{{/if}}", vars),
        path: ctx.helpers.template.render("{{nested.repo}}", vars),
        loop: ctx.helpers.template.render("{{#each list}}[{{this}}]{{/each}}", vars),
      } };
    }
    if (q === "egress") {
      const url = String((ctx.body as { url?: string } | null)?.url);
      try {
        const r = await ctx.helpers.http.request({ url, method: "GET", retries: 0, timeoutMs: 3000 } as never);
        return { data: { ok: true, status: (r as { status: number }).status } };
      } catch (e) {
        return { data: { ok: false, error: e instanceof Error ? e.message : String(e) } };
      }
    }
    ctx.set.status = 422;
    return { error: "unknown probe", code: 422 };
  },
});
