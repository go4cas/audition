# Installing on the shared VPS

Status: built as the one-command installer, `deploy/install.sh` (Cas asked for a simpler VPS install on Nov 13 2026; how to use it is in [RELEASE.md](RELEASE.md)). Cas installed it on the VPS on Nov 16, 2026 (v0.3.0, tunnel mode, port 8091), and Audition has been live at audition.go4cas.com since; upgrades use the same installer (see RELEASE.md). The sections below are the reasoning; "What was built" maps each point to the installer.

Audition goes on Cas's existing Hostinger VPS, next to production apps (Market Jury, openGym and others), at **audition.go4cas.com** (Cas, Nov 13 2026). The goal: installing, running, upgrading or removing Audition must not change anything those apps depend on.

## What the current install does to a server

RELEASE.md was written for a fresh, empty VPS. On a shared one, these steps are the problem:

| Step in RELEASE.md | What it does | Risk on a shared server |
| --- | --- | --- |
| 1. `curl bun.sh/install \| sudo env BUN_INSTALL=/usr/local bash` | Installs Bun globally as `/usr/local/bin/bun`, as root | **High.** Replaces any Bun another app uses, and runs a downloaded script as root |
| 2. `ln -sfn ... /usr/local/bin/vaultbase` | Points the global `vaultbase` command at Audition's pinned binary | **High** if another app uses Vaultbase: its commands would run Audition's version |
| 2. `sudo bun install` | Installs packages as root, including dev tools (Playwright) | Low, but unneeded: the server needs runtime packages only |
| env: `VAULTBASE_PORT=8091` | Vaultbase's default port, on 127.0.0.1 | **High** if another Vaultbase app already uses 8091 |
| 6. `apt install caddy` | Installs or upgrades the Caddy package | **Medium.** An upgrade restarts Caddy for every site; if nginx owns 80/443, Caddy can't start |
| 6. copy `deploy/Caddyfile` to `/etc/caddy/Caddyfile` | Replaces the whole Caddy config, including a global `servers { trusted_proxies ... }` block | **Very high.** Removes every other site Caddy serves; the global block changes how all sites read client IPs |
| 6. cert to `/etc/caddy/cloudflare-origin.pem` | Generic file name | **High.** Overwrites another site's origin cert if it uses the same name |
| 6. firewall: 80/443 only from Cloudflare | Changes server-wide firewall rules | **High.** Breaks any app not proxied by Cloudflare, and Let's Encrypt HTTP checks |

