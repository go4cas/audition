// Audition UI entry: quiver's router with real path URLs under
// /api/custom/app/, the sign-in guard, and the app shell
// (docs/PLATFORM-UPGRADES.md part C).
import { html } from "@arrow-js/core";
import { afterEach, beforeEach, createApp, initRouter, useRoute } from "@go4cas/quiver";
import { auth } from "./api.js";
import { mountShell } from "./layouts/shell.js";
import { errorBox, skeleton } from "./components/page.js";
import { installPopovers, placeThumbs } from "./lib/ui.js";
import { BASE, fromHashLink, go } from "./lib/nav.js";
import { refreshInbox } from "./state/inbox.js";
import { notFound, routes } from "./routes.js";

const root = document.getElementById("root");

async function start() {
  // Quiver needs the Navigation API (Chrome/Edge 102+, Safari 26.2+, Firefox 147+), Q7.
  if (!window.navigation) {
    html`<section class="page page--narrow" data-screen="unsupported"><div class="notice" data-state="error"><div><p><strong>This browser is too old for Audition.</strong></p><p>Use a current Chrome, Edge, Safari (26.2 or later) or Firefox (147 or later).</p></div></div></section>`(root);
    return;
  }

  // Links from before path URLs (`…/app/#/runs/123`) keep working.
  const old = fromHashLink();
  if (old) history.replaceState(null, "", old);

  installPopovers();
  addEventListener("resize", placeThumbs);

  // Sign-in guard: everything but /signin needs a token. The page asked for
  // comes back after sign-in through ?next=.
  beforeEach(({ to }) => {
    if (auth.token || to === "/signin") return undefined;
    return to === "/" ? "/signin" : "/signin?next=" + encodeURIComponent(to);
  });
  afterEach(({ status }) => {
    scrollTo(0, 0);
    placeThumbs();
    if (auth.token && status === "ready" && !useRoute().meta()?.bare) refreshInbox();
  });

  await initRouter({ routes, notFound, base: BASE });
  mountShell(root);
  createApp({
    target: "#main",
    loading: () => html`<section class="page">${skeleton()}</section>`,
    error: ({ message, retry }) => html`<section class="page page--narrow" data-screen="error">${errorBox(message, retry)}</section>`,
  });

  // Signed out (the button, or a 401): run the guard again for this page.
  auth.onChange((t) => { if (!t) go(useRoute().path()); });
}

start();
