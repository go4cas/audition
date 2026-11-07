// Form components from the Design wireframes, as Arrow templates:
// styled dropdown, segmented control, star input, weight bar, file picker.
import { html } from "@arrow-js/core";
import { avatar, icon, placePop, placeThumb, popId, sparkle, toast } from "../lib/ui.js";

const optVisual = (o) => (o.avatar ? avatar(o.avatar, "sm") : o.icon ? icon(o.icon) : "");

/**
 * Styled dropdown (docs/design "Selects"): a button showing the value and a
 * popover listbox with icons, descriptions, group headings and a tick.
 * options() → [{ value, label, desc?, icon?, avatar?, group? }]
 */
export function dropdown({ id, label, options, value, onChange, placeholder = "Choose…", disabled = () => false }) {
  const menuId = popId("dd");
  const current = () => options().find((o) => o.value === value());
  const choose = (o, e) => {
    const menu = e.currentTarget.closest(".dd__menu");
    onChange(o.value);
    menu.hidePopover();
    menu.previousElementSibling.focus();
  };
  const onToggle = (e) => {
    const menu = e.currentTarget, btn = menu.previousElementSibling;
    btn.setAttribute("aria-expanded", String(e.newState === "open"));
    if (e.newState !== "open") return;
    menu.style.minWidth = btn.offsetWidth + "px";
    placePop(menu, btn, "start");
    (menu.querySelector('[aria-selected="true"]') || menu.querySelector(".dd__opt"))?.focus();
  };
  const onKey = (e) => {
    const opts = [...e.currentTarget.querySelectorAll(".dd__opt")];
    const i = opts.indexOf(document.activeElement);
    const to = (n) => { e.preventDefault(); opts[Math.max(0, Math.min(opts.length - 1, n))]?.focus(); };
    if (e.key === "ArrowDown") to(i + 1);
    else if (e.key === "ArrowUp") to(i - 1);
    else if (e.key === "Home") to(0);
    else if (e.key === "End") to(opts.length - 1);
    else if (e.key === "Tab") e.currentTarget.hidePopover();
    else if (e.key.length === 1) {
      const hit = opts.find((b) => b.textContent.trim().toLowerCase().startsWith(e.key.toLowerCase()));
      if (hit) hit.focus();
    }
  };
  const btnKey = (e) => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); e.currentTarget.click(); } };
  return html`<div class="dd">
    <button type="button" class="dd__btn" id="${id}" aria-haspopup="listbox" aria-expanded="false" popovertarget="${menuId}" disabled="${() => disabled()}" @keydown="${btnKey}">
      <span class="dd__value">${() => { const o = current(); return o ? html`${optVisual(o)}<span>${o.label}</span>` : html`<span class="muted">${placeholder}</span>`; }}</span>${icon("caret-down", "dd__caret")}
    </button>
    <div class="pop dd__menu" id="${menuId}" popover role="listbox" aria-label="${label}" @toggle="${onToggle}" @keydown="${onKey}">
      ${() => {
        let group = null;
        return options().map((o) => {
          const head = o.group && o.group !== group ? html`<div class="dd__group" role="presentation">${o.group}</div>` : "";
          group = o.group || group;
          return html`${head}<button type="button" class="dd__opt" role="option" aria-selected="${() => String(o.value === value())}" @click="${(e) => choose(o, e)}">${optVisual(o)}<span class="dd__opt-text"><span>${o.label}</span>${o.desc ? html`<span class="dd__opt-desc">${o.desc}</span>` : ""}</span>${icon("check", "dd__tick")}</button>`;
        });
      }}
    </div>
  </div>`;
}

/** Segmented control with a sliding thumb. options → [{ value, label, icon? }] */
export function seg({ name, labelId, options, value, onChange, disabled = () => false }) {
  return html`<div class="seg" role="radiogroup" aria-labelledby="${labelId}">
    ${options.map((o) => html`<input type="radio" name="${name}" id="${name + "-" + o.value}" value="${o.value}" checked="${() => value() === o.value}" disabled="${() => disabled()}" @change="${(e) => { onChange(o.value); placeThumb(e.target.closest(".seg")); }}"><label for="${name + "-" + o.value}">${o.icon ? icon(o.icon) : ""}${o.label}</label>`)}
  </div>`;
}

