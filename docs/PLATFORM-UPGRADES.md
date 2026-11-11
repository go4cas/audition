# Platform upgrades plan: Vaultbase 0.44 and Quiver 3.1

Status: **approved by Cas on Nov 11, 2026**, with the recommended answers to Q1 to Q8. Part A is done (PR #19, Vaultbase 0.44.0). Part B is done for the server writes and record history; Q1 (owner uploads through Vaultbase's endpoint) was checked and is blocked, so the custom route stays (NOTES W1). B3 (realtime run page) shipped in its own small PR after part C (Q8, NOTES "Realtime run page"). Written Nov 11, 2026, before the feature roadmap continues.

Both changes need Cas's OK under the orchestrator rules (a Vaultbase version change, a schema change after T0, and a scope change for the UI). This document gives the facts, a recommendation, the order of work and the open questions.

## Summary

| | Recommendation | Size | Branch / PR |
| --- | --- | --- | --- |
| **A. Vaultbase 0.40.2 → 0.44.0** | Go straight to 0.44.0. Nothing in Audition breaks: the full suite passes on 0.44.0 except the tests that pin 0.40.2 behaviour on purpose. | Small | PR A |
| **B. Server writes through `helpers.records`** | Do it, in its own PR after A. Move every record write in `vb_hooks/` off `helpers.sql`, turn on record history for verdicts and castings, and switch the live run page from polling to realtime. Keep two justified SQL bypasses (worker claims, server-made files). | Medium | PR B (B3 realtime may be its own PR) |
| **C. Quiver 3.1 as a library** | Adopt it, after A and B, in its own PR: the router, guards, layout and page cleanup move to `@go4cas/quiver`, while the Design CSS and pages stay. URLs move from `#/…` to real paths under `/api/custom/app/`. | Medium | PR C |

Order: **A → B → C**, one branch and one PR each, and each one merged before the next starts. A is a prerequisite for B (B needs `helpers.records` from 0.43). C doesn't touch the server, so it could run in parallel with B, but doing it after keeps each review small, and the test suite only has to change for one thing at a time.

---

## A. Vaultbase 0.40.2 → 0.44.0

### What was checked

- The changelog and release notes for 0.41.0, 0.41.1, 0.42.0, 0.43.0 and 0.44.0, at the git tags (`CHANGELOG.md`, `release-notes/`), and the source diff `v0.40.2..v0.44.0` for the files Audition depends on.
- **A spike, not committed:** a copy of `main` (dd75c81) with `bun run vb:bump 0.44.0`, then `bun run setup` and `bun test` on a fresh 0.44.0 instance, then `test/upgrade.test.ts` with `AUDITION_UPGRADE_FROM` set to the 0.40.2 lock.

Spike result on 0.44.0: **257 pass, 3 fail, out of 260.** All three failures are expected:

| Failing test | Why | Fix in PR A |
| --- | --- | --- |
| `test/files.test.ts` "F9: … upload endpoint refuses multipart bodies (flips when fixed)" | 0.41.1 fixed F9. The test was written to fail at that point. | Turn it into a test that the built-in upload works. |
| `test/setup.test.ts` "the lock pins 0.40.2 with the published checksums" | The lock now pins 0.44.0. | Update the version and checksums. |
| `test/release.test.ts` "provision applies settings …" | The spike's copy had no `ui/dist` when this file ran first. It passes when run again after the UI build (4/4). Not a Vaultbase change. | None. |

The upgrade test (old 0.40.2 binary seeds and runs a full loop, then 0.44.0 opens the same data folder) passed: 3/3.

### Breaking changes and how they touch Audition

| Version | Change | Effect on Audition |
| --- | --- | --- |
| 0.42.0 | `POST /auth/<c>/register` with a known email answers **409** (was 200). | `scripts/lib/vaultbase.ts` registers the owner once. `test/rules.test.ts` still passes. Provision already checks for an existing owner first. No change. |
| 0.42.0 | The `vaultbase` CLI rejects unknown commands and options (exit 2). | `deploy/audition.service` uses `--apply-snapshot` and `--snapshot-mode sync`, the same flags `bun run dev` uses, which booted in the spike. No change. |
| 0.42.0 | `vaultbase setup-admin` uses the password policy (12 characters by default, was 8). | `RELEASE.md` should say the admin password needs 12 or more characters. Doc-only. |
| 0.44.0 | A Bearer token the server doesn't accept answers **401** on the records, files and batch APIs (was: treated as anonymous). An API token without the scope answers 401 `insufficient_scope`. | `ui/src/api.js` already signs the owner out on any 401. Audition uses no API tokens yet; PR B doesn't need one. No change. |
| 0.44.0 | Unknown `sort`, `expand` or `fields` names, and unknown body keys on create and update, answer **400** (were ignored). | The whole suite, including the UI walkthrough and the e2e test, passes on 0.44.0, so nothing Audition sends today has a stray key. PR A adds one test that a fetched record saved back as it came is still accepted. |

There is no **Security** section in any of the five changelogs, so nothing forces the timing. The upgrade is wanted for F9 and `helpers.records`.

### Known quirks, checked again

- **F9 (multipart uploads to `/api/v1/files` answer 400): fixed in 0.41.1.** The cause was the rate limiter's batch check reading every request's body first. The spike confirms it: the F9 test flips. See question Q1 for what this means for Audition's own upload route.
- **F14 (update rules are checked on the current and the merged record): unchanged, and by design.** `checkUpdateRule` in `src/api/_rules.ts` is the same at 0.44.0. Audition's attempts rule already allows for it (`@request.body.status:changed = true`), so nothing changes. `helpers.records` applies no API rules, so F14 doesn't touch server writes.
- **F1 (server code can't write records through the records API): fixed in 0.43.0** with `helpers.records`. That is part B.
- **F10 (no new multiple relations), RL1 (a restore can reset the connection)**: no changelog entry. They stay as they are.
- **RF2 rate limits**: 0.43 keeps the counters per rule instead of per position. Audition uses the defaults, so nothing changes.

### Work in PR A

1. `bun run vb:bump 0.44.0`; TECH-SPEC §1 (version, tag commit, checksums, the "upgrade notes that touch Audition" list) and the README and RELEASE.md version mentions.
2. `test/files.test.ts`: the F9 test asserts that an owner upload through `POST /api/v1/files/...` now works. `test/setup.test.ts`: the new pin.
3. NOTES.md: F9 fixed in 0.41.1; F14 unchanged at 0.44.0; a short "Vaultbase 0.44 upgrade" entry with the spike numbers and the changelog sections read (TECH-SPEC §1 step 5).
4. RELEASE.md: admin password at least 12 characters; the production upgrade steps already cover 0.40.2 → 0.44.0 (stop, cold copy of the data folder, swap the binary, start, smoke test).
5. Done when: `bun test` is green on a fresh 0.44.0, the upgrade test is green from the 0.40.2 lock, and the output is in the PR.

PR A leaves the custom upload route, the seed attach route and every `helpers.sql` write as they are.

---

## B. Server writes through the Vaultbase records API

### What 0.43 adds

`helpers.records.create(collection, data)`, `.update(collection, id, data)` and `.delete(collection, id)`, for hooks, custom routes, cron jobs and queue workers (`src/core/records-helper.ts`). A write goes through the same path as `/api/v1/...`: field validation, the collection's own before- and after-hooks, **record history, realtime events and webhooks**. No API rules apply (trusted server code), and record history shows the write as **system**. A hook that writes into its own collection is stopped after 5 nested writes.

This is what Cas asked the Vaultbase author for in discussion #10, and it replaces the API-token-plus-loopback workaround in the SPEC's "First after Phase 1" item.

### Where Audition writes today

All writes go through `vb_hooks/lib/store.ts` (`insertRecord`, `updateRecord`) or raw `helpers.sql.exec`:

| Collection | Writes | Where |
| --- | --- | --- |
| attempts | 1 create, 5 updates, 1 conditional claim | `lib/runs.ts`, `lib/handoff.ts`, `lib/judge.ts` |
| runs | 1 create, 1 conditional status update | `lib/runs.ts` |
| verdicts | 1 create, 1 update (mark the AI verdict `overridden`) | `lib/scoring.ts`, `workers/judge.ts` |
| castings | 1 create | `routes/castings.ts` |
| connections, contenders, tasks | 4 updates (key flags, lock state) | `lib/hook-logic.ts`, `routes/connections-key.ts`, `lib/handoff.ts` |
| connection_keys | 1 delete by `connection` | `routes/connections-key.ts` |
| files | insert into `vaultbase_files` plus the record's file field | `lib/files.ts` (seed, provider file outputs, owner upload route) |

### Plan

1. **Swap `store.ts` for `helpers.records`.** Keep the same two function names so callers barely change, but make them thin wrappers over `helpers.records`. The schema-reading encoder (`encodeForStore`) goes away, because the records path encodes values itself. `test/store.test.ts` becomes a test that each server write shows up in record history as system and fires a realtime event.
2. **Make Audition's own hooks tell a system write from an owner write.** This is the main risk. Today the hooks skip their checks only for `ctx.auth?.type === "admin"`, and `helpers.sql` writes never ran them. With `helpers.records`, `attempts-before-update` would refuse the generate worker's `in_progress` → `submitted` write ("This output has already been submitted"), and `verdicts-before-create` would run its owner checks on the AI judge's verdict. Each before-hook gets a `system` branch (auth is null: the records path passes no user), with a test per hook that an anonymous REST request still can't reach it (API rules refuse it first). The after-hooks (`verdicts-after-create`, `attempts-after-update`) now also run for server writes, so any worker code that repeats an after-hook's work by hand today (for example `refreshRunStatus` after the AI verdict) is checked so nothing runs twice. Each one is checked for loops against the 5-deep cap.
3. **Two bypasses stay, with the reason in the code and in NOTES.md:**
   - *Worker claims* (`UPDATE vb_attempts SET status = 'in_progress' … WHERE status = 'queued'`, and the run status compare-and-set). `helpers.records.update` has no "only if" condition, and the claim is what stops two workers from running one attempt. The claim stays in SQL; every write after it goes through `helpers.records`, so the history shows `queued` → (claim) → `submitted`. See Q3.
   - *Server-made files* (seed fixtures and files a provider returns, such as the mock image outputs). 0.44 has no helper to store a file from server code, so `lib/files.ts` keeps writing the file and its `vaultbase_files` row. The record's field update moves to `helpers.records.update` if the records path accepts a stored file name there; the spike for PR B checks that first. See Q2.
4. **Turn on record history for `verdicts`, `castings`, `attempts` and `runs`** in `schema/snapshot.json` (today: `tasks`, `contenders`, `roles`). This is a schema change after T0, so it needs Cas's OK (Q4). It is what the SPEC promised for judgements and castings (R5).
5. **Realtime for the run page (B3).** With server writes sending realtime events, `ui/src/pages/run.js` subscribes to `attempts` and `runs` for the run instead of polling. Polling stays as the fallback when the realtime connection drops. This can ship in PR B or as a small follow-up PR; the recommendation is a follow-up, so PR B stays server-only.
6. **The owner upload route.** With F9 fixed, the owner could upload through Vaultbase's own `POST /api/v1/files/:collection/:id/:field`. The custom route enforces more than the built-in one can today: only a waiting handoff output or an unlocked task, the Phase 1 file types by extension, and a magic-byte check. The plan is to move to the built-in endpoint where its update rule plus the field's `maxSize` and MIME options cover those checks, and keep the custom route only for the magic-byte check if the built-in one can't do it. See Q1.

Done when: no `helpers.sql` write is left in `vb_hooks/` except the two documented bypasses (a grep test enforces it), every server write shows up in record history as system, the full suite and the e2e test are green on 0.44.0, and NOTES.md records the change to F1.

---

## C. Quiver 3.1 as a library

### What Quiver 3.1 is

`@go4cas/quiver` 3.1.0 (published to npm Nov 11, 2026) is a router, context and meta layer for Arrow.js: Navigation API routing with layouts, guards, `afterEach` and `onError`, base paths, `provide`/`inject`, `useMeta`, and file-based routes through a Vite plugin, a **`Bun.build` plugin** or a CLI. 13 exports, one peer dependency (`@arrow-js/core ^1.0.6`, which Audition already pins), **no CSS**. Composables (`arrow-use`) and UI recipes (toasts, `useForm`, theme tokens) are separate and optional.

That fixes all three reasons quiver was set aside on Nov 6 (TECH-SPEC tech stack): no Tailwind or CSS to clash with the Design CSS, no Vite needed (there is a `Bun.build` plugin, and a hand-written route table works too), and base paths are supported.

### What it would replace

| Today in `ui/src` | With quiver |
| --- | --- |
| `router.js` (56 lines, hash routes `#/runs/123`) | `initRouter`, `go`, `useRoute`, real paths under `/api/custom/app/` |
| The sign-in redirect in `main.js` | A `beforeEach` guard |
| `onLeave` (stops polling timers) | 3.1's page cleanup scope: `onCleanup` in a page runs when the page is left |
| `layouts/shell.js` mounting and `renderPage` | `createApp` with a default layout; the shell's markup stays |
| Page titles set by hand | `useMeta` |
| The route table in `main.js` | Either the same table as a quiver manifest (smallest change), or `pages/runs/[id].js` file routes with the Bun plugin |

What stays: the Design CSS and tokens, the Phosphor sprite, `api.js`, `state/`, every page's markup, and the CSP. Quiver's theme tokens and recipes aren't needed, and stay out unless a later feature wants one (toasts or `useForm` are the likely candidates).

### Bundle size

The T4 budget (TECH-SPEC T4 Done-when 3, after PR #15) is **under 150 KB of minified JS**, CSS not counted. Measured on Nov 11 with `Bun.build`, minified, Arrow external:

| | Minified | Gzipped |
| --- | --- | --- |
| Audition's `main.js` today | 129.7 KB | |
| Audition's `router.js` | 1.3 KB | 0.8 KB |
| All of `@go4cas/quiver` (every export) | 12.8 KB | 5.2 KB |

Estimate with quiver: about **141 KB**, under the budget but with only about 9 KB to spare. Two ways to win room back: build with `splitting: true` (one chunk per page, as quiver's Bun plugin supports), which drops the first-load bundle well under 150 KB, and removing the hand-rolled code quiver replaces. Whether the budget then means the first-load chunk or all chunks together is Q6.

### Effort and risks

- **Effort: medium.** 9 files import the router and there are about 67 `href`/`go()` call sites, most of them mechanical (`#/runs/1` → `/runs/1` through `url()`). The two UI tests (`ui-walkthrough`, `ui-warning`) use `#/` URLs and the 42 screenshots are retaken.
- **URLs change.** `#/runs/123` becomes `/api/custom/app/runs/123`. The app route already serves `index.html` for any unknown path, so deep links work. A few lines in `main.js` turn an old `#/…` link into the new path, so bookmarks keep working.
- **Browser support.** The Navigation API needs Chrome or Edge 102+, Safari 26.2+ or Firefox 147+. Current versions of all three are fine; an older Safari or Firefox would get an error page instead of the app. For a single-owner, self-hosted tool that is acceptable, but it is Cas's call (Q7).
- **A day-old release.** 3.1.0 shipped on Nov 11, the same day as 3.0.3. Pin it exactly (`3.1.0`), like Vaultbase, and review upgrades on the same monthly rhythm.
- **Orchestrator rule 7** (Arrow.js is the only runtime dependency) changes: quiver becomes the second one. That's a scope decision for Cas (Q5).
- **Arrow quirks still apply** (NOTES U3). 3.1's page cleanup and slot-only re-renders help, but a `component()` nested in a page template still gets no cleanup on Arrow 1.0.6.

Done when: the full suite and the walkthrough pass on real-path URLs, old `#/` links redirect, the bundle meets the budget, and the screenshots are retaken at 375 and 1280.

---

## Open questions for Cas

| # | Question | Recommendation |
| --- | --- | --- |
| Q1 | Should owner uploads move from Audition's route to Vaultbase's own upload endpoint now that F9 is fixed? | Yes, in PR B, where Vaultbase's rules and field options cover the checks; keep the custom route only for the magic-byte check if needed. |
| Q2 | Ask the Vaultbase author for a server-side file helper (like `helpers.records`, for storing a file on a record)? | Yes. It would remove the last reach into `vaultbase_files`. Audition keeps `lib/files.ts` until then. |
| Q3 | Keep the worker claim and the run status compare-and-set in SQL? | Yes, documented. Or ask upstream for an "only if" option on `helpers.records.update`. |
| Q4 | Turn on record history for verdicts, castings, attempts and runs (a schema change)? | Yes for all four. Verdicts and castings are what the SPEC promised; attempts and runs make the run's story visible in the admin. |
| Q5 | Allow `@go4cas/quiver` as a second runtime dependency (orchestrator rule 7)? | Yes, pinned exactly. |
| Q6 | Does the 150 KB budget apply to the first-load JS or to all JS chunks together, once the UI is split per page? | First-load JS, with all chunks reported in the PR. |
| Q7 | Is a Navigation API browser (Safari 26.2+, Firefox 147+) an acceptable minimum? | Yes for a single-owner self-hosted tool; the app shows a clear message on older browsers. |
| Q8 | Realtime run page in PR B, or a separate small PR after it? | A separate PR, so PR B stays server-only. |

## Sources

- Vaultbase `CHANGELOG.md` and `release-notes/v0.41.0.md` … `v0.44.0.md` at tag `v0.44.0`; `src/core/records-helper.ts`, `src/core/hooks.ts`, `src/api/records.ts`, `src/api/_rules.ts` (diffed against `v0.40.2`).
- Vaultbase discussion #10 (Cas's question about server-side writes).
- Quiver at `go4cas/quiver` `main` (3.1.0 release commit `e4714a1`): `README.md`, `CHANGELOG.md`, `packages/quiver/package.json`, `docs/guide/routing.md` and `getting-started.md`; npm `@go4cas/quiver` dist-tag `latest` = 3.1.0.
