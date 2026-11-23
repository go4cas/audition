// 5. Role and rubric (and "Add role"): name, group, description, the rubric
// with a live weight bar, pass mark, usual output type, and the role's tasks.
import { html, reactive } from "@arrow-js/core";
import { create, remove, update } from "../api.js";
import { APP, go } from "../lib/nav.js";
import { dropdown, weightBar, weightTotal } from "../components/forms.js";
import { busy, crumbs, empty, page } from "../components/page.js";
import { TYPE_ICON, TYPE_LABEL, chip, errorToast, icon, plural, popId, toast } from "../lib/ui.js";
import { load } from "../state/data.js";

const PASS = [3, 3.5, 4, 4.5].map((v) => ({ value: v, label: v.toFixed(1) + " stars", icon: "star", desc: { 3: "Usable, needs some fixing", 3.5: "Solid, with small issues", 4: "Strong, ready to use", 4.5: "Excellent" }[v] }));
const TYPES = ["text", "image", "file", "code"].map((t) => ({ value: t, label: TYPE_LABEL[t], icon: TYPE_ICON[t], desc: t === "code" ? "Names a repository and commit" : undefined }));
// Phase 2a: "was the call right later?" checks, for roles whose calls play out over time.
const OUTCOME = [
  { value: null, label: "Off", icon: "draft", desc: "Judged once, on the day" },
  { value: 7, label: "After 1 week", icon: "time" },
  { value: 14, label: "After 2 weeks", icon: "time" },
  { value: 28, label: "After 4 weeks", icon: "time", desc: "Good for stock calls" },
  { value: 91, label: "After 3 months", icon: "time" },
];
const SWATCH = ["var(--accent)", "color-mix(in srgb, var(--accent) 68%, var(--surface))", "color-mix(in srgb, var(--accent) 42%, var(--surface))", "color-mix(in srgb, var(--accent) 22%, var(--surface))"];

