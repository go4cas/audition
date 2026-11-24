// 10. Run progress: a live bar and one table per task. The page listens for
// realtime events on the run, its outputs, its guest links and guest votes,
// and reloads GET /runs/:id when one arrives; while the realtime connection is
// down it polls that route every 2 seconds instead (PLATFORM-UPGRADES B3).
// Once the run is done it keeps listening only while a guest link is open, so
// the Guest votes counts stay live. Outputs and scores stay hidden here so
// judging stays blind.
import { html, reactive } from "@arrow-js/core";
import { create, custom, update } from "../../api.js";
import { APP, go, routeArgs } from "../../lib/nav.js";
import { busy, crumbs, page } from "../../components/page.js";
import { TYPE_ICON, avatar, chip, copyText, date, duration, errorToast, icon, money, num, outputChip, plural, popId, time, toast, METHOD_LABEL } from "../../lib/ui.js";
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
      // Guests can vote long after the run is done, so a done run still
      // follows its open guest link (the Guest votes box).
      const guestsOpen = () => (s.live.v.guests || []).some((l) => l.state === "open");
      const following = () => !done() || guestsOpen();
      // One fetch at a time; a change that lands while one is in flight
      // fetches once more after it, so the last event is never missed.
      let inFlight = false, again = false, soon = null, stopLive = null;
      const refresh = async () => {
        if (inFlight) { again = true; return; }
        inFlight = true;
        try {
          const before = s.live.v;
          const v = await custom.run(params.id);
          if (JSON.stringify(v.counts) !== JSON.stringify(before.counts)) refreshInbox();
          s.live.v = v;
          if (JSON.stringify(v.guests) !== JSON.stringify(before.guests)) s.guestsChanged?.();
        } catch { /* keep the last view */ }
        inFlight = false;
        if (again) { again = false; refresh(); }
        follow();
      };
      // Events only say "something changed": the page still reads the run
      // through GET /runs/:id, which keeps outputs and votes out of this view
      // (blind). Vaultbase topics have no filter, so events on other runs'
      // outputs, links and votes are dropped here.
      const nudge = () => { clearTimeout(soon); soon = setTimeout(refresh, 150); };
      const start = () => subscribe([`runs/${params.id}`, "attempts", "guest_links", "guest_votes"], {
        onEvent: (m) => { if (m.collection === "runs" || m.record?.run === params.id) nudge(); },
        onStatus: (st) => {
          s.live.mode = st === "live" ? "realtime" : "polling";
          if (st === "live") nudge(); // catch up on anything missed while polling
        },
      });
      // Listen while there is something to follow; stop once there isn't.
      // The guest panel calls follow() after making a link, to start again.
      const follow = () => {
        if (following() && !stopLive) stopLive = start();
        else if (!following() && stopLive) { stopLive(); stopLive = null; }
      };
      s.follow = follow;
      // Polling is the fallback while the realtime connection is down.
      const timer = setInterval(() => { if (stopLive && s.live.mode === "polling") refresh(); }, 2000);
      follow();
      s.onLeave(() => { clearInterval(timer); clearTimeout(soon); stopLive?.(); stopLive = null; });
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
            <p class="lede row-tight"><span class="badge">${icon(r.judge === "ai" ? "ai" : "me")}Judge: ${judgeName}</span><span class="badge">${icon(r.method === "compare" ? "judge" : "star")}${METHOD_LABEL[r.method === "compare" ? "compare" : "rate"]}${r.both_orders ? ", both ways" : ""}</span><span class="badge">${icon("time")}Started ${time(r.created)}</span><span class="badge">${plural(taskIds.length, "task")} × ${plural(r.contenders?.length || 0, "contender")}</span>${r.rerun_of ? html`<a class="badge link-plain" href="${APP + "/runs/" + r.rerun_of}">${icon("again")}Again from ${runLabel(d, { id: r.rerun_of })}</a>` : ""}</p></div>
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

        ${guestPanel(s, r)}

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

