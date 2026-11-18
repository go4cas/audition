// 12 and 13. Blind judging, side by side (text and code) or as an image grid.
// This module reads only the blind route, GET /api/custom/judging/:run/:task
// (TECH-SPEC §10), and writes owner verdicts. It never asks for contender
// records or raw outputs, so nothing here can reveal who made what
// (test/ui.test.ts checks this file).
import { html, reactive } from "@arrow-js/core";
import { THUMB, create, custom, fileLabel, fileUrl, thumbUrl } from "../../../api.js";
import { starInput } from "../../../components/forms.js";
import { busy, crumbs, empty, page } from "../../../components/page.js";
import { bump, chip, compareScoreHelp, errorToast, icon, openLightbox, plural, popId, toast } from "../../../lib/ui.js";
import { refreshInbox } from "../../../state/inbox.js";
import { APP, routeArgs } from "../../../lib/nav.js";

const weighted = (rubric, stars) => {
  let sum = 0, w = 0;
  for (const c of rubric) { if (!stars[c.name]) return null; sum += stars[c.name] * c.weight; w += c.weight; }
  return w ? Math.round((sum / w) * 100) / 100 : null;
};

// The one write this screen makes: an owner verdict (stars, or a pick in Compare).
const saveVerdict = (body) => create("verdicts", body);

export const meta = { title: "Judge · Audition" };

