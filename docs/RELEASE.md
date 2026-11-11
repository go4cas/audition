# Release

How to put Audition on a server and keep it running: install, the systemd service, backups and restores, and upgrades (of Audition and of Vaultbase). Running it on your own machine is in [OPERATIONS.md](OPERATIONS.md).

Nothing here has been deployed yet. Every step on the server is yours to run, when you decide to.

## What runs where

Audition in production is one Vaultbase 0.44.0 process behind Caddy, with Cloudflare in front. Vaultbase does the backend work: the database, sign-ins, files, the hooks and routes Audition adds, encrypted API keys, and its own scheduled backups. Bun is only needed on the server to fetch the binary, build the UI and run the setup script; the running service is the Vaultbase binary alone.

| Path | What | Who can write |
| --- | --- | --- |
| `/opt/audition` | The Audition release, a git checkout at a tag: `vb_hooks/`, `schema/`, `ui/dist/` | root only |
| `/usr/local/lib/audition/vaultbase-<version>` | The pinned Vaultbase binary, checked against `vaultbase.lock.json` | root only |
| `/usr/local/bin/vaultbase` | A symlink to the binary in use, so a rollback is one `ln` | root only |
| `/var/lib/audition` | All data: database, uploaded files, the encryption key, the sign-in secret, and `backups/` | the `audition` user |
| `/etc/audition/audition.env` | The service's settings ([deploy/audition.env.example](../deploy/audition.env.example)) | root (readable by `audition`) |

The repo's [deploy/](../deploy/) folder holds the three files to copy: [audition.service](../deploy/audition.service) (systemd), [audition.env.example](../deploy/audition.env.example) and [Caddyfile](../deploy/Caddyfile).

