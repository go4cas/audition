// GET /api/custom/handoff/:runId/:taskId (TECH-SPEC §7): the copy-and-paste
// block for one task of a run. The prompt is the stored `prompt_sent`, the
// same string every attempt on that run and task holds.
import { defineRoute } from "vaultbase";
import { fileList, originalNames } from "../lib/handoff.ts";
import { ownerRoute, RunError } from "../lib/runs.ts";

export default defineRoute({
  name: "handoff",
  method: "GET",
  path: "/handoff/:runId/:taskId",
  requireAuth: true,
  handle: (ctx) => ownerRoute(ctx, async () => {
    const runId = String(ctx.params["runId"]);
    const taskId = String(ctx.params["taskId"]);
    const sql = ctx.helpers.sql;
    const attempts = await sql.query(
      `SELECT a.id, a.mode, a.status, a.prompt_sent, c.name AS contender_name
         FROM vb_attempts a LEFT JOIN vb_contenders c ON c.id = a.contender
        WHERE a.run = ? AND a.task = ? ORDER BY a.created_at, a.id`,
      [runId, taskId],
    ) as Array<{ id: string; mode: string; status: string; prompt_sent: string | null; contender_name: string | null }>;
    if (attempts.length === 0) throw new RunError(404, "That run has no outputs for this task.");
    const prompts = new Set(attempts.map((a) => a.prompt_sent ?? ""));
    if (prompts.size !== 1) throw new RunError(500, "The outputs of this task hold different prompts.");

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
  }),
});
