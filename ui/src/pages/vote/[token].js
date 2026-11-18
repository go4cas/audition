// Guest voting (TECH-SPEC §10b): the page a shared link opens. No account and
// no app chrome: the guest gets a Vaultbase anonymous session (lib/guest.js)
// and a blind ballot, task by task. Rate runs ask for 1 to 5 stars per
// output; Compare runs ask which of two outputs is better. Each vote saves at
// once. This page reads only the guest routes, which never say who made an
// output (test/ui-guests.test.ts checks this file).
import { html, reactive } from "@arrow-js/core";
import { starInput } from "../../components/forms.js";
import { empty, page } from "../../components/page.js";
import { logo } from "../../components/shell.js";
import { ballot, guestFile, vote } from "../../lib/guest.js";
import { routeArgs } from "../../lib/nav.js";
import { errorToast, icon, openLightbox, plural, toast } from "../../lib/ui.js";

export const meta = { title: "Help judge · Audition", bare: true };

const PICK_TEXT = { left: (x) => `${x.left} is better`, right: (x) => `${x.right} is better`, tie: () => "About the same" };

export default function voteView() {
  const { params } = routeArgs();
  return page({
    screen: "vote",
    narrow: false,
    load: async (s) => {
      try {
        s.b = await ballot(params.token);
        s.closed = null;
      } catch (e) {
        // A closed, expired, full or unknown link: a friendly end page, not an error box.
        if (e.status === 404 || e.status === 410) { s.closed = e.message; return; }
        throw e;
      }
      s.v = reactive({
        stars: Object.fromEntries(s.b.tasks.map((t) => [t.id, { ...(t.stars || {}) }])),
        picks: Object.fromEntries(s.b.tasks.map((t) => [t.id, (t.pairs || []).map((p) => p.pick)])),
        cur: Object.fromEntries(s.b.tasks.map((t) => [t.id, Math.max(0, (t.pairs || []).findIndex((p) => !p.pick))])),
      });
    },
    body: (s) => (s.closed ? closedView(s.closed) : ballotView(s, params.token)),
  });
}

const brand = html`<div class="vote-brand"><span class="brand__mark has-logo">${logo()}</span><span class="vote-brand__name">Audition</span></div>`;

function closedView(message) {
  return html`${brand}<div class="panel">${empty("judge-duo", "Voting is closed", message)}</div>`;
}

function ballotView(s, token) {
  const { b, v } = s;
  const compare = b.method === "compare";
  const total = b.tasks.reduce((n, t) => n + (compare ? t.pairs.length : t.outputs.length), 0);
  const done = () => b.tasks.reduce((n, t) => n + (compare ? v.picks[t.id].filter(Boolean).length : Object.values(v.stars[t.id]).filter(Boolean).length), 0);

  const head = html`${brand}
    <div class="page-head"><div>
      <h1>Help pick the best answer</h1>
      <p class="lede">${compare
        ? "Look at two answers at a time and pick the better one, or call it even."
        : "Read each answer and give it 1 to 5 stars."} You don't need an account, and nobody sees who you are.</p>
    </div></div>
    <div class="blind-banner">${icon("blind")}<span>You won't see who or what made each answer. The letters are shuffled.</span></div>
    ${b.rubric.length ? html`<details class="panel">
      <summary class="panel__head summary-plain"><h2 class="h-md">${icon("rubric")}What makes a good answer${b.role ? html` <span class="muted small">for ${b.role}</span>` : ""}</h2></summary>
      <div class="panel__body rubric-legend">${b.rubric.map((c) => html`<div><strong>${c.name}</strong><span class="muted">${c.guidance || ""}</span></div>`)}</div>
    </details>` : ""}
    <div class="row-tight" data-testid="vote-progress"><div class="progress progress--short"><span class="p-done" style="${() => "width:" + (total ? (done() / total) * 100 : 0) + "%"}"></span></div><span class="small text-2">${() => `${done()} of ${total} ${compare ? (total === 1 ? "pair" : "pairs") : "answers"} done`}</span></div>`;

  if (!b.tasks.length) return html`${head}<div class="panel">${empty("judge-duo", "Nothing to judge yet", "The answers aren't in yet. Try this link again later.")}</div>`;

  const thanks = () => (total && done() === total
    ? html`<div class="notice" data-state="done" data-testid="vote-thanks">${icon("done")}<div><p><strong>Thank you! All your votes are in.</strong></p><p class="small">You can change any of them while the link is open. You can close this page now.</p></div></div>`
    : "");

  return html`${head}
    ${b.tasks.map((t) => taskPanel(s, token, t))}
    ${thanks}
    <p class="xs muted vote-foot">${b.expires_at ? `This link closes on ${new Date(b.expires_at * 1000).toLocaleDateString(undefined, { day: "numeric", month: "long" })}. ` : ""}Your votes help decide which tool does this job best.</p>`;
}

