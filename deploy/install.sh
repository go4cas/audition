#!/usr/bin/env bash
# Audition installer for a Linux server with systemd (docs/RELEASE.md).
#
#   curl -fsSLO https://github.com/go4cas/audition/releases/latest/download/install.sh
#   sudo bash install.sh                 # install, or upgrade when Audition is already there
#   sudo bash install.sh uninstall       # remove Audition, keep its data
#   sudo bash install.sh uninstall --purge   # remove Audition and its data
#   sudo bash install.sh rollback        # undo the last upgrade
#   sudo bash install.sh status
#   sudo bash install.sh proxy --tls-cert F --tls-key F   # redo only the proxy site file
#   bash install.sh preflight            # only read the server and report
#
# Options: --version vX.Y.Z  --bundle FILE.tar.gz  --domain NAME  --email ADDRESS
#          --port N  --proxy auto|caddy|nginx|none  --tls-cert FILE --tls-key FILE  --yes
#
# Contained by design (docs/VPS-INSTALL.md): it only creates things named
# "audition": the `audition` user, /opt/audition, /var/lib/audition,
# /etc/audition, audition.service and one proxy site file. It installs no
# packages, changes no firewall, edits no shared config file, and listens on
# 127.0.0.1 only. Everything it adds is listed in /etc/audition/installed-files
# and removed by `uninstall`.
set -euo pipefail

AUDITION_VERSION_DEFAULT="latest"   # scripts/bundle.ts fills in the release tag
REPO="go4cas/audition"
RELEASE_BASE="${AUDITION_RELEASE_BASE:-https://github.com/$REPO/releases}"

PREFIX=/opt/audition
DATA=/var/lib/audition
ETC=/etc/audition
ROLLBACK=/var/lib/audition-rollback
UNIT=/etc/systemd/system/audition.service
SVC_USER=audition
MARKER="$ETC/install.conf"
MANIFEST="$ETC/installed-files"

# ── Output ────────────────────────────────────────────────────────────────────
if [ -t 1 ]; then B=$'\e[1m'; R=$'\e[31m'; G=$'\e[32m'; Y=$'\e[33m'; N=$'\e[0m'; else B=; R=; G=; Y=; N=; fi
step() { printf '\n%s==> %s%s\n' "$B" "$*" "$N"; }
ok()   { printf '%s  ok%s  %s\n' "$G" "$N" "$*"; }
note() { printf '      %s\n' "$*"; }
warn() { printf '%s  !!%s  %s\n' "$Y" "$N" "$*"; }
die()  { printf '\n%sStopped:%s %s\n' "$R" "$N" "$*" >&2; exit 1; }

TTY=/dev/tty
ask() { # ask VAR "Question" [default]
  local __v="$1" __q="$2" __d="${3:-}" __a=""
  [ -r "$TTY" ] || die "no terminal to ask \"$__q\"; pass it as an option instead."
  if [ -n "$__d" ]; then printf '%s [%s]: ' "$__q" "$__d" >"$TTY"; else printf '%s: ' "$__q" >"$TTY"; fi
  IFS= read -r __a <"$TTY" || true
  printf -v "$__v" '%s' "${__a:-$__d}"
}
ask_secret() { # ask_secret VAR "Question"
  local __v="$1" __q="$2" __a=""
  [ -r "$TTY" ] || die "no terminal to ask \"$__q\"; set it in the environment instead."
  printf '%s: ' "$__q" >"$TTY"; IFS= read -rs __a <"$TTY" || true; printf '\n' >"$TTY"
  printf -v "$__v" '%s' "$__a"
}
confirm() { # confirm "Question" → 0 for yes
  [ "$YES" = 1 ] && return 0
  local a; ask a "$1 (y/N)"; case "$a" in y|Y|yes|YES) return 0;; *) return 1;; esac
}

# ── Arguments ─────────────────────────────────────────────────────────────────
CMD=install; VERSION=""; BUNDLE=""; DOMAIN=""; EMAIL=""; PORT=""; PROXY=auto
TLS_CERT=""; TLS_KEY=""; YES=0; PURGE=0; FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    install|upgrade|uninstall|rollback|status|preflight|proxy) CMD="$1";;
    --version) VERSION="${2:?}"; shift;;
    --bundle) BUNDLE="${2:?}"; shift;;
    --domain) DOMAIN="${2:?}"; shift;;
    --email) EMAIL="${2:?}"; shift;;
    --port) PORT="${2:?}"; shift;;
    --proxy) PROXY="${2:?}"; shift;;
    --tls-cert) TLS_CERT="${2:?}"; shift;;
    --tls-key) TLS_KEY="${2:?}"; shift;;
    --yes|-y) YES=1;;
    --purge) PURGE=1;;
    --force) FORCE=1;;
    -h|--help) sed -n '2,23p' "$0"; exit 0;;
    *) die "unknown option $1 (see --help)";;
  esac
  shift
