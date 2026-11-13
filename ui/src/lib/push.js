// Push alerts on this device through OneSignal (docs/PUSH-ALERTS.md).
// Vaultbase sends every alert to OneSignal with the owner's user id; this
// device receives them once it has OneSignal's SDK, permission to notify, and
// is logged in to OneSignal as that user id. The SDK is loaded only when the
// owner turns alerts on here (and on later visits from this device), never
// before. A click on a push opens the alert's page.
import { reactive } from "@arrow-js/core";
import { custom, me } from "../api.js";
import { BASE, go } from "./nav.js";

const SDK = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";
const FLAG = "audition.push";

/** state: "checking" | "off-server" (OneSignal not on) | "unsupported" | "blocked" | "off" | "on" | "busy" */
export const push = reactive({ state: "checking", error: "" });

const supported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const flag = (v) => { try { if (v === undefined) return localStorage.getItem(FLAG) === "1"; v ? localStorage.setItem(FLAG, "1") : localStorage.removeItem(FLAG); } catch { return false; } };

let sdk = null;
/** Load OneSignal's SDK once and init it for this app; resolves to OneSignal. */
function oneSignal(appId) {
  if (sdk) return sdk;
  sdk = new Promise((resolve, reject) => {
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async (OneSignal) => {
      try {
        await OneSignal.init({
          appId,
          serviceWorkerPath: BASE.slice(1) + "OneSignalSDKWorker.js",
          serviceWorkerParam: { scope: BASE },
          allowLocalhostAsSecureOrigin: location.hostname === "localhost",
        });
        OneSignal.Notifications.addEventListener("click", (e) => {
          const page = e?.notification?.additionalData?.page;
          if (typeof page === "string" && page.startsWith("/")) go(page);
        });
        resolve(OneSignal);
      } catch (err) { reject(err); }
    });
    const s = document.createElement("script");
    s.src = SDK;
    s.defer = true;
    s.onerror = () => reject(new Error("Couldn't load OneSignal. Check the connection and try again."));
    document.head.appendChild(s);
  });
  sdk.catch(() => { sdk = null; });
  return sdk;
}

const stateOf = (OneSignal) =>
  Notification.permission === "denied" ? "blocked"
  : OneSignal?.User?.PushSubscription?.optedIn && Notification.permission === "granted" ? "on" : "off";

let config = null;
/** Read whether OneSignal is on; on a device that turned alerts on before, start the SDK. */
export async function checkPush() {
  try { config = await custom.push(); } catch { config = null; }
  if (!config || config.provider !== "onesignal" || !config.app_id) { push.state = "off-server"; return; }
  if (!supported()) { push.state = "unsupported"; return; }
  if (Notification.permission === "denied") { push.state = "blocked"; return; }
  if (!flag()) { push.state = "off"; return; }
  try {
    const OneSignal = await oneSignal(config.app_id);
    const id = me()?.id;
    if (id) await OneSignal.login(id);
    push.state = stateOf(OneSignal);
  } catch (err) { push.state = "off"; push.error = err?.message || String(err); }
}

/** Ask this browser for permission and subscribe it to the owner's alerts. */
export async function turnOnPush() {
  if (!config?.app_id) return;
  push.state = "busy"; push.error = "";
  try {
    const OneSignal = await oneSignal(config.app_id);
    const id = me()?.id;
    if (id) await OneSignal.login(id);
    await OneSignal.Notifications.requestPermission();
    if (Notification.permission === "granted") await OneSignal.User.PushSubscription.optIn();
    push.state = stateOf(OneSignal);
    flag(push.state === "on");
  } catch (err) { push.state = "off"; push.error = err?.message || String(err); }
}

/** Stop alerts on this device (the other devices keep theirs). */
export async function turnOffPush() {
  if (!config?.app_id) return;
  push.state = "busy"; push.error = "";
  try {
    const OneSignal = await oneSignal(config.app_id);
    await OneSignal.User.PushSubscription.optOut();
    flag(false);
    push.state = stateOf(OneSignal);
  } catch (err) { push.state = "on"; push.error = err?.message || String(err); }
}

/** Signing out stops alerts on this device, so a shared computer doesn't keep getting them. */
export async function pushSignedOut() {
  if (!sdk) { flag(false); return; }
  try { const OneSignal = await sdk; await OneSignal.User.PushSubscription.optOut(); await OneSignal.logout(); } catch { /* best effort */ }
  flag(false);
}
