// Live record events from Vaultbase's realtime WebSocket (`/realtime`, same
// origin). Server writes go through helpers.records since PLATFORM-UPGRADES
// part B, so they send realtime events like any REST write (NOTES F1).
//
// subscribe(topics, { onEvent, onStatus }) opens one connection, signs it in
// with the owner's token, subscribes, and reconnects with backoff when it
// drops. onStatus gets "live" once the topics are subscribed and "off"
// whenever they are not; callers poll while it is "off". Returns stop().
// Topics are Vaultbase's: "<collection>" or "<collection>/<id>".
import { auth } from "../api.js";

const PING_MS = 30_000; // Vaultbase answers {type:"ping"} with a pong
const MAX_BACKOFF_MS = 30_000;

const wsUrl = () => (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/realtime";

export function subscribe(topics, { onEvent, onStatus } = {}) {
  let ws = null, stopped = false, tries = 0, retry = null, ping = null, live = false;
  const status = (on) => {
    if (on === live) return;
    live = on;
    try { onStatus?.(on ? "live" : "off"); } catch { /* caller's problem */ }
  };
  const later = () => {
    if (stopped) return;
    clearTimeout(retry);
    retry = setTimeout(open, Math.min(MAX_BACKOFF_MS, 1000 * 2 ** tries++));
  };
  function open() {
    if (stopped) return;
    if (!auth.token || typeof WebSocket !== "function") return later();
    let sock;
    try { sock = new WebSocket(wsUrl()); } catch { return later(); }
    ws = sock;
    sock.onmessage = (e) => {
      let m;
      try { m = JSON.parse(String(e.data)); } catch { return; }
      if (m.type === "connected") {
        sock.send(JSON.stringify({ type: "auth", token: auth.token }));
        sock.send(JSON.stringify({ type: "subscribe", topics }));
      } else if (m.type === "subscribed") {
        tries = 0;
        status(true);
      } else if (m.type === "auth_expired" || m.type === "error") {
        // Signed out, token expired, origin refused, server full: poll instead.
        sock.close();
      } else if (m.type === "create" || m.type === "update" || m.type === "delete") {
        try { onEvent?.(m); } catch { /* keep listening */ }
      }
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      status(false);
      later();
    };
    sock.onerror = () => { /* onclose follows */ };
  }
  ping = setInterval(() => { if (ws?.readyState === 1) ws.send('{"type":"ping"}'); }, PING_MS);
  open();
  return () => {
    stopped = true;
    clearTimeout(retry);
    clearInterval(ping);
    const sock = ws;
    ws = null;
    try { sock?.close(); } catch { /* already closed */ }
  };
}
