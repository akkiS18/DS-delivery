#!/usr/bin/env bash
# ONE-TIME move of the live staging stack from its own Caddy to the shared edge proxy (run as `deploy` on the VPS, from a release that contains deploy/edge).
# Downtime of staging: a few seconds (the old Caddy is stopped, the edge Caddy takes ports 80/443). It needs no new staging release: the running backend is
# attached to the edge network under its new name first. Any failure puts the old Caddy back.
#   deploy/edge/cutover-staging.sh <staging-domain> <production-domain>
# Afterwards the next staging release (compose without its own Caddy) is the normal path; the old Caddy container is removed by that release's `up`.
set -euo pipefail
HERE="$(dirname "$(readlink -f "$0")")"
S="${1:?staging domain}"; P="${2:?production domain}"
OLD=ds-staging-caddy-1; BACKEND=ds-staging-backend-1
docker inspect "$OLD" >/dev/null 2>&1 || { echo "[cutover] $OLD not found: nothing to move (already cut over?)"; exit 1; }
docker inspect "$BACKEND" >/dev/null 2>&1 || { echo "[cutover] $BACKEND not found"; exit 1; }
"$HERE/edge.sh" init "$S" "$P"
# carry the staging IP allowlist over (the old Caddy read it from staging.env)
IPS="$(grep -m1 '^STAGING_ALLOW_IPS=' /opt/ds-staging/config/staging.env | cut -d= -f2-)"
[ -n "$IPS" ] && "$HERE/edge.sh" set STAGING_ALLOW_IPS "$IPS"
# 1. the running backend becomes reachable as staging-backend on the edge network (no restart, no downtime)
docker network inspect ds-edge --format '{{range .Containers}}{{.Name}} {{end}}' | grep -qw "$BACKEND" || docker network connect --alias staging-backend ds-edge "$BACKEND"
# 2. validate the new Caddyfile BEFORE touching the old proxy
docker run --rm -v "$HERE/Caddyfile:/etc/caddy/Caddyfile:ro" -e STAGING_DOMAIN="$S" -e PROD_DOMAIN="$P" -e STAGING_ALLOW_IPS="$IPS" -e PROD_ALLOW_IPS=127.0.0.1 \
  caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile >/dev/null
rollback() { echo "[cutover] FAILED: restoring the old proxy"; docker compose -p ds-edge -f "$HERE/docker-compose.edge.yml" down 2>/dev/null || true; docker start "$OLD" >/dev/null; exit 1; }
# 3. swap the proxies
docker stop "$OLD" >/dev/null
"$HERE/edge.sh" up >/dev/null || rollback
ok=0
for _ in $(seq 1 45); do
  c="$(curl -sS -m 8 -o /dev/null -w '%{http_code}' --resolve "$S:443:127.0.0.1" "https://$S/health/live" 2>/dev/null || true)"
  [ "$c" = 200 ] && { ok=1; break; }; sleep 2
done
[ "$ok" = 1 ] || rollback
echo "[cutover] staging now served by the edge proxy (https://$S/health/live = 200). The old Caddy container is stopped, not removed (rollback: docker compose -p ds-edge down; docker start $OLD)."
