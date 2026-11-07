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

## Design thread choices (Nov 6, 2026)

The wireframes, tokens and design decisions are in `docs/design/`. The decisions for Cas to confirm are listed in `docs/design/README.md` under "Decisions made in this thread". The image-judging grid question in the spec is answered there.

## T0 findings (Nov 6, 2026)

The T0 build thread ran the pinned binary in a Claude Code cloud session (Cas approved running it on Nov 6, 2026). Each item below names the command or test that checked it against Vaultbase **0.40.2** (`vaultbase-linux-x64`, SHA-256 `b8181569…f757`). The tests are in `test/`, and `bun test` runs all of them on fresh instances.

### Open questions for T0

- **O3. Can a cloud session run the binary? Yes**, once Cas approved it. The safety check that stopped the Architecture thread stopped this thread too, until Cas said yes. Evidence:

  ```
  $ sha256sum -c <(grep ' vaultbase-linux-x64$' SHA256SUMS)
  vaultbase-linux-x64: OK
  $ ./vaultbase-linux-x64 --version
  vaultbase 0.40.2
  $ curl -s localhost:18091/api/health
  {"data":{"status":"ok","version":"0.40.2","maintenance":null}}
  ```

- **O4. Table and column names for the leaderboard view.** Collections are tables named `vb_<name>`. A relation column holds the target id as text. The view query in TECH-SPEC §6 works as written. `test/schema.test.ts` seeds two scored outputs, plus an overridden verdict that must not count, and reads `n = 2`, `mean_score = 3.5`, `sum_sq = 25`, `mean_tokens = 450` and `mean_time_ms = 1500`. In the snapshot, the view's columns are typed `text`, so read the numbers with `Number()`.
- **O5. Does `--apply-snapshot` create the view after its tables on a fresh data folder? Yes.** The snapshot lists the view last, and one pass creates everything: `applied snapshot: 14 created, 0 updated, 0 unchanged` (13 collections plus the view). Starting again on the same folder logs `0 created, 0 updated, 14 unchanged`.
- **Changing a table the view reads** (the 0.39.0 note). Adding a field to `attempts` with the view in place applied without a 409. If a later change is refused with 409, delete the `leaderboard` collection (`DELETE /api/v1/collections/<id>` as the admin) and apply the snapshot again, which recreates it. That sequence was tried and worked.

### Q1 to Q4 confirmed

- **Q1. Schema as code.** `schema/snapshot.json` is applied at start with `--apply-snapshot schema/snapshot.json --snapshot-mode sync`. The file is Vaultbase's own export (`GET /api/v1/admin/migrations/snapshot`), so `POST /api/v1/admin/migrations/diff` on a fresh instance is empty (`test/schema.test.ts`). One detail: an auth collection's entry must list the implicit `email` and `verified` fields, or the diff reports them as removed.
- **Q2. The UI is served by a custom route.** `GET /api/custom/app/*` (`vb_hooks/routes/app.ts`) serves `ui/dist` with a strict CSP. An unknown path serves `index.html`, and traversal is refused (`test/app.test.ts`). The route path `/app/*` also matches `/app/`.
- **Q3. Plain `fetch`, no SDK.** The scripts and tests use `fetch` only. Records are at `/api/v1/<collection>`; `/api/<collection>` answers 404. Custom routes are at `/api/custom/...` and `/api/v1/custom/...`.
- **Q4. A cloud session downloads and runs the pinned release.** `bun run setup` downloads it through the session proxy and checks the SHA-256 (`test/setup.test.ts`, with a local server standing in for GitHub). Running it needed Cas's approval (O3).

### F1 to F8 confirmed

