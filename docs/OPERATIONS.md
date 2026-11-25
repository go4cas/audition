# Operations

How to run Audition on your own machine, and the Phase 1 check with a real Anthropic key. Setup is in the [README](../README.md). Running it on a server (systemd, backups, restores and Vaultbase upgrades) is in [RELEASE.md](RELEASE.md).

## Day to day

| What | How |
| --- | --- |
| Start | `bun run dev`. It is safe to run again: the seed only adds what is missing, and data from an older version is migrated first (it prints "Migrated: ..." when it renames something, such as stages to groups). |
| Stop | `bun run stop` |
| Open the app | The address `bun run dev` prints, normally <http://127.0.0.1:8091/> |
| Sign-ins | `.vaultbase/credentials.json` (owner, and the Vaultbase admin for `/_/`) |
| Server log | `.vaultbase/vaultbase.log` |
| Data | `.vaultbase/data`. Copy it while the server is stopped to keep a backup. |
| Run the tests | `bun test`. They use fresh instances and the mock provider only. |
| Check a Vaultbase version bump | `bun run vb:bump <version>`, then `bun test` (includes the upgrade test). Ask Cas before committing a new pin. |

If `bun run dev` says "Provider variables are set", unset them (for example `unset ANTHROPIC_API_KEY`) and run it again. Keys go into the app, never the environment.

## Emails and repeats (Phase 2a)

Audition emails the owner when a run finishes (or its outputs are ready for you to judge), when the leaderboard suggests a new champion, and when a scheduled repeat can't start. It sends through Vaultbase's own SMTP settings; with SMTP not set up it skips the email and writes one line to the hook log, and nothing else changes.

1. In the Vaultbase admin, open **Settings → Email** and set the SMTP host, port, user, password and From address, then turn SMTP on. The send test there checks the settings.
2. Set **App URL** (`app.url`) to Audition's address, for example `https://audition.example.com`, so the links in the emails open the app. Without it the links are paths only.
3. Emails go to the owner account's email address.

A run's **Repeat** panel makes a Vaultbase cron job named `repeat-<run id>`; the admin's **Jobs** page lists it with its next run time. Cron in Vaultbase is UTC, so where clocks change, a repeat moves by an hour with them. A slot missed while the server was down is not caught up. The job `sweep-stale-outputs` runs every 5 minutes and fails API outputs stuck for 20 minutes (or queued for an hour).

## Push alerts

Audition also sends its alerts (the same moments as the emails, plus outcome checks due) through Vaultbase's notifications: an inbox in the app (the bell) and a push to your devices. See docs/PUSH-ALERTS.md.

1. Make a free account at onesignal.com and add a **Web** app with **Custom code**. Use Audition's address as the **Site URL**: just `https://` and the domain, for example `https://audition.example.com`, with no path. OneSignal refuses to start on any other address. Skip OneSignal's "upload service worker file" and "add code to site" steps: Audition serves `OneSignalSDKWorker.js` itself and loads OneSignal itself. Leave **Token Identity Verification** off.
2. From the OneSignal app's **Settings → API keys and IDs**, copy the **App ID**, and add an API key (no IP allowlist) and copy it; OneSignal shows it once.
3. In the Vaultbase admin (through the SSH tunnel, docs/RELEASE.md), open **Settings → Notifications → OneSignal**, paste both, turn **Enabled** on and press **Save**. The first save with Enabled on creates Vaultbase's `notifications` and `device_tokens` collections (the toast says so); until then the app says "Alerts are off". **Test connection** checks the key without sending anything. It needs Vaultbase 0.47.0 or later: before 0.47, Vaultbase sent App API keys (`os_v2_app_…`) with the wrong header, so both the test and every push failed with 401.
4. In Audition, open the bell, then **Turn on alerts here** on each phone or computer that should get alerts, and allow notifications when the browser asks. On an iPhone or iPad, first add Audition to the Home Screen (Share, Add to Home Screen) and open it from there.
5. To check it end to end, send yourself a test from the admin (**Notifications → Send test**, to the owner account), or start a short run.

Without step 3, the bell's page says "Alerts are off" and nothing else changes. Alerts are kept in the inbox even on devices without push.

## Local Anthropic check

This is the Phase 1 check with a real key (TECH-SPEC §15, T5 Done-when 3). You run it yourself, outside any Claude session. It takes about 15 minutes and costs a few cents: three model calls for generation and up to eight for judging, each capped by the contender's max output tokens.

What it proves: an Anthropic contender gets the same prompt as everyone else and reports tokens and cost, the AI judge works with a real model, and the judge sees images.

### 1. Start Audition and add the connection

1. Unset any Anthropic variables in your shell, then run `bun run dev` and sign in as the owner.
2. Go to **Contenders**, then **Add connection**.
   - Name: `Anthropic`
   - Provider: Anthropic. Leave the base URL empty (it defaults to `https://api.anthropic.com`).
   - Save the connection.
3. On the new connection, paste your API key and **Save key**. The key is shown once and never again; the connection now says "API key saved".

### 2. Create the Opus 5.5 contender

**Add contender**, on the `Anthropic` connection:

