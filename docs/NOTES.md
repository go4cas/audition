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

- **F9. Uploads through `POST /api/v1/files/:collection/:id/:field` always fail in the 0.40.2 binary.** Every multipart body gets `400 {"error":"Send the file as multipart/form-data, in a field named 'file'"}`. That happens with curl and with fetch, as the admin and as the owner, and with read workers on or off. The likely cause: the route reads `request.formData()` itself but doesn't set `parse: "none"`, as the backup restore route does. The framework then reads the multipart body first, so the handler finds it already used up. The binary also logs a framework warning (`[Sucrose] unexpected isContextPassToFunction error`). 0.40.2 was then the newest release, so no version fixed it yet. **Fixed in 0.41.1** (the rate limiter's batch check read every request's body before the route did); since the 0.44.0 upgrade `test/files.test.ts` checks that the owner can upload through the endpoint and save the returned name on the record. Serving files (`GET /api/v1/files/<name>`) works. `test/files.test.ts` asserts the current behaviour, so it fails as soon as an upgrade fixes it. For T0, the seed attaches its fixtures through an admin-only route (`POST /api/custom/seed/attach`, base64 JSON) that calls `lib/files.ts`. How the owner uploads (T2 handoff files, T4 task attachments) is open question O6.
- **F10. A relation field can't be `multiple` any more** (0.36 changelog: "A relation field can't be made `multiple` any more"). `runs.tasks` and `runs.contenders` are therefore JSON lists of ids. A run's tasks and contenders can also be read back from its attempts.
- **F11. The count is 13 collections plus the view**, not 14. TECH-SPEC §6 lists 13 base or auth collections; SPEC and TECH-SPEC are corrected in this PR.
- **F12. Rules and responses.** An anonymous list answers `200` with no rows rather than 401. A create whose result the caller may not view answers `{"data":null}`. A `restrict` relation refuses a delete with 409 before any `beforeDelete` hook runs. Admin requests bypass the rules but still run the hooks, so the hooks let the admin set `locked` (seeding, operations). The admin can register users through `POST /api/v1/auth/users/register` while sign-up is closed (`create_rule = ""`). A field option can't set a default, so the hooks fill the defaults (judge `me`, 5 outputs, quality-only weights, pass mark 3.5, 16,000 max output tokens, `enabled`).
- **F13. Text files are served as `application/octet-stream`.** Images and PDFs keep their own type.
- **Provider keys in the environment.** A Claude Code session sets `ANTHROPIC_BASE_URL` for itself. The fail-fast check therefore refuses only key-like names (`…KEY`, `…TOKEN`, `…SECRET`), and Vaultbase is started without any `ANTHROPIC_*` or `OPENAI_*` variable.

### T0 choices to confirm

- **Mock images** are drawn by `vb_hooks/lib/png.ts`, a 60-line PNG encoder, rather than read from `seed/fixtures/images/`. That avoids file paths inside bundled hook code. `scripts/make-fixtures.ts` writes the same images to `seed/fixtures/images/`.
- **The mock judge** takes the criteria names as `criteria` on its input, and the flaky mock takes `tryNumber`. T1 and T3 pass these.
- **The generic template's `return_instructions`** holds one line per output type (`text: …`, `image: …`, `file: …`, `code: …`), and T2's `lib/handoff.ts` picks the task's line.
- **The demo repo** is `go4cas/audition-factory-demo`, which Cas created on Nov 6, 2026. Its contents are in `fixtures/factory-demo/` (a Bun app with a JSON settings store, `GET /api/settings`, three tests, `settings-spec.md` and `mockup.png`) Cas pushed them on Nov 7, 2026 (commit `9c4bb7aef4c84adaf7b5aa523c1e56f9fada8a55`, identical to `fixtures/factory-demo/`), and the seeded coding tasks name that commit. Cas accepted the other T0 choices above on Nov 7, 2026.

## T2 findings (Nov 7, 2026)

The T2 Handoff thread checked these against Vaultbase **0.40.2** (same binary and checksum as T0). `test/handoff.test.ts` and `test/handoff-lib.test.ts` cover them.

