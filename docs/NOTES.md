# Audition — Notes

Decisions, findings and answers that feed `docs/SPEC.md`. The spec stays the source of truth. The Requirements thread folds these decisions into it through a PR.

## Interview decisions (Nov 5, 2026)

Interview with Cas, run one topic at a time. Partway through, Cas asked to step back and avoid complexity, so Phase 1 shrank to a lean core. The decisions are grouped by topic and numbered, and a later decision that replaces an earlier one says so.

### 1. Phase 1 goal and scope

Phase 1 goal, in Cas's words: create a workspace (e.g. Software Factory); define stages, roles and tasks for roles; pick one or more contenders, each linked to a connected model, agent, harness or app; judge the competing outputs to find the best contender per role. Keep it simple, including for non-technical users.

- **D1.1 Manual return for non-API contenders.** Audition shows the prompt to copy. You paste the result back or upload files. Phase 1 has no report tokens and no agent self-report.
- **D1.2 Generic handoff template only.** One copy-ready block: role context, the task prompt (naming the repo and commit when relevant), the rubric, and "when done, reply with…" instructions. The prompt is identical for every contender on a task. The coding-harness and app templates are deferred. Example: `prompt-examples.md` in the project files (interview folder).
- **D1.3 Check results travel in the output.** For code and UI tasks, the generic template asks the agent to include build, test and lint results and screenshots in its reply. You paste the reply and upload the screenshots. The judging screen shows text and images together. These results are the agent's own claim, because Audition runs no checks.
- **D1.4 Phase 2 fields exist from T0.** T0 creates the later-phase fields as nullable and unused in Phase 1, so later phases add behaviour without a schema change: `workspaces.composer_contender`, `tasks.composed_prompt`, `runs.schedule`, verdict methods `pairwise` and `outcome`, and `verdicts.opponent`, `winner` and `due_at`.
- **D1.5 Deferred from Phase 1:** report tokens and agent self-report; the coding-harness and app templates; platform-run objective checks and screenshot capture; pairwise (A-vs-B) judging (see D3.1); MCP, including MCP reads of castings (an earlier decision to ship three MCP tools is withdrawn); the stale-attempt cron; direct image-generation APIs (see D5.2).
- **D1.6 Real-provider check.** Phase 1's final check with a real key uses **Anthropic**. You run it on your own machine, outside any Claude session, after T5 merges. Providers stay configurable: you add connections in the UI, and T1 builds the Anthropic, OpenAI-compatible and mock adapters. No thread ever uses a real key.

### 2. Records, versioning and runs

- **D2.1 How the records relate.** A workspace holds stages (optional), a stage holds roles, and a role owns the rubric and holds tasks. Separately, a connection (provider plus credential, or "Manual") holds contenders. A run is one role, some of its tasks and some contenders. It creates one attempt per task × contender. Verdicts judge attempts, and the leaderboard rolls verdicts up per role × contender. A casting (champion) is the contender you confirm for a role. Contenders are picked per run, not attached to tasks.
- **D2.2 A contender is an exact configuration.** Connection plus model plus settings (reasoning level, temperature, system prompt, token limit). "Opus 5.5 High 0.6" and "Opus 5.5 Medium 0.2" are two contenders, and the same applies to agents and apps ("Claude Code, Opus, plan mode"). Contenders have friendly names, and the leaderboard can group rows by model. Connections and contenders are global, shared across workspaces. That was my recommendation, and Cas didn't object.
- **D2.3 Used records are read-only.** Once a task or contender has been in a run, it can't be edited. "Duplicate and edit" creates a new version. Role rubrics can change, but each verdict stores a snapshot of the rubric it was scored against.
- **D2.4 No repetitions field. "Run again" instead.** A finished run has a "Run again" button that creates a new run with the same role, tasks and contenders. Reruns add outputs and never overwrite. The leaderboard averages every scored output, and the minimum-output rule (D3.5) guards against a single lucky result. This replaces an earlier "default 1, max 5" decision and the spec's `runs.repetitions` and `attempts.repetition`.
- **D2.5 UI wording.** Screens say "outputs". "Attempt" stays the internal record name.

### 3. Judging and champions

