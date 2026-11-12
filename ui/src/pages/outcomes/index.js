// Outcome checks (docs/PHASE-2A.md, part 3): calls whose outcome is now due.
// One question per output, "Was the call right?", 1 to 5 stars and a note.
// Blind like judging: the output, never who made it.
import { html, reactive } from "@arrow-js/core";
import { custom, fileUrl } from "../../api.js";
import { APP } from "../../lib/nav.js";
import { busy, crumbs, empty, page } from "../../components/page.js";
import { starInput, starsView } from "../../components/forms.js";
import { date, errorToast, icon, plural, toast } from "../../lib/ui.js";
import { refreshInbox } from "../../state/inbox.js";

export const meta = { title: "Outcome checks · Audition" };

export default function outcomes() {
  return page({
    screen: "outcomes",
    load: async (s) => {
      const r = await custom.outcomes();
      s.due = r.due || [];
      s.f = reactive(Object.fromEntries(s.due.map((o) => [o.id, { stars: 0, note: "", saved: false }])));
    },
    body: (s) => {
      const left = () => s.due.filter((o) => !s.f[o.id].saved).length;
      return html`
        ${crumbs([["Workspaces", APP + "/"], "Outcome checks"])}
        <div class="page-head"><div><h1>Outcome checks</h1>
          <p class="lede">These calls were judged earlier, and now enough time has passed to see how they turned out. Was the call right? Your stars show in their own column on the leaderboard and don't change the quality score.</p></div></div>
        <div class="blind-banner">${icon("blind")}<span>Names are hidden, so you check the call, not who made it.</span></div>
        ${s.due.length
          ? html`<p class="small muted">${() => (left() ? plural(left(), "check") + " to go" : "All done for now.")}</p>
            <div class="stack">${s.due.map((o) => card(s, o))}</div>`
          : empty("time", "No outcome checks due", "When a role checks outcomes, each judged output comes back here on its due date.")}`;
    },
  });
}

function card(s, o) {
  const x = s.f[o.id];
  const save = (e) => busy(e, async () => {
    if (!x.stars) { toast("Give 1 to 5 stars first", "error", "warning"); return; }
    try {
      await custom.scoreOutcome(o.id, { stars: x.stars, note: x.note });
      x.saved = true;
      toast("Outcome saved", "done", "check");
      refreshInbox();
    } catch (err) { errorToast(err); }
  });
  return html`<article class="panel" id="${"o-" + o.id}" data-outcome="${o.id}">
    <div class="panel__head"><div class="stack-sm gap-2"><h2 class="h-md">${o.task_title}</h2>
      <span class="small muted row-tight"><span>${icon("workspaces")}${o.workspace_name} · ${o.role_name}</span><span>${icon("time")}Due ${date(o.due_at)}</span>${o.judged_score != null ? html`<span>Judged then: ${starsView(Math.round(o.judged_score))} ${o.judged_score.toFixed(1)}</span>` : ""}</span></div></div>
    <div class="panel__body">
      ${o.output ? html`<div class="output__text">${o.output}</div>` : html`<p class="muted small">No text, files only.</p>`}
      ${o.files.length ? html`<ul class="files">${o.files.map((f) => html`<li>${icon(f.is_image ? "image" : "file")}<button class="link-btn" type="button" @click="${async () => { try { const a = document.createElement("a"); a.href = await fileUrl(f.url); a.download = f.name; a.click(); } catch (err) { errorToast(err); } }}">${f.name}</button></li>`)}</ul>` : ""}
      ${() => (x.saved
        ? html`<p class="row-tight">${icon("done")}<strong>Saved:</strong> ${starsView(x.stars)}${x.note ? html`<span class="muted small">${x.note}</span>` : ""}</p>`
        : html`<div class="crit"><span class="crit__name">Was the call right?</span>${starInput({ name: "oc" + o.id, label: "Was the call right?", value: () => x.stars, onChange: (v) => { x.stars = v; } })}</div>
          <div class="field"><label for="${"on-" + o.id}">Note (optional)</label><input class="input" id="${"on-" + o.id}" maxlength="300" value="${x.note}" @input="${(e) => { x.note = e.target.value; }}" placeholder="The price fell 12%, so sell was right"></div>
          <div><button class="btn btn--primary" type="button" @click="${save}">${icon("check")}Save outcome</button></div>`)}
    </div>
  </article>`;
}
