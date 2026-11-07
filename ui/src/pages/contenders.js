// 7. Contenders: connections (with write-only API keys) and every contender.
import { html, reactive } from "@arrow-js/core";
import { create, custom } from "../api.js";
import { dropdown } from "../components/forms.js";
import { busy, empty, page } from "../components/page.js";
import { avatar, chip, errorToast, icon, money, num, plural, popId, toast } from "../lib/ui.js";
import { PROVIDER_LABEL, contenderMeta, load } from "../state/data.js";

const PROVIDERS = [
  { value: "anthropic", label: "Anthropic", icon: "key", desc: "Claude models through the Anthropic API" },
  { value: "openai-compatible", label: "OpenAI-compatible", icon: "api", desc: "Any chat-completions API; needs its base URL" },
];
const CONN_ICON = { mock: "api", manual: "paste", anthropic: "key", "openai-compatible": "api" };
const CONN_DESC = { mock: "Built-in test provider. Free, instant, made-up answers.", manual: "You copy the prompt into a tool and paste the reply back." };

async function saveKey(conn, key) {
  if (conn.has_key) await custom.removeKey(conn.id);
  await create("connection_keys", { connection: conn.id, api_key: key });
}

export default function contenders() {
  const keyPop = popId();
  return page({
    screen: "contenders",
    load: async (s) => {
      s.d = await load("connections", "contenders", "runs");
      s.ui = reactive({ adding: false, name: "", provider: "anthropic", base_url: "", key: "", notes: "", replacing: null, newKey: "" });
    },
    body: (s) => {
      const { d, ui } = s;
      const usedIn = (c) => d.runs.filter((r) => (r.contenders || []).includes(c.id)).length;
      const latest = d.contenders.filter((c) => !d.contenders.some((n) => n.previous_version === c.id));
      const addConn = (e) => busy(e, async () => {
        e.preventDefault();
        try {
          const conn = await create("connections", { name: ui.name.trim(), provider: ui.provider, base_url: ui.base_url.trim() || null, notes: ui.notes.trim() });
          if (ui.key.trim()) await saveKey(conn, ui.key.trim());
          ui.key = "";
          toast("Connection added. The key is saved and won't be shown again.", "done", "key");
          s.reload({ quiet: true });
        } catch (err) { errorToast(err); }
      });
      const replace = (conn) => (e) => busy(e, async () => {
        e.preventDefault();
        try { await saveKey(conn, ui.newKey.trim()); ui.newKey = ""; toast("Key replaced", "done", "key"); s.reload({ quiet: true }); } catch (err) { errorToast(err); }
      });
      return html`
        <div class="page-head">
          <div><h1>Contenders</h1><p class="lede">Every model, agent or app you want to compare. Each one is an exact setup, shared by all workspaces.</p></div>
          <a class="btn btn--primary" href="#/contenders/new">${icon("plus")}Add contender</a>
        </div>

        <div class="panel">
          <div class="panel__head"><h2>${icon("connection")}Connections</h2><button class="btn btn--sm" type="button" @click="${() => { ui.adding = !ui.adding; }}">${icon("plus")}Add connection</button></div>
          ${() => (ui.adding ? html`<form class="panel__body panel__body--sunk" @submit="${addConn}">
            <div class="fields-2">
              <div class="field"><label for="cx-name">Name</label><input class="input" id="cx-name" required placeholder="Anthropic" @input="${(e) => { ui.name = e.target.value; }}"></div>
              <div class="field"><label for="cx-provider">Provider</label>${dropdown({ id: "cx-provider", label: "Provider", options: () => PROVIDERS, value: () => ui.provider, onChange: (v) => { ui.provider = v; } })}</div>
              <div class="field"><label for="cx-url">Base URL <span class="muted">${() => (ui.provider === "anthropic" ? "(optional)" : "")}</span></label><input class="input" id="cx-url" type="url" placeholder="${() => (ui.provider === "anthropic" ? "https://api.anthropic.com" : "https://api.example.com/v1")}" required="${() => ui.provider !== "anthropic"}" @input="${(e) => { ui.base_url = e.target.value; }}"></div>
              <div class="field"><label for="cx-key">${icon("key")}API key</label><input class="input" id="cx-key" type="password" autocomplete="off" required @input="${(e) => { ui.key = e.target.value; }}"><span class="hint">Encrypted and only used on the server. It's never shown again.</span></div>
            </div>
            <div class="field"><label for="cx-notes">Notes <span class="muted">(optional)</span></label><input class="input" id="cx-notes" @input="${(e) => { ui.notes = e.target.value; }}"></div>
            <div class="row"><button class="btn btn--primary" type="submit">${icon("check")}Save connection</button><button class="btn btn--quiet" type="button" @click="${() => { ui.adding = false; }}">Cancel</button></div>
          </form>` : "")}
          <ul class="list list--hover">${d.connections.map((c) => {
            const n = d.contenders.filter((x) => x.connection === c.id).length;
            const needsKey = c.provider === "anthropic" || c.provider === "openai-compatible";
            return html`<li>
              <span class="avatar" style="${"--h:" + ({ mock: 270, manual: 20, anthropic: 30 }[c.provider] ?? 200)}">${icon(CONN_ICON[c.provider] || "api")}</span>
              <div class="grow"><div class="title">${c.name}</div><div class="muted small row-tight">${needsKey ? html`${PROVIDER_LABEL[c.provider]} · ${c.has_key ? "API key saved" : "No key yet"} <button class="info-btn" type="button" popovertarget="${keyPop}" aria-label="Why is the key hidden?">${icon("help")}</button>` : c.notes || CONN_DESC[c.provider]}</div></div>
              <span class="badge">${plural(n, "contender")}</span>
              ${needsKey && !c.has_key ? chip("warning", "Needs a key") : chip("done", c.provider === "manual" ? "Ready" : "Connected")}
              ${needsKey ? html`<button class="btn btn--sm btn--quiet" type="button" @click="${() => { ui.replacing = ui.replacing === c.id ? null : c.id; }}">${c.has_key ? "Replace key" : "Add key"}</button>` : ""}
              ${() => (ui.replacing === c.id ? html`<form class="row full" @submit="${replace(c)}"><input class="input grow" type="password" autocomplete="off" required aria-label="${"New API key for " + c.name}" placeholder="New API key" @input="${(e) => { ui.newKey = e.target.value; }}"><button class="btn btn--primary btn--sm" type="submit">${icon("key")}Save key</button></form>` : "")}
            </li>`;
          })}</ul>
          <div class="pop" id="${keyPop}" popover><div class="pop__head">${icon("key")}Your key stays hidden</div><div class="pop__body"><p>Audition encrypts the key and only uses it on the server. It never shows it again, not even to you. To change it, replace it.</p></div></div>
        </div>

        <div class="panel">
          <div class="panel__head"><h2>${icon("contenders")}All contenders</h2><span class="muted small row-tight">${icon("locked")}Used ones are read-only. Duplicate to try other settings.</span></div>
          ${latest.length ? html`<div class="table-wrap"><table>
            <thead><tr><th>Contender</th><th>Runs by</th><th class="num">Max output</th><th class="col-state">State</th><th></th></tr></thead>
            <tbody>${latest.map((c) => {
              const pop = popId();
              const conn = d.byId.connections.get(c.connection);
              const runs = usedIn(c);
              return html`<tr>
                <td><span class="who">${avatar(c.name)}<span><span class="who__name">${c.name}</span><br><span class="who__meta">${contenderMeta(d, c) || "Default settings"}</span></span></span></td>
                <td><span class="badge">${icon(c.mode === "handoff" ? "paste" : "api")}${c.mode === "handoff" ? "Copy and paste" : "API · " + (PROVIDER_LABEL[conn?.provider] || "")}</span></td>
                <td class="num">${c.mode === "handoff" ? html`<span class="muted">–</span>` : num(c.max_output_tokens)}</td>
                <td class="col-state">${c.enabled === false ? chip("disabled", "Turned off") : c.locked ? chip("locked", "Used") : chip("draft", "Not used yet")}</td>
                <td class="num">${c.locked
                  ? html`<button class="icon-btn" type="button" popovertarget="${pop}" aria-label="${c.name + " details"}">${icon("more")}</button>
                    <div class="pop pop--left" id="${pop}" popover><div class="pop__head">${avatar(c.name, "sm")}${c.name}</div><div class="pop__body">
                      <dl>
                        <dt>${icon("connection")}Connection</dt><dd>${conn?.name || "–"}</dd>
                        ${c.model ? html`<dt>${icon("sliders")}Model</dt><dd>${c.model}</dd>` : ""}
                        ${c.config?.effort ? html`<dt>Effort</dt><dd>${c.config.effort}</dd>` : ""}
                        ${c.config?.temperature != null ? html`<dt>Temperature</dt><dd>${c.config.temperature}</dd>` : ""}
                        ${c.mode === "api" ? html`<dt>${icon("tokens")}Max output</dt><dd>${num(c.max_output_tokens)} tokens</dd><dt>${icon("cost")}Price in / out</dt><dd>${c.price_in_per_mtok != null ? `${money(c.price_in_per_mtok)} / ${money(c.price_out_per_mtok)} per 1M` : "Not set"}</dd>` : ""}
                        <dt>${icon("history")}Used in</dt><dd>${plural(runs, "run")}</dd>
                      </dl>
                      <a class="btn btn--sm self-start" href="${"#/contenders/new?from=" + c.id}">${icon("copy")}Duplicate and edit</a>
                    </div></div>`
                  : html`<a class="icon-btn" href="${"#/contenders/" + c.id + "/edit"}" data-tip="Edit" aria-label="${"Edit " + c.name}">${icon("edit")}</a>`}</td>
              </tr>`;
            })}</tbody></table></div>`
          : empty("contenders-duo", "No contenders yet", "Add the models, agents and apps you want to compare.")}
        </div>`;
    },
  });
}
