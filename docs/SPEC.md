# Audition — High-Level Spec

Nov 5, 2026 · Cas · updated with the interview decisions in `docs/NOTES.md`

## Overview

Audition is a self-hosted, domain-neutral platform that decides which AI contender is best for each role in a workflow, judged by your own standards. A contender is a model, an agent harness or an app, plus its exact configuration. The platform runs on **Vaultbase**, the single-binary backend (TypeScript on Bun), pinned to a tested version.

How it works, in one line: create a workspace (for example Software Factory), define its stages, roles and tasks, pick contenders for a role, run the tasks, judge the outputs side by side without knowing who made them, and confirm the best contender per role.

The output is a routing table: the current champion (casting) for each role, shown in the UI.

**Goals**

- **Generic.** Any domain: software delivery, marketing, stock market reviews, travel research. The software factory is the hardest test case, not the purpose.
- **Repeatable.** Tasks are fixed and rerun against new contenders over time.
- **Fair.** The same prompt for every contender, blind judging, more outputs through "Run again", and a fitness score that weighs quality against tokens and time.
- **Simple.** Few concepts, plain words on screen, usable by non-technical people. No framework, and Vaultbase does the backend work.

**Not in Phase 1**

- Automated harness runners and sandboxes (Phase 3).
- Agents reporting back on their own, and MCP access. You copy the prompt out and paste the result back.
- Pairwise (A versus B) judging. Phase 1 judges with star ratings only. (Added after Phase 1 as "Compare", Nov 18, 2026; see Judging.)
- Audition running checks itself (build, tests, lint, screenshots). Agents report those results in their reply.
- Audition generating images itself. Image contenders return images by upload.
- Public benchmarks, or statistics beyond confidence ranges.
- Multiple users, teams and SaaS tenancy. There is one owner.
- A visual workflow builder.

## Concepts

The core model uses ten domain-neutral terms. Nothing in the core mentions software.

| Term | Meaning | Example |
| --- | --- | --- |
| Workspace | A workflow you want to staff with contenders | Software Factory, Travel Research |
| Stage | Optional grouping of roles within a workspace | Research, Implementation |
| Role | A job a contender is cast into; owns the rubric | Back-end engineer, Copywriter |
| Task | A fixed, repeatable test job for a role | "Build this settings screen from this spec" |
| Connection | Where contenders run: a provider plus its encrypted key, or "Manual" for copy and paste | Anthropic API key; Manual |
| Contender | One exact configuration: connection plus model plus settings | "Opus 5.5, high effort"; "Claude Code, Opus, plan mode" |
| Run | One role, some of its tasks and some contenders, with one judge | 3 tasks × 4 contenders = 12 outputs |
| Attempt | One contender doing one task once. Screens call it an **output** | A draft post, a branch plus build results, an image |
| Verdict | Star ratings for one output, per rubric criterion | Accuracy ★★★★, Tone ★★★ → 3.6 |
| Casting | The confirmed champion for a role | UI engineer → Contender X |

How they relate: a workspace holds stages (optional), a stage holds roles, and a role owns the rubric and holds tasks. Separately, a connection holds contenders. Contenders are picked per run, not attached to tasks. A run creates one attempt per task × contender. Verdicts judge attempts, and the leaderboard rolls verdicts up per role × contender.

**Connections and contenders are global**, shared across all workspaces. Two settings are two contenders: "Opus 5.5 High 0.6" and "Opus 5.5 Medium 0.2" compete separately. Each contender has a friendly name, and the leaderboard can group rows by model.

**Utility roles** are platform jobs given to ordinary contenders in workspace settings: **Judge** (rates outputs against the rubric) and **Composer** (drafts handoff prompts, later phase).

## Data model

Thirteen Vaultbase collections plus one view (T0 counted them against the built schema). Each collection is a real SQL table. The exact fields, types and API rules are in `docs/TECH-SPEC.md` §6; T0 builds the schema from there. Fields marked *later* exist from T0 as nullable and unused in Phase 1, so later phases add behaviour without a schema change.