- **D3.1 Rubric scoring is the only method in Phase 1.** Each role has a few criteria with weights. The judge gives each output 1 to 5 stars per criterion, and Audition computes the weighted score. Pairwise judging is dropped from Phase 1.
- **D3.2 One judging screen per task.** The screen shows all the outputs for a task side by side, unlabelled and shuffled ("Output A, B, C"), and each gets stars per criterion. The best output is the highest score. The blind rule holds: the data behind this screen never includes contender fields.
- **D3.3 One judge per run: "Me" or "AI".** The AI judge is a contender chosen in workspace settings. It gives stars plus a one-line reason per criterion. The spec's same-provider warning stays.
- **D3.4 The owner can always override.** On any output the AI judged, you can change the stars. Your scores then count, and the AI's stay in the history.
- **D3.5 Champion suggestion.** The leaderboard averages each contender's scores per role across all runs. A contender needs a minimum number of scored outputs (default 5, set per workspace) and an average above the role's pass mark. The best such contender is marked "Suggested champion", and you confirm it. Below the minimum, the leaderboard shows "not enough data yet".
- **D3.6 Confidence ranges stay** on the leaderboard, next to the number of outputs.
- **D3.7 Fitness stays, with partial data handled.** Fitness weighs quality against tokens and time taken, with weights set per workspace (default: quality only). A tokens or time term applies only when every contender in the role has that data. Otherwise fitness falls back to the terms that are available, and the leaderboard says so.

### 4. Users, tokens and files

- **D4.1 Single owner.** Audition isn't multi-tenant. Phase 1 has one owner account (MFA available) and no other logins.
- **D4.2 Tokens first, cost optional.** Every output records tokens in and out (measured for API contenders, optionally typed in for pasted outputs) and time taken. Cost is display-only. An API contender can carry a price per million input and output tokens, and Audition derives cost from those. Without prices, cost shows "N/A".
- **D4.3 Spending guard.** Each contender has a max-output-tokens limit. The run screen shows the number of calls before you start. Cost estimates come later.
- **D4.4 Uploads.** Text, images, PDFs and zip files, up to 25 MB per file.

### 5. Example workspaces and seed content

- **D5.1 All four example workspaces stay.** Software Factory has stages and coding tasks. Marketing has image outputs. Stock Review has a single contender. Travel Research uses ChatGPT and Perplexity by copy and paste. Their judging becomes star ratings (D3.1). Marketing's images are rated in a grid. Stock Review's outcome verdict stays in Phase 2.
- **D5.2 Images come from contenders, not from Audition.** Audition never generates images itself. Image contenders return their images by copy and paste in Phase 1, for example generated in ChatGPT or Midjourney and then uploaded. The mock provider returns test images so the image grid can be tested. API adapters for image models come later. Anthropic, the first real provider, doesn't generate images.
- **D5.3 Seed content.** The Requirements thread drafts the tasks, roles and criteria for the four workspaces for Cas to review.

## What the Requirements thread needs to change in SPEC.md

Done: folded into `docs/SPEC.md` by the Requirements thread (Nov 5, 2026). The choices it made beyond these decisions are listed under "Requirements thread choices" below.

- Phase 1 scope and "Done when": the lean core (section 1). Drop MCP from Phase 1, along with the matching rows in the Vaultbase feature table.
- Execution modes: the handoff flow becomes generic template plus manual return (D1.1 to D1.3). Report tokens and the report route move to a later phase.
- Data model: remove the repetitions fields (D2.4), add contender token prices and token limit (D2.2, D4.2), store a rubric snapshot on verdicts (D2.3), and keep the later-phase fields as nullable (D1.4).
- Judging: star rubric only, one judge per run, owner override (D3.1 to D3.4). Rewrite the fitness formula around tokens and time (D3.7).
- Thread plan: T2 shrinks to the generic template, rendering and manual submission. T3 loses pairwise judging. T1 adds token limits and prices. "Done when" for T1 drops "2 repetitions".
- Reference workspaces table: update the judging column (D5.1, D5.2).

## Open questions (not blocking Phase 1)

- Answered by the Architecture thread (Nov 6, 2026): the AI judge can see images, and the first four spec questions have proposed answers that T0 confirms. See below and `docs/TECH-SPEC.md` §2. Image-grid layout is still for Design.