// Guest votes (TECH-SPEC §10b): a link anyone can open to rate this run's
// outputs, blind, without an account. The owner copies it, sees how many
// guests voted, decides whether their votes count on the leaderboard, and
// closes it.
function guestPanel(s, r) {
  // Drawn by hand into its host, not through a reactive slot: its shape
  // changes (no link, an open link, older links), and Arrow 1.0.6 can't swap
  // template shapes in one slot reliably (NOTES U3, P4).
  const hostId = "guest-panel-body";
  let links = s.live.v.guests || [];
  const draw = () => {
    const host = document.getElementById(hostId);
    if (!host) { requestAnimationFrame(draw); return; }
    host.replaceChildren();
    body()(host);
  };
  const reload = async () => { try { s.live.v = await custom.run(r.id); links = s.live.v.guests || []; } catch { /* keep the last view */ } draw(); s.follow?.(); };
  // Live: the page's realtime refresh calls this when the links or their
  // guest and vote counts change.
  s.guestsChanged = () => { links = s.live.v.guests || []; draw(); };
  const urlOf = (l) => `${location.origin}${APP}/vote/${l.token}`;
  const make = (e) => busy(e, async () => {
    try {
      // One open link at a time: a new one closes the old.
      for (const l of links.filter((x) => x.state === "open")) await update("guest_links", l.id, { active: false });
      await create("guest_links", { run: r.id });
      await reload();
      toast("Guest link ready. Copy it and send it to anyone.", "done", "send");
    } catch (err) { errorToast(err); }
  });
  const set = (l, patch, msg) => async (e) => {
    try { await update("guest_links", l.id, patch); toast(msg, "done", "check"); } catch (err) { errorToast(err); }
    await reload();
  };
  const copy = (l) => async (e) => {
    const ok = await copyText(urlOf(l), e.currentTarget.closest(".guest-link")?.querySelector("input"));
    toast(ok ? "Link copied" : "Select the link and copy it", ok ? "done" : "error", ok ? "copy" : "warning");
  };
  const STATE = { open: ["done", "Open"], closed: ["draft", "Closed"], expired: ["draft", "Expired"], full: ["warning", "Full"] };
  const countsSwitch = (l) => html`<label class="switch"><input type="checkbox" checked="${l.counts}" data-testid="guest-counts" @change="${(e) => set(l, { counts: e.target.checked }, e.target.checked ? "Guest votes from this link now count" : "Guest votes from this link no longer count")(e)}"><span class="switch__track"></span>Count on the leaderboard</label>`;
  const stats = (l) => html`<div class="guest-stats small text-2">
    <span class="row-tight">${icon("me")}${plural(l.guests, "guest")} of ${l.max_guests}</span>
    <span class="row-tight">${icon("star")}${plural(l.votes, "vote")}</span>
    ${l.expires_at ? html`<span class="row-tight">${icon("time")}${l.state === "expired" ? "Closed" : "Closes"} ${date(l.expires_at)}</span>` : ""}
  </div>`;
  const hint = html`<p class="xs muted">When counting is on, all guest votes on one output together count as one more judge, once 3 guests have voted on it. Your own verdicts are never replaced.</p>`;
  const body = () => {
    const open = links.find((l) => l.state === "open");
    const rest = links.filter((l) => l !== open);
    const makeBtn = open ? "" : html`<button class="btn btn--sm btn--primary" type="button" data-testid="guest-make" @click="${make}">${icon("plus")}${links.length ? "New guest link" : "Ask guests to vote"}</button>`;
    return html`<div class="panel__head"><h2 class="h-md">${icon("send")}Guest votes</h2>${makeBtn}</div>
      <div class="panel__body gap-10">
        ${links.length ? "" : html`<p class="small text-2">Want more opinions? Make a link and send it to anyone. They rate this run's outputs ${r.method === "compare" ? "two at a time" : "with stars"}, without an account, and never see which tool made what.</p>`}
        ${open ? html`<div class="stack-sm" data-testid="guest-open">
          <div class="guest-link"><input class="input grow" readonly aria-label="Guest link" value="${urlOf(open)}" @focus="${(e) => e.target.select()}"><button class="btn" type="button" @click="${copy(open)}">${icon("copy")}Copy link</button></div>
          <div class="row-between">${stats(open)}<div class="row-tight">${countsSwitch(open)}<button class="btn btn--sm btn--quiet" type="button" @click="${set(open, { active: false }, "Link closed. Guests can't vote with it any more.")}">${icon("close")}Close link</button></div></div>
        </div>` : ""}
        ${hint}
        ${rest.length ? html`<div class="stack-sm"><p class="small text-2">${open ? "Earlier links" : "Links"}</p><ul class="list">${rest.map((l) => html`<li class="row-between">
          <span class="row-tight">${chip(STATE[l.state][0], STATE[l.state][1])}<span class="small text-2">Made ${date(l.created)}</span></span>${stats(l)}${countsSwitch(l)}</li>`)}</ul></div>` : ""}
      </div>`;
  };
  draw();
  return html`<div class="panel" data-testid="guest-panel" id="${hostId}"></div>`;
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
