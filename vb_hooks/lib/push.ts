// Push alerts on devices (docs/PUSH-ALERTS.md). Vaultbase sends the pushes
// itself: helpers.notify hands each alert to the OneSignal provider turned on
// in the admin (Settings, Notifications). This file only tells the app
// whether OneSignal is on and its public App ID, so the app can offer "Turn on
// alerts on this device", and names the origins the app's CSP lets OneSignal's
// SDK use (lib/static.ts APP_CSP).
// No "vaultbase" import (F7).
import type { Sql } from "./store.ts";

export interface PushConfig { provider: "onesignal" | null; app_id: string | null }

/** OneSignal's web SDK, loaded only once OneSignal is turned on. */
export const ONESIGNAL_SDK = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";
export const ONESIGNAL_WORKER = "OneSignalSDKWorker.js";
/**
 * The service worker file OneSignal needs on our own origin, inside the app's
 * scope. scripts/build-ui.ts writes it to ui/dist, so it is served at
 * /OneSignalSDKWorker.js next to the app. It only runs once the app registers
 * it, which happens when the owner turns alerts on.
 */
export const ONESIGNAL_WORKER_JS = `importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");\n`;

const truthy = (v: unknown) => v === "1" || v === "true" || v === true;

export async function pushConfig(sql: Sql): Promise<PushConfig> {
  try {
    const rows = await sql.query<{ key: string; value: string }>(
      `SELECT key, value FROM vaultbase_settings WHERE key IN ('notifications.providers.onesignal.enabled', 'notifications.providers.onesignal.app_id')`,
    );
    const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const appId = String(s["notifications.providers.onesignal.app_id"] ?? "").trim();
    if (truthy(s["notifications.providers.onesignal.enabled"]) && appId) return { provider: "onesignal", app_id: appId };
  } catch { /* no settings table access: push stays off */ }
  return { provider: null, app_id: null };
}

/**
 * The app's CSP with OneSignal's origins added: its SDK and service worker
 * load from cdn.onesignal.com and talk to onesignal.com. The SDK reads the
 * app's config by JSONP (a <script> from api.onesignal.com/sync/<app id>/web),
 * so OneSignal's API hosts are script sources too; without them init times out.
 */
export function withOneSignal(csp: string): string {
  const add = (dir: string, extra: string) => csp = csp.replace(new RegExp(`(^|; )${dir} ([^;]*)`), (_m, pre, v) => `${pre}${dir} ${v} ${extra}`);
  add("script-src", "https://cdn.onesignal.com https://api.onesignal.com https://onesignal.com");
  add("style-src", "https://cdn.onesignal.com");
  add("connect-src", "https://cdn.onesignal.com https://onesignal.com https://api.onesignal.com");
  add("img-src", "https://cdn.onesignal.com https://img.onesignal.com");
  return csp;
}
