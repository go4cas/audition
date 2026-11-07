// GET /api/custom/handoff/:runId/:taskId (TECH-SPEC §7): the copy-and-paste
// block for one task of a run. The prompt is the stored `prompt_sent`, the
// same string every attempt on that run and task holds.
import { defineRoute } from "vaultbase";
import { fileList, originalNames } from "../lib/handoff.ts";

const isOwner = (a: { type?: string; collection?: string } | null) => a?.type === "user" && a.collection === "users";

export default defineRoute({
  name: "handoff",
  method: "GET",
  path: "/handoff/:runId/:taskId",
  requireAuth: true,
  async handle(ctx) {
    if (!isOwner(ctx.auth)) { ctx.set.status = 403; return { error: "Forbidden", code: 403 }; }
    const { runId, taskId } = ctx.params;
    const sql = ctx.helpers.sql;
    const attempts = await sql.query(
      `SELECT a.id, a.mode, a.status, a.prompt_sent, c.name AS contender_name
         FROM vb_attempts a LEFT JOIN vb_contenders c ON c.id = a.contender
        WHERE a.run = ? AND a.task = ? ORDER BY a.created_at, a.id`,
      [runId, taskId],
    ) as Array<{ id: string; mode: string; status: string; prompt_sent: string | null; contender_name: string | null }>;
    if (attempts.length === 0) { ctx.set.status = 404; return { error: "That run has no outputs for this task.", code: 404 }; }
    const prompts = new Set(attempts.map((a) => a.prompt_sent ?? ""));
    if (prompts.size !== 1) { ctx.set.status = 500; return { error: "The outputs of this task hold different prompts.", code: 500 }; }

    const task = await ctx.helpers.find("tasks", taskId);
    const stored = fileList(task?.["attachments"]);
    const names = await originalNames(sql, stored);
    return {
      prompt: attempts[0]!.prompt_sent ?? "",
      attachments: stored.map((s) => ({ name: names.get(s)?.original ?? s, url: `/api/v1/files/${encodeURIComponent(s)}` })),
      waiting: attempts
        .filter((a) => a.mode === "handoff" && a.status === "waiting")
        .map((a) => ({ attempt: a.id, contender_name: a.contender_name ?? "" })),
    };
  },
});