| Collection | Kind | Key fields |
| --- | --- | --- |
| users | auth | The single owner account, with MFA available. No other logins in Phase 1. |
| workspaces | base | name, description, judge_contender → contenders, default_judge (me / ai), default_method (rate / compare; default rate), min_outputs (default 5), fitness_weights (json: quality, tokens, time; default quality only), composer_contender → contenders (*later*) |
| stages | base | workspace, name, order. Optional. |
| roles | base | workspace, stage (optional), name, description, rubric (json: criteria with name, weight, guidance), pass_mark (stars, 1 to 5), default_output_type |
| tasks | base | role, title, prompt (editor), output_type (text / image / file / code), attachments (files), base_ref (repo + commit, coding tasks only), locked, previous_version → tasks, composed_prompt (*later*) |
| connections | base | name, provider (anthropic / openai-compatible / mock / manual), base_url, has_key, notes |
| connection_keys | base | connection, api_key (**encrypted**). The owner can write a key but never read it back; only server code reads it. |
| contenders | base | connection, name, mode (api / handoff; runner *later*), model, group (for leaderboard grouping), config (json: system prompt, effort, temperature for OpenAI-compatible only), max_output_tokens, price_in_per_mtok (optional), price_out_per_mtok (optional), locked, previous_version → contenders, enabled |
| handoff_templates | base | name, kind (generic; coding-harness and app *later*), body with {{vars}}, return_instructions. Phase 1 seeds one generic template. |
| runs | base | workspace, role, tasks (list of ids), contenders (list of ids), judge (me / ai), method (rate / compare; empty means rate), judge_contender, rerun_of → runs (optional), status, call_count, schedule (cron, *later*) |
| attempts | base | run, task, contender, mode, status, prompt_sent, output, output_files, tokens_in, tokens_out, duration_ms, provider_calls (retries included), cost (derived, empty when unknown), metrics_source (measured / manual), finish_reason, error, submitted_at |
| verdicts | base | attempt, run, method (rubric, pairwise for Compare picks, outcome for outcome checks), judge_kind (human / ai), judge_contender, scores (json: stars and a one-line reason per criterion; for a pick, the reason only), rubric_snapshot (json), score (weighted, 1 to 5; empty for a pick), status (active / overridden), opponent and winner (this / opponent / tie; Compare picks only), due_at (outcome checks only) |
| castings | base | role, contender, since, rationale, suggested_by (system / human), confirmed |
| leaderboard | view | SQL over attempts and verdicts, per role × contender: outputs scored, mean score, confidence range, mean tokens, mean time, mean cost (or N/A), fitness |

Three rules hold throughout.

- **Used records are read-only.** Once a task or contender has been in a run, it is locked. "Duplicate and edit" creates a new version that points back to the old one. Role rubrics can change, because every verdict stores a snapshot of the rubric it was scored against.
- **Attempts never change contender or task** after they are created.
- **Nothing is overwritten.** "Run again" adds outputs; it never replaces old ones.

## Execution modes

Every contender runs in one of two Phase 1 modes. The attempt record is the same in both; only who executes it changes.

| Mode | Who executes | Phase | Tokens and time |
| --- | --- | --- | --- |
| API | Audition calls the provider directly | 1 | Measured |
| Handoff | You copy the prompt into a harness or app, then paste the result back | 1 | Typed in by you, optional |
| Runner | An external automated runner executes and reports back | 3 | Reported by the runner |

**Attempt lifecycle.** API: queued → in progress → submitted → judged. Handoff: waiting for you → submitted → judged. Any state can move to *failed*, with the error recorded.

**Starting a run**

1. You pick a role, some of its tasks, some contenders, and the judge (Me or AI; the workspace default is preselected).
2. Before you start, the run screen shows how many provider calls it will make (API outputs, plus AI judging calls). This is the spending guard, together with each contender's max output tokens. Cost estimates come later.
3. Starting the run creates one attempt per task × contender.

**API pipeline**

1. Each API attempt goes onto a queue; a worker calls the provider through `helpers.http` with retries, passing the contender's max output tokens.
2. The worker stores the output, any files, and the measured tokens in and out and time taken. When the contender has prices per million tokens, Audition derives the cost; otherwise cost is empty and shows "N/A".
3. If the run's judge is AI, the worker then queues AI judging for that output.

