// 2. Home: what's waiting for you, your cast, workspaces, who plays which role.
import { html } from "@arrow-js/core";
import { me } from "../api.js";
import { page, empty } from "../components/page.js";
import { ago, avatar, chip, date, hue as hueOf, icon, initials as initialsOf, plural } from "../lib/ui.js";
import { championOf, leaderboards, load, runLabel, sortRoles } from "../state/data.js";
import { inbox, itemAction, itemHref, itemKind, itemTitle } from "../state/inbox.js";
import { APP, currentQuery } from "../lib/nav.js";

const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };
const today = () => new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
const ownerName = () => { const m = me(); const n = m?.name || (m?.email || "").split("@")[0]; return n && n !== "owner" ? n.charAt(0).toUpperCase() + n.slice(1) : ""; };

export const meta = { title: "Workspaces · Audition", nav: { label: "Workspaces", order: 1 } };

export default function home() {
  return page({
    screen: "home",
    // The page draws as soon as the collections are in; the leaderboards
    // (suggested champions, output counts) fill their reserved slots after,
    // so the heading isn't held back by them (NOTES H1).
    load: async (s) => {
      s.boards = leaderboards();
      s.d = await load();
    },
    shell: () => html`${hero(null)}${homeSkeleton()}`,
    body: (s) => {
      const d = s.d;
      const roles = sortRoles(d, d.roles);
      const cast = roles.map((r) => ({ r, c: championOf(d, r.id) }));
      fillBoards(s, cast);
      // "Waiting for you" (top bar, phone nav) opens Home at its "Up next" list.
      if (currentQuery().waiting) requestAnimationFrame(() => document.getElementById("up-next")?.scrollIntoView({ block: "start" }));
      return html`
        ${hero({ d, roles, cast, gen: s.gen })}
        <div class="home-grid">
          <div class="home-main">
            ${() => upNext()}
            <div class="stack-sm">
              <div class="section-head"><h2>Workspaces</h2><a class="btn btn--sm btn--quiet" href="${APP + "/w/new"}">${icon("plus")}New workspace</a></div>
              ${d.workspaces.length ? html`<div class="grid-cards stagger">${d.workspaces.map((w) => wsCard(d, w, cast))}</div>` : empty("workspaces", "No workspaces yet", "A workspace holds the roles of one workflow, sorted into groups if you like.", html`<a class="btn btn--primary" href="${APP + "/w/new"}">${icon("plus")}New workspace</a>`)}
            </div>
          </div>
          <aside class="home-rail">
            <div class="panel">
              <div class="panel__head"><h2>${icon("champion", "gold")}Who plays which role</h2></div>
              <ul class="cast-list">${cast.map((x) => castRow(d, s, x))}</ul>
            </div>
            ${feed(d)}
          </aside>
        </div>`;
    },
  });
}


/**
 * The hero. With no data (`h` null) it's the loading shell: the heading and
 * buttons as they will be, the numbers as placeholders of the same size, so
 * the heading (the page's largest paint) shows before any data arrives.
 */
function hero(h) {
  const name = ownerName();
  const roles = h?.roles || [];
  const champions = h ? h.cast.filter((x) => x.c) : [];
  const active = h ? h.d.runs.filter((r) => r.status !== "done") : null;
  const open = roles.length - champions.length;
  const pct = roles.length ? Math.round((champions.length / roles.length) * 100) : 0;
  const runs = () => (active ? `${plural(active.length, "run")} ${active.length === 1 ? "is" : "are"} working in the background` : "your runs are loading");
  return html`<div class="home-hero">
      <div class="stack hero-copy">
        <span class="eyebrow">${icon("sun")}${today()}</span>
        <h1>${greeting()}${name ? ", " + name : ""}.<br>${() => (inbox.count ? "Your next audition is ready." : "Nothing is waiting for you.")}</h1>
        <p class="lede">${() => `${inbox.count ? plural(inbox.count, "thing") + (inbox.count === 1 ? " is" : " are") + " waiting for you" : "You're all caught up"}, and ${runs()}.`}</p>
        <div class="row">
          ${() => (inbox.items.length ? html`<a class="btn btn--primary btn--lg" href="${itemHref(inbox.items[0])}">${icon("play")}Pick up where you left off</a>` : "")}
          <a class="btn btn--lg" href="${APP + "/runs/new"}">${icon("plus")}Start a run</a>
        </div>
      </div>
      <div class="hero-cast">
        <div class="row-between"><span class="eyebrow">${icon("champion", "gold")}Your cast</span></div>
        <div class="row hero-cast__row">
          <div class="hero-cast__stack" aria-label="Champions">
            ${h ? champions.slice(0, 3).map((x) => { const c = h.d.byId.contenders.get(x.c.contender); return html`<span class="avatar" style="${"--h:" + hueOf(c?.name)}" data-tip="${(c?.name || "") + " · " + x.r.name}">${initialsOf(c?.name)}${icon("champion", "crown")}</span>`; }) : html`<span class="avatar is-empty" aria-label="Loading"></span>`}
            ${open > 0 ? html`<span class="avatar is-empty" data-tip="${plural(open, "role") + " still auditioning"}">+${open}</span>` : ""}
          </div>
          <div class="stack-sm hero-cast__count"><strong class="num hero-num">${h ? `${champions.length} of ${roles.length}` : "–"}</strong><span class="small muted">roles have a champion</span></div>
          <span class="ring ring--gold ring--end" style="${"--p:" + pct}">${h ? pct + "%" : ""}</span>
        </div>
        ${!h || roles.length ? html`<div class="hero-cast__note" id="${"hero-note-" + (h?.gen ?? 0)}">${h ? castNote(open) : html`<div class="notice notice--tight">${icon("play")}<div class="small">Loading your cast…</div></div>`}</div>` : ""}
      </div>
    </div>`;
}

