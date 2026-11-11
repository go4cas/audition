// The app shell from the wireframes: top bar, main outlet, phone bottom nav,
// the lightbox dialog and the toaster. It is mounted once and stays: quiver
// renders pages into #main, so toasts and the lightbox survive navigation.
// The route's meta says whether the chrome shows (`bare`) and which main nav
// item is current (`section`).
import { html, reactive, watch } from "@arrow-js/core";
import { useRoute } from "@go4cas/quiver";
import { signOut } from "../api.js";
import { icon } from "../lib/ui.js";
import { inbox } from "../state/inbox.js";
import { APP } from "../lib/nav.js";

const shell = reactive({ bare: true, section: "workspaces" });

export const logo = () => html`<svg class="lg" viewBox="0 0 64 64" aria-hidden="true"><rect class="lg-tile" width="64" height="64" rx="14"/><g transform="translate(6.40 6.40) scale(0.8)"><path class="lg-on-stroke" d="M13 55 L32 9 L51 55" fill="none" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><polygon class="lg-gold lg-star" points="32.00,26.50 35.51,34.66 44.36,35.48 37.69,41.35 39.64,50.02 32.00,45.48 24.36,50.02 26.31,41.35 19.64,35.48 28.49,34.66" stroke-linejoin="round"/></g></svg>`;

const current = (s) => () => (shell.section === s ? "page" : false);
const countBadge = () => (inbox.count ? html`<span class="count" data-inbox-count>${() => inbox.count}</span>` : "");

export function mountShell(root) {
  const route = useRoute();
  // Keep the last chrome while the next page loads, so sign-in doesn't flash the top bar.
  watch(() => {
    const status = route.status();
    if (status === "idle" || status === "loading") return;
    const meta = route.meta() || {};
    shell.bare = !!meta.bare;
    shell.section = meta.section || (/^\/contenders/.test(route.path()) ? "contenders" : "workspaces");
  });
  html`
    <header class="topbar" hidden="${() => shell.bare}">
      <div class="topbar__inner">
        <a class="brand" href="${APP + "/"}"><span class="brand__mark has-logo">${logo()}</span>Audition</a>
        <nav class="nav" aria-label="Main">
          <a href="${APP + "/"}" aria-current="${current("workspaces")}">${icon("workspaces")}Workspaces</a>
          <a href="${APP + "/contenders"}" aria-current="${current("contenders")}">${icon("contenders")}Contenders</a>
        </nav>
        <div class="topbar__end">
          <a class="inbox-btn hide-phone" href="${APP + "/"}">${icon("inbox")}Waiting for you ${() => countBadge()}</a>
          <button class="icon-btn" type="button" data-tip="Sign out" data-tip-side="bottom" aria-label="Sign out" @click="${() => signOut()}">${icon("sign-in")}</button>
        </div>
      </div>
    </header>
    <main id="main"></main>
    <nav class="bottom-nav" aria-label="Main" hidden="${() => shell.bare}">
      <a href="${APP + "/"}" aria-current="${current("workspaces")}">${icon("workspaces")}Workspaces</a>
      <a href="${APP + "/?waiting=1"}">${icon("inbox")}Waiting${() => countBadge()}</a>
      <a href="${APP + "/contenders"}" aria-current="${current("contenders")}">${icon("contenders")}Contenders</a>
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
