// "Waiting for you" (docs/design Home): replies to paste back, and tasks for
// the owner to judge. Built from data Phase 1 already has.
import { reactive } from "@arrow-js/core";
import { list } from "../api.js";
import { load, runLabel } from "./data.js";

export const inbox = reactive({ count: 0, items: [], loaded: false });

export async function refreshInbox() {
  try {
    const [d, attempts] = await Promise.all([
      load("runs", "tasks", "roles", "workspaces", "contenders"),
      list("attempts", { filter: 'status = "waiting" || status = "submitted"' }),
    ]);
    const items = [];
    const groups = new Map();
    for (const a of attempts) {
      const run = d.byId.runs.get(a.run);
      if (!run) continue;
      const task = d.byId.tasks.get(a.task);
      const role = d.byId.roles.get(run.role);
      const ws = d.byId.workspaces.get(run.workspace);
      if (a.status === "waiting") {
        const key = "p:" + run.id + ":" + a.task;
        if (!groups.has(key)) {
          const g = { kind: "paste", run: run.id, task: a.task, runLabel: runLabel(d, run), taskTitle: task?.title || "a task", role: role?.name, workspace: ws?.name, names: [], attempts: [] };
          groups.set(key, g); items.push(g);
        }
        const g = groups.get(key);
        g.names.push(d.byId.contenders.get(a.contender)?.name || "a contender");
        g.attempts.push(a.id);
      } else if (run.judge === "me") {
        const key = "j:" + run.id + ":" + a.task;
        if (!groups.has(key)) {
          const g = { kind: "judge", run: run.id, task: a.task, runLabel: runLabel(d, run), taskTitle: task?.title || "a task", role: role?.name, workspace: ws?.name, outputType: task?.output_type, n: 0 };
          groups.set(key, g); items.push(g);
        }
        groups.get(key).n++;
      }
    }
    inbox.items = items;
    inbox.count = items.reduce((n, g) => n + (g.kind === "paste" ? g.attempts.length : 1), 0);
    inbox.loaded = true;
  } catch { /* signed out or offline: keep the last count */ }
}

export const itemTitle = (g) =>
  g.kind === "paste"
    ? g.names.length === 1 ? `Paste ${g.names[0]}'s reply: ${g.taskTitle}` : `Paste ${g.names.length} replies: ${g.taskTitle}`
    : `Judge ${g.n === 1 ? "an output" : g.n + " outputs"}: ${g.taskTitle}`;
export const itemHref = (g) => (g.kind === "paste" ? `#/handoff/${g.run}/${g.task}` : `#/judge/${g.run}/${g.task}`);