- **F1. Hook helpers can't write records.** The helper keys are `abort, cron, db, email, enqueue, fetch, find, flags, fs, http, id, log, mails, notify, os, path, query, recordRule, security, slug, sql, template, util, uuid, webhooks`, with no create or update. A `store.ts` write adds no record-history entry, while a REST write does (`test/findings.test.ts`). `store.ts` reads each field's storage form from `vaultbase_collections.fields`, and its writes read back through REST exactly like REST writes (`test/store.test.ts`). The REST API returns the timestamps as `created` and `updated` (unix seconds); the columns are `created_at` and `updated_at`.
- **F2. Encrypted fields come back decrypted** to anyone the rules let read them. The admin reads `api_key` in plain text, and the stored value is ciphertext. With `connection_keys` (list and view admin-only), the owner never gets the key back: not from create (`{"data":null}`), update, list, view, filter, expand or batch. `has_key` follows create and delete (`test/keys.test.ts`).
- **F3. The egress guard refuses loopback and private ranges** from hook code: `helpers.http: egress to http://127.0.0.1:…/api/health blocked — resolved IP 127.0.0.1 is in denylist range 127.0.0.0/8` (also `10.0.0.1` and `169.254.169.254`).
- **F4. Custom routes parse JSON and text bodies only.** A multipart POST reaches the route with `body = null`. The upload endpoint's own checks (MIME allowlist, `maxSize`) couldn't be checked against the binary, because of F9.
- **F5. Settings.** `PATCH /api/v1/admin/settings` with `queues.timeout_ms = 900000` and `auth.mfa.enabled = true` is applied by `bun run dev` and the test harness, and read back (`test/findings.test.ts`).
- **F6. `helpers.template` has no loops.** `{{#if a}}yes {{name}}{{/if}}` renders `yes Ada` and `{{nested.repo}}` renders `r`, but `{{#each list}}[{{this}}]{{/each}}` comes back as `{{#each list}}[]{{/each}}`.
- **F7. Hook files.** The folder loads at start (`vaultbase: hooks folder …/vb_hooks`), and every hook and route in it runs (the hook tests). Vaultbase writes only `vaultbase.d.ts` into the folder, with types for hook files. It is committed. Inside a hook, `ctx.auth` is `{ type: "admin" }` for the admin and `{ type: "user", collection: "users" }` for the owner, and `ctx.record` on an update is the patch only, so hooks merge it with `ctx.existing`.
- **F8. Anthropic temperature** is about the Anthropic API, not Vaultbase. The contender hook drops `temperature` for Anthropic connections (`test/validation.test.ts`).

### New findings

- **F9. Uploads through `POST /api/v1/files/:collection/:id/:field` always fail in the 0.40.2 binary.** Every multipart body gets `400 {"error":"Send the file as multipart/form-data, in a field named 'file'"}`. That happens with curl and with fetch, as the admin and as the owner, and with read workers on or off. The likely cause: the route reads `request.formData()` itself but doesn't set `parse: "none"`, as the backup restore route does. The framework then reads the multipart body first, so the handler finds it already used up. The binary also logs a framework warning (`[Sucrose] unexpected isContextPassToFunction error`). 0.40.2 is the newest release, so no version fixes it yet. Serving files (`GET /api/v1/files/<name>`) works. `test/files.test.ts` asserts the current behaviour, so it fails as soon as an upgrade fixes it. For T0, the seed attaches its fixtures through an admin-only route (`POST /api/custom/seed/attach`, base64 JSON) that calls `lib/files.ts`. How the owner uploads (T2 handoff files, T4 task attachments) is open question O6.
- **F10. A relation field can't be `multiple` any more** (0.36 changelog: "A relation field can't be made `multiple` any more"). `runs.tasks` and `runs.contenders` are therefore JSON lists of ids. A run's tasks and contenders can also be read back from its attempts.
- **F11. The count is 13 collections plus the view**, not 14. TECH-SPEC §6 lists 13 base or auth collections; SPEC and TECH-SPEC are corrected in this PR.
- **F12. Rules and responses.** An anonymous list answers `200` with no rows rather than 401. A create whose result the caller may not view answers `{"data":null}`. A `restrict` relation refuses a delete with 409 before any `beforeDelete` hook runs. Admin requests bypass the rules but still run the hooks, so the hooks let the admin set `locked` (seeding, operations). The admin can register users through `POST /api/v1/auth/users/register` while sign-up is closed (`create_rule = ""`). A field option can't set a default, so the hooks fill the defaults (judge `me`, 5 outputs, quality-only weights, pass mark 3.5, 16,000 max output tokens, `enabled`).
- **F13. Text files are served as `application/octet-stream`.** Images and PDFs keep their own type.
- **Provider keys in the environment.** A Claude Code session sets `ANTHROPIC_BASE_URL` for itself. The fail-fast check therefore refuses only key-like names (`…KEY`, `…TOKEN`, `…SECRET`), and Vaultbase is started without any `ANTHROPIC_*` or `OPENAI_*` variable.

### T0 choices to confirm

