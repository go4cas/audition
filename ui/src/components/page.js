// Page scaffolding: load data, show a skeleton while waiting, an error notice
// on failure, then the page body. Every screen renders through this.
import { html, onCleanup } from "@arrow-js/core";
import { icon, placeThumbs } from "../lib/ui.js";

let seq = 0;

/**
 * page({ load, body, narrow, screen }):
 *   load(state) → Promise, fills state;
 *   body(state) → template, rendered once loading is done;
 *   shell(state) → optional template shown while loading instead of the
 *   skeleton: the parts that need no data (Home's heading, NOTES H1). Keep its
 *   layout the same size as the body's, so the swap doesn't move the page.
 * The body is mounted outside any reactive expression on purpose: reads of
 * reactive state while building it must not re-render the whole page (and
 * steal focus from inputs). Pieces that should update use `${() => …}`.
 * state.reload() loads again and re-mounts the body.
 * state.onLeave(fn) runs fn when the page is left (quiver's page cleanup
 * scope), or at once if the page was already left while it was loading.
 */
export function page({ load, body, shell = null, narrow = false, screen = "page", init = {} }) {
  const s = { ...init }; // plain: loaded data holds Maps; pages make their own reactive form state
  let left = false;
  const leaveFns = [];
  onCleanup(() => { left = true; leaveFns.splice(0).forEach((f) => { try { f(); } catch { /* ignore */ } }); });
  s.onLeave = (fn) => { if (left) fn(); else leaveFns.push(fn); };
  // The body is mounted straight into the page's <section>, never through a
  // reactive slot: Arrow 1.0.6 recycles a template by its shape, and a recycled
  // body whose slot was "" and is now a template prints the template's source
  // (AGENTS.md rule 5, NOTES U3). Quiver mounts the <section> just after this
  // function returns, so show() waits for it by id.
  const id = "page-" + ++seq;
  let host = null, pending = null, waiting = false;
  const flush = () => {
    waiting = false;
    if (left || !pending) return;
    host ||= document.getElementById(id);
    if (!host) { waiting = true; requestAnimationFrame(flush); return; }
    const tpl = pending;
    pending = null;
    host.replaceChildren();
    tpl(host);
    placeThumbs();
  };
  const show = (tpl) => { pending = tpl; if (!waiting) flush(); };
  s.reload = async ({ quiet = false } = {}) => {
    if (!quiet) show(shell ? shell(s) : skeleton());
    try { await load(s); } catch (e) { show(errorBox(e.message || String(e), () => s.reload())); return; }
    show(body(s));
  };
  s.reload();
  return html`<section class="${"page" + (narrow ? " page--narrow" : "")}" data-screen="${screen}" id="${id}"></section>`;
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
