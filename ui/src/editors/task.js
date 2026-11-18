// 6. Task (and "New task"). A task used in a run is read-only; "Duplicate and
// edit" turns it into an editable next version (previous_version links them).
import { html, reactive } from "@arrow-js/core";
import { create, custom, fileLabel, fileUrl, one, remove, update, upload } from "../api.js";
import { APP, go } from "../lib/nav.js";
import { filePicker, fileIcon, rawFiles, seg } from "../components/forms.js";
import { busy, crumbs, page } from "../components/page.js";
import { TYPE_ICON, TYPE_LABEL, chip, errorToast, htmlToText, icon, money, num, textToHtml, toast } from "../lib/ui.js";
import { subscribe } from "../lib/realtime.js";
import { load } from "../state/data.js";
import { versionOf } from "./role.js";

const TYPES = ["text", "image", "file", "code"].map((t) => ({ value: t, label: TYPE_LABEL[t], icon: TYPE_ICON[t] }));

export default function task({ params }) {
  const isNew = !params.id;
  return page({
    narrow: true, screen: "task",
    load: async (s) => {
      s.d = await load("workspaces", "roles", "tasks", "contenders");
      const t = isNew ? null : s.d.byId.tasks.get(params.id);
      if (!isNew && !t) throw new Error("This task doesn't exist any more.");
      s.t = t;
      s.role = s.d.byId.roles.get(isNew ? params.role : t.role);
      if (!s.role) throw new Error("This role doesn't exist any more.");
      s.ws = s.d.byId.workspaces.get(s.role.workspace);
      s.f = reactive({
        editing: isNew || !t.locked, draft: false,
        title: t?.title || "", prompt: htmlToText(t?.prompt), output_type: t?.output_type || s.role.default_output_type || "text",
        repo: t?.base_ref?.repo || "", commit: t?.base_ref?.commit || "", files: [], keep: [...(t?.attachments || [])],
        // The Composer (TECH-SPEC §9a): its draft, as the owner edits it, and its status.
        composed: t?.composed_prompt || "", compose: t?.compose || null,
      });
      // While the Composer writes, follow the task live (realtime, polling as the fallback).
      let stop = null, timer = null;
      const settle = (rec) => {
        if (!rec) return;
        s.f.compose = rec.compose || null;
        if (rec.compose?.status !== "composing") {
          if (rec.compose?.status === "done") { s.f.composed = rec.composed_prompt || ""; toast("The Composer wrote the prompt. Read it, then save.", "done", "sparkle"); }
          s.unwatch();
        }
      };
      const fetchNow = async () => { try { settle(await one("tasks", t.id)); } catch { /* keep waiting */ } };
      s.unwatch = () => { stop?.(); stop = null; clearInterval(timer); timer = null; };
      s.watch = () => {
        if (stop || !t) return;
        let mode = "off";
        stop = subscribe([`tasks/${t.id}`], { onEvent: (m) => settle(m.record), onStatus: (st) => { mode = st; if (st === "live") fetchNow(); } });
        timer = setInterval(() => { if (mode !== "live") fetchNow(); }, 2000);
      };
      if (s.f.compose?.status === "composing") s.watch();
      s.onLeave(() => s.unwatch());
    },
    body: (s) => {
      const { d, t, role, ws, f } = s;
      const composer = ws.composer_contender ? d.byId.contenders.get(ws.composer_contender) : null;
      const composing = () => f.compose?.status === "composing";
      const version = t ? versionOf(d, t) : 1;
      const ro = () => !f.editing;
      const newer = t && d.tasks.find((n) => n.previous_version === t.id);
      const duplicate = () => {
        f.editing = true; f.draft = true;
        requestAnimationFrame(() => document.getElementById("tk-prompt")?.focus());
      };
      const save = (e) => busy(e, async () => {
        e.preventDefault();
        const body = {
          role: role.id, title: f.title.trim(), prompt: textToHtml(f.prompt), output_type: f.output_type,
          base_ref: f.repo.trim() ? { repo: f.repo.trim(), commit: f.commit.trim() } : null,
        };
        // The composed prompt is saved with the task (and carried into a new version); not while the Composer writes it.
        if (t && !composing()) body.composed_prompt = f.composed.trim() || null;
        try {
          let rec;
          if (f.draft) rec = await create("tasks", { ...body, previous_version: t.id });
          else if (t) rec = await update("tasks", t.id, body);
          else rec = await create("tasks", body);
          const files = rawFiles(f.files);
          if (f.draft) for (const name of f.keep) { const blob = await (await fetch(await fileUrl(name))).blob(); files.push(new File([blob], fileLabel(name))); }
          else if (t && f.keep.length !== (t.attachments || []).length) rec = await update("tasks", rec.id, { attachments: [...f.keep] });
          if (files.length) {
            try { await upload("tasks", rec.id, "attachments", files); } catch (err) { toast(`Saved, but the files didn't upload: ${err.message}`, "error", "warning"); }
          }
          toast(f.draft ? `Version ${version + 1} saved` : t ? "Task saved" : "Task added");
          go("/t/" + rec.id);
          if (t && !f.draft) s.reload({ quiet: true });
        } catch (err) { errorToast(err); }
      });
      const del = (e) => busy(e, async () => {
        if (!confirm(`Delete the task "${t.title}"?`)) return;
        try { await remove("tasks", t.id); toast("Task deleted"); go("/r/" + role.id); } catch (err) { errorToast(err); }
      });
      // Compose: save what's on screen first, so the Composer reads the task as you see it.
      const composeNow = (e) => busy(e, async () => {
        try {
          if (f.editing && !f.draft) {
            if (!f.title.trim() || !f.prompt.trim()) { toast("Give the task a title and some text first", "error", "warning"); return; }
            await update("tasks", t.id, { title: f.title.trim(), prompt: textToHtml(f.prompt), output_type: f.output_type, base_ref: f.repo.trim() ? { repo: f.repo.trim(), commit: f.commit.trim() } : null, composed_prompt: f.composed.trim() || null });
          }
          const r = await custom.compose(t.id);
          f.compose = r.task?.compose || { status: "composing" };
          s.watch();
        } catch (err) { errorToast(err); }
      });
      const usePlain = (e) => busy(e, async () => {
        if (f.draft) { f.composed = ""; return; }
        try { await update("tasks", t.id, { composed_prompt: null }); f.composed = ""; toast("Contenders will get the plain prompt"); } catch (err) { errorToast(err); }
      });
      const composeMeta = () => {
        const c = f.compose;
        if (!c || c.status !== "done" || !f.composed) return "";
        const who = d.byId.contenders.get(c.contender)?.name || "the Composer";
        const tokens = c.tokens_in != null || c.tokens_out != null ? ` · ${num(c.tokens_in)} tokens in, ${num(c.tokens_out)} out` : "";
        return `Written by ${who}${tokens} · cost ${money(c.cost)}`;
      };
      // One template with reactive slots and hidden parts (Arrow recycles templates by shape, NOTES QC1).
      const showPanel = () => !!t && (f.editing || !!f.composed);
      const promptPanel = html`<div class="panel" data-testid="prompt-panel" hidden="${() => !showPanel()}">
        <div class="panel__head"><h2>${icon("sparkle")}Prompt the contenders get</h2>
          ${() => (composing() ? chip("active", "Composing") : f.composed ? chip("done", "Composed") : chip("draft", "Plain"))}</div>
        <div class="panel__body">
          <p class="small text-2" hidden="${() => !!f.composed || composing()}">Every contender gets your text above, with the role, the rubric and how to reply around it.${composer ? "" : " To have an AI write a sharper prompt first, pick a Composer in the "}${composer ? "" : html`<a href="${APP + "/w/" + ws.id + "/settings"}">workspace settings</a>.`}</p>
          <div class="notice" data-state="active" hidden="${() => !composing()}">${icon("spinner")}<div class="small"><strong>${composer?.name || "The Composer"} is writing the prompt.</strong> It usually takes under a minute. You can leave this page; the prompt is saved on the task.</div></div>
          <div class="notice" data-state="error" hidden="${() => f.compose?.status !== "failed"}">${icon("error")}<div class="small"><strong>The Composer couldn't write it.</strong> ${() => f.compose?.error || ""}</div></div>
          <div class="field" hidden="${() => !f.composed}">
            <label for="tk-composed">Composed prompt</label>
            <textarea class="textarea" id="tk-composed" rows="14" readonly="${() => ro() || composing()}" value="${() => f.composed}" @input="${(e) => { f.composed = e.target.value; }}"></textarea>
            <span class="hint">${() => (f.draft ? `Copied from version ${version}. Edit it with the task, or compose again once version ${version + 1} is saved.` : ro() ? "Every contender got exactly this text." : "Edit it freely, then save the task. Every contender gets exactly this text instead of the plain prompt.")}</span>
            <span class="xs muted" data-testid="compose-meta">${composeMeta}</span>
          </div>
          <div class="row" hidden="${() => ro()}">
            ${composer ? html`<button class="btn" type="button" id="tk-compose" hidden="${() => f.draft}" disabled="${composing}" @click="${composeNow}">${icon("sparkle")}${() => (f.composed ? "Compose again" : "Compose with " + composer.name)}</button>` : ""}
            <button class="btn btn--quiet" type="button" hidden="${() => !f.composed || composing()}" @click="${usePlain}">${icon("close")}Use the plain prompt</button>
          </div>
        </div>
      </div>`;
      const open = async (name) => { try { const url = await fileUrl(name); const a = document.createElement("a"); a.href = url; a.download = fileLabel(name); a.click(); } catch (err) { errorToast(err); } };
      return html`
        ${crumbs([[ws.name, APP + "/w/" + ws.id], [role.name, APP + "/r/" + role.id], t ? "Task" : "New task"])}
        <div class="page-head">
          <div><h1>${t ? t.title : "New task"}</h1>
            <p class="lede row-tight">${() => (f.draft ? html`<span class="badge">Version ${version + 1}</span>${chip("draft", `Draft, copied from version ${version}`)}` : t ? html`<span class="badge">Version ${version}</span>${t.locked ? chip("locked", "Read-only") : ""}` : "Every contender gets exactly this text, with the role and rubric around it.")}</p></div>
        </div>
        ${() => (t?.locked && !f.draft ? html`<div class="notice" data-state="locked">${icon("locked")}<div class="grow stack-sm"><p><strong>This task was used in a run, so it can't change.</strong> That keeps every score comparable.</p>${newer ? html`<p class="small">A newer version exists: <a href="${APP + "/t/" + newer.id}">${newer.title}</a></p>` : html`<div><button class="btn btn--primary" type="button" @click="${duplicate}">${icon("copy")}Duplicate and edit</button></div>`}</div></div>` : "")}
        ${() => (f.draft ? html`<div class="notice" data-state="done">${icon("edit")}<div class="grow"><strong>You're editing version ${version + 1}.</strong> Version ${version} and its results stay exactly as they were. Runs from now on can use version ${version + 1}.</div></div>` : "")}
        <form class="stack" @submit="${save}">
          <div class="field"><label for="tk-title">Title</label><input class="input" id="tk-title" required value="${f.title}" readonly="${ro}" @input="${(e) => { f.title = e.target.value; }}" placeholder="Build the settings screen"></div>
          <div class="field"><label for="tk-prompt">What to do</label>
            <textarea class="textarea" id="tk-prompt" rows="6" required readonly="${ro}" value="${f.prompt}" @input="${(e) => { f.prompt = e.target.value; }}"></textarea>
            <span class="hint">${() => (f.composed ? "The composed prompt below is what contenders get. Compose again after you change this text." : "Every contender gets exactly this text, with the role and rubric around it.")}</span></div>
          <div class="field"><span class="label" id="tk-type-label">The output is</span>
            ${seg({ name: "tk-type", labelId: "tk-type-label", options: TYPES, value: () => f.output_type, onChange: (v) => { f.output_type = v; }, disabled: ro })}</div>
          <div class="panel"><div class="panel__body">
            <p class="small"><strong>Starting point</strong> <span class="muted">Optional. For code: every contender starts from the same commit.</span></p>
            <div class="fields-2">
              <div class="field"><label for="tk-repo">Repository</label><div class="input-group">${icon("branch")}<input class="input" id="tk-repo" value="${f.repo}" readonly="${ro}" @input="${(e) => { f.repo = e.target.value; }}" placeholder="github.com/you/repo"></div></div>
              <div class="field"><label for="tk-commit">Commit</label><div class="input-group">${icon("commit")}<input class="input" id="tk-commit" value="${f.commit}" readonly="${ro}" @input="${(e) => { f.commit = e.target.value; }}" placeholder="a1b2c3d"></div></div>
            </div>
          </div></div>
          <div class="field"><span class="label">Attachments</span>
            ${() => (f.keep.length ? html`<ul class="files">${f.keep.map((n, i) => html`<li>${icon(fileIcon(n))}<button class="link-btn" type="button" @click="${() => open(n)}">${fileLabel(n)}</button>${f.editing && !f.draft ? html`<button class="icon-btn icon-btn--xs" type="button" aria-label="${"Remove " + fileLabel(n)}" @click="${() => f.keep.splice(i, 1)}">${icon("close")}</button>` : ""}</li>`)}</ul>` : html`<span class="small muted">${f.editing ? "None yet." : "None."}</span>`)}
            ${() => (f.editing ? filePicker({ id: "tk-files", state: f }) : "")}
          </div>
          ${promptPanel}
          ${() => (f.editing ? html`<div class="row"><button class="btn btn--primary btn--lg" type="submit">${icon("check")}${f.draft ? `Save version ${version + 1}` : t ? "Save task" : "Add task"}</button>
            <a class="btn btn--quiet" href="${APP + "/r/" + role.id}">Cancel</a>
            ${t && !t.locked ? html`<button class="btn btn--quiet" type="button" @click="${del}">${icon("trash")}Delete</button>` : ""}</div>` : "")}
        </form>`;
    },
  });
}