- **Mock images** are drawn by `vb_hooks/lib/png.ts`, a 60-line PNG encoder, rather than read from `seed/fixtures/images/`. That avoids file paths inside bundled hook code. `scripts/make-fixtures.ts` writes the same images to `seed/fixtures/images/`.
- **The mock judge** takes the criteria names as `criteria` on its input, and the flaky mock takes `tryNumber`. T1 and T3 pass these.
- **The generic template's `return_instructions`** holds one line per output type (`text: …`, `image: …`, `file: …`, `code: …`), and T2's `lib/handoff.ts` picks the task's line.
- **The demo repo** is `go4cas/audition-factory-demo`, which Cas created on Nov 6, 2026. Its contents are in `fixtures/factory-demo/` (a Bun app with a JSON settings store, `GET /api/settings`, three tests, `settings-spec.md` and `mockup.png`) for Cas to push. The seeded coding tasks name the placeholder commit `0000000` until then.

## T1 findings (Nov 7, 2026)

T1 (API execution) checked these against the pinned Vaultbase **0.40.2** binary; the tests are `test/runs.test.ts` (on a fresh instance) and `test/providers.test.ts` (fake `http`, no server).

### Confirmed against the binary

- **F14. Server code reads `connection_keys` despite its admin-only rules.** `helpers.query("connection_keys", { filter })` in a worker returns the record with `api_key` decrypted, so the generate worker gets the key while the owner still can't list or view it. Test: an OpenAI-compatible contender with a key gets past "no API key" and is stopped by the egress denylist instead, and no response contains the key.
- **F15. A worker's `retries` is the total number of tries.** Vaultbase re-queues a job only while `job.attempt < retries` (`src/core/queues.ts`, `runJob`), so `retries: 1` means one try and no retry, as §8 wants. The generate worker never throws: the `fail` mock's job ends `succeeded` in `vaultbase_jobs_log`, with its attempt `failed`.
- **F16. Attempt order for the mock seed.** `n` (earlier attempts of a task by a contender) is counted by SQLite `rowid`, which follows insert order, because `created_at` has one-second resolution and a quick Run again shares the second. Run again therefore gives the erratic mock new, repeatable outputs.
- **F17. A route path's parameters don't clash.** `POST /runs`, `POST /runs/preview`, `POST /runs/:id/again` and `GET /runs/:id` are four route files, and each one gets only its own requests.
- **Egress (F3) in practice.** A connection with `base_url` `https://127.0.0.1:1/v1` fails with Vaultbase's `egress … blocked` message, and the attempt records it. Audition's own host check (`lib/providers/index.ts`, `egressGuard`) refuses any URL whose host isn't the connection's before Vaultbase sees it.

### T1 choices to confirm

- **Prompt rendering.** T2's `lib/handoff.ts` owns the renderer. T1 and T2 agreed its interface (`promptForTask(helpers, taskId)`). Until T2 merges, `routes/runs-start.ts` and `routes/runs-again.ts` use a minimal stand-in, `fallbackPromptForTask` in `lib/runs.ts`, which renders the same template. Whichever of T1 and T2 merges second (or T5) switches the two imports and deletes the stand-in.
- **The retry evidence for the flaky mock** is the worker's log line `generate attempt=<id> status=submitted calls=2`. `attempts` has no call-count field, and adding one would be a schema change. The in-process mock retries a retryable error up to 3 tries, as `helpers.http` does for real providers.
- **The AI judge contender is locked** when a run uses it, like the contenders it judges, so verdicts stay tied to the exact judge configuration.
- **Call count with the mock judge.** `judge_calls` always shows how many outputs the AI judge will score. Calls to the mock judge are left out of `total_provider_calls` (and `runs.call_count`) because they cost nothing (§8).
- **An extra warning** appears when the AI judge is itself one of the run's contenders ("it judges its own output").
- **An empty answer is a failure.** A reply with no text and no files fails the output, and says so when it was cut off at max output tokens.
- **Attachments to API contenders.** Images (PNG, JPEG, GIF, WebP) and PDFs go as base64 blocks, and text files (`.txt`, `.md`, `.csv`, `.log`, `.json`, or any `text/*` type) as text blocks headed with the file name. Anything else, SVG and zip included, is listed by name. The OpenAI-compatible adapter lists PDFs by name too.
- **One extra file**, `lib/providers/shared.ts`, holds what the two HTTP adapters share (the `http` type, attachment sorting, error mapping). Without it the adapters would import `index.ts`, which imports them.
