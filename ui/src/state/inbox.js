// "Waiting for you" (docs/design Home): replies to paste back, tasks for the
// owner to judge, outcome checks that came due, and a champion that has been
// on trial for a few days (keep it or restore the one before, TECH-SPEC §11a).
import { reactive } from "@arrow-js/core";
import { custom, list } from "../api.js";
import { load, runLabel } from "./data.js";
import { APP } from "../lib/nav.js";

export const inbox = reactive({ count: 0, items: [], loaded: false });

/** A new champion shows up in "Waiting for you" once it has been on trial for its workspace's trial_days (default 3). */
export const DEFAULT_TRIAL_DAYS = 3;

/**
 * Reload the list. Calls that arrive while one is loading share it, plus one
 * more load at the end, so a burst of changes (a run page's live counts, a
 * route change) costs two loads, not one per call: the list makes eight
 * requests, and Vaultbase rate-limits /api/* (RF2).
 */
let loading = null;
let again = false;
export function refreshInbox() {
  if (loading) { again = true; return loading; }
  loading = (async () => {
    try { do { again = false; await loadInbox(); } while (again); } finally { loading = null; }
  })();
  return loading;
}

async function loadInbox() {
  try {
    const [d, attempts, outcomes] = await Promise.all([
      load("runs", "tasks", "roles", "workspaces", "contenders", "castings"),
      list("attempts", { filter: 'status = "waiting" || status = "submitted"' }),
      custom.outcomes().catch(() => ({ due: [] })),
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
    // Phase 2a: outcome checks that came due ("was the call right?").
    for (const o of outcomes.due || []) {
      const run = d.byId.runs.get(o.run);
      items.push({ kind: "outcome", id: o.id, run: o.run, task: o.task, runLabel: run ? runLabel(d, run) : "A run", taskTitle: o.task_title, role: o.role_name, workspace: o.workspace_name });
    }
    // A champion on trial for a few days: time to keep it or restore the one before.
    const nowS = Date.now() / 1000;
    for (const role of d.roles) {
      const c = d.castings.find((x) => x.role === role.id && x.confirmed);
      const days = Number(d.byId.workspaces.get(role.workspace)?.trial_days) || DEFAULT_TRIAL_DAYS;
      if (!c?.trial || nowS - Number(c.since) < days * 86400) continue;
      items.push({ kind: "trial", roleId: role.id, role: role.name, workspace: d.byId.workspaces.get(role.workspace)?.name, runLabel: "Champion", taskTitle: d.byId.contenders.get(c.contender)?.name || "The new champion" });
    }
    inbox.items = items;
    inbox.count = items.reduce((n, g) => n + (g.kind === "paste" ? g.attempts.length : 1), 0);
    inbox.loaded = true;
  } catch { /* signed out or offline: keep the last count */ }
}

export const itemTitle = (g) =>
  g.kind === "trial" ? `Keep or restore: ${g.taskTitle} is on trial`
  : g.kind === "outcome" ? `Check the outcome: ${g.taskTitle}`
  : g.kind === "paste"
    ? g.names.length === 1 ? `Paste ${g.names[0]}'s reply: ${g.taskTitle}` : `Paste ${g.names.length} replies: ${g.taskTitle}`
    : `Judge ${g.n === 1 ? "an output" : g.n + " outputs"}: ${g.taskTitle}`;
export const itemHref = (g) => (g.kind === "trial" ? `${APP}/leaderboard/${g.roleId}` : g.kind === "outcome" ? `${APP}/outcomes` : g.kind === "paste" ? `${APP}/handoff/${g.run}/${g.task}` : `${APP}/judge/${g.run}/${g.task}`);
/** The item's kind in words and its icon. */
/** The Up next button's label. Lighthouse flags a bare "Start" as a link without descriptive text. */
export const itemAction = (g) => (g.kind === "trial" ? "Decide" : g.kind === "outcome" ? "Check outcome" : g.kind === "paste" ? "Paste replies" : "Start judging");
export const itemKind = (g) => (g.kind === "trial" ? ["Champion on trial", "champion"] : g.kind === "outcome" ? ["Check the outcome", "time"] : g.kind === "paste" ? ["Copy and paste", "paste"] : ["Judge", "judge"]);
