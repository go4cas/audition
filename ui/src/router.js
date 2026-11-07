// A small hash router (TECH-SPEC tech stack): `#/runs/123?task=x`.
// Routes are patterns like "/runs/:id". Each route's page renders into the
// outlet; `onLeave` callbacks (polling timers) run when the route changes.

const routes = [];
let current = { path: "/", params: {}, query: {} };
let leaveFns = [];
let renderFn = () => {};
let guard = () => null;

export function route(pattern, page, opts = {}) {
  const keys = [];
  const re = pattern === "*" ? /^$/ : new RegExp("^" + pattern.replace(/\/:(\w+)/g, (_, k) => { keys.push(k); return "/([^/]+)"; }) + "/?$");
  routes.push({ pattern, re, keys, page, ...opts });
}

export function parse(hash) {
  const raw = (hash || "").replace(/^#/, "") || "/";
  const [path, qs = ""] = raw.split("?");
  const query = Object.fromEntries(new URLSearchParams(qs));
  for (const r of routes) {
    const m = path.match(r.re);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route: r, path, params, query };
    }
  }
  return { route: routes.find((r) => r.pattern === "*"), path, params: {}, query };
}

export const href = (path, query) => {
  const qs = query ? new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== "")).toString() : "";
  return "#" + path + (qs ? "?" + qs : "");
};
export const go = (path, query) => { location.hash = href(path, query).slice(1); };
export const here = () => current;
export const onLeave = (fn) => { leaveFns.push(fn); };

function resolve() {
  const next = parse(location.hash);
  const redirect = guard(next);
  if (redirect && redirect !== next.path) { go(redirect, redirect === "/signin" && next.path !== "/" ? { next: next.path } : undefined); return; }
  leaveFns.forEach((f) => { try { f(); } catch { /* ignore */ } });
  leaveFns = [];
  current = next;
  renderFn(next);
}

export function start({ render, before }) {
  renderFn = render;
  guard = before || guard;
  window.addEventListener("hashchange", resolve);
  resolve();
}
export const refresh = resolve;
