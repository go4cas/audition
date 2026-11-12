// 10. Run progress: a live bar and one table per task. While the run is active
// the page listens for realtime events on the run and its outputs and reloads
// GET /runs/:id when one arrives; while the realtime connection is down it
// polls that route every 2 seconds instead (PLATFORM-UPGRADES B3). Outputs and
// scores stay hidden here so judging stays blind.
import { html, reactive } from "@arrow-js/core";
import { custom } from "../../api.js";
import { APP, go, routeArgs } from "../../lib/nav.js";
import { busy, crumbs, page } from "../../components/page.js";
import { TYPE_ICON, avatar, chip, duration, errorToast, icon, money, num, outputChip, plural, popId, time, toast } from "../../lib/ui.js";
import { load, runLabel } from "../../state/data.js";
import { refreshInbox } from "../../state/inbox.js";
import { subscribe } from "../../lib/realtime.js";
import { DAYS, describe, toCron } from "../../lib/schedule.js";
import { dropdown } from "../../components/forms.js";

export const meta = { title: "Run · Audition" };

export default function run() {
  const { params } = routeArgs();
  return page({
    screen: "run",
    load: async (s) => {
      const [d, live] = await Promise.all([load("workspaces", "roles", "tasks", "contenders", "runs"), custom.run(params.id)]);
      s.d = d;
      // mode: "realtime" while the realtime subscription is up, else "polling".
      s.live = reactive({ v: live, mode: "polling" });
      const done = () => s.live.v.run.status === "done";
      // One fetch at a time; a change that lands while one is in flight
      // fetches once more after it, so the last event is never missed.
      let inFlight = false, again = false, soon = null;
      const refresh = async () => {
        if (inFlight) { again = true; return; }
        inFlight = true;
        try {
          const before = s.live.v.counts;
          const v = await custom.run(params.id);
          if (JSON.stringify(v.counts) !== JSON.stringify(before)) refreshInbox();
          s.live.v = v;
        } catch { /* keep the last view */ }
        inFlight = false;
        if (again) { again = false; refresh(); }
        if (done()) stopLive();
      };
      // Events only say "something changed": the page still reads the run
      // through GET /runs/:id, which keeps outputs out of this view (blind).
      const nudge = () => { clearTimeout(soon); soon = setTimeout(refresh, 150); };
      const stopLive = subscribe([`runs/${params.id}`, "attempts"], {
        onEvent: (m) => { if (m.collection === "runs" || m.record?.run === params.id) nudge(); },
        onStatus: (st) => {
          s.live.mode = st === "live" ? "realtime" : "polling";
          if (st === "live") nudge(); // catch up on anything missed while polling
        },
      });
      // Polling is the fallback while the realtime connection is down.
      const timer = setInterval(() => { if (s.live.mode === "polling" && !done()) refresh(); }, 2000);
      if (done()) stopLive();
      s.onLeave(() => { clearInterval(timer); clearTimeout(soon); stopLive(); });
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
        ${crumbs([["Workspaces", APP + "/"], [ws?.name || "Workspace", APP + "/w/" + r.workspace], [role?.name || "Role", APP + "/r/" + r.role]])}
        <div class="page-head">
          <div><h1>${runLabel(d, r)} · ${role?.name}</h1>
            <p class="lede row-tight"><span class="badge">${icon(r.judge === "ai" ? "ai" : "me")}Judge: ${judgeName}</span><span class="badge">${icon("time")}Started ${time(r.created)}</span><span class="badge">${plural(taskIds.length, "task")} × ${plural(r.contenders?.length || 0, "contender")}</span>${r.rerun_of ? html`<a class="badge link-plain" href="${APP + "/runs/" + r.rerun_of}">${icon("again")}Again from ${runLabel(d, { id: r.rerun_of })}</a>` : ""}</p></div>
          <div class="row">
            <a class="btn" href="${APP + "/leaderboard/" + r.role}">${icon("leaderboard")}Leaderboard</a>
            ${() => (v().run.status === "done" ? html`<button class="btn btn--primary" type="button" @click="${again}">${icon("again", "i--spin-on-hover")}Run again</button>` : html`<span data-tip="Available when every output is in and judged" tabindex="0"><button class="btn" type="button" disabled>${icon("again")}Run again</button></span>`)}
          </div>
        </div>

        <div class="panel" data-live="${() => s.live.mode}"><div class="panel__body gap-10">
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

        ${() => (v().run.status === "done" ? repeatPanel(s, d, r) : "")}

        <div class="notice">${icon("blind")}<div class="small">Outputs and scores stay hidden here so judging stays blind. You'll see them on the judging screen, without names.</div></div>

        ${taskIds.map((tid) => {
          const t = d.byId.tasks.get(tid);
          const rows = () => v().attempts.filter((a) => a.task === tid);
          const judgeable = () => rows().some((a) => a.status === "submitted" || a.status === "judged");
          const waiting = () => rows().some((a) => a.status === "waiting");
          return html`<div class="panel">
            <div class="panel__head"><h2 class="h-md">${icon(TYPE_ICON[t?.output_type] || "text")}${t?.title || "Task"}</h2>
              <div class="row-tight">
                ${() => (waiting() ? html`<a class="btn btn--sm btn--primary" href="${APP + "/handoff/" + r.id + "/" + tid}">${icon("paste")}Paste replies</a>` : "")}
                ${() => (judgeable() ? html`<a class="btn btn--sm" href="${APP + "/judge/" + r.id + "/" + tid}">${icon("judge")}Open judging</a>` : html`<span class="muted small">Judging starts as outputs arrive</span>`)}
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

const EVERY = [{ value: "day", label: "Day" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }];
const DAY_OPTS = DAYS.map((label, value) => ({ value, label }));

// Repeat: turn a done run into a Vaultbase cron job that runs it again, daily,
// weekly or monthly (docs/PHASE-2A.md, part 2).
function repeatPanel(s, d, r) {
  const parent = r.rerun_of ? d.byId.runs.get(r.rerun_of) : null;
  if (parent?.schedule) {
    return html`<div class="notice">${icon("again")}<div class="small">This run is a repeat. <a href="${APP + "/runs/" + parent.id}">The run it repeats</a> ${describe(parent.schedule)} holds the schedule.</div></div>`;
  }
  const f = s.rep || (s.rep = reactive({ schedule: r.schedule || "", every: "week", day: 1, date: 1, time: "09:00" }));
  const unattended = r.judge === "me" || (r.contenders || []).some((id) => d.byId.contenders.get(id)?.mode === "handoff");
  const save = (schedule) => (e) => busy(e, async () => {
    try {
      const cron = schedule === undefined ? toCron(f) : schedule;
      const out = await custom.runSchedule(r.id, cron);
      f.schedule = out.run?.schedule || "";
      toast(f.schedule ? `Repeats ${describe(f.schedule)}` : "Stopped repeating", "done", "again");
    } catch (err) { errorToast(err); }
  });
  return html`<div class="panel"><div class="panel__body gap-10">
    ${() => (f.schedule
      ? html`<div class="row-between"><span class="row-tight">${icon("again")}<strong>${"Repeats " + describe(f.schedule)}</strong></span><button class="btn btn--sm" type="button" @click="${save(null)}">Stop repeating</button></div>
        <p class="small muted">Each repeat is a new run like Run again. You get an email when it finishes.</p>`
      : html`<div class="row-tight">${icon("again")}<strong>Repeat this run</strong></div>
        <div class="fields-2">
          <div class="field"><label for="rp-every">Every</label>${dropdown({ id: "rp-every", label: "Every", options: () => EVERY, value: () => f.every, onChange: (v) => { f.every = v; } })}</div>
          ${() => (f.every === "week" ? html`<div class="field"><label for="rp-day">On</label>${dropdown({ id: "rp-day", label: "On", options: () => DAY_OPTS, value: () => f.day, onChange: (v) => { f.day = v; } })}</div>` : "")}
          ${() => (f.every === "month" ? html`<div class="field"><label for="rp-date">On day</label><input class="input" id="rp-date" type="number" min="1" max="28" value="${f.date}" @input="${(e) => { f.date = Number(e.target.value) || 1; }}"></div>` : "")}
          <div class="field"><label for="rp-time">At (your time)</label><input class="input" id="rp-time" type="time" value="${f.time}" @input="${(e) => { f.time = e.target.value; }}"></div>
        </div>
        ${unattended ? html`<div class="notice" data-state="warning">${icon("warning")}<div class="small">${r.judge === "me" ? "You judge this run, so each repeat waits for you to judge it." : "Some contenders are copy and paste, so their outputs wait for you each time."} You get an email when a repeat needs you.</div></div>` : ""}
        <div><button class="btn btn--primary" type="button" @click="${save(undefined)}">${icon("again")}Repeat</button></div>`)}
  </div></div>`;
}

function attemptRow(d, r, a) {
  const c = d.byId.contenders.get(a.contender);
  const name = c?.name || a.contender_name || "Contender";
  const tokens = a.tokens_in != null && a.tokens_out != null ? a.tokens_in + a.tokens_out : null;
  const pop = popId();
  let action = "";
  if (a.status === "waiting") action = html`<a class="btn btn--sm btn--primary" href="${APP + "/handoff/" + r.id + "/" + a.task + "?output=" + a.id}">${icon("paste")}Paste</a>`;
  else if (["submitted", "judged"].includes(a.status)) action = html`<button class="icon-btn" type="button" popovertarget="${pop}" aria-label="Output details">${icon("more")}</button>
    <div class="pop" id="${pop}" popover><div class="pop__head">${icon("file")}Output details</div><div class="pop__body"><dl>
      <dt>${icon("tokens")}Tokens in</dt><dd>${num(a.tokens_in)}</dd><dt>${icon("tokens")}Tokens out</dt><dd>${num(a.tokens_out)}</dd>
      <dt>${icon("time")}Time</dt><dd>${duration(a.duration_ms)}</dd><dt>${icon("cost")}Cost</dt><dd>${money(a.cost)}</dd>
      <dt>Measured by</dt><dd>${a.mode === "handoff" ? "You" : "Audition"}</dd>
    </dl>${a.finish_reason === "max_tokens" ? html`<p class="xs">Cut off at max output tokens.</p>` : ""}${a.provider_calls > 1 ? html`<p class="xs muted">Took ${a.provider_calls} tries: the provider failed and Audition retried.</p>` : ""}${a.error ? html`<p class="xs muted">${a.error}</p>` : ""}</div></div>`;
  const state = a.status === "failed"
    ? html`<span class="row-tight"><button class="info-btn" type="button" popovertarget="${pop}" aria-label="Why it failed">${icon("info")}</button>${chip("error", "Failed", "is-new")}<div class="pop" id="${pop}" popover><div class="pop__head text-error">${icon("error")}This output failed</div><div class="pop__body"><p>It won't be scored. Use <strong>Run again</strong> once the run finishes to try it fresh.</p>${a.error ? html`<code class="xs">${a.error}</code>` : ""}</div></div></span>`
    : outputChip(a.status, r.judge);
  return html`<tr><td>${html`<span class="who">${avatar(name, "sm")}${name}</span>`}</td><td class="col-state">${state}</td><td class="${"num" + (tokens == null ? " muted" : "")}">${tokens == null ? "–" : num(tokens)}</td><td class="${"num" + (a.duration_ms == null ? " muted" : "")}">${duration(a.duration_ms)}</td><td class="num">${action}</td></tr>`.key(a.id + a.status);
}
