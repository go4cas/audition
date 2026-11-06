# audition-factory-demo

A small Bun app used by Audition's Software Factory reference workspace. Coding tasks name this repository and a commit, so every contender starts from the same code.

- `src/settings-store.ts`: a JSON file settings store.
- `src/server.ts`: one REST endpoint, `GET /api/settings`.
- `ui/`: empty; the UI task builds the settings screen here from `settings-spec.md` and `mockup.png`.

```
bun install
bun test
bun run start   # http://localhost:3000/api/settings
```
