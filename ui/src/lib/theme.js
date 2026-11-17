// Light and dark mode. The tokens (styles/tokens.css) follow the system
// setting by default; the top-bar toggle pins light or dark on <html
// data-theme> and remembers it on this device, like the landing page does.
import { reactive } from "@arrow-js/core";

const KEY = "audition-theme";
const root = document.documentElement;
const system = matchMedia("(prefers-color-scheme: dark)");

export const theme = reactive({ dark: false });

function sync() {
  theme.dark = root.dataset.theme ? root.dataset.theme === "dark" : system.matches;
  // The browser bar follows the page background.
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme.dark ? "#111111" : "#f5f5f5");
}

/** Apply the saved choice (if any) before the first paint of the app. */
export function initTheme() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") root.dataset.theme = saved;
  } catch {}
  system.addEventListener("change", sync);
  sync();
}

/** Switch to the other theme and remember it. */
export function toggleTheme() {
  const next = theme.dark ? "light" : "dark";
  const swap = () => {
    root.dataset.theme = next;
    try { localStorage.setItem(KEY, next); } catch {}
    sync();
  };
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (document.startViewTransition && !still) document.startViewTransition(swap); else swap();
}