/** Below the hero while loading. */
const homeSkeleton = () => html`<div class="home-grid" aria-busy="true" aria-label="Loading"><div class="home-main"><div class="skeleton skeleton--title"></div><div class="panel"><div class="panel__body"><div class="skeleton skeleton--w60"></div><div class="skeleton skeleton--w85"></div><div class="skeleton skeleton--w40"></div></div></div></div><aside class="home-rail"><div class="panel"><div class="panel__body"><div class="skeleton skeleton--w85"></div><div class="skeleton skeleton--w60"></div></div></div></aside></div>`;

function upNext() {
  if (!inbox.items.length) return html`<div class="stack-sm" id="up-next"><div class="section-head"><h2>Up next</h2></div>${empty("inbox-duo", "Nothing waiting for you", "Start a run and the replies to paste and outputs to judge show up here.")}</div>`;
  const [first, ...rest] = inbox.items;
  return html`<div class="stack-sm" id="up-next">
      <div class="section-head"><h2>Up next</h2><span class="small muted">1 of ${inbox.items.length} waiting</span></div>
      <div class="up-next">
        ${first.kind === "paste" ? avatar(first.names[0], "") : first.kind === "trial" ? avatar(first.taskTitle, "") : html`<span class="letter-tile">A–Z</span>`}
        <div class="minw0">
          <div class="up-next__title">${itemTitle(first)}</div>
          <div class="up-next__meta"><span>${icon("workspaces")}${first.workspace}</span><span>${icon(itemKind(first)[1])}${itemKind(first)[0]}</span><span>${icon("history")}${first.runLabel} · ${first.role}</span></div>
        </div>
        <a class="btn btn--primary btn--lg" href="${itemHref(first)}">${itemAction(first)}${icon("arrow-right", "i--nudge")}</a>
      </div>
    </div>
    ${rest.length ? html`<div class="stack-sm"><div class="section-head"><h2>Also waiting</h2></div><div class="queue stagger">${rest.slice(0, 6).map((g) => html`<a href="${itemHref(g)}">${g.kind === "paste" ? avatar(g.names[0], "") : g.kind === "trial" ? avatar(g.taskTitle, "") : html`<span class="letter-tile letter-tile--sm">A–Z</span>`}<span><strong>${itemTitle(g)}</strong><br><span class="small muted">${g.workspace} · ${g.role} · ${g.runLabel}</span></span>${chip("waiting", g.kind === "paste" ? plural(g.attempts.length, "to paste", "to paste") : g.kind === "outcome" ? "Check" : g.kind === "trial" ? "Decide" : "Judge")}${icon("arrow-right", "go")}</a>`)}</div></div>` : ""}`;
}

function wsCard(d, w, cast) {
  const roles = cast.filter((x) => x.r.workspace === w.id);
  const groups = d.groups.filter((g) => g.workspace === w.id);
  const done = roles.filter((x) => x.c).length;
  const runs = d.runs.filter((r) => r.workspace === w.id);
  const ids = [...new Set(runs.flatMap((r) => r.contenders || []))].slice(0, 5);
  const live = runs.filter((r) => r.status !== "done").at(-1);
  const p = roles.length ? Math.round((done / roles.length) * 100) : 0;
  const state = live ? chip("active", `${runLabel(d, live)} live`)
    : roles.length && done === roles.length ? chip("champion", "Fully cast")
    : runs.length ? chip("draft", `${roles.length - done} to cast`) : chip("draft", "No runs yet");
  return html`<a class="ws-card" href="${APP + "/w/" + w.id}">
    <div class="ws-card__top">${avatar(w.name, "lg")}<div class="grow"><h3>${w.name}</h3><span class="small muted">${groups.length ? plural(groups.length, "group") + " · " : ""}${plural(roles.length, "role")}</span></div><span class="${"ring ring--sm" + (p === 100 ? " ring--gold" : "")}" style="${"--p:" + p}">${done}/${roles.length}</span></div>
    <div class="ws-card__foot"><span class="faces">${ids.map((id) => avatar(d.byId.contenders.get(id)?.name || "?"))}</span>${state}</div>
  </a>`;
}

