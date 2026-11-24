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
const LOAD_MS = 20_000; // OneSignal's script, init and each call
const ASK_MS = 120_000; // the browser's permission prompt waits for you

/** Reject when p takes longer than ms, so the panel never waits forever. */
const timeout = (p, ms, msg) => Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms))]);
const NO_ONESIGNAL = "OneSignal didn't answer. Check that its Web configuration is saved with this site's address, then try again.";
const FLAG = "audition.push";

/** state: "checking" | "off-server" (OneSignal not on) | "unsupported" | "blocked" | "off" | "on" | "busy" */
export const push = reactive({ state: "checking", error: "" });

const supported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const flag = (v) => { try { if (v === undefined) return localStorage.getItem(FLAG) === "1"; v ? localStorage.setItem(FLAG, "1") : localStorage.removeItem(FLAG); } catch { return false; } };

let sdk = null;
let scriptAdded = false;
let inited = false;
/**
 * Load OneSignal's SDK once and init it once for this app; resolves to
 * OneSignal. A failed or timed-out try can be tried again: the script is never
 * added twice, and an init that already ran (OneSignal's "SDK already
 * initialized") counts as done, since OneSignal refuses a second one.
 */
function oneSignal(appId) {
  if (sdk) return sdk;
  sdk = new Promise((resolve, reject) => {
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async (OneSignal) => {
      try {
        if (!inited) {
          try {
            await OneSignal.init({
              appId,
              serviceWorkerPath: "OneSignalSDKWorker.js",
              serviceWorkerParam: { scope: BASE },
              allowLocalhostAsSecureOrigin: location.hostname === "localhost",
            });
          } catch (err) {
            if (!/already initiali[sz]ed/i.test(String(err?.message || err))) throw err;
          }
          inited = true;
          OneSignal.Notifications.addEventListener("click", (e) => {
            const page = e?.notification?.additionalData?.page;
            if (typeof page === "string" && page.startsWith("/")) go(page);
          });
        }
        resolve(OneSignal);
      } catch (err) { reject(err); }
    });
    if (scriptAdded) return;
    scriptAdded = true;
    const s = document.createElement("script");
    s.src = SDK;
    s.defer = true;
    s.onerror = () => { scriptAdded = false; s.remove(); reject(new Error("Couldn't load OneSignal. Check the connection and try again.")); };
    document.head.appendChild(s);
  });
  sdk.catch(() => { sdk = null; });
  return sdk;
}

const stateOf = (OneSignal) =>
  Notification.permission === "denied" ? "blocked"
  : OneSignal?.User?.PushSubscription?.optedIn && Notification.permission === "granted" ? "on" : "off";

/**
 * Before the app moved to the site root, it and OneSignal's worker lived under
 * /api/custom/app/. That old worker would keep its own push subscription next
 * to the new one at "/" and show every alert twice, so it is removed.
 */
const OLD_SCOPE = "/api/custom/app/";
async function retireOldWorker() {
  try {
    for (const r of await navigator.serviceWorker.getRegistrations()) {
      if (new URL(r.scope).pathname === OLD_SCOPE) await r.unregister();
    }
  } catch { /* best effort */ }
}

let config = null;
/** Read whether OneSignal is on; on a device that turned alerts on before, start the SDK. */
export async function checkPush() {
  try { config = await custom.push(); } catch { config = null; }
  if (!config || config.provider !== "onesignal" || !config.app_id) { push.state = "off-server"; return; }
  if (!supported()) { push.state = "unsupported"; return; }
  await retireOldWorker();
  if (Notification.permission === "denied") { push.state = "blocked"; return; }
  if (!flag()) { push.state = "off"; return; }
  try {
    const OneSignal = await timeout(oneSignal(config.app_id), LOAD_MS, NO_ONESIGNAL);
    const id = me()?.id;
    if (id) await timeout(OneSignal.login(id), LOAD_MS, NO_ONESIGNAL);
    push.state = stateOf(OneSignal);
  } catch (err) { push.state = "off"; push.error = err?.message || String(err); }
}

/** Ask this browser for permission and subscribe it to the owner's alerts. */
export async function turnOnPush() {
  if (!config?.app_id) return;
  // Ask first, straight from the tap: iPhone and iPad Safari show the prompt
  // only during the tap itself, not after the SDK has loaded over the network.
  const asked = Notification.permission === "default" ? Notification.requestPermission() : Promise.resolve(Notification.permission);
  push.state = "busy"; push.error = "";
  try {
    const perm = await timeout(asked, ASK_MS, "The browser didn't ask for permission. Try again.");
    if (perm !== "granted") { push.state = perm === "denied" ? "blocked" : "off"; return; }
    const OneSignal = await timeout(oneSignal(config.app_id), LOAD_MS, NO_ONESIGNAL);
    const id = me()?.id;
    if (id) await timeout(OneSignal.login(id), LOAD_MS, NO_ONESIGNAL);
    await timeout(OneSignal.User.PushSubscription.optIn(), LOAD_MS, NO_ONESIGNAL);
    push.state = stateOf(OneSignal);
    flag(push.state === "on");
  } catch (err) { push.state = "off"; push.error = err?.message || String(err); }
}

/** Stop alerts on this device (the other devices keep theirs). */
export async function turnOffPush() {
  if (!config?.app_id) return;
  push.state = "busy"; push.error = "";
  try {
    const OneSignal = await timeout(oneSignal(config.app_id), LOAD_MS, NO_ONESIGNAL);
    await timeout(OneSignal.User.PushSubscription.optOut(), LOAD_MS, NO_ONESIGNAL);
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
