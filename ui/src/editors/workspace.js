// 4. Workspace settings (and "New workspace"): name, stages, judging, and
// what makes a champion (fitness weights, which must add up to 100).
import { html, reactive } from "@arrow-js/core";
import { create, remove, update } from "../api.js";
import { APP, go } from "../lib/nav.js";
import { dropdown, seg, weightBar, weightTotal } from "../components/forms.js";
import { busy, crumbs, page } from "../components/page.js";
import { METHOD_HINT, METHOD_OPTIONS, errorToast, icon, popId, toast } from "../lib/ui.js";
import { contenderMeta, load } from "../state/data.js";

export default function workspaceSettings({ params }) {
  const isNew = !params.id;
  const minPop = popId();
  return page({
    narrow: true, screen: "workspace-settings",
    load: async (s) => {
      s.d = await load("workspaces", "stages", "contenders", "connections");
      const ws = isNew ? null : s.d.byId.workspaces.get(params.id);
      if (!isNew && !ws) throw new Error("This workspace doesn't exist any more.");
      const w = ws?.fitness_weights || { quality: 100, tokens: 0, time: 0 };
      s.f = reactive({
        name: ws?.name || "", description: ws?.description || "", default_judge: ws?.default_judge || "me",
        default_method: ws?.default_method || "rate",
        judge_contender: ws?.judge_contender || null, composer_contender: ws?.composer_contender || null, min_outputs: ws?.min_outputs ?? 5,
        q: w.quality, t: w.tokens, dt: w.time,
        stages: (isNew ? [] : s.d.stages.filter((x) => x.workspace === params.id)).map((x) => ({ id: x.id, name: x.name })),
        removed: [],
      });
      s.ws = ws;
    },
    body: (s) => {
      const f = s.f;
      const judges = s.d.contenders.filter((c) => c.mode === "api" && c.enabled !== false && !c.config?.image).map((c) => ({ value: c.id, label: c.name, avatar: c.name, desc: contenderMeta(s.d, c) }));
      // The Composer is optional: "No Composer" keeps every task on the generic prompt.
      const composers = [{ value: "", label: "No Composer", icon: "close", desc: "Every task uses the plain prompt" }, ...judges];
      const weights = () => [f.q, f.t, f.dt];
      const move = (i, dir) => { const j = i + dir; if (j < 0 || j >= f.stages.length) return; const a = [...f.stages]; [a[i], a[j]] = [a[j], a[i]]; f.stages = a; };
      const save = (e) => busy(e, async () => {
        e.preventDefault();
        const total = weights().reduce((a, b) => a + (Number(b) || 0), 0);
        if (total !== 100) { toast("Fitness weights need to add up to 100", "error", "warning"); return; }
        if (f.default_judge === "ai" && !f.judge_contender) { toast("Pick an AI judge, or let yourself judge", "error", "warning"); return; }
        const body = {
          name: f.name.trim(), description: f.description.trim(), default_judge: f.default_judge, default_method: f.default_method,
          judge_contender: f.judge_contender || null, composer_contender: f.composer_contender || null, min_outputs: Number(f.min_outputs) || 1,
          fitness_weights: { quality: Number(f.q) || 0, tokens: Number(f.t) || 0, time: Number(f.dt) || 0 },
        };
        try {
          const ws = isNew ? await create("workspaces", body) : await update("workspaces", params.id, body);
          for (const id of f.removed) await remove("stages", id);
          let order = 1;
          for (const st of f.stages) {
            if (!st.name.trim()) continue;
            if (st.id) await update("stages", st.id, { name: st.name.trim(), order });
            else await create("stages", { workspace: ws.id, name: st.name.trim(), order });
            order++;
          }
          toast(isNew ? "Workspace created" : "Settings saved");
          go("/w/" + ws.id);
        } catch (err) { errorToast(err); }
      });
      return html`
        ${crumbs(isNew ? [["Workspaces", APP + "/"]] : [["Workspaces", APP + "/"], [s.ws.name, APP + "/w/" + s.ws.id]])}
        <h1>${isNew ? "New workspace" : "Workspace settings"}</h1>
        <form class="stack" @submit="${save}">
          <div class="panel"><div class="panel__body">
            <div class="field"><label for="ws-name">Name</label><input class="input" id="ws-name" required value="${f.name}" @input="${(e) => { f.name = e.target.value; }}" placeholder="For example: Content team"></div>
            <div class="field"><label for="ws-desc">Description</label><textarea class="textarea textarea--short" id="ws-desc" rows="2" value="${f.description}" @input="${(e) => { f.description = e.target.value; }}"></textarea></div>
          </div></div>

          <div class="panel">
            <div class="panel__head"><h2>${icon("stage")}Stages</h2><span class="muted small">Optional. The order work flows in.</span></div>
            <ul class="list list--hover">${() => f.stages.map((st, i) => html`<li>
              <input class="input input--bare grow" aria-label="${"Stage " + (i + 1)}" value="${() => st.name}" @input="${(e) => { st.name = e.target.value; }}" placeholder="Stage name">
              <button class="icon-btn" type="button" data-tip="Move up" aria-label="${"Move stage " + (i + 1) + " up"}" disabled="${i === 0}" @click="${() => move(i, -1)}">${icon("arrow-up")}</button>
              <button class="icon-btn" type="button" data-tip="Move down" aria-label="${"Move stage " + (i + 1) + " down"}" disabled="${i === f.stages.length - 1}" @click="${() => move(i, 1)}">${icon("arrow-down")}</button>
              <button class="icon-btn" type="button" data-tip="Remove" aria-label="${"Remove stage " + (i + 1)}" @click="${() => { if (st.id) f.removed.push(st.id); f.stages.splice(i, 1); }}">${icon("trash")}</button>
            </li>`)}</ul>
            <div class="panel__body panel__body--tight"><button class="btn btn--ghost self-start" type="button" @click="${() => f.stages.push({ id: null, name: "" })}">${icon("plus")}Add stage</button></div>
          </div>

          <div class="panel"><div class="panel__head"><h2>${icon("judge")}Judging</h2></div><div class="panel__body">
            <div class="field">
              <span class="label" id="ws-judge-label">Who judges new runs</span>
              ${seg({ name: "ws-judge", labelId: "ws-judge-label", value: () => f.default_judge, onChange: (v) => { f.default_judge = v; }, options: [{ value: "me", label: "Me", icon: "me" }, { value: "ai", label: "AI", icon: "ai" }] })}
              <span class="hint">You can pick per run, and you can always change the AI's stars.</span>
            </div>
            <div class="field">
              <span class="label" id="ws-method-label">How new runs are judged</span>
              ${seg({ name: "ws-method", labelId: "ws-method-label", value: () => f.default_method, onChange: (v) => { f.default_method = v; }, options: METHOD_OPTIONS })}
              <span class="hint">${() => METHOD_HINT[f.default_method]} You can pick per run.</span>
            </div>
            <div class="field"><label for="ws-ai">AI judge</label>
              ${dropdown({ id: "ws-ai", label: "AI judge", options: () => judges, value: () => f.judge_contender, onChange: (v) => { f.judge_contender = v; }, placeholder: "Pick a contender to judge" })}
              <span class="hint">Any contender that Audition calls can judge. It rates each output against the rubric and says why in one line.</span>
            </div>
            <div class="field"><label for="ws-min">Outputs needed before suggesting a champion
              <button class="info-btn" type="button" popovertarget="${minPop}" aria-label="Why a minimum?">${icon("help")}</button></label>
              <input class="input num input--short" id="ws-min" type="number" min="1" value="${f.min_outputs}" @input="${(e) => { f.min_outputs = e.target.value; }}">
            </div>
            <div class="pop" id="${minPop}" popover><div class="pop__head">${icon("shuffle")}Why a minimum?</div><div class="pop__body"><p>One great answer can be luck. Five or more outputs show whether a contender is good every time. Use <strong>Run again</strong> to collect more without changing anything.</p></div></div>
          </div></div>

          <div class="panel" data-testid="composer-panel"><div class="panel__head"><h2>${icon("sparkle")}Composer</h2><span class="muted small">Optional</span></div><div class="panel__body">
            <div class="field"><label for="ws-composer">Composer</label>
              ${dropdown({ id: "ws-composer", label: "Composer", options: () => composers, value: () => f.composer_contender || "", onChange: (v) => { f.composer_contender = v || null; }, placeholder: "No Composer" })}
              <span class="hint">Any contender that Audition calls can compose. On a task, it rewrites your text into a sharper prompt: the goal, the steps that matter, the output format and what a great answer looks like for each rubric line. You read and edit it before a run, and every contender then gets that same prompt.</span>
            </div>
          </div></div>

          <div class="panel"><div class="panel__head"><h2>${icon("trophy")}What makes a champion</h2></div><div class="panel__body">
            <p class="small text-2">Quality always counts. Give tokens and time some weight if a cheaper or faster contender should win when quality is close.</p>
            ${weightBar(weights)}
            <div class="fields-2">
              <div class="field"><label for="fw-q">${icon("star")}Quality</label><input class="input num" id="fw-q" type="number" min="0" max="100" value="${f.q}" @input="${(e) => { f.q = Number(e.target.value); }}"></div>
              <div class="field"><label for="fw-t">${icon("tokens")}Fewer tokens</label><input class="input num" id="fw-t" type="number" min="0" max="100" value="${f.t}" @input="${(e) => { f.t = Number(e.target.value); }}"></div>
              <div class="field"><label for="fw-d">${icon("time")}Less time</label><input class="input num" id="fw-d" type="number" min="0" max="100" value="${f.dt}" @input="${(e) => { f.dt = Number(e.target.value); }}"></div>
            </div>
            <span class="self-start">${weightTotal(weights, "Adds up to 100")}</span>
          </div></div>

          <div class="row"><button class="btn btn--primary btn--lg" type="submit">${icon("check")}${isNew ? "Create workspace" : "Save settings"}</button><a class="btn btn--quiet" href="${isNew ? APP + "/" : APP + "/w/" + params.id}">Cancel</a></div>
        </form>`;
    },
  });
}