- **F14. Update rules are checked on the record before and after the change.** `checkUpdateRule` (`src/api/_rules.ts`, v0.40.2) evaluates the rule on the current record and again on the current record merged with the patch, and allows the write only if both pass. The spec's attempts rule, `OWNER && mode = "handoff" && status = "waiting"`, therefore refuses the submit itself: `PATCH /api/v1/attempts/<id>` with `{"output":"Use SQLite.","status":"submitted"}` answered `403 {"error":"Forbidden","code":403}` on a waiting handoff output. Fix (pending Cas's approval, as it is a schema change): the rule becomes `OWNER && mode = "handoff" && (status = "waiting" || (status = "submitted" && @request.body.status = "submitted" && @request.body.status:changed = true))`, which allows exactly one transition, waiting to submitted. A later PATCH on a submitted output fails the rule on the current record. (Unchanged at 0.44.0, by design: `checkUpdateRule` is the same there. `helpers.records` applies no API rules, so F14 doesn't touch server writes.) `:changed` must sit in a comparison (`= true`); a bare `@request.body.status:changed` is refused at start with `snapshot error in collection 'attempts': Collection validation failed`.
- **F15. A custom route can read a multipart body itself.** F4 holds (`ctx.body` is not the form), but `ctx.req.formData()` works inside a custom route, because the route dispatcher clones only JSON and text bodies. A 26 MB multipart file reached a test route intact (`size: 27262976`, `bodyUsed: false`). This makes an owner upload route possible without base64 (open question O6).
- **O6 (proposed). Owner uploads go through `POST /api/custom/files/:collection/:id/:field`** until Vaultbase's own endpoint is fixed (F9). It takes `multipart/form-data` with one or more parts named `file`, only for `attempts/output_files` (handoff, waiting) and `tasks/attachments` (unlocked), and applies 25 MB per file, the Phase 1 types by extension (text, PNG, JPEG, GIF, WebP, PDF, zip), and a magic-byte check for binary types, all or nothing. It stores each file through `lib/files.ts` with the MIME type F4 prescribes, and returns the updated record. Cas has the choice in the T2 thread.

### T2 choices to confirm

- **Return instructions.** `lib/handoff.ts` picks the `type: …` line of the template's `return_instructions` for the task's output type. A template without such prefixes applies its text to every type, and a missing type falls back to the spec's line (§9).
- **Editor HTML to text.** Paragraphs and headings become blank-line-separated text, `<br>` a line break, list items `- item`, entities are decoded, and script and style content is dropped.
- **Rubric lines** without guidance read `2. Clarity (40%)`, with no trailing colon.
- **Drafts.** The owner may save `output` and the metrics while the output is waiting, without submitting.
- **Files on PATCH.** A PATCH may keep or drop files already uploaded to that output, but can't name any other file. On submit, every file is re-checked against the Phase 1 list (F4).
- **Run status and cost.** Until T1 merges, `lib/handoff.ts` carries the run-status rule (§8) and the cost formula; whichever of T1 and T2 merges second swaps them for `lib/runs.ts` and `lib/cost.ts`.

## T1 findings (Nov 7, 2026)

T1 (API execution) checked these against the pinned Vaultbase **0.40.2** binary; the tests are `test/runs.test.ts` (on a fresh instance) and `test/providers.test.ts` (fake `http`, no server).

### Confirmed against the binary

- **F16. Server code reads `connection_keys` despite its admin-only rules.** `helpers.query("connection_keys", { filter })` in a worker returns the record with `api_key` decrypted, so the generate worker gets the key while the owner still can't list or view it. Test: an OpenAI-compatible contender with a key gets past "no API key" and is stopped by the egress denylist instead, and no response contains the key.
- **F17. A worker's `retries` is the total number of tries.** Vaultbase re-queues a job only while `job.attempt < retries` (`src/core/queues.ts`, `runJob`), so `retries: 1` means one try and no retry, as §8 wants. The generate worker never throws: the `fail` mock's job ends `succeeded` in `vaultbase_jobs_log`, with its attempt `failed`.
- **F18. Attempt order for the mock seed.** `n` (earlier attempts of a task by a contender) is counted by SQLite `rowid`, which follows insert order, because `created_at` has one-second resolution and a quick Run again shares the second. Run again therefore gives the erratic mock new, repeatable outputs.
- **F19. A route path's parameters don't clash.** `POST /runs`, `POST /runs/preview`, `POST /runs/:id/again` and `GET /runs/:id` are four route files, and each one gets only its own requests.
- **Egress (F3) in practice.** A connection with `base_url` `https://127.0.0.1:1/v1` fails with Vaultbase's `egress … blocked` message, and the attempt records it. Audition's own host check (`lib/providers/index.ts`, `egressGuard`) refuses any URL whose host isn't the connection's before Vaultbase sees it.

### T1 choices to confirm

- **Prompt rendering** uses T2's `lib/handoff.ts` `promptForTask` (T2 merged first). T1 replaced the stand-in, and `lib/handoff.ts` now uses T1's `refreshRunStatus` (`lib/runs.ts`) and `deriveCost` (`lib/cost.ts`) in place of its own copies.
- **The retry evidence for the flaky mock** is `attempts.provider_calls` (2 for the flaky mock, 1 otherwise), added on Nov 7, 2026 after Cas approved the schema change, and shown on the run page as "Took N tries" when above 1. The worker's log line `generate attempt=<id> status=… calls=N` stays.
- **The AI judge contender is locked** when a run uses it, like the contenders it judges, so verdicts stay tied to the exact judge configuration. Cas confirmed this on Nov 7, 2026.
- **Call count with the mock judge.** `judge_calls` always shows how many outputs the AI judge will score. Calls to the mock judge are left out of `total_provider_calls` (and `runs.call_count`) because they cost nothing (§8).
- **An extra warning** appears when the AI judge is itself one of the run's contenders ("it judges its own output").
- **An empty answer is a failure.** A reply with no text and no files fails the output, and says so when it was cut off at max output tokens.
- **Attachments to API contenders.** Images (PNG, JPEG, GIF, WebP) and PDFs go as base64 blocks, and text files (`.txt`, `.md`, `.csv`, `.log`, `.json`, or any `text/*` type) as text blocks headed with the file name. Anything else, SVG and zip included, is listed by name. The OpenAI-compatible adapter lists PDFs by name too.
- **One extra file**, `lib/providers/shared.ts`, holds what the two HTTP adapters share (the `http` type, attachment sorting, error mapping). Without it the adapters would import `index.ts`, which imports them.

## T3 findings (Nov 7, 2026)

The T3 build thread (judging and fitness) ran against Vaultbase **0.40.2** on fresh instances. Behaviour claims were read from the source at tag v0.40.2 and then checked by the tests named.

### Findings

- **T3-F1. After-hooks are fire and forget.** `runAfterHook` (`src/core/hooks.ts`) runs after the response is sent and only logs errors. So when the owner posts a verdict, the response comes back `active` before the `afterCreate` hook has marked the AI verdict `overridden`, the output `judged` and the run `done`. The UI (T4) should re-fetch the judging payload after saving, not trust the order. `test/judging.test.ts` waits for the hook to finish.
- **T3-F2. Workers load from `vb_hooks/workers/`.** `workers/judge.ts` (`defineWorker`, queue `judge`) picks up the jobs that `lib/runs.ts` (generate) and `lib/handoff.ts` (submit) enqueue within a second. Like generate, it sets `retries: 1`, which is one try (F17), because `lib/judge.ts` retries a bad reply once itself and never throws for a provider or reply problem.
- **T3-F3. `helpers.find` and `helpers.query` read through the records layer**, so JSON fields come back decoded and view columns come back as text (as O4 found). The leaderboard route reads the `leaderboard` view through `helpers.query` and parses the numbers with `Number()`.
- **T3-F4. The admin passes the verdict hook unchanged.** As with `locked` (F12), the admin may write any verdict through REST, so T0's `store.ts` round-trip test still holds. The owner gets the full checks. The T0 rules test now creates its owner verdict on a submitted output with stars for every criterion, since the hook refuses the old body.

### T3 choices to confirm

- **Route responses use T1's `ownerRoute`** (`lib/runs.ts`), so like every custom route they answer `{ data: … }`: the leaderboard `{ terms_used, dropped, rows, suggested, casting }`, the judging route the §10 payload, and `POST /castings` `{ casting }`. Errors are `{ error, code }`.
- **The blind payload adds two harmless fields**: `task.id`, and `status` (`active` or `overridden`) on each `verdict.history` entry, so the UI can show the AI's stars as overridden.
- **A provider error from the judge is final.** `helpers.http` has already retried the network, so the judge doesn't call again. Only a reply that misses the rubric is retried once. Either way the output stays `submitted`, `attempt.error` says "AI judging failed: …", and the owner judges it by hand.
- **If an owner verdict lands first**, a late AI verdict is stored as `overridden`, so it stays in the history without replacing the owner's stars.
- **Dropped terms** are listed only when their weight is above 0. With the default weights (quality only), `dropped` is always empty.
- **Rows are sorted best first**: by fitness, then mean score, then number of outputs, then name. That is the same order as the champion tie-break.

- **Neutral file names when judging (Cas, Nov 7, 2026).** On the blind judging screen, each output's files are named by the output's label, a number from 1 in upload order, and the original extension in lower case: `A-1.png`, `A-2.pdf`, `B-1.png`. The AI judge sees `file-1.png`, `file-2.pdf`, and so on, because it judges one output at a time. A file's own name (`chatgpt-image.png`) can therefore reveal neither the tool nor sway the judge. Nothing is renamed in storage: the file stays on its output record, and `vaultbase_files.original_name` keeps the uploaded name.

### Shared with T1 and T2 (after merging main)

- The run status refresh is T1's `lib/runs.ts` `refreshRunStatus`; the judging screen's `prompt_text` uses T2's `lib/handoff.ts` `htmlToText`. T3's own copies were removed.
- The judge worker calls the judge through T1's `lib/providers/index.ts` `callProvider`, and reads its key through `helpers.query` (F16), as the generate worker does.
- The same-provider warning is T1's `lib/runs.ts` `sameProviderWarnings` (preview, Done-when 7, tested in `test/runs.test.ts`). T3's copy was removed.
- Done-when 9 is checked where the judge hands the request to the provider: both PNGs as attachments and a note naming the skipped SVG. T1's Anthropic adapter turns those attachments into `image` blocks (`test/providers.test.ts`, golden request).
- `test/judging.test.ts` now also runs Done-when 1 end to end: `POST /runs` with an AI judge, the generate worker, the judge worker, and the run ending `done`.
- **The demo repo** is `go4cas/audition-factory-demo`, which Cas created on Nov 6, 2026. Its contents are in `fixtures/factory-demo/` (a Bun app with a JSON settings store, `GET /api/settings`, three tests, `settings-spec.md` and `mockup.png`) for Cas to push. The seeded coding tasks name the placeholder commit `0000000` until then. (Since done: Cas pushed it on Nov 7, 2026, and the seed names commit `9c4bb7a`; see T5 below.)

## T4 findings (Nov 7, 2026)

- **U1. The CSP blocks `style` attributes.** `style-src 'self'` stops the avatar hue, the progress bars and the likely-range markers, which are set per record. `routes/app.ts` adds `style-src-attr 'unsafe-inline'` for the app's own pages only. Inline `<style>` and `<script>` stay blocked (`test/app.test.ts`).
- **U2. Files need the bearer header.** `GET /api/v1/files/<name>` refuses a `?token=` query, so an `<img src>` can't show a protected file. The UI fetches each file with the owner's token and shows it through a `blob:` URL (the CSP already allows `blob:`).
- **U3. Arrow.js 1.0.6 quirks.** An expression must fill a whole attribute (`class="${"num" + x}"`, not `class="num${x}"`), or the template throws "Invalid HTML position". An expression can't sit inside `<textarea>`; use `value="${…}"`. A `File` can't live inside `reactive()` state (the Proxy breaks its native getters), so the file picker keeps `{key, name, size}` in state and the `File` aside. A reactive list redraws reliably when the array is replaced, not pushed to. Any reactive read in an expression becomes a dependency, so each page body is mounted once and only small parts are reactive.
- **U4. Task attachments on a new version.** "Duplicate and edit" creates the new task, then fetches each attachment of the old version and uploads it again through the owner upload route, because a create can't carry attachment names (422 "upload files to the record after creating it").
- **U5. The UI build is 194 KB of unminified JS**, over the 150 KB in T4 Done-when 3. Arrow.js adds about 52 KB of it. Minified it is 132 KB, about 49 KB gzipped. CSS is 73 KB. `test/ui.test.ts` prints the sizes and guards against growth past 210 KB. Open question for Cas: raise the budget, or minify the bundle.
- **U6. The walkthrough drives the T1 to T3 routes** (run, handoff, upload, judging, leaderboard). With T1 to T3 on main it passes 8 of 8 on a fresh Vaultbase 0.40.2.

## T5 findings (Nov 7, 2026)

The T5 integration thread ran against Vaultbase **0.40.2** on fresh instances, with the mock provider only. Each fix is its own commit, named after its finding.

- **T5-F1. `GET /api/custom/handoff/:runId/:taskId` answered its payload bare**, while every other custom route answers `{ data: … }` (T3's choices). The UI's `data()` helper accepted both, so nothing broke, but the contract was uneven. The route now uses `ownerRoute`, so it answers `{ data: { prompt, attachments, waiting } }` and errors as `{ error, code }`. `test/handoff.test.ts` reads `body.data`.
- **T5-F2. A workspace name sat in the UI's code**: the workspace name field's placeholder was the name of a seeded workspace. It now reads "For example: Content team". `test/e2e.test.ts` checks that no reference workspace name appears in `vb_hooks/`, `ui/src/`, `ui/index.html`, `scripts/` or the end-to-end test itself. `seed/` holds that content, and the tests that check the seed may name it.
- **T5-F3. On a fresh clone, `bun test` failed two files.** The first `boot()` downloaded the 127 MB binary inside a file's `beforeAll`, and bun stops a hook after 5 seconds whatever `bunfig.toml`'s test `timeout` says (`(fail) (unnamed) [5001.02ms] ^ a beforeEach/afterEach hook timed out`). `test/preload.ts` (a bunfig preload) now downloads and verifies the binary once before any file runs. With `.vaultbase/bin` removed, `bun test test/seed.test.ts` prints the checksum line and passes 9 of 9.
- **T5-F4. Small duplicated helpers** (PR #9): the owner check was copied into `routes/handoff.ts` and `routes/files-upload.ts`, and four copies of "a JSON list field as a list of strings" sat in `lib/runs.ts` (twice), `lib/scoring.ts` and `lib/handoff.ts`. There is now one `isOwner` (`lib/runs.ts`) and one `listOf` (`lib/validation.ts`); `fileList` stays exported from `lib/handoff.ts` as a name for it.

### Checks from PR #9

- **Same-provider warning before a run.** The server side is `sameProviderWarnings` (`test/runs.test.ts`). `test/ui-warning.test.ts` now checks the browser: on "Start a run", an API contender on the AI judge's provider shows "The AI judge shares a provider with …", and a mock contender with the same judge shows none.
- **Anthropic image request format.** `lib/providers/anthropic.ts` sends images as `{ type: "image", source: { type: "base64", media_type, data } }` and PDFs as `document` blocks with a base64 source, before the text, which is the Messages API's documented shape. Only PNG, JPEG, GIF and WebP go as images (`IMAGE_MIMES`); SVG is named instead. Effort goes in `output_config.effort` and the judge schema in `output_config.format` (`json_schema`). No `thinking` field is sent, which Opus 5.5 needs (it can't be turned off), and no `temperature` (F8). Nothing to change; the golden request in `test/providers.test.ts` stands.

### Done-when

1. `test/e2e.test.ts` drives each of the four seeded workspaces through the owner routes the UI uses. For every role it adds a task, previews the run, starts it, lets the mock generate, pastes the copy-and-paste outputs (a PNG for image tasks), judges with the workspace's own judge (the mock AI judge, or blind owner verdicts through the judging route), uses Run again until each contender has the workspace minimum of outputs, checks that the tasks are locked, then confirms the suggested champion through `POST /castings`. The test reads judges, roles, rubrics and output types from the API and picks contenders by output type, so it has no workspace-specific path, and it names no workspace (checked by the grep above).
2. `README.md`: setup is `git clone`, `cd`, `bun install`, `bun run dev`.
3. `docs/OPERATIONS.md` has the local Anthropic check (connection and key, an Opus 5.5 contender at high effort with prices, the Researcher run against Mock Steady judged by that contender, tokens and cost, and the image path on the Image maker task).
4. O2: `test/seed.test.ts` "coding tasks name the demo repo and its first commit (O2)" fails if `DEMO_COMMIT` is the placeholder `0000000` or not a full SHA. It passes with `9c4bb7aef4c84adaf7b5aa523c1e56f9fada8a55`.

## Review findings (Nov 7, 2026)

The Review thread checked `main` at `f4c69a3` (PRs #5 to #13 merged) against every Done-when item in TECH-SPEC §15 and the spec. It changed no code. Evidence:

- **`bun test` on a fresh clone**, with no `.vaultbase/` folder, so the pinned binary was downloaded and checked first: `Verified vaultbase-linux-x64 0.40.2 (sha256 b8181569…f757, 126728368 bytes)`, then `254 pass, 0 fail, 4268 expect() calls, Ran 254 tests across 27 files [114.44s]`.
- **`bun run dev` on the same clone** (port 18091): built the UI, started Vaultbase, `Seed: 41 created, 0 already there`, and printed the sign-ins and `http://127.0.0.1:18091/api/custom/app/`. That URL answered `200 text/html`, and `/api/health` reported `0.40.2`.
- **Every build PR (#5 to #13) has `bun test` output** in its description, with 0 failures.

### Result per thread

| Thread | Done-when | Result |
| --- | --- | --- |
| T0 | 1 fresh clone boots, checksum, snapshot, sign-ins, seed, URL | Pass (above; a tampered binary is refused in `test/setup.test.ts`) |
| T0 | 2 schema, later fields, rules, keys, locking, weights, store, files, mock, seed twice, vb:bump, upgrade | Pass (all 12, `schema`, `rules`, `keys`, `locking`, `validation`, `store`, `files`, `mock`, `seed`, `setup`, `upgrade` tests) |
| T0 | 3 Q1 to Q4, F1 to F8, O3 to O5 in NOTES | Pass (see R4 for stale wording) |
| T1 | 1 to 9 | Pass (`test/runs.test.ts`, `test/providers.test.ts`; Run again compares the first run's rows byte for byte) |
| T2 | 1 to 5 | Pass (`test/handoff.test.ts`, `test/handoff-lib.test.ts`) |
| T3 | 1 to 9 | Pass (`judging`, `blind`, `leaderboard`, `fitness`, `judge`, `runs` tests; the blind test walks every key and string value) |
| T4 | 1 browser walkthrough of all four workspaces | Pass, 8 of 8 (see R2 for what it leaves out) |
| T4 | 2 screenshots at 1280 and 375 px | Pass (18 pairs in PR #10 and `docs/screens/t4/`) |
| T4 | 3 one runtime dependency, no Tailwind or Vite, build under 150 KB unminified | **Fail on size**: JS is 194.6 KB unminified (CSS 72.5 KB more). The dependency part passes. See R1. |
| T4 | 4 judging screen reads only the blind route | Pass (`test/ui.test.ts`) |
| T4 | 5 "outputs", never "attempts" | Pass (`test/ui.test.ts`) |
| T5 | 1 four workspaces end to end, no workspace-specific path, no names outside `seed/` | Pass, with notes R2 and R3 |
| T5 | 2 README setup in five commands or fewer | Pass (four: clone, cd, install, dev) |
| T5 | 3 OPERATIONS has the local Anthropic check | Pass (every step in §15 T5.3 is there) |
| T5 | 4 placeholder commit check (O2) | Pass (`test/seed.test.ts`, commit `9c4bb7a…`) |

### Findings

- **R1. The UI bundle is over budget (T4 Done-when 3, known as U5).** 194.6 KB of unminified JS against 150 KB; `test/ui.test.ts` only guards 210 KB. Minified it is about 132 KB. The Done-when says "under 150 KB unminified", so minifying passes the budget only if that wording changes to "minified" too. It is also silent on whether CSS (72.5 KB) counts. Cas decides.
- **R2. Two reference workspaces are not driven with their own contenders.** The spec's table gives Stock Review one contender and Travel Research "ChatGPT and Perplexity by copy and paste". `test/e2e.test.ts` casts every role by output type (Mock Steady, Mock Erratic and the first manual contender), so it never runs a one-contender run or a run with only copy-and-paste contenders. The browser walkthrough runs Stock Review with two contenders and Travel Research with the two mock API contenders, after lowering its minimum to 2. The one-contender champion path is covered at the route level (`test/leaderboard.test.ts`, "Stock Review's single contender is suggested"), and handoff-only call counts in `test/runs.test.ts`, so nothing is known to be broken; the end-to-end proof for those two shapes is thinner than the spec's "Proves" column suggests.
- **R3. "A grep finds no workspace names outside `seed/`" holds for the app's code only.** `test/e2e.test.ts` checks `vb_hooks/`, `ui/src/`, `ui/index.html`, `scripts/` and itself. A literal grep also finds names in five other test files and `docs/design/wireframes.html`. None of those ship, so this reads as a wording question, not a defect.
- **R4. Stale wording in this file.** F14 still says "pending Cas's approval" and O6 says "(proposed)"; both were accepted when PR #7 merged, and the rule in `schema/snapshot.json` and TECH-SPEC §6 is the new one. TECH-SPEC §7 also still shows the handoff route's payload bare, while T5-F1 wrapped it in `{ data }` like the other routes.
- **R5. The spec's platform table lists "Audit log" for every judgement and casting in Phase 1**, but nothing uses Vaultbase's audit log, and `store.ts` writes skip record history (F1). In practice the history is kept by the records themselves: verdicts are never deleted (an override marks the AI verdict `overridden`), and `POST /castings` always adds a new casting. Either the table row moves to "records" or a later thread wires in the audit log. Cas decides.
- **R6. Auth rate limits work, but only by Vaultbase's default.** Forty wrong-password sign-ins on the dev instance gave ten `401`s, then `429 {"error":"Rate limit exceeded (rule: *:auth)"}`. Nothing in the repo sets or tests this, so a Vaultbase upgrade could change it silently. A test in the Release or upgrade work would pin it.
- **Process note.** Orchestrator rule 2 says Review checks each build PR before it merges; this review ran after PRs #5 to #13 had merged.

## Review follow-up: R1 and R2 (Nov 7, 2026)

Cas agreed to both. R5 (audit log) is being settled separately and is not touched here.

- **R1 done.** `bun run build:ui` now minifies `main.js` and writes a linked source map (`main.js.map`, served as `application/json`). TECH-SPEC T4 Done-when 3 now reads "under 150 KB minified JS (CSS is not counted), with a source map". `test/ui.test.ts` guards 150 KB and checks the map is linked. Measured: JS 129.7 KB minified (was 194.6 KB), CSS 72.5 KB unchanged.
- **R1 note: identifier minification is what gets it under budget.** Whitespace and syntax minification alone give 158 KB. With full minification the browser walkthrough first failed about one run in three; that was a race in the test, not the app (next item).
- **RF1. Walkthrough race on a stale toast.** After saving the role and the task, `test/ui-walkthrough.test.ts` waited for any toast matching `/saved/i`. "Settings saved" from the step before was often still showing, so the test went on before the task save had finished; the save's own `go("/t/…")` then landed after the test had moved to Start a run and pulled the page back. The faster minified bundle made it show up. The test now waits for "Role saved" and "Task saved" by name: 0 failures in 10 runs, against about 1 in 3 before.
- **R2 done.** Each workspace in `seed/reference.ts` may list `contenders`, the ones the SPEC's "Reference workspaces" table names (Stock Review: Mock Steady, the one API model; Travel Research: ChatGPT (manual) and Perplexity (manual)). These are not seeded as data. `test/e2e.test.ts` runs every workspace that lists them with exactly those contenders, before the by-output-type runs, so the role holds no other contender's outputs yet: Stock Review's one contender (AI judge, five runs of one task) is suggested and cast, and Travel Research's two copy-and-paste contenders (judged by Me, every output pasted) cast the one the owner rated higher. The test reads names from the seed only; it still names no workspace and has no workspace-specific path.
- **RF2. Vaultbase's default rate limit on creates is 60 per 5 s** (and 300 requests per 10 s on `/api/*`, 10 sign-ins per 3 s), read from the 0.40.2 binary; `VAULTBASE_RATE_ENABLED=0` turns it off. The longer e2e run hit `429 (rule: *:create)` once. Its owner API calls now wait a second and retry on 429, as any client would, rather than turning the limit off. Like R6, this is Vaultbase's default and nothing pins it.

## Release findings (Nov 7, 2026)

`docs/RELEASE.md` adds the server install, the systemd unit, backups and upgrades. The deploy files are in `deploy/`; `bun run provision` and `test/release.test.ts` are new. Vaultbase behaviour below was read from the source at tag v0.40.2 and checked against the binary.

- **RL1. A restore can drop the HTTP connection before it answers, but it completes.** `POST /api/v1/admin/backups/<name>/restore` on 0.40.2 sometimes ends in `ECONNRESET` instead of its `200`, most often right after another write on the same keep-alive connection. The server stays up (`/_/ready` answers 200 at once) and the data is restored. With a fresh connection it answered `200 "Restore complete…"`. RELEASE.md tells the reader to reload and run the smoke test; `test/release.test.ts` accepts either and always checks the data. Worth reporting upstream with F9.
- **RL2. `vaultbase backup --to` copies the database only.** The scheduled and on-demand backups (Settings, Backup & restore; `POST /api/v1/admin/backups`) also keep the uploaded files (`backups.files`, on by default). Neither holds `<data dir>/.encryption-key` or `.secret`, so RELEASE.md has the owner save both once at install. The rollback copy before an upgrade is therefore a cold copy of the whole data folder, not `vaultbase backup` as TECH-SPEC §1 first said; §1 now points here.
- **RL3. Production settings come from `bun run provision`,** which reuses the dev scripts' settings, owner and seed code and adds Vaultbase's backup schedule (`backups.enabled=1`, `backups.cron="0 3 * * *"`, `backups.keep=14`, `backups.files=1`). It signs in with an admin from the environment and writes no credentials file. The seed is needed in production, because it holds the generic handoff template.
- **RL4. R6 is now pinned.** `test/release.test.ts` checks that wrong owner passwords get `429` within 20 tries. RF2's create limit is still unpinned.
- **RL5. Hooks are read-only in production.** The unit allows writes only to `/var/lib/audition`, so the Vaultbase admin can't edit hook files there; they come from the release tag. The release test runs the real `vb_hooks/` read-only to prove Audition doesn't need to write there.
- **Not checked from a cloud session:** the unit under a running systemd (it passes `systemd-analyze verify`), the Caddyfile (running Caddy was not allowed here), Cloudflare, and `vaultbase update` (GitHub's API refused the session proxy). The first VPS install checks those.

## Vaultbase 0.44 upgrade (Nov 11, 2026)

Part A of `docs/PLATFORM-UPGRADES.md`, approved by Cas on Nov 11, 2026: Vaultbase 0.40.2 → **0.44.0** (tag commit `97efba2f`, `vaultbase-linux-x64` SHA-256 `a69c8f49…00a3`). Read: `CHANGELOG.md` and `release-notes/` for 0.41.0, 0.41.1, 0.42.0, 0.43.0 and 0.44.0 at tag v0.44.0, and the source of the upload endpoint (`src/api/files.ts`) and the admin's upload (`admin/src/pages/Records.tsx`). None of the five has a **Security** section. The notes that touch Audition are listed in TECH-SPEC §1.

- **V1. F9 is fixed (0.41.1), but the endpoint only stores the file.** `POST /api/v1/files/:collection/:id/:field` answers `{ data: { filename, … } }` (a list for a `multiple` field) and writes the `vaultbase_files` row; it doesn't add the name to the record's field. The client saves it with a normal update (`PATCH` with the field's new list), as Vaultbase's admin does. The upload itself checks the collection's update rule on the record, and the save runs the rule and hooks again. For part B (Q1) that means the built-in path is two requests, and a file stored by the first one stays unnamed on the record if the second is refused.
- **V2. Unknown body keys answer 400 (0.44.0)**, for example `{"error":"Unknown field 'notes' in body","code":400}` on `contenders`. System fields are still accepted, so a record saved back as it was fetched works. `test/validation.test.ts` checks both.
- **V3. `bun run vb:bump` writes no `tag_commit`.** It was added to the lock by hand from `git ls-remote https://github.com/vaultbase-sh/vaultbase 'refs/tags/v0.44.0^{}'` (TECH-SPEC §1 says so now).
- **V4. Unchanged:** F14 (above), F10 (no new `multiple` relations) and RL1 have no changelog entry and stay as they are. The owner upload route, the seed attach route and every `helpers.sql` write are untouched; moving them is part B.
- **V5. A fresh clone needs `bun install` before `bun test`,** or the UI build fails on `@arrow-js/core` and the UI and release tests fail with it.


## Server writes through the records API (Nov 11, 2026)

Part B of `docs/PLATFORM-UPGRADES.md`, with Cas's approved answers to Q1 to Q8 (Nov 11, 2026). Vaultbase 0.44.0. Read: `src/core/records-helper.ts`, `src/core/records.ts` (`createRecordImpl`, `updateRecordImpl`), `src/core/hooks.ts` (`runBeforeHook`, `runAfterHook`), `src/core/record-history.ts`, `src/api/files.ts` (upload) and `src/core/file-sweep.ts`, at tag v0.44.0.

**F1 is resolved.** `vb_hooks/lib/store.ts` keeps its two names (`insertRecord`, `updateRecord`, plus `deleteRecord`) as thin wrappers over `helpers.records`. Every server write now runs field validation and the collection's hooks, and writes record history, realtime events and webhooks. Its own storage encoder is gone: the records path encodes values (and encrypts `encrypted` fields) itself. It still refuses unknown field names, because `helpers.records` drops them silently (the REST API answers 400 since 0.44, V2).

| Collection | Server writes now through `helpers.records` | Where |
| --- | --- | --- |
| runs | create; status changes (running → judging → done) | `lib/runs.ts` (`startRun`, `refreshRunStatus`) |
| attempts | create; submitted, failed, judged, error; `output_files` of server-made files | `lib/runs.ts`, `lib/judge.ts`, `lib/scoring.ts`, `lib/files.ts` |
| verdicts | create (AI); overridden | `lib/scoring.ts` |
| castings | create | `routes/castings.ts` |
| tasks, contenders | `locked` | `lib/runs.ts` |
| connections | `has_key` | `lib/hook-logic.ts`, `routes/connections-key.ts` |
| connection_keys | delete | `routes/connections-key.ts` |

Record history is on for `runs`, `attempts`, `verdicts` and `castings` (schema change, Q4), as well as `tasks`, `contenders` and `roles`. `test/e2e.test.ts` checks every run of the end-to-end loop: the run's history has `running` and `done`, all as system; each API output's has `submitted` and `judged`, all as system; each handoff output's has the owner's own `submitted` write.

- **W1. Q1 is blocked: Vaultbase's upload endpoint can't take four of the Phase 1 types.** Bun's multipart parser (the Vaultbase binary is built with Bun) replaces each file part's declared type with the type of its file name. A Bun 1.4.4 server reading a part sent as `notes.md`/`text/plain` sees `text/markdown`; `bundle.zip`/`application/octet-stream` arrives as `application/zip`, `data.csv` as `text/csv`, `tool.exe` as `application/x-msdownload`. Vaultbase's global allowlist (`src/core/sec.ts`, `ALLOWED_UPLOAD_MIME`) has none of those, so `POST /api/v1/files/...` answered `415 {"error":"MIME type 'text/markdown' not allowed"}` for a Markdown file, whatever the client declared (the UI's F4 mapping no longer helps). The plan's condition for Q1 ("where its rules and field options cover the checks") isn't met, so the owner upload route stays (`routes/files-upload.ts`, comment updated). It now sets the record's field through the records API (`lib/files.ts`), so the record history shows the file being added, as system. Worth raising with the Vaultbase author: either honour the declared type for the allowlist check, or let a field's `mimeTypes` widen the global list.
- **W2. A `helpers.records` write carries no user, so hooks see `auth === null`.** Before, server writes never reached Audition's hooks. Now the before-hooks that refused anyone but the admin would have refused Audition itself: `attempts` (the generate worker's `submitted`), `verdicts` (the AI verdict), `tasks` and `contenders` (`locked`), `connections` (`has_key`). Each now lets "trusted" through: the admin or no user (`isTrusted` in `lib/store.ts`). An anonymous REST request also has no user, but every create, update and delete rule on those collections needs a signed-in caller, so it is refused before the hook runs (`test/rules.test.ts`, "anonymous is refused everywhere").
- **W3. After-hooks run in the background, now for server writes too.** `runAfterHook` is fire-and-forget. `verdicts-after-create` now skips server writes (`auth === null`): `storeAiVerdict` activates its own verdict before the judge worker finishes, so the outcome is final when the worker returns, and nothing runs twice. `attempts-after-update` acts only on waiting → submitted, which only the owner does. `connection_keys` after-hooks set `has_key` only when it changes, because the key route also sets it (its answer must be final). No hook writes into its own collection, so the 5-deep nesting cap of `helpers.records` isn't reached.
- **W4. Two SQL writes stay, on purpose.** (1) The generate worker's claim, `UPDATE vb_attempts SET status = 'in_progress' … WHERE status = 'queued'`: `helpers.records.update` has no "only if" form, and the claim is what stops two workers running one attempt (Q3). So the history shows `queued` → `submitted` without the `in_progress` step. (2) The `vaultbase_files` row of a file made by server code (seed fixtures, mock images): Vaultbase has no server-side file helper (Q2). `test/store.test.ts` fails if any other SQL write appears in `vb_hooks/`. The run status compare-and-set the plan listed as a bypass isn't one: its `WHERE status != ?` only skipped no-op writes, so `refreshRunStatus` now reads the status and writes through the records API when it moves.
- **W5. The upgrade test from 0.40.2 can't run any more.** It starts the old binary with today's hooks folder, and the hooks now call `helpers.records`, which 0.40.2 doesn't have (the seed's first attach answers 500). The test passes on 0.44.0 (3/3). Part B therefore needs Vaultbase 0.43 or later: it ships after part A, never on an older binary.

## Quiver 3.1 as the UI library (Nov 11, 2026)

Part C of `docs/PLATFORM-UPGRADES.md`, with Cas's approved answers to Q5 to Q7. `@go4cas/quiver` 3.1.0 is pinned exactly beside `@arrow-js/core` 1.0.6. Read: quiver's `AGENTS.md`, `src/router.js`, `src/app.js`, `src/base.js`, `src/meta.js` at 3.1.0, and Arrow's `onCleanup` and chunk recycling in `dist/index.mjs`.

- **What moved.** `ui/src/router.js` is gone. Routes are a hand-written quiver manifest (`ui/src/routes.js`) with real paths under `/api/custom/app/`; the sign-in redirect is a `beforeEach` guard (`/signin?next=<path>`); the run page's polling timer stops through `onCleanup` (`state.onLeave` in `components/page.js`); page titles come from each route's `meta.title`. Links are built with `APP` and `href()`/`go()` from `lib/nav.js`. The shell stays mounted once around quiver's outlet (`createApp({ target: "#main" })`), so toasts and the lightbox survive navigation; it reads `bare` and `section` from the route's meta. Design CSS, the sprite, `api.js` and `state/` are unchanged.
- **Old links.** A URL with `#/…` is rewritten to its path before the router starts (`fromHashLink`), query kept. `test/ui-warning.test.ts` checks it, and that a signed-out deep link goes to sign-in and back.
- **Browser baseline (Q7).** Without the Navigation API the app shows "This browser is too old for Audition" with the minimum versions, instead of a blank page.
- **Bundle (Q6).** Pages are lazy chunks (`splitting: true` in `scripts/build-ui.ts`). First-load JS (`main.js` and the chunk it imports): **53.1 KB** minified. All JS chunks together: 149.9 KB. `test/ui.test.ts` now checks the first load against 150 KB and reports both.
- **QC1. Arrow 1.0.6 recycles a template by its shape, and a recycled one keeps its old slot kinds.** Swapping a page body through a reactive slot (`${() => view.tpl}`) reused the previous body's DOM; a slot that was `""` and is now a template then printed the template's source (`(el) => renderTemplate(template, el)`), even after an empty template in between and with `.key()`. This is AGENTS.md rule 5 outside a keyed list. So `page()` still mounts each body straight into its `<section>` as before (found by id once quiver has mounted it), never through a slot. Quiver's own outlet only holds the page shell, the loading skeleton and the error view.
- **QC2. A page function must return an Arrow template.** Quiver treats any function as a template; the old `page()` returned `(parent) => …`, which Arrow then called as a reactive expression with no parent.
- Checks: `bun test` 268/268 on a fresh Vaultbase 0.44.0; walkthrough 8/8 and UI warning 4/4 on path URLs; 42 screenshots retaken at 1280 and 375 (the 18 in `docs/screens/t4/` replaced).

## Realtime run page (Nov 11, 2026)

B3 of `docs/PLATFORM-UPGRADES.md` (Q8: its own PR). Read: Vaultbase 0.44.0 `src/realtime/manager.ts` and the `/realtime` socket handlers in `src/server.ts`.

- **How it works.** `ui/src/lib/realtime.js` opens Vaultbase's WebSocket at `/realtime` (same origin), sends `{type:"auth", token}` with the owner's token, then subscribes. It reconnects with backoff (1 s doubling to 30 s) and sends Vaultbase's `ping` every 30 s. The run page subscribes to `runs/<id>` and `attempts`, and on an event for this run reloads `GET /api/custom/runs/:id` (debounced 150 ms, one request at a time). It polls that route every 2 seconds only while the subscription is down, and stops both once the run is done. The panel's `data-live` says which mode is on (`realtime` or `polling`).
- **RT1. Events are a trigger, not the data.** An `attempts` event carries the whole record, outputs included. The run page is blind on purpose, so it never renders from the event: it re-reads the summary route, which leaves outputs out. (The owner can read outputs through REST anyway; this keeps the run page's code from holding them.)
- **RT2. No server-side filter on a topic.** Vaultbase topics are `<collection>`, `<collection>/<id>` or `<collection>.<event>`; there is no `attempts?filter=run=…`. So the page takes every `attempts` event and drops the ones for other runs. With one owner that is a handful of events.
- **RT3. Origin and proxy.** Vaultbase lets a WebSocket in when its `Origin` host matches the request's `Host`, so the same-origin app needs no CORS setting. Caddy forwards `/realtime` and WebSocket upgrades as is, and keeps the `Host` header; the CSP's `connect-src 'self'` covers `ws:`/`wss:` to the same host in current browsers.
- **RT4. After reconnecting, the page reads once.** Events sent while the socket was down are lost, so going back to `realtime` triggers one read to catch up.
- Checks: `test/ui-realtime.test.ts` (Chromium): with realtime up, no reads of the run route for 4.5 s while nothing changes, and a pasted and judged output shows in under 5 s; with the socket refused (`routeWebSocket`), the page shows `polling`, reads at least twice in 4.5 s and still shows the change.
- `bun test` 270/270 on a fresh Vaultbase 0.44.0. Bundle: first-load JS stays 53.1 KB (the run page is a lazy chunk); all JS chunks together are now 151.3 KB, just over 150 KB. Only the first load is held to 150 KB (Q6), so the test passes, but if the budget is ever read as all JS, this is where it tips over.

## Quiver 3.2 conventions (Nov 12, 2026)

Part D of `docs/PLATFORM-UPGRADES.md`; Cas chose full adoption on Nov 12, 2026. `@go4cas/quiver` 3.2.1 is pinned exactly; Arrow stays 1.0.6. Read: Quiver's `CHANGELOG.md` (3.2.0, 3.2.1), and at 3.2.1 `AGENTS.md`, `src/app.js`, `src/router.js`, `src/node/bun.js`, `src/node/conventions.js`, `src/node/scanner.js`, each diffed against 3.1.0.

- **What moved.** `ui/src/routes.js` is gone: `pages/` holds the routes as files, the sign-in guard is `middleware/auth.js`, the loading and error views are `views/`, and the main nav comes from `meta.nav` on the home and contenders pages. `scripts/build-ui.ts` adds Quiver's Bun plugin; `main.js` calls `await createApp(app, { target: "#main", base: BASE })`. Pages read `{ params, query }` through `routeArgs()` (`lib/nav.js`). The shell moved from `layouts/` to `components/shell.js`, because `layouts/` is now Quiver's folder.
- **QD1. The shell is not a Quiver layout.** Every navigation sets the router's status to `loading` (`load()` in `src/router.js`), and the outlet (`src/app.js`) then shows the loading view without a layout before it renders `Layout(Page())` in a new scope keyed by the path. A shell layout would hide the top bar during each load and rebuild the toaster and lightbox, losing a toast shown just before `go()`. So the shell stays mounted once around `#main`.
- **QD2. One route file per URL, shared screens in `editors/`.** `meta` is read at build time and must be a literal in the route file, so the four screens that served two routes each (workspace settings, role, task, contender form) moved to `ui/src/editors/`, with a thin route file per URL. Folder parameters are `[id]` throughout; the URLs are unchanged (`test/ui-routes.test.ts`).
- **QD3. Chunk names by hash.** File routes made Bun name chunks `[id]-….js` and `index-….js`; chunks are now `chunks/<hash>.js`. The bundle test finds page chunks by their `screen:"…"` marker.
- **QD4.** `layouts/`, `app.config.js` and section middleware are not used (QD1; nothing to provide; one guard).
- 3.2.1 runs guards before the navigation commits in Chromium (link clicks and `go()`, not the first load), so an in-app redirect to sign-in, such as after signing out, commits once at `/signin`.
- Checks: `bun test` 274/274 on a fresh Vaultbase 0.44.0 (new: `test/ui-routes.test.ts`, 4 tests). Bundle: first-load JS 56.5 KB (was 53.1), all JS 156.9 KB (was 151.3). 42 walkthrough screenshots retaken at 1280 and 375; the only differences from part C's are the date and the mock's random outputs.

## Push alerts (Nov 13, 2026)

Cas chose OneSignal, Vaultbase's built-in push provider, on Nov 13, 2026. Plan and wiring: `docs/PUSH-ALERTS.md`.

- **P1. Vaultbase 0.44 push is OneSignal or FCM only.** `helpers.notify` writes the `notifications` inbox row (with a realtime event) and queues one `_notify` job per enabled provider. No VAPID web-push provider; `registerPushProvider` is for code that embeds Vaultbase, not `vb_hooks/`.
- **P2. The inbox exists only after a provider is turned on.** `PATCH /api/v1/admin/notifications/providers/:name {enabled:true}` creates `notifications` and `device_tokens` (needs the `users` auth collection). Before that `GET /api/v1/notifications` is 404, and the Alerts page says "Alerts are off".
- **P3. OneSignal widens the CSP, only while it is on.** The app route reads the setting per request and adds OneSignal's origins; it also serves `OneSignalSDKWorker.js` inside the app's scope.
- **P4. Arrow 1.0.6 keeps a recycled template's static values** (adds to U3). Two look-alike buttons switched in a reactive slot kept the first button's attributes; the "On this device" panel is mounted once with every changing part reactive.
- **P5. Headless Chromium reports notifications as denied** even after `grantPermissions`; the UI test stands in for the browser prompt and for OneSignal's SDK.
- Checks: `bun test` 311/311 on a fresh Vaultbase 0.44.0 (new: `test/push.test.ts`, `test/ui-alerts.test.ts`). Bundle: first-load JS 60.2 KB (was 56.5), all JS 173.8 KB. Not verified: a real OneSignal account and a real push to a phone.

## Thumbnails, download audit and File storage (Nov 13, 2026)

Cas approved all three on Nov 13, 2026. Both file fields (`tasks.attachments`, `attempts.output_files`) now list `thumbs: ["160x120_cover", "640x640_cover"]` and `auditDownloads: true` (a schema change Cas said yes to). The judge page asks for the thumbnail sizes (`THUMB` and `thumbUrl` in `ui/src/api.js`); the lightbox and file links still fetch the full file. RELEASE.md says to keep File storage on local until Vaultbase has a server-side file save helper (discussion #11).

- **TH1. 0.44.0 has thumbs, though its field types reference doesn't list the option.** Only the Files page documents `thumbs`. On 0.44.0 a listed size is made on the first request and cached in `uploads/.thumbs/`; an unlisted size returns the full file with `X-Vaultbase-Thumb: not-allowed` (`test/files.test.ts`). A busy thumbnail queue answers 503, so the judge page falls back to the full file then.
- **TH2. The audit log can't tell a preview from a download.** A thumbnail request is logged as `files.download` with the original's path and size, the same as a full download. So each image the judge page shows adds one entry per page load (the UI caches files within a page load). With one owner that is a few entries per judging; worth asking the Vaultbase author to put `thumb` in the entry, or to skip previews.
- **TH3. A synthetic test PNG can grow as a thumbnail** (the 640 px card of a 1024 px gradient was bigger than the original), because resampling breaks up flat runs that PNG compresses well. Real generated images are usually 1024 px or larger and photo-like, where 640 px should be much smaller; that wasn't measured here. Asking for `&format=webp` would shrink it further, but isn't needed now.

## One-command server install (Nov 13, 2026)

Cas wants Audition on their existing Hostinger VPS (next to Market Jury, openGym and others) at audition.go4cas.com, installed cleanly and simply, and chose a simpler VPS install over a desktop app or Docker for now. `deploy/install.sh` installs a prebuilt release bundle (`bun run bundle`, attached to each GitHub release by `.github/workflows/release.yml`), so the server needs no Bun or build step. Layout and reasoning: docs/VPS-INSTALL.md; use: docs/RELEASE.md.

- **IN1. The Vaultbase admin is made through Vaultbase's setup key, not `setup-admin`.** `setup-admin` only takes the password as an argument, which other users can see in the process list. On 0.44.0 a fresh install needs a setup key for `POST /api/v1/admin/setup`: Vaultbase writes it to `<data>/.setup-key` when setup status is asked for, and deletes it once the admin exists. The installer reads it, posts a random password on stdin, and keeps it in `/etc/audition/admin-credentials` (root only). `test/install.test.ts` checks the setup is refused without the key.
- **IN2. Your account is asked for in the terminal, not on a browser setup page.** A first-run page would need a public route that creates an account while none exists; the installer already runs as root with a terminal, so it asks there and passes the password to the setup tool in its environment.
- **IN3. Placeholders in a template comment get filled in too.** A comment that named `__TLS__` turned into a broken nginx file when the TLS lines spanned several lines. The templates no longer name placeholders in comments, and the test checks that.
- **IN4. nginx refuses `listen [::]:80` on a server without IPv6**, so the installer adds IPv6 listeners only when `/proc/net/if_inet6` has entries. A rejected site file is removed again before nginx reloads, so other sites never see it.
- **IN5. Caddy site files can't set the trusted-proxy list**, which is a global option shared by every site. The site file instead sends `CF-Connecting-IP` as `X-Forwarded-For` only when the request comes from a Cloudflare address (`remote_ip` matcher), and the connecting address otherwise; nginx does the same with `geo` and `map`.
- **IN6. Not checked here:** the unit under real systemd (the test machine had none), real certificates from Let's Encrypt, and Cloudflare. Releases before the one that adds `scripts/bundle.ts` have no bundle, so the first VPS install needs a new release tag.
- **IN7. Cas's VPS runs a Cloudflare Tunnel, not a web proxy** (pre-flight, Nov 13 2026): nothing on 80/443, `cloudflared` with a dashboard token, ufw allowing SSH only, Market Jury on Bun 1.3.14 in `/usr/local/bin` (which the old install steps would have replaced), openGym in Docker on 127.0.0.1:8080. The installer recognises a running `cloudflared` (`--proxy tunnel`) and writes nothing for it: the route is a public hostname in the dashboard (`127.0.0.1:<port>`, not `localhost`, which can resolve to `::1` where Vaultbase doesn't listen). With no local proxy, a Cloudflare WAF rule blocks `/_/` except `/_/ready`; Vaultbase 0.44 has no setting to restrict its admin by address.
- **IN8. First real install, v0.3.0 on the VPS (Nov 16 2026).** Installed cleanly in tunnel mode on Ubuntu 24.04 (`status` ready, `vaultbase doctor` clean, seed 41, backups scheduled). Three gaps, fixed in the tunnel steps the installer prints and in RELEASE.md: (1) behind a tunnel nothing redirects `/` to `/api/custom/app/` (Caddy and nginx do it in the site file), so the bare domain answered Vaultbase's 404; a Cloudflare redirect rule does it now. (2) The WAF rule had no `http.host` condition, so on a shared zone it would also block `/_/` on other sites. (3) The closing "Upgrade later: --version" hint can't work while the repository is private; it now mentions `--bundle`. Cloudflare's dashboard also renamed "Public hostname" to a "Published application" route and "WAF, Custom rules" to "Security rules".

## Website (Nov 16, 2026)

Cas asked for a landing page on Nov 13, 2026 and settled the content on Nov 16: the headline "Find the best AI for every role.", the audience first with a clear Vaultbase section, GitHub Pages, a folder that can grow into docs, and a roadmap strip, with a modern look, micro-interactions and animation. `site/` holds the page and a docs hub; `scripts/site.ts` copies the app's tokens, fonts, icon sprite and logo in, and `.github/workflows/pages.yml` publishes it.

- **WS1. The repository is private, so Pages can't publish yet.** GitHub Pages from a private repository needs a paid plan, and the page's GitHub links and the server install command (`releases/latest/download/install.sh`) only work for visitors once the repository is public.
- **WS2. Mock text doesn't sell.** The walkthrough's screenshots show "Mock Erratic" and "[[mock-quality:3]]", so the site's screenshots swap those for sample names and answers in the page before each shot. The app itself is unchanged.
- **WS3. The "Try it" demo is the page's own code**, not the app: two fixed answers, the Trip researcher rubric and its weights, and a reveal.

## Live site links (Nov 17, 2026)

Cas reported on the live v0.3.0 site that the top-bar "Contenders" button opened `/contenders` (404) and "Waiting for you" only opened Home.

- **L1. Nav links without the base.** `components/shell.js` renders the top bar and phone nav once, in `mountShell()`, before `main.js` calls `createApp(app, { base: BASE })`. The nav links used `href()`, which called quiver's `url()`, and `url()` reads the router's base, which is `/` until `createApp()` runs (`src/base.js` in quiver 3.2.1). So the links were `/` and `/contenders`, outside the app: quiver did not intercept them, the browser loaded `/contenders` and Vaultbase answered 404 (`/` only worked because of the Cloudflare redirect rule). Since part D (PR #24). The walkthrough opens pages by URL and never clicked the nav, so no test saw it. Fix: `href()` builds from `BASE` directly; `test/ui-alerts.test.ts` checks every top-bar and phone-nav href and clicks Contenders (fails before the fix).
- **L2. "Waiting for you" opens Home by design** (docs/design README: Home is the main way into handoffs and judging), but on a long Home page it looked like nothing happened. Both "Waiting for you" links now go to `/?waiting=1`, and Home scrolls to its "Up next" list (`#up-next`). The phone nav already linked `?waiting=1`, but nothing read it.

## Vaultbase 0.46 upgrade (Nov 17, 2026)

Cas asked on Nov 17, 2026 to upgrade from 0.44.0 to the latest release: **0.46.0** (tag commit `141fbb17`, `vaultbase-linux-x64` SHA-256 `7deb7ecc…fc14`). Read: `CHANGELOG.md` and `release-notes/` for 0.45.0, 0.45.1 and 0.46.0 at tag v0.46.0, and the source diff `v0.44.0..v0.46.0` of the files TECH-SPEC §1 lists. None of the three has a **Security** section. The notes that touch Audition are in TECH-SPEC §1; none needs a code change.

- **U1. Tests.** `bun test` on a fresh 0.46.0: 318 of 319 in the full run. The one failure was `test/release.test.ts` getting 404 from `/api/custom/app/`, the same flake seen once in Phase 2a; the file passed alone (and `test/setup.test.ts` with it, 11/11). The upgrade test with `AUDITION_UPGRADE_FROM` set to the 0.44.0 lock passed 3/3: 0.44.0 data opened by 0.46.0 kept every record, file, key and sign-in, and the loop ran.
- **U2. `vb_hooks/vaultbase.d.ts` is Vaultbase's 0.46.0 copy.** Since 0.45.0 it types `ctx.helpers` in full (`HookHelpers`, `RouteContext` with `ip`) and keeps `Auth` and `Helpers` as aliases. The hooks were type-checked against it with `tsc --strict`: the only errors were the missing Node types (`node:path`, `Buffer`), none from Vaultbase's types. Vaultbase rewrites the file on start, so committing the new copy keeps `git status` clean after `bun run dev`.
- **U3. Still not in Vaultbase (checked in the 0.46.0 source and types):** a file save helper for server code (discussion #11, so `lib/files.ts` and the `vaultbase_files` insert stay), more upload MIME types (#12, so the owner upload route stays, W1), conditions on `helpers.records.update/delete` (#13, so the worker claim's compare-and-set stays), and a way to serve the app outside `/api/custom/` (L-prefix question).
- **U4. New and usable, not adopted (each needs Cas's OK):** `X-VB-Idempotency-Key` on record creates (would make a double-clicked "Add contender" or "Add task" safe); typed `ctx.helpers`, which could replace the hand-written `Sql`/`Records` types in `lib/store.ts`; route errors now shown in the admin Logs page (free, nothing to do); `ctx.ip` in routes (no use yet).
- **U5. Server upgrade.** No setting, schema, env or service change. The installer's upgrade takes the Vaultbase binary from the release's `vaultbase.lock.json`, so the live server moves to 0.46.0 with the next Audition release (`install.sh --version <tag>`), and `rollback` restores the 0.44.0 binary with the old release.

<<<<<<< HEAD
## Compare (A vs B) judging (Nov 18, 2026)

Cas approved the shape on Nov 18, 2026: a per-run choice "Rate (stars)" or "Compare (A vs B)", the workspace sets the default, and both feed the same leaderboard. Cas approved the two new fields (`runs.method`, `workspaces.default_method`) and the leaderboard view change on a decision card the same day. Design in TECH-SPEC §10a.

- **P1. One verdict per pair, using the fields that were there.** `verdicts.method = pairwise`, `opponent` and `winner` were reserved since Phase 1, so a pick needed no new verdict field. The score is not stored: the leaderboard view works it out (`1 + 4 × win share`), so an override changes it at once and there is nothing to keep in step.
- **P2. Vaultbase view collections take a `UNION ALL` inside a derived table.** The leaderboard view's `JOIN (SELECT … UNION ALL SELECT … GROUP BY …) v` applied with `--apply-snapshot` on 0.46.0 and `test/schema.test.ts` saw no drift.
- **P3. Writes stay on the records API.** Owner picks are `POST /api/v1/verdicts` (rules and hooks as for stars), AI picks and the `judged` moves go through `helpers.records` (`store.ts`); no new SQL write.
- **P4. Position bias.** Judges, people and models, tend to favour one side. Each pair's left/right order is shuffled by a hash but stays stable; the AI is asked once per pair, not twice with the sides swapped, to keep the call count at n × (n − 1) / 2 per task. Asking both ways is a possible later option if picks look lopsided.
- **P5. `test/release.test.ts` and a fresh clone.** In the first full run of this branch the release test got 404 from `/api/custom/app/` (as in U1): it runs before any test has built `ui/dist`. It passes once `ui/dist` exists. Not changed here.
=======
## Off-server backups (Nov 18, 2026)

Cas approved the roadmap's "off-server (R2) copy of backups" on Nov 18, 2026. Read: `src/core/backups.ts`, `src/core/backup-files.ts`, `src/core/install-marker.ts`, `src/core/restore-credentials.ts`, `src/api/backup.ts` and the admin's Settings page at Vaultbase tag v0.46.0.

- **OB1. Vaultbase does the copy; Audition only switches it on.** With `backups.s3.enabled` on, each backup uploads the uploaded files not yet in the bucket, then the manifest, then the snapshot last (a snapshot in the bucket means everything it needs is there), and prunes the bucket to `backups.keep`. The bucket mirrors the local `backups/` layout, so its prefix downloaded into a server's backups folder restores from the admin like a local backup. `backups.s3.secret_access_key` is a secret setting: stored encrypted with `.encryption-key`, shown as `********`. No custom job, script or backup format was added. The one gap, downloading a bucket into a new server, is `audition-setup offsite pull` (Bun's S3 client, the one Vaultbase uses), which writes only Vaultbase's own backup file names, so nothing in the bucket can write outside the folder.
- **OB2. A wrong key would only show up at 03:00.** Vaultbase saves `backups.s3.*` without trying them, and a failed copy shows in the admin's Backup & restore page (`backups.last_error`) while the local backup still succeeds. `offsite on` therefore writes, reads back and deletes `audition/.audition-check` first (not a backup name, so Vaultbase's pruning ignores it), then takes a backup and checks it is in the bucket.
- **OB3. The new server's admin password was a gap.** Restoring another install's backup brings that install's admins (restore-credentials.ts), and the old admin's random password was only in the lost server's `/etc/audition/admin-credentials`. `restore-offsite` resets the admin to the new server's credentials file with `vaultbase setup-admin --force` after the restore. The owner keeps the backup's password, as expected.
- **OB4. `setup-admin` refuses until the restore has finished recording the install.** Restoring another install's database makes the data folder's `database.json` follow it as the restore's last step. When the restore answer came back early (RL1: in 0.46.0 Vaultbase still sometimes closes the connection before answering a SQLite restore), `setup-admin` straight after failed with "it belongs to another install"; a moment later it worked. `restore-offsite` (and the test) retry it for up to 30 seconds, then restart Audition to check it starts on the restored database. The restore helper waits for `/_/ready` after an early close.
- **OB5. The saved keys come as one run-together line.** `sudo cat .encryption-key .secret` prints the 44-character key and the 128-character secret with no newline between. `restore-offsite` accepts that or the two on separate lines, checks the shapes, and stops before any change if they don't fit. A server with a secret setting saved under its own key (SMTP, R2) won't start with the old key (Vaultbase's `encryptionKeyMatchesData`), so `restore-offsite` is meant to run straight after the install; if the start fails it puts the new keys back and stops.
- **OB6. The fresh install's seed files stay in `uploads/`** after the restore (3 small files), unreferenced. Harmless; Vaultbase's file restore only adds missing files.
- **OB7. Evidence.** `test/offsite.test.ts` (7 tests, against `test/fake-s3.ts`, an in-memory S3 stand-in that checks the access key) passed 4 runs in a row. `test/install.test.ts` runs the compiled setup tool's `offsite on` from a real bundle. `install.sh offsite` and `restore-offsite` were run as root in a scratch container with a stubbed `systemctl`: install, `offsite` (a wrong key refused with "R2 refused the keys (InvalidAccessKeyId)"), a renamed workspace and a backup, `uninstall --purge`, a fresh install with a different owner password, `restore-offsite` with the pasted keys. Afterwards the workspace had its new name, the owner signed in with the old password (the new one got 401), the admin signed in from the new credentials file, and a new backup reached the bucket. A second `restore-offsite` on the same server with no keys, and one with bad keys (stopped before any change), behaved as documented. **Not checked:** real Cloudflare R2 and real systemd. Cas's first `offsite` run on the server is the real check.
>>>>>>> origin/main
