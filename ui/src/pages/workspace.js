// 3. Workspace: numbered stages with role cards (the routing table), recent runs.
import { html } from "@arrow-js/core";
import { crumbs, empty, page } from "../components/page.js";
import { avatar, chip, date, icon, plural } from "../lib/ui.js";
import { championOf, leaderboards, load, runLabel, sortRoles } from "../state/data.js";

export default function workspace({ params }) {
  return page({
    screen: "workspace",
    load: async (s) => {
      s.d = await load();
      s.ws = s.d.byId.workspaces.get(params.id);
      if (!s.ws) throw new Error("This workspace doesn't exist any more.");
      s.lb = await leaderboards(s.d.roles.filter((r) => r.workspace === params.id).map((r) => r.id));
    },
    body: (s) => {
      const { d, ws } = s;
      const stages = d.stages.filter((x) => x.workspace === ws.id);
      const roles = sortRoles(d, d.roles.filter((r) => r.workspace === ws.id));
      const runs = d.runs.filter((r) => r.workspace === ws.id).reverse();
      const groups = [...stages.map((st) => ({ st, roles: roles.filter((r) => r.stage === st.id) })), { st: null, roles: roles.filter((r) => !r.stage) }].filter((g) => g.st || g.roles.length);
      return html`
        ${crumbs([["Workspaces", "#/"]])}
        <div class="page-head">
          <div class="row row--top">${avatar(ws.name, "lg")}<div><h1>${ws.name}</h1><p class="lede">${ws.description || "The champion of each role is the one to use. Open a role to see its rubric, tasks and leaderboard."}</p></div></div>
          <div class="row">
            <a class="btn btn--quiet" href="${"#/w/" + ws.id + "/settings"}">${icon("settings", "i--spin-on-hover")}Settings</a>
            <a class="btn" href="${"#/w/" + ws.id + "/roles/new"}">${icon("plus")}Add role</a>
            <a class="btn btn--primary" href="${"#/runs/new?ws=" + ws.id}">${icon("play")}Start a run</a>
          </div>
        </div>
        ${roles.length ? html`<div class="stages stagger">${groups.map((g) => html`<div class="stage">
            <div class="stage__name"><span class="eyebrow">${g.st ? g.st.name : "No stage"}</span></div>
            ${g.roles.length ? g.roles.map((r) => roleCard(d, ws, r, s.lb.get(r.id))) : html`<a class="card-link role-card role-card--empty" href="${"#/w/" + ws.id + "/roles/new?stage=" + g.st.id}"><span class="muted small">No role in this stage yet</span><span class="btn btn--sm self-start">${icon("plus")}Add a role</span></a>`}
          </div>`)}</div>`
          : html`<div class="panel">${empty("rubric", "No roles yet", "A role is a job in this workflow, with a rubric that says what good looks like.", html`<a class="btn btn--primary" href="${"#/w/" + ws.id + "/roles/new"}">${icon("plus")}Add role</a>`)}</div>`}
        <div class="panel">
          <div class="panel__head"><h2>${icon("history")}Recent runs</h2></div>
          ${runs.length ? html`<div class="table-wrap"><table>
            <thead><tr><th>Run</th><th>Role</th><th class="num">Outputs</th><th>Judge</th><th class="col-state">State</th><th></th></tr></thead>
            <tbody>${runs.slice(0, 12).map((r) => runRow(d, r))}</tbody></table></div>`
          : empty("play", "No runs yet", "Start a run to see contenders compete on the same tasks.")}
        </div>`;
    },
  });
}

function roleCard(d, ws, r, lb) {
  const c = championOf(d, r.id);
  const tasks = d.tasks.filter((t) => t.role === r.id && !d.tasks.some((n) => n.previous_version === t.id)).length;
  const runs = d.runs.filter((x) => x.role === r.id);
  const live = runs.filter((x) => x.status !== "done").at(-1);
  const scored = (lb?.rows || []).reduce((n, x) => n + (x.n || 0), 0);
  const name = (id) => d.byId.contenders.get(id)?.name || "?";
  let cast, state;
  if (c) { cast = html`<div class="cast">${avatar(name(c.contender), "sm")}<strong>${name(c.contender)}</strong></div>`; state = chip("champion", `Champion since ${date(c.since || c.created)}`, "self-start"); }
  else if (lb?.suggested) { cast = html`<div class="cast">${avatar(name(lb.suggested), "sm")}<strong>${name(lb.suggested)}</strong></div>`; state = chip("warning", "Suggested, confirm it", "self-start"); }
  else { cast = html`<div class="cast muted">${icon("draft")}${runs.length ? "No champion yet" : "No runs yet"}</div>`; state = runs.length ? "" : html`<span class="btn btn--sm self-start">${icon("play")}Start the first run</span>`; }
  if (live) state = chip("active", `${runLabel(d, live)} in progress`, "self-start");
  return html`<a class="card-link role-card" href="${"#/r/" + r.id}">
    <div class="row-tight"><h3>${r.name}</h3>${icon("arrow-right", "go")}</div>
    ${cast}${state}
    <div class="muted xs num">${plural(tasks, "task")} · ${plural(scored, "output")} scored</div>
  </a>`;
}

export function runRow(d, r) {
  const st = r.status === "running" ? chip("active", "Running") : r.status === "judging" ? (r.judge === "me" ? chip("waiting", "Waiting for you") : chip("active", "Being judged")) : chip("done", "Finished");
  const again = r.rerun_of ? html` <span class="badge" data-tip="${"Started with Run again from " + runLabel(d, { id: r.rerun_of })}">${icon("again")}${runLabel(d, { id: r.rerun_of })}</span>` : "";
  return html`<tr><td><strong>${runLabel(d, r)}</strong>${again}</td><td>${d.byId.roles.get(r.role)?.name}</td><td class="num">${(r.tasks?.length || 0) * (r.contenders?.length || 0)}</td><td><span class="badge">${icon(r.judge === "ai" ? "ai" : "me")}${r.judge === "ai" ? "AI" : "Me"}</span></td><td class="col-state">${st}</td><td class="num"><a class="btn btn--sm btn--quiet" href="${"#/runs/" + r.id}">Open${icon("arrow-right", "i--nudge")}</a></td></tr>`;
}
