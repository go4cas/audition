# Settings screen — spec

A settings screen for the factory-demo app, built in vanilla JS and CSS, usable at 375 px wide. See `mockup.png` for the layout.

## Sections

1. **Profile**: display name (required, 1 to 50 characters) and email (read-only).
2. **Notifications**: three toggles: product news, weekly summary, security alerts. Security alerts can't be turned off.
3. **Danger zone**: a "Delete account" button that asks for confirmation by typing DELETE.

## Behaviour

- Settings load from `GET /api/settings` and save with `PUT /api/settings`.
- Saving shows "Saved" for two seconds; a failed save shows the server's message.
- The side tabs become a row of tabs below 600 px.

## Acceptance criteria

- Every control has a visible label and works with the keyboard.
- A display name over 50 characters can't be saved, and the field says why.
- At 375 px nothing scrolls sideways.
