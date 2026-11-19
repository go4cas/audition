# Audition — Phase 1 Technical Spec

Nov 6, 2026 · Architecture thread · builds on `docs/SPEC.md` (the source of truth) and `docs/NOTES.md`

This document turns the Phase 1 spec into something the build threads (T0 to T5) can code against without guessing: the pinned platform, the answers to the open questions, the exact collections and rules, the custom routes, the provider adapters, the scoring maths, and what each build thread must prove before its PR is done.

Where this document and `SPEC.md` disagree, this PR also edits `SPEC.md`, and the change is listed under [Spec changes in this PR](#spec-changes-in-this-pr). Nothing here grows Phase 1's scope.

## 1. Platform pin

| | |
| --- | --- |
| Product | Vaultbase, [vaultbase-sh/vaultbase](https://github.com/vaultbase-sh/vaultbase) |
| Pinned version | **v0.47.0** (released Nov 18, 2026; tag commit `7a72e2b354f9bda9e742a7ca99bb5ee79ad63a2d`). Cas approved the move from 0.46.0 on Nov 19, 2026, for the OneSignal fix (NOTES, "Vaultbase 0.47 upgrade"). Earlier pins: 0.37.x, 0.40.2 (Nov 6, 2026, for the security fixes in 0.38 and 0.39), 0.44.0 (Nov 11, 2026, `docs/PLATFORM-UPGRADES.md` part A, for the upload fix F9 and `helpers.records`), then 0.46.0 (Nov 17, 2026). |
| Binary | `https://github.com/vaultbase-sh/vaultbase/releases/download/v0.47.0/<asset>` |
| Checksums | From the release's `SHA256SUMS` file, and checked against a downloaded binary |

SHA-256 for v0.47.0 (from `SHA256SUMS`):

| Asset | SHA-256 |
| --- | --- |
| `vaultbase-linux-x64` | `1b92aa205fc6cfc7f7a0235571d819d453dc90a921d4257b61210837a05c1610` |
| `vaultbase-linux-x64-musl` | `50cc731876a843cea69ee8b55b7584b7ee4ad148adb42dd9547b04172f024723` |
| `vaultbase-linux-arm64` | `6c950791c0dedc52f612c9d84ed946886006824fbb98fa05bd5ffaf23fccf117` |
| `vaultbase-macos-arm64` | `43edf5e082f7ee0427b4ace6bbbe949109791b7d6608a7c3a912e414df1d65c2` |
| `vaultbase-macos-x64` | `0dff149803e9bf86a5b155745c901253f523e8187f443192a353af1c90ad19a1` |
| `vaultbase-windows-x64.exe` | `651097aa984ec313e2fdad7169c4f4e7e05e9d3d2855c9992cba996d6b6998cd` |

The `vaultbase-linux-x64` binary was downloaded by `bun run setup` (126,810,288 bytes) and its SHA-256 matched the line above.

**T0 records the pin in the repo** as `vaultbase.lock.json`: version, the release URL, and the SHA-256 for each asset. The download script refuses a binary whose checksum doesn't match. Since 0.39.1, releases also carry a Sigstore bundle (`<asset>.sigstore.json`). Verifying it needs `cosign`, so it is optional, not part of `bun run setup`.

**How this was checked.** `docs.vaultbase.dev` always shows the latest release, not the pinned one, so every claim about behaviour below was read from the source at the release's git tag (file paths are given). The analysis was done at v0.37.0 and re-checked at v0.40.2. The files this design depends on (`code-files.ts`, `hooks.ts`, `hook-helpers-extra.ts`, `routes.ts`, `api-paths.ts`, `migrations.ts`, `hook-egress.ts`, `script-limits.ts`) are identical between the two tags. `src/index.ts` changed by 11 lines: setup-admin email checking, and priming rule case folding at startup. Neither affects Audition. The other behaviours relied on were re-read at v0.40.2 and still hold: encrypted fields decrypted on read (`records.ts`), the upload handler and its MIME allowlist (`api/files.ts`, `core/sec.ts`), and routes that parse only JSON and text bodies. For v0.44.0 the changelog and release notes of 0.41.0 to 0.44.0 and the source diff `v0.40.2..v0.44.0` of these files were read (`docs/PLATFORM-UPGRADES.md`, part A), and `bun test` passes on the binary. For v0.46.0 the changelog and release notes of 0.45.0, 0.45.1 and 0.46.0 were read, with the source diff `v0.44.0..v0.46.0` of these files: only `code-files.ts` (the hook types file), `core/routes.ts` (form bodies, `ctx.ip`, logged status), `core/migrations.ts` and the records code (client ids, idempotency keys) changed. The upload handler and its MIME allowlist did not. For v0.47.0 the changelog and release notes were read, with the whole source diff `v0.46.0..v0.47.0`: outside the admin UI, only `core/notifications.ts` (the OneSignal header) changed.

The upgrade notes between 0.37.0 and 0.40.2 that touch Audition:

- **0.40.0: new collections keep record history by default.** The snapshot sets `history_enabled` explicitly on every collection: `true` for `tasks`, `contenders`, `roles`, and (since part B) `runs`, `attempts`, `verdicts` and `castings`; `false` for the rest.
- **0.39.0: changing a table that a view reads can be refused (409)** while the view depends on it. A later schema change to `attempts`, `runs` or `verdicts` may therefore have to drop and recreate the `leaderboard` view. T0 notes how in `NOTES.md`.
- **0.39.0: admin-only views answer 404 to non-admins.** The `leaderboard` view's rules are `OWNER`, so this doesn't apply.

The upgrade notes between 0.40.2 and 0.44.0 that touch Audition (none of the five changelogs has a **Security** section):

- **0.41.1: uploads to `POST /api/v1/files/...` work again (F9 fixed).** The endpoint stores the file and answers its name; the client then saves the name into the record's field with a normal update, as Vaultbase's admin does. Audition's own upload route stays: the built-in endpoint can't take Markdown, CSV or zip files (NOTES W1).
- **0.42.0: registering a known email answers 409** (was 200). Audition registers the owner once, and provision checks for an existing owner first.
- **0.42.0: the `vaultbase` CLI rejects unknown commands and options** (exit 2). `deploy/audition.service` and `bun run dev` use only `--apply-snapshot` and `--snapshot-mode sync`, which 0.44.0 accepts.
- **0.42.0: `vaultbase setup-admin` follows the password policy, 12 characters by default** (was 8). `RELEASE.md` says so.
- **0.43.0: `helpers.records.create/update/delete`** for hooks, routes and workers, writing through the records API path (history, realtime, webhooks). Audition's server writes use it since part B (F1 below).
- **0.44.0: a Bearer token the server doesn't accept answers 401** on the records, files and batch APIs (was: treated as anonymous). The UI already signs the owner out on any 401.
- **0.44.0: unknown `sort`, `expand` or `fields` names, and unknown body keys on create and update, answer 400** (were ignored). System fields (`id`, `created`, `updated`, …) are still accepted, so a record saved back as it was fetched works; `test/validation.test.ts` checks both.

The upgrade notes between 0.44.0 and 0.46.0 that touch Audition (none of the three changelogs, 0.45.0, 0.45.1 and 0.46.0, has a **Security** section):

- **0.45.0: `vaultbase.d.ts` in the hooks folder types `ctx.helpers` in full** and is rewritten when a new version changes it. The committed `vb_hooks/vaultbase.d.ts` is the 0.46.0 copy; the hooks type-check against it.
- **0.45.0: a custom route's `ctx.body` is an object for a form post** (was `null`). Audition's routes take JSON, multipart or nothing, so no change.
- **0.46.0: an `id` sent on a create is used** (must be a free UUID; `409` if taken), where it was replaced. Audition's creates never send one: the UI posts form fields, and server code goes through `insertRecord` with named fields.
- **0.46.0: `POST /admin/migrations/apply` answers 422 when a collection fails.** Audition applies the schema with `--apply-snapshot` (service and tests), which already exited 1 on a failure.

The upgrade notes between 0.46.0 and 0.47.0 that touch Audition (0.47.0 has no **Security** section and its upgrade notes say "None"):

- **0.47.0: OneSignal pushes work with App API keys (`os_v2_app_…`)** (Vaultbase issue #16). They are sent with `Authorization: Key`; legacy REST keys keep `Basic`. Before, every push from Audition's `helpers.notify` failed with 401 (NOTES, "Vaultbase 0.47 upgrade", V1). **Test connection** now reads one row of the app's message list, so it works with an App key too. No Audition code change: `alertOwner()` already calls `helpers.notify`.
- **0.47.0: an admin Schema page** draws the collections and their relations. Read-only; nothing for Audition to do. `vaultbase.d.ts` did not change.

### Upgrade policy

Vaultbase ships about one release a day and is pre-1.0, where a minor version may change behaviour. Following every release would turn Audition into a Vaultbase-chasing project, and falling far behind would make each upgrade large. The policy:

1. **Pin an exact version.** Never "latest", and never `vaultbase update` on an install. The binary comes only from `vaultbase.lock.json`.
2. **Upgrade on a rhythm, not on every release.** Once a month, a short "Vaultbase upgrade" thread reads the changelog from the pinned version to the newest release.
3. **Security fixes jump the queue.** If the changelog's **Security** section names something Audition uses, the upgrade happens that week. That covers auth, rules, files, hooks, the egress guard, backups and the records API. It doesn't cover MCP, OAuth, Postgres or clusters, which Audition doesn't use.
4. **Every upgrade is asked first** (orchestrator rule 9). The thread proposes the version, quotes the relevant Security and Upgrade notes, and waits for Cas.
5. **Every upgrade is tested the same way:**
   - `bun run vb:bump <version>` fetches the new `SHA256SUMS`, downloads and checks the binary, and rewrites `vaultbase.lock.json`.
   - `bun test` passes on a fresh instance of the new version.
   - `test/upgrade.test.ts` starts the *old* pinned version, runs a full seeded loop on it (seed, run, judge, cast), stops it, starts the *new* version on the same data folder, and checks that every record, file, key and sign-in is still there and the loop still works.
   - The PR quotes the changelog sections it read.
6. **Production upgrades** (documented in `docs/RELEASE.md`) follow these steps: stop, a cold copy of the whole data folder, swap the binary, start, smoke test. (`vaultbase backup` was planned here, but it copies the database only, without files or keys: NOTES.md RL2.) Vaultbase upgrades a data folder on start and has no downgrade, so **rollback means restoring the backup** with the old binary, never starting the old binary on upgraded data.

T0 builds `vb:bump` and `test/upgrade.test.ts`. The upgrade test can only be meaningful from the first upgrade on, so in T0 it runs the old and new version as the same pinned binary. The first real run was 0.40.2 → 0.44.0 (Nov 11, 2026; NOTES.md, "Vaultbase 0.44 upgrade"), the second 0.44.0 → 0.46.0 (Nov 17, 2026). `vb:bump` doesn't fetch the tag commit; add `tag_commit` to the lock by hand (`git ls-remote https://github.com/vaultbase-sh/vaultbase 'refs/tags/v<version>^{}'`).

## Tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| Backend platform | Vaultbase v0.47.0: one binary with SQLite, auth, REST, files, hooks, queues and encrypted fields | Spec decision. It does the backend work, so Audition writes only its own logic. |
| Database | SQLite, inside Vaultbase (the default; one file in the data folder) | Single owner, single server. Postgres is not needed. |
| Server logic | TypeScript files in `vb_hooks/` (hooks, custom routes, queue workers), run by Vaultbase's built-in Bun | Spec rule: logic lives in the repo |
| Schema | `schema/snapshot.json`, applied by `vaultbase --apply-snapshot` | Q1 |
| AI providers | Anthropic Messages API over raw HTTP (`helpers.http`, API version `2026-10-21`); an OpenAI-compatible chat-completions adapter; an in-process mock | No SDK, so no runtime dependency. Anthropic is the first real provider. |
| Frontend language | JavaScript (ES modules) and CSS, bundled with `Bun.build` | Spec rule |
| Frontend reactivity | **[Arrow.js](https://arrow-js.com) core** (`@arrow-js/core`, pinned to an exact version, 1.0.6 at the time of writing, MIT, no dependencies of its own): `reactive()` state and `html` templates, bundled into `ui/dist`. Routing, the sign-in guard, page cleanup and page titles come from **[quiver](https://github.com/go4cas/quiver) core** (`@go4cas/quiver`, pinned exactly, 3.1.0 since Nov 11, 2026, 3.2.1 since Nov 12, 2026): Navigation API routing with real path URLs under `/api/custom/app/`, and its conventions: Quiver's Bun plugin builds `quiver:app` from `ui/src` (`pages/` as file routes with one lazy chunk per page, `middleware/auth.js`, `views/`, the nav from `meta.nav`). Its CSS recipes, layouts, Vite and Tailwind are not used (PLATFORM-UPGRADES parts C and D). | Cas chose this on Nov 6, 2026. It and quiver (Q5, Nov 11, 2026) are the two named exceptions to "no runtime dependencies": it gives reactivity for the live run view, star judging and the rubric editor, without a framework. |
| Frontend look: components, icons, motion | **Pending Cas's approval in the Design thread (PR #4).** Cas asked for a more modern feel, with micro-animations, icons, richer state design and popovers. The current proposal is Design's own components (no Basecoat) and Phosphor icons copied in as one SVG sprite, so there are still no runtime dependencies. | Whatever Design picks, Architecture's constraint is only this: it is served as static files from `ui/dist` and adds no JavaScript dependency beyond Arrow.js core. Copying CSS or SVG files into `ui/` is a build-time choice Cas can approve as compatible with "no runtime dependencies". T4 follows the Design decision. |
| Browser APIs | `fetch`; native `<dialog>` and the Popover API for popovers; CSS transitions and `@starting-style` for motion; `navigator.clipboard` for the copy button | All built into current browsers, no library needed |
| UI hosting | Served by Vaultbase itself through a custom route (`/api/custom/app/`) | Q2: one process, one origin |
| Tooling | Bun (scripts, build, `bun test`). Playwright as a dev dependency for T4 browser tests. | Bun is the runtime Vaultbase is built on |
| Production (Release thread) | A VPS running the binary under systemd, behind Cloudflare and a reverse proxy, with Vaultbase's own scheduled backups (`backups.*` settings, set by `provision`) | Spec |
| Off-server backups | **Vaultbase's own S3 copy of each backup** (`backups.s3.*` settings) into a private **Cloudflare R2** bucket, under the prefix `audition/`. Vaultbase uploads every scheduled and on-demand backup with its uploaded files, and prunes the bucket to the same `backups.keep` (14). `install.sh offsite` (the setup tool's `offsite on`, `scripts/offsite.ts`) checks the bucket and keys with a test write, saves the settings through the admin settings API, takes a backup and checks it reached the bucket. For a lost server, `install.sh restore-offsite` downloads the bucket into the backups folder, puts the saved `.encryption-key` and `.secret` in place, and restores the newest through Vaultbase's restore API. Steps in `docs/RELEASE.md` "Off-server copy"; findings in NOTES "Off-server backups". | Cas approved it on Nov 18, 2026 (roadmap "Later"). Vaultbase does the copying, the pruning, the encryption of the secret and the restore, so Audition adds no scheduled job and no backup format of its own (the project shows Vaultbase's features). The one part Vaultbase has no command for, downloading a bucket into a new server's backups folder, is the setup tool's `offsite pull`, which writes only Vaultbase's own backup file names. |

## 2. Answers to the open questions

These are the spec's first six open questions. T0 confirms the first four against a running binary and records the evidence in `docs/NOTES.md`.

**Q1. How is the schema kept as code?** As a **snapshot file**, `schema/snapshot.json`, in Vaultbase's own snapshot format (`version: 1`, one entry per collection with fields, rules, indexes, `history_enabled`, and `view_query` for the view). The binary applies it at startup with `vaultbase --apply-snapshot schema/snapshot.json --snapshot-mode sync` (`src/index.ts`, `parseCliArgs`; `src/core/migrations.ts`, `applySnapshot`). `sync` updates existing collections to match; `additive` only creates missing ones. Rules left out of a snapshot entry mean "not specified", so every entry states all five rules explicitly. The same apply is reachable over HTTP (`POST /api/v1/admin/migrations/apply`) and can be checked with `POST /api/v1/admin/migrations/diff`, which the schema test uses to prove a fresh instance matches the file.

**Q2. Can Vaultbase serve the static UI?** Not as static files: there is no public-folder feature, and the server only answers `/_/` (the admin UI), the API and realtime. **But a custom route can return any `Response`** (`src/api/routes.ts`, `tryDispatchCustom`: "A handler that returns a Response… is answered with it as is"). Custom routes live under `/api/custom/…` (also `/api/v1/custom/…`, `src/core/api-paths.ts`). So T0 adds one route file, `vb_hooks/routes/app.ts`, `GET /app/*`, which serves the built UI from `ui/dist/` with the right MIME type and a strict Content-Security-Policy. The UI is reached at `http://localhost:8091/api/custom/app/`. One process, one origin, no CORS. In production the reverse proxy maps `/` to `/api/custom/app/` (Release thread). No Cloudflare Worker is needed. The UI is a **single-page app, rendered in the browser** (no server-side rendering). It is one `index.html` plus JS and CSS, with real path URLs (`/api/custom/app/runs/123`, quiver since Nov 11, 2026; hash routes before that, and old `#/` links redirect). The route serves files and answers `index.html` for any other path, so it needs no knowledge of screens. `index.html` links its assets by absolute path, because a relative one would resolve against the page's path and the CSP forbids `<base>`. Data comes from the REST API and the custom routes as JSON.

**Q3. `@vaultbase/sdk` or plain `fetch`?** **Plain `fetch`.** The runtime dependencies are Arrow.js core and quiver (see Tech stack), and Phase 1 needs only a small slice of the API: sign-in, list, view, create, update, file upload and the custom routes. T4 writes `ui/src/api.js` (about 150 lines). Realtime isn't used in Phase 1 (see F1). Since B3 the run page uses the browser's own `WebSocket` on Vaultbase's `/realtime` (`ui/src/lib/realtime.js`, about 70 lines), still with no SDK.

**Q4. Can a cloud session download the pinned release?** **Yes.** This session fetched `SHA256SUMS` and the 126 MB `vaultbase-linux-x64` binary (v0.37.0 and v0.40.2) from GitHub Releases through the session proxy, and both checksums matched. The binary is therefore not committed; `scripts/fetch-vaultbase.ts` downloads it into `.vaultbase/bin/` (git-ignored) and checks it. One caution: in this session an automated safety check blocked running the downloaded binary, so this thread could not boot it. T0 must boot it and capture the output for its PR. If a cloud session can't run it, T0 records that in `NOTES.md` and asks before working around it.

**Q5. Can the AI judge see images?** **Yes, for Anthropic.** Every current Claude model accepts images in a Messages request as `{"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "…"}}` blocks. The limits, from the [vision docs](https://platform.claude.com/docs/en/build-with-claude/vision) read on Nov 6, 2026, are:

- JPEG, PNG, GIF and WebP only. An animated GIF counts as its first frame.
- Up to 10 MB per image once base64-encoded, which is about 7.5 MB of raw file.
- Up to 8000 × 8000 px.
- Up to 600 images per request, and 128 MB per request.
- Larger images are downscaled by the API. On Claude 4.7 and later, the long edge goes down to 2,576 px.

So the design is:

- The judge is called **once per output, not once per screen**. Each call holds that one output's text plus its images, so the limits are never close. It also avoids position bias, because the judge never sees two outputs side by side.
- `lib/judge.ts` sends every image file on the output whose MIME type is supported and whose raw size is at most 7.5 MB. It skips anything else, such as an SVG, an AVIF or an oversized image, and names it in the prompt: "an image `x.svg` was supplied but could not be shown to you". It sends PDFs as `document` blocks. It doesn't send zip files, only lists them by name. Audition never resizes images, because that would need an image library.
- The OpenAI-compatible adapter sends images as `image_url` data URIs. Whether a given model accepts them is up to that provider; a refusal fails that verdict, not the run.
- The mock judge "sees" images by counting them, so the Marketing image role is testable without a real provider.

**Q6. Which demo repo and commit do the Software Factory coding tasks name?** Proposal: a new, small public repo **`go4cas/audition-factory-demo`**, holding a Bun app of about 200 lines. It has a JSON settings store, one REST endpoint and an empty `ui/` folder, so the Spec, Back-end and UI tasks have something real to build on. `settings-spec.md` and `mockup.png` sit at the root. Cas creates the empty repo (this session may not create repositories). T0 writes its content under `fixtures/factory-demo/` and Cas pushes it. The seeded tasks then name `github.com/go4cas/audition-factory-demo` and the first commit's SHA. Until then, T0 seeds `base_ref` with the placeholder commit `0000000` and a test fails if the placeholder is still there at T5. This is open question O2 for Cas to confirm.

## 3. Findings from the Vaultbase source that shape the design

Each finding names the file it comes from at tag v0.37.0; all were re-checked at v0.40.2. T0 copies these into `docs/NOTES.md` and confirms each one against the running binary.

**F1. Server code can't write records through the records API.** Hook, route and worker helpers can *read* records (`helpers.find`, `helpers.query`), but have no create or update helper (`src/core/hooks.ts`, `makeHookHelpers`). Writes go through `helpers.sql` (`src/core/hook-helpers-extra.ts`, `SqlHelpers`). A SQL write skips record hooks, record history and **realtime events**, because realtime is broadcast only from the records API (`src/realtime/manager.ts`, `broadcast`). The alternative, workers calling the REST API over loopback, is blocked by the egress guard by default (F3) and would need a stored admin token. Decisions:

- All server-side writes go through one small module, `vb_hooks/lib/store.ts`. It knows the storage form of the few field types it writes (text, number, bool, json as a JSON string, single relation as an id, multiple relation as a JSON array of ids, autodate as unix seconds). It always sets `updated_at`. T0 proves with a round-trip test that a record written by `store.ts` reads back through REST exactly like one created through REST.
- **Since Vaultbase 0.43 and part B of `docs/PLATFORM-UPGRADES.md` (Nov 11, 2026), F1 no longer holds.** `store.ts` is a thin layer over `helpers.records` (`insertRecord`, `updateRecord`, `deleteRecord`), so server writes get field validation, the collections' own hooks, record history (shown as system: no actor), realtime events and webhooks. Audition's before-hooks treat a write with no user (`auth === null`) as trusted, like the admin; every API rule on those collections needs a signed-in caller, so an anonymous REST request is refused before a hook runs. Two SQL writes stay, each with its reason in the code and a grep test (`test/store.test.ts`): the generate worker's claim of a queued attempt (`helpers.records.update` has no "only if" form), and the `vaultbase_files` row of a file made by server code (Vaultbase has no server-side file helper). NOTES "Server writes through the records API" has the details.
- **The live run view polls** `GET /api/custom/runs/:id` every 2 seconds while the run is active, instead of subscribing to realtime. *(Phase 1. Since B3 it subscribes to realtime and polls only while the connection is down; NOTES "Realtime run page".)* That is fine for one owner. The spec's "Live run progress: Realtime subscriptions on attempts" row changes to "polling" (see [spec changes](#spec-changes-in-this-pr)).
- Record history isn't needed: versions of tasks and contenders are explicit records (`previous_version`), as the spec already says.

**F2. Encrypted fields come back decrypted** to anyone the collection's rules let read them (`src/core/records.ts`, `decryptValue` on read). An encrypted `api_key` on `connections` would therefore be returned to the owner's browser, which breaks "keys are write-only to clients". Decision: the key moves to its own collection, **`connection_keys`**: one record per connection, field `api_key` (encrypted). The owner can create, update and delete those records but not list or view them (list and view rules are `""`, admin only), and only server code reads them (`helpers.find`). `connections.has_key` (bool, maintained by hooks) tells the UI whether a key is set. That makes 13 collections plus the view (T0's count; this line first said 14).

**F3. The egress guard denies private and loopback ranges by default** and allows the rest (`src/core/hook-egress.ts`). Public provider hosts such as `api.anthropic.com` pass without configuration. The spec's "allows only the configured provider hosts" is stricter than what Vaultbase offers, which is a denylist plus allow exceptions. Decision: keep the default denylist, and have `lib/providers/index.ts` refuse any URL whose host isn't the host of a configured connection's `base_url` (or `api.anthropic.com` for Anthropic). The mock provider runs in-process and makes no HTTP call, so tests need no egress change.

**F4. Custom routes parse only JSON and text bodies** (`src/core/routes.ts`, `dispatchCustomRoute`). Uploads therefore go through Vaultbase's file endpoint, `POST /api/v1/files/:collection/:recordId/:field` (multipart, field name `file`). It checks the record's `update_rule`, the field's `maxSize` and `mimeTypes`, and a global allowlist (`src/api/files.ts`; `src/core/sec.ts`, `ALLOWED_UPLOAD_MIME`). That allowlist accepts images, `application/pdf`, `text/plain`, `application/json` and `application/octet-stream`, but **not `application/zip` or `text/markdown`**, and it trusts the MIME type the browser declares. Decisions:

- The UI sets the MIME type from the file's extension before uploading: `.md`, `.txt`, `.csv` and `.log` go up as `text/plain`, and `.zip` as `application/octet-stream`.
- A before-update hook on attempts re-checks every attached file's original name and type against the Phase 1 list (text, images, PDF, zip) when the output is submitted.
- Each file field sets `maxSize: 26214400` (25 MB). The per-request cap stays at its 50 MB default.

**F5. Script time limits.** By default a route has 30 s and a queue worker 300 s (`src/core/script-limits.ts`), and each `helpers.http` attempt times out after 30 s. A Claude call with thinking on can take minutes. T0's setup script sets `queues.timeout_ms` to `900000` (15 minutes). Adapters pass `timeoutMs: 600000` and `retries: 3` to `helpers.http.request`, which retries network errors, 429 and 5xx with doubling delays.

**F6. `helpers.template` is minimal.** It handles `{{path}}` and one level of `{{#if path}}…{{/if}}`, with no loops (`src/core/hook-helpers-extra.ts`, `makeTemplate`). Decision: `lib/handoff.ts` builds list-shaped variables in TypeScript first (`rubric_text`, the numbered criteria, and `attachments_text`), then calls `helpers.template.render`. In unit tests, `lib/handoff.ts` uses a copy of the same 15-line renderer.

**F7. Hook files.** `vb_hooks/` sits next to the data directory, or wherever `VAULTBASE_HOOKS_DIR` points. Its subfolders are `hooks/`, `routes/`, `jobs/`, `workers/` and `lib/`. Each entry file default-exports `defineHook`, `defineRoute`, `defineJob` or `defineWorker` from `"vaultbase"`, and the folder is polled and reloaded within a second (`src/core/code-files.ts`). Hook events are `beforeCreate`, `afterCreate`, `beforeUpdate`, `afterUpdate`, `beforeDelete` and `afterDelete`, and there is no read hook. Files in `lib/` must not import `"vaultbase"`, so that `bun test` can import them directly.

**F8. The Anthropic API no longer takes `temperature`.** API version `2026-10-21` rejects `temperature`, `top_p` and `top_k` on every model (from the Claude API reference). The Anthropic adapter sends `anthropic-version: 2026-10-21`, maps the contender's "reasoning level" to `output_config.effort`, and never sends `temperature`. The contender form shows the temperature field only for OpenAI-compatible connections. The spec's example "Opus 5.5, high reasoning, temperature 0.6" becomes "Opus 5.5, high effort" for Anthropic contenders.

## 4. Repository layout

```
audition/
├── vaultbase.lock.json        # version, release URL, sha256 per asset (T0)
├── package.json               # bun scripts; one runtime dependency: @arrow-js/core (exact version)
├── bunfig.toml
├── schema/
│   └── snapshot.json          # all 13 collections + the leaderboard view
├── seed/
│   ├── reference.ts           # the four reference workspaces (SPEC "Reference workspace content")
│   └── fixtures/              # test images, the Northwind Foods summary, settings-spec.md, mockup.png
├── vb_hooks/
│   ├── hooks/                 # one file per collection event (validation, locking)
│   ├── routes/                # custom routes, including app.ts (serves the UI)
│   ├── workers/               # generate.ts, judge.ts
│   └── lib/                   # pure TS: store, handoff, scoring, fitness, judge, providers/
├── ui/
│   ├── src/                   # Arrow.js pages, layouts, components, state; quiver routes; CSS from docs/design
│   └── dist/                  # built by `bun run build:ui` (git-ignored)
├── scripts/
│   ├── fetch-vaultbase.ts     # download + checksum
│   ├── dev.ts                 # boot: fetch, apply snapshot, settings, seed, start
│   ├── provision.ts           # set up a running production instance (the compiled setup tool)
│   ├── offsite.ts             # the off-server R2 copy of backups: on, off, pull, restore
│   └── stop.ts
├── test/
│   ├── harness.ts             # boots a fresh instance on a free port in a temp dir
│   └── *.test.ts
├── fixtures/factory-demo/     # contents for go4cas/audition-factory-demo (O2)
└── docs/
```

**Bun scripts** (in `package.json`, all Bun built-ins):

| Script | Does |
| --- | --- |
| `bun run setup` | Fetch and check the binary |
| `bun run vb:bump <version>` | Rewrite `vaultbase.lock.json` for a new release (upgrade policy, §1) |
| `bun run provision` | Set up a production instance that is already running: settings, backup schedule, owner, seed (Release, `docs/RELEASE.md`) |
| `bun scripts/provision.ts offsite on\|off\|pull DIR\|restore NAME` | The off-server R2 copy (`scripts/offsite.ts`); on the server it runs as `bin/audition-setup offsite …` from `install.sh offsite` and `restore-offsite` |
| `bun run dev` | Setup, build the UI, start Vaultbase with `--apply-snapshot schema/snapshot.json --snapshot-mode sync`, create the admin and the owner if missing, apply settings, seed if empty, then print the UI URL |
| `bun run stop` | Stop the instance started by `dev` (PID file in `.vaultbase/`) |
| `bun run seed` | Seed the reference workspaces into a running instance (idempotent by name) |
| `bun run build:ui` | Bundle `ui/src` with `Bun.build` into `ui/dist` |
| `bun test` | Each test file boots its own fresh instance (`test/harness.ts`) |

**Environment.** `VAULTBASE_DATA_DIR=.vaultbase/data` and `VAULTBASE_HOOKS_DIR=./vb_hooks`. The owner's email and password come from `AUDITION_OWNER_EMAIL` and `AUDITION_OWNER_PASSWORD`, or are generated and printed once. No provider key is ever read from the environment; keys are entered in the UI only.

**Settings applied by `dev` and by the test harness** (admin settings API): `queues.timeout_ms = 900000`; user sign-up closed (the `users` create rule is `""`); MFA available on `users`.

## 5. Accounts and access rules

There are three identities.

- **The Vaultbase admin.** Created with `vaultbase setup-admin`. Scripts use it for setup and seeding, and it can open the admin UI at `/_/`. The app UI never uses it.
- **The owner.** One record in the `users` auth collection. The UI signs in as the owner.
- **Guests** (Nov 18, 2026, §10b). Anonymous sessions in their own `guests` auth collection, made by anyone who opens a guest link. No rule below lets them in; they use only the guest routes.

Rule shorthand used below:

- `OWNER` = `@request.auth.id != "" && @request.auth.collectionName = "users"`
- `""` = admin only (Vaultbase's meaning)
- `—` = same as `""`; the action happens only through a custom route or server code

## 6. Data model

Sixteen base or auth collections plus one view (thirteen until guest voters added `guests`, `guest_links` and `guest_votes` on Nov 18, 2026, §10b) (T0 counted them against the built schema; earlier drafts said fourteen). Every collection also gets `id`, `created_at` and `updated_at` from Vaultbase. "Later" fields exist from T0, are nullable, and are unused in Phase 1. "Rel" means a relation, with its delete behaviour.

### users (auth)

| Field | Type | Notes |
| --- | --- | --- |
| name | text | |

Rules: list `id = @request.auth.id` · view `id = @request.auth.id` · create `""` · update `id = @request.auth.id` · delete `""`.

### guests (auth), guest_links, guest_votes

Guest voters, §10b. `guests`: no extra fields; list and view `id = @request.auth.id` · create `@request.body.email:isset = false` (anonymous sign-in only) · update and delete `""`. `guest_links`: all five `OWNER`. `guest_votes`: list and view `OWNER` · create, update and delete `—`.

### workspaces

| Field | Type | Notes |
| --- | --- | --- |
| name | text, required, unique | |
| description | text | |
| default_judge | select `me`, `ai` | default `me` |
| judge_contender | rel → contenders, setNull | The AI judge. Required when `default_judge = ai` (hook). |
| default_method | select `rate`, `compare` | default `rate`. Which judging method "Start a run" preselects (§10a, Nov 18, 2026). |
| min_outputs | number, min 1 | default 5 |
| fitness_weights | json | `{ "quality": 100, "tokens": 0, "time": 0 }`, percentages summing to 100 (hook) |
| composer_contender | rel → contenders, setNull | The Composer (§9a). Optional. Must be an enabled `api` contender (checked when composing). |

Rules: all five are `OWNER`.

### stages

| Field | Type | Notes |
| --- | --- | --- |
| workspace | rel → workspaces, cascade, required | |
| name | text, required | |
| order | number | |

Rules: all `OWNER`.

### roles

| Field | Type | Notes |
| --- | --- | --- |
| workspace | rel → workspaces, restrict, required | |
| stage | rel → stages, setNull | Optional. The hook checks it belongs to the same workspace. |
| name | text, required | |
| description | text | |
| rubric | json, required | `[{ "name": "Accuracy", "weight": 40, "guidance": "…" }]`. The hook checks 1 to 8 criteria, unique names, whole-number weights summing to 100. |
| pass_mark | number, 1 to 5 | default 3.5 |
| default_output_type | select `text`, `image`, `file`, `code` | |
| outcome_after_days | number, 1 to 365, optional | Phase 2a (Cas approved Nov 12, 2026): when set, each judged output gets an outcome check due this many days later. Empty means off. |

Rules: all `OWNER`, except delete: `OWNER`, and the hook refuses when the role has runs.

### tasks

| Field | Type | Notes |
| --- | --- | --- |
| role | rel → roles, restrict, required | |
| title | text, required | |
| prompt | editor, required | |
| output_type | select `text`, `image`, `file`, `code` | |
| attachments | file, multiple, 25 MB each | |
| base_ref | json | `{ "repo": "github.com/go4cas/audition-factory-demo", "commit": "…" }`, or null |
| locked | bool | Set by the start-run route |
| previous_version | rel → tasks, setNull | |
| composed_prompt | text | The Composer's draft as the owner left it (§9a). When not empty, `promptForTask` returns it instead of the generic prompt. The owner may edit it while the task is unlocked. |
| compose | json | Set only by Audition (the hook refuses an owner write that changes it): `{ status: composing \| done \| failed, contender, asked_at, error?, tokens_in?, tokens_out?, cost?, duration_ms?, done_at? }`. Cas approved the field on Nov 18, 2026. |

Rules: list, view and create `OWNER` · update `OWNER && locked = false` · delete `OWNER && locked = false`. The `beforeUpdate` hook also refuses any write that changes `locked` (only server code sets it), and refuses attachment uploads on locked tasks through the update rule.

### connections

| Field | Type | Notes |
| --- | --- | --- |
| name | text, required, unique | |
| provider | select `anthropic`, `openai-compatible`, `mock`, `manual` | |
| base_url | url | Empty means the provider default. Required for `openai-compatible`. |
| has_key | bool | Maintained by the hooks on `connection_keys`; read-only to the owner (hook) |
| notes | text | |

Rules: all `OWNER`. Delete is refused while contenders use the connection (relation `restrict`).

### connection_keys (new; see F2)

| Field | Type | Notes |
| --- | --- | --- |
| connection | rel → connections, cascade, required, unique | |
| api_key | text, **encrypted**, required | |

Rules: list `""` · view `""` · create `OWNER` · update `OWNER` · delete `OWNER`. Hooks: `afterCreate` and `afterUpdate` set `connections.has_key = true`; `afterDelete` sets it to false. A test proves that no list, view, expand or realtime path returns `api_key` to the owner.

To replace a key, the UI deletes the old `connection_keys` record and creates a new one. Without view rights the owner can't look up the old record's id, so `DELETE /api/custom/connections/:id/key` does the lookup and delete server-side.

### contenders

| Field | Type | Notes |
| --- | --- | --- |
| connection | rel → connections, restrict, required | |
| name | text, required, unique | Friendly name |
| mode | select `api`, `handoff`, `runner` | `runner` is *later*. The hook requires `handoff` for a manual connection and `api` otherwise. |
| model | text | Provider model id, for example `claude-opus-5-5`. Empty for handoff. |
| group | text | For leaderboard grouping; defaults to `model` or `name` |
| config | json | `{ "system_prompt"?: string, "effort"?: "low"\|"medium"\|"high"\|"xhigh"\|"max", "temperature"?: number, "mock"?: MockConfig, "image"?: ImageOptions }`. The hook drops `temperature` for Anthropic (F8) and for an image maker. `image` is allowed on OpenAI-compatible connections only (§12a). |
| max_output_tokens | number, min 1 | default 16000; required for `api` |
| price_in_per_mtok | number | optional, USD |
| price_out_per_mtok | number | optional, USD |
| locked | bool | |
| previous_version | rel → contenders, setNull | |
| enabled | bool | default true |

Rules: as for tasks (update and delete need `locked = false`), with the same hook on `locked`.

`MockConfig` is `{ "behaviour": "steady" | "erratic" | "fail" | "flaky" | "image" | "judge" }`.

`ImageOptions` is `{ "size"?: "auto" | "<w>x<h>", "quality"?: "auto"|"low"|"medium"|"high"|"standard"|"hd", "n"?: 1-4, "format"?: "png"|"jpeg"|"webp", "background"?: "auto"|"transparent"|"opaque", "ask_b64"?: boolean }`, checked by `imageOptionsError()` in `lib/validation.ts`. Its presence makes the contender an image maker.

### handoff_templates

| Field | Type | Notes |
| --- | --- | --- |
| name | text, required | |
| kind | select `generic`, `coding-harness`, `app` | The last two are *later* |
| body | text, required | `{{var}}` placeholders, see §9 |
| return_instructions | text | Shown at the end of the block |

Rules: list, view and update `OWNER` · create and delete `""`. T0 seeds one generic row.

### runs

| Field | Type | Notes |
| --- | --- | --- |
| workspace | rel → workspaces, restrict | |
| role | rel → roles, restrict | |
| tasks | json | List of task ids. Vaultbase 0.40.2 refuses new `multiple` relations (F10), so this is a JSON list. |
| contenders | json | List of contender ids, as `tasks`. |
| judge | select `me`, `ai` | |
| judge_contender | rel → contenders | Copied from the workspace when `judge = ai` |
| method | select `rate`, `compare` | How the judge decides (§10a). From the request, else the workspace's `default_method`. Empty on runs from before Nov 18, 2026, which read as `rate`. Run again copies it. |
| both_orders | bool | Compare with the AI judge only: "Ask the AI judge both ways" (Cas, Nov 18, 2026). From the request's `both_orders`; forced false otherwise. Run again copies it. |
| rerun_of | rel → runs, setNull | |
| status | select `running`, `judging`, `done` | |
| call_count | number | The spending-guard figure shown before start |
| schedule | text | *later* (cron) |

Rules: list and view `OWNER` · create, update and delete `—`.

### attempts

| Field | Type | Notes |
| --- | --- | --- |
| run | rel → runs, cascade | |
| task | rel → tasks, restrict | Never changes |
| contender | rel → contenders, restrict | Never changes |
| mode | select `api`, `handoff` | Copied from the contender |
| status | select `queued`, `in_progress`, `waiting`, `submitted`, `judged`, `failed` | |
| prompt_sent | text | The rendered prompt; identical for every attempt on the same run and task |
| output | text | |
| output_files | file, multiple, 25 MB each | |
| tokens_in, tokens_out | number | |
| duration_ms | number | |
| provider_calls | number, min 0 | How many provider calls this output took, retries included (Cas, Nov 7, 2026). Empty for handoff outputs. |
| cost | number | Derived, empty when unknown |
| metrics_source | select `measured`, `manual` | |
| finish_reason | text | Provider stop reason, for example `end_turn`, `max_tokens` or `refusal` |
| error | text | Why it failed, or why AI judging failed |
| submitted_at | date | |

Rules: list and view `OWNER` · create and delete `—` · update `OWNER && mode = "handoff" && (status = "waiting" || (status = "submitted" && @request.body.status = "submitted" && @request.body.status:changed = true))`. Vaultbase checks an update rule on the record before and after the change (NOTES.md F14), so the rule allows a waiting output to be edited and to move once to submitted, and nothing after. Files can be attached only while the output is waiting (the upload route checks the same).

The `beforeUpdate` hook allows the owner to change only `output`, `output_files`, `tokens_in`, `tokens_out`, `duration_ms` and `status`. `status` may only go from `waiting` to `submitted`, and that change needs a non-empty `output` or at least one file. On submit it sets `metrics_source = manual`, `submitted_at`, and `cost` when prices and tokens allow, and it re-checks file names and types (F4). The `afterUpdate` hook enqueues AI judging when the run's judge is `ai`, then refreshes the run's status.

### verdicts

| Field | Type | Notes |
| --- | --- | --- |
| attempt | rel → attempts, cascade, required | |
| run | rel → runs, cascade | Denormalised for queries |
| method | select `rubric`, `pairwise`, `outcome` | `rubric` on Rate runs; `pairwise` for a pick on a Compare run (§10a); `outcome` for Phase 2a outcome checks (`docs/PHASE-2A.md`) |
| judge_kind | select `human`, `ai` | |
| judge_contender | rel → contenders, setNull | For AI verdicts |
| scores | json | `{ "<criterion>": { "stars": 1-5, "reason": "…" } }`; for a pick `{ "reason": "…" }` or empty |
| rubric_snapshot | json | The role's rubric at the moment of scoring |
| score | number | Weighted, 1 to 5, two decimals. Empty for a pick: the leaderboard view works out a Compare output's score from its picks. |
| status | select `active`, `overridden` | Exactly one `active` rubric verdict per scored attempt, and one `active` pick per pair; an outcome check stays `active` alongside either |
| opponent | rel → attempts | Picks only: the output shown on the right; `attempt` is the one on the left |
| winner | select `this`, `opponent`, `tie` | Picks only, from `attempt`'s side |
| due_at | date | Outcome checks only: when the check comes due (unix seconds). Score stays empty until the owner scores it. |

Rules: list and view `OWNER` · create `OWNER` (human verdicts only) · update and delete `—`.

The `beforeCreate` hook forces `judge_kind = human`, and the run's method decides the rest. On a Rate run it forces `method = rubric` (any `opponent` or `winner` sent is dropped). It fills `run`, `rubric_snapshot` and `score`, and checks that every rubric criterion has whole-number stars from 1 to 5. The attempt must be `submitted` or `judged`. The `afterCreate` hook marks every earlier active verdict on that attempt `overridden`, and sets the attempt to `judged`. On a Compare run it forces `method = pairwise`, needs an `opponent` that is another submitted or judged output of the same run and task and a `winner`, keeps an optional `scores.reason`, and empties `score` and `rubric_snapshot`. Its `afterCreate` marks any earlier active pick on the same pair (either way round) `overridden` and refreshes the run, which judges the outputs whose pairs are all decided. AI verdicts are written by the judge worker through `store.ts` (the records API); the `afterCreate` hook skips server writes, because the worker activates its own verdict before it finishes.

### castings

| Field | Type | Notes |
| --- | --- | --- |
| role | rel → roles, cascade | |
| contender | rel → contenders, restrict | |
| since | date | |
| rationale | text | |
| suggested_by | select `system`, `human` | |
| confirmed | bool | |

Rules: list and view `OWNER` · create, update and delete `—` (casting goes through a route). The current casting for a role is its newest confirmed casting, and older ones stay as history.

### leaderboard (view)

These are raw aggregates only. Confidence ranges, fitness and the suggested champion are computed in TypeScript (`lib/fitness.ts`) and served by a route, because they compare contenders with each other and need a t-table.

```sql
SELECT
  r.role || ':' || a.contender AS id,
  r.role AS role,
  a.contender AS contender,
  COUNT(v.score) AS n,
  AVG(v.score) AS mean_score,
  SUM(v.score * v.score) AS sum_sq,
  COUNT(CASE WHEN a.tokens_in IS NOT NULL AND a.tokens_out IS NOT NULL THEN 1 END) AS n_tokens,
  AVG(a.tokens_in + a.tokens_out) AS mean_tokens,
  COUNT(a.duration_ms) AS n_time,
  AVG(a.duration_ms) AS mean_time_ms,
  COUNT(a.cost) AS n_cost,
  AVG(a.cost) AS mean_cost,
  (SELECT COUNT(o.score) … WHERE o.method = 'outcome' AND o.status = 'active'
     AND orun.role = r.role AND oa.contender = a.contender)       AS n_outcome,
  (SELECT AVG(o.score) …same…)                                   AS mean_outcome
FROM vb_attempts a
JOIN vb_runs r ON r.id = a.run
JOIN (
  SELECT rv.attempt AS attempt, rv.score AS score FROM vb_verdicts rv
    WHERE rv.status = 'active' AND COALESCE(rv.method, 'rubric') = 'rubric'
  UNION ALL
  SELECT p.attempt AS attempt, ROUND(1 + 4.0 * SUM(p.points) / COUNT(*), 2) AS score FROM (
    SELECT pv.attempt AS attempt, CASE pv.winner WHEN 'this' THEN 1.0 WHEN 'tie' THEN 0.5 ELSE 0.0 END AS points
      FROM vb_verdicts pv WHERE pv.method = 'pairwise' AND pv.status = 'active'
    UNION ALL
    SELECT pv.opponent AS attempt, CASE pv.winner WHEN 'opponent' THEN 1.0 WHEN 'tie' THEN 0.5 ELSE 0.0 END AS points
      FROM vb_verdicts pv WHERE pv.method = 'pairwise' AND pv.status = 'active' AND pv.opponent IS NOT NULL
  ) p JOIN vb_attempts pa ON pa.id = p.attempt AND pa.status = 'judged'
  GROUP BY p.attempt
) v ON v.attempt = a.id
GROUP BY r.role, a.contender
```

Guest voters (§10b, Nov 18, 2026) add a third part to `v`, tagged `src = 'g'` (the first two are `'j'`): one score per output from the guests of links the owner set to count, once it has 3 or more guest votes (the average stars, or `1 + 4 ×` the guests' win share on a Compare run). The view also has `n_guest`, and tokens, time and cost are averaged over the `'j'` rows only, so an output with a crowd score isn't counted twice. The exact query is in `schema/snapshot.json`. `v` holds one score per scored output: its active rubric verdict's score on a Rate run, or on a Compare run `1 + 4 × (wins + ties / 2) / pairs played` over its active picks, counted once the output is `judged` (§10a, Nov 18, 2026). Phase 2a (Cas approved Nov 12, 2026): quality counts rubric verdicts only, and scored outcome checks get their own two columns, which never enter quality or fitness. Only scored outputs count, and tokens and time are averaged over those same outputs. Rules: list and view `OWNER`. T0 confirms the table names (`vb_<name>`, from `src/core/collections.ts`, `userTableName`) and the storage form of relation columns before writing this query.

## 7. Custom routes

All routes need the owner (`requireAuth: true`, plus a check that the caller is in `users`), except `GET /app/*` and the three guest routes (§10b), which check for a guest session themselves. They take and return JSON, and their errors look like Vaultbase's: `{ "error": "…", "code": 422, "details"?: {…} }`. Paths below are relative to `/api/custom`.

| Method and path | Thread | Does |
| --- | --- | --- |
| `GET /app/*` | T0 | Serves `ui/dist`. Unknown paths serve `index.html`. Not signed in, because the UI itself handles sign-in. |
| `POST /runs/preview` | T1 | `{ role, tasks[], contenders[], judge, method? }` (`method` is `rate` or `compare`, default the workspace's; `compare` needs two contenders or more) → `{ outputs, api_calls, handoff_outputs, judge_calls, total_provider_calls, warnings[] }`. Warnings include "the AI judge shares a provider with Mock Steady". |
| `POST /runs` | T1 | Same body as preview. Checks that the tasks belong to the role and the contenders are enabled, renders one prompt per task (§9), creates the run and one attempt per task × contender, locks every task and contender used, then enqueues each API attempt on `generate`. Returns `{ run }`. |
| `POST /runs/:id/again` | T1 | A new run with the same role, tasks, contenders and judge, `rerun_of = :id`. Only for runs that are `done`. |
| `GET /runs/:id` | T1 | `{ run, counts: { queued, in_progress, waiting, submitted, judged, failed }, attempts: [{ id, task, contender, mode, status, tokens_in, tokens_out, duration_ms, provider_calls, cost, finish_reason, error }], guests: [{ id, token, active, counts, expires_at, max_guests, created, guests, votes, state }] }`, for the live view to poll. Not blind. |
| `GET /handoff/:runId/:taskId` | T2 | `{ prompt, attachments: [{ name, url }], waiting: [{ attempt, contender_name }] }`. The prompt is the stored `prompt_sent`. |
| `GET /judging/:runId/:taskId` | T3 | The blind payload (§10). Each output also has `guests: { votes, score, counts } \| null` (§10b). |
| `GET /leaderboard/:roleId` | T3 | `{ terms_used: ["quality", "tokens"], dropped: [{ term: "time", reason: "Codex (manual) has no time data" }], rows: [{ contender, name, group, n, mean_score, ci_low, ci_high, mean_tokens, mean_time_ms, mean_cost, fitness, n_outcome, mean_outcome, n_guest, qualifies, enough_data }], suggested: contenderId \| null, casting: { contender, since } \| null }` |
| `POST /castings` | T3 | `{ role, contender, rationale? }`. Refuses unless the contender qualifies (§11). Creates a confirmed casting with `suggested_by` set to `system` if it was the suggestion, otherwise `human`. |
| `POST /tasks/:id/compose` | Composer | Checks the task is unlocked and not already composing and that the workspace's Composer is an enabled `api` contender, sets `tasks.compose` to `composing`, enqueues `compose` with `{ task }`, and returns `{ task }` at once (§9a). |
| `GET /guest/:token` | Guest voters | A guest's blind ballot (§10b). Guest sessions only. |
| `POST /guest/:token/votes` | Guest voters | `{ task, label, stars }` or `{ task, left, right, pick }`. One vote per guest per output or pair. |
| `GET /guest/:token/files/:task/:label/:i` | Guest voters | An output file for a guest, under a neutral name. |
| `DELETE /connections/:id/key` | T1 | Removes the stored key (F2) |
| `POST /files/:collection/:id/:field` | T2 | The owner's upload path, built while Vaultbase's own was broken (NOTES.md F9, fixed in 0.41.1; F15, O6). Kept until part B of `docs/PLATFORM-UPGRADES.md`. Multipart, parts named `file`. Only `attempts/output_files` (handoff, waiting) and `tasks/attachments` (unlocked). 25 MB per file, Phase 1 types, all or nothing. Returns `{ data: record }`. |

## 8. Workers and the run lifecycle

The run queues are below (the Composer's `compose` queue too; `email` and `repeat` are Phase 2a). Each queue has one worker file.

**`generate`** (`vb_hooks/workers/generate.ts`, concurrency 4, retries 1). The worker's own retry is off for provider errors, because `helpers.http` already retried.

1. Set the attempt to `in_progress`, unless it isn't `queued` any more, in which case stop.
2. Load the contender and connection. Read the key through `helpers.find("connection_keys", …)`, unless the connection is `mock`.
3. Call `providers[provider].generate({ model, config, maxOutputTokens, prompt: attempt.prompt_sent, attachments, apiKey, baseUrl, seed })` and time it.
4. On success, store `output`, any files (mock images), `tokens_in`, `tokens_out`, `duration_ms`, `cost`, `finish_reason` and `metrics_source = measured`, and set the status to `submitted`. A `max_tokens` finish is still `submitted`, and the UI shows "cut off at max output tokens".
5. On failure (refusal, HTTP error after retries, timeout, or a bad response), set `status = failed` and record `error`. Nothing is rethrown, so the queue never spins.
6. If the run's judge is `ai`, enqueue `judge` with `{ attempt }`. Then refresh the run's status.

**`judge`** (`vb_hooks/workers/judge.ts`, concurrency 2). On a Compare run the payload is `{ attempt, opponent }`, one job per pair, and the worker runs `judgePair` instead (§10a). Otherwise this worker calls the run's `judge_contender` through the same adapters, with the judge prompt and output schema (§10). It stores an `ai` verdict with `status = active`, unless a human verdict already exists, and sets the attempt to `judged`. If the reply doesn't match the schema, it retries once. After that it leaves the attempt `submitted`, writes "AI judging failed: …" to `attempt.error`, and the owner judges it by hand.

**`compose`** (`vb_hooks/workers/compose.ts`, concurrency 2, retries 1). One job per Compose press; `lib/composer.ts`, `runCompose`, does the work and never throws (§9a).

**Run status.** `lib/runs.ts`, `refreshRunStatus`, recomputes the status after every attempt change:

- `running` while any attempt is `queued`, `in_progress` or `waiting`;
- `judging` while any attempt is `submitted`;
- `done` when every attempt is `judged` or `failed`.

A run of only failures is `done`. Failed attempts aren't judged and don't count.

**Cost.** `cost = (tokens_in × price_in_per_mtok + tokens_out × price_out_per_mtok) / 1,000,000`. It is computed only when both prices and both token counts are present; otherwise it stays empty and shows "N/A".

**Call count** (spending guard). It is the number of API outputs, plus the number of outputs to be judged (on a Compare run, the number of pairs: tasks × n × (n − 1) / 2) when the judge is `ai` and the judge contender isn't the mock. Handoff outputs make no generation call, but are counted under "judge calls" when the judge is AI.

## 9. Prompt rendering (generic template)

The prompt is rendered **once per task when the run starts**. The same text is stored on every attempt for that task, and the API contenders get it too, as the user message, with the contender's own `system_prompt` (if any) as the system prompt. Every contender therefore sees exactly the same task text. This goes slightly beyond the spec, which describes the template only for handoff; see [spec changes](#spec-changes-in-this-pr).

Seeded `body` of the generic template:

```
You are acting as: {{role.name}}.
Role description: {{role.description}}

TASK: {{task.title}}
{{task.prompt}}
{{#if task.base_ref}}
Work in the repository {{task.base_ref.repo}}, starting from commit {{task.base_ref.commit}}.
{{/if}}{{#if attachments_text}}
Attached files: {{attachments_text}}
{{/if}}
You will be judged on:
{{rubric_text}}

{{return_instructions}}
```

`rubric_text` is built in TypeScript, one line per criterion: `1. Accuracy (40%): <guidance>`. `return_instructions` depends on the task's output type:

- **text:** "WHEN DONE, reply with your answer only."
- **image:** "WHEN DONE, return the image files and a one-line description of each."
- **file:** "WHEN DONE, return the files and a short summary of what each contains."
- **code:** "WHEN DONE, reply with: a short summary of what you built; the branch name or diff; build, test and lint results (pass or fail, with counts); any screenshots, as files."

The task prompt is stored as editor HTML. `lib/handoff.ts` converts it to plain text with line breaks before rendering, so the copied block holds no tags.

## 9a. The Composer

Added Nov 18, 2026. The code is `lib/composer.ts`, the route `routes/tasks-compose.ts` and the worker `workers/compose.ts`.

- **Why a queue.** A route has 30 seconds (F5, `routes.timeout_ms`) and a Claude call with thinking can take minutes, so composing is a `compose` job like generating and judging. The task's `compose` field carries the status, and the task page follows it over realtime (`tasks/<id>`), polling every 2 seconds while realtime is down.
- **The call.** `runCompose` renders the task's generic prompt (`promptForTask(…, { generic: true })`, so an earlier composed prompt is ignored) and sends it in one call to the Composer contender, through the same adapters and key lookup as the generate worker (`callable`, `callProvider`), with the contender's own model, config and max output tokens. System prompt `COMPOSER_SYSTEM` (keep the scope, add the goal, steps, output format and what great looks like per rubric line, keep file names and the WHEN DONE line, plain text). Output schema `{ prompt: string }`; a reply that ignores the schema is used as plain text. No attachments are sent: the Composer sees their names in the plain prompt.
- **Writes.** Both go through `helpers.records` (`store.ts`): the draft and `compose = { status: done, tokens_in, tokens_out, cost, duration_ms, done_at }`, or `compose = { status: failed, error }` with the old prompt untouched. If the task was locked meanwhile (a run started), or the owner composed again (`asked_at` changed), the result is dropped.
- **Which prompt a run sends.** `promptForTask` returns `composed_prompt` when it isn't empty, else the generic prompt (§9). That one change covers `POST /runs`, Run again and scheduled repeats, API and handoff alike, and `prompt_sent` keeps the exact text. `loadPlan` refuses (409) a task whose `compose.status` is `composing`.
- **Guards.** `taskBeforeWrite` refuses an owner write that changes `compose`. The update rule's `locked = false` and `guardLocked` keep a used task's composed prompt fixed, like the rest of the task.
- **Mock.** Any mock contender except Fail (and Flaky on its first try) answers a Composer call: it returns the plain prompt with a fixed "HOW TO DO WELL" block before the last line, so tests can tell a composed prompt from the generic one.
- **UI.** Workspace settings has a "Composer" panel (an API contender or "No Composer"). The task page has a "Prompt the contenders get" panel: Plain / Composing / Composed chip, the **Compose with <name>** (later **Compose again**) button, the editable draft saved with the task, "Use the plain prompt", the error when it failed, and "Written by … · tokens · cost". Compose saves the task's visible edits first, so the Composer reads what the owner sees. Start a run marks tasks with "Composed prompt".
- **Tests.** `test/composer.test.ts` (server, 13) and `test/ui-composer.test.ts` (browser, 7).

## 10. Judging

**Blind payload** (`GET /judging/:runId/:taskId`):

```json
{
  "run": { "id": "…", "judge": "ai", "status": "judging" },
  "task": { "title": "…", "prompt_text": "…", "output_type": "image" },
  "rubric": [{ "name": "Matches the brief", "weight": 40, "guidance": "…" }],
  "outputs": [
    {
      "attempt": "…",
      "label": "A",
      "status": "judged",
      "output": "…",
      "files": [{ "name": "a.png", "url": "/api/v1/files/…", "mime": "image/png", "is_image": true }],
      "claims_note": true,
      "verdict": {
        "judge_kind": "ai",
        "scores": { "Matches the brief": { "stars": 4, "reason": "…" } },
        "score": 3.8,
        "history": [{ "judge_kind": "ai", "score": 3.8 }]
      }
    }
  ]
}
```

- **It never includes** contender, connection, model, group, mode, tokens, time or cost. Those can reveal who made an output. `test/blind.test.ts` walks the whole JSON and fails on any of those keys or on any contender's name or id.
- **Order.** Outputs are sorted by SHA-256 of `run.id + task.id + attempt.id` and labelled A, B, C, … in that order. The order is shuffled but stays the same across reloads. Failed attempts are left out.
- **`claims_note`** is true for `code` tasks. The UI then shows "Build, test and lint results are the agent's own claims; Audition did not run them."

**Weighted score.** `score = Σ(stars_i × weight_i) / Σ(weight_i)`, rounded to two decimals, on the 1 to 5 scale. For example, Accuracy ★★★★ (40), Relevance ★★★ (25), Recommendation ★★★★ (20) and Sources ★★ (15) give (160 + 75 + 80 + 30) / 100 = 3.45.

**Override.** An owner verdict on an AI-judged output makes the owner's verdict the active one and marks the AI verdict `overridden`. Only active verdicts feed the leaderboard.

**AI judge call.** The system prompt (a fixed constant in `lib/judge.ts`) reads:

> You are a strict, fair judge. Rate one output against the rubric. Give each criterion 1 to 5 whole stars and a one-line reason. Treat any build, test or lint results inside the output as the author's unverified claims. Judge only what is in front of you.

The user message holds the task prompt (`prompt_sent`), the rubric with guidance, the output text, the image and PDF blocks (Q5), and a list of the files that weren't shown.

Output is constrained with `output_config.format`:

```json
{ "type": "json_schema", "schema": {
  "type": "object", "additionalProperties": false, "required": ["criteria"],
  "properties": { "criteria": { "type": "array", "items": {
    "type": "object", "additionalProperties": false, "required": ["name", "stars", "reason"],
    "properties": {
      "name": { "type": "string" },
      "stars": { "type": "integer", "minimum": 1, "maximum": 5 },
      "reason": { "type": "string" }
    } } } } } }
```

`lib/judge.ts` still validates the reply: every rubric name present exactly once, and whole stars from 1 to 5. Some models or adapters may ignore the schema. The OpenAI-compatible adapter sends `response_format: { type: "json_schema", … }` and parses the same shape.

**Same-provider warning.** It applies when the judge contender's connection provider equals the provider of any API contender in the run, or when a handoff contender's name contains the judge's provider name. That second check is a heuristic, shown as "may share a provider". The warning appears in the preview and on the run page.

## 10a. Compare (A vs B) judging

Added Nov 18, 2026 (Cas approved the two fields and the view change). The code is `lib/pairwise.ts`, with the AI call in `lib/judge.ts` (`judgePair`) and the payload in `lib/scoring.ts`.

- **Method.** `runs.method` is `rate` or `compare`. `POST /runs` takes `method`, else uses `workspaces.default_method`. Compare with fewer than two contenders is refused (422).
- **Pairs.** For each task, every two non-failed outputs make a pair. `pairSides(run, x, y)` decides which is shown left (first to the AI): stable, but shuffled per pair by SHA-256 of the run id and both ids, so neither side is favoured.
- **A pick** is one verdict: `method = pairwise`, `attempt` = left, `opponent` = right, `winner` = `this`, `opponent` or `tie`, `score` empty. One active pick per pair; a new one marks the old one `overridden`. The owner's pick beats the AI's, like a star override.
- **Judged.** `refreshRunStatus` first runs `settleCompareRun`: once none of a task's outputs is queued, in progress or waiting, each submitted output whose pairs all have an active pick moves to `judged` (and gets its outcome check, Phase 2a). An output with no live rival is judged at once without a score. The run's status rules (§8) are unchanged.
- **Score.** `1 + 4 × (wins + ties / 2) / played`, two decimals, worked out by the leaderboard view (§6) and by the payload below. It never gets stored, so an overridden pick changes it at once.
- **Both ways** (`runs.both_orders`, a per-run checkbox, off by default). `judgePair` asks a second time with the sides swapped and keeps the pick only if both answers agree; if they disagree the pick is a tie, with the reason saying so. Still one verdict per pair. The call count doubles (preview and `call_count`), and Start a run shows the cost next to the checkbox: "Both ways: 12 AI judge calls instead of 6."
- **AI judge.** When an output is submitted, `queueJudging` enqueues one `judge` job per rival already in (unique key `judge:<left>:<right>`), so each pair is queued once, by whichever output arrived last. `judgePair` sends both outputs in one call: the system prompt `PAIR_SYSTEM`, the task as sent, the rubric with weights, "THE FIRST OUTPUT" and "THE SECOND OUTPUT" with their files (neutral names `first-1.png`, `second-1.png`; the same file rules as Q5). Output schema: `{ winner: "first" | "second" | "tie", reason: string }`. A bad reply is retried once; then "AI judging failed: …" goes on both outputs and the owner picks. The mock judge picks the higher `[[mock-quality:n]]` marker.
- **Blind payload.** On a Compare run `run.method` is `compare`, each output has `record: { wins, ties, losses, played, score }` and `verdict: null`, and there is a `pairs` list in label order (A vs B, A vs C, B vs C): `{ left, right, left_attempt, right_attempt, ready, pick: { judge_kind, winner: "left" | "right" | "tie", reason } | null, history: [{ judge_kind, winner, status }] }`. Nothing in it names a contender (`test/pairwise.test.ts` walks it as `blind.test.ts` does).
- **UI.** "Start a run" and workspace settings have a "Rate (stars) / Compare (A vs B)" choice; with Compare and the AI judge, Start a run also offers "Ask the AI judge both ways" with its cost. A "How is this score worked out?" popover on the judging screen and the leaderboard explains the score with a worked example. The judging screen shows one pair at a time with "A is better", "About the same", "B is better", a row of pair chips, and the task's standings. The run page shows the method as a badge.

## 10b. Guest voters

Added Nov 18, 2026. Cas approved the schema (`guests`, `guest_links`, `guest_votes`, the leaderboard view) and the rule "the crowd counts as one judge". The code is `lib/guests.ts`, three guest routes, two `guest_links` hooks, the `sweep-guests` job, `ui/src/pages/vote/[token].js` and `ui/src/lib/guest.js`.

- **Who a guest is.** A Vaultbase anonymous session (`POST /api/v1/auth/guests/anonymous`, setting `auth.anonymous.enabled`, in `SETTINGS`). It lives in its own auth collection, `guests`, never in `users`. Every API rule on Audition's collections needs `@request.auth.collectionName = "users"`, and every owner route checks `isOwner` (type user, collection `users`), so a guest token reaches nothing but the guest routes (`test/guests.test.ts` lists every collection and owner route). `users` keeps `create_rule = ""`, so an anonymous sign-in there answers 403. The `guests` create rule is `@request.body.email:isset = false`: the anonymous sign-in passes it, a register with an email doesn't. A guest can view only its own record. Vaultbase counts an anonymous session as not signed in for `requireAuth` routes, so the guest routes set `requireAuth: false` and check `isGuest` (type user, collection `guests`, `anonymous: true`) themselves.
- **guest_links** (owner CRUD, record history on): `run` (cascade), `token` (unique index), `active`, `expires_at` (unix seconds), `max_guests` (1 to 500), `counts`. The before-hooks make the token (64 hex characters from two random UUIDs; whatever the owner sends is replaced), default `active = true`, `counts = false`, `max_guests = 50`, `expires_at` = now + 7 days, refuse an end date more than 30 days out, and refuse changing `run` or `token`.
- **guest_votes** (owner list and view; no REST writes, the vote route writes through `helpers.records`): `link` (cascade), `run`, `task`, `guest` (setNull), `attempt`, `opponent`, `stars` (1 to 5) or `winner` (`this`, `opponent`, `tie`). One vote per guest per output (Rate) or per pair (Compare, either way round); voting again changes it.
- **Routes.** `GET /guest/:token`: the blind ballot. `POST /guest/:token/votes`: `{task, label, stars}` or `{task, left, right, pick: "left" | "right" | "tie"}`. `GET /guest/:token/files/:task/:label/:i`: an output file under its neutral name (`A-1.png`), read from local storage (Vaultbase's file endpoint checks the attempts view rule, which only the owner passes), with `content-security-policy: sandbox` and `nosniff`. Every call checks the link: unknown token 404; closed, expired, or full for a new guest 410 (a guest who already voted always gets back in). `GET /runs/:id` also returns `guests`, the run's links with guest and vote counts and a state (`open`, `closed`, `expired`, `full`).
- **The ballot is blind.** Tasks with their title and prompt (the composed prompt if there is one), outputs by letter only (the same letters as the owner's judging screen), the rubric names and guidance as "what makes a good answer", the guest's own votes, and on Compare runs every pair with sides from `pairSides`. No attempt or contender ids, names, models, tokens, time, cost, scores or anyone else's verdicts. Only `submitted` and `judged` outputs show.
- **How guest votes count.** Only on links with `counts` on, and only per output with 3 or more guest votes (`CROWD_MIN`). Then all those votes together are one more score in the leaderboard's mean (§6): the average stars, or `1 + 4 ×` the win share. However many guests vote, they never outweigh one judge. Owner and AI verdicts are untouched. The judging screen shows each output's crowd ("Guests 4.3 · 3 votes", with "not counted" when it doesn't count) and the leaderboard shows "(1 from guests)" next to the count.
- **Limits.** Vaultbase's rate limiter (`RATE_LIMIT_RULES` in `scripts/lib/vaultbase.ts`, per client address): 10 guest sign-ins a minute, 240 guest route calls a minute, then Vaultbase's own defaults. Setting `rate_limit.rules` replaces the defaults, so they are repeated there. Behind Cloudflare the limiter sees the visitor's address because `audition.env` trusts the local proxy (RELEASE.md). A link takes 50 guests by default and closes after 7 days.
- **Clean-up.** `sweep-guests` (daily, 04:17 UTC) deletes guest accounts older than 31 days. Their votes stay, without the guest.
- **UI.** The run page has a "Guest votes" panel: "Ask guests to vote" makes a link (and closes any open one), with Copy link, guests and votes, the end date, a "Count on the leaderboard" switch and Close link; earlier links are listed with their state and switch. The guest page (`/vote/<token>`, no sign-in, no app chrome) shows the ballot task by task, saves each vote at once, and thanks the guest when everything is done. A closed or expired link shows "Voting is closed" with the reason. The guest's session is kept under its own storage key, apart from the owner's token.

## 11. Leaderboard, fitness and the champion

`lib/fitness.ts` is pure and unit-tested. Its input is the leaderboard rows for one role, the workspace weights and `min_outputs`, and the role's `pass_mark`.

- **Quality.** `Q = (mean_score − 1) / 4`. For a Compare output this is its win share.
- **Tokens.** `T = mean_tokens / max(mean_tokens)` over the role's rows. The term is used only if **every** row has `n_tokens ≥ 1`, and it is 0 when the max is 0.
- **Time.** `D` is the same as T, using `mean_time_ms` and `n_time`.
- **Fitness.** `fitness = (w_q·Q − w_t·T − w_d·D) / 100`, with the weights as stored percentages. A dropped term contributes nothing, and the response lists it under `dropped` with the reason, naming the contender that lacks data. Weights are not rescaled when a term drops, so every row in the role is compared on the same terms.
- **Confidence range.** For `n ≥ 2`: `sd = √((sum_sq − n·mean²) / (n − 1))` and `half = t(0.975, n − 1) · sd / √n`. The range is `[mean − half, mean + half]`, clamped to the 1 to 5 scale. `lib/fitness.ts` has a t-table for 1 to 30 degrees of freedom and uses 1.96 above that. For `n < 2` there is no range.
- **Qualifies.** `n ≥ min_outputs` and `mean_score > pass_mark` (strictly above, as the spec says).
- **Suggested champion.** The qualifying row with the highest fitness. Ties go to the higher mean score, then more outputs, then the contender name. When nothing qualifies, `suggested` is null and the rows below the minimum show "not enough data yet". This covers the single-contender path in Stock Review: one contender with at least 5 outputs above 3.5 is suggested.

## 12. Provider adapters

`vb_hooks/lib/providers/` has one file per provider. Each implements:

```ts
interface GenerateInput {
  model: string; config: ContenderConfig; maxOutputTokens: number;
  system?: string; prompt: string;
  attachments: Array<{ name: string; mime: string; bytes: Uint8Array }>;
  outputSchema?: object;            // judge calls only
  apiKey?: string; baseUrl?: string;
  seed: string;                     // mock only
  http: HttpHelpers;                // injected; tests pass a fake
}
interface GenerateResult {
  text: string; files: Array<{ name: string; mime: string; bytes: Uint8Array }>;
  tokensIn: number | null; tokensOut: number | null;
  finishReason: string | null;
}
// Throws ProviderError { message, retryable } on failure.
```

**Anthropic** (`anthropic.ts`)

- Request: `POST {baseUrl || https://api.anthropic.com}/v1/messages`, with headers `x-api-key`, `anthropic-version: 2026-10-21` and `content-type: application/json`.
- Body: `{ model, max_tokens, system?, messages: [{ role: "user", content: [ …image/document/text attachment blocks, { type: "text", text: prompt } ] }], output_config: { effort?, format? } }`. There is no `temperature` and no `thinking` field: current models think adaptively by default, and effort controls depth.
- Attachments: images and PDFs as base64 blocks (Q5); text files as text blocks headed with the file name; zips listed by name.
- Tokens: `tokensIn = usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)`, and `tokensOut = usage.output_tokens`.
- Text: the `text` blocks joined.
- Finish reason: `stop_reason`. `refusal` throws a non-retryable `ProviderError` that includes `stop_details.category`.
- No streaming in Phase 1. The 10-minute HTTP timeout (F5) covers long thinking. If Cas's real check shows timeouts at high `max_tokens`, streaming comes in a later PR.

**OpenAI-compatible** (`openai-compatible.ts`). Request: `POST {baseUrl}/chat/completions` with `Authorization: Bearer`, and body `{ model, messages, max_tokens, temperature?, reasoning_effort? }`. Images go as `image_url` data URIs; tokens come from `usage.prompt_tokens` and `usage.completion_tokens`, and the finish reason from `choices[0].finish_reason`. It is unit-tested against a fake `http` only. No real call is made in Phase 1.

**Mock** (`mock.ts`). It runs in-process with no HTTP, and is deterministic from `seed = sha256(task.id + contender.id + n)`, where `n` is how many earlier attempts exist for that task and contender. Each "Run again" therefore gives a new but repeatable result. Behaviours:

| Behaviour | Output | Tokens and time |
| --- | --- | --- |
| `steady` | A templated answer that echoes the task title, ending with the marker `[[mock-quality:4]]` | in = ⌈prompt length / 4⌉, out = 300 |
| `erratic` | As steady, with a quality of 2, 3, 4 or 5 chosen by the seed | out = 150 to 600 by seed |
| `fail` | Throws a non-retryable error every time | |
| `flaky` | Throws a retryable error on the first try of each attempt, then behaves as steady | |
| `image` | One or two PNGs from `seed/fixtures/images/`, with a caption; marker quality 3 or 4 by seed | out = 50 |
| `judge` | Given a judge schema, stars per criterion equal to the output's quality marker (default 3), plus 1 per image for criteria named "Visual quality", capped at 5. Reason: "mock judge". | |

`duration_ms` for mock outputs is a seeded fake (200 to 2,000 ms), not wall time, so tests are repeatable.

**Mock files.** The image mock needs a server-side file attach that the files API doesn't offer (F1, F4). `lib/files.ts`, `attachFile(collection, recordId, field, name, mime, bytes)`, does what `POST /api/v1/files/…` does (`src/api/files.ts`, the upload handler):

1. Write the bytes into the upload directory as `<uuid>.<ext>`.
2. Insert the file's metadata row.
3. Add the file name to the record's field column.

T0 must prove this with a test: attach through `lib/files.ts`, then fetch the file through `GET /api/v1/files/<name>` as the owner. If that can't be made to work cleanly, T0 stops and reports. The fallback is to keep mock images in `seed/fixtures` as records on a small `fixtures` collection and reference them, which is a schema change for Cas to approve.

## 12a. Image models (OpenAI-compatible Images API)

Added Nov 18, 2026. `lib/providers/openai-images.ts`. No schema change: a contender's `config.image` (see contenders) turns an OpenAI-compatible contender into an image maker, and `callProvider()` sends it here instead of to `openai-compatible.ts`.

- **Request.** No image attachments: `POST {baseUrl}/images/generations`, JSON `{ model, prompt, n, size?, quality?, output_format?, background?, response_format? }`. With image attachments (PNG, JPEG, GIF, WebP): `POST {baseUrl}/images/edits`, `multipart/form-data` built by hand (`editsBody()`, since `helpers.http` takes a `Uint8Array` body and a content type), the same fields as text parts and each image as `image` (one) or `image[]` (several). `Authorization: Bearer` as for chat. 10-minute timeout, 3 tries, as for the other adapters.
- **Prompt.** The contender's system prompt, then "Attached files not shown here: …" for non-image attachments, then the rendered task prompt (the same text every contender gets, §9).
- **Reply.** Each `data[].b64_json` is decoded; the file type is sniffed from its first bytes (PNG, JPEG, WebP, GIF; anything else fails) and named `image-<n>.<ext>`. The output text lists the file names, with `revised_prompt` when the provider sends one. Tokens from `usage.input_tokens` / `usage.output_tokens` (gpt-image), else empty; cost is derived as usual. `finish_reason` is `images`.
- **Why base64 only.** Vaultbase's `helpers.http` (still in 0.47) always reads the reply with `res.text()`, so downloading an image from a link would corrupt it. gpt-image always answers in base64; DALL·E and some compatible servers need `ask_b64` (sends `response_format: "b64_json"`). A reply with links only fails with that hint. The egress guard (F3) is unchanged: only the connection's host is called.
- **Storing.** The generate worker already stores `GenerateResult.files` with `lib/files.ts attachFile()` on `attempts.output_files` (thumbs and download audit included), so judging, the AI judge and Compare need no change.
- **Guards.** An image maker can't answer a call with `outputSchema` (judge, Composer): `callProvider()` refuses before any HTTP call, `loadPlan()` refuses it as the AI judge and `composerFor()` as the Composer, and the workspace screen leaves image makers out of both pickers. `previewOf()` adds `imageMismatchWarnings()`: an image maker on a task whose `output_type` isn't `image`, and an OpenAI-compatible text contender on an `image` task.
- **Not done (needs Vaultbase).** Replicate (Flux, Stable Diffusion, Ideogram, Recraft, …) answers with `replicate.delivery` links, which `helpers.http` can't download as bytes. NOTES I1 has the request. Google Imagen/Gemini (inline base64) would work today but needs a new `connections.provider` value, a schema change for Cas to approve.
- **Tests.** `test/images.test.ts`: request bodies (JSON and multipart), reply parsing and failures against a fake http; config checks; warnings; and one output end to end on a fresh Vaultbase through the test-only route `test/vb_hooks_test/routes/_test-generate.ts` (`runGenerate` with a fake `helpers.http`), checking the files, thumbnail, tokens and cost.

## 13. Testing

- **One fresh instance per test file.** `test/harness.ts` creates a temporary directory, picks a free port, starts the pinned binary with `--apply-snapshot`, creates the admin and the owner, applies the settings, and waits for `/_/ready`. It tears everything down after the file. Tests talk to it over HTTP as the owner (or as the admin where a test says so).
- **Pure modules** (`lib/handoff.ts`, `lib/fitness.ts`, `lib/judge.ts` validation, `lib/providers/*` against a fake `http`, `lib/scoring.ts`) are unit-tested without a server.
- **No real keys.** The suite fails fast if any key-like `ANTHROPIC_*` or `OPENAI_*` variable is set (a name with KEY, TOKEN or SECRET), so a key can't leak into a cloud run. Vaultbase never sees any `ANTHROPIC_*` or `OPENAI_*` variable. Claude Code sets `ANTHROPIC_BASE_URL` for itself, which is why the check is by name.
- **Evidence.** Every build PR pastes the full `bun test` output into its description.

## 14. Open questions

| # | Question | Who | Recommendation |
| --- | --- | --- | --- |
| O1 | ~~Pin v0.37.0 or move to v0.40.2?~~ Decided Nov 6, 2026: pin v0.40.2, with the upgrade policy in §1. | Cas | Done |
| O2 | Create `go4cas/audition-factory-demo` for the Software Factory coding tasks? | Cas | Created Nov 6, 2026. Cas pushed `fixtures/factory-demo/` on Nov 7, 2026; the seed names commit `9c4bb7a`. Done. |
| O3 | Can a cloud session run the binary? This thread was stopped from executing it by a safety check, so the boot is unproven here. | T0 | T0 boots it first thing and records the result in `NOTES.md`. |
| O4 | The leaderboard view joins `vb_runs` for the role. T0 confirms table and column names. | T0 | — |
| O5 | Does `--apply-snapshot` create view collections in the right order (after their tables) on a fresh data directory? | T0 | If not, apply the snapshot twice, or split it into base and view snapshots. |

The remaining spec open questions are unchanged: the image-grid layout goes to Design; vector search over MCP and the "Audition" name go to Phase 2 or later.

## 15. Build breakdown

The spec's thread plan stands: T0 merges first, then T1 to T4 run in parallel, then T5. Below, each thread's scope gains the files it owns, and its Done-when list is concrete enough for the Review thread to tick. A thread touches only its own files plus tests. A need outside them goes to the orchestrator as a question.

### T0 Foundations

**Owns:** `vaultbase.lock.json`, `package.json`, `scripts/` (including `vb:bump`), `test/upgrade.test.ts`, `schema/snapshot.json`, `seed/`, `test/harness.ts`, `vb_hooks/lib/store.ts`, `vb_hooks/lib/files.ts`, `vb_hooks/lib/providers/mock.ts`, `vb_hooks/routes/app.ts` (serving a placeholder page), every validation and locking hook in §6, the generic template seed, and `fixtures/factory-demo/`.

**Done when:**

1. From a fresh clone, `bun run dev` downloads the binary, verifies its checksum (a tampered file is refused), applies the snapshot, creates the admin and the owner, seeds the four reference workspaces, and prints the UI URL. `/api/custom/app/` serves the placeholder.
2. `bun test` passes the following:
   - The schema matches the snapshot (`migrations/diff` is empty).
   - Every *later* field exists and is nullable.
   - Rules are tested per collection: anonymous is refused everywhere, and the owner has exactly the access in §6.
   - `api_key` is never returned to the owner by list, view, expand or batch.
   - A locked task or contender can't be updated or deleted.
   - Rubric weights must sum to 100.
   - A `store.ts` write round-trips through REST.
   - `lib/files.ts` attaches a file that `GET /api/v1/files/…` serves.
   - The mock provider is deterministic for the same seed.
   - Seeding twice creates nothing new.
   - `bun run vb:bump <version>` rewrites the lock file from that release's `SHA256SUMS`, and refuses a version that has no checksum for this platform.
   - `test/upgrade.test.ts` runs a seeded loop on one binary, restarts on the same data folder, and finds everything intact.
3. `docs/NOTES.md` records Q1 to Q4 and F1 to F8, each confirmed against the running binary with the command and output, and answers O3 to O5.

### T1 API execution

**Owns:** `routes/runs*.ts`, `routes/connections-key.ts`, `workers/generate.ts`, `lib/runs.ts`, `lib/cost.ts`, and `lib/providers/{index,anthropic,openai-compatible}.ts`.

**Done when:**

1. A run of 2 tasks × 3 mock contenders (steady, erratic, flaky) produces 6 attempts that become `submitted`, each with tokens and time. The flaky one shows that a retry happened, through the call count.
2. Run again creates a new run of 6 attempts linked by `rerun_of`, and leaves the first 6 byte-for-byte unchanged.
3. The adapters' fake `http` records `max_tokens` = the contender's `max_output_tokens` on every call.
4. The Anthropic request matches a golden JSON: version header, no `temperature`, effort in `output_config`, and image blocks for an image attachment.
5. Cost is derived when both prices are set and stays empty otherwise.
6. A `fail` contender gives a `failed` attempt with an error, and the other attempts still finish. The worker never throws past its handler.
7. `POST /runs/preview` returns the right call counts for API-only, handoff-only and mixed runs, with and without an AI judge.
8. Tasks and contenders are locked after their first run.
9. An egress check refuses a provider URL whose host isn't the connection's.

### T2 Handoff

**Owns:** `lib/handoff.ts`, `routes/handoff.ts`, and the attempt submit hooks (`hooks/attempts-*.ts`).

**Done when:**

1. A seeded Software Factory coding task renders one prompt containing the role, the description, the task, the repo and commit, the numbered rubric and the code return instructions. Every handoff and API attempt on that run and task stores the identical string, checked by hash.
2. Text, image and file tasks get their own return instructions. A task without `base_ref` shows no repo line.
3. A pasted output submits once. A second PATCH, a PATCH on a non-handoff attempt, and a PATCH that changes `contender` or `task` are all refused.
4. Optional tokens and time are saved with `metrics_source = manual`.
5. A 26 MB upload is refused, as is a `.exe` declared as `application/octet-stream`, and an upload after submit. Text, PNG, PDF and zip uploads are accepted.

### T3 Judging and fitness

**Owns:** `lib/scoring.ts`, `lib/fitness.ts`, `lib/judge.ts`, `workers/judge.ts`, `routes/judging.ts`, `routes/leaderboard.ts`, `routes/castings.ts`, `hooks/verdicts-*.ts`, and the `leaderboard` view query.

**Done when:**

1. The mock judge scores every submitted output of an AI-judged run, the run ends `done`, and each verdict stores a rubric snapshot.
2. A seeded set of verdicts gives a leaderboard that matches a golden JSON: means, ranges, fitness, `terms_used` and `suggested`.
3. The blind route never returns the forbidden keys or names (§10), and its order is stable across calls.
4. An owner verdict on an AI-judged output becomes the active one; the leaderboard uses it; and the AI verdict remains, marked `overridden`.
5. With one contender lacking token data, fitness drops the tokens term and names that contender.
6. A champion is suggested only at or above `min_outputs` and strictly above `pass_mark`, including the one-contender Stock Review case. `POST /castings` refuses a contender that doesn't qualify.
7. The same-provider warning appears when the judge shares a provider with a contender.
8. A judge reply that misses a criterion is retried once, then recorded in `attempt.error`.
9. An image output's judge request (with the fake `http`) contains image blocks, and skips an SVG with a note.

### T4 UI

**Owns:** `ui/` and `routes/app.ts` (the real serving logic).

**Done when:**

1. A Playwright walkthrough (dev dependency; reason: browser tests) of all four reference workspaces against the mock completes:
   - sign in;
   - edit a workspace, a stage, a role with its rubric, and a task, plus "Duplicate and edit" on a locked task;
   - add a connection with a key (the key is never shown again) and a contender;
   - build a run and see the call count;
   - watch the run live;
   - copy a handoff prompt and paste an output with a file;
   - judge blind, including the image grid;
   - override an AI verdict;
   - Run again;
   - see the leaderboard and confirm a champion.
2. Screenshots at 1280 px and 375 px are in the PR.
3. No runtime dependency other than `@arrow-js/core` and `@go4cas/quiver` (exact versions), no Tailwind or Vite, and the UI's first-load JS is under 150 KB minified (CSS is not counted; page chunks load later and are reported), with source maps.
4. The judging screen calls only the blind route, never `/collections/attempts` (checked by a test that greps the judging module).
5. Screens say "outputs", never "attempts".

### T5 Integration

**Owns:** end-to-end tests, `README.md`, `docs/OPERATIONS.md`, and fixes for the gaps it finds (each fix in its own commit, referencing the finding).

**Done when:**

1. An end-to-end test drives each of the four reference workspaces through tasks → runs → judging → casting against the mock, with no workspace-specific code paths. A grep finds no workspace names outside `seed/`.
2. `README.md` covers setup in five commands or fewer.
3. `docs/OPERATIONS.md` has the steps for Cas's local Anthropic check: add an Anthropic connection and key, create an Opus 5.5 contender with high effort, run the Research role with one task against it and Mock Steady, judge with the AI judge set to the Anthropic contender, and check that tokens and cost appear and the image path works on the Marketing image task.
4. The placeholder commit check (O2) passes.

## Spec changes in this PR

`docs/SPEC.md` is edited in this PR as follows, so that it stays the source of truth:

1. **Data model.** 13 collections plus the view, with `connection_keys` added (F2). Also added: `connections.has_key`, `attempts.finish_reason`, `attempts.mode` and `attempts.submitted_at`, `runs.judge_contender` and `runs.call_count`, `verdicts.run` and `verdicts.status`, and the `runner` value on `contenders.mode`.
2. **Platform table.** Live run progress uses polling, not realtime (F1). The egress row becomes "default private-range denylist, plus Audition's own host check per connection" (F3).
3. **Execution modes.** The rendered generic prompt is also the user message for API contenders, so every contender gets the identical task text (§9).
4. **Contender example.** For Anthropic, "temperature" becomes "effort" (F8).
5. **Open questions.** The first six are marked answered, with a link to this document.
