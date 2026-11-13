// Audition UI entry. Quiver 3.2's conventions build the app from ui/src
// (docs/PLATFORM-UPGRADES.md part D): pages/ are the routes, middleware/auth.js
// is the sign-in guard, views/ are the loading and error views, and each page's
// meta.nav makes the main nav. The shell (top bar, phone nav, lightbox,
// toaster) is mounted once around #main and stays, so toasts and the chrome
// survive navigation; quiver renders pages into #main.
import { html } from "@arrow-js/core";
import { afterEach, createApp, useRoute } from "@go4cas/quiver";
import app from "quiver:app";
import { auth } from "./api.js";
import { mountShell } from "./components/shell.js";
import { installPopovers, placeThumbs } from "./lib/ui.js";
import { BASE, fromHashLink, go } from "./lib/nav.js";
import { refreshInbox } from "./state/inbox.js";
import { followAlerts } from "./state/alerts.js";

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

  afterEach(({ status }) => {
    scrollTo(0, 0);
    placeThumbs();
    if (auth.token && status === "ready" && !useRoute().meta()?.bare) refreshInbox();
  });

  mountShell(root, app.nav);
  followAlerts();
  await createApp(app, { target: "#main", base: BASE });

  // Signed out (the button, or a 401): run the guard again for this page.
  auth.onChange((t) => { if (!t) go(useRoute().path()); });
}

start();
