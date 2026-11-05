# Audition — High-Level Spec

Nov 5, 2026 · Cas

## Overview

Audition is a self-hosted, domain-neutral platform that decides which AI contender is best for each role in a workflow, judged by your own standards. A contender is a model, an agent harness or an app, plus its configuration. The platform runs on **Vaultbase**, the single-binary backend (TypeScript on Bun), pinned to a tested version.

The output is a routing table: the current champion (casting) for each role, readable by people in the UI and by agents over MCP.

**Goals**

- **Generic.** Any domain: software delivery, marketing, stock market reviews, travel research. The software factory is the hardest test case, not the purpose.
- **Repeatable.** Tasks are fixed and rerun against new contenders over time.
- **Fair.** The same prompt for every contender, blind judging, several repetitions per task, and a fitness score that weighs quality against cost and latency.
- **Simple.** Few concepts, no framework, and Vaultbase does the backend work.

**Not in v1**

- Automated harness runners and sandboxes (Phase 3).
- Public benchmarks, or statistics beyond confidence ranges.
- Multi-user teams and SaaS tenancy.
- A visual workflow builder.

## Concepts

The core model uses ten domain-neutral terms. Nothing in the core mentions software.

| Term | Meaning | Example |
| --- | --- | --- |
| Workspace | A workflow you want to staff with contenders | Software Factory, Travel Research |
| Stage | Optional grouping of roles within a workspace | Research, Implementation |
| Role | A job a contender is cast into; owns the rubric | Back-end engineer, Copywriter |
| Task | A fixed, repeatable test job for a role | "Build this settings screen from this spec" |
| Connection | An endpoint plus its encrypted credential | Anthropic API key, a manual app |
| Contender | A connection plus model plus config, in one execution mode | Opus with a given system prompt; Claude Code via handoff |
| Run | Selected tasks × contenders × repetitions, with a judging method | 3 tasks, 4 contenders, 3 repetitions |
| Attempt | One contender doing one task once; holds the artifact and metrics | A draft post, a repo branch, an image |
| Verdict | A judgement on one attempt, or on a pair | Rubric score 0.82; A beats B |
| Casting | The confirmed champion for a role | UI work → Contender X |

**Utility roles** are platform jobs assigned to ordinary contenders in workspace settings: **Judge** (scores against rubrics) and **Composer** (optionally drafts handoff prompts, Phase 2).

## Data model

Thirteen Vaultbase collections. Each one is a real SQL table. Field names are indicative; T0 settles them in the schema.

| Collection | Kind | Key fields |
| --- | --- | --- |
| users | auth | Owner account with MFA. Guest voters come later, through anonymous sessions (Phase 2). |
| workspaces | base | name, description, judge_contender → contenders, composer_contender → contenders, default_judging (json), fitness_weights (json) |
| stages | base | workspace, name, order. Optional. |
| roles | base | workspace, stage (optional), name, description, rubric (json: criteria with name, weight, guidance), pass_threshold, default_output_type |
| tasks | base | role, title, prompt (editor), output_type (text / image / file / code), attachments (files), rubric_override (json), composed_prompt (frozen), base_ref (repo + commit, coding tasks only), status (draft / frozen) |
| connections | base | name, provider (anthropic / openai-compatible / google / manual), base_url, api_key (**encrypted**), notes |
| contenders | base | connection, name, mode (api / handoff / runner), model, config (json: system prompt, temperature, limits), handoff_template, enabled |
| handoff_templates | base | name, kind (generic / coding-harness / app), body with {{vars}}, return_instructions |
| runs | base | workspace, role, tasks (multi), contenders (multi), repetitions, judging (json), schedule (cron, Phase 2), status |
| attempts | base | run, task, contender, repetition, status, prompt_sent, output, output_files, metrics (cost, latency, tokens in/out), metrics_source (measured / self-reported / manual), report_token (**encrypted**, single use), error |
| verdicts | base | attempt, opponent (optional), method (rubric / pairwise / outcome), judge_kind (human / ai), judge_contender, scores (json per criterion), winner, rationale, due_at (outcome verdicts), status |
| castings | base | role, contender, since, rationale, suggested_by (system / human), confirmed |
| leaderboard | view | SQL over attempts and verdicts, per role × contender: attempts, mean score, win rate, mean cost, mean latency, fitness, confidence |

