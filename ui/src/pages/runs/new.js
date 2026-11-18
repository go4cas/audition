// 9. Start a run: pick a role, tasks and contenders, choose the judge, and see
// the call count (the spending guard) from POST /runs/preview before starting.
import { html, reactive } from "@arrow-js/core";
import { custom } from "../../api.js";
import { APP, go, routeArgs } from "../../lib/nav.js";
import { dropdown, seg } from "../../components/forms.js";
import { busy, crumbs, empty, page } from "../../components/page.js";
import { METHOD_HINT, METHOD_OPTIONS, TYPE_ICON, TYPE_LABEL, avatar, bump, errorToast, icon, num, plural, popId, toast } from "../../lib/ui.js";
import { load, sortRoles } from "../../state/data.js";

export const meta = { title: "Start a run · Audition" };

export default function newRun() {
  const { query } = routeArgs();
  const callsPop = popId();
  return page({
    screen: "new-run",
    load: async (s) => {
      s.d = await load("workspaces", "stages", "roles", "tasks", "contenders", "connections");
      const d = s.d;
      const roles = query.ws ? d.roles.filter((r) => r.workspace === query.ws) : d.roles;
      const role = d.byId.roles.get(query.role) || sortRoles(d, roles)[0] || null;
      s.f = reactive({ role: role?.id || null, tasks: [], contenders: [], judge: "me", method: "rate", preview: null, previewError: null });
      s.pickRole(role?.id);
    },
    init: {
      pickRole(id) {
        const s = this, d = s.d, r = d.byId.roles.get(id);
        s.f.role = id || null;
        s.f.tasks = r ? latestTasks(d, r.id).map((t) => t.id) : [];
        const ws = r && d.byId.workspaces.get(r.workspace);
        s.f.judge = ws?.default_judge === "ai" && ws.judge_contender ? "ai" : "me";
        s.f.method = ws?.default_method === "compare" ? "compare" : "rate";
      },
    },
    body: (s) => {
      const { d, f } = s;
      const role = () => d.byId.roles.get(f.role);
      const ws = () => role() && d.byId.workspaces.get(role().workspace);
      const judge = () => ws()?.judge_contender && d.byId.contenders.get(ws().judge_contender);
      const contenders = d.contenders.filter((c) => c.enabled !== false && c.mode !== "runner" && !d.contenders.some((n) => n.previous_version === c.id));
      const roleOpts = sortRoles(d, d.roles).map((r) => ({ value: r.id, label: r.name, icon: "rubric", group: d.byId.workspaces.get(r.workspace)?.name, desc: `${plural(latestTasks(d, r.id).length, "task")}${r.stage ? " · " + (d.byId.stages.get(r.stage)?.name || "") : ""}` }));
      const toggle = (list, id, on) => { const i = list.indexOf(id); if (on && i < 0) list.push(id); if (!on && i >= 0) list.splice(i, 1); };

      // The summary: the server's preview when it answers, else the same sums locally (TECH-SPEC §8).
      const local = () => {
        const api = f.contenders.filter((id) => d.byId.contenders.get(id)?.mode === "api").length;
        const manual = f.contenders.length - api;
        const outputs = f.tasks.length * f.contenders.length;
        const jc = judge(), mockJudge = jc && d.byId.connections.get(jc.connection)?.provider === "mock";
        const pairs = (f.contenders.length * (f.contenders.length - 1)) / 2;
        const judged = f.method === "compare" ? f.tasks.length * pairs : outputs;
        const judge_calls = f.judge === "ai" && !mockJudge ? judged : 0;
        return { outputs, api_calls: f.tasks.length * api, handoff_outputs: f.tasks.length * manual, judge_calls, total_provider_calls: f.tasks.length * api + judge_calls, warnings: [] };
      };
      let timer = 0, seq = 0;
      const refreshPreview = () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          const n = ++seq;
          if (!f.role || !f.tasks.length || !f.contenders.length) { f.preview = null; return; }
          try { const p = await custom.preview({ role: f.role, tasks: [...f.tasks], contenders: [...f.contenders], judge: f.judge, method: f.method }); if (n === seq) { f.preview = p; f.previewError = null; } }
          catch (e) { if (n === seq) { f.preview = null; f.previewError = e.status === 404 ? null : e.message; } }
        }, 150);
      };
      const sum = () => f.preview || local();
      const tick = (key) => () => { const v = sum()[key]; queueMicrotask(() => bump(document.getElementById("sum-" + key))); return num(v); };
      const start = (e) => busy(e, async () => {
        try {
          const r = await custom.startRun({ role: f.role, tasks: [...f.tasks], contenders: [...f.contenders], judge: f.judge, method: f.method });
          const run = r.run || r;
          toast("Run started", "done", "play");
          go("/runs/" + (run.id || run));
        } catch (err) { errorToast(err); }
      });
      refreshPreview();
      const w = ws();
      return html`
        ${crumbs(w ? [["Workspaces", APP + "/"], [w.name, APP + "/w/" + w.id]] : [["Workspaces", APP + "/"]])}
        <h1>Start a run</h1>
        ${!d.roles.length ? empty("rubric", "No roles yet", "Add a role with a rubric and some tasks first.", html`<a class="btn btn--primary" href="${APP + "/"}">Go to workspaces</a>`) : html`
        <div class="run-layout">
          <form class="stack minw0" @submit="${(e) => e.preventDefault()}" @change="${refreshPreview}">
            <div class="field"><label for="nr-role">Role</label>${dropdown({ id: "nr-role", label: "Role", options: () => roleOpts, value: () => f.role, onChange: (v) => { s.pickRole(v); refreshPreview(); } })}</div>
            <fieldset class="stack-sm plain">
              <legend class="eyebrow">${icon("file")}Tasks</legend>
              ${() => { const tasks = f.role ? latestTasks(d, f.role) : []; return tasks.length ? html`<div class="check-list">${tasks.map((t) => html`<label class="check"><input type="checkbox" checked="${() => f.tasks.includes(t.id)}" @change="${(e) => toggle(f.tasks, t.id, e.target.checked)}"><span class="check__box">${icon("check")}</span><span><strong>${t.title}</strong><br><span class="muted small row-tight">${icon(TYPE_ICON[t.output_type])}${TYPE_LABEL[t.output_type]}</span></span></label>`)}</div>` : html`<p class="small muted">This role has no tasks yet. <a href="${APP + "/r/" + f.role + "/tasks/new"}">Add one</a></p>`; }}
            </fieldset>
            <fieldset class="stack-sm plain">
              <legend class="eyebrow">${icon("contenders")}Contenders</legend>
              <div class="check-list">${contenders.map((c) => html`<label class="check"><input type="checkbox" checked="${() => f.contenders.includes(c.id)}" @change="${(e) => toggle(f.contenders, c.id, e.target.checked)}"><span class="check__box">${icon("check")}</span><span class="who">${avatar(c.name, "sm")}<span><strong>${c.name}</strong><br><span class="who__meta">${c.mode === "api" ? html`${icon("api")}API · up to ${num(c.max_output_tokens)} tokens` : html`${icon("paste")}Copy and paste`}</span></span></span></label>`)}</div>
            </fieldset>
            <div class="field">
              <span class="label" id="nr-judge-label">Who judges</span>
              ${() => seg({ name: "nr-judge", labelId: "nr-judge-label", value: () => f.judge, onChange: (v) => { f.judge = v; refreshPreview(); }, options: [{ value: "me", label: "Me", icon: "me" }, { value: "ai", label: judge() ? "AI · " + judge().name : "AI", icon: "ai" }], disabled: () => false })}
              ${() => (!judge() ? html`<span class="hint">To let an AI judge, pick one in the <a href="${APP + "/w/" + (ws()?.id || "") + "/settings"}">workspace settings</a>.</span>` : "")}
            </div>
            <div class="field">
              <span class="label" id="nr-method-label">How to judge</span>
              ${() => seg({ name: "nr-method", labelId: "nr-method-label", value: () => f.method, onChange: (v) => { f.method = v; refreshPreview(); }, options: METHOD_OPTIONS })}
              <span class="hint">${() => METHOD_HINT[f.method] + (f.method === "compare" ? ` With these contenders: ${plural(pairsOf(f.contenders.length), "pair")} per task.` : "")}</span>
            </div>
            ${() => (sum().warnings || []).map((w) => html`<div class="notice" data-state="warning">${icon("warning")}<div><strong>${w}</strong> A judge may favour its own family. You can go ahead, or judge this run yourself.</div></div>`)}
            ${() => (f.previewError ? html`<div class="notice" data-state="error">${icon("error")}<div>${f.previewError}</div></div>` : "")}
          </form>
          <aside class="summary" aria-live="polite">
            <span class="eyebrow">This run makes</span>
            <div><span class="summary__big tick" id="sum-outputs">${tick("outputs")}</span> <span class="text-2">outputs</span></div>
            <p class="small muted">${() => `${plural(f.tasks.length, "task")} × ${plural(f.contenders.length, "contender")}`}</p>
            <dl>
              <dt>${icon("api")}Provider calls for outputs</dt><dd><span class="tick" id="sum-api_calls">${tick("api_calls")}</span></dd>
              <dt>${icon("ai")}Calls to the AI judge</dt><dd><span class="tick" id="sum-judge_calls">${tick("judge_calls")}</span></dd>
              <dt><strong>Provider calls in total</strong> <button class="info-btn" type="button" popovertarget="${callsPop}" aria-label="How calls are counted">${icon("help")}</button></dt><dd><strong class="tick" id="sum-total_provider_calls" data-testid="call-count">${tick("total_provider_calls")}</strong></dd>
              <dt>${icon("paste")}Replies you paste back</dt><dd><span class="tick" id="sum-handoff_outputs">${tick("handoff_outputs")}</span></dd>
            </dl>
            <div class="pop" id="${callsPop}" popover><div class="pop__head">${icon("api")}How calls are counted</div><div class="pop__body"><p>Each API contender is called once per task. The AI judge is called once per output, or once per pair when you compare. Copy-and-paste contenders cost no calls, and neither does the built-in mock.</p><p class="xs muted">Every API call stops at the contender's max output tokens.</p></div></div>
            <span class="tip-grid" data-tip="${() => (!f.tasks.length || !f.contenders.length ? "Pick at least one task and one contender" : f.method === "compare" && f.contenders.length < 2 ? "Compare needs at least two contenders" : "")}"><button class="btn btn--primary btn--lg" type="button" id="start-run" disabled="${() => !f.tasks.length || !f.contenders.length || (f.method === "compare" && f.contenders.length < 2)}" @click="${start}">${icon("play")}Start run</button></span>
          </aside>
        </div>`}`;
    },
  });
}

export const latestTasks = (d, roleId) => d.tasks.filter((t) => t.role === roleId && !d.tasks.some((n) => n.previous_version === t.id));

const pairsOf = (n) => (n < 2 ? 0 : (n * (n - 1)) / 2);