Vaultbase listens on 127.0.0.1:8091 only. The app is at `https://<your domain>/` (Caddy sends `/` to `/api/custom/app/`). The Vaultbase admin (`/_/`) is not public: you reach it through an SSH tunnel (see [The Vaultbase admin](#the-vaultbase-admin)).

## Install

On a fresh Ubuntu or Debian VPS, as a user with sudo. Replace `audition.example.com` and `v0.1.0` with your domain and the release tag.

### 1. User, folders and Bun

```sh
sudo useradd --system --home /var/lib/audition --shell /usr/sbin/nologin audition
sudo install -d -o audition -g audition -m 0700 /var/lib/audition
sudo install -d -m 0755 /etc/audition /usr/local/lib/audition
curl -fsSL https://bun.sh/install | sudo env BUN_INSTALL=/usr/local bash   # Bun 1.4 or later
```

### 2. The release

```sh
sudo git clone https://github.com/go4cas/audition.git /opt/audition
cd /opt/audition
sudo git checkout v0.1.0
sudo bun install --frozen-lockfile
sudo bun run setup        # downloads Vaultbase 0.44.0 and refuses it unless the SHA-256 matches
sudo bun run build:ui     # builds ui/dist
sudo install -m 0755 .vaultbase/bin/0.44.0/vaultbase /usr/local/lib/audition/vaultbase-0.44.0
sudo ln -sfn /usr/local/lib/audition/vaultbase-0.44.0 /usr/local/bin/vaultbase
vaultbase --version       # vaultbase 0.44.0
```

Don't run `bun run dev` on the server: it starts its own instance with a data folder inside the checkout.

### 3. Settings and the admin

```sh
sudo install -o root -g audition -m 0640 deploy/audition.env.example /etc/audition/audition.env
```

Vaultbase's own commands (`setup-admin`, `doctor`, `backup`) read this file when you point them at it, and must run as the `audition` user so the files they write stay the service's. This alias saves typing:

```sh
alias vb='sudo -u audition env VAULTBASE_ENV_FILE=/etc/audition/audition.env vaultbase'
vb setup-admin --email you@example.com --password '<a long password>'
```

The admin password needs at least 12 characters: since 0.42.0, `setup-admin` follows Vaultbase's password policy.

The admin is the Vaultbase administrator (settings, backups, restores). The owner, made in step 5, is the person who uses Audition. They can be the same person, with different passwords.

### 4. The service

```sh
sudo cp deploy/audition.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now audition
journalctl -u audition -n 20     # "applied snapshot: 14 created", the hooks folder, "Vaultbase running"
curl -fsS http://127.0.0.1:8091/_/ready
```

On its first start Vaultbase creates `.encryption-key` and `.secret` in `/var/lib/audition`. **Copy both somewhere safe now**, away from the server (a password manager is fine). Backups don't contain them, and without `.encryption-key` the stored API keys can never be read again: Vaultbase refuses to start on data whose key is lost.

```sh
sudo cat /var/lib/audition/.encryption-key /var/lib/audition/.secret
```

### 5. Provision: settings, owner, backups and the seed

`bun run provision` does once, against the running service, what `bun run dev` does locally, without writing any credentials file:

- applies Audition's settings (the 15-minute queue timeout, MFA available),
- turns on Vaultbase's scheduled backups (see [Backups](#backups)),
- creates the owner if there isn't one,
- runs the seed: the generic handoff template (needed for manual contenders), the mock connection and contenders, and the four example workspaces.

```sh
cd /opt/audition
read -rp 'Admin email: ' AUDITION_ADMIN_EMAIL; read -rsp 'Admin password: ' AUDITION_ADMIN_PASSWORD; echo
read -rp 'Owner email: ' AUDITION_OWNER_EMAIL; read -rsp 'Owner password: ' AUDITION_OWNER_PASSWORD; echo
export AUDITION_ADMIN_EMAIL AUDITION_ADMIN_PASSWORD AUDITION_OWNER_EMAIL AUDITION_OWNER_PASSWORD
bun run provision
```

It prints the backup schedule it set and the next run. It is safe to run again; it only adds what is missing. Running it again does bring back an example workspace you deleted.

### 6. Caddy and Cloudflare

1. In Cloudflare, add an `A` (and `AAAA`) record for the domain pointing at the VPS, **proxied** (orange cloud). Under SSL/TLS, set the mode to **Full (strict)**.
2. Under SSL/TLS, Origin Server, create an **Origin Certificate** for the domain. Save the certificate as `/etc/caddy/cloudflare-origin.pem` and the key as `/etc/caddy/cloudflare-origin-key.pem` (owner `caddy`, mode 0600 for the key).
3. Install Caddy (`sudo apt install caddy`), copy [deploy/Caddyfile](../deploy/Caddyfile) to `/etc/caddy/Caddyfile`, put in your domain, and `sudo systemctl reload caddy`.
4. Firewall: allow SSH, and 80 and 443 only from [Cloudflare's ranges](https://www.cloudflare.com/ips/). Port 8091 stays closed; Vaultbase only listens on 127.0.0.1 anyway.

The Caddyfile trusts Cloudflare's addresses for `CF-Connecting-IP`, and the env file trusts Caddy (`VAULTBASE_TRUSTED_PROXIES=127.0.0.1,::1`). Together they let Vaultbase's rate limits see the visitor's real address instead of Cloudflare's. If Cloudflare adds ranges, update the Caddyfile.

### 7. Smoke test

Do this after every install, upgrade and restore.

- [ ] `curl -fsS http://127.0.0.1:8091/_/ready` answers, and `vaultbase --version` is the pinned version.
- [ ] `vb doctor` says clean.
- [ ] `https://<your domain>/` opens the sign-in page; the owner signs in.
- [ ] Home lists the workspaces; a leaderboard opens.
- [ ] Start a run: any role, one task, `Mock Steady`, judged by Me. It finishes; judge it; it shows on the leaderboard.
- [ ] In the admin, Settings, Backup & restore shows the schedule on and a next run.
- [ ] `https://<your domain>/_/` answers 404 (the admin isn't public).

## The Vaultbase admin

The admin (`/_/`) is where settings, backups and restores live. Open it through an SSH tunnel, from your own machine:

```sh
ssh -L 8091:127.0.0.1:8091 you@your-vps
```

Then open <http://127.0.0.1:8091/_/> and sign in as the admin. Hooks and routes are read-only there in production, because they come from the release in git.

## Backups

Audition uses Vaultbase's own scheduled backups. `bun run provision` turns them on with these settings (all editable in the admin under Settings, **Backup & restore**):

| Setting | Value | Meaning |
| --- | --- | --- |
| `backups.enabled` | `1` | The schedule is on |
| `backups.cron` | `0 3 * * *` | Every day at 03:00 UTC |
| `backups.keep` | `14` | The last 14 are kept; older ones are removed |
| `backups.files` | `1` | Each backup also keeps the uploaded files (task attachments, handoff files, mock images) |

Each backup is a consistent snapshot of the database (SQLite `VACUUM INTO`, safe while Audition runs) plus a manifest of the uploaded files, in `/var/lib/audition/backups/`. The files are stored once and shared between backups, so fourteen backups don't take fourteen times the space. The same page takes a backup on demand, and lists every backup with its size and file count.

**What a backup doesn't hold:** `.encryption-key` and `.secret`. You copied both in install step 4, and they never change. Without the encryption key a restored database starts, but the API keys in it can't be read.

### Off the server

A backup in `/var/lib/audition/backups` doesn't survive losing the server. Vaultbase can also copy every backup to S3-compatible storage, with the same pruning: on the Backup & restore page, turn on the S3 copy and fill in the endpoint, bucket, keys and prefix (settings `backups.s3.*`). Cloudflare R2 fits, since the domain is on Cloudflare already. Use a **private bucket of its own**: a backup holds every password hash. This needs a bucket and its keys from you, so it isn't switched on by `provision`.

Until that's on, copy the backups folder off the server yourself now and then, for example `rsync -a you@your-vps:/var/lib/audition/backups/ ./audition-backups/` (run as a user that can read it).

### Restore a backup

In the admin, under Settings, **Backup & restore**, pick the backup and restore it. Or, as the admin, `POST /api/v1/admin/backups/<name>/restore`. Vaultbase swaps the database in place, puts back any uploaded files that are missing, and keeps Audition running.

- In 0.40.2 the browser may show a network error during a restore, although the restore completes (finding RL1 in [NOTES.md](NOTES.md)). Reload the page, then run the smoke test.
- Sign-ins revoked since the backup stay revoked. Users deleted since the backup stay deleted unless you turn on "Bring back users deleted since the backup".
- Background work that ran since the backup is marked dead instead of running again. In Audition, that means a run that was going when the backup was taken can come back with outputs that never finish. Use **Run again** on it.
- To restore safely, turn on maintenance mode first (Settings, **Maintenance mode** in the admin), restore, check, then turn it off. A restore keeps maintenance mode as it was.

### Restore onto a new server

1. Install steps 1 to 3 as above, with the same release tag. **Don't start the service yet.**
2. Put the saved `.encryption-key` and `.secret` into `/var/lib/audition` (owner `audition`, mode 0600).
3. Copy the backups (the whole `backups/` folder, or the R2 prefix) into `/var/lib/audition/backups/`, owned by `audition`.
4. Start the service (step 4), restore the newest backup from the admin, then run the smoke test. You don't need `provision`: the settings, the owner and the seed are all in the backup.

## Upgrades

There are two kinds, and they follow the same steps on the server: a new Audition release, and a new Vaultbase version. A Vaultbase upgrade arrives as an Audition release too, because the pin lives in `vaultbase.lock.json`.

### Before the server: the upgrade policy

Vaultbase upgrades follow TECH-SPEC §1, "Upgrade policy":

1. Once a month, a short "Vaultbase upgrade" thread reads the changelog from the pinned version (0.44.0) to the newest release, quoting every **Security** and **Upgrade notes** item that touches what Audition uses (auth, rules, files, hooks, the egress guard, backups, the records API). A security fix there means upgrading that week. `vaultbase update` prints whether a newer release exists.
2. You approve the version. The thread runs `bun run vb:bump <version>`, then `bun test`, including the upgrade test from the old binary to the new one (`AUDITION_UPGRADE_FROM` set to the old lock file) and the PR quotes the changelog sections it read.
3. You merge the PR and tag a release.

Owner uploads still go through Audition's own route (`POST /api/custom/files/:collection/:id/:field`, from T2). Vaultbase fixed its own upload endpoint (F9) in 0.41.1, and `test/files.test.ts` now checks that it works; moving the UI to it, and moving server writes to the records API, is part B of `docs/PLATFORM-UPGRADES.md`, a separate change after the upgrade.

**0.40.2 to 0.44.0** (the first Vaultbase upgrade, after v0.1.0) needs nothing beyond the steps below: no setting, schema or env change. `deploy/audition.service` uses only options 0.44.0 still accepts (0.42.0 refuses unknown ones). The upgrade test opened 0.40.2 data with 0.44.0 and found every record, file, key and sign-in.

### On the server

Vaultbase upgrades its data folder when it starts, and it can't downgrade. So the safety copy is a **cold copy of the whole data folder, taken while the service is stopped**: it holds the database, the files and both keys, and it starts as it was on the old binary. (A Vaultbase backup holds only the database and files, and a restore runs inside the new version, so it isn't the rollback.)

```sh
NEW=v0.2.0                                   # the release tag
cd /opt/audition
sudo git fetch --tags && sudo git checkout "$NEW"
sudo bun install --frozen-lockfile
sudo bun run setup && sudo bun run build:ui
VER=$(bun -e 'console.log((await Bun.file("vaultbase.lock.json").json()).version)')
sudo install -m 0755 .vaultbase/bin/$VER/vaultbase /usr/local/lib/audition/vaultbase-$VER

sudo systemctl stop audition
sudo cp -a /var/lib/audition /var/lib/audition.before-$NEW   # the rollback copy
sudo ln -sfn /usr/local/lib/audition/vaultbase-$VER /usr/local/bin/vaultbase
sudo systemctl start audition
journalctl -u audition -n 30
```

Then run the smoke test. Keep the `before-` copy until the next upgrade.

The UI and hooks change with the checkout before the service stops. Vaultbase reloads changed hook files within a second, so between `git checkout` and `systemctl stop` the old binary may already run the new hooks; the window is short and the stop follows. For a Vaultbase upgrade where that matters, stop the service before `git checkout`.

### Rollback

Never start the old binary on data the new one has opened. Roll back with the copy:

```sh
OLD=v0.1.0; OLDVER=0.40.2
sudo systemctl stop audition
sudo mv /var/lib/audition /var/lib/audition.failed-$(date +%F)
sudo cp -a /var/lib/audition.before-v0.2.0 /var/lib/audition
cd /opt/audition && sudo git checkout "$OLD" && sudo bun install --frozen-lockfile && sudo bun run build:ui
sudo ln -sfn /usr/local/lib/audition/vaultbase-$OLDVER /usr/local/bin/vaultbase
sudo systemctl start audition
```

Anything done in Audition between the upgrade and the rollback is lost; `audition.failed-*` still holds it if you need to look.

## Day to day on the server

| What | How |
| --- | --- |
| Status | `systemctl status audition` |
| Log | `journalctl -u audition -f` |
| Restart | `sudo systemctl restart audition` |
| Health | `curl -fsS http://127.0.0.1:8091/_/ready`, `vb doctor` |
| Back up now | Admin, Settings, Backup & restore |
| A one-off database copy | `vb backup --to /var/lib/audition/manual-$(date +%F).db` (database only, no files or keys) |
| Is there a newer Vaultbase? | `vaultbase update` |

## How this was checked

`test/release.test.ts` runs the release on a fresh Vaultbase 0.44.0, laid out like production (the real `vb_hooks/` only, read-only, its own data folder), on every `bun test`:

- `provision` applies the settings and the backup schedule, creates the owner, seeds, and changes nothing on a second run; the app answers at `/api/custom/app/`.
- A Vaultbase backup keeps the uploaded files, and restoring it undoes a change made after it.
- A cold copy of the data folder starts on its own, with every record, both keys, and the owner's sign-in.
- Wrong passwords hit Vaultbase's auth rate limit (`429`) within 20 tries (review finding R6).

The systemd unit passes `systemd-analyze verify`. Not checked from here: running it under systemd, the Caddyfile (the session couldn't run Caddy), and Cloudflare. The first install on the VPS is the check for those; note anything that differs.