done
case "$PROXY" in auto|caddy|nginx|none) ;; *) die "--proxy must be auto, caddy, nginx or none";; esac

have() { command -v "$1" >/dev/null 2>&1; }
installed() { [ -f "$MARKER" ]; }
conf_get() { [ -f "$MARKER" ] && sed -n "s/^$1=//p" "$MARKER" | tail -1 || true; }
record() { grep -qxF "$1" "$MANIFEST" 2>/dev/null || echo "$1" >>"$MANIFEST"; }

need_root() { [ "$(id -u)" = 0 ] || die "run it with sudo: sudo bash $0 $CMD"; }
need_tools() {
  local t missing=""
  for t in curl tar sha256sum systemctl useradd runuser ss; do have "$t" || missing="$missing $t"; done
  [ -z "$missing" ] || die "these commands are missing:$missing. Audition's installer doesn't install packages; add them first."
  [ -d /run/systemd/system ] || [ -n "${AUDITION_TEST_NO_SYSTEMD:-}" ] || die "systemd isn't running here."
}

arch_name() {
  case "$(uname -m)" in x86_64|amd64) echo x64;; aarch64|arm64) echo arm64;; *) die "unsupported CPU $(uname -m) (x86_64 or arm64)";; esac
}

port_free() { ! ss -Hltn "sport = :$1" 2>/dev/null | grep -q .; }
pick_port() {
  local p
  for p in 8091 $(seq 8092 8199); do port_free "$p" && { echo "$p"; return; }; done
  die "no free port between 8091 and 8199; pass --port."
}

rand() { head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "${1:-32}"; }

# ── Release download ──────────────────────────────────────────────────────────
resolve_version() {
  [ -n "$VERSION" ] || VERSION="$AUDITION_VERSION_DEFAULT"
  if [ "$VERSION" = latest ]; then
    local loc
    loc=$(curl -fsSI "$RELEASE_BASE/latest" | tr -d '\r' | sed -n 's/^[Ll]ocation: .*\/tag\/\(.*\)$/\1/p' | tail -1)
    [ -n "$loc" ] || die "couldn't find the latest release at $RELEASE_BASE/latest"
    VERSION="$loc"
  fi
}

# Puts the release in $PREFIX/releases/<version> and sets REL_DIR and VERSION.
fetch_release() {
  local work arch name
  work=$(mktemp -d)
  arch=$(arch_name)
  if [ -n "$BUNDLE" ]; then
    [ -f "$BUNDLE" ] || die "$BUNDLE not found"
    cp "$BUNDLE" "$work/bundle.tar.gz"
    note "using the local bundle $BUNDLE (no checksum file to compare against)"
  else
    resolve_version
    name="audition-$VERSION-linux-$arch.tar.gz"
    note "downloading $name"
    curl -fsSL "$RELEASE_BASE/download/$VERSION/$name" -o "$work/bundle.tar.gz" || die "download failed: $RELEASE_BASE/download/$VERSION/$name"
    curl -fsSL "$RELEASE_BASE/download/$VERSION/SHA256SUMS" -o "$work/SHA256SUMS" || die "couldn't download SHA256SUMS for $VERSION"
    local want got
    want=$(awk -v n="$name" '$2==n{print $1}' "$work/SHA256SUMS")
    got=$(sha256sum "$work/bundle.tar.gz" | awk '{print $1}')
    [ -n "$want" ] && [ "$want" = "$got" ] || die "$name doesn't match its checksum (expected ${want:-none}, got $got). Nothing was installed."
    ok "checksum matches"
  fi
  tar -xzf "$work/bundle.tar.gz" -C "$work"
  [ -f "$work/audition/VERSION" ] || die "that file isn't an Audition release bundle"
  VERSION=$(cat "$work/audition/VERSION")
  REL_DIR="$PREFIX/releases/$VERSION"
  if [ -d "$REL_DIR" ] && [ "$FORCE" != 1 ]; then
    note "release $VERSION is already unpacked"
  else
    install -d -m 0755 "$PREFIX/releases"
    rm -rf "$REL_DIR"
    mv "$work/audition" "$REL_DIR"
    chown -R root:root "$REL_DIR"; chmod -R go-w "$REL_DIR"
  fi
  rm -rf "$work"
}

