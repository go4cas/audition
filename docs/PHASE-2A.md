# Phase 2a — Living arena lite: plan

Nov 12, 2026 · roadmap step 2 in `docs/SPEC.md` ("Roadmap after Phase 1"), approved by Cas on Nov 11, 2026.

**Done when** (the Phase 2 Done-when): a scheduled role reruns unattended, and a delayed outcome verdict lands on its due date.

Four parts, each built on Vaultbase's own features. Part order is also the build order. Choices marked **(Q)** need Cas's answer; the plan follows the recommended option until Cas says otherwise.

## What Vaultbase 0.44.0 gives us (read from the source at tag v0.44.0)

- **Cron jobs as files.** `vb_hooks/jobs/*.ts` with `defineJob({ name, cron, run(ctx) })` (`src/core/code-files.ts`). Five-field cron, UTC; the scheduler ticks every 30 seconds; a slot missed while the server was down is not caught up (`src/core/jobs.ts`). The admin can run a job now (`POST /api/v1/admin/jobs/:id/run`), which the tests use.
- **Cron jobs at runtime.** `helpers.cron.add({ name, schedule, code })` and `helpers.cron.remove(name)` create jobs that show in the admin's Jobs page with their next run time (`src/core/hook-helpers-extra.ts`).
- **Email.** `helpers.email({ to, subject, body })` sends through the SMTP settings (`smtp.enabled`, `smtp.host`, `smtp.port`, `smtp.user`, `smtp.pass`, `smtp.from`), set in the admin. When SMTP is not set up it throws `EmailNotConfiguredError` (`src/core/email.ts`).

## Part 1 — Stale-attempt sweep

- A file job `vb_hooks/jobs/sweep.ts`, every 5 minutes.
- An API output `in_progress` for 20 minutes since its last update (the queue's own job timeout is 15 minutes), or still `queued` an hour after it was made, is marked `failed` with a "Timed out" error. The run's status is then refreshed, so a run never hangs in "running".
- Handoff outputs (`waiting`) are never swept: they wait for you as long as it takes.
- Writes go through `helpers.records`, so record history shows each sweep as **system**.

## Part 2 — Scheduled runs

- On a run's page, a **Repeat** button with plain choices: every day, every week (pick the day), or every month (pick the date), at a time of day. Audition turns it into a cron expression in `runs.schedule` (UTC; the screen shows your local time). "Stop repeating" clears it.
- Setting a schedule calls `helpers.cron.add` with the name `repeat-<run id>`; clearing it calls `helpers.cron.remove`. So every schedule is a real Vaultbase job, visible in the admin with its next run.
- Each tick does what **Run again** does: a new run with the same role, tasks, contenders and judge, linked by `rerun_of` to the scheduled run. Nothing is overwritten.
- Repeat is offered once a run is done, like Run again. Each tick repeats that same run, so later runs don't need to finish first.
- If a tick can't start (a contender was turned off, or the AI judge was removed), it skips that time and emails you why, with the same message Run again would show. The schedule stays until you stop it.
- **(Q1) Handoff contenders and "Me" judging in a scheduled run.** Recommended: allowed. Their outputs wait for you, and the run-finished email says so. The Repeat dialog warns when a run has handoff contenders or judge "Me". Alternative: allow Repeat only for runs with API contenders and the AI judge.

## Part 3 — Outcome verdicts (Stock Review first)

The idea: some calls can only be judged later ("Was the stock call right four weeks later?").

- **(Q2) Where the delay is set.** Recommended: a new optional role field, **"Check the outcome after N days"** (`roles.outcome_after_days`, number, empty = off). This is a schema change. The seed sets 28 days on the Stock Review role. Alternative, with no schema change: keep it inside the role's `rubric` JSON.
- When an output in such a role is first judged, Audition creates an **outcome verdict**: `method = outcome`, `due_at` = judged time + N days, no score yet.
- A daily file job (`vb_hooks/jobs/outcomes.ts`, 07:00 UTC) finds outcome verdicts that came due and emails you one list. The home page shows **"Outcome checks due"** from the day they are due, never before.
- The outcome screen shows the output (the original call, still blind) and asks one question with stars: **"Was the call right?"** (1 to 5), plus an optional one-line note. Saving fills in the verdict's score.
- **(Q3) How outcomes count.** Recommended: a separate **Outcome** column on the leaderboard (mean outcome stars and how many), kept out of the quality score and fitness. This changes the leaderboard view: quality counts only `method = rubric`, and two outcome columns are added. It is a schema change. Without it, the current view would count an outcome verdict as one more quality score. Alternative: fold outcome stars into quality (no view change for that, but pending outcome verdicts would still need to be kept out of the view, which is the same change).

## Part 4 — Email alerts to the owner

- An after-update hook on runs puts the email on an `email` queue, so a slow mail server never holds up a run.
- Sent to the owner account's email, through Vaultbase's SMTP settings. If SMTP isn't set up, Audition skips the email and writes one line to the hook log; nothing fails.
- **Run finished**: with judge "Me" when its outputs are ready for you (judging), with the AI judge when it is done. One email per run. The email names the role, how many outputs, any failures, and a link to the run.
- **Champion change**: in the same email, when the leaderboard's suggested champion for that role is now a different contender from the confirmed casting (or there is none yet), with a link to confirm. Confirming stays your click; Audition never confirms on its own. (Your own click doesn't email you.)
- **Outcome checks due**: the daily list from Part 3.
- `docs/OPERATIONS.md` gets the SMTP setup steps.

## Tests (mock provider only, fresh Vaultbase per run)

- A tiny SMTP sink inside the test harness (Bun's TCP server, no new dependency) collects the emails.
- Sweep: a stuck output is failed after the cut-off, a waiting handoff output is untouched.
- Schedule: setting a schedule creates the Vaultbase job; running it now (admin endpoint) creates a linked run with fresh outputs; clearing removes the job.
- Outcome: a judged Stock Review output gets an outcome verdict due in 28 days that is not listed today; with the clock moved past `due_at` (test seam on the due check) it is listed, emailed once, and scoring it shows in the Outcome column and not in quality.
- Email: run-finished and champion-change emails arrive with the right text, and nothing breaks with SMTP off.
- The Phase 2 Done-when as one end-to-end test.

## Schema changes (need Cas's OK, orchestrator rule 9)

1. `roles.outcome_after_days`: number, optional (Q2).
2. The `leaderboard` view: quality from `method = rubric` only; add `n_outcome` and `mean_outcome` (Q3).

Both are additive: existing data and screens keep working.

## Build status

- Done on this branch: parts 1, 2 and 4 (sweep, Repeat, emails), with `test/arena.test.ts`, `test/ui-schedule.test.ts` and a Repeat step in the browser walkthrough.
- Waiting on Cas: part 3 (outcome checks), because of the two schema changes.