export default function role({ params, query }) {
  const isNew = !params.id;
  const passPop = popId();
  return page({
    screen: "role",
    load: async (s) => {
      s.d = await load("workspaces", "groups", "roles", "tasks", "runs");
      const r = isNew ? null : s.d.byId.roles.get(params.id);
      if (!isNew && !r) throw new Error("This role doesn't exist any more.");
      s.r = r;
      s.ws = s.d.byId.workspaces.get(isNew ? params.ws : r.workspace);
      if (!s.ws) throw new Error("This workspace doesn't exist any more.");
      s.f = reactive({
        name: r?.name || "", description: r?.description || "", group: r ? r.group : query.group || null,
        pass_mark: r?.pass_mark ?? 3.5, default_output_type: r?.default_output_type || "text",
        outcome_after_days: r?.outcome_after_days || null,
        rubric: (r?.rubric || [{ name: "", weight: 100, guidance: "" }]).map((c) => ({ ...c })),
      });
    },
    body: (s) => {
      const { d, ws, f, r } = s;
      const groups = d.groups.filter((x) => x.workspace === ws.id);
      const groupOpts = [...groups.map((x) => ({ value: x.id, label: x.name, icon: "group" })), { value: null, label: "No group", icon: "draft", desc: "Sits on its own, outside the groups" }];
      const outcomeOpts = OUTCOME.some((o) => o.value === f.outcome_after_days) ? OUTCOME : [...OUTCOME, { value: f.outcome_after_days, label: `After ${f.outcome_after_days} days`, icon: "time" }];
      const weights = () => f.rubric.map((c) => c.weight);
      const tasks = r ? d.tasks.filter((t) => t.role === r.id && !d.tasks.some((n) => n.previous_version === t.id)) : [];
      const runs = r ? d.runs.filter((x) => x.role === r.id).length : 0;
      const save = (e) => busy(e, async () => {
        e.preventDefault();
        const rubric = f.rubric.map((c) => ({ name: c.name.trim(), weight: Number(c.weight) || 0, guidance: c.guidance.trim() })).filter((c) => c.name);
        if (rubric.reduce((a, c) => a + c.weight, 0) !== 100) { toast("Rubric weights need to add up to 100", "error", "warning"); return; }
        const body = { workspace: ws.id, name: f.name.trim(), description: f.description.trim(), group: f.group || null, pass_mark: Number(f.pass_mark), default_output_type: f.default_output_type, outcome_after_days: f.outcome_after_days || null, rubric };
        try {
          const saved = isNew ? await create("roles", body) : await update("roles", r.id, body);
          toast(isNew ? "Role added" : "Role saved. Old scores keep their rubric.");
          if (isNew) go("/r/" + saved.id); else s.reload({ quiet: true });
        } catch (err) { errorToast(err); }
      });
      const del = (e) => busy(e, async () => {
        if (!confirm(`Delete the role "${r.name}" and its tasks?`)) return;
        try { for (const t of d.tasks.filter((t) => t.role === r.id)) await remove("tasks", t.id); await remove("roles", r.id); toast("Role deleted"); go("/w/" + ws.id); } catch (err) { errorToast(err); }
      });
      return html`
        ${crumbs([["Workspaces", APP + "/"], [ws.name, APP + "/w/" + ws.id], r ? (d.byId.groups.get(r.group)?.name || "No group") : "New role"])}
        <div class="page-head">
          <div><h1>${r ? r.name : "Add a role"}</h1><p class="lede">${r ? r.description || "What this role does goes at the top of every prompt." : "A role is one job in this workflow. Contenders audition for it."}</p></div>
          ${r ? html`<div class="row"><a class="btn" href="${APP + "/leaderboard/" + r.id}">${icon("leaderboard")}Leaderboard</a><a class="btn btn--primary" href="${APP + "/runs/new?role=" + r.id}">${icon("play")}Start a run</a></div>` : ""}
        </div>
        <form class="stack" @submit="${save}">
          <div class="panel"><div class="panel__body">
            <div class="fields-2">
              <div class="field"><label for="ro-name">Role name</label><input class="input" id="ro-name" required value="${f.name}" @input="${(e) => { f.name = e.target.value; }}" placeholder="UI engineer"></div>
              <div class="field"><label for="ro-group">Group</label>${dropdown({ id: "ro-group", label: "Group", options: () => groupOpts, value: () => f.group, onChange: (v) => { f.group = v; } })}</div>
            </div>
            <div class="field"><label for="ro-desc">What this role does</label><input class="input" id="ro-desc" value="${f.description}" @input="${(e) => { f.description = e.target.value; }}" placeholder="Builds accessible, responsive screens from a spec."><span class="hint">Goes at the top of every prompt, so contenders know the job.</span></div>
          </div></div>

          <div class="panel">
            <div class="panel__head"><div class="stack-sm gap-2"><h2>${icon("rubric")}Rubric</h2><p class="muted small">What good looks like. The judge gives 1 to 5 stars per line.</p></div>${weightTotal(weights, "Weights add up to 100%")}</div>
            <div class="panel__body">
              ${weightBar(weights)}
              <div class="rubric-row hide-phone xs muted"><span></span><span>Criterion</span><span>Weight %</span><span>Guidance for the judge</span><span></span></div>
              ${() => f.rubric.map((c, i) => html`<div class="rubric-row">
                <span class="swatch" style="${"background:" + SWATCH[i % 4]}"></span>
                <input class="input" aria-label="${"Criterion " + (i + 1)}" value="${() => c.name}" @input="${(e) => { c.name = e.target.value; }}" placeholder="Accuracy" required>
                <input class="input num" type="number" min="1" max="100" aria-label="${"Weight " + (i + 1)}" value="${() => c.weight}" @input="${(e) => { c.weight = Number(e.target.value); }}">
                <input class="input guidance" aria-label="${"Guidance " + (i + 1)}" value="${() => c.guidance}" @input="${(e) => { c.guidance = e.target.value; }}" placeholder="What earns five stars">
                <button class="icon-btn remove" type="button" data-tip="Remove" aria-label="${"Remove criterion " + (i + 1)}" disabled="${f.rubric.length < 2}" @click="${() => f.rubric.splice(i, 1)}">${icon("trash")}</button>
              </div>`)}
              <button class="btn btn--ghost self-start" type="button" disabled="${() => f.rubric.length >= 8}" @click="${() => f.rubric.push({ name: "", weight: 0, guidance: "" })}">${icon("plus")}Add criterion</button>
              <div class="fields-2">
                <div class="field"><label for="ro-pass">${icon("pass-mark")}Pass mark <button class="info-btn" type="button" popovertarget="${passPop}" aria-label="What is the pass mark?">${icon("help")}</button></label>
                  ${dropdown({ id: "ro-pass", label: "Pass mark", options: () => PASS, value: () => f.pass_mark, onChange: (v) => { f.pass_mark = v; } })}</div>
                <div class="field"><label for="ro-type">Usual output</label>${dropdown({ id: "ro-type", label: "Usual output", options: () => TYPES, value: () => f.default_output_type, onChange: (v) => { f.default_output_type = v; } })}</div>
                <div class="field"><label for="ro-outcome">${icon("time")}Check the outcome</label>${dropdown({ id: "ro-outcome", label: "Check the outcome", options: () => outcomeOpts, value: () => f.outcome_after_days, onChange: (v) => { f.outcome_after_days = v; } })}
                  <span class="hint">For calls that play out later. On the day, you're asked "Was the call right?". It shows as its own column on the leaderboard.</span></div>
              </div>
              <div class="pop" id="${passPop}" popover><div class="pop__head">${icon("pass-mark")}Pass mark</div><div class="pop__body"><p>A contender has to average more than this to be suggested as champion. 3.5 stars means "solid, with small issues".</p><p class="xs muted">Changing the rubric later is safe: old scores keep the rubric they were judged with.</p></div></div>
            </div>
          </div>
          <div class="row"><button class="btn btn--primary" type="submit">${icon("check")}${isNew ? "Add role" : "Save role"}</button>
            ${r && !runs ? html`<button class="btn btn--quiet" type="button" @click="${del}">${icon("trash")}Delete role</button>` : ""}
            ${isNew ? html`<a class="btn btn--quiet" href="${APP + "/w/" + ws.id}">Cancel</a>` : ""}</div>
        </form>

        ${r ? html`<div class="panel">
          <div class="panel__head"><h2>${icon("file")}Tasks</h2><a class="btn btn--sm" href="${APP + "/r/" + r.id + "/tasks/new"}">${icon("plus")}New task</a></div>
          ${tasks.length ? html`<ul class="list list--hover">${tasks.map((t) => html`<li>
            ${icon(TYPE_ICON[t.output_type] || "text", "i--lg muted")}
            <div class="grow"><a class="title" href="${APP + "/t/" + t.id}">${t.title}</a><div class="muted small row-tight">${t.base_ref ? html`<span>${icon("branch")} ${String(t.base_ref.repo || "").split("/").pop()}</span><span>${icon("commit")} ${String(t.base_ref.commit || "").slice(0, 7)}</span>` : html`<span>${TYPE_LABEL[t.output_type]}</span>`}${t.attachments?.length ? html`<span>${plural(t.attachments.length, "attachment")}</span>` : ""}${t.previous_version ? html`<span class="badge">Version ${versionOf(d, t)}</span>` : ""}</div></div>
            ${t.locked ? html`<span data-tip="Used in a run, so it can't change">${chip("locked", "Read-only")}</span>` : chip("draft", "Not used yet")}
          </li>`)}</ul>` : empty("file", "No tasks yet", "Tasks are what contenders work on. Every contender gets the same task text.", html`<a class="btn btn--primary" href="${APP + "/r/" + r.id + "/tasks/new"}">${icon("plus")}New task</a>`)}
        </div>` : ""}`;
    },
  });
}

export function versionOf(d, t) {
  let n = 1, cur = t;
  while (cur?.previous_version) { n++; cur = d.byId.tasks.get(cur.previous_version); }
  return n;
}
