// Shared view helpers built on the Design thread's markup (docs/design/):
// icons from the vendored Phosphor sprite, state chips, avatars, toasts,
// popover placement, the lightbox, sparkles and confetti.
import { html } from "@arrow-js/core";
import { BASE } from "./nav.js";

export const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export const icon = (name, cls = "") =>
  html`<svg class="${"i" + (cls ? " " + cls : "")}" aria-hidden="true"><use href="${BASE + "sprite.svg#i-" + name}"></use></svg>`;

// ---------- Avatars: a monogram tinted by a hue derived from the name ----------
export function hue(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}
export function initials(name) {
  const words = String(name || "?").replace(/\(.*?\)/g, "").trim().split(/[\s\-_.]+/).filter(Boolean);
  if (!words.length) return "?";
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]).toUpperCase();
}
export const avatar = (name, size = "") =>
  html`<span class="${"avatar" + (size ? " avatar--" + size : "")}" style="${"--h:" + hue(name)}" aria-hidden="true">${initials(name)}</span>`;
export const who = (name, meta, size = "sm") =>
  html`<span class="who">${avatar(name, size)}<span><span class="who__name">${name}</span>${meta ? html`<br><span class="who__meta">${meta}</span>` : ""}</span></span>`;

// ---------- State chips (docs/design state system) ----------
const STATE_ICON = { draft: "draft", queued: "queued", active: "spinner", done: "done", warning: "warning", error: "error", locked: "locked", disabled: "disabled", champion: "champion" };
export const chip = (state, label, cls = "") =>
  html`<span class="${"state" + (cls ? " " + cls : "")}" data-state="${state}">${state === "waiting" ? html`<span class="pulse"></span>` : icon(STATE_ICON[state] || "dot")}${label}</span>`;

/** How one output's status reads on the run screen. */
export function outputChip(status, judge) {
  switch (status) {
    case "queued": return chip("queued", "Queued");
    case "in_progress": return chip("active", "Being made");
    case "waiting": return chip("waiting", "Waiting for you");
    case "submitted": return judge === "ai" ? chip("queued", "Queued for judging") : chip("waiting", "Ready to judge");
    case "judged": return chip("done", "Judged");
    case "failed": return chip("error", "Failed");
    default: return chip("draft", status || "Not started");
  }
}

