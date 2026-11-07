// 6. Task (and "New task"). A task used in a run is read-only; "Duplicate and
// edit" turns it into an editable next version (previous_version links them).
import { html, reactive } from "@arrow-js/core";
import { create, fileLabel, fileUrl, remove, update, upload } from "../api.js";
import { go } from "../router.js";
import { filePicker, fileIcon, seg } from "../components/forms.js";
import { busy, crumbs, page } from "../components/page.js";
import { TYPE_ICON, TYPE_LABEL, chip, errorToast, htmlToText, icon, textToHtml, toast } from "../lib/ui.js";
import { load } from "../state/data.js";
import { versionOf } from "./role.js";

const TYPES = ["text", "image", "file", "code"].map((t) => ({ value: t, label: TYPE_LABEL[t], icon: TYPE_ICON[t] }));

export default function task({ params }) {
  const isNew = !params.id;
  return page({
    narrow: true, screen: "task",
    load: async (s) => {
      s.d = await load("workspaces", "roles", "tasks");
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
      });
    },
    body: (s) => {
      const { d, t, role, ws, f } = s;
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
        try {
          let rec;
          if (f.draft) rec = await create("tasks", { ...body, previous_version: t.id });
          else if (t) rec = await update("tasks", t.id, body);
          else rec = await create("tasks", body);
          const files = [...f.files];
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
      const open = async (name) => { try { const url = await fileUrl(name); const a = document.createElement("a"); a.href = url; a.download = fileLabel(name); a.click(); } catch (err) { errorToast(err); } };
      return html`
        ${crumbs([[ws.name, "#/w/" + ws.id], [role.name, "#/r/" + role.id], t ? "Task" : "New task"])}
        <div class="page-head">
          <div><h1>${t ? t.title : "New task"}</h1>
            <p class="lede row-tight">${() => (f.draft ? html`<span class="badge">Version ${version + 1}</span>${chip("draft", `Draft, copied from version ${version}`)}` : t ? html`<span class="badge">Version ${version}</span>${t.locked ? chip("locked", "Read-only") : ""}` : "Every contender gets exactly this text, with the role and rubric around it.")}</p></div>
        </div>
        ${() => (t?.locked && !f.draft ? html`<div class="notice" data-state="locked">${icon("locked")}<div class="grow stack-sm"><p><strong>This task was used in a run, so it can't change.</strong> That keeps every score comparable.</p>${newer ? html`<p class="small">A newer version exists: <a href="${"#/t/" + newer.id}">${newer.title}</a></p>` : html`<div><button class="btn btn--primary" type="button" @click="${duplicate}">${icon("copy")}Duplicate and edit</button></div>`}</div></div>` : "")}
        ${() => (f.draft ? html`<div class="notice" data-state="done">${icon("edit")}<div class="grow"><strong>You're editing version ${version + 1}.</strong> Version ${version} and its results stay exactly as they were. Runs from now on can use version ${version + 1}.</div></div>` : "")}
        <form class="stack" @submit="${save}">
          <div class="field"><label for="tk-title">Title</label><input class="input" id="tk-title" required value="${f.title}" readonly="${ro}" @input="${(e) => { f.title = e.target.value; }}" placeholder="Build the settings screen"></div>
          <div class="field"><label for="tk-prompt">What to do</label>
            <textarea class="textarea" id="tk-prompt" rows="6" required readonly="${ro}" value="${f.prompt}" @input="${(e) => { f.prompt = e.target.value; }}"></textarea>
            <span class="hint">Every contender gets exactly this text, with the role and rubric around it.</span></div>
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
            ${() => (f.editing ? filePicker({ id: "tk-files", files: f.files }) : "")}
          </div>
          ${() => (f.editing ? html`<div class="row"><button class="btn btn--primary btn--lg" type="submit">${icon("check")}${f.draft ? `Save version ${version + 1}` : t ? "Save task" : "Add task"}</button>
            <a class="btn btn--quiet" href="${"#/r/" + role.id}">Cancel</a>
            ${t && !t.locked ? html`<button class="btn btn--quiet" type="button" @click="${del}">${icon("trash")}Delete</button>` : ""}</div>` : "")}
        </form>`;
    },
  });
}
