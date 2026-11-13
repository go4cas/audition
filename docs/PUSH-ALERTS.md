# Push alerts

A later roadmap item (docs/SPEC.md, "Roadmap after Phase 1"), approved by Cas on Nov 13, 2026. Audition already emails the owner (Phase 2a, part 4). Push alerts send the same alerts to the owner's phone and computer, and keep them in an inbox inside the app.

## What it uses from Vaultbase

- **`helpers.notify(userId, { title, body, data })`** (Vaultbase 0.44.0, `src/core/notifications.ts`). One call writes a row to the built-in `notifications` collection, which sends a realtime event, and queues one push per provider turned on in the admin. The trigger code never names a provider.
- **The built-in `notifications` collection.** Vaultbase creates it, with `device_tokens`, the first time a push provider is turned on in the admin. Its rules are owner-only: you see and mark read only your own alerts. Audition adds no collection and changes no schema.
- **A push provider** turned on in **Settings → Notifications**. Vaultbase 0.44 has two built in: OneSignal and Firebase (FCM). It has no plain web push (VAPID) provider, and a new provider can only be added by code that embeds Vaultbase, not from `vb_hooks/`.
- **Realtime** for the bell's unread count, through the app's existing `lib/realtime.js`.

## The alerts

The same moments as the emails. Each email now also goes through `helpers.notify`, from `alertOwner()` in `vb_hooks/lib/arena.ts`:

| Alert | When | Push title | Opens |
|---|---|---|---|
| Run finished | AI judge: the run is done | "Researcher run finished" | The run, or the leaderboard when it suggests a new champion |
| Ready to judge | Judge Me: the outputs are ready | "Researcher outputs are ready to judge" | The run |
| Champion change | In the run-finished alert | "… The leaderboard suggests a new champion." | The leaderboard |
| Repeat skipped | A scheduled repeat can't start | "A repeat of Researcher was skipped" | The run |
| Outcome checks due | Daily at 07:00 UTC | "2 outcome checks due" | Outcome checks |

Email and push are independent. Either can be off, and neither ever fails a run: a failed or skipped send writes one line to the hook log.

## In the app

- **A bell in the top bar** with the unread count, live over realtime. It shows on phones too.
- **The Alerts page** (`/alerts`) lists the latest 50 alerts, newest first. Opening one marks it read and goes to its page. **Mark all read** clears the bell. A new alert while the app is open also shows as a toast.
- **On this device**: with OneSignal turned on, a **Turn on alerts here** button asks the browser for permission and subscribes this device. **Turn off here** stops it for this device only. Signing out turns it off too. OneSignal's SDK loads only after you press the button on a device, never before.
- Before any push provider is turned on, the page says **Alerts are off** and how to turn them on.

## Setup (OneSignal)

See docs/OPERATIONS.md, "Push alerts".

## How OneSignal is wired

- Vaultbase sends each push to OneSignal with the owner's user id as OneSignal's `external_id`. The app's SDK logs in with the same id (`OneSignal.login`), so every device you turn on gets your alerts. Vaultbase never sees device tokens.
- `GET /api/custom/push` (owner only) returns `{ provider: "onesignal", app_id }` when OneSignal is on, else `{ provider: null }`. The App ID is public by design; the API key stays in Vaultbase.
- OneSignal's service worker must come from Audition's own origin. The app route serves `/api/custom/app/OneSignalSDKWorker.js` (one `importScripts` line) while OneSignal is on, and the SDK registers it with the scope `/api/custom/app/`.
- **CSP**: while OneSignal is on, the app's CSP also allows `https://cdn.onesignal.com` (script, style, image), `https://onesignal.com`, `https://api.onesignal.com` (connect) and `https://img.onesignal.com` (image). With OneSignal off the CSP stays `'self'` only.
- Clicking a push while the app is open goes to the alert's page. With the app closed, OneSignal opens the Site URL set in its dashboard, which should be the app's home page.

## Tests

- `test/push.test.ts`: on a fresh Vaultbase, a run finishes with no notifications set up and nothing breaks; after turning OneSignal on in the admin, the run-finished and ready-to-judge alerts land in the owner's inbox with the right title, text and link, the owner can mark one read, and a signed-out caller sees nothing. `alertOwner` never throws.
- `test/ui-alerts.test.ts` (Playwright): "Alerts are off" before setup; a new alert raises the bell live and shows a toast; opening it goes to its page and marks it read; **Mark all read** on a phone; **Turn on alerts here** and **Turn off here** against a stand-in for OneSignal's SDK (the real one is never loaded in tests), the widened CSP, and the service worker file.
- The tests never reach OneSignal. Turning it on with a test key makes Vaultbase queue the pushes, which OneSignal then refuses.

## Not verified yet

- A real OneSignal account, and a real push reaching a phone. This needs Cas's OneSignal App ID and API key on a server with HTTPS.
- iPhone and iPad get web push only from a Home Screen web app (iOS 16.4 or later). Audition has a web manifest already; the Alerts page says to add it to the Home Screen first.
