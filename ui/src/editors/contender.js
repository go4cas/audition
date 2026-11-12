// 8. Add, edit, or "Duplicate and edit" a contender: "Audition calls it" or
// "I copy and paste". The fields change to fit the connection's provider:
// effort for Anthropic, temperature for OpenAI-compatible (TECH-SPEC F8),
// a behaviour for the mock.
import { html, reactive } from "@arrow-js/core";
import { create, update } from "../api.js";
import { APP, go } from "../lib/nav.js";
import { dropdown, seg } from "../components/forms.js";
import { busy, crumbs, page } from "../components/page.js";
import { errorToast, icon, placeThumbs, popId, toast } from "../lib/ui.js";
import { PROVIDER_LABEL, load } from "../state/data.js";

const EFFORTS = [
  { value: null, label: "Model default", desc: "Let the model decide" },
  { value: "low", label: "Low", desc: "Fastest, fewest tokens" },
  { value: "medium", label: "Medium", desc: "Balanced" },
  { value: "high", label: "High", desc: "Thinks longer" },
  { value: "xhigh", label: "Extra high", desc: "Thinks longer still" },
  { value: "max", label: "Max", desc: "Thinks longest, uses most tokens" },
];
const BEHAVIOURS = ["steady", "erratic", "flaky", "fail", "image", "judge"].map((b) => ({ value: b, label: b[0].toUpperCase() + b.slice(1), desc: { steady: "Always about four stars", erratic: "Two to five stars by chance", flaky: "Fails once, then answers", fail: "Always fails", image: "Returns one or two images", judge: "Made for judging" }[b] }));

