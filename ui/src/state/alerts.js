// Alerts (docs/PUSH-ALERTS.md): the owner's notifications inbox, a built-in
// Vaultbase collection that helpers.notify writes to. The bell in the top bar
// shows the unread count, live over realtime. `on` is false while Vaultbase's
// notifications are not turned on (the collection doesn't exist yet).
import { reactive } from "@arrow-js/core";
import { auth, page, update } from "../api.js";
import { subscribe } from "../lib/realtime.js";
import { toast } from "../lib/ui.js";

export const alerts = reactive({ on: null, items: [], unread: 0 });

export async function refreshAlerts() {
  try {
    const r = await page("notifications", { sort: "-created_at", perPage: 50 });
    alerts.items = r.data || [];
    alerts.unread = alerts.items.filter((n) => !n.read_at).length;
    alerts.on = true;
  } catch (e) {
    if (e && e.status === 404) { alerts.on = false; alerts.items = []; alerts.unread = 0; }
  }
}

export async function markRead(n) {
  if (n.read_at) return;
  n.read_at = new Date().toISOString();
  alerts.unread = alerts.items.filter((x) => !x.read_at).length;
  try { await update("notifications", n.id, { read_at: n.read_at }); } catch { /* the next refresh shows the truth */ }
}

export async function markAllRead() {
  await Promise.all(alerts.items.filter((n) => !n.read_at).map(markRead));
}

/** The app page an alert points to (data.page is base-relative, e.g. /runs/123). */
export const alertPage = (n) => (n && n.data && typeof n.data.page === "string" && n.data.page.startsWith("/") ? n.data.page : "/alerts");

let stop = null;
/** Follow the inbox live while signed in; a new alert also shows as a toast. */
export function followAlerts() {
  const start = () => {
    stop?.();
    stop = null;
    if (!auth.token) return;
    refreshAlerts();
    stop = subscribe(["notifications"], {
      onEvent: (m) => {
        if (m.type === "create" && m.record?.title) toast(m.record.title, "waiting", "bell");
        refreshAlerts();
      },
      onStatus: (s) => { if (s === "live") refreshAlerts(); },
    });
  };
  auth.onChange(start);
  start();
}
