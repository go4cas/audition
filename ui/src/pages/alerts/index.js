// Alerts (docs/PUSH-ALERTS.md): what Audition told you, newest first. The
// same alerts as the emails (a run finished or is ready to judge, a champion
// change, a skipped repeat, outcome checks due), kept in Vaultbase's built-in
// notifications inbox. Opening one marks it read.
import { html } from "@arrow-js/core";
import { APP, go } from "../../lib/nav.js";
import { crumbs, empty, page } from "../../components/page.js";
import { ago, icon } from "../../lib/ui.js";
import { alertPage, alerts, markAllRead, markRead, refreshAlerts } from "../../state/alerts.js";

export const meta = { title: "Alerts · Audition" };

const ICON = { "run-finished": "done", "repeat-skipped": "warning", "outcomes-due": "time" };

export default function alertsPage() {
  return page({
    screen: "alerts",
    narrow: true,
    load: async () => { await refreshAlerts(); },
    body: () => html`
      ${crumbs([["Workspaces", APP + "/"], "Alerts"])}
      <div class="page-head"><div><h1>Alerts</h1>
        <p class="lede">Audition tells you here when a run finishes or is ready for you to judge, when the leaderboard suggests a new champion, when a repeat is skipped, and when outcome checks come due.</p></div>
        <div class="row">${() => (alerts.unread ? html`<button class="btn btn--sm" type="button" @click="${() => markAllRead()}">${icon("check")}Mark all read</button>` : "")}</div></div>
      ${() => (alerts.on === false
        ? html`<div class="notice" data-state="active">${icon("info")}<div><p><strong>Alerts are off.</strong> They start once push notifications are turned on in the Vaultbase admin, under Settings, Notifications. See docs/OPERATIONS.md, "Push alerts".</p></div></div>`
        : alerts.items.length
          ? html`<ul class="alert-list" data-alert-list>${() => alerts.items.map((n) => row(n))}</ul>`
          : empty("bell", "No alerts yet", "When a run finishes, its alert shows up here and on your devices."))}
    `,
  });
}

function row(n) {
  const open = (e) => { e.preventDefault(); markRead(n); go(alertPage(n)); };
  return html`<li class="${() => "alert-item" + (n.read_at ? "" : " is-unread")}" data-alert="${n.id}">
    <a class="alert-item__link" href="${APP + alertPage(n)}" @click="${open}">
      <span class="alert-item__icon">${icon(ICON[n.type] || "bell")}</span>
      <span class="alert-item__text"><strong>${n.title}</strong>${n.body ? html`<span class="small muted">${n.body}</span>` : ""}</span>
      <span class="small muted alert-item__when">${ago(n.created || n.created_at)}</span>
    </a>
  </li>`;
}
