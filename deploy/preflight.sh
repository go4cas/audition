#!/usr/bin/env bash
# Audition pre-flight: reads the server and reports what an Audition install
# would meet there. It never changes anything: no installs, no writes, no
# service or firewall changes, no files created (not even temporary ones).
#
#   bash preflight.sh [port] [domain]          # e.g. bash preflight.sh 8091 audition.example.com
#   sudo bash preflight.sh [port] [domain]     # same, but also sees other users' processes and the firewall
#
# Paste the whole output into the Audition thread. Lines start with
#   OK    nothing in the way
#   WARN  something Audition would collide with or change; decide before installing
#   INFO  context about the server
set -u

PORT="${1:-8091}"
DOMAIN="${2:-}"
ok()   { printf 'OK    %s\n' "$*"; }
warn() { printf 'WARN  %s\n' "$*"; }
info() { printf 'INFO  %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }
section() { printf '\n== %s ==\n' "$*"; }

section "Machine"
info "host $(hostname), user $(id -un)$([ "$(id -u)" = 0 ] && echo ' (root: full view)' || echo ' (not root: some checks are partial)')"
[ -r /etc/os-release ] && info "os $(. /etc/os-release; echo "$PRETTY_NAME")"
info "kernel $(uname -r), arch $(uname -m), $(nproc 2>/dev/null || echo '?') CPUs"
have systemctl && info "systemd $(systemctl --version 2>/dev/null | head -1 | awk '{print $2}')"
have free && info "memory: $(free -h | awk '/^Mem:/{print $2" total, "$7" available"}'); swap: $(free -h | awk '/^Swap:/{print $2}')"
for p in / /opt /var/lib /srv /etc; do
  [ -d "$p" ] && info "disk $p: $(df -h --output=avail,pcent "$p" 2>/dev/null | tail -1 | awk '{print $1" free, "$2" used"}')"
done

section "Names Audition would use"
if getent passwd audition >/dev/null; then warn "user 'audition' already exists: $(getent passwd audition)"; else ok "no user 'audition'"; fi
if getent group audition >/dev/null; then warn "group 'audition' already exists"; else ok "no group 'audition'"; fi
for p in /opt/audition /var/lib/audition /var/lib/audition-rollback /etc/audition /etc/caddy/sites/audition.caddy /etc/nginx/sites-available/audition.conf /etc/nginx/conf.d/audition.conf; do
  if [ -e "$p" ]; then warn "$p already exists"; else ok "$p is free"; fi
done
for u in audition.service; do
  if systemctl list-unit-files "$u" 2>/dev/null | grep -q "^$u"; then warn "systemd unit $u already exists"; else ok "no systemd unit $u"; fi
done

section "Shared tools (the installer uses none of them and changes none)"
for b in bun vaultbase caddy node docker git curl; do
  if have "$b"; then
    v=$("$b" --version 2>/dev/null | head -1 | cut -c1-60)
    info "$b on PATH: $(command -v "$b") ${v:+($v)}"
  else
    info "$b not on PATH"
  fi
done
ls -d /usr/local/lib/vaultbase* /opt/*/vaultbase* 2>/dev/null | sed 's/^/INFO  other Vaultbase install: /'
if have pgrep; then
  pgrep -a vaultbase 2>/dev/null | sed 's/^/INFO  running Vaultbase: /'
  pgrep -a bun 2>/dev/null | sed 's/^/INFO  running Bun: /'
fi

section "Ports"
if have ss; then
  if ss -Hltn "sport = :$PORT" 2>/dev/null | grep -q .; then
    warn "port $PORT is taken: $(ss -Hltnp "sport = :$PORT" 2>/dev/null | awk '{print $4, $6}' | head -3 | tr '\n' ' ')"
  else
    ok "port $PORT is free"
  fi
  info "everything listening on TCP (address, process):"
  ss -Hltnp 2>/dev/null | awk '{print "        " $4, $6}' | sort -u
else
  info "ss not found; cannot list ports"
fi

section "Reverse proxy and TLS"
for s in caddy nginx apache2 httpd traefik haproxy cloudflared; do
  st=$(systemctl is-active "$s" 2>/dev/null)
  [ "$st" = active ] && info "service $s is running"
done
if have ss; then
  for p in 80 443; do
    w=$(ss -Hltnp "sport = :$p" 2>/dev/null | awk '{print $6}' | head -1)
    [ -n "$w" ] && info "port $p is held by: $w" || info "port $p: nothing listening (or not visible without root)"
  done
fi
if [ -f /etc/caddy/Caddyfile ]; then
  info "Caddyfile site blocks and imports (the installer adds a site file to an imported folder, never edits this file):"
  grep -nE '^[^#[:space:]][^{]*\{|^\s*import\s' /etc/caddy/Caddyfile 2>/dev/null | sed 's/^/        /'
  grep -qE '^[[:space:]]*import[[:space:]]+[^[:space:]]*\*' /etc/caddy/Caddyfile 2>/dev/null \
    || warn "the Caddyfile imports no folder of site files: the installer will prepare Audition's site file and print the one line to add"
fi
ls /etc/caddy/*.pem 2>/dev/null | sed 's/^/INFO  cert in \/etc\/caddy: /'
[ -d /etc/nginx/sites-enabled ] && info "nginx sites-enabled: $(ls /etc/nginx/sites-enabled 2>/dev/null | tr '\n' ' ')"
[ -d /etc/nginx/conf.d ] && info "nginx conf.d: $(ls /etc/nginx/conf.d 2>/dev/null | tr '\n' ' ')"
[ -d /etc/cloudflared ] && info "cloudflared config: $(ls /etc/cloudflared 2>/dev/null | tr '\n' ' ')"
[ -d /etc/letsencrypt/live ] && info "Let's Encrypt certs: $(ls /etc/letsencrypt/live 2>/dev/null | grep -v README | tr '\n' ' ')"

section "Containers"
if have docker; then
  if docker ps --format '{{.Names}}  {{.Image}}  {{.Ports}}' >/dev/null 2>&1; then
    info "running containers:"
    docker ps --format '        {{.Names}}  {{.Image}}  {{.Ports}}'
  else
    info "docker present; cannot list containers (needs root or the docker group, or the daemon is stopped)"
  fi
else
  info "no docker"
fi

section "Firewall"
if have ufw; then
  if [ "$(id -u)" = 0 ]; then ufw status verbose 2>/dev/null | sed 's/^/        /'; else info "ufw present; run with sudo to see its rules"; fi
fi
if have nft && [ "$(id -u)" = 0 ]; then
  info "nftables tables: $(nft list tables 2>/dev/null | tr '\n' ' ')"
fi
have firewall-cmd && info "firewalld present: $(firewall-cmd --state 2>/dev/null)"

section "Other apps (systemd services not from the OS)"
systemctl list-units --type=service --state=running --no-legend 2>/dev/null \
  | awk '{print $1}' \
  | while read -r u; do
      f=$(systemctl show -p FragmentPath --value "$u" 2>/dev/null)
      case "$f" in /etc/systemd/system/*) echo "INFO  $u ($f)";; esac
    done
info "cron.d entries: $(ls /etc/cron.d 2>/dev/null | tr '\n' ' ')"

if [ -n "$DOMAIN" ]; then
  section "Domain $DOMAIN"
  r=$(getent ahosts "$DOMAIN" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ')
  [ -n "$r" ] && info "$DOMAIN resolves to: $r" || info "$DOMAIN does not resolve yet"
fi

printf '\nDone. Nothing was changed.\n'
