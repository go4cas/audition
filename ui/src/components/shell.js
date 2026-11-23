// The app shell from the wireframes: top bar, main outlet, phone bottom nav,
// the lightbox dialog and the toaster. It is mounted once and stays: quiver
// renders pages into #main, so toasts and the lightbox survive navigation.
// It is not a quiver layout on purpose: a layout is rebuilt on every
// navigation and hidden while the next page's chunk loads (part D, QD1).
// The main nav comes from the pages' meta.nav (quiver:app's `nav`); the route's
// meta.bare hides the chrome (sign-in).
import { html, reactive, watch } from "@arrow-js/core";
import { useRoute } from "@go4cas/quiver";
import { signOut } from "../api.js";
import { icon } from "../lib/ui.js";
import { inbox } from "../state/inbox.js";
import { alerts } from "../state/alerts.js";
import { APP, WAITING, href } from "../lib/nav.js";
import { theme, toggleTheme } from "../lib/theme.js";
import { APP_VERSION, loadVaultbaseVersion, versions } from "../lib/version.js";

const shell = reactive({ bare: true, section: "/" });

export const logo = () => html`<svg class="lg" viewBox="0 0 64 64" aria-hidden="true"><rect class="lg-tile" width="64" height="64" rx="14"/><g transform="translate(6.40 6.40) scale(0.8)"><path class="lg-on-stroke" d="M13 55 L32 9 L51 55" fill="none" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><polygon class="lg-gold lg-star" points="32.00,26.50 35.51,34.66 44.36,35.48 37.69,41.35 39.64,50.02 32.00,45.48 24.36,50.02 26.31,41.35 19.64,35.48 28.49,34.66" stroke-linejoin="round"/></g></svg>`;

const current = (to) => () => (shell.section === to ? "page" : false);
const ICONS = { "/": "workspaces", "/contenders": "contenders" };

/** The nav item a path belongs to: the longest `to` it starts with. */
export const sectionOf = (path, nav) =>
  nav.map((n) => n.to).filter((to) => to === "/" || path === to || path.startsWith(to + "/")).sort((a, b) => b.length - a.length)[0] || "/";
const countBadge = () => (inbox.count ? html`<span class="count" data-inbox-count>${() => inbox.count}</span>` : "");

const link = (n) => html`<a href="${href(n.to)}" aria-current="${current(n.to)}">${icon(ICONS[n.to] || "arrow-right")}${n.label}</a>`;

let firstPath = null;

export function mountShell(root, nav = []) {
  const route = useRoute();
  // Keep the last chrome while the next page loads, so sign-in doesn't flash the top bar.
  watch(() => {
    const status = route.status();
    if (status === "idle" || status === "loading") return;
    const meta = route.meta() || {};
    shell.bare = !!meta.bare;
    const path = route.path();
    shell.section = path === "/alerts" ? "/alerts" : sectionOf(path, nav);
    // The first screen of a visit appears without the screen-enter fade: a
    // page fading in from opacity 0 holds back its largest paint (LCP) until
    // the fade ends (NOTES H1). Screens after it fade in as before.
    if (firstPath === null) firstPath = path;
    else if (path !== firstPath) document.documentElement.dataset.entered = "";
    // Versions are for signed-in people only (the chrome is hidden on sign-in).
    if (!shell.bare) loadVaultbaseVersion();
  });
  const themeLabel = () => (theme.dark ? "Switch to light mode" : "Switch to dark mode");
  html`
    <header class="topbar" hidden="${() => shell.bare}">
      <div class="topbar__inner">
        <a class="brand" href="${APP + "/"}"><span class="brand__mark has-logo">${logo()}</span>Audition</a>
        <nav class="nav" aria-label="Main">
          ${nav.map((n) => link(n))}
        </nav>
        <div class="topbar__end">
          <a class="inbox-btn hide-phone" href="${href(WAITING.path, WAITING.query)}" data-waiting-link>${icon("inbox")}Waiting for you ${() => countBadge()}</a>
          <a class="icon-btn bell-btn" href="${APP + "/alerts"}" data-alerts aria-current="${() => (shell.section === "/alerts" ? "page" : false)}" data-tip="Alerts" data-tip-side="bottom" aria-label="${() => (alerts.unread ? `Alerts, ${alerts.unread} unread` : "Alerts")}">${icon("bell")}${() => (alerts.unread ? html`<span class="dot-count" data-alerts-count>${() => alerts.unread}</span>` : "")}</a>
          <button class="icon-btn theme-btn" type="button" data-theme-toggle data-tip="${themeLabel}" data-tip-side="bottom" aria-label="${themeLabel}" @click="${() => toggleTheme()}">${() => icon(theme.dark ? "sun" : "moon")}</button>
          <button class="icon-btn" type="button" data-tip="Sign out" data-tip-side="bottom" aria-label="Sign out" @click="${() => signOut()}">${icon("sign-in")}</button>
        </div>
      </div>
    </header>
    <main id="main"></main>
    <footer class="app-foot" hidden="${() => shell.bare}" data-versions>
      <a href="${"https://github.com/go4cas/audition/releases/tag/" + encodeURIComponent(APP_VERSION)}" target="_blank" rel="noopener">Audition ${APP_VERSION}</a>${() => (versions.vaultbase ? html`<span aria-hidden="true">·</span><a href="https://github.com/vaultbase-sh/vaultbase" target="_blank" rel="noopener">Vaultbase ${() => versions.vaultbase}</a>` : "")}
    </footer>
    <nav class="bottom-nav" aria-label="Main" hidden="${() => shell.bare}">
      ${nav.slice(0, 1).map((n) => link(n))}
      <a href="${href(WAITING.path, WAITING.query)}" data-waiting-link>${icon("inbox")}Waiting${() => countBadge()}</a>
      ${nav.slice(1).map((n) => link(n))}
    </nav>
    <dialog class="lightbox" id="lightbox" aria-label="Large image" @click="${(e) => { if (e.target === e.currentTarget || e.target.closest("[data-close]")) e.currentTarget.close(); }}">
      <div class="lightbox__frame">
        <div class="ph" id="lightbox-img"></div>
        <div class="lightbox__bar"><strong id="lightbox-title">Output</strong><button class="icon-btn" type="button" data-close aria-label="Close">${icon("close")}</button></div>
      </div>
    </dialog>
    <div class="toaster" id="toaster" aria-live="polite"></div>
  `(root);
}