// ---------- Formatting ----------
const nf = new Intl.NumberFormat("en-GB");
export const num = (n) => (n == null || n === "" || Number.isNaN(Number(n)) ? "–" : nf.format(Math.round(Number(n))));
export function short(n) {
  if (n == null || Number.isNaN(Number(n))) return "N/A";
  n = Number(n);
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1e4) return Math.round(n / 1e3) + "k";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(Math.round(n));
}
export function duration(ms) {
  if (ms == null || Number.isNaN(Number(ms))) return "–";
  const s = Number(ms) / 1000;
  if (s < 1) return Math.round(Number(ms)) + " ms";
  if (s < 90) return Math.round(s) + " s";
  if (s < 5400) return Math.round(s / 60) + " min";
  return (s / 3600).toFixed(1) + " h";
}
export const money = (n) => (n == null || n === "" ? "N/A" : "$" + Number(n).toFixed(Number(n) < 0.1 ? 3 : 2));
export const stars1 = (n) => (n == null ? "–" : Number(n).toFixed(1));
const df = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const tf = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
const toDate = (v) => new Date(typeof v === "number" || /^\d+$/.test(String(v)) ? Number(v) * (Number(v) < 1e12 ? 1000 : 1) : v);
export const date = (v) => (v ? df.format(toDate(v)) : "");
export const time = (v) => (v ? tf.format(toDate(v)) : "");
export function ago(v) {
  if (!v) return "";
  const s = (Date.now() - toDate(v).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return Math.round(s / 60) + " minutes ago";
  if (s < 86400) return Math.round(s / 3600) + " hours ago";
  return Math.round(s / 86400) + " days ago";
}
export const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
export const TYPE_ICON = { text: "text", image: "image", file: "file", code: "code" };
export const TYPE_LABEL = { text: "Text", image: "Image", file: "File", code: "Code" };

// ---------- Toasts ----------
export function toast(text, tone = "done", iconName = "done") {
  const host = document.getElementById("toaster");
  if (!host) return;
  const t = document.createElement("div");
  t.className = "toast";
  t.dataset.tone = tone;
  t.setAttribute("role", "status");
  icon(iconName)(t);
  const span = document.createElement("span");
  span.textContent = text;
  t.appendChild(span);
  host.appendChild(t);
  setTimeout(() => { t.classList.add("is-leaving"); t.addEventListener("animationend", () => t.remove()); }, 2600);
}
export const errorToast = (e) => toast(e && e.message ? e.message : String(e), "error", "error");

// ---------- Popovers: native popover, placed next to whatever opened them ----------
let popCount = 0;
export const popId = (prefix = "pop") => `${prefix}-${++popCount}`;
let lastInvoker = null;
export function placePop(pop, invoker, align) {
  const r = invoker.getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight, gap = 6, vw = innerWidth, vh = innerHeight;
  const want = align === "start" ? r.left : r.left + r.width / 2 - w / 2;
  const left = Math.min(Math.max(16, want), vw - w - 16);
  const below = r.bottom + gap + h < vh - 16 || r.top < h + gap + 16;
  const top = below ? r.bottom + gap : r.top - gap - h;
  pop.style.left = left + "px";
  pop.style.top = Math.max(16, top) + "px";
  pop.style.setProperty("--origin", `${r.left + r.width / 2 - left}px ${below ? "top" : "bottom"}`);
}
export function installPopovers() {
  document.addEventListener("click", (e) => { const inv = e.target.closest && e.target.closest("[popovertarget]"); if (inv) lastInvoker = inv; }, true);
  document.addEventListener("toggle", (e) => {
    const pop = e.target;
    if (!(pop instanceof HTMLElement) || !pop.classList.contains("pop") || pop.classList.contains("dd__menu")) return;
    document.querySelectorAll(`[popovertarget="${pop.id}"]`).forEach((b) => b.setAttribute("aria-expanded", String(e.newState === "open")));
    if (e.newState === "open" && lastInvoker) placePop(pop, lastInvoker);
  }, true);
  addEventListener("scroll", () => document.querySelectorAll(".pop:popover-open").forEach((p) => { try { p.hidePopover(); } catch { /* closed */ } }), { passive: true });
}

// ---------- Segmented controls: sliding thumb ----------
export function placeThumb(seg) {
  let thumb = seg.querySelector(".seg__thumb");
  if (!thumb) { thumb = document.createElement("span"); thumb.className = "seg__thumb"; seg.prepend(thumb); }
  const checked = seg.querySelector("input:checked");
  if (!checked || !seg.offsetParent) return;
  const label = seg.querySelector(`label[for="${checked.id}"]`);
  if (!label) return;
  thumb.style.setProperty("--x", label.offsetLeft + "px");
  thumb.style.setProperty("--w", label.offsetWidth + "px");
  thumb.style.top = label.offsetTop + "px";
  thumb.style.bottom = "auto";
  thumb.style.height = label.offsetHeight + "px";
}
export const placeThumbs = () => requestAnimationFrame(() => document.querySelectorAll(".seg").forEach(placeThumb));

// ---------- Little celebrations ----------
export function sparkle(label) {
  label.classList.remove("is-popped"); void label.offsetWidth; label.classList.add("is-popped");
  if (reduced()) return;
  const r = label.getBoundingClientRect();
  for (let k = 0; k < 6; k++) {
    const s = document.createElement("span");
    s.className = "sparkle";
    const a = (Math.PI * 2 * k) / 6 + Math.random() * 0.5;
    s.style.left = r.left + r.width / 2 - 3 + "px";
    s.style.top = r.top + r.height / 2 - 3 + "px";
    s.style.setProperty("--dx", Math.cos(a) * 22 + "px");
    s.style.setProperty("--dy", Math.sin(a) * 22 + "px");
    document.body.appendChild(s);
    s.addEventListener("animationend", () => s.remove());
  }
}
export function confetti(box) {
  if (reduced() || !box) return;
  const colors = ["var(--gold)", "var(--accent)", "var(--done)", "var(--active)"];
  for (let k = 0; k < 28; k++) {
    const c = document.createElement("span");
    c.className = "confetti";
    c.style.background = colors[k % colors.length];
    c.style.left = 10 + Math.random() * 30 + "%";
    c.style.setProperty("--dx", Math.random() * 420 - 60 + "px");
    c.style.setProperty("--dy", Math.random() * -140 + 60 + "px");
    c.style.setProperty("--rot", Math.random() * 720 - 360 + "deg");
    c.style.animationDelay = Math.random() * 120 + "ms";
    box.appendChild(c);
    c.addEventListener("animationend", () => c.remove());
  }
}
export function bump(el) { if (!el) return; el.classList.remove("is-changed"); void el.offsetWidth; el.classList.add("is-changed"); }

// ---------- Lightbox (native dialog, one per page shell) ----------
export function openLightbox(title, src) {
  const lb = document.getElementById("lightbox");
  lb.querySelector("#lightbox-title").textContent = title;
  const img = lb.querySelector("#lightbox-img");
  img.replaceChildren();
  const el = document.createElement("img");
  el.alt = title;
  el.src = src;
  img.appendChild(el);
  lb.showModal();
}

// ---------- Copy to clipboard, with a selection fallback ----------
export async function copyText(text, el) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    if (el) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
    return false;
  }
}

/** Editor HTML (tasks.prompt) to plain text, and back. */
export function htmlToText(h) {
  const d = document.createElement("div");
  d.innerHTML = String(h || "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h\d)>/gi, "\n").replace(/<li>/gi, "- ");
  return d.textContent.replace(/\n{3,}/g, "\n\n").trim();
}
export function textToHtml(t) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return String(t || "").trim().split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
}