lock_field() { sed -n "s/^ *\"$1\": *\"\([^\"]*\)\".*/\1/p" "$2" | head -1; }

# Puts the pinned Vaultbase binary in $PREFIX/bin and sets VB_VERSION and VB_BIN.
fetch_vaultbase() {
  local lock="$REL_DIR/vaultbase.lock.json" asset base want got arch
  VB_VERSION=$(lock_field version "$lock")
  base=$(lock_field download_base "$lock")
  arch=$(arch_name)
  asset="vaultbase-linux-$arch"
  if [ "$arch" = x64 ] && ldd --version 2>&1 | grep -qi musl; then asset="vaultbase-linux-x64-musl"; fi
  want=$(lock_field "$asset" "$lock")
  [ -n "$VB_VERSION" ] && [ -n "$want" ] || die "vaultbase.lock.json has no entry for $asset"
  VB_BIN="$PREFIX/bin/vaultbase-$VB_VERSION"
  install -d -m 0755 "$PREFIX/bin"
  if [ -x "$VB_BIN" ] && [ "$(sha256sum "$VB_BIN" | awk '{print $1}')" = "$want" ]; then
    note "Vaultbase $VB_VERSION is already here"
    return
  fi
  note "downloading Vaultbase $VB_VERSION ($asset)"
  curl -fsSL "$base$asset" -o "$VB_BIN.download" || die "download failed: $base$asset"
  got=$(sha256sum "$VB_BIN.download" | awk '{print $1}')
  [ "$got" = "$want" ] || { rm -f "$VB_BIN.download"; die "Vaultbase $asset doesn't match the pinned checksum. Nothing was installed."; }
  chmod 0755 "$VB_BIN.download"; mv "$VB_BIN.download" "$VB_BIN"
  ok "Vaultbase $VB_VERSION verified"
}

# ── Service ───────────────────────────────────────────────────────────────────
write_env() {
  local port="$1" tmp
  tmp=$(mktemp)
  sed -e "s|__PORT__|$port|g" "$PREFIX/current/deploy/audition.env.example" >"$tmp"
  install -o root -g "$SVC_USER" -m 0640 "$tmp" "$ETC/audition.env"; rm -f "$tmp"
}

write_unit() {
  install -o root -g root -m 0644 "$PREFIX/current/deploy/audition.service" "$UNIT"
  systemctl daemon-reload
}

wait_ready() {
  local port="$1" i
  for i in $(seq 1 60); do
    curl -fsS --noproxy "*" "http://127.0.0.1:$port/_/ready" >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

vb() { runuser -u "$SVC_USER" -- env VAULTBASE_ENV_FILE="$ETC/audition.env" "$PREFIX/bin/vaultbase" "$@"; }

# ── Reverse proxy ─────────────────────────────────────────────────────────────
holder() { ss -Hltnp "sport = :$1" 2>/dev/null | grep -o 'users:(("[^"]*' | head -1 | sed 's/users:(("//'; }

detect_proxy() {
  [ "$PROXY" != auto ] && { echo "$PROXY"; return; }
  local h; h="$(holder 443)"; [ -n "$h" ] || h="$(holder 80)"
  case "$h" in
    caddy) echo caddy;;
    nginx) echo nginx;;
    "") if systemctl is-active -q caddy 2>/dev/null; then echo caddy; elif systemctl is-active -q nginx 2>/dev/null; then echo nginx; else echo none; fi;;
    *) echo none;;
  esac
}