export default function contenderForm({ params, query }) {
  const tempPop = popId();
  return page({
    narrow: true, screen: "contender-form",
    load: async (s) => {
      s.d = await load("connections", "contenders");
      const src = params.id ? s.d.byId.contenders.get(params.id) : query.from ? s.d.byId.contenders.get(query.from) : null;
      if ((params.id || query.from) && !src) throw new Error("This contender doesn't exist any more.");
      if (params.id && src.locked) throw new Error("This contender was used in a run, so it can't change. Duplicate it instead.");
      s.src = src;
      s.mode = params.id ? "edit" : query.from ? "duplicate" : "new";
      const manual = s.d.connections.find((c) => c.provider === "manual");
      const firstApi = s.d.connections.find((c) => c.provider !== "manual");
      const cfg = src?.config || {};
      s.f = reactive({
        mode: src?.mode || "api", name: src ? (s.mode === "duplicate" ? src.name + " (copy)" : src.name) : "",
        connection: src?.connection || firstApi?.id || null, manual: manual?.id || null,
        model: src?.model || "", effort: cfg.effort || null, temperature: cfg.temperature ?? "", behaviour: cfg.mock?.behaviour || "steady",
        system_prompt: cfg.system_prompt || "", notes: cfg.notes || "", max_output_tokens: src?.max_output_tokens ?? 16000, group: src?.group || "",
        price_in: src?.price_in_per_mtok ?? "", price_out: src?.price_out_per_mtok ?? "",
      });
    },
    body: (s) => {
      const { d, f, src } = s;
      const apiConns = d.connections.filter((c) => c.provider !== "manual").map((c) => ({ value: c.id, label: c.name, icon: c.provider === "mock" ? "api" : "key", desc: PROVIDER_LABEL[c.provider] + (c.provider === "mock" ? " · built-in test provider" : c.has_key ? " · key saved" : " · no key yet") }));
      const provider = () => d.byId.connections.get(f.connection)?.provider;
      const save = (e) => busy(e, async () => {
        e.preventDefault();
        const api = f.mode === "api";
        const config = {};
        if (api) {
          if (f.system_prompt.trim()) config.system_prompt = f.system_prompt.trim();
          if (provider() === "anthropic" && f.effort) config.effort = f.effort;
          if (provider() === "openai-compatible" && f.temperature !== "") config.temperature = Number(f.temperature);
          if (provider() === "mock") config.mock = { behaviour: f.behaviour };
        } else if (f.notes.trim()) config.notes = f.notes.trim();
        const body = {
          name: f.name.trim(), mode: f.mode, connection: api ? f.connection : f.manual, config,
          model: api ? f.model.trim() : null, group: f.group.trim() || null,
          max_output_tokens: api ? Number(f.max_output_tokens) || 16000 : null,
          price_in_per_mtok: api && f.price_in !== "" ? Number(f.price_in) : null,
          price_out_per_mtok: api && f.price_out !== "" ? Number(f.price_out) : null,
        };
        if (s.mode === "duplicate") body.previous_version = src.id;
        try {
          if (s.mode === "edit") await update("contenders", src.id, body); else await create("contenders", body);
          toast(s.mode === "edit" ? "Contender saved" : "Contender added");
          go("/contenders");
        } catch (err) { errorToast(err); }
      });
      const title = { new: "Add a contender", edit: "Edit contender", duplicate: "Duplicate and edit" }[s.mode];
      return html`
        ${crumbs([["Contenders", APP + "/contenders"]])}
        <h1>${title}</h1>
        ${s.mode === "duplicate" ? html`<div class="notice" data-state="done">${icon("copy")}<div><strong>This is a new contender, copied from ${src.name}.</strong> ${src.name} and its results stay as they were.</div></div>` : ""}
        <form class="stack" @submit="${save}">
          <div class="field">
            <span class="label" id="cn-mode-label">How does it run?</span>
            ${seg({ name: "cn-mode", labelId: "cn-mode-label", value: () => f.mode, onChange: (v) => { f.mode = v; placeThumbs(); }, disabled: () => s.mode !== "new", options: [{ value: "api", label: "Audition calls it", icon: "api" }, { value: "handoff", label: "I copy and paste", icon: "paste" }] })}
            <span class="hint">${() => (f.mode === "api" ? "Audition sends the prompt to the provider and measures tokens and time." : "You copy the prompt into the tool and paste the reply back. You can type in tokens and time if the tool shows them.")}</span>
          </div>
          <div class="field"><label for="cn-name">Name</label><input class="input" id="cn-name" required value="${() => f.name}" @input="${(e) => { f.name = e.target.value; }}" placeholder="${() => (f.mode === "api" ? "Opus 5.5, high effort" : "Claude Code (manual), plan mode")}"><span class="hint">What the leaderboard shows. Two setups of the same model are two contenders.</span></div>

          ${() => (f.mode === "api" ? html`<div class="stack">
            <div class="fields-2">
              <div class="field"><label for="cn-conn">Connection</label>${dropdown({ id: "cn-conn", label: "Connection", options: () => apiConns, value: () => f.connection, onChange: (v) => { f.connection = v; } })}</div>
              <div class="field"><label for="cn-model">Model</label><input class="input" id="cn-model" value="${() => f.model}" @input="${(e) => { f.model = e.target.value; }}" placeholder="${() => (provider() === "mock" ? "mock-steady" : "claude-opus-5-5")}"></div>
              ${() => (provider() === "anthropic" ? html`<div class="field"><label for="cn-effort">Effort</label>${dropdown({ id: "cn-effort", label: "Effort", options: () => EFFORTS, value: () => f.effort, onChange: (v) => { f.effort = v; } })}</div>` : "")}
              ${() => (provider() === "openai-compatible" ? html`<div class="field"><label for="cn-temp">Temperature <button class="info-btn" type="button" popovertarget="${tempPop}" aria-label="What is temperature?">${icon("help")}</button></label><input class="input num" id="cn-temp" type="number" step="0.1" min="0" max="2" value="${() => f.temperature}" @input="${(e) => { f.temperature = e.target.value; }}"></div>` : "")}
              ${() => (provider() === "mock" ? html`<div class="field"><label for="cn-behaviour">Mock behaviour</label>${dropdown({ id: "cn-behaviour", label: "Mock behaviour", options: () => BEHAVIOURS, value: () => f.behaviour, onChange: (v) => { f.behaviour = v; } })}</div>` : "")}
            </div>
            <div class="pop" id="${tempPop}" popover><div class="pop__head">${icon("sliders")}Temperature</div><div class="pop__body"><p>How adventurous the answers are. 0 gives the same, careful answer each time. 1 gives more varied, creative answers.</p></div></div>
            <div class="field"><label for="cn-sys">System prompt <span class="muted">(optional)</span></label><textarea class="textarea textarea--short" id="cn-sys" rows="3" value="${() => f.system_prompt}" @input="${(e) => { f.system_prompt = e.target.value; }}" placeholder="Extra instructions this contender always gets"></textarea></div>
            <div class="fields-2">
              <div class="field"><label for="cn-max">${icon("tokens")}Max output tokens</label><input class="input num" id="cn-max" type="number" min="1" required value="${() => f.max_output_tokens}" @input="${(e) => { f.max_output_tokens = e.target.value; }}"><span class="hint">A hard limit on every reply. Your spending guard.</span></div>
              <div class="field"><label for="cn-group">Leaderboard group</label><input class="input" id="cn-group" value="${() => f.group}" @input="${(e) => { f.group = e.target.value; }}" placeholder="Opus 5.5"><span class="hint">Groups setups of the same model.</span></div>
            </div>
            <details class="panel">
              <summary class="panel__head summary-plain"><span class="row-tight">${icon("cost")}<strong>Prices</strong> <span class="muted small">optional, shows cost on the leaderboard</span></span>${icon("caret-down")}</summary>
              <div class="panel__body fields-2">
                <div class="field"><label for="cn-pin">Input, $ per 1M tokens</label><input class="input num" id="cn-pin" type="number" step="0.01" min="0" value="${() => f.price_in}" @input="${(e) => { f.price_in = e.target.value; }}" placeholder="5.00"></div>
                <div class="field"><label for="cn-pout">Output, $ per 1M tokens</label><input class="input num" id="cn-pout" type="number" step="0.01" min="0" value="${() => f.price_out}" @input="${(e) => { f.price_out = e.target.value; }}" placeholder="25.00"></div>
              </div>
            </details>
          </div>` : html`<div class="stack">
            <div class="field"><label for="cn-notes">Which tool and settings?</label><textarea class="textarea textarea--short" id="cn-notes" rows="3" value="${() => f.notes}" @input="${(e) => { f.notes = e.target.value; }}" placeholder="Claude Code, Opus, plan mode"></textarea><span class="hint">For your memory only. Audition never stores your passwords for these tools.</span></div>
            <div class="field"><label for="cn-group2">Leaderboard group <span class="muted">(optional)</span></label><input class="input" id="cn-group2" value="${() => f.group}" @input="${(e) => { f.group = e.target.value; }}" placeholder="Claude Code"></div>
          </div>`)}
          <div class="row"><button class="btn btn--primary btn--lg" type="submit">${icon(s.mode === "edit" ? "check" : "plus")}${s.mode === "edit" ? "Save contender" : "Add contender"}</button><a class="btn btn--quiet" href="${APP + "/contenders"}">Cancel</a></div>
        </form>`;
    },
  });
}