function prompt(t) {
  return html`<details class="vote-prompt"><summary class="small">${icon("text")}What was asked</summary><div class="output__text small">${t.prompt_text}</div></details>`;
}

function files(o, big) {
  const imgs = o.files.filter((f) => f.is_image), rest = o.files.filter((f) => !f.is_image);
  const open = (f, i) => async () => { try { openLightbox(`Answer ${o.label}, image ${i + 1}`, await guestFile(f.url)); } catch (err) { errorToast(err); } };
  return html`${imgs.length ? html`<div class="${big ? "pair-images" : "thumbs"}">${imgs.map((f, i) => html`<button class="${big ? "image-card__img ph" : "thumb"}" type="button" aria-label="${"Enlarge image " + (i + 1) + " of answer " + o.label}" @click="${open(f, i)}">${img(f.url, `Answer ${o.label}, image ${i + 1}`)}${big ? html`<span class="zoom">${icon("enlarge")}</span>` : ""}</button>`)}</div>` : ""}
    ${rest.length ? html`<ul class="files">${rest.map((f) => html`<li>${icon("file")}<button class="link-btn" type="button" @click="${async () => { try { const a = document.createElement("a"); a.href = await guestFile(f.url); a.download = f.name; a.click(); } catch (err) { errorToast(err); } }}">${f.name}</button></li>`)}</ul>` : ""}`;
}

function img(url, alt) {
  const st = reactive({ src: "" });
  guestFile(url).then((u) => { st.src = u; }).catch(() => {});
  return html`<img class="art" alt="${alt}" decoding="async" src="${() => st.src || false}">`;
}

function taskPanel(s, token, t) {
  return s.b.method === "compare" ? comparePanel(s, token, t) : ratePanel(s, token, t);
}

function ratePanel(s, token, t) {
  const st = s.v.stars[t.id];
  const image = t.output_type === "image";
  const rate = (o) => async (n) => {
    const before = st[o.label];
    st[o.label] = n;
    try { await vote(token, { task: t.id, label: o.label, stars: n }); toast(`Saved: ${plural(n, "star")} for ${o.label}`, "done", "check"); }
    catch (err) { st[o.label] = before; errorToast(err); }
  };
  const card = (o) => html`<article class="${() => (image ? "image-card" : "output") + (st[o.label] ? " is-rated" : "")}" data-output="${o.label}">
    <div class="output__head"><span class="letter-tile">${o.label}</span><span class="grow"></span>${() => (st[o.label] ? html`<span class="state" data-state="done">${icon("check")}Rated</span>` : "")}</div>
    <div class="output__body">
      ${files(o, image)}
      ${o.output ? html`<div class="output__text">${o.output}</div>` : o.files.length ? "" : html`<p class="muted small">This answer is empty.</p>`}
    </div>
    <div class="output__rating vote-stars"><span class="small text-2">How good is ${o.label}?</span>${starInput({ name: `g${t.id.slice(0, 8)}${o.label}`, label: `Stars for answer ${o.label}`, value: () => st[o.label] || 0, onChange: rate(o) })}</div>
  </article>`;
  return html`<section class="panel vote-task" data-task="${t.id}">
    <div class="panel__head"><h2 class="h-md">${icon(image ? "image" : "text")}${t.title}</h2><span class="small text-2">${() => `${Object.values(st).filter(Boolean).length} of ${t.outputs.length} rated`}</span></div>
    <div class="panel__body gap-10">
      ${prompt(t)}
      <div class="${image ? "image-grid" : "outputs"}">${t.outputs.map(card)}</div>
    </div>
  </section>`;
}