# The folder an existing `import <dir>/<glob>` line in the main Caddyfile
# pulls site files from, and the file name to use there. Empty when there is none.
caddy_import_target() {
  local line pat dir glob
  line=$(grep -E '^[[:space:]]*import[[:space:]]+[^[:space:]]*\*' /etc/caddy/Caddyfile 2>/dev/null | head -1) || true
  [ -n "$line" ] || return 0
  pat=$(echo "$line" | awk '{print $2}')
  case "$pat" in /*) ;; *) pat="/etc/caddy/$pat";; esac
  dir=$(dirname "$pat"); glob=$(basename "$pat")
  echo "$dir/audition${glob#\*}"
}

install_tls() {
  local group="$1"
  [ -n "$TLS_CERT" ] || return 0
  [ -f "$TLS_CERT" ] && [ -f "$TLS_KEY" ] || die "--tls-cert and --tls-key must both be files"
  install -d -o root -g "$group" -m 0750 "$ETC/tls"
  install -o root -g "$group" -m 0640 "$TLS_CERT" "$ETC/tls/$DOMAIN.pem"
  install -o root -g "$group" -m 0640 "$TLS_KEY" "$ETC/tls/$DOMAIN-key.pem"
}

render_site() { # render_site TEMPLATE TLS_LINE
  sed -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__PORT__|$PORT|g" -e "s|__TLS__|$2|g" "$1"
}

setup_proxy() {
  local kind target tmp
  kind=$(detect_proxy)
  case "$kind" in
    caddy)
      have caddy || { warn "Caddy isn't installed; skipping the proxy step."; kind=none; }
      ;;
    nginx)
      have nginx || { warn "nginx isn't installed; skipping the proxy step."; kind=none; }
      ;;
  esac
  case "$kind" in
    caddy)
      target=$(caddy_import_target)
      local tls="# TLS: Caddy gets a certificate for this domain itself"
      if [ -n "$TLS_CERT" ]; then install_tls caddy; tls="tls $ETC/tls/$DOMAIN.pem $ETC/tls/$DOMAIN-key.pem"; fi
      tmp=$(mktemp); render_site "$PREFIX/current/deploy/Caddyfile" "$tls" >"$tmp"
      if [ -z "$target" ]; then
        install -m 0644 "$tmp" "$ETC/audition.caddy"; rm -f "$tmp"
        warn "Your main Caddyfile has no 'import <folder>/*' line, and this installer doesn't edit it."
        note "Audition's site file is ready at $ETC/audition.caddy. To turn it on, add this line to /etc/caddy/Caddyfile:"
        note "    import $ETC/audition.caddy"
        note "then: caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy"
        PROXY_DONE="pending"
        return
      fi
      [ -e "$target" ] && ! grep -qxF "$target" "$MANIFEST" 2>/dev/null && die "$target already exists and isn't Audition's. Nothing was changed in Caddy."
      install -m 0644 "$tmp" "$target"; rm -f "$tmp"; record "$target"
      if ! caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>"$ETC/caddy-validate.log"; then
        rm -f "$target"
        die "Caddy rejected the new site file, so it was removed and Caddy was left as it was. Details: $ETC/caddy-validate.log"
      fi
      rm -f "$ETC/caddy-validate.log"
      systemctl reload caddy
      ok "Caddy site file $target added and Caddy reloaded"
      PROXY_DONE="caddy"
      ;;
    nginx)
      local avail enabled
      if [ -d /etc/nginx/sites-available ] && [ -d /etc/nginx/sites-enabled ]; then
        avail=/etc/nginx/sites-available/audition.conf; enabled=/etc/nginx/sites-enabled/audition.conf
      else
        avail=/etc/nginx/conf.d/audition.conf; enabled=""
      fi
      [ -e "$avail" ] && ! grep -qxF "$avail" "$MANIFEST" 2>/dev/null && die "$avail already exists and isn't Audition's. Nothing was changed in nginx."
      # IPv6 listeners only where the server has IPv6, or nginx -t fails.
      local v6=""; [ -s /proc/net/if_inet6 ] && v6=1
      local listen="listen 80;${v6:+\n    listen [::]:80;}"
      if [ -n "$TLS_CERT" ]; then
        install_tls root
        listen="listen 443 ssl;${v6:+\n    listen [::]:443 ssl;}\n    ssl_certificate $ETC/tls/$DOMAIN.pem;\n    ssl_certificate_key $ETC/tls/$DOMAIN-key.pem;"
      fi
      tmp=$(mktemp); render_site "$PREFIX/current/deploy/nginx.conf" "$listen" | sed 's/\\n/\n/g' >"$tmp"
      install -m 0644 "$tmp" "$avail"; rm -f "$tmp"; record "$avail"
      if [ -n "$enabled" ]; then ln -sfn "$avail" "$enabled"; record "$enabled"; fi
      if ! nginx -t >/dev/null 2>"$ETC/nginx-test.log"; then
        rm -f "$avail" ${enabled:+"$enabled"}
        die "nginx rejected the new site file, so it was removed and nginx was left as it was. Details: $ETC/nginx-test.log"
      fi
      rm -f "$ETC/nginx-test.log"
      systemctl reload nginx
      ok "nginx site file $avail added and nginx reloaded"
      [ -n "$TLS_CERT" ] || note "It serves plain HTTP on port 80. For HTTPS: sudo bash $0 proxy --tls-cert FILE --tls-key FILE (for example a Cloudflare origin certificate)"
      PROXY_DONE="nginx"
      ;;
    none)
      warn "No Caddy or nginx found in front of ports 80/443, so no proxy was set up."
      note "Point your proxy for $DOMAIN at http://127.0.0.1:$PORT. Ready-made site files:"
      note "  $PREFIX/current/deploy/Caddyfile and $PREFIX/current/deploy/nginx.conf (replace __DOMAIN__ and __PORT__)"
      PROXY_DONE="none"
      ;;
  esac
}

remove_proxy() {
  local f changed=""
  [ -f "$MANIFEST" ] || return 0
  while IFS= read -r f; do
    case "$f" in /etc/caddy/*) [ -e "$f" ] && { rm -f "$f"; changed="$changed caddy"; };;
                 /etc/nginx/*) [ -e "$f" ] || [ -L "$f" ] && { rm -f "$f"; changed="$changed nginx"; };; esac
  done <"$MANIFEST"
  case "$changed" in *caddy*) caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 && systemctl reload caddy && ok "Audition's Caddy site file removed";; esac
  case "$changed" in *nginx*) nginx -t >/dev/null 2>&1 && systemctl reload nginx && ok "Audition's nginx site file removed";; esac
  rm -rf "$ETC/tls"
}

# ── Commands ──────────────────────────────────────────────────────────────────
run_preflight() {
  local here; here="$(cd "$(dirname "$0")" && pwd)/preflight.sh"
  if [ -f "$here" ]; then bash "$here" "${PORT:-8091}" "${DOMAIN:-}"; return; fi
  if [ -f "$PREFIX/current/deploy/preflight.sh" ]; then bash "$PREFIX/current/deploy/preflight.sh" "${PORT:-8091}" "${DOMAIN:-}"; return; fi
  if [ -n "$BUNDLE" ]; then tar -xzOf "$BUNDLE" audition/deploy/preflight.sh | bash -s -- "${PORT:-8091}" "${DOMAIN:-}"; return; fi
  resolve_version
  curl -fsSL "$RELEASE_BASE/download/$VERSION/preflight.sh" | bash -s -- "${PORT:-8091}" "${DOMAIN:-}" \
    || warn "couldn't fetch preflight.sh for $VERSION; skipped the full report."
}

# Ask the proxy for the app's health check, as a visitor would (but from here).
check_through_proxy() {
  sleep 2
  if curl -fsSk --noproxy "*" --max-time 10 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/_/ready" >/dev/null 2>&1 \
     || curl -fsS --noproxy "*" --max-time 10 --resolve "$DOMAIN:80:127.0.0.1" "http://$DOMAIN/_/ready" >/dev/null 2>&1; then
    ok "https://$DOMAIN/ reaches Audition through the proxy (checked from this server)"
  else
    warn "the proxy doesn't answer for $DOMAIN yet. If Caddy is still getting a certificate, give it a minute; otherwise see its log."
  fi
}

cmd_proxy() {
  need_root
  installed || die "Audition isn't installed here; run: sudo bash $0"
  DOMAIN=$(conf_get DOMAIN); PORT=$(conf_get PORT)
  # Keep the certificate already in use unless new files are given.
  local keep=""
  if [ -z "$TLS_CERT" ] && [ -f "$ETC/tls/$DOMAIN.pem" ]; then
    keep=$(mktemp -d); cp "$ETC/tls/$DOMAIN.pem" "$ETC/tls/$DOMAIN-key.pem" "$keep/"
    TLS_CERT="$keep/$DOMAIN.pem"; TLS_KEY="$keep/$DOMAIN-key.pem"
  fi
  step "Reverse proxy for $DOMAIN"
  remove_proxy
  : >"$MANIFEST"
  PROXY_DONE=""
  setup_proxy
  [ -n "$keep" ] && rm -rf "$keep"
  sed -i '/^PROXY=/d' "$MARKER"; printf 'PROXY=%s\n' "$PROXY_DONE" >>"$MARKER"
  case "$PROXY_DONE" in caddy|nginx) check_through_proxy;; esac
}

cmd_install() {
  need_root; need_tools
  if installed; then cmd_upgrade; return; fi

  step "Checking the server (nothing is changed yet)"
  # After `uninstall` without --purge, the data, settings and user are still
  # here: install again on top of them.
  local reuse=0
  if [ -f "$ETC/install.conf.removed" ] && [ -d "$DATA" ]; then
    reuse=1
    [ -n "$DOMAIN" ] || DOMAIN=$(sed -n 's/^DOMAIN=//p' "$ETC/install.conf.removed")
    [ -n "$PORT" ] || { PORT=$(sed -n 's/^PORT=//p' "$ETC/install.conf.removed"); port_free "$PORT" || PORT=""; }
    EMAIL=$(sed -n 's/^EMAIL=//p' "$ETC/install.conf.removed")
    ok "found Audition's data from an earlier install in $DATA: keeping it"
  else
    getent passwd "$SVC_USER" >/dev/null && die "a user called '$SVC_USER' already exists, but not from this installer. Remove it or install by hand (docs/RELEASE.md)."
    [ -e "$ETC" ] && die "$ETC already exists, but not from this installer. Nothing was changed."
    [ -d "$DATA" ] && [ -n "$(ls -A "$DATA" 2>/dev/null)" ] && die "$DATA already holds data. Nothing was changed."
  fi
  for p in "$PREFIX" "$UNIT"; do [ -e "$p" ] && die "$p already exists, but not from this installer. Nothing was changed."; done
  if [ -n "$PORT" ]; then port_free "$PORT" || die "port $PORT is taken; pick another with --port."; else PORT=$(pick_port); fi
  ok "port $PORT is free (Audition listens on 127.0.0.1 only)"
  local kind; kind=$(detect_proxy); ok "reverse proxy: $kind"

  [ -n "$DOMAIN" ] || ask DOMAIN "Domain for Audition (for example audition.example.com)"
  [[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || die "\"$DOMAIN\" doesn't look like a domain name"
  getent ahosts "$DOMAIN" >/dev/null || warn "$DOMAIN doesn't resolve yet. Add its DNS record; the install can go ahead."
  [ -n "$EMAIL" ] || ask EMAIL "Your email (you sign in to Audition with it)"
  [[ "$EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || die "\"$EMAIL\" doesn't look like an email address"
  local pw="${AUDITION_OWNER_PASSWORD:-}" pw2
  [ "$reuse" = 1 ] && pw="(kept)"
  if [ -z "$pw" ]; then
    ask_secret pw "Choose your Audition password (12 characters or more)"
    ask_secret pw2 "Type it again"
    [ "$pw" = "$pw2" ] || die "the passwords don't match"
  fi
  [ "$reuse" = 1 ] || [ ${#pw} -ge 12 ] || die "the password needs at least 12 characters"

  step "Pre-flight report (read only)"
  run_preflight | sed 's/^/      /'

  printf '\nAbout to install Audition for %s, on port %s, proxy: %s.\n' "$DOMAIN" "$PORT" "$kind"
  printf 'It adds only: user %s, %s, %s, %s, %s and one proxy site file.\n' "$SVC_USER" "$PREFIX" "$DATA" "$ETC" "$UNIT"
  confirm "Go ahead?" || die "cancelled; nothing was changed."

  step "Getting the release"
  install -d -m 0755 "$PREFIX"
  fetch_release
  ln -sfn "$REL_DIR" "$PREFIX/current"
  fetch_vaultbase
  ln -sfn "$VB_BIN" "$PREFIX/bin/vaultbase"
  ok "Audition $VERSION with Vaultbase $VB_VERSION"

  step "User, folders and settings"
  getent passwd "$SVC_USER" >/dev/null || useradd --system --home-dir "$DATA" --no-create-home --shell /usr/sbin/nologin "$SVC_USER"
  install -d -o "$SVC_USER" -g "$SVC_USER" -m 0700 "$DATA"
  install -d -m 0755 "$ETC"
  rm -f "$ETC/install.conf.removed"
  : >"$MANIFEST"
  printf 'VERSION=%s\nDOMAIN=%s\nPORT=%s\nEMAIL=%s\nINSTALLED=%s\n' "$VERSION" "$DOMAIN" "$PORT" "$EMAIL" "$(date -u +%FT%TZ)" >"$MARKER"
  write_env "$PORT"
  ok "user $SVC_USER, $DATA, $ETC/audition.env"

  step "Starting the service"
  write_unit
  systemctl enable --now audition >/dev/null 2>&1 || systemctl start audition
  wait_ready "$PORT" || die "Audition didn't start. See: journalctl -u audition -n 50"
  ok "audition.service is running"

  if [ "$reuse" = 1 ]; then
    ok "kept your data, your account and the Vaultbase admin ($ETC/admin-credentials)"
  else
  step "Admin, settings, backups, your account and the examples"
  local key adminpw
  for _ in $(seq 1 20); do [ -s "$DATA/.setup-key" ] && break; curl -fsS --noproxy "*" "http://127.0.0.1:$PORT/api/v1/admin/setup/status" >/dev/null 2>&1 || true; sleep 0.5; done
  [ -s "$DATA/.setup-key" ] || die "Vaultbase didn't write its setup key"
  key=$(cat "$DATA/.setup-key")
  adminpw=$(rand 32)
  printf '{"email":"%s","password":"%s"}' "$EMAIL" "$adminpw" \
    | curl -fsS --noproxy "*" -X POST "http://127.0.0.1:$PORT/api/v1/admin/setup" -H "content-type: application/json" -H "X-Setup-Key: $key" --data-binary @- >/dev/null \
    || die "creating the Vaultbase admin failed"
  ( umask 077; printf 'Vaultbase admin for Audition (open it through an SSH tunnel, see docs/RELEASE.md)\nemail: %s\npassword: %s\n' "$EMAIL" "$adminpw" >"$ETC/admin-credentials" )
  ok "Vaultbase admin created; its password is in $ETC/admin-credentials (root only)"
  env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY \
  AUDITION_URL="http://127.0.0.1:$PORT" AUDITION_APP_URL="https://$DOMAIN" \
  AUDITION_ADMIN_EMAIL="$EMAIL" AUDITION_ADMIN_PASSWORD="$adminpw" \
  AUDITION_OWNER_EMAIL="$EMAIL" AUDITION_OWNER_PASSWORD="$pw" \
  AUDITION_SEED_FIXTURES="$PREFIX/current/seed/fixtures" \
    "$PREFIX/current/bin/audition-setup" | sed 's/^/      /' || die "setup failed; Audition is running, rerun with: sudo bash $0"
  fi

  step "Reverse proxy"
  PROXY_DONE=""
  setup_proxy
  printf 'PROXY=%s\n' "$PROXY_DONE" >>"$MARKER"
  case "$PROXY_DONE" in caddy|nginx) check_through_proxy;; esac

  step "Done"
  printf '\n  Audition: https://%s/\n  Sign in with %s and the password you chose.\n\n' "$DOMAIN" "$EMAIL"
  printf '%sSave these two files somewhere safe, away from this server%s (a password manager is fine).\n' "$B" "$N"
  printf 'Backups do not hold them, and without the first one stored API keys can never be read again:\n'
  printf '    sudo cat %s/.encryption-key %s/.secret\n\n' "$DATA" "$DATA"
  printf 'Upgrade later:  sudo bash install.sh --version <tag>\nRemove:         sudo bash install.sh uninstall\n'
}

cmd_upgrade() {
  need_root; need_tools
  installed || die "Audition isn't installed here yet; run: sudo bash $0"
  local old_version old_rel port
  old_version=$(conf_get VERSION); port=$(conf_get PORT); DOMAIN=$(conf_get DOMAIN)
  old_rel=$(readlink -f "$PREFIX/current")

  step "Getting the release"
  fetch_release
  if [ "$REL_DIR" = "$old_rel" ] && [ "$FORCE" != 1 ]; then ok "Audition $VERSION is already installed"; return; fi
  fetch_vaultbase
  confirm "Upgrade Audition from $old_version to $VERSION (Vaultbase $VB_VERSION)?" || die "cancelled; nothing was changed."

  step "Stopping Audition and keeping a rollback copy"
  systemctl stop audition
  install -d -m 0700 "$ROLLBACK"
  rm -rf "${ROLLBACK:?}/"*
  cp -a "$DATA" "$ROLLBACK/data"
  printf 'VERSION=%s\nRELEASE=%s\nVAULTBASE=%s\nDATE=%s\n' "$old_version" "$old_rel" "$(readlink -f "$PREFIX/bin/vaultbase")" "$(date -u +%FT%TZ)" >"$ROLLBACK/from"
  ok "copy of $DATA in $ROLLBACK (the state before this upgrade)"

  step "Switching to $VERSION"
  ln -sfn "$REL_DIR" "$PREFIX/current"
  ln -sfn "$VB_BIN" "$PREFIX/bin/vaultbase"
  write_unit
  systemctl start audition
  if ! wait_ready "$port"; then
    warn "Audition didn't come back on $VERSION. Roll back with: sudo bash $0 rollback"
    die "see: journalctl -u audition -n 50"
  fi
  sed -i "s/^VERSION=.*/VERSION=$VERSION/" "$MARKER"
  # Keep this release and the one before it; remove older ones.
  local d
  for d in "$PREFIX"/releases/*; do
    [ "$d" = "$REL_DIR" ] || [ "$d" = "$old_rel" ] || rm -rf "$d"
  done
  for d in "$PREFIX"/bin/vaultbase-*; do
    [ "$d" = "$VB_BIN" ] || [ "$d" = "$(sed -n 's/^VAULTBASE=//p' "$ROLLBACK/from")" ] || rm -f "$d"
  done
  ok "Audition $VERSION is running. Run the smoke test in docs/RELEASE.md."
}

cmd_rollback() {
  need_root
  installed || die "Audition isn't installed here."
  [ -f "$ROLLBACK/from" ] && [ -d "$ROLLBACK/data" ] || die "there is no rollback copy (one is made by each upgrade)."
  local rel vbbin ver port
  rel=$(sed -n 's/^RELEASE=//p' "$ROLLBACK/from"); vbbin=$(sed -n 's/^VAULTBASE=//p' "$ROLLBACK/from"); ver=$(sed -n 's/^VERSION=//p' "$ROLLBACK/from")
  port=$(conf_get PORT)
  [ -d "$rel" ] && [ -x "$vbbin" ] || die "the release before the upgrade ($rel) is gone."
  confirm "Roll back to $ver? Anything done in Audition since the upgrade is lost (it is kept in $DATA.failed-*)." || die "cancelled."
  systemctl stop audition
  mv "$DATA" "$DATA.failed-$(date +%Y%m%d-%H%M%S)"
  cp -a "$ROLLBACK/data" "$DATA"
  ln -sfn "$rel" "$PREFIX/current"
  ln -sfn "$vbbin" "$PREFIX/bin/vaultbase"
  write_unit
  systemctl start audition
  wait_ready "$port" || die "Audition didn't start after the rollback. See: journalctl -u audition -n 50"
  sed -i "s/^VERSION=.*/VERSION=$ver/" "$MARKER"
  ok "back on $ver"
}

