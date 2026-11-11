// 11. Copy and paste: copy the prompt, paste it into the tool, paste the reply
// back (with files, and tokens and time if the tool showed them).
import { html, reactive } from "@arrow-js/core";
import { custom, fileLabel, fileUrl, update, upload } from "../api.js";
import { APP, go } from "../lib/nav.js";
import { filePicker, fileIcon, rawFiles } from "../components/forms.js";
import { crumbs, empty, page } from "../components/page.js";
import { avatar, bump, chip, copyText, errorToast, icon, outputChip, toast } from "../lib/ui.js";
import { load, runLabel } from "../state/data.js";
import { inbox, refreshInbox } from "../state/inbox.js";

const LABELS = /^(You are acting as:|Role description:|TASK:|You will be judged on:|Work in the repository|Attached files:|WHEN DONE,?)/;

export default function handoff({ params, query }) {
  return page({
    narrow: true, screen: "handoff",
    load: async (s) => {
      const [d, h, live] = await Promise.all([load("workspaces", "roles", "tasks", "contenders", "runs"), custom.handoff(params.run, params.task), custom.run(params.run)]);
      s.d = d; s.h = h; s.live = live;
      s.f = reactive({ attempt: (h.waiting.find((w) => w.attempt === query.output) || h.waiting[0])?.attempt || null, step: 1, reply: "", files: [], tin: "", tout: "", minutes: "", confirm: false, done: false, sending: false, copied: false });
    },
    body: (s) => {
      const { d, h, live, f } = s;
      const run = live.run;
      const task = d.byId.tasks.get(params.task);
      const role = d.byId.roles.get(run.role);
      const ws = d.byId.workspaces.get(run.workspace);
      const current = () => h.waiting.find((w) => w.attempt === f.attempt);
      const name = () => current()?.contender_name || "the tool";
      const words = () => (f.reply.trim() ? f.reply.trim().split(/\s+/).length : 0);
      const copy = async (e) => {
        const btn = e.currentTarget, block = btn.closest(".copy-block");
        const ok = await copyText(h.prompt, block.querySelector("pre"));
        f.step = Math.max(f.step, 2);
        if (ok) { f.copied = true; block.classList.remove("is-copied"); void block.offsetWidth; block.classList.add("is-copied"); toast(`Prompt copied. Paste it into ${name()}.`, "done", "copy"); setTimeout(() => { f.copied = false; }, 1800); }
        else toast("Selected. Press Ctrl+C or ⌘C to copy.", "done", "copy");
      };
      const submit = async () => {
        f.sending = true;
        try {
          if (f.files.length) await upload("attempts", f.attempt, "output_files", rawFiles(f.files));
          const body = { output: f.reply, status: "submitted" };
          if (f.tin !== "") body.tokens_in = Number(f.tin);
          if (f.tout !== "") body.tokens_out = Number(f.tout);
          if (f.minutes !== "") body.duration_ms = Math.round(Number(f.minutes) * 60000);
          await update("attempts", f.attempt, body);
          f.done = true; f.confirm = false; f.step = 4;
          toast("Output submitted", "done", "send");
          await refreshInbox();
          queueMicrotask(() => document.querySelectorAll("[data-inbox-count]").forEach(bump));
        } catch (err) { errorToast(err); }
        f.sending = false;
      };
      const next = () => h.waiting.find((w) => w.attempt !== f.attempt);
      const stepCls = (n) => () => (f.step > n ? "is-done" : f.step === n ? "is-current" : "");
      const others = live.attempts.filter((a) => a.task === params.task);
      if (!h.waiting.length) {
        return html`${crumbs([["Workspaces", APP + "/"], [ws?.name, APP + "/w/" + run.workspace], [runLabel(d, run), APP + "/runs/" + run.id]])}
          <h1>${task?.title}</h1>
          <div class="panel">${empty("paste-duo", "Nothing left to paste for this task", "Every copy-and-paste contender has sent its reply.", html`<a class="btn btn--primary" href="${APP + "/runs/" + run.id}">Back to the run</a>`)}</div>`;
      }
      return html`
        ${crumbs([["Workspaces", APP + "/"], [ws?.name, APP + "/w/" + run.workspace], [runLabel(d, run), APP + "/runs/" + run.id]])}
        <div class="page-head">
          <div class="row row--center">${() => avatar(name(), "lg")}<div><h1>${() => name()}</h1><p class="muted">${task?.title} · ${role?.name}</p></div></div>
        </div>
        ${h.waiting.length > 1 ? html`<div class="row-tight" role="group" aria-label="Who to paste for">${h.waiting.map((w) => html`<button type="button" class="${() => "btn btn--sm" + (f.attempt === w.attempt ? " btn--primary" : "")}" disabled="${() => f.done}" @click="${() => { f.attempt = w.attempt; }}">${w.contender_name}</button>`)}</div>` : ""}

        <ol class="steps">
          <li class="${stepCls(1)}"><div class="stack-sm minw0">
            <h2>Copy this prompt</h2>
            <p class="small muted">Every contender on this task gets exactly the same text.</p>
            <div class="copy-block">
              <div class="copy-block__bar"><span class="row-tight">${icon("file")}Prompt · ${h.prompt.split("\n").length} lines</span>
                <button class="${() => "btn btn--sm" + (f.copied ? " is-success" : "")}" type="button" @click="${copy}">${() => icon(f.copied ? "check" : "copy")}<span>${() => (f.copied ? "Copied" : f.step > 1 ? "Copy again" : "Copy prompt")}</span></button></div>
              <pre data-testid="prompt">${h.prompt.split("\n").map((line, i) => { const m = line.match(LABELS); return html`${i ? "\n" : ""}${m ? html`<b>${m[0]}</b>${line.slice(m[0].length)}` : line}`; })}</pre>
            </div>
            ${h.attachments?.length ? html`<div class="stack-sm"><span class="small"><strong>Attach these files too</strong></span><ul class="files">${h.attachments.map((a) => html`<li>${icon(fileIcon(a.name))}<button class="link-btn" type="button" @click="${async () => { try { const u = await fileUrl(a.url); const el = document.createElement("a"); el.href = u; el.download = fileLabel(a.name); el.click(); } catch (err) { errorToast(err); } }}">${fileLabel(a.name)}</button></li>`)}</ul></div>` : ""}
          </div></li>
          <li class="${stepCls(2)}"><div class="stack-sm">
            <h2>${() => "Paste it into " + name()}</h2>
            <p class="small muted">Start a new chat or session so nothing earlier affects the answer.</p>
          </div></li>
          <li class="${stepCls(3)}"><form class="stack minw0" @submit="${(e) => { e.preventDefault(); f.confirm = true; }}">
            <h2>Paste the reply here</h2>
            <div class="field"><label for="ho-reply">Reply</label><textarea class="textarea" id="ho-reply" rows="7" placeholder="Paste the whole reply" readonly="${() => f.done}" @focus="${() => { if (!f.reply) f.step = 3; }}" @input="${(e) => { f.reply = e.target.value; if (f.reply) f.step = 3; }}"></textarea><span class="hint">${() => (words() ? words() + " words pasted" : "Nothing pasted yet")}</span></div>
            <div class="field"><span class="label">Files <span class="muted">(optional)</span></span>${filePicker({ id: "ho-files", state: f, disabled: () => f.done })}</div>
            <details>
              <summary class="small row-tight summary-link">${icon("caret-right")}Add tokens and time <span class="muted">optional, if the tool showed them</span></summary>
              <div class="fields-2 mt-3">
                <div class="field"><label for="ho-tin">Tokens in</label><input class="input num" id="ho-tin" inputmode="numeric" @input="${(e) => { f.tin = e.target.value; }}"></div>
                <div class="field"><label for="ho-tout">Tokens out</label><input class="input num" id="ho-tout" inputmode="numeric" @input="${(e) => { f.tout = e.target.value; }}"></div>
                <div class="field"><label for="ho-time">Minutes taken</label><input class="input num" id="ho-time" inputmode="decimal" @input="${(e) => { f.minutes = e.target.value; }}"></div>
              </div>
            </details>
            ${() => (f.confirm ? html`<div class="notice" data-state="warning">${icon("warning")}<div class="grow stack-sm"><p><strong>Submit this output?</strong> You can't change it afterwards. Use Run again if you want a fresh one.</p>
              <div class="row"><button class="${() => "btn btn--primary" + (f.sending ? " is-loading" : "")}" type="button" @click="${submit}">${icon("send")}Yes, submit</button><button class="btn btn--quiet" type="button" @click="${() => { f.confirm = false; }}">Keep editing</button></div></div></div>` : "")}
            ${() => (f.done ? html`<div class="notice" data-state="done">${icon("done")}<div class="stack-sm"><p><strong>Submitted.</strong> ${run.judge === "ai" ? "The AI judge picks it up next." : "It's ready for you to judge."}</p>
              <div class="row">${next() ? html`<button class="btn btn--primary btn--sm" type="button" @click="${() => go("/handoff/" + run.id + "/" + params.task, { output: next().attempt, t: Date.now() })}">${icon("paste")}Next: ${next().contender_name}</button>` : inbox.items[0] ? html`<a class="btn btn--primary btn--sm" href="${itemHref0()}">${icon("arrow-right")}Next thing waiting</a>` : ""}<a class="btn btn--sm btn--quiet" href="${APP + "/runs/" + run.id}">Back to the run</a></div></div></div>` : "")}
            ${() => (!f.confirm && !f.done ? html`<div class="row"><span data-tip="${() => (words() || f.files.length ? "" : "Paste the reply first")}" tabindex="0"><button class="btn btn--primary btn--lg" type="submit" disabled="${() => !words() && !f.files.length}">${icon("send", "i--lift")}Submit output</button></span></div>` : "")}
          </form></li>
        </ol>

        ${others.length > 1 ? html`<div class="panel">
          <div class="panel__head"><h2 class="h-md">${icon("contenders")}Same prompt, other contenders</h2></div>
          <ul class="list">${others.filter((a) => a.id !== f.attempt).map((a) => { const n = d.byId.contenders.get(a.contender)?.name || "Contender"; return html`<li><span class="who grow">${avatar(n, "sm")}${n}</span>${a.status === "waiting" ? chip("waiting", "Waiting for you") : a.status === "submitted" || a.status === "judged" ? chip("done", "Submitted") : outputChip(a.status, run.judge)}</li>`; })}</ul>
        </div>` : ""}`;
    },
  });
}

const itemHref0 = () => { const g = inbox.items[0]; return g.kind === "paste" ? `${APP}/handoff/${g.run}/${g.task}` : `${APP}/judge/${g.run}/${g.task}`; };
