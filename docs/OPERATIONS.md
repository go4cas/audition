# Operations

How to run Audition on your own machine, and the Phase 1 check with a real Anthropic key. Setup is in the [README](../README.md). Running it on a server (systemd, backups, restores and Vaultbase upgrades) is in [RELEASE.md](RELEASE.md).

## Day to day

| What | How |
| --- | --- |
| Start | `bun run dev`. It is safe to run again: the seed only adds what is missing. |
| Stop | `bun run stop` |
| Open the app | The address `bun run dev` prints, normally <http://127.0.0.1:8091/api/custom/app/> |
| Sign-ins | `.vaultbase/credentials.json` (owner, and the Vaultbase admin for `/_/`) |
| Server log | `.vaultbase/vaultbase.log` |
| Data | `.vaultbase/data`. Copy it while the server is stopped to keep a backup. |
| Run the tests | `bun test`. They use fresh instances and the mock provider only. |
| Check a Vaultbase version bump | `bun run vb:bump <version>`, then `bun test` (includes the upgrade test). Ask Cas before committing a new pin. |

If `bun run dev` says "Provider variables are set", unset them (for example `unset ANTHROPIC_API_KEY`) and run it again. Keys go into the app, never the environment.

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

1. **Start a run**. Role: **Researcher** (Software Factory, Research stage).
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

### 6. Afterwards

- Remove the key if you like: on the connection, remove the key. The connection then says "No key yet", and its contenders fail with a clear error until a key is added again.
- Write down anything unexpected (wording, a missing number, an error) for the Review or Release step.