/** Five radios, written 5..1 so CSS hover fills leftwards (docs/design). */
export function starInput({ name, label, value, onChange, disabled = () => false }) {
  return html`<span class="star-input" role="radiogroup" aria-label="${label}" aria-disabled="${() => (disabled() ? "true" : false)}">
    ${[5, 4, 3, 2, 1].map((i) => html`<input type="radio" name="${name}" id="${name + "-" + i}" value="${i}" checked="${() => value() === i}" disabled="${() => disabled()}" @change="${(e) => { sparkle(e.target.nextElementSibling); onChange(i); }}"><label for="${name + "-" + i}" title="${i + (i > 1 ? " stars" : " star")}">${icon("star")}</label>`)}
  </span>`;
}

/** Read-only stars, for history. */
export const starsView = (n) => html`<span class="stars" aria-label="${n + " of 5 stars"}">${[1, 2, 3, 4, 5].map((i) => html`<span class="${i <= n ? "on" : ""}">${icon("star")}</span>`)}</span>`;

export const weightBar = (values) =>
  html`<div class="weight-bar" aria-hidden="true">${() => values().map((v) => html`<span style="${"width:" + Math.max(0, Number(v) || 0) + "%"}"></span>`)}</div>`;

export const weightTotal = (values, okLabel) => () => {
  const total = values().reduce((a, b) => a + (Number(b) || 0), 0);
  const ok = total === 100;
  return html`<span class="state" data-state="${ok ? "done" : "warning"}" aria-live="polite">${icon(ok ? "done" : "warning")}${ok ? okLabel : `Adds up to ${total}, needs 100`}</span>`;
};

// ---------- File picker with a drop zone ----------
export const MAX_FILE = 25 * 1024 * 1024;
const OK_FILE = /\.(txt|md|markdown|csv|log|json|png|jpe?g|gif|webp|svg|pdf|zip)$/i;
export const fileIcon = (name) => (/\.(png|jpe?g|gif|webp|svg)$/i.test(name) ? "image" : "file");
export const kb = (bytes) => (bytes >= 1024 * 1024 ? (bytes / 1024 / 1024).toFixed(1) + " MB" : Math.max(1, Math.round(bytes / 1024)) + " KB");

/** files: a reactive array the picker adds File objects to. */
export function filePicker({ id, files, disabled = () => false, hint = "Text, images, PDF or zip, up to 25 MB each" }) {
  const add = (list) => {
    for (const f of list) {
      if (f.size > MAX_FILE) { toast(`${f.name} is over 25 MB`, "error", "error"); continue; }
      if (!OK_FILE.test(f.name)) { toast(`${f.name}: only text, images, PDF or zip`, "error", "error"); continue; }
      files.push(f);
    }
  };
  const over = (e, on) => { e.preventDefault(); e.currentTarget.classList.toggle("is-over", on); };
  return html`<div class="stack-sm">
    <input type="file" id="${id}" multiple class="visually-hidden" tabindex="-1" @change="${(e) => { add(e.target.files); e.target.value = ""; }}">
    <div class="drop" tabindex="0" role="button" aria-label="Choose files" aria-disabled="${() => (disabled() ? "true" : false)}"
      @click="${(e) => { if (!disabled()) e.currentTarget.parentElement.querySelector("input[type=file]").click(); }}"
      @keydown="${(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }}"
      @dragenter="${(e) => over(e, true)}" @dragover="${(e) => over(e, true)}" @dragleave="${(e) => over(e, false)}"
      @drop="${(e) => { over(e, false); if (!disabled()) add(e.dataTransfer.files || []); }}">
      ${icon("upload", "i--xl")}<span><strong>Choose files</strong> or drop them here</span><span class="xs">${hint}</span>
    </div>
    <ul class="files">${() => files.map((f, i) => html`<li>${icon(fileIcon(f.name))}${f.name} · ${kb(f.size)}<button class="icon-btn icon-btn--xs" type="button" aria-label="${"Remove " + f.name}" @click="${() => files.splice(i, 1)}">${icon("close")}</button></li>`)}</ul>
  </div>`;
}