These are already contained and stay as they are: the `audition` system user (no login shell), `/opt/audition`, `/var/lib/audition`, `/etc/audition`, the `audition.service` unit with its hardening (read-only system, only the data folder writable, no capabilities), Vaultbase bound to 127.0.0.1 only, and no system cron (backups and repeats are Vaultbase's own jobs). Backups stay inside `/var/lib/audition/backups`; the optional off-server copy goes to a Cloudflare R2 bucket, sent by Vaultbase itself (RELEASE.md "Off-server copy").

## Proposed contained install

1. **Read first.** `deploy/preflight.sh` reads the server and reports names, ports, proxies, shared tools, firewall and other services. It changes nothing (no installs, no writes, not even temp files). Run it before deciding anything, and again before the install.
2. **One user, three namespaced folders, no global commands.**
   - `/opt/audition/` holds the release checkout plus `bin/` (the pinned Vaultbase binaries and the `vaultbase` symlink) and `tools/` (a private Bun). Nothing goes in `/usr/local`.
   - `/var/lib/audition/` holds all data, as now. `/etc/audition/audition.env` holds settings, as now.
   - The unit's `ExecStart` uses `/opt/audition/bin/vaultbase`; the `vb` alias does too.
3. **No global installs or package upgrades.** Bun is installed into `/opt/audition/tools/bun` (or an existing Bun is used if it is 1.4 or later). `bun install --production` skips dev tools. If Caddy or another proxy needs installing or upgrading, that is a separate step Cas decides on.
4. **Its own port, on loopback only.** The pre-flight picks a free port (8091 if free, otherwise one Cas chooses); it lives in `audition.env` and the proxy site file only.
5. **Its own proxy site file, nothing global.** Whatever the server already runs gets one extra file for `audition.go4cas.com` only: for Caddy a site file pulled in by an `import` line (no global options block; client IPs come from `CF-Connecting-IP` in the site block); for nginx a `sites-available/audition` file. A Cloudflare origin cert for that host only, named `audition.go4cas.com.pem`. Validate (`caddy validate` / `nginx -t`) before reload, and reload, never restart.
   If the server uses a Cloudflare Tunnel, Audition becomes one more ingress rule and needs no open port, cert or firewall change.
6. **No firewall changes.** 80/443 are already open for the other apps; Vaultbase listens on 127.0.0.1 only, so nothing new is exposed.
7. **Resource limits in the unit.** Add `MemoryMax=` (for example 512M), `CPUQuota=` (for example 100%) and `TasksMax=`, so a runaway run can't starve Market Jury or openGym. Values come from the pre-flight's memory and CPU numbers.
8. **Clean uninstall.** A documented removal that touches only Audition's names: stop and disable `audition.service`, remove the unit, remove the proxy site file (validate, reload), remove `/opt/audition`, `/etc/audition`, the `audition` user, and, only after an off-server copy, `/var/lib/audition` and any `/var/lib/audition.before-*` rollback copies. Then delete the DNS record.

## What was built

| Point above | In the installer |
| --- | --- |
| 1. Read first | Runs `preflight.sh` and shows it before asking to go ahead; stops if anything named `audition` already exists |
| 2. One user, namespaced folders, no global commands | `/opt/audition/{releases,current,bin}`, `/var/lib/audition`, `/etc/audition`; nothing in `/usr/local` |
| 3. No global installs | A prebuilt release bundle per architecture (GitHub workflow): no Bun, git or build step on the server; no packages installed |
| 4. Own port on loopback | 8091, or the next free port up to 8199, or `--port` |
| 5. Own proxy site file | Caddy: a file in the folder the Caddyfile already imports (or the `import` line printed, never added); nginx: `sites-available/audition.conf`. Validated before reload, removed again if rejected. TLS by Caddy itself, or `--tls-cert/--tls-key` |
| 6. No firewall changes | None made |
| 7. Resource limits | `MemoryHigh=768M`, `MemoryMax=1G`, `CPUQuota=150%`, `TasksMax=512` in the unit |
| 8. Clean uninstall | `install.sh uninstall` (keeps data), `--purge` (removes everything); proxy files tracked in `/etc/audition/installed-files` |

It also upgrades (rerun with `--version`, with a cold rollback copy), rolls back (`install.sh rollback`), and asks only for the domain, your email and a password: the Vaultbase admin is made through Vaultbase's setup key with a random password.

## Plain systemd or Docker

Recommendation: **plain systemd**, unless the other apps already run in Docker. Audition is one binary with one data folder, and the unit's hardening already gives most of what a container would. Docker would add a daemon if it isn't there, and Docker-published ports bypass `ufw` rules, which is easy to get wrong next to other apps. If the server is Docker-based (for example everything behind a Traefik or Caddy container), a small Audition image with the data folder as a volume fits better, and this plan changes to that.

## Open questions for Cas

Still useful before the first install, though the installer now handles Caddy, nginx and "something else" on its own:

1. **Reverse proxy:** what serves 80/443 today (Caddy, nginx, Traefik, a Cloudflare Tunnel, Hostinger's panel), and how are other sites added?
2. **TLS and DNS:** is go4cas.com on Cloudflare, proxied (orange cloud), with Full (strict) and origin certs, or does the proxy get Let's Encrypt certs?
3. **How the other apps run:** systemd units, Docker/compose, PM2? Does any of them use Vaultbase or Bun (and which versions)?
4. **Port:** is 8091 free, or is there a port convention?
5. **Deploy user:** do you SSH in as a sudo user (which name), or as root?

Running `sudo bash deploy/preflight.sh 8091 audition.go4cas.com` on the server and pasting the output answers most of these.
