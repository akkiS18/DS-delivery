#!/usr/bin/env bash
# Staging watchdog (cron, every 2 minutes, as `deploy`). Checks the stack from the inside and sends ONE Telegram message to the owner when
# something breaks (after 2 consecutive failing runs, so a normal release restart does not alert), a reminder every 6 h while it stays broken,
# and a "recovered" message. It uses the customer bot token from staging.env and WATCHDOG_CHAT_ID (the owner's own Telegram id).
#   watchdog.sh                run the checks (cron)
#   watchdog.sh --dry-run      run the checks, print what would be sent, change nothing
#   watchdog.sh --test-alert   send a test message and exit
# It cannot report a dead VPS: pair it with an external HTTP monitor on https://<domain>/health/live (see docs/STAGE_7C_B2.md).
set -uo pipefail
ROOT=/opt/ds-staging; CONF=$ROOT/config/staging.env; STATE_DIR=$ROOT/watchdog
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1
mkdir -p "$STATE_DIR"
get() { grep -m1 "^$1=" "$CONF" | cut -d= -f2-; }
DOMAIN="$(get STAGING_DOMAIN)"; TOKEN="$(get BOT_TOKEN)"; CHAT="$(get WATCHDOG_CHAT_ID)"

send() { # $1 = text. Token goes to curl through stdin config, never argv.
  if [ "$DRY" = 1 ]; then echo "[dry-run] would send: $1"; return 0; fi
  [ -n "$CHAT" ] && [ -n "$TOKEN" ] || { echo "WATCHDOG_CHAT_ID or BOT_TOKEN missing: cannot alert" >&2; return 1; }
  printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$TOKEN" | curl -sS -f -m 15 -K - -o /dev/null \
    --data-urlencode "chat_id=$CHAT" --data-urlencode "text=$1" || return 1
}
if [ "${1:-}" = "--test-alert" ]; then send "✅ DS staging watchdog: test alert from $(hostname)"; exit $?; fi

problems=()
for c in backend db caddy; do
  s="$(docker inspect -f '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{else}}-{{end}}' "ds-staging-$c-1" 2>/dev/null || echo missing)"
  case "$s" in running/healthy|running/-) ;; *) problems+=("container $c: $s");; esac
done

ready="$(docker exec ds-staging-backend-1 node -e "fetch('http://127.0.0.1:4000/health/ready').then(async r=>{const j=await r.json();console.log(r.status,j.checks?.database,j.checks?.customerBot,j.checks?.taxiBot,j.checks?.gmail)}).catch(()=>console.log('ERR'))" 2>/dev/null || echo ERR)"
set -- $ready
[ "${1:-ERR}" = 200 ] || problems+=("readiness: ${ready:-no answer}")
[ "$(get BOT_ENABLED)" = true ] && [ "${3:-}" != polling ] && problems+=("customer bot not polling")
[ -n "$(get TAXI_BOT_TOKEN)" ] && [ "${4:-}" != polling ] && problems+=("taxi bot not polling")
# Gmail is off on staging ("disabled"); when it is on, a "down" reader means customers' payments stop matching (Stage 8A).
[ "${5:-}" = down ] && problems+=("Gmail reader is down: payments are not matched")

code="$(curl -sS -m 10 -o /dev/null -w '%{http_code}' --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/health/live" 2>/dev/null)"; code="${code:-000}"
[ "$code" = 200 ] || problems+=("HTTPS /health/live via Caddy: $code (TLS or proxy problem)")
end="$(echo | openssl s_client -connect 127.0.0.1:443 -servername "$DOMAIN" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)"
if [ -n "$end" ]; then days=$(( ($(date -d "$end" +%s) - $(date +%s)) / 86400 )); [ "$days" -ge 14 ] || problems+=("TLS certificate expires in $days days"); fi

pct="$(df --output=pcent / | tail -1 | tr -dc 0-9)"; [ "${pct:-0}" -lt 85 ] || problems+=("disk ${pct}% full")
newest="$(ls -1t "$ROOT"/backups/db/*.dump 2>/dev/null | head -1)"
if [ -z "$newest" ] || [ $(( $(date +%s) - $(stat -c %Y "$newest") )) -gt 93600 ]; then problems+=("no database backup newer than 26 h"); fi

now=$(date +%s); status="ok"; [ ${#problems[@]} -gt 0 ] && status="$(printf '%s; ' "${problems[@]}")"
fails=$(cat "$STATE_DIR/fails" 2>/dev/null || echo 0); last="$(cat "$STATE_DIR/last_status" 2>/dev/null || echo ok)"; last_alert=$(cat "$STATE_DIR/last_alert" 2>/dev/null || echo 0)
if [ "$status" = ok ]; then
  if [ "$last" != ok ]; then send "✅ DS staging recovered ($(date -u +%H:%M) UTC)"; fi
  [ "$DRY" = 1 ] && { echo "status: ok"; exit 0; }
  echo 0 > "$STATE_DIR/fails"; echo ok > "$STATE_DIR/last_status"; exit 0
fi
fails=$((fails + 1))
if [ "$DRY" = 1 ]; then echo "status: PROBLEM ($status)"; [ "$fails" -ge 2 ] || echo "(first failing run: a real run would wait for a second one)"; exit 1; fi
echo "$fails" > "$STATE_DIR/fails"
if [ "$fails" -ge 2 ] && { [ "$status" != "$last" ] || [ $((now - last_alert)) -ge 21600 ]; }; then
  send "🚨 DS staging: $status ($(date -u +%H:%M) UTC)" && { echo "$now" > "$STATE_DIR/last_alert"; echo "$status" > "$STATE_DIR/last_status"; }
fi
exit 1
