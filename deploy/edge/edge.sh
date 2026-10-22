#!/usr/bin/env bash
# Edge proxy management (run as `deploy` on the VPS). The edge is shared by staging and production; its config is /opt/ds-edge/config/edge.env.
#   edge.sh init <staging-domain> <production-domain>   create the network, the config (IP gates start closed) and the files directory; changes nothing running
#   edge.sh up                                          start / update the proxy from deploy/edge in this checkout
#   edge.sh reload                                      validate the Caddyfile and reload it without dropping connections
#   edge.sh set NAME "VALUE"                            change a non-secret edge setting (STAGING_ALLOW_IPS, PROD_ALLOW_IPS, domains)
#   edge.sh status
# Opening production to the public = `edge.sh set PROD_ALLOW_IPS "0.0.0.0/0 ::/0"` followed by `edge.sh reload` (do this only on the owner's go).
set -euo pipefail
HERE="$(dirname "$(readlink -f "$0")")"
ROOT=/opt/ds-edge; CONF=$ROOT/config/edge.env
dc() { docker compose -p ds-edge -f "$HERE/docker-compose.edge.yml" "$@"; }
case "${1:-}" in
  init)
    S="${2:?staging domain}"; P="${3:?production domain}"
    re='^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$'
    [[ "$S" =~ $re ]] && [[ "$P" =~ $re ]] || { echo "bad domain"; exit 1; }
    sudo install -d -m 0750 -o deploy -g deploy "$ROOT"; install -d -m 0700 "$ROOT/config"
    docker network inspect ds-edge >/dev/null 2>&1 || docker network create ds-edge >/dev/null
    if [ -e "$CONF" ]; then echo "[edge] $CONF exists: left unchanged"; else
      umask 077
      { echo "STAGING_DOMAIN=$S"; echo "PROD_DOMAIN=$P"
        echo "STAGING_ALLOW_IPS=127.0.0.1"; echo "PROD_ALLOW_IPS=127.0.0.1"; } > "$CONF"
      chmod 600 "$CONF"; echo "[edge] created $CONF"
    fi
    echo "[edge] network ds-edge ready. Copy STAGING_ALLOW_IPS from staging.env with: edge.sh set STAGING_ALLOW_IPS \"...\""
    ;;
  up) [ -f "$CONF" ] || { echo "run: edge.sh init <staging-domain> <production-domain>"; exit 1; }; dc up -d caddy; dc ps ;;
  reload) dc exec -T caddy caddy validate --config /etc/caddy/Caddyfile && dc exec -T caddy caddy reload --config /etc/caddy/Caddyfile ;;
  set)
    NAME="${2:?name}"; VALUE="${3:?value}"
    [[ "$NAME" =~ ^(STAGING_DOMAIN|PROD_DOMAIN|STAGING_ALLOW_IPS|PROD_ALLOW_IPS)$ ]] || { echo "only STAGING_DOMAIN PROD_DOMAIN STAGING_ALLOW_IPS PROD_ALLOW_IPS"; exit 1; }
    [[ "$VALUE" =~ ^[A-Za-z0-9.:/\ -]+$ ]] || { echo "value may contain only letters, digits, . : / - and spaces"; exit 1; }
    umask 077; TMP="$(mktemp "$CONF.XXXXXX")"
    grep -v "^${NAME}=" "$CONF" > "$TMP" || true; printf '%s=%s\n' "$NAME" "$VALUE" >> "$TMP"; chmod 600 "$TMP"; mv "$TMP" "$CONF"
    echo "[edge] $NAME updated. Apply with: edge.sh up   (the env file is read at container creation; a plain reload does not re-read it)"
    ;;
  status) dc ps; docker network inspect ds-edge --format '{{range .Containers}}{{.Name}} {{end}}' ;;
  *) sed -n 2,10p "$0"; exit 1 ;;
esac