**Handoff (manual return)**

1. Audition renders the generic template once per task when the run starts. The rendered prompt is identical for every contender on that task, and API contenders receive the same text as their user message.
2. The handoff screen shows one copy-ready block: the role and its description, the task prompt (naming the repo and commit when the task has one), the rubric, and "When done, reply with…" instructions. For code and UI tasks, those instructions ask for a summary, the branch or diff, build, test and lint results, and screenshots as files.
3. You paste the reply into Audition and upload any files. You can also type in tokens and time taken, if the tool showed them. Submitting moves the attempt to submitted. A submitted output cannot be replaced; use "Run again" for a fresh one.

Uploads accept text, images, PDFs and zip files, up to 25 MB per file.

**Fairness rule:** the prompt is rendered once per task and is identical for every contender. Coding tasks name the same repo and commit for every contender.

**Run again.** A finished run has a "Run again" button. It creates a new run with the same role, tasks, contenders and judge, linked to the original. The leaderboard averages every scored output across runs.

## Judging, fitness and casting

Phase 1 had one judging method: **star ratings against the role's rubric**. Since Nov 18, 2026 each run picks one of two methods, and the workspace sets the default:

- **Rate (stars)**, the Phase 1 method below.
- **Compare (A vs B)**, described after it.

- **The rubric.** Each role has a few criteria, each with a weight (percentages that add up to 100) and a line of guidance. The judge gives each output 1 to 5 stars per criterion, and Audition computes the weighted score, from 1 to 5.
- **One judging screen per task.** It shows all of a run's outputs for that task side by side, unlabelled and in shuffled order ("Output A, B, C"). Text is shown side by side; images are shown in a grid. The best output is the one with the highest score.
- **Blind.** The data behind the judging screen never includes contender fields.
- **One judge per run: Me or AI.** The AI judge is the contender chosen in workspace settings. It returns stars plus a one-line reason per criterion, as structured JSON. Audition warns when the judge shares a provider with a contender it is judging.
- **The owner can always override.** On any output the AI judged, you can change the stars. Your verdict then counts, and the AI's verdict stays in the history.
- **Code and UI outputs.** Build, test and lint results and screenshots arrive inside the output. The judging screen shows the text and images together and labels these results as the agent's own claim, because Audition runs no checks.

Verdicts are separate records, so later phases can add pairwise picks and delayed outcome verdicts to the same attempts.

**Compare (A vs B).** Added Nov 18, 2026 (Cas approved the `runs.method` and `workspaces.default_method` fields and the leaderboard change).

- **One choice per run.** "Start a run" offers "How to judge": Rate (stars) or Compare (A vs B). The workspace setting picks which one is preselected. Compare needs at least two contenders. Run again and scheduled repeats keep the run's method.
- **Two outputs at a time.** The judging screen shows one pair of a task's outputs side by side, still unlabelled and shuffled, and three buttons: "A is better", "About the same", "B is better". Each task with n outputs has n × (n − 1) / 2 pairs (3 outputs make 3 pairs, 4 make 6). The rubric is shown as the meaning of "better".
- **Me or AI, with override.** The AI judge is called once per pair, sees both outputs and their images in one call, and returns the winner and a one-line reason. Which output is shown first is shuffled per pair, because judges tend to favour one side. The owner can change any pick; the owner's pick then counts and the AI's stays in history.
- **Scores.** An output's score is 1 + 4 × its win share, a tie counting half: it beat every rival → 5, lost every pair → 1, all ties → 3. It is on the same 1 to 5 scale as a star score, so both kinds feed the same leaderboard, fitness and champion rules. An output is judged once all of its pairs are decided. An output whose rivals all failed has nothing to be compared with: it is marked judged without a score and doesn't count.
- **What the two mean.** A star score is absolute (how good against the rubric); a Compare score is relative (how it did against the others in that run). Mixing both in one role is allowed. Comparing works best when the contenders are close, or when star ratings feel arbitrary.

**Fitness** is calculated per role × contender across all runs, never per run:

```
fitness = w_q · Q − w_t · T − w_d · D
```