cmd_uninstall() {
  need_root
  installed || [ -e "$UNIT" ] || [ -d "$PREFIX" ] || die "Audition isn't installed here."
  if [ "$PURGE" = 1 ]; then
    printf 'This removes Audition and %sall its data%s (%s, backups included).\n' "$B" "$N" "$DATA"
    confirm "Remove Audition and delete its data?" || die "cancelled."
  else
    printf 'This removes Audition. Its data stays in %s and %s.\n' "$DATA" "$ETC"
    confirm "Remove Audition?" || die "cancelled."
  fi
  step "Removing Audition"
  if [ -e "$UNIT" ]; then
    systemctl disable --now audition >/dev/null 2>&1 || systemctl stop audition || true
    rm -f "$UNIT"; systemctl daemon-reload
    ok "audition.service removed"
  fi
  if [ -f "$ETC/audition.caddy" ] && grep -qE "^[[:space:]]*import[[:space:]]+$ETC/audition.caddy" /etc/caddy/Caddyfile 2>/dev/null; then
    die "/etc/caddy/Caddyfile still imports $ETC/audition.caddy. Remove that line and reload Caddy first, then run uninstall again."
  fi
  remove_proxy
  rm -rf "$PREFIX"; ok "$PREFIX removed"
  rm -f "$ETC/audition.caddy" "$MANIFEST"
  if [ "$PURGE" = 1 ]; then
    rm -rf "$DATA" "$ROLLBACK" "$DATA".failed-* "$ETC"
    getent passwd "$SVC_USER" >/dev/null && userdel "$SVC_USER"
    ok "data, settings and the $SVC_USER user removed"
  else
    mv -f "$MARKER" "$ETC/install.conf.removed"
    note "Kept: $DATA (data and backups), $ETC (settings and the admin password), the $SVC_USER user."
    note "To remove those too: sudo bash $0 uninstall --purge"
  fi
}

cmd_status() {
  installed || { echo "Audition isn't installed here."; return; }
  cat "$MARKER"
  echo "release: $(readlink -f "$PREFIX/current")"
  echo "vaultbase: $(readlink -f "$PREFIX/bin/vaultbase")"
  systemctl is-active audition || true
  curl -fsS --noproxy "*" "http://127.0.0.1:$(conf_get PORT)/_/ready" >/dev/null 2>&1 && echo "ready: yes" || echo "ready: no"
}

case "$CMD" in
  install) cmd_install;;
  upgrade) cmd_upgrade;;
  rollback) cmd_rollback;;
  uninstall) cmd_uninstall;;
  status) cmd_status;;
  preflight) run_preflight;;
  proxy) cmd_proxy;;
esac
