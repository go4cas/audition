# Website

The public website for Audition, published to GitHub Pages by `.github/workflows/pages.yml` on every push to `main` that touches it.

```sh
bun run site         # build into _site/ and serve it on http://127.0.0.1:8095
bun run build:site   # build only
```

Plain HTML, CSS and a little JavaScript: no framework and no build step beyond copying files. `scripts/site.ts` copies the app's brand files into `_site/` next to these, so the site and the app share one set of tokens, fonts, icons and logo:

| In `_site/` | Copied from |
| --- | --- |
| `assets/css/tokens.css`, `assets/css/fonts.css` | `ui/src/styles/` |
| `assets/fonts/` | `ui/src/fonts/` |
| `assets/icons.svg` (Phosphor sprite, use `#i-<name>`) | `ui/src/sprite.svg` |
| `assets/brand/` | `docs/design/logo/` |

## Layout

```
site/
  index.html          the landing page
  assets/
    css/site.css      all site styles (landing page and docs)
    js/site.js        interactions; every part is optional
    img/screens/      app screenshots, a -light and a -dark file each
  docs/
    index.html        the docs hub
```

**Docs.** Each future docs page goes in its own folder under `docs/` (for example `docs/install/index.html`), sets `data-base="../../"` on `<html>` so `site.js` finds the icons, and links `../../assets/css/site.css`. Until then the hub links to the guides in the repository.

**Screenshots.** Taken at 1280 × 800 (2x) and 390 × 844 from the `test/ui-walkthrough.test.ts` flow against the mock provider, in light and dark. The mock provider's placeholder names and answers ("Mock Steady", "[[mock-quality:3]]") were swapped for sample text before each shot, so the screens read like a real run. Light and dark versions swap with the theme (`.only-light` / `.only-dark`).

**Versions.** Write `{{AUDITION_VERSION}}` and `{{VAULTBASE_VERSION}}` in any HTML file and `scripts/site.ts` fills them in: Audition's newest release tag (`git describe`, or GitHub's latest release when the checkout has no tags) and the pinned Vaultbase version from `vaultbase.lock.json`. The release workflow starts the Website workflow again once a release is published, so the page always names the latest release.

**Motion.** Every animation stops under `prefers-reduced-motion`.