function comparePanel(s, token, t) {
  const picks = s.v.picks[t.id];
  const byLabel = new Map(t.outputs.map((o) => [o.label, o]));
  const image = t.output_type === "image";
  const cur = () => s.v.cur[t.id];
  if (!t.pairs.length) {
    return html`<section class="panel vote-task"><div class="panel__head"><h2 class="h-md">${icon("text")}${t.title}</h2></div><div class="panel__body"><p class="small muted">Only one answer came in for this one, so there is nothing to compare.</p></div></section>`;
  }
  // The current pair is drawn by hand into its host, not through a reactive
  // slot: Arrow 1.0.6 left the old pair in place when the slot redrew (NOTES U3).
  const hostId = "pair-" + t.id;
  const draw = () => {
    const host = document.getElementById(hostId);
    if (!host) { requestAnimationFrame(draw); return; }
    host.replaceChildren();
    pair()(host);
  };
  const goTo = (i) => { s.v.cur[t.id] = i; draw(); };
  const pick = (which) => async () => {
    const i = cur(), x = t.pairs[i], before = picks[i];
    picks[i] = which;
    try {
      await vote(token, { task: t.id, left: x.left, right: x.right, pick: which });
      toast("Saved", "done", "check");
      const next = picks.findIndex((p, k) => k !== i && !p);
      if (next >= 0) goTo(next);
    } catch (err) { picks[i] = before; errorToast(err); }
  };
  const side = (label, which) => {
    const o = byLabel.get(label);
    return html`<article class="${() => "output" + (picks[cur()] === which ? " is-best" : "")}" data-output="${label}">
      <div class="output__head"><span class="letter-tile">${label}</span><span class="state best-tag" data-state="champion">${icon("trophy")}Your pick</span></div>
      <div class="output__body">
        ${files(o, image)}
        ${o.output ? html`<div class="output__text">${o.output}</div>` : o.files.length ? "" : html`<p class="muted small">This answer is empty.</p>`}
      </div>
    </article>`;
  };
  const pair = () => {
    const i = cur(), x = t.pairs[i];
    const btn = (which) => html`<button class="${() => "btn btn--lg" + (picks[i] === which ? " btn--primary" : "")}" type="button" aria-pressed="${() => (picks[i] === which ? "true" : "false")}" @click="${pick(which)}">${which === "tie" ? icon("shuffle") : icon("trophy")}${PICK_TEXT[which](x)}</button>`;
    return html`<section class="pair" aria-label="${"Answer " + x.left + " against answer " + x.right}">
      <div class="pair__sides">${side(x.left, "left")}${side(x.right, "right")}</div>
      <div class="pair__pick">
        <p class="small text-2 row-tight">${icon("judge")}Which is better? <span class="muted">Pair ${i + 1} of ${t.pairs.length}</span></p>
        <div class="row pair__buttons">${btn("left")}${btn("tie")}${btn("right")}</div>
      </div>
    </section>`;
  };
  draw();
  return html`<section class="panel vote-task" data-task="${t.id}">
    <div class="panel__head"><h2 class="h-md">${icon(image ? "image" : "text")}${t.title}</h2><span class="small text-2">${() => `${picks.filter(Boolean).length} of ${t.pairs.length} decided`}</span></div>
    <div class="panel__body gap-10">
      ${prompt(t)}
      <nav class="pair-nav" aria-label="Pairs">${t.pairs.map((x, i) => html`<button type="button" class="${() => "pair-chip" + (cur() === i ? " is-current" : "") + (picks[i] ? " is-done" : "")}" aria-current="${() => (cur() === i ? "true" : false)}" @click="${() => goTo(i)}"><span>${[x.left, x.right].sort().join(" vs ")}</span>${() => (picks[i] ? icon("check") : "")}</button>`)}</nav>
      <div id="${hostId}"></div>
    </div>
  </section>`;
}