| Field | Value |
| --- | --- |
| Name | `Opus 5.5, high effort` |
| Model | `claude-opus-5-5` |
| Effort | `high` (Opus 5.5 defaults to medium if you leave it empty) |
| Max output tokens | `16000` (the default; it caps every call) |
| Price in, per million tokens | `4` |
| Price out, per million tokens | `20` |
| Leaderboard group | `Opus 5.5` |

The prices are Anthropic's list prices for Opus 5.5 as of November 2026 (USD per million tokens). Check the current ones on Anthropic's pricing page. Without both prices, cost shows as N/A, which is also correct behaviour.

### 3. Make it the AI judge

Open the **Software Factory** workspace, then its settings. Under **Judging**, pick `Opus 5.5, high effort` as the AI judge and save. Do the same for the **Marketing Pipeline** workspace; you can leave "Who judges new runs" on Me there, because you choose the judge for each run.

The judge contender is locked once it has judged, like any contender that has been used.

### 4. Research role: one task, Opus 5.5 against Mock Steady

1. **Start a run**. Role: **Researcher** (Software Factory, Research group).
2. Tasks: tick one, "Compare three ways to store user settings in a small web app and recommend one".
3. Contenders: `Opus 5.5, high effort` and `Mock Steady`.
4. Who judges: **AI · Opus 5.5, high effort**.
5. Before you start, check the summary:
   - 2 outputs, 1 API call for generation (the mock is free), 2 calls to the AI judge, 3 provider calls in total.
   - A warning that the AI judge is also a contender and judges its own output. That is expected here; Audition warns and lets you go ahead.
6. **Start run** and watch the live view. Mock Steady finishes at once; Opus 5.5 takes up to a few minutes at high effort.

Check, on the run page and then the output itself:

- [ ] Both outputs end judged and the run ends done.
- [ ] The Opus 5.5 output shows tokens in, tokens out and time.
- [ ] Its cost is filled in, and equals tokens in × 4 / 1,000,000 + tokens out × 20 / 1,000,000 (USD).
- [ ] Mock Steady's cost is N/A (it has no prices).
- [ ] **Open judging**: the two outputs are labelled A and B with nothing that says which is which, and each has stars per criterion with a reason from the judge.
- [ ] **See leaderboard** for Researcher shows both contenders with their means. Neither is suggested as champion yet: that needs 5 scored outputs each.

If the Opus 5.5 output fails, its error says why (no key, a refusal, an HTTP error) and the other output still finishes.

### 5. Image path: the Marketing image task

Phase 1 has no image-generation API, so the image path is the AI judge seeing images. The Mock Image contender makes PNGs, and the Opus 5.5 judge must receive them as images.

1. **Start a run**. Role: **Image maker** (Marketing Pipeline).
2. Task: "Create a square social image for the Ember & Oak spring sale: warm tones, a coffee bag, no text".
3. Contenders: `Mock Image`. Optionally also `Midjourney (manual)`, and paste a PNG you have when the run asks for it.
4. Who judges: **AI · Opus 5.5, high effort**. The summary shows 1 judge call per output and no warning.
5. Start the run.

Check:

- [ ] The Mock Image output shows its one or two PNGs.
- [ ] Each output gets a verdict, and the judge's reasons for "Matches the brief" and "Visual quality" describe the picture (a coffee bag, warm tones). A reason that says it can't see an image means the image blocks didn't arrive: note it as a finding.
- [ ] The judge call's tokens in are well above a text-only judge call, because images are counted as input.

### 5b. Optional: a real Replicate picture

This checks the Replicate adapter (SPEC "Replicate", TECH-SPEC §12b) with a real key. Flux Schnell costs about $0.003 a picture (check the model's page on replicate.com).

1. **Contenders → Add connection**: Name `Replicate`, Provider **Replicate**, base URL empty (it defaults to `https://api.replicate.com/v1`), paste your Replicate API token.
2. **Add contender** on that connection: Name `Flux Schnell`, Model `black-forest-labs/flux-schnell`, Aspect ratio Square, File type WebP, Price per image `0.003`.
3. **Start a run** on the Image maker role with the image task, contenders `Flux Schnell` (and `Mock Image` if you like), judged by you or the AI judge.

**Done Nov 25, 2026 on v0.7.2** (live server, VB 0.48.0): Flux Schnell finished in 4 seconds and its picture (`image-1.webp`) showed on the judging screen. The first try on v0.7.1 failed on Replicate's new download host (NOTES RP9). That run was judged by Cas, so the AI-judge line was not tried, and the cost line was not recorded.

Check:

- [x] The Flux Schnell output ends submitted within a minute and shows one WebP picture with a thumbnail.
- [ ] Its cost is 0.003, tokens are empty, and time is filled in.
- [ ] With the AI judge, its reasons describe the picture.

If the output fails with "Refused a download from <host>", Replicate served the picture from a host Audition doesn't know yet (NOTES RP9). Note the host and report it.

### 6. Afterwards

- Remove the key if you like: on the connection, remove the key. The connection then says "No key yet", and its contenders fail with a clear error until a key is added again.
- Write down anything unexpected (wording, a missing number, an error) for the Review or Release step.