Q is quality from 0 to 1: the mean weighted score, mapped so 1 star is 0 and 5 stars is 1. T is mean tokens (in plus out) and D is mean time taken, each divided by the largest mean among the role's contenders, so both run from 0 to 1. The weights are set per workspace; the default is quality only (w_q = 1, w_t = w_d = 0).

A tokens or time term applies only when every contender in the role has that data. Otherwise fitness falls back to the terms that are available, and the leaderboard says which terms it used. Cost is shown for information and never enters fitness.

**Leaderboard.** One row per role × contender, optionally grouped by model: outputs scored, mean score, a confidence range, mean tokens, mean time, mean cost (or N/A), and fitness.

**Champion suggestion.** A contender qualifies when it has at least the workspace's minimum number of scored outputs (default 5) and its mean score is above the role's pass mark. The qualifying contender with the highest fitness is marked "Suggested champion", and you confirm it to create the casting. Below the minimum, the leaderboard shows "not enough data yet".

## Vaultbase platform

Audition is built entirely on Vaultbase. It needs no other backend service, only the binary, a data folder and a reverse proxy in production.

| Need | Vaultbase feature | Phase |
| --- | --- | --- |
| Owner sign-in | Auth collection with MFA | 1 |
| Provider keys | Encrypted fields (AES-GCM) | 1 |
| Fan-out of attempts | After-create hook on runs → queue workers | 1 |
| Provider calls | `helpers.http` with retries, behind the SSRF egress guard (default private-range denylist) plus Audition's own check that the host matches the connection | 1 |
| Handoff rendering | `helpers.template` | 1 |
| Live run progress | Realtime subscriptions on the run and its outputs; the run page polls a run summary route every 2 seconds only while the realtime connection is down (`docs/PLATFORM-UPGRADES.md` B3) | 1 |
| Uploads and outputs | Files with MIME and size validation and thumbnails | 1 |
| Leaderboard | View collection plus aggregations | 1 |
| Task and contender versions | Record history | 1 |
| Every judgement and casting | Audition's own records keep the history: verdicts are never deleted, an owner override marks the AI verdict "overridden", and each confirmation adds a new casting. Server writes go through Vaultbase's records API (`helpers.records`, since Nov 11, 2026), and record history is on for runs, attempts, verdicts and castings, so each change shows in the admin with who made it (the owner, or system for Audition's own server code). Vaultbase's audit log covers admin and schema actions only. | 1 |
| Agent report-back endpoint | Custom route with per-IP rate limit | Later |
| Routing table for agents | MCP with scoped, read-only tokens | Later |
| Stale-attempt sweep | Cron | Later |
| Scheduled runs, outcome verdicts | Cron | 2 |
| Run-complete and casting alerts | Push and email | 2 |
| Guest voters | Anonymous sessions | 2 |
| Match a new task to a role | Vector search | 2 |
| Contender rollout | Feature flags | 2 |
| Runner callbacks | HMAC-signed webhooks | 3 |

**Conventions**

- **Pin the version.** Pinned at v0.46.0 (from 0.44.0 on Nov 17, 2026; 0.40.2 before Nov 11), with its version and checksums recorded in the repo. Upgrade only on purpose, after reading the changelog's Security and Upgrade notes: monthly, or sooner for a security fix that touches what Audition uses (see `docs/TECH-SPEC.md` §1, "Upgrade policy"). Vaultbase is pre-1.0 and releases almost daily.
- **Logic lives in the repo.** Hooks, routes, cron and queue workers are TypeScript files in `vb_hooks/`, not code typed into the admin UI.
- **The schema lives in the repo** as code or a snapshot that a fresh instance can apply. T0 picks the mechanism after reading the docs.
- **UI:** JavaScript with Arrow.js core for reactive state and templates (the one runtime dependency, chosen by Cas on Nov 6, 2026), no framework, built with Bun. Restrained, modern look; works at phone width. Plain words on screen ("outputs", not "attempts").
- **Production:** the VPS behind Cloudflare, following Vaultbase's Cloudflare recipe. That deployment comes after Phase 1 is proven locally.

## Security

The only secrets Audition holds are provider API keys. It never stores account passwords for providers or harnesses.

- **Keys are write-only to clients.** API keys sit in an encrypted field on `connection_keys`, which the owner can write but not read, and only server-side code reads them. No API response or realtime event returns them.
- **Harness credentials stay on the harness machine.** Handoff contenders hold no credentials in Audition.
- **API rules:** the single owner alone can access everything. The blind judging endpoint never returns contender fields.
- **Uploads** are checked for type (text, images, PDF, zip) and size (25 MB per file).
- **Egress:** Vaultbase's guard blocks private and loopback ranges, and Audition refuses any provider URL whose host isn't the connection's.
- **Rate limits** apply to the auth routes.
- **Development and cloud sessions use the mock provider only.** No real provider keys ever enter the repo, tests or Claude Code cloud sessions. The real-provider check runs on the owner's own machine.

## Phases

Phase 1 proves the whole loop — tasks → runs → judging → casting — with API and handoff contenders. Each later phase adds capability without changing the core records.

| Phase | Scope | Done when |
| --- | --- | --- |
| 1 — Core loop | Workspaces, stages, roles, tasks; connections and contenders; API mode and handoff by copy and paste with one generic template; star-rubric judging by Me or AI with owner override; Run again; leaderboard with tokens, time and optional cost; champion suggestion and casting; single owner | All four reference workspaces run end to end against the mock provider. Then Cas runs one real check with Anthropic on their own machine, outside any Claude session, after T5 merges. |
| 2 — Living arena | Composer utility role; scheduled runs; outcome verdicts; push and email alerts; guest voters; vector match of new tasks to roles; Levare reads castings | A scheduled role reruns unattended and a delayed outcome verdict lands on its due date |
| 3 — Runners | Automated runners for harness contenders, with sandboxes outside Vaultbase reporting through signed webhooks | A coding task runs on two harnesses with no manual step |

**First after Phase 1:** move server writes onto the Vaultbase records API (an API token plus a `hooks.http.allow` loopback exception, or a write helper if Vaultbase adds one: https://github.com/vaultbase-sh/vaultbase/discussions/10), then turn on record history for verdicts and castings and realtime for the run page (NOTES R5). Done for the writes and history on Nov 11, 2026 with `helpers.records` (Vaultbase 0.43, `docs/PLATFORM-UPGRADES.md` part B); realtime for the run page followed in its own PR (B3).

**Deferred from Phase 1, phase not yet set:** agent report tokens and self-report; MCP, including MCP reads of castings; the coding-harness and app templates; pairwise judging (done Nov 18, 2026 as Compare); platform-run checks and screenshot capture; the stale-attempt cron; API adapters for image models; cost estimates before a run.

### Roadmap after Phase 1

Approved by Cas on Nov 11, 2026. Each step is its own thread and PR, in this order. Anything not listed here, or moved up from "Later", needs Cas's OK first.

| Step | Scope | Vaultbase feature shown | Done when |
| --- | --- | --- | --- |
| 1 — Wrap-up | Realtime run page (part B3 of `docs/PLATFORM-UPGRADES.md`), with polling kept as the fallback when the connection drops. One combined request to the Vaultbase author: text/markdown, zip and csv on the upload allowlist (NOTES W1), a server-side file helper (Q2) and an "only if" condition on `helpers.records.update` (Q3). Tag v0.2.0 and deploy it by `docs/RELEASE.md`; Cas runs the server steps and the real Anthropic check. | Realtime | The run page updates without polling, and v0.2.0 runs on Cas's server |
| 2 — Phase 2a, living arena lite | Scheduled runs of a role, using the existing `runs.schedule` field. A stale-attempt sweep. Outcome verdicts that come due on a set date, starting with Stock Review ("was the call right four weeks later?"), using the existing `verdicts.due_at` field. An email to the owner when a run finishes or a role's champion changes. | Cron, email | The Phase 2 Done-when: a scheduled role reruns unattended and a delayed outcome verdict lands on its due date |
| Later, phase not set | MCP read-only access to castings; the Composer utility role; guest voters; vector match of new tasks to roles; pairwise judging (done Nov 18, 2026: Compare (A vs B), see Judging); API adapters for image models; push alerts (built, docs/PUSH-ALERTS.md); contender rollout by feature flags; Levare reading castings; an off-server (R2) copy of backups. (Outline chips: done Nov 13 2026.) Phase 3 runners stay as planned. | MCP, anonymous sessions, vector search, push, feature flags | Each is picked and scoped with Cas before its thread starts |

## Phase 1 thread plan

Phase 1 is six threads: one foundation thread that must merge first, four that run in parallel, and one that closes the phase.

```
T0 Foundations ──┬──► T1 API execution ──────┐
(merged before   ├──► T2 Handoff ────────────┤
 any other       ├──► T3 Judging and fitness ┼──► T5 Integration
 thread starts)  └──► T4 UI ─────────────────┘    (starts after T1–T4 merge)

T4 builds against the T0 schema and uses stubs until T1–T3 land.
```

Each thread is done only when its acceptance criteria pass on a fresh Vaultbase instance and the evidence is in its PR.

| Thread | Scope | Done when |
| --- | --- | --- |
| T0 Foundations | Repo layout and Bun scripts; download and checksum the pinned Vaultbase binary; start and stop scripts; schema (including the nullable *later* fields) and API rules as code; the generic handoff template; seed script for the four reference workspaces from "Reference workspace content"; a deterministic mock provider (text, and test images); a test harness that boots a fresh instance per run | From a fresh clone, one command boots Vaultbase, applies the schema, seeds, and `bun test` passes schema and rule tests. Every *later* field exists and is nullable. The open questions marked for T0 are answered in `docs/NOTES.md`. |
| T1 API execution | Run → attempt fan-out (one per task × contender); queue worker; provider adapters (Anthropic, OpenAI-compatible, mock); max output tokens; measured tokens and time; cost from token prices; Run again; the call count for the spending guard; retries and failure handling | A run of 2 tasks × 3 contenders against the mock produces 6 submitted attempts with tokens and time. Run again produces 6 more and leaves the first 6 untouched. Each call is sent with the contender's max output tokens. Cost is derived when prices are set and empty when they are not. Injected failures are recorded as failed attempts and nothing crashes. |
| T2 Handoff | The generic template; rendering once per task; manual submission (pasted text, uploads, optional tokens and time); upload type and size checks | A seeded task renders one prompt that is identical for every handoff contender in the run and contains the role, task, repo and commit (when set), rubric and return instructions. A pasted output submits exactly once; a second submission is rejected. Uploads of the wrong type or over 25 MB are rejected. |
| T3 Judging and fitness | AI star judge through the mock (stars plus a reason per criterion); human verdict API; owner override; rubric snapshot on verdicts; blind payload; leaderboard view with confidence ranges; fitness with partial data; champion suggestion and confirmation; same-provider warning | Seeded results give a deterministic leaderboard. The blind endpoint never returns contender fields. An owner override replaces the AI's score in the leaderboard and the AI verdict stays in history. Fitness drops the tokens term when one contender lacks token data, and says so. A champion is suggested only at or above the minimum outputs and above the pass mark. |
| T4 UI | Editors for workspaces, stages, roles (with rubric) and tasks, including "Duplicate and edit"; connection and contender setup; run builder with call count; live run view; handoff copy and paste screen; blind star-judging screen with image grid and override; Run again; leaderboard and casting | A browser walkthrough of all four reference workspaces against the mock works end to end, with no framework (Arrow.js core only), at desktop and phone width. |
| T5 Integration | End-to-end runs of the four reference workspaces; README and operations notes, including the steps for Cas's local Anthropic check; fixes for gaps found | All four workspaces complete the loop (tasks → runs → judging → casting) with no special cases. |

## Orchestrator rules

These rules bind the Claude Code Project orchestrator and every thread it starts.

1. `docs/SPEC.md` is the source of truth. A change to the spec is proposed in a PR, never made silently inside a feature branch.
2. Threads run in order: Interview, then Requirements, then Design and Architecture in parallel, then the build threads. T0 merges before T1–T4 start in parallel; T5 starts once T1–T4 are merged; Release starts after T5. The Review thread checks every build PR before I merge it.
3. One branch per thread. A thread ends at an open PR: it never merges, never pushes to `main`, and never force-pushes.
4. Evidence before fixes. Read the pinned Vaultbase version's docs before using a feature. When behaviour differs from the docs, record the finding in `docs/NOTES.md` instead of guessing a workaround.
5. Every PR passes `bun test` against a fresh Vaultbase instance, and its description includes the test output.
6. Mock provider only. No real API keys anywhere.
7. No frameworks, no runtime dependencies, except Arrow.js core and quiver core in the UI (`@arrow-js/core`, `@go4cas/quiver`, exact versions; quiver added Nov 11, 2026, Q5 of PLATFORM-UPGRADES). Any dev dependency needs a one-line reason in the PR.
8. Stay inside the thread's boundary. A need that crosses threads goes to the orchestrator as a question.
9. Stop and ask me before a schema change after T0, any scope addition, or a Vaultbase version change.
10. Each thread reports: what was done, the evidence, and open questions.

## Reference workspaces

Four seeded workspaces test that the model is generic. If all four run without special cases, the design holds.

| Workspace | Shape | Contenders | Judging | Proves |
| --- | --- | --- | --- | --- |
| Software Factory | Multi-stage: research, spec, back-end, UI | API models, plus coding harnesses by copy and paste | Star rubric by AI, owner override; build and test results and screenshots arrive in the output | Stages, repo and commit in the prompt, results reported inside the output |
| Marketing Pipeline | No stages: social posts, brand copy, images | API models for text; image contenders by upload (mock returns test images) | Star rubric by Me; images rated in a grid | Image output, the image grid |
| Stock Review | One role, one contender | One API model | Star rubric now; outcome verdict later (Phase 2) | The single-contender path, the pass mark |
| Travel Research | One role, non-technical | ChatGPT and Perplexity by copy and paste | Star rubric by Me | Manual return, a non-technical user |

## Reference workspace content

Draft seed content for Cas to review. T0 seeds it as written once approved. Weights are percentages; the pass mark is in stars (1 to 5). Seeded contenders use the mock connection (API) and the Manual connection (handoff); real contenders are added in the UI.

**Seeded connections and contenders**

| Connection | Contenders |
| --- | --- |
| Mock (provider: mock) | "Mock Steady" (always solid output), "Mock Erratic" (varies by seed), "Mock Judge" (the AI judge), "Mock Image" (returns test images) |
| Manual | "Claude Code (manual)", "Codex (manual)", "ChatGPT (manual)", "Perplexity (manual)", "Midjourney (manual)" |

### Software Factory

Stages: Research → Spec → Back-end → UI. Judge: AI ("Mock Judge"), owner can override. Fitness: quality 70, tokens 20, time 10. The coding tasks name a small demo repo and commit (see the open questions).

| Stage | Role | Criteria (weight) | Pass mark | Tasks |
| --- | --- | --- | --- | --- |
| Research | Researcher: compares options and recommends one, with sources | Accuracy (40), Relevance to the question (25), Clear recommendation (20), Sources cited (15) | 3.5 | "Compare three ways to store user settings in a small web app and recommend one"; "Summarise the trade-offs of SQLite versus Postgres for a single-user app" |
| Spec | Spec writer: turns a rough idea into a short, testable spec | Completeness (35), Testable acceptance criteria (30), Clarity (20), Scope discipline (15) | 3.5 | "Write a one-page spec for a settings screen with Profile, Notifications and Danger zone" |
| Back-end | Back-end engineer: builds small, tested server features | Correctness (40), Tests included and passing (25), Code quality (20), Error handling (15) | 3.5 | "Add a REST endpoint that saves and reads user settings, with tests" |
| UI | UI engineer: builds accessible, responsive screens from a spec | Matches the spec (40), Code quality (30), Accessibility (20), Responsiveness (10) | 3.5 | "Build the settings screen from settings-spec.md and mockup.png, vanilla JS and CSS, usable at 375 px" |

Contenders in a typical run: "Mock Steady", "Mock Erratic" (API) and "Claude Code (manual)", "Codex (manual)" (handoff).

### Marketing Pipeline

No stages. Judge: Me. Fitness: quality only.

| Role | Criteria (weight) | Pass mark | Tasks |
| --- | --- | --- | --- |
| Social post writer: short posts for a given channel and audience | On brand voice (30), Hook in the first line (30), Clear call to action (20), Fits the channel's length (20) | 3.5 | "Write three LinkedIn posts announcing a self-hosted note-taking app"; "Write five posts for X about a spring sale at a coffee roaster" |
| Brand copywriter: names, taglines and short brand copy | Memorable (35), Fits the brand brief (35), Clear (20), Original (10) | 3.5 | "Propose five taglines and a 50-word About text for a coffee roaster called Ember & Oak" |
| Image maker: images from a brief (output type image) | Matches the brief (40), Visual quality (30), On brand (20), Usable as-is (10) | 3.0 | "Create a square social image for the Ember & Oak spring sale: warm tones, a coffee bag, no text" |

Contenders: "Mock Steady", "Mock Erratic" for text; "Mock Image" and "Midjourney (manual)" for images.

### Stock Review

No stages, one role, one contender. Judge: AI ("Mock Judge"). Fitness: quality only. The outcome verdict ("was the call right four weeks later?") is Phase 2.

| Role | Criteria (weight) | Pass mark | Tasks |
| --- | --- | --- | --- |
| Stock analyst: a short, balanced review of one listed company | Uses the facts given (35), Balanced risks and upside (25), Clear view with reasoning (25), Plain language (15) | 3.5 | "Review the attached quarterly summary for a fictional company, Northwind Foods, and give a buy, hold or sell view with three reasons" |

Contender: "Mock Steady". The task uses an attached, made-up summary, so no live market data is needed.

### Travel Research

No stages, one role. Judge: Me. Fitness: quality only. Built for a non-technical user: copy, paste, rate.

| Role | Criteria (weight) | Pass mark | Tasks |
| --- | --- | --- | --- |
| Trip researcher: practical travel plans with real places | Practical and realistic (35), Matches the brief (30), Specific places named (20), Easy to follow (15) | 3.5 | "Plan three days in Lisbon in May for two adults who like food and walking, mid-range budget"; "Find the best way to get from Paris to Amsterdam with a bike, and what it costs" |

Contenders: "ChatGPT (manual)" and "Perplexity (manual)".

## Open questions

The Architecture thread answered the first six in `docs/TECH-SPEC.md` §2. T0 confirms the first four against the running binary and records the evidence in `docs/NOTES.md`.

- [x] How is the schema kept as code? A Vaultbase snapshot file applied with `--apply-snapshot`.
- [x] Can Vaultbase serve the static UI itself? Yes, through a custom route at `/api/custom/app/`.
- [x] Is the `@vaultbase/sdk` client worth taking on? No, plain `fetch`.
- [x] Can a cloud session download the pinned release from GitHub? Yes, checked by checksum. Running it there is for T0 to confirm.
- [x] How are images passed to the AI judge? As base64 image blocks, one judge call per output. The Anthropic adapter supports this.
- [x] Which demo repo and commit do the Software Factory coding tasks name? The repo is `go4cas/audition-factory-demo` (Cas created it on Nov 6, 2026). Cas pushed `fixtures/factory-demo/` to it on Nov 7, 2026, and the seed names its first commit, `9c4bb7aef4c84adaf7b5aa523c1e56f9fada8a55`.
- [x] Pin Vaultbase 0.37.0 or move to 0.40.2? Pinned at v0.40.2 (Cas, Nov 6, 2026), with the monthly upgrade policy in `docs/TECH-SPEC.md` §1.
- [x] How does the image-judging grid look? (Design) Answered in `docs/design/README.md`: square cards in a responsive grid, stars per criterion under each image, tap to enlarge.
- [ ] Is vector search reachable through MCP, or only through a custom route? (Phase 2)
- [ ] Does "Audition" need a qualifier or distinct domain to stay clear of Adobe Audition, if this is ever offered publicly?

## Sources

- [Vaultbase site](https://vaultbase.dev/)
- [Vaultbase docs](https://docs.vaultbase.dev/)
- [vaultbase-sh/vaultbase on GitHub](https://github.com/vaultbase-sh/vaultbase)