export default function judge() {
  const { params } = routeArgs();
  return page({
    screen: "judge",
    load: async (s) => {
      const p = await custom.judging(params.run, params.task);
      s.p = p;
      if (p.run.method === "compare") {
        const open = p.pairs.findIndex((x) => x.ready && !x.pick);
        s.j = reactive({ cur: open >= 0 ? open : 0 });
        return;
      }
      s.j = reactive({
        outs: p.outputs.map((o) => ({
          id: o.attempt, editing: !o.verdict, dirty: false,
          stars: Object.fromEntries(p.rubric.map((c) => [c.name, o.verdict?.scores?.[c.name]?.stars || 0])),
        })),
      });
    },
    body: (s) => {
      const { p, j } = s;
      const image = p.task.output_type === "image";
      if (p.run.method === "compare") return compareView(s, params);
      const out = (o) => j.outs.find((x) => x.id === o.attempt);
      const score = (o) => weighted(p.rubric, out(o).stars);
      const save = async (list) => {
        for (const o of list) {
          const st = out(o).stars;
          await saveVerdict({ attempt: o.attempt, scores: Object.fromEntries(p.rubric.map((c) => [c.name, { stars: st[c.name], reason: "" }])) });
        }
      };
      const saveAll = (e) => busy(e, async () => {
        const ready = p.outputs.filter((o) => out(o).dirty && score(o) != null);
        if (!ready.length) { toast("Give every line some stars first", "error", "warning"); return; }
        try { await save(ready); toast(ready.length === 1 ? "Stars saved" : `Stars saved for ${ready.length} outputs`); refreshInbox(); s.reload({ quiet: true }); } catch (err) { errorToast(err); }
      });
      const toggleEdit = (o) => async (e) => {
        const x = out(o);
        if (!x.editing) { x.editing = true; return; }
        if (!x.dirty) { x.editing = !o.verdict; return; }
        if (score(o) == null) { toast("Give every line some stars first", "error", "warning"); return; }
        await busy(e, async () => {
          try { await save([o]); toast(o.verdict?.judge_kind === "ai" ? "Your stars count now. The AI's stay in history." : "Stars saved", "done", "check"); refreshInbox(); s.reload({ quiet: true }); } catch (err) { errorToast(err); }
        });
      };
      const best = () => {
        let b = null;
        for (const o of p.outputs) { const sc = score(o); if (sc != null && (!b || sc > b.sc)) b = { o, sc }; }
        return b;
      };
      const rated = () => p.outputs.filter((o) => o.verdict && !out(o).dirty).length;
      const pending = () => j.outs.some((x) => x.dirty);

      const stars = (o, c) => {
        const x = out(o);
        const ai = o.verdict?.judge_kind === "ai" ? o.verdict.scores?.[c.name] : null;
        const hist = (o.verdict?.history || []).find((h) => h.judge_kind === "ai");
        const pop = popId();
        return html`<div class="crit"><span class="crit__name">${c.name}${ai || hist ? html`<button class="info-btn" type="button" popovertarget="${pop}" aria-label="Why these stars">${icon(o.verdict?.judge_kind === "human" ? "edit" : "ai", o.verdict?.judge_kind === "human" ? "changed" : "")}</button>
          <div class="pop" id="${pop}" popover><div class="pop__head">${icon("ai")}${c.name} · Output ${o.label}</div><div class="pop__body">${ai?.reason ? html`<p>AI: ${ai.reason}</p>` : ""}<p class="xs muted">${ai ? `The AI gave ${ai.stars} stars.` : hist ? `The AI scored this output ${hist.score}. Your stars count now.` : ""}</p></div></div>` : ""}</span>
          ${starInput({ name: `o${o.label}c${c.name.replace(/\W/g, "")}`, label: `${c.name}, output ${o.label}`, value: () => x.stars[c.name], disabled: () => !x.editing, onChange: (v) => { x.stars[c.name] = v; x.dirty = true; queueMicrotask(() => bump(document.querySelector(`[data-score="${o.label}"]`))); } })}</div>`;
      };
      const tag = (o) => () => {
        const x = out(o);
        if (x.dirty) return html`<span class="judge-tag">${icon("me")}Not saved yet</span>`;
        if (!o.verdict) return html`<span class="judge-tag">${icon("draft")}${p.run.judge === "ai" ? "The AI hasn't judged this yet" : "Not rated yet"}</span>`;
        return html`<span class="judge-tag">${o.verdict.judge_kind === "ai" ? html`${icon("ai")}Judged by AI` : html`${icon("me")}Your stars count`}</span>`;
      };
      const editBtn = (o) => () => {
        const x = out(o);
        if (!o.verdict && !x.dirty) return "";
        return html`<button class="${x.editing ? "btn btn--sm btn--primary" : "btn btn--sm btn--quiet"}" type="button" @click="${toggleEdit(o)}">${icon(x.editing ? "check" : "edit")}<span>${x.editing ? "Done" : "Change stars"}</span></button>`;
      };
      const files = (o) => {
        const imgs = o.files.filter((f) => f.is_image), rest = o.files.filter((f) => !f.is_image);
        return html`${imgs.length ? html`<div class="thumbs">${imgs.map((f, i) => html`<button class="thumb" type="button" aria-label="${"Image " + (i + 1) + " of output " + o.label}" @click="${async () => openLightbox(`Output ${o.label}, image ${i + 1}`, await fileUrl(f.url))}">${blobImg(f.url, `Output ${o.label}, image ${i + 1}`, THUMB.small)}</button>`)}</div>` : ""}
          ${rest.length ? html`<ul class="files">${rest.map((f) => html`<li>${icon("file")}<button class="link-btn" type="button" @click="${async () => { try { const a = document.createElement("a"); a.href = await fileUrl(f.url); a.download = fileLabel(f.name); a.click(); } catch (err) { errorToast(err); } }}">${fileLabel(f.name)}</button></li>`)}</ul>` : ""}`;
      };
      const scoreEl = (o) => html`<span class="score" data-score="${o.label}">${icon("star")}<span>${() => { const v = score(o); return v == null ? "–" : v.toFixed(1); }}</span></span>`;

      const head = html`
        ${crumbs([["Workspaces", APP + "/"], ["Back to the run", APP + "/runs/" + params.run], "Judging"])}
        <div class="page-head"><div><h1>${p.task.title}</h1>
          <p class="lede">${p.run.judge === "ai" ? "The AI judges these. Change any stars you disagree with; your stars then count." : image ? "You are the judge. Tap an image to see it large." : "You are the judge. Give each line 1 to 5 stars."}</p></div></div>
        <div class="blind-banner">${icon("blind")}<span>Names are hidden and the order is shuffled.</span></div>`;
      if (!p.outputs.length) return html`${head}<div class="panel">${empty("judge-duo", "Nothing to judge yet", "Outputs appear here as they come in.", html`<a class="btn btn--primary" href="${APP + "/runs/" + params.run}">Back to the run</a>`)}</div>`;

      const rubric = html`<details class="panel" open>
        <summary class="panel__head summary-plain"><h2 class="h-md">${icon("rubric")}Rubric</h2>${p.pass_mark ? html`<span class="muted small row-tight">${icon("pass-mark")}Pass mark ${p.pass_mark}</span>` : ""}</summary>
        <div class="panel__body rubric-legend">${p.rubric.map((c) => html`<div><strong>${c.name} <span class="weight">${c.weight}%</span></strong><span class="muted">${c.guidance || ""}</span></div>`)}</div>
      </details>`;
      const saveBar = html`<div class="row-between">
        <p class="small text-2 row-tight">${icon("trophy", "gold")}${() => { const b = best(); return b ? html`Best on this task: <strong>Output ${b.o.label} · ${b.sc.toFixed(1)}</strong>` : "Rate the outputs to see the best one."; }}</p>
        <div class="row">
          ${() => (pending() ? html`<button class="btn btn--primary btn--lg" type="button" @click="${saveAll}">${icon("check")}Save stars</button>` : "")}
          <a class="btn btn--quiet" href="${APP + "/runs/" + params.run}">Back to run</a>
          ${p.role ? html`<a class="btn" href="${APP + "/leaderboard/" + p.role}">${icon("leaderboard")}See leaderboard</a>` : ""}
        </div>
      </div>`;

      if (image) {
        return html`${head}
          <div class="panel"><div class="panel__body rubric-legend">${p.rubric.map((c) => html`<div><strong>${c.name} <span class="weight">${c.weight}%</span></strong><span class="muted">${c.guidance || ""}</span></div>`)}</div></div>
          <div class="image-grid">${p.outputs.map((o) => {
            const imgs = o.files.filter((f) => f.is_image);
            const first = imgs[0];
            return html`<article class="${() => "image-card" + (score(o) != null && !out(o).dirty && o.verdict ? " is-rated" : "")}" data-output="${o.label}">
              <button class="image-card__img ph" type="button" aria-label="${"Enlarge output " + o.label}" @click="${async () => { if (first) openLightbox(`Output ${o.label}`, await fileUrl(first.url)); }}">
                ${first ? blobImg(first.url, `Output ${o.label}`, THUMB.card) : html`<span class="muted small">No image</span>`}
                <span class="letter-tile">${o.label}</span><span class="zoom">${icon("enlarge")}</span>
                ${imgs.length > 1 ? html`<span class="chip">${icon("image")}${imgs.length} images</span>` : ""}
              </button>
              ${o.output ? html`<p class="small text-2 image-card__caption">${o.output}</p>` : ""}
              <div class="output__rating">${p.rubric.map((c) => stars(o, c))}</div>
              <div class="image-card__foot">${scoreEl(o)}${() => { const x = out(o); return o.verdict && !x.dirty ? chip("done", "Rated") : Object.values(x.stars).some(Boolean) ? chip("active", "In progress") : chip("draft", "Not rated"); }}${editBtn(o)}</div>
            </article>`;
          })}</div>
          <div class="row-tight"><div class="progress progress--short"><span class="p-done" style="${() => "width:" + (rated() / p.outputs.length) * 100 + "%"}"></span></div><span class="small text-2">${() => `${rated()} of ${p.outputs.length} rated`}</span></div>
          ${saveBar}`;
      }

      return html`${head}${rubric}
        <nav class="pager" aria-label="Jump to output">${p.outputs.map((o) => html`<a href="${"#out-" + o.label}" @click="${(e) => { e.preventDefault(); const el = document.getElementById("out-" + o.label); el.parentElement.scrollTo({ left: el.offsetLeft - el.parentElement.offsetLeft, behavior: "smooth" }); }}">${o.label}</a>`)}</nav>
        <div class="outputs">${p.outputs.map((o) => html`<article class="${() => { const b = best(); return "output" + (b && b.o === o ? " is-best" : "") + (o.verdict?.judge_kind === "human" ? " is-overridden" : "") + (out(o).editing && o.verdict ? " is-editing" : ""); }}" id="${"out-" + o.label}" data-output="${o.label}">
          <div class="output__head"><span class="letter-tile">${o.label}</span><span class="state best-tag" data-state="champion">${icon("trophy")}Best so far</span>${scoreEl(o)}</div>
          <div class="output__body">
            ${o.output ? html`<div class="output__text">${o.output}</div>` : html`<p class="muted small">No text, files only.</p>`}
            ${o.claims_note ? html`<div class="claim"><span class="claim__label">${icon("warning")}The agent's own claim. Audition didn't check it.</span><span class="small">Build, test and lint results in this output are the agent's own claims; Audition did not run them.</span></div>` : ""}
            ${o.files?.length ? files(o) : o.claims_note ? html`<p class="xs muted row-tight">${icon("image")}No screenshots attached.</p>` : ""}
          </div>
          <div class="output__rating">${p.rubric.map((c) => stars(o, c))}</div>
          <div class="output__foot">${tag(o)}${editBtn(o)}</div>
        </article>`)}</div>
        ${saveBar}`;
    },
  });
}

/**
 * An <img> of a protected file's thumbnail, fetched with the owner's token.
 * The lightbox opens the full-size file.
 */
function blobImg(url, alt, size) {
  const st = reactive({ src: "" });
  // A busy thumbnail queue answers 503; fall back to the full file then.
  thumbUrl(url, size).catch(() => fileUrl(url)).then((u) => { st.src = u; }).catch(() => {});
  return html`<img class="art" alt="${alt}" decoding="async" src="${() => st.src || false}">`;
}

// ---------- Compare (A vs B): two outputs at a time, pick the better one ----------

const PICK_TEXT = { left: (x) => `${x.left} is better`, right: (x) => `${x.right} is better`, tie: () => "About the same" };
const WINNER = { left: "this", right: "opponent", tie: "tie" };

function compareView(s, params) {
  const { p, j } = s;
  const image = p.task.output_type === "image";
  const byLabel = new Map(p.outputs.map((o) => [o.label, o]));
  const decided = () => p.pairs.filter((x) => x.pick).length;
  const pair = () => p.pairs[j.cur];
  const standings = [...p.outputs].sort((a, b) => (b.record.score ?? -1) - (a.record.score ?? -1) || a.label.localeCompare(b.label));
  const top = standings[0]?.record.score != null ? standings[0] : null;

  const pick = (side) => (e) => busy(e, async () => {
    const x = pair();
    if (x.pick?.winner === side && x.pick.judge_kind === "human") return;
    try {
      await saveVerdict({ attempt: x.left_attempt, opponent: x.right_attempt, winner: WINNER[side] });
      toast(x.pick?.judge_kind === "ai" ? "Your pick counts now. The AI's stays in history." : "Pick saved", "done", "check");
      refreshInbox();
      // On to the next pair still to decide, if there is one.
      const next = p.pairs.findIndex((y, i) => i !== j.cur && y.ready && !y.pick);
      await s.reload({ quiet: true });
      if (next >= 0) s.j.cur = next;
    } catch (err) { errorToast(err); }
  });

  const head = html`
    ${crumbs([["Workspaces", APP + "/"], ["Back to the run", APP + "/runs/" + params.run], "Judging"])}
    <div class="page-head"><div><h1>${p.task.title}</h1>
      <p class="lede">${p.run.judge === "ai" ? "The AI compares these, two at a time. Change any pick you disagree with; your pick then counts." : "You are the judge. Look at two outputs at a time and pick the better one, or call it a tie."}</p></div></div>
    <div class="blind-banner">${icon("blind")}<span>Names are hidden and the order is shuffled.</span></div>`;
  if (p.outputs.length < 2) {
    const why = p.outputs.length ? "The other outputs on this task failed, so there is nothing to compare this one with. It doesn't count on the leaderboard." : "Outputs appear here as they come in.";
    return html`${head}<div class="panel">${empty("judge-duo", p.outputs.length ? "Nothing to compare" : "Nothing to judge yet", why, html`<a class="btn btn--primary" href="${APP + "/runs/" + params.run}">Back to the run</a>`)}</div>`;
  }

  const rubric = html`<details class="panel">
    <summary class="panel__head summary-plain"><h2 class="h-md">${icon("rubric")}What "better" means: the rubric</h2></summary>
    <div class="panel__body rubric-legend">${p.rubric.map((c) => html`<div><strong>${c.name} <span class="weight">${c.weight}%</span></strong><span class="muted">${c.guidance || ""}</span></div>`)}</div>
  </details>`;

  const pairNav = html`<nav class="pair-nav" aria-label="Pairs">${p.pairs.map((x, i) => html`<button type="button" class="${() => "pair-chip" + (j.cur === i ? " is-current" : "") + (x.pick ? " is-done" : "")}" aria-current="${() => (j.cur === i ? "true" : false)}" @click="${() => { j.cur = i; }}">
      <span>${[x.left, x.right].sort().join(" vs ")}</span>${x.pick ? icon(x.pick.judge_kind === "ai" ? "ai" : "check") : !x.ready ? icon("queued") : ""}</button>`)}</nav>`;

  const side = (o, which) => () => {
    const x = pair();
    const won = x.pick && x.pick.winner === which;
    const imgs = o.files.filter((f) => f.is_image), rest = o.files.filter((f) => !f.is_image);
    return html`<article class="${"output" + (won ? " is-best" : "")}" data-output="${o.label}">
      <div class="output__head"><span class="letter-tile">${o.label}</span><span class="state best-tag" data-state="champion">${icon("trophy")}Picked</span></div>
      <div class="output__body">
        ${image && imgs.length ? html`<div class="pair-images">${imgs.map((f, i) => html`<button class="image-card__img ph" type="button" aria-label="${"Enlarge image " + (i + 1) + " of output " + o.label}" @click="${async () => openLightbox(`Output ${o.label}, image ${i + 1}`, await fileUrl(f.url))}">${blobImg(f.url, `Output ${o.label}, image ${i + 1}`, THUMB.card)}<span class="zoom">${icon("enlarge")}</span></button>`)}</div>` : ""}
        ${o.output ? html`<div class="output__text">${o.output}</div>` : imgs.length ? "" : html`<p class="muted small">No text, files only.</p>`}
        ${o.claims_note ? html`<div class="claim"><span class="claim__label">${icon("warning")}The agent's own claim. Audition didn't check it.</span><span class="small">Build, test and lint results in this output are the agent's own claims; Audition did not run them.</span></div>` : ""}
        ${!image && imgs.length ? html`<div class="thumbs">${imgs.map((f, i) => html`<button class="thumb" type="button" aria-label="${"Image " + (i + 1) + " of output " + o.label}" @click="${async () => openLightbox(`Output ${o.label}, image ${i + 1}`, await fileUrl(f.url))}">${blobImg(f.url, `Output ${o.label}, image ${i + 1}`, THUMB.small)}</button>`)}</div>` : ""}
        ${rest.length ? html`<ul class="files">${rest.map((f) => html`<li>${icon("file")}<button class="link-btn" type="button" @click="${async () => { try { const a = document.createElement("a"); a.href = await fileUrl(f.url); a.download = fileLabel(f.name); a.click(); } catch (err) { errorToast(err); } }}">${fileLabel(f.name)}</button></li>`)}</ul>` : ""}
      </div>
    </article>`;
  };

  const current = () => {
    const x = pair();
    const L = byLabel.get(x.left), R = byLabel.get(x.right);
    const btn = (which) => {
      const on = x.pick?.winner === which;
      return html`<button class="${"btn btn--lg" + (on ? " btn--primary" : "")}" type="button" aria-pressed="${on ? "true" : "false"}" disabled="${!x.ready}" @click="${pick(which)}">${which === "tie" ? icon("shuffle") : icon("trophy")}${PICK_TEXT[which](x)}</button>`;
    };
    const aiHist = x.history.find((h) => h.judge_kind === "ai");
    const note = !x.ready
      ? html`<span class="judge-tag">${icon("queued")}One of these outputs isn't in yet.</span>`
      : !x.pick
        ? html`<span class="judge-tag">${icon("draft")}${p.run.judge === "ai" ? "The AI hasn't compared these yet" : "Not decided yet"}</span>`
        : x.pick.judge_kind === "ai"
          ? html`<span class="judge-tag">${icon("ai")}The AI picked: ${PICK_TEXT[x.pick.winner](x)}${x.pick.reason ? html`. <span class="text-2">${x.pick.reason}</span>` : ""}</span>`
          : html`<span class="judge-tag">${icon("me")}Your pick counts${aiHist ? `; the AI had picked: ${PICK_TEXT[aiHist.winner](x)}` : ""}</span>`;
    return html`<section class="pair" aria-label="${"Output " + x.left + " against output " + x.right}">
      <div class="pair__sides">${side(L, "left")}${side(R, "right")}</div>
      <div class="pair__pick">
        <p class="small text-2 row-tight">${icon("judge")}Which is better? <span class="muted">Pair ${j.cur + 1} of ${p.pairs.length}</span></p>
        <div class="row pair__buttons">${btn("left")}${btn("tie")}${btn("right")}</div>
        ${note}
      </div>
    </section>`;
  };

  const [helpBtn, helpPop] = compareScoreHelp();
  const table = html`<div class="panel">
    <div class="panel__head"><h2 class="h-md">${icon("trophy", "gold")}Standings on this task</h2><span class="small">${helpBtn}</span></div>
    ${helpPop}
    <ul class="list standings">${standings.map((o) => html`<li>
      <span class="letter-tile">${o.label}</span>
      <span class="grow small text-2">${o.record.played ? `${plural(o.record.wins, "win")}, ${plural(o.record.ties, "tie")}, ${plural(o.record.losses, "loss", "losses")}` : "Not compared yet"}</span>
      ${top === o ? html`<span class="state" data-state="champion">${icon("trophy")}Best so far</span>` : ""}
      <span class="score">${icon("star")}<span>${o.record.score == null ? "–" : o.record.score.toFixed(1)}</span></span>
    </li>`)}</ul>
  </div>`;

  return html`${head}${rubric}
    <div class="row-tight"><div class="progress progress--short"><span class="p-done" style="${"width:" + (decided() / p.pairs.length) * 100 + "%"}"></span></div><span class="small text-2">${decided()} of ${plural(p.pairs.length, "pair")} decided</span></div>
    ${pairNav}
    ${() => current()}
    ${table}
    <div class="row-between"><span></span><div class="row">
      <a class="btn btn--quiet" href="${APP + "/runs/" + params.run}">Back to run</a>
      ${p.role ? html`<a class="btn" href="${APP + "/leaderboard/" + p.role}">${icon("leaderboard")}See leaderboard</a>` : ""}
    </div></div>`;
}
