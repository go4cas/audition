# Release

How to put Audition on a server and keep it running: install, the systemd service, backups and restores, and upgrades (of Audition and of Vaultbase). Running it on your own machine is in [OPERATIONS.md](OPERATIONS.md).

Nothing here has been deployed yet. Every step on the server is yours to run, when you decide to.

## What runs where

Audition in production is one Vaultbase 0.47.0 process on 127.0.0.1, behind the reverse proxy the server already has (Caddy or nginx), usually with Cloudflare in front. Vaultbase does the backend work: the database, sign-ins, files, the hooks and routes Audition adds, encrypted API keys, and its own scheduled backups. The server needs no Bun, git or build step: each GitHub release carries a ready-made bundle.

The install is contained, so it can share a server with other apps (docs/VPS-INSTALL.md). Everything it adds is named `audition`:

| Path | What | Who can write |
| --- | --- | --- |
| `/opt/audition/releases/<tag>` | A release bundle: `vb_hooks/`, `schema/`, `ui/dist/`, the setup tool, `deploy/`. The current and the previous one are kept | root only |
| `/opt/audition/current` | A symlink to the release in use | root only |
| `/opt/audition/bin/vaultbase-<version>` and `vaultbase` | The pinned Vaultbase binary, checked against `vaultbase.lock.json`, and a symlink to the one in use | root only |
| `/var/lib/audition` | All data: database, uploaded files, the encryption key, the sign-in secret, and `backups/` | the `audition` user |
| `/var/lib/audition-rollback` | A stopped copy of the data from before the last upgrade | root only |
| `/etc/audition/` | `audition.env` (the service's settings), `admin-credentials` (the Vaultbase admin, root only), `install.conf` and `installed-files` (what the installer added) | root |
| `/etc/systemd/system/audition.service` | The service ([deploy/audition.service](../deploy/audition.service)): hardened, with memory and CPU caps | root |
| One proxy site file | `audition.caddy` in the folder your Caddyfile imports, or `sites-available/audition.conf` for nginx | root |

The installer installs no packages, edits no shared config file, and doesn't touch the firewall. Vaultbase listens on 127.0.0.1 only, on 8091 or the next free port. The app is at `https://<your domain>/` (the proxy, or a Cloudflare redirect rule behind a tunnel, sends `/` to `/api/custom/app/`). The Vaultbase admin (`/_/`) is not public: you reach it through an SSH tunnel (see [The Vaultbase admin](#the-vaultbase-admin)).

## Install

On a Linux server with systemd (Ubuntu, Debian and the like; x86_64 or arm64), as a user with sudo:

1. With a Caddy or nginx proxy, point the domain at the server in your DNS (for Cloudflare: an `A`/`AAAA` record, proxied, SSL/TLS mode **Full (strict)**). With a Cloudflare Tunnel, skip this: the tunnel adds the record (see below).
2. Download the installer and run it:

   ```sh
   curl -fsSLO https://github.com/go4cas/audition/releases/latest/download/install.sh
   sudo bash install.sh
   ```

   **On a server that can't reach GitHub** (or while the repository was private, before Nov 17, 2026), download `install.sh` and `audition-<tag>-linux-x64.tar.gz` from the release page on your own computer (or `gh release download <tag> -R go4cas/audition -p 'install.sh' -p '*linux-x64.tar.gz'`), copy them up, and point the installer at the bundle. The Vaultbase binary still comes from Vaultbase's public release.

   ```sh
   scp install.sh audition-<tag>-linux-x64.tar.gz you@your-vps:
   ssh you@your-vps sudo bash install.sh --bundle audition-<tag>-linux-x64.tar.gz
   ```

   Upgrades work the same way, with the new bundle. Without a checksum file to compare against, the installer trusts the bundle you copied; the Vaultbase binary is still checked.

It shows a read-only pre-flight report of the server (`deploy/preflight.sh`), then asks three things: the domain, your email, and a password for signing in to Audition. It stops before changing anything if something named `audition` already exists, and picks another port if 8091 is taken. After you say yes, it:

- downloads the release bundle and the pinned Vaultbase binary, and refuses either unless its SHA-256 matches;
- creates the `audition` system user (no login), the folders above and `audition.env`;
- installs and starts `audition.service`;
- creates the Vaultbase admin with a random password through Vaultbase's setup key, and saves it in `/etc/audition/admin-credentials` (root only);
- runs the setup tool (`bin/audition-setup`, the compiled `bun run provision`): Audition's settings, the App URL for links in emails, Vaultbase's scheduled backups (see [Backups](#backups)), your account, and the seed (the generic handoff template, the mock connection and contenders, and the four example workspaces);
- adds the proxy site file, checks it (`caddy validate` or `nginx -t`), and reloads the proxy. If the check fails, it removes the file and leaves the proxy as it was;
- checks that the domain reaches Audition through the proxy.

Options, to skip the questions or change a default: `--domain`, `--email`, `--port`, `--version vX.Y.Z`, `--bundle FILE`, `--proxy auto|caddy|nginx|tunnel|none`, `--tls-cert FILE --tls-key FILE`, `--yes`. `bash install.sh --help` lists them. `bash install.sh preflight` only prints the report.

**Proxy and TLS.** The installer looks at what holds ports 80 and 443:

- **Caddy:** it adds `audition.caddy` to the folder an `import <folder>/*` line in `/etc/caddy/Caddyfile` already pulls in. Without such a line it doesn't edit the Caddyfile: it leaves the site file in `/etc/audition/audition.caddy` and prints the one `import` line to add. Caddy gets the certificate itself, unless you pass `--tls-cert/--tls-key`.
- **nginx:** it adds `sites-available/audition.conf` (with its `sites-enabled` link), or `conf.d/audition.conf`. Without `--tls-cert/--tls-key` it serves port 80 only, which is enough behind Cloudflare's Flexible mode; for Full (strict), add a [Cloudflare origin certificate](https://developers.cloudflare.com/ssl/origin-configuration/origin-ca/) with `sudo bash install.sh proxy --tls-cert origin.pem --tls-key origin-key.pem`.
- **A Cloudflare Tunnel** (`cloudflared` running, nothing on 80/443): nothing goes on the server, and no port or firewall rule is opened. The installer prints three steps for the Cloudflare dashboard:
  1. Zero Trust, Networks, Tunnels, your tunnel, Routes, **Add route**, **Published application** (older dashboards: **Public hostname**, Add): the domain, service URL `http://127.0.0.1:<port>`. Cloudflare adds the DNS record and serves HTTPS.
  2. Your domain, Security, **Security rules** (older dashboards: WAF, Custom rules), Create rule, **Custom rule**, action **Block**, expression `(http.host eq "<your domain>" and starts_with(http.request.uri.path, "/_/") and http.request.uri.path ne "/_/ready")`. With no local proxy this rule is what keeps the Vaultbase admin off the internet. The `http.host` part keeps it from touching other sites on the same zone.
  3. Your domain, Rules, Create rule, **Redirect rule**, expression `(http.host eq "<your domain>" and http.request.uri.path eq "/")`, Static, URL `https://<your domain>/api/custom/app/`, status 302. Caddy and nginx do this redirect in their site file; behind a tunnel nothing else does, and `https://<your domain>/` answers 404 without it.

  `cloudflared` connects from 127.0.0.1, which `audition.env` trusts, and Cloudflare passes the visitor's address on in `X-Forwarded-For`, so Vaultbase's rate limits should see it. Check on the first install: sign-ins in the admin's logs should show your own address, not 127.0.0.1.
- **Anything else** (Traefik, a container): it sets up no proxy and prints where to point it (`http://127.0.0.1:<port>`); the bundle's `deploy/Caddyfile` and `deploy/nginx.conf` are ready-made site files.

Both site files trust `CF-Connecting-IP` only from [Cloudflare's addresses](https://www.cloudflare.com/ips/), and `audition.env` trusts the proxy (`VAULTBASE_TRUSTED_PROXIES=127.0.0.1,::1`). Together they let Vaultbase's rate limits see the visitor's real address, and nobody can fake it by connecting to the server directly. If Cloudflare adds ranges, update the site file and run `sudo bash install.sh proxy`.

**Save the keys.** On its first start Vaultbase creates `.encryption-key` and `.secret` in `/var/lib/audition`. **Copy both somewhere safe now**, away from the server (a password manager is fine). Backups don't contain them, and without `.encryption-key` the stored API keys can never be read again: Vaultbase refuses to start on data whose key is lost.

```sh
sudo cat /var/lib/audition/.encryption-key /var/lib/audition/.secret
```

**Remove it.** `sudo bash install.sh uninstall` stops and removes the service, the proxy site file and `/opt/audition`, and keeps the data, `/etc/audition` and the `audition` user, so running the installer again picks up where it was. `sudo bash install.sh uninstall --purge` removes those too. If you added the `import` line for Caddy by hand, remove it first; uninstall tells you.

### Running Vaultbase's own commands

Vaultbase's commands (`doctor`, `backup`, `setup-admin`) read the service's env file when you point them at it, and must run as the `audition` user so the files they write stay the service's:

```sh
alias vb='sudo -u audition env VAULTBASE_ENV_FILE=/etc/audition/audition.env /opt/audition/bin/vaultbase'
vb doctor
```

### Smoke test

Do this after every install, upgrade and restore.

- [ ] `sudo bash install.sh status` says active and ready, with the pinned Vaultbase version.
- [ ] `vb doctor` says clean.
- [ ] `https://<your domain>/` opens the sign-in page; the owner signs in.
- [ ] Home lists the workspaces; a leaderboard opens.
- [ ] Start a run: any role, one task, `Mock Steady`, judged by Me. It finishes; judge it; it shows on the leaderboard.
- [ ] While that run is live, the browser's dev tools (Network, WS) show an open `/realtime` socket. If it fails, the run page still works by polling: check that Cloudflare's WebSockets setting is on and Caddy passes `/realtime` through (NOTES "Realtime run page").
- [ ] On a run's page, Guest votes, "Ask guests to vote" makes a link. Opened in a private window (not signed in), it shows the answers by letter and saves a star. Close the link afterwards. If the private window says "Voting isn't open", the settings weren't applied: rerun the upgrade with `--force`.
- [ ] In the admin, Settings, Backup & restore shows the schedule on and a next run.
- [ ] `https://<your domain>/_/` answers 404 (the admin isn't public), or 403 from Cloudflare's WAF rule behind a tunnel.

## The Vaultbase admin

The admin (`/_/`) is where settings, backups and restores live. Open it through an SSH tunnel, from your own machine:

```sh
ssh -L 8091:127.0.0.1:<port> you@your-vps   # <port>: PORT in /etc/audition/install.conf
```

Then open <http://127.0.0.1:8091/_/> and sign in as the admin (the email and password in `/etc/audition/admin-credentials`). Hooks and routes are read-only there in production, because they come from the release in git.

**Keep File storage on local.** Leave the admin's File storage setting on the local disk (the default); don't switch it to S3 or R2. Audition's own upload route, the mock image provider and the seed write files through `vb_hooks/lib/files.ts`, which puts the bytes straight into the local upload folder because Vaultbase has no server-side file helper yet. With File storage moved elsewhere, those files would be missing from it. This can change once Vaultbase ships a helper like `helpers.files.save` (requested in Vaultbase discussion #11).

**Downloads are in the audit log.** Both file fields (task attachments and output files) have `auditDownloads` on, so every file download shows in the admin's Audit log as `files.download`, with who, which record and which field. A thumbnail shown on the judge page is logged the same way (NOTES TH2). Image previews on the judge page are Vaultbase thumbnails (`thumbs` on the same fields); Vaultbase keeps them in `uploads/.thumbs/` and makes them again if that folder is lost, so it needs no backup.

## Backups

Audition uses Vaultbase's own scheduled backups. The installer's setup step (`provision`) turns them on with these settings (all editable in the admin under Settings, **Backup & restore**):

| Setting | Value | Meaning |
| --- | --- | --- |
| `backups.enabled` | `1` | The schedule is on |
| `backups.cron` | `0 3 * * *` | Every day at 03:00 UTC |
| `backups.keep` | `14` | The last 14 are kept; older ones are removed |
| `backups.files` | `1` | Each backup also keeps the uploaded files (task attachments, handoff files, mock images) |

Each backup is a consistent snapshot of the database (SQLite `VACUUM INTO`, safe while Audition runs) plus a manifest of the uploaded files, in `/var/lib/audition/backups/`. The files are stored once and shared between backups, so fourteen backups don't take fourteen times the space. The same page takes a backup on demand, and lists every backup with its size and file count.

**What a backup doesn't hold:** `.encryption-key` and `.secret`. You copied both after installing ("Save the keys"), and they never change. Without the encryption key a restored database starts, but the API keys in it can't be read.

### Off-server copy (Cloudflare R2)

A backup in `/var/lib/audition/backups` doesn't survive losing the server. Vaultbase copies each backup to S3-compatible storage itself: with its `backups.s3.*` settings on, every backup (the 03:00 one and every **Back up now**) is also uploaded to the bucket, with the uploaded files, and the bucket is pruned to the same 14. Audition only switches that on and checks it works; nothing of Audition's runs on a schedule for it. The bucket is Cloudflare R2, since the domain is on Cloudflare already. At Audition's size (about 1 MB a backup) it stays well inside R2's free allowance.

**1. In the Cloudflare dashboard** (names can shift a little between dashboard versions):

1. **R2 Object Storage**, **Create bucket**. Name it `audition-backups`, location Automatic. Keep it **private**: don't connect a custom domain or turn on public access. A backup holds every password hash and the encrypted API keys.
2. Back on the R2 overview, copy the **Account ID** (on the right).
3. **Manage API tokens** (R2 overview, under API), **Create Account API token** (a User API token works too). Permissions **Object Read & Write**, **Apply to specific buckets only**: `audition-backups`. TTL Forever. Create it, then copy the **Access Key ID** and the **Secret Access Key**. The secret is shown only once.

**2. On the server:**

```sh
sudo bash install.sh offsite
```

It asks for the Account ID (or the bucket's S3 API URL), the bucket name, the Access Key ID and the Secret (hidden). It writes, reads back and deletes a test file in the bucket, so a wrong key or bucket name stops here with a plain message and nothing saved. Then it saves the settings in Vaultbase (the secret is stored encrypted, and shown as `********` in the admin), takes a backup now, and checks it reached the bucket. The backups land under `audition/` in the bucket: `vaultbase-<date>.db`, its `.files.json` manifest, and `files/` (each uploaded file stored once).

- `sudo bash install.sh offsite --off` stops the copy. What's in the bucket stays.
- **Save the R2 keys with `.encryption-key` and `.secret`** (the password manager entry from "Save the keys"). A new server needs all four, plus the Account ID and bucket name.
- The `offsite` and `restore-offsite` commands come with v0.5.0 (Nov 18, 2026); v0.4.1 and older don't have them. On an older release, turn the same copy on in the admin instead: Settings, **Backup & restore**, **Copy to S3**: endpoint `https://<account-id>.r2.cloudflarestorage.com`, the bucket, region `auto`, the two keys, prefix `audition/`; then **Back up now** and check the page shows no error.
- If a copy fails (R2 down, a key revoked), the backup on the server is still made, and the admin's Backup & restore page shows the error until a later backup succeeds. Check it now and then, with the smoke test.

### Restore a backup

In the admin, under Settings, **Backup & restore**, pick the backup and restore it. Or, as the admin, `POST /api/v1/admin/backups/<name>/restore`. Vaultbase swaps the database in place, puts back any uploaded files that are missing, and keeps Audition running.

- In 0.40.2 the browser may show a network error during a restore, although the restore completes (finding RL1 in [NOTES.md](NOTES.md)). Reload the page, then run the smoke test.
- Sign-ins revoked since the backup stay revoked. Users deleted since the backup stay deleted unless you turn on "Bring back users deleted since the backup".
- Background work that ran since the backup is marked dead instead of running again. In Audition, that means a run that was going when the backup was taken can come back with outputs that never finish. Use **Run again** on it.
- To restore safely, turn on maintenance mode first (Settings, **Maintenance mode** in the admin), restore, check, then turn it off. A restore keeps maintenance mode as it was.

### Restore onto a new server

When the server is lost, with the off-server copy on:

1. Install Audition on the new server (see [Install](#install)) with the same release tag (`--version`) or a newer one, and set up the domain as before. It makes a fresh instance with its own Vaultbase admin.
2. Straight after, before changing anything in it:

   ```sh
   sudo bash install.sh restore-offsite
   ```

   It asks for the R2 details (as `offsite` does), then for the saved `.encryption-key` and `.secret`: paste them as you saved them (one after the other, or run together the way `sudo cat` printed them). It downloads the bucket's backups into `/var/lib/audition/backups`, stops Audition, puts the saved keys in place (keeping the new server's own in `/var/lib/audition/keys-before-restore`), starts it, restores the newest backup through Vaultbase's restore, resets the Vaultbase admin to the one in the new `/etc/audition/admin-credentials`, and restarts.
3. Run the smoke test. Your account, password, workspaces, runs and files are as they were at the last backup. The off-server copy settings come back with the backup, so the new server goes on copying to the same bucket.

On the same server (the data folder damaged, the keys unchanged), leave the keys answer empty. Without the off-server copy, copy the old `backups/` folder into `/var/lib/audition/backups/` (owned by `audition`) by hand instead, put the saved keys in place with Audition stopped, start it, and restore the newest backup from the admin.

If Audition doesn't start with the saved keys, the command puts the new server's own keys back and stops before restoring. That happens when a setting with a secret (an SMTP password, the R2 keys) was saved on the new server before the restore; reinstall with `uninstall --purge` and run `restore-offsite` first.

## Upgrades

There are two kinds, and they follow the same steps on the server: a new Audition release, and a new Vaultbase version. A Vaultbase upgrade arrives as an Audition release too, because the pin lives in `vaultbase.lock.json`.

### Before the server: the upgrade policy

Vaultbase upgrades follow TECH-SPEC §1, "Upgrade policy":

1. Once a month, a short "Vaultbase upgrade" thread reads the changelog from the pinned version (0.47.0) to the newest release, quoting every **Security** and **Upgrade notes** item that touches what Audition uses (auth, rules, files, hooks, the egress guard, backups, the records API). A security fix there means upgrading that week. `vaultbase update` prints whether a newer release exists.
2. You approve the version. The thread runs `bun run vb:bump <version>`, then `bun test`, including the upgrade test from the old binary to the new one (`AUDITION_UPGRADE_FROM` set to the old lock file) and the PR quotes the changelog sections it read.
3. You merge the PR and tag a release.

Owner uploads still go through Audition's own route (`POST /api/custom/files/:collection/:id/:field`, from T2). Vaultbase fixed its own upload endpoint (F9) in 0.41.1, and `test/files.test.ts` checks that it works, but it can't take Markdown, CSV or zip files (NOTES W1). Server writes go through the records API since part B of `docs/PLATFORM-UPGRADES.md`, which needs Vaultbase 0.43 or later: deploy it only on the pinned version (0.47.0).

**0.40.2 to 0.44.0** (the first Vaultbase upgrade, after v0.1.0) needs nothing beyond the steps below: no setting, schema or env change. `deploy/audition.service` uses only options 0.44.0 still accepts (0.42.0 refuses unknown ones). The upgrade test opened 0.40.2 data with 0.44.0 and found every record, file, key and sign-in.

**0.44.0 to 0.46.0** (Nov 17, 2026) also needs nothing beyond the steps below: no setting, schema, env or service change. The installer's upgrade fetches the Vaultbase binary named in the release's `vaultbase.lock.json`, so a new Audition release carries the new Vaultbase with it, and `rollback` goes back to the old binary too. The upgrade test opened 0.44.0 data with 0.46.0 and found every record, file, key and sign-in.

**0.46.0 to 0.47.0** (Nov 19, 2026) needs nothing beyond the steps below either: no setting, schema, env or service change. It fixes OneSignal pushes with App API keys, so after the upgrade an alert from Audition shows a banner on devices that turned alerts on, with the key already saved in the admin (no need to enter it again). The upgrade test opened 0.46.0 data with 0.47.0 and found every record, file, key and sign-in.

### On the server

```sh
curl -fsSLO https://github.com/go4cas/audition/releases/latest/download/install.sh
sudo bash install.sh --version v0.5.0      # the release tag
```

Fetch the new `install.sh` first, so the upgrade runs the release's own installer. On a server that can't reach GitHub, copy the new bundle up and run `sudo bash install.sh --bundle audition-<tag>-linux-x64.tar.gz` instead (see [Install](#install)).

Running the installer again on a server that has Audition upgrades it. It downloads and checks the new bundle (and the new Vaultbase binary, when the pin changed), stops the service, takes a **cold copy of the whole data folder** into `/var/lib/audition-rollback` (the database, the files and both keys), switches `/opt/audition/current` and the binary symlink, starts the service, and applies Audition's Vaultbase settings again (signed in as the admin from `/etc/audition/admin-credentials`), so a setting a release adds takes effect (guest voters, v0.5.0: anonymous sessions and rate limits). Vaultbase upgrades its data folder when it starts and can't downgrade, so that copy is the rollback, not a Vaultbase backup. Then run the smoke test. Hook files only change while the service is stopped.

### Rollback

```sh
sudo bash install.sh rollback
```

It stops the service, moves the current data aside to `/var/lib/audition.failed-<date>`, puts back the copy from before the upgrade, points everything at the previous release and binary, and starts it. Never start the old binary on data the new one has opened; the rollback never does. Anything done in Audition between the upgrade and the rollback is lost; `audition.failed-*` still holds it if you need to look.

## Day to day on the server

| What | How |
| --- | --- |
| Status | `sudo bash install.sh status`, `systemctl status audition` |
| Log | `journalctl -u audition -f` |
| Restart | `sudo systemctl restart audition` |
| Health | `vb doctor` (alias above) |
| Back up now | Admin, Settings, Backup & restore |
| Off-server copy on or off | `sudo bash install.sh offsite` / `sudo bash install.sh offsite --off` |
| Bring the newest off-server backup back | `sudo bash install.sh restore-offsite` |
| A one-off database copy | `vb backup --to /var/lib/audition/manual-$(date +%F).db` (database only, no files or keys) |
| Is there a newer Vaultbase? | `vb update` |
| Redo the proxy site file | `sudo bash install.sh proxy [--tls-cert FILE --tls-key FILE]` |

### Guest links and Cloudflare

Guest voters (TECH-SPEC §10b) need no Cloudflare change. The guest page (`/api/custom/app/vote/…`), the guest sign-in (`/api/v1/auth/guests/anonymous`) and the guest routes (`/api/custom/guest/…`) go through like the rest of the app, and the host-scoped WAF rule only blocks `/_/`. Vaultbase's rate limiter (10 guest sign-ins and 240 guest calls a minute per visitor) sees each visitor's address because `audition.env` trusts the tunnel. Optional second layer: a Cloudflare rate-limiting rule on `/api/v1/auth/guests/anonymous` for your host (the free plan allows one). If Cloudflare's Bot Fight Mode or "Under Attack" mode is on, guests may get a challenge page first; that is fine.

### Speed and Cloudflare settings

A Lighthouse check of the live server (Nov 23, 2026) found two Cloudflare settings that undo what the app does. Both are dashboard changes for the go4cas.com zone; nothing on the server changes.

1. **Caching, Configuration, Browser Cache TTL: "Respect existing headers".** Audition sends its own cache lifetimes (`routes/app.ts`, `lib/static.ts` `cacheControl`): `index.html` is never cached, the hashed chunks and every `?v=<hash>` file (main.js, the stylesheets, the fonts) are kept for a year, the rest five minutes. Cloudflare's default replaces all of them with 4 hours, so a returning visitor downloads the app again every few hours. This is safe because the file names change with every build, so an upgrade still reaches browsers at once.
2. **Analytics & Logs, Web Analytics: turn off automatic setup for `audition.go4cas.com`** (or exclude that host). Cloudflare injects its analytics script into the page; the app's Content-Security-Policy (no inline or outside scripts) blocks it, which shows as two console errors and lowers Lighthouse's Best practices score. Audition has no use for it. The landing page on GitHub Pages is not affected.

Run Lighthouse in an Incognito window: browser extensions (Adobe Acrobat's, for one) add their own scripts to the page and to the "unused JavaScript" figure. The six third-party cookies it reports come from the OneSignal SDK, which push alerts need (PUSH-ALERTS.md).

## Making a release

1. Tag the release on `main` and publish it on GitHub (Releases, Draft a new release).
2. The **Release bundles** workflow (`.github/workflows/release.yml`) runs `bun run bundle` and attaches `install.sh`, `preflight.sh`, `audition-<tag>-linux-x64.tar.gz`, `audition-<tag>-linux-arm64.tar.gz` and `SHA256SUMS` to the release. For a release published before the workflow existed, run it by hand from the Actions tab with the tag.
3. `bun run bundle` makes the same files locally in `release-dist/`.

## How this was checked

`test/release.test.ts` runs the release on a fresh Vaultbase 0.47.0, laid out like production (the real `vb_hooks/` only, read-only, its own data folder), on every `bun test`:

- `provision` applies the settings and the backup schedule, creates the owner, seeds, and changes nothing on a second run; the app answers at `/api/custom/app/`.
- A Vaultbase backup keeps the uploaded files, and restoring it undoes a change made after it.
- A cold copy of the data folder starts on its own, with every record, both keys, and the owner's sign-in.
- Wrong passwords hit Vaultbase's auth rate limit (`429`) within 20 tries (review finding R6).

`test/offsite.test.ts` checks the off-server copy against a local S3-compatible stand-in for R2 (`test/fake-s3.ts`):

- Wrong keys or a wrong bucket stop before anything is saved, with a plain message.
- Turning it on saves Vaultbase's `backups.s3.*` settings (the secret masked), and the first backup reaches the bucket with its manifest and every uploaded file.
- Later backups are copied too, and the bucket is pruned to the same `backups.keep` as the server.
- A new server with only the saved keys and the bucket gets every record, the owner's sign-in and the uploaded files back, starts again on the restored data, and goes on copying.

`install.sh offsite` and `restore-offsite` were run in a scratch Linux container against the same stand-in, with `systemctl` stubbed (no systemd there): install, `offsite`, a change, a full `uninstall --purge`, a fresh install, `restore-offsite` with the pasted keys; the change, the owner's old password and the admin from the new credentials file all worked afterwards (NOTES "Off-server backups"). Not checked here: real R2 and real systemd.

`test/install.test.ts` builds a release bundle and runs the installer's steps from the bundle alone: the admin through Vaultbase's setup key (refused without it), then the compiled setup tool, then the owner's sign-in, the four workspaces and the UI.

The whole installer (install, a second run, a refused checksum, upgrade, rollback, uninstall, reinstall on the kept data, purge, and the `proxy` command) was run as root in a scratch Ubuntu 24.04 machine, next to an existing Caddy site and then an nginx site, which kept answering throughout. That machine had no systemd, so a stand-in started the unit's `ExecStart` as its user; the unit's hardening and limits, real ACME certificates and Cloudflare were not checked there. The first install on the VPS is the check for those; note anything that differs.
