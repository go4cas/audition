// 14. Leaderboard: every scored output for a role, with the likely range,
// fitness, and the suggested champion (GET /leaderboard/:role, TECH-SPEC §11).
import { html, reactive } from "@arrow-js/core";
import { custom } from "../../api.js";
import { busy, crumbs, empty, page } from "../../components/page.js";
import { avatar, chip, confetti, date, duration, errorToast, icon, money, plural, popId, short, stars1, toast } from "../../lib/ui.js";
import { load } from "../../state/data.js";
import { APP, routeArgs } from "../../lib/nav.js";

const pos = (v) => Math.max(0, Math.min(100, ((Number(v) - 1) / 4) * 100));
const TERM = { quality: "Quality", tokens: "Tokens", time: "Time" };

export const meta = { title: "Leaderboard · Audition" };

export default function leaderboard() {
  const { params } = routeArgs();
  const rangePop = popId();
  return page({
    screen: "leaderboard",
    load: async (s) => {
      const [d, lb] = await Promise.all([load("workspaces", "roles", "contenders", "runs"), custom.leaderboard(params.role)]);
      s.d = d; s.lb = lb;
      s.role = d.byId.roles.get(params.role);
      if (!s.role) throw new Error("This role doesn't exist any more.");
      s.ws = d.byId.workspaces.get(s.role.workspace);
      s.ui = reactive({ group: false });
    },
    body: (s) => {
      const { d, lb, role, ws, ui } = s;
      const rows = [...(lb.rows || [])].sort((a, b) => (b.fitness ?? -9) - (a.fitness ?? -9) || b.mean_score - a.mean_score);
      const w = ws?.fitness_weights || { quality: 100, tokens: 0, time: 0 };
      const min = ws?.min_outputs || 5;
      const name = (id) => rows.find((r) => r.contender === id)?.name || d.byId.contenders.get(id)?.name || "Contender";
      const maxFit = Math.max(0.0001, ...rows.map((r) => r.fitness || 0));
      const maxT = Math.max(0, ...rows.map((r) => r.mean_tokens || 0));
      const maxD = Math.max(0, ...rows.map((r) => r.mean_time_ms || 0));
      const used = new Set(lb.terms_used || ["quality"]);
      const cast = lb.casting;
      const suggestion = lb.suggested && lb.suggested !== cast?.contender ? lb.suggested : null;
      const latestRun = d.runs.filter((r) => r.role === role.id).at(-1);

      const makeChampion = (id) => (e) => busy(e, async () => {
        try {
          await custom.cast({ role: role.id, contender: id });
          toast(`${name(id)} is now the ${role.name} champion`, "champion", "champion");
          const box = document.getElementById("champ-box");
          box?.classList.add("is-confirmed"); confetti(box);
          setTimeout(() => s.reload({ quiet: true }), 900);
        } catch (err) { errorToast(err); }
      });

      const champBox = () => {
        if (suggestion) {
          const r = rows.find((x) => x.contender === suggestion);
          return html`<div class="champion" id="champ-box"><div class="row gap-4"><span class="champion__crown">${icon("champion")}</span><div class="stack-sm gap-1">
              <span class="eyebrow">${icon("sparkle", "gold")}Suggested champion</span><span class="champion__name">${name(suggestion)}</span>
              <span class="small text-2 row-tight"><span class="score">${icon("star")}${stars1(r?.mean_score)}</span> over ${plural(r?.n || 0, "output")} · highest fitness of those that qualify</span>
              ${cast ? html`<span class="xs muted">Current champion: ${name(cast.contender)}, since ${date(cast.since)}</span>` : ""}
            </div></div>
            <div class="row"><button class="btn btn--gold btn--lg" type="button" @click="${makeChampion(suggestion)}">${icon("champion")}Make champion</button></div></div>`;
        }
        if (cast) {
          return html`<div class="champion" id="champ-box"><div class="row gap-4"><span class="champion__crown">${icon("champion")}</span><div class="stack-sm gap-1">
            <span class="eyebrow">${icon("confirmed")}Champion since ${date(cast.since)}</span><span class="champion__name">${name(cast.contender)}</span>
            <span class="small text-2">The one to use for ${role.name}.</span></div></div>${chip("champion", "Champion")}</div>`;
        }
        return html`<div class="notice">${icon("info-fill")}<div class="small"><strong>No champion yet.</strong> A contender needs ${plural(min, "scored output")} and an average above ${role.pass_mark} stars. Use Run again to collect more.</div></div>`;
      };

      // Phase 2a: outcome checks, in their own column, never in quality or fitness.
      const outcomeCol = !!role.outcome_after_days || rows.some((r) => r.n_outcome);
      const row = (r) => {
        const fitPop = popId();
        const q = ((r.mean_score - 1) / 4) * w.quality / 100;
        const t = maxT ? (r.mean_tokens / maxT) * w.tokens / 100 : 0;
        const dd = maxD ? (r.mean_time_ms / maxD) * w.time / 100 : 0;
        const range = r.ci_low != null && r.ci_high != null;
        const isCast = cast?.contender === r.contender;
        return html`<tr class="${r.contender === lb.suggested ? "is-suggested" : ""}" data-contender="${r.name}">
          <td><span class="who">${avatar(r.name, "sm")}<strong>${r.name}</strong>${isCast ? html`<span data-tip="Champion" class="inline-flex">${icon("champion", "gold")}</span>` : r.contender === lb.suggested ? html`<span data-tip="Suggested champion" class="inline-flex">${icon("sparkle", "gold")}</span>` : ""}</span></td>
          <td class="num">${r.n}</td>
          <td class="num"><span class="score">${icon("star")}${stars1(r.mean_score)}</span></td>
          <td>${range ? html`<span class="range" data-tip="${`${stars1(r.ci_low)} to ${stars1(r.ci_high)}${r.ci_high - r.ci_low > 1.5 ? ": wide, so not consistent yet" : ""}`}"><span class="range__band" style="${`left:${pos(r.ci_low)}%;width:${pos(r.ci_high) - pos(r.ci_low)}%`}"></span><span class="range__pass" style="${`left:${pos(role.pass_mark)}%`}"></span><span class="range__dot" style="${`left:${pos(r.mean_score)}%`}"></span></span>` : html`<span class="xs muted">needs 2 outputs</span>`}</td>
          ${outcomeCol ? html`<td class="${"num" + (r.n_outcome ? "" : " muted")}">${r.n_outcome ? html`<span class="score" data-tip="${"Was the call right? Average of " + plural(r.n_outcome, "check")}">${icon("star")}${stars1(r.mean_outcome)} <span class="xs muted">(${r.n_outcome})</span></span>` : html`<span class="xs muted">none yet</span>`}</td>` : ""}
          <td class="${"num" + (r.mean_tokens == null ? " muted" : "")}">${r.mean_tokens == null ? "N/A" : short(r.mean_tokens)}</td>
          <td class="${"num" + (r.mean_time_ms == null ? " muted" : "")}">${r.mean_time_ms == null ? "N/A" : duration(r.mean_time_ms)}</td>
          <td class="${"num" + (r.mean_cost == null ? " muted" : "")}">${money(r.mean_cost)}</td>
          <td>${r.enough_data === false || r.n < min ? chip("draft", `${Math.min(r.n, min)} of ${min} outputs`) : html`<span class="fitness-bar"><span class="fitness-bar__track"><span class="fitness-bar__fill" style="${"width:" + Math.max(0, (r.fitness / maxFit) * 100) + "%"}"></span></span><strong class="num">${(r.fitness ?? 0).toFixed(2)}</strong><button class="info-btn" type="button" popovertarget="${fitPop}" aria-label="${"How fitness is worked out for " + r.name}">${icon("help")}</button></span>
            <div class="pop" id="${fitPop}" popover><div class="pop__head">${icon("trophy")}Fitness for ${r.name}</div><div class="pop__body"><dl>
              <dt>${icon("star")}Quality × ${w.quality}</dt><dd>+${q.toFixed(2)}</dd>
              ${w.tokens ? html`<dt>${icon("tokens")}Tokens × ${w.tokens}</dt><dd class="${used.has("tokens") ? "" : "muted"}">${used.has("tokens") ? "−" + t.toFixed(2) : "left out"}</dd>` : ""}
              ${w.time ? html`<dt>${icon("time")}Time × ${w.time}</dt><dd class="${used.has("time") ? "" : "muted"}">${used.has("time") ? "−" + dd.toFixed(2) : "left out"}</dd>` : ""}
              <dt><strong>Fitness</strong></dt><dd><strong>${(r.fitness ?? 0).toFixed(2)}</strong></dd>
            </dl><p class="xs muted">Cost is shown for information and never decides the champion.</p></div></div>`}</td>
          <td class="num">${r.qualifies && !isCast && r.contender !== suggestion ? html`<button class="btn btn--sm btn--quiet" type="button" @click="${makeChampion(r.contender)}">${icon("champion")}Make champion</button>` : ""}</td>
        </tr>`;
      };
      const groups = () => {
        const out = new Map();
        for (const r of rows) { const g = r.group || r.name; if (!out.has(g)) out.set(g, []); out.get(g).push(r); }
        return [...out];
      };

      return html`
        ${crumbs([["Workspaces", APP + "/"], [ws?.name || "Workspace", APP + "/w/" + role.workspace], [role.name, APP + "/r/" + role.id]])}
        <div class="page-head">
          <div><h1>${role.name}</h1><p class="lede">Every scored output across all runs. A champion needs ${plural(min, "output")} and an average above ${role.pass_mark} stars.</p></div>
          <a class="btn" href="${latestRun ? APP + "/runs/" + latestRun.id : APP + "/runs/new?role=" + role.id}">${icon("again", "i--spin-on-hover")}${latestRun ? "Run again for more data" : "Start a run"}</a>
        </div>
        ${champBox()}
        <div class="panel">
          <div class="panel__head"><h2 class="h-md">${icon("leaderboard")}Contenders</h2><label class="switch"><input type="checkbox" @change="${(e) => { ui.group = e.target.checked; }}"><span class="switch__track"></span>Group by model</label></div>
          ${rows.length ? html`<div class="table-wrap"><table>
            <thead><tr><th>Contender</th><th class="num">Outputs</th><th class="num">Average</th><th>Likely range <button class="info-btn" type="button" popovertarget="${rangePop}" aria-label="What is the likely range?">${icon("help")}</button></th>${outcomeCol ? html`<th class="num"><span data-tip="Was the call right, checked later. Shown on its own; it doesn't change the average or fitness." tabindex="0">Outcome</span></th>` : ""}<th class="num">Tokens</th><th class="num">Time</th><th class="num">Cost</th><th>Fitness</th><th></th></tr></thead>
            <tbody>${() => (ui.group ? groups().map(([g, rs]) => html`<tr class="group-row"><td colspan="9"><span class="eyebrow">${g}</span></td></tr>${rs.map(row)}`) : rows.map(row))}</tbody>
          </table></div>` : empty("leaderboard", "No scored outputs yet", "Judge some outputs and they show up here.")}
        </div>
        ${(lb.dropped || []).map((x) => html`<div class="notice" data-state="warning">${icon("info-fill")}<div class="small"><strong>${TERM[x.term] || x.term} ${x.term === "tokens" ? "were" : "was"} left out of fitness</strong> because ${x.reason.replace(/^./, (c) => c.toLowerCase())}.</div></div>`)}
        <div class="pop" id="${rangePop}" popover><div class="pop__head">${icon("shuffle")}Likely range</div><div class="pop__body"><p>Where the true average probably sits. A narrow bar means the contender is consistent; a wide one means more runs would help.</p><p class="row-tight xs"><span class="range range--sm"><span class="range__band range__band--demo"></span><span class="range__pass range__pass--demo"></span><span class="range__dot range__dot--demo"></span></span> dot = average, line = pass mark</p></div></div>`;
    },
  });
}