Two rules hold throughout. **Tasks freeze** once a run uses them, so later edits create a new task version (record history keeps the trail). **Attempts never change contender or task** after they are created.

## Execution modes

Every contender runs in one of three modes. The attempt record is the same in all three; only who executes it changes.

| Mode | Who executes | Phase | Metrics |
| --- | --- | --- | --- |
| API | The platform calls the provider directly | 1 | Measured |
| Handoff | You paste a generated prompt into a harness or app; the result comes back | 1 | Self-reported or manual |
| Runner | An external automated runner executes and reports back | 3 | Reported by the runner |

**Attempt lifecycle:** queued → generated (handoff only) → in progress → submitted → judged. Any state can move to *failed*, with the error recorded.

**API pipeline**

1. Starting a run creates one attempt per task × contender × repetition.
2. Each attempt goes onto a queue; a worker calls the provider through `helpers.http` with retries.
3. The worker stores the output, files and measured cost, latency and tokens, then queues AI judging if the run asks for it.

**Handoff**

1. The platform renders the contender's template once and issues a single-use report token scoped to that attempt.
2. The UI shows copy-ready blocks. The **generic** template gives a prompt plus return instructions. The **coding-harness** template gives three blocks: pre-goal shell commands (a fresh worktree from the task's `base_ref`), the `/goal` prompt, and the kickoff prompt, which ends with the report-back step. The **app** template (ChatGPT, Perplexity and similar) gives a prompt to paste.
3. The result comes back one of two ways. **Self-report:** the agent posts its summary, artifacts and metrics to a report route, or through MCP, using the token. **Manual:** you paste the output or upload files.
4. A cron job flags attempts left in progress too long.

**Fairness rule:** the prompt is rendered once per task and is identical for every contender. Coding tasks all start from the same commit.

## Judging, fitness and casting

Verdicts are separate records, so one attempt can collect several: an AI rubric score now, a human pairwise pick later, an outcome verdict next month.

| Method | Needs | Judged by | Phase |
| --- | --- | --- | --- |
| Rubric score (absolute) | 1+ contenders | Human or AI | 1 |
| Pairwise pick | 2+ contenders, same task and repetition | Human or AI | 1 |
| Outcome (delayed) | Something measurable later, with a due date | Human or AI | 2 |

- **Blind human judging.** The judging screen shows outputs without contender names, in shuffled order. The API that feeds it never returns contender fields.
- **AI judge.** It scores against the role's rubric and returns structured JSON per criterion with a short rationale. The platform warns when the judge shares a provider with a contender it is judging.
- **Output types.** Text is shown side by side. Images are shown in a thumbnail grid. Code and UI attempts are judged on objective checks first (build, tests, lint, accessibility), then screenshots.

**Fitness** is calculated per role × contender across all runs, never per run:

```
fitness = w_q · Q − w_c · C − w_l · L
```

Q is quality from 0 to 1 (rubric scores, or ratings derived from pairwise wins). C is normalised cost and L normalised latency. The weights are set per workspace. Self-reported metrics count for less than measured ones. The leaderboard shows the number of attempts and a confidence range next to each score.

**Casting.** The system suggests a champion once a contender has enough attempts for a role (a minimum set per workspace). You confirm it. Confirmed castings are readable over MCP, so a factory or Levare can ask who should do a role right now.

## Vaultbase platform

Audition is built entirely on Vaultbase. It needs no other backend service, only the binary, a data folder and a reverse proxy in production.

| Need | Vaultbase feature | Phase |
| --- | --- | --- |
| Owner sign-in | Auth collection with MFA | 1 |
| Provider keys, report tokens | Encrypted fields (AES-GCM) | 1 |
| Fan-out of attempts | After-create hook on runs → queue workers | 1 |
| Provider calls | `helpers.http` with retries, behind the SSRF egress guard | 1 |
| Handoff rendering | `helpers.template` | 1 |
| Report-back endpoint | Custom route with per-IP rate limit | 1 |
| Live run progress | Realtime subscriptions on attempts | 1 |
| Artifacts | Files with MIME and size validation and thumbnails | 1 |
| Leaderboard | View collection plus aggregations | 1 |
| Task and rubric versions | Record history | 1 |
| Routing table for agents | MCP with scoped, read-only tokens | 1 |
| Every judgement and casting | Audit log | 1 |
| Stale-attempt sweep | Cron | 1 |
| Scheduled runs, outcome verdicts | Cron | 2 |
| Run-complete and casting alerts | Push and email | 2 |
| Guest voters | Anonymous sessions | 2 |
| Match a new task to a role | Vector search | 2 |
| Contender rollout | Feature flags | 2 |
| Runner callbacks | HMAC-signed webhooks | 3 |

**Conventions**

- **Pin the version.** Use the latest 0.37.x release, record its version and checksum in the repo, and upgrade only on purpose after reading the changelog's upgrade notes. Vaultbase is pre-1.0.
- **Logic lives in the repo.** Hooks, routes, cron and queue workers are TypeScript files in `vb_hooks/`, not code typed into the admin UI.
- **The schema lives in the repo** as code or a snapshot that a fresh instance can apply. T0 picks the mechanism after reading the docs.
- **UI:** vanilla JavaScript, no framework, built with Bun, zero runtime dependencies. Restrained, modern look; works at phone width.
- **Production:** the VPS behind Cloudflare, following Vaultbase's Cloudflare recipe. That deployment comes after Phase 1 is proven locally.

## Security

The only secrets Audition holds are provider API keys and short-lived report tokens. It never stores account passwords.

- **Keys are write-only to clients.** API keys sit in encrypted fields and only server-side hooks read them. No API response, realtime event or MCP tool returns them.
- **Harness credentials stay on the harness machine.** Handoff and runner contenders hold no credentials in Audition.
- **Report tokens** are single-use, scoped to one attempt, expire, and are stored encrypted. A reused, expired or foreign token is rejected and logged.
- **API rules:** in v1, the owner alone can access everything. The blind judging endpoint never returns contender fields.
- **MCP tokens are scoped.** Read-only for castings and the leaderboard. The only write scope is attempt reports.
- **Egress:** the SSRF guard allows only the configured provider hosts.
- **Rate limits** apply to the report route and the auth routes.
- **Development and cloud sessions use the mock provider only.** No real provider keys ever enter the repo, tests or Claude Code cloud sessions.

## Phases

Phase 1 proves the whole loop — tasks → runs → judging → casting — with API and handoff contenders. Each later phase adds capability without changing the core records.

| Phase | Scope | Done when |
| --- | --- | --- |
| 1 — Core loop | Workspaces, stages, roles, tasks; connections and contenders; API and handoff modes; rubric and pairwise judging by human and AI; leaderboard; casting; MCP read of castings | All four reference workspaces run end to end against the mock provider, then against one real provider locally |
| 2 — Living arena | Composer utility role; scheduled runs; outcome verdicts; push and email alerts; guest voters; vector match of new tasks to roles; Levare reads castings | A scheduled role reruns unattended and a delayed outcome verdict lands on its due date |
| 3 — Runners | Automated runners for harness contenders, with sandboxes outside Vaultbase reporting through signed webhooks | A coding task runs on two harnesses with no manual step |

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
| T0 Foundations | Repo layout and Bun scripts; download and checksum the pinned Vaultbase binary; start and stop scripts; schema and API rules as code; seed script for the four reference workspaces; a deterministic mock provider (text and image); a test harness that boots a fresh instance per run | From a fresh clone, one command boots Vaultbase, applies the schema, seeds, and `bun test` passes schema and rule tests. The open questions marked for T0 are answered in `docs/NOTES.md`. |
| T1 API execution | Run → attempt fan-out; queue worker; provider adapters (Anthropic, OpenAI-compatible, mock); measured metrics; retries and failure handling | A run of 2 tasks × 3 contenders × 2 repetitions against the mock produces 12 submitted attempts with metrics. Injected failures are recorded as failed attempts and nothing crashes. |
| T2 Handoff | Generic, coding-harness and app templates; rendering; report token issue and checks; report route plus the MCP path; manual submission; stale-attempt cron | Each template kind renders correctly from a seeded task. A valid token submits exactly once. Reused, expired and foreign tokens are rejected. A stale attempt is flagged. |
| T3 Judging and fitness | AI rubric judge (through the mock); pairwise pairing; human verdict API; blind payload; leaderboard view; fitness; casting suggestion and confirmation; same-provider warning | Seeded results give a deterministic leaderboard. The blind endpoint never returns contender fields. A casting is suggested only above the minimum attempt count. |
| T4 UI | Editors for workspaces, roles and tasks; connection and contender setup; run builder; live run view; handoff copy screen; blind judging screen; leaderboard and casting | A browser walkthrough of all four reference workspaces against the mock works end to end, with no framework, at desktop and phone width. |
| T5 Integration | End-to-end runs of the four reference workspaces; README and operations notes; fixes for gaps found | All four workspaces complete the loop (tasks → runs → judging → casting) with no special cases. |

## Orchestrator rules

These rules bind the Claude Code Project orchestrator and every thread it starts.

1. `docs/SPEC.md` is the source of truth. A change to the spec is proposed in a PR, never made silently inside a feature branch.
2. Threads run in order: Interview, then Requirements, then Design and Architecture in parallel, then the build threads. T0 merges before T1–T4 start in parallel; T5 starts once T1–T4 are merged; Release starts after T5. The Review thread checks every build PR before I merge it.
3. One branch per thread. A thread ends at an open PR: it never merges, never pushes to `main`, and never force-pushes.
4. Evidence before fixes. Read the pinned Vaultbase version's docs before using a feature. When behaviour differs from the docs, record the finding in `docs/NOTES.md` instead of guessing a workaround.
5. Every PR passes `bun test` against a fresh Vaultbase instance, and its description includes the test output.
6. Mock provider only. No real API keys anywhere.
7. No frameworks, no runtime dependencies. Any dev dependency needs a one-line reason in the PR.
8. Stay inside the thread's boundary. A need that crosses threads goes to the orchestrator as a question.
9. Stop and ask me before a schema change after T0, any scope addition, or a Vaultbase version change.
10. Each thread reports: what was done, the evidence, and open questions.

## Reference workspaces

Four seeded workspaces test that the model is generic. If all four run without special cases, the design holds.

| Workspace | Shape | Contenders | Judging | Proves |
| --- | --- | --- | --- | --- |
| Software Factory | Multi-stage: research, spec, back-end, UI | API models plus coding harnesses by handoff | AI rubric, objective checks, blind human pairwise | Stages, the coding-harness template, self-reported metrics |
| Marketing Pipeline | No stages: social posts, branding copy, images | API models, including an image model | Blind pairwise; image grid | Image output, pairwise ratings |
| Stock Review | One role, one contender | One API model | Rubric score now; outcome verdict later (Phase 2) | The single-contender path, absolute thresholds |
| Travel Research | One role, non-technical | ChatGPT and Perplexity apps by handoff | Human rubric | The app template, manual return |

## Open questions

T0 answers the first four from the Vaultbase docs and records the answers in `docs/NOTES.md`. The rest wait for later phases.

- [ ] How is the schema kept as code: a schema snapshot, the migrate CLI, or a seed script?
- [ ] Can Vaultbase serve the static UI itself, or does the UI need its own host (for example a Cloudflare Worker)?
- [ ] Is the `@vaultbase/sdk` client worth taking on, or is plain `fetch` plus WebSocket enough?
- [ ] Can a cloud session download the pinned release from GitHub, or does the binary need to be committed or cached?
- [ ] Is vector search reachable through MCP, or only through a custom route? (Phase 2)
- [ ] How do the image-judging grid and screenshot capture for UI tasks work? (Phase 1 UI decides)
- [ ] Does "Audition" need a qualifier or distinct domain to stay clear of Adobe Audition, if this is ever offered publicly?

## Sources

- [Vaultbase site](https://vaultbase.dev/)
- [Vaultbase docs](https://docs.vaultbase.dev/)
- [vaultbase-sh/vaultbase on GitHub](https://github.com/vaultbase-sh/vaultbase)
