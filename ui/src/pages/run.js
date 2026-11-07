// 10. Run progress: a live bar and one table per task, polling GET /runs/:id
// every 2 seconds while the run is active (TECH-SPEC F1). Outputs and scores
// stay hidden here so judging stays blind.
import { html, reactive } from "@arrow-js/core";
import { custom } from "../api.js";
import { go, onLeave } from "../router.js";
import { busy, crumbs, page } from "../components/page.js";
import { TYPE_ICON, avatar, chip, duration, errorToast, icon, money, num, outputChip, plural, popId, time, toast } from "../lib/ui.js";
import { load, runLabel } from "../state/data.js";
import { refreshInbox } from "../state/inbox.js";

export default function run({ params }) {
  return page({
    screen: "run",
    load: async (s) => {
      const [d, live] = await Promise.all([load("workspaces", "roles", "tasks", "contenders", "runs"), custom.run(params.id)]);
      s.d = d;
      s.live = reactive({ v: live });
      let timer = setInterval(async () => {
        if (s.live.v.run.status === "done") return;
        try {
          const before = s.live.v.counts;
          const v = await custom.run(params.id);
          if (JSON.stringify(v.counts) !== JSON.stringify(before)) refreshInbox();
          s.live.v = v;
        } catch { /* keep the last view */ }
      }, 2000);
      onLeave(() => clearInterval(timer));
    },
    body: (s) => {
      const d = s.d;
      const v = () => s.live.v;
      const r = v().run;
      const role = d.byId.roles.get(r.role);
      const ws = d.byId.workspaces.get(r.workspace);
      const judgeName = r.judge === "ai" ? d.byId.contenders.get(r.judge_contender)?.name || "AI" : "Me";
      const taskIds = r.tasks?.length ? r.tasks : [...new Set(v().attempts.map((a) => a.task))];
      const total = () => v().attempts.length || 1;
      const c = () => v().counts || {};
      const pct = (n) => ((n || 0) / total()) * 100 + "%";
      const again = (e) => busy(e, async () => {
        try { const n = await custom.runAgain(r.id); toast("New run started", "done", "again"); go("/runs/" + (n.run?.id || n.id)); } catch (err) { errorToast(err); }
      });
      const headline = () => {
        const k = c(), done = (k.judged || 0);
        if (v().run.status === "done") return `Finished: ${plural(done, "output")} judged${k.failed ? `, ${k.failed} failed` : ""}`;
        return `${done} of ${plural(total(), "output")} judged`;
      };
      return html`
        ${crumbs([["Workspaces", "#/"], [ws?.name || "Workspace", "#/w/" + r.workspace], [role?.name || "Role", "#/r/" + r.role]])}
        <div class="page-head">
          <div><h1>${runLabel(d, r)} · ${role?.name}</h1>
            <p class="lede row-tight"><span class="badge">${icon(r.judge === "ai" ? "ai" : "me")}Judge: ${judgeName}</span><span class="badge">${icon("time")}Started ${time(r.created)}</span><span class="badge">${plural(taskIds.length, "task")} × ${plural(r.contenders?.length || 0, "contender")}</span>${r.rerun_of ? html`<a class="badge link-plain" href="${"#/runs/" + r.rerun_of}">${icon("again")}Again from ${runLabel(d, { id: r.rerun_of })}</a>` : ""}</p></div>
          <div class="row">
            <a class="btn" href="${"#/leaderboard/" + r.role}">${icon("leaderboard")}Leaderboard</a>
            ${() => (v().run.status === "done" ? html`<button class="btn btn--primary" type="button" @click="${again}">${icon("again", "i--spin-on-hover")}Run again</button>` : html`<span data-tip="Available when every output is in and judged" tabindex="0"><button class="btn" type="button" disabled>${icon("again")}Run again</button></span>`)}
          </div>
        </div>

        <div class="panel"><div class="panel__body gap-10">
          <div class="row-between"><strong>${headline}</strong>${() => (v().run.status === "done" ? chip("done", "Finished") : chip("active", "Live"))}</div>
          <div class="progress" role="img" aria-label="Run progress">
            <span class="p-done" style="${() => "width:" + pct(c().judged)}"></span>
            <span class="p-active" style="${() => "width:" + pct((c().queued || 0) + (c().in_progress || 0) + (r.judge === "ai" ? c().submitted || 0 : 0))}"></span>
            <span class="p-waiting" style="${() => "width:" + pct((c().waiting || 0) + (r.judge === "me" ? c().submitted || 0 : 0))}"></span>
            <span class="p-error" style="${() => "width:" + pct(c().failed)}"></span>
          </div>
          <div class="legend">
            <span><i class="leg-done"></i><b>${() => c().judged || 0}</b>&nbsp;judged</span>
            <span><i class="leg-active"></i><b>${() => (c().queued || 0) + (c().in_progress || 0) + (r.judge === "ai" ? c().submitted || 0 : 0)}</b>&nbsp;being worked on</span>
            <span><i class="leg-waiting"></i><b>${() => (c().waiting || 0) + (r.judge === "me" ? c().submitted || 0 : 0)}</b>&nbsp;waiting for you</span>
            <span><i class="leg-error"></i><b>${() => c().failed || 0}</b>&nbsp;failed</span>
          </div>
        </div></div>

        <div class="notice">${icon("blind")}<div class="small">Outputs and scores stay hidden here so judging stays blind. You'll see them on the judging screen, without names.</div></div>

        ${taskIds.map((tid) => {
          const t = d.byId.tasks.get(tid);
          const rows = () => v().attempts.filter((a) => a.task === tid);
          const judgeable = () => rows().some((a) => a.status === "submitted" || a.status === "judged");
          const waiting = () => rows().some((a) => a.status === "waiting");
          return html`<div class="panel">
            <div class="panel__head"><h2 class="h-md">${icon(TYPE_ICON[t?.output_type] || "text")}${t?.title || "Task"}</h2>
              <div class="row-tight">
                ${() => (waiting() ? html`<a class="btn btn--sm btn--primary" href="${"#/handoff/" + r.id + "/" + tid}">${icon("paste")}Paste replies</a>` : "")}
                ${() => (judgeable() ? html`<a class="btn btn--sm" href="${"#/judge/" + r.id + "/" + tid}">${icon("judge")}Open judging</a>` : html`<span class="muted small">Judging starts as outputs arrive</span>`)}
              </div></div>
            <div class="table-wrap"><table>
              <thead><tr><th>Contender</th><th class="col-state">State</th><th class="num">Tokens</th><th class="num">Time</th><th></th></tr></thead>
              <tbody>${() => rows().map((a) => attemptRow(d, r, a))}</tbody>
            </table></div>
          </div>`;
        })}`;
    },
  });
}

function attemptRow(d, r, a) {
  const c = d.byId.contenders.get(a.contender);
  const name = c?.name || a.contender_name || "Contender";
  const tokens = a.tokens_in != null && a.tokens_out != null ? a.tokens_in + a.tokens_out : null;
  const pop = popId();
  let action = "";
  if (a.status === "waiting") action = html`<a class="btn btn--sm btn--primary" href="${"#/handoff/" + r.id + "/" + a.task + "?output=" + a.id}">${icon("paste")}Paste</a>`;
  else if (["submitted", "judged"].includes(a.status)) action = html`<button class="icon-btn" type="button" popovertarget="${pop}" aria-label="Output details">${icon("more")}</button>
    <div class="pop" id="${pop}" popover><div class="pop__head">${icon("file")}Output details</div><div class="pop__body"><dl>
      <dt>${icon("tokens")}Tokens in</dt><dd>${num(a.tokens_in)}</dd><dt>${icon("tokens")}Tokens out</dt><dd>${num(a.tokens_out)}</dd>
      <dt>${icon("time")}Time</dt><dd>${duration(a.duration_ms)}</dd><dt>${icon("cost")}Cost</dt><dd>${money(a.cost)}</dd>
      <dt>Measured by</dt><dd>${a.mode === "handoff" ? "You" : "Audition"}</dd>
    </dl>${a.finish_reason === "max_tokens" ? html`<p class="xs">Cut off at max output tokens.</p>` : ""}${a.error ? html`<p class="xs muted">${a.error}</p>` : ""}</div></div>`;
  const state = a.status === "failed"
    ? html`<span class="row-tight"><button class="info-btn" type="button" popovertarget="${pop}" aria-label="Why it failed">${icon("info")}</button>${chip("error", "Failed", "is-new")}<div class="pop" id="${pop}" popover><div class="pop__head text-error">${icon("error")}This output failed</div><div class="pop__body"><p>It won't be scored. Use <strong>Run again</strong> once the run finishes to try it fresh.</p>${a.error ? html`<code class="xs">${a.error}</code>` : ""}</div></div></span>`
    : outputChip(a.status, r.judge);
  return html`<tr><td>${html`<span class="who">${avatar(name, "sm")}${name}</span>`}</td><td class="col-state">${state}</td><td class="num${tokens == null ? " muted" : ""}">${tokens == null ? "–" : num(tokens)}</td><td class="num${a.duration_ms == null ? " muted" : ""}">${duration(a.duration_ms)}</td><td class="num">${action}</td></tr>`.key(a.id + a.status);
}
