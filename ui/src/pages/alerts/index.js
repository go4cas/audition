// Alerts (docs/PUSH-ALERTS.md): what Audition told you, newest first. The
// same alerts as the emails (a run finished or is ready to judge, a champion
// change, a skipped repeat, outcome checks due), kept in Vaultbase's built-in
// notifications inbox. Opening one marks it read.
import { html } from "@arrow-js/core";
import { APP, go } from "../../lib/nav.js";
import { crumbs, empty, page } from "../../components/page.js";
import { ago, icon } from "../../lib/ui.js";
import { alertPage, alerts, markAllRead, markRead, refreshAlerts } from "../../state/alerts.js";
import { push, turnOffPush, turnOnPush } from "../../lib/push.js";

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
        : html`<div class="stack">${device()}${() => (alerts.items.length
          ? html`<ul class="alert-list" data-alert-list>${() => alerts.items.map((n) => row(n))}</ul>`
          : empty("bell", "No alerts yet", "When a run finishes, its alert shows up here and on your devices."))}</div>`)}
    `,
  });
}

function row(n) {
  const open = (e) => { e.preventDefault(); markRead(n); go(alertPage(n)); };
  const inner = html`<span class="alert-item__icon">${icon(ICON[n.type] || "bell")}</span>
      <span class="alert-item__text"><strong>${n.title}</strong>${n.body ? html`<span class="small muted">${n.body}</span>` : ""}</span>
      <span class="small muted alert-item__when">${ago(n.created || n.created_at)}</span>`;
  // An alert with no page (such as the admin's "Vaultbase test") has nowhere
  // to go: a tap only marks it read, instead of reloading this page.
  const target = alertPage(n) === "/alerts"
    ? html`<button class="alert-item__link" type="button" data-alert-read @click="${() => markRead(n)}">${inner}</button>`
    : html`<a class="alert-item__link" href="${APP + alertPage(n)}" @click="${open}">${inner}</a>`;
  return html`<li class="${() => "alert-item" + (n.read_at ? "" : " is-unread")}" data-alert="${n.id}">${target}</li>`;
}

/**
 * "On this device": turn push alerts on or off for this browser (OneSignal).
 * Mounted once with reactive parts: Arrow 1.0.6 recycles a template by its
 * shape and keeps a recycled one's static values (NOTES U3).
 */
const DEVICE_TEXT = {
  unsupported: "This browser can't get push alerts. On an iPhone or iPad, add Audition to your Home Screen first (Share, Add to Home Screen), then open it from there.",
  blocked: "This browser blocks alerts from Audition. Allow notifications for this site in the browser's settings, then come back.",
  off: "Get these alerts on this device, even when Audition is closed.",
  on: "This device gets these alerts, even when Audition is closed.",
  busy: "One moment…",
};
const act = () => (push.state === "off" ? "on" : push.state === "on" ? "off" : "");

function device() {
  return html`<div class="panel push-device" data-push="${() => push.state}" hidden="${() => !DEVICE_TEXT[push.state]}"><div class="push-device__body">
    <span class="push-device__text"><strong>On this device</strong><span class="small muted">${() => DEVICE_TEXT[push.state] || ""}</span><span class="small" data-push-error hidden="${() => !push.error}">${() => (push.error ? "Couldn't change this: " + push.error : "")}</span></span>
    <button class="${() => (act() === "on" ? "btn btn--primary btn--sm" : "btn btn--sm")}" type="button" data-push-action="${() => act()}" hidden="${() => !act()}" @click="${() => (act() === "on" ? turnOnPush() : turnOffPush())}">
      <span class="push-device__label" hidden="${() => act() !== "on"}">${icon("bell")}Turn on alerts here</span><span class="push-device__label" hidden="${() => act() !== "off"}">${icon("bell-off")}Turn off here</span></button>
  </div></div>`;
}
