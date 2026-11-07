// 12 and 13. Blind judging, side by side (text and code) or as an image grid.
// This module reads only the blind route, GET /api/custom/judging/:run/:task
// (TECH-SPEC §10), and writes owner verdicts. It never asks for contender
// records or raw outputs, so nothing here can reveal who made what
// (test/ui.test.ts checks this file).
import { html, reactive } from "@arrow-js/core";
import { create, custom, fileLabel, fileUrl } from "../api.js";
import { starInput } from "../components/forms.js";
import { busy, crumbs, empty, page } from "../components/page.js";
import { bump, chip, errorToast, icon, openLightbox, popId, toast } from "../lib/ui.js";
import { refreshInbox } from "../state/inbox.js";

const weighted = (rubric, stars) => {
  let sum = 0, w = 0;
  for (const c of rubric) { if (!stars[c.name]) return null; sum += stars[c.name] * c.weight; w += c.weight; }
  return w ? Math.round((sum / w) * 100) / 100 : null;
};

export default function judge({ params }) {
  return page({
    screen: "judge",
    load: async (s) => {
      const p = await custom.judging(params.run, params.task);
      s.p = p;
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
      const out = (o) => j.outs.find((x) => x.id === o.attempt);
      const score = (o) => weighted(p.rubric, out(o).stars);
      const save = async (list) => {
        for (const o of list) {
          const st = out(o).stars;
          await create("verdicts", { attempt: o.attempt, scores: Object.fromEntries(p.rubric.map((c) => [c.name, { stars: st[c.name], reason: "" }])) });
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
        return html`${imgs.length ? html`<div class="thumbs">${imgs.map((f, i) => html`<button class="thumb" type="button" aria-label="${"Image " + (i + 1) + " of output " + o.label}" @click="${async () => openLightbox(`Output ${o.label}, image ${i + 1}`, await fileUrl(f.url))}">${blobImg(f.url, `Output ${o.label}, image ${i + 1}`)}</button>`)}</div>` : ""}
          ${rest.length ? html`<ul class="files">${rest.map((f) => html`<li>${icon("file")}<button class="link-btn" type="button" @click="${async () => { try { const a = document.createElement("a"); a.href = await fileUrl(f.url); a.download = fileLabel(f.name); a.click(); } catch (err) { errorToast(err); } }}">${fileLabel(f.name)}</button></li>`)}</ul>` : ""}`;
      };
      const scoreEl = (o) => html`<span class="score" data-score="${o.label}">${icon("star")}<span>${() => { const v = score(o); return v == null ? "–" : v.toFixed(1); }}</span></span>`;

      const head = html`
        ${crumbs([["Workspaces", "#/"], ["Back to the run", "#/runs/" + params.run], "Judging"])}
        <div class="page-head"><div><h1>${p.task.title}</h1>
          <p class="lede">${p.run.judge === "ai" ? "The AI judges these. Change any stars you disagree with; your stars then count." : image ? "You are the judge. Tap an image to see it large." : "You are the judge. Give each line 1 to 5 stars."}</p></div></div>
        <div class="blind-banner">${icon("blind")}<span>Names are hidden and the order is shuffled.</span></div>`;
      if (!p.outputs.length) return html`${head}<div class="panel">${empty("judge-duo", "Nothing to judge yet", "Outputs appear here as they come in.", html`<a class="btn btn--primary" href="${"#/runs/" + params.run}">Back to the run</a>`)}</div>`;

      const rubric = html`<details class="panel" open>
        <summary class="panel__head summary-plain"><h2 class="h-md">${icon("rubric")}Rubric</h2>${p.pass_mark ? html`<span class="muted small row-tight">${icon("pass-mark")}Pass mark ${p.pass_mark}</span>` : ""}</summary>
        <div class="panel__body rubric-legend">${p.rubric.map((c) => html`<div><strong>${c.name} <span class="weight">${c.weight}%</span></strong><span class="muted">${c.guidance || ""}</span></div>`)}</div>
      </details>`;
      const saveBar = html`<div class="row-between">
        <p class="small text-2 row-tight">${icon("trophy", "gold")}${() => { const b = best(); return b ? html`Best on this task: <strong>Output ${b.o.label} · ${b.sc.toFixed(1)}</strong>` : "Rate the outputs to see the best one."; }}</p>
        <div class="row">
          ${() => (pending() ? html`<button class="btn btn--primary btn--lg" type="button" @click="${saveAll}">${icon("check")}Save stars</button>` : "")}
          <a class="btn btn--quiet" href="${"#/runs/" + params.run}">Back to run</a>
          ${p.role ? html`<a class="btn" href="${"#/leaderboard/" + p.role}">${icon("leaderboard")}See leaderboard</a>` : ""}
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
                ${first ? blobImg(first.url, `Output ${o.label}`) : html`<span class="muted small">No image</span>`}
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

/** An <img> whose protected file is fetched with the owner's token. */
function blobImg(url, alt) {
  const st = reactive({ src: "" });
  fileUrl(url).then((u) => { st.src = u; }).catch(() => {});
  return html`<img class="art" alt="${alt}" decoding="async" src="${() => st.src || false}">`;
}