## Requirements thread choices (Nov 5, 2026)

Small choices made while folding the decisions into the spec, for Cas to confirm in the PR.

- **Fields added to support decisions:** `runs.rerun_of` (Run again links to the original run), `tasks.locked`/`previous_version` and `contenders.locked`/`previous_version` (read-only once used, "Duplicate and edit"), `contenders.group` (leaderboard grouping by model), `runs.judge` and `workspaces.default_judge` (one judge per run), `workspaces.min_outputs` (champion minimum).
- **Renamed** `roles.pass_threshold` to `pass_mark`, on the 1 to 5 star scale. Dropped `tasks.status` and `tasks.rubric_override`, `contenders.handoff_template`, `attempts.repetition`, `attempts.report_token`, `runs.repetitions`.
- **Provider list** is anthropic / openai-compatible / mock / manual, matching the adapters T1 builds. Google is dropped until an adapter exists.
- **`handoff_templates` stays** as a collection with one seeded generic row, so later templates need no schema change.
- **Fitness normalisation:** Q maps stars 1 to 5 onto 0 to 1; tokens and time are divided by the largest mean in the role. The suggested champion is the qualifying contender with the highest fitness, which is the highest score under the default weights.
- **A submitted handoff output can't be replaced.** Run again gives a fresh one.

## Architecture findings (Nov 6, 2026)

The Architecture thread read the Vaultbase source at tag v0.37.0, because `docs.vaultbase.dev` shows only the latest release. Full detail, with file references, is in `docs/TECH-SPEC.md` §3. T0 confirms each finding against the running binary and adds the command and output here.

- **Pin.** v0.37.0 is the only 0.37.x release. Cas chose v0.40.2 on Nov 6, 2026, for the security fixes in 0.38 and 0.39. Checksums are in `docs/TECH-SPEC.md` §1, and the linux-x64 binary was downloaded and matched. Upgrades follow the policy in §1: an exact pin, a monthly review of the changelog, a faster upgrade for relevant security fixes, Cas's approval each time, and an old-to-new data-folder test.
- **Q1 Schema as code:** a snapshot file applied with `vaultbase --apply-snapshot <file> --snapshot-mode sync`.
- **Q2 Static UI:** there is no public folder, but a custom route can return a `Response`, so `GET /api/custom/app/*` serves `ui/dist`.
- **Q3 SDK:** plain `fetch`.
- **Q4 Binary in cloud sessions:** downloading works. Running it was blocked by a safety check in this session, so T0 must prove it.
- **Q5 Images to the AI judge:** yes. The Anthropic API takes base64 JPEG, PNG, GIF and WebP up to 10 MB encoded, 8000 px, and 600 per request. The judge is called once per output.
- **F1** Server code can't write through the records API: writes go through `helpers.sql` and emit no realtime events. So the live run view polls.
- **F2** Encrypted fields are decrypted for anyone allowed to read them. So keys move to an owner-write-only `connection_keys` collection.
- **F3** The egress guard is a denylist of private ranges, not an allowlist. Audition adds its own host check.
- **F4** Custom routes don't parse multipart. Uploads use the files endpoint, whose global MIME list excludes `application/zip` and `text/markdown`, so the UI maps those by extension.
- **F5** Default time limits are 30 s for HTTP and 300 s for queue workers. Raise the queue limit to 15 minutes and use 10-minute provider calls.
- **F6** `helpers.template` has no loops. Build list text in TypeScript first.
- **F7** `vb_hooks/` layout: `hooks/`, `routes/`, `jobs/`, `workers/`, `lib/`, with `define*()` from `"vaultbase"`.
- **F8** Anthropic API version `2026-10-21` rejects `temperature`. Anthropic contenders use effort instead.
- **UI library (Cas, Nov 6, 2026):** Arrow.js core only (`@arrow-js/core`, exact pin), built by Bun with the Design CSS and a small hash router. The full quiver template was weighed and set aside for now: Tailwind clashes with the Design CSS, its router needs Vite's `import.meta.glob`, and it has no base path for `/api/custom/app/`. Cas is addressing those in quiver separately.