/**
 * When the leaderboards arrive, fill the slots the body reserved for them: the
 * hero's note and each uncast role's right-hand side. Drawn by hand into the
 * slots (like the page body, NOTES U3/G9), and only into this mount's slots.
 */
function fillBoards(s, cast) {
  const gen = (s.gen = (s.gen || 0) + 1);
  let left = false;
  s.onLeave(() => { left = true; });
  const into = (el, tpl) => { el.replaceChildren(); tpl(el); };
  s.boards.then((lb) => {
    let tries = 0;
    const go = () => {
      if (left || s.gen !== gen) return;
      const note = document.getElementById("hero-note-" + gen);
      const rows = cast.filter((x) => !x.c);
      if (!note && rows.length && tries++ < 120) { requestAnimationFrame(go); return; }
      const suggested = rows.find((x) => lb.get(x.r.id)?.suggested);
      if (note && suggested) into(note, html`<div class="notice notice--tight" data-state="warning">${icon("sparkle")}<div class="small"><strong>${suggested.r.name}</strong> has a suggested champion. <a href="${APP + "/leaderboard/" + suggested.r.id}">Confirm it</a></div></div>`);
      for (const x of rows) {
        const el = document.getElementById(`cast-${gen}-${x.r.id}`);
        if (el) into(el, uncastRight(s.d, x.r, lb.get(x.r.id)));
      }
    };
    go();
  });
}

/** The hero note before (and unless) a suggestion arrives; same one-line height. */
const castNote = (open) => open
  ? html`<div class="notice notice--tight">${icon("play")}<div class="small">${plural(open, "role")} still auditioning. <a href="${APP + "/runs/new"}">Start a run</a></div></div>`
  : html`<div class="notice notice--tight" data-state="done">${icon("champion")}<div class="small">Every role has a champion.</div></div>`;

function castRow(d, s, { r, c }) {
  const ws = d.byId.workspaces.get(r.workspace)?.name;
  const right = c
    ? html`<span class="who">${avatar(d.byId.contenders.get(c.contender)?.name, "sm")}${d.byId.contenders.get(c.contender)?.name}${c.trial ? html`<a class="link-plain" href="${APP + "/leaderboard/" + r.id}">${chip("waiting", "On trial")}</a>` : icon("champion", "crown")}</span>`
    : html`<span class="cast-slot" id="${"cast-" + s.gen + "-" + r.id}"><span class="skeleton skeleton--ring" aria-label="Loading"></span></span>`;
  return html`<li><div><div class="role">${r.name}</div><div class="ws">${ws}</div></div>${right}</li>`;
}

/** An uncast role's right-hand side, from its leaderboard. */
function uncastRight(d, r, lb) {
  let right;
  if (lb?.suggested) right = html`<a class="state link-plain" data-state="warning" href="${APP + "/leaderboard/" + r.id}">${icon("sparkle")}Confirm ${d.byId.contenders.get(lb.suggested)?.name || "the suggestion"}</a>`;
  else {
    const ws_ = d.byId.workspaces.get(r.workspace);
    const n = Math.max(0, ...(lb?.rows || []).map((x) => x.n));
    const min = ws_?.min_outputs || 5;
    right = n ? html`<span class="row-tight small muted"><span class="ring ring--sm" style="${"--p:" + Math.min(100, Math.round((n / min) * 100))}">${Math.min(n, min)}/${min}</span>outputs</span>` : html`<a class="small" href="${APP + "/runs/new?role=" + r.id}">Start a run</a>`;
  }
  return right;
}

function feed(d) {
  const items = [
    ...d.runs.map((r) => ({ at: r.created, state: r.status === "done" ? "done" : "active", icon: "play", text: html`You started <strong>${runLabel(d, r)}</strong> for ${d.byId.roles.get(r.role)?.name}` })),
    ...d.castings.filter((c) => c.confirmed).map((c) => ({ at: c.created, state: "champion", icon: "champion", text: html`<strong>${d.byId.contenders.get(c.contender)?.name}</strong> ${c.restored ? "was restored as" : "became"} ${d.byId.roles.get(c.role)?.name} champion${c.trial ? ", on trial" : ""}` })),
  ].sort((a, b) => b.at - a.at).slice(0, 6);
  if (!items.length) return "";
  return html`<div class="panel"><div class="panel__head"><h2>${icon("history")}Latest</h2></div><ol class="feed">${items.map((i) => html`<li><span class="feed__icon" data-state="${i.state}">${icon(i.icon)}</span><span>${i.text}<time title="${date(i.at)}">${ago(i.at)}</time></span></li>`)}</ol></div>`;
}
