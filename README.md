# Audition

Audition is a self-hosted tool for deciding which AI contender is best for each role in a workflow. A contender is a model, an agent harness or an app, plus its settings. You set up workspaces with roles and tasks, run the same task through several contenders, judge the outputs blind with a star rubric (yourself or with an AI judge), and confirm a champion per role from the leaderboard.

It runs on [Vaultbase](https://github.com/vaultbase-sh/vaultbase) 0.46.0, pinned and checksum-verified. The source of truth for what it does is [docs/SPEC.md](docs/SPEC.md); how it is built is in [docs/TECH-SPEC.md](docs/TECH-SPEC.md).

## Set up

You need [Bun](https://bun.sh) 1.4 or later on Linux or macOS.

```sh
git clone https://github.com/go4cas/audition.git
cd audition
bun install
bun run dev
```

`bun run dev` downloads Vaultbase and checks its checksum, builds the UI, starts the server, creates your sign-ins and seeds four example workspaces. On the first run it prints the owner's email and password (also saved in `.vaultbase/credentials.json`, which only you can read) and the address to open, normally <http://127.0.0.1:8091/api/custom/app/>.

`bun run stop` stops the server. Your data stays in `.vaultbase/data` for the next `bun run dev`.

To choose your own owner sign-in, set `AUDITION_OWNER_EMAIL` and `AUDITION_OWNER_PASSWORD` before `bun run dev`. To use another port, set `VAULTBASE_PORT`.

## Test

```sh
bun test
```

Each test file starts its own fresh Vaultbase on a free port, so tests never touch your data. Everything runs against the built-in mock provider: no test calls a real model or needs a key.

## API keys

Audition never reads provider keys from the environment. You add a key to a connection in the UI (Contenders, then Add connection), it is stored encrypted, and the UI never shows it again. `bun run dev` and `bun test` refuse to start while variables like `ANTHROPIC_API_KEY` are set, so a key in your shell can't leak into Vaultbase; unset them first.

## More

- [docs/OPERATIONS.md](docs/OPERATIONS.md): running it day to day, and the local check with a real Anthropic key.
- [docs/RELEASE.md](docs/RELEASE.md): installing it on a server, backups (with the off-server copy in Cloudflare R2), restores and upgrades.
- [docs/NOTES.md](docs/NOTES.md): decisions and findings from each build step.
- [docs/design/](docs/design/): the visual design.
- [site/](site/): the public website, published to GitHub Pages.
