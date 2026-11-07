// Page scaffolding: load data, show a skeleton while waiting, an error notice
// on failure, then the page body. Every screen renders through this.
import { html } from "@arrow-js/core";
import { icon, placeThumbs } from "../lib/ui.js";

/**
 * page({ load, body, narrow, screen }):
 *   load(state) → Promise, fills state;
 *   body(state) → template, rendered once loading is done.
 * The body is mounted outside any reactive expression on purpose: reads of
 * reactive state while building it must not re-render the whole page (and
 * steal focus from inputs). Pieces that should update use `${() => …}`.
 * state.reload() loads again and re-mounts the body.
 */
export function page({ load, body, narrow = false, screen = "page", init = {} }) {
  const s = { ...init }; // plain: loaded data holds Maps; pages make their own reactive form state
  const section = document.createElement("section");
  section.className = "page" + (narrow ? " page--narrow" : "");
  section.dataset.screen = screen;
  const show = (tpl) => { section.replaceChildren(); tpl(section); placeThumbs(); };
  s.reload = async ({ quiet = false } = {}) => {
    if (!quiet) show(skeleton());
    try { await load(s); } catch (e) { show(errorBox(e.message || String(e), () => s.reload())); return; }
    show(body(s));
  };
  s.reload();
  return (parent) => { parent.appendChild(section); return parent; };
}

export const skeleton = () => html`<div class="stack" aria-busy="true" aria-label="Loading">
  <div class="skeleton skeleton--title"></div>
  <div class="panel"><div class="panel__body"><div class="skeleton skeleton--w60"></div><div class="skeleton skeleton--w85"></div><div class="skeleton skeleton--w40"></div></div></div>
</div>`;

export const errorBox = (msg, retry) => html`<div class="notice" data-state="error">${icon("error")}<div class="grow stack-sm"><p><strong>Something went wrong.</strong> ${msg}</p>${retry ? html`<div><button class="btn btn--sm" type="button" @click="${() => retry()}">${icon("again")}Try again</button></div>` : ""}</div></div>`;

/** Breadcrumbs: [[label, href], …, last label]. */
export const crumbs = (items) => html`<nav class="crumbs" aria-label="Breadcrumb">${items.map((it, i) => {
  const sep = i ? icon("caret-right") : "";
  return Array.isArray(it) ? html`${sep}<a href="${it[1]}">${it[0]}</a>` : html`${sep}<span>${it}</span>`;
})}</nav>`;

export const empty = (iconName, title, text, action = "") =>
  html`<div class="empty">${icon(iconName, "i--xl")}<strong>${title}</strong><span class="small">${text}</span>${action}</div>`;

/** Run a save with a loading button; returns the result or undefined on error. */
export async function busy(e, fn) {
  const btn = e && (e.submitter || e.currentTarget);
  btn?.classList?.add("is-loading");
  try { return await fn(); } finally { btn?.classList?.remove("is-loading"); }
}
