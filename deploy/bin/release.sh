#!/usr/bin/env bash
# Release management (run as the `deploy` user on the VPS) for ONE environment: DS_ENV=staging (default) or DS_ENV=production.
# Layout (deploy/lib/env.sh): $ROOT/{releases/<id>,current,previous,config,backups}.
#   release.sh deploy <package.tar.gz> <package-id>   verify manifest -> extract -> build -> pre-migration dump -> migrate -> up -> health
#   release.sh rollback <package-id>                  restart the app on an earlier, already built release (images stay tagged)
#   release.sh restart [backend|caddy]                recreate one service (apply an env-file change); default backend
#   release.sh status | logs [service]
# <package-id> = first 12 hex chars of sha256(MANIFEST.sha256), printed by the packaging step on the workstation and passed from there.
# Production additionally needs DS_CONFIRM_PRODUCTION=<package-id> (deploy/rollback): a typed confirmation that this really is the production release.
# Never runs `down -v`, `migrate reset` or `migrate dev`.
set -euo pipefail
. "$(dirname "$(readlink -f "$0")")/../lib/env.sh"
[ -f "$CONF" ] || { echo "missing $CONF (run init-config.sh)"; exit 1; }

dc() { DS_RELEASE="$REL" docker compose -p "$PROJECT" -f "$ROOT/releases/$REL/$COMPOSE_REL" --env-file "$CONF" "$@"; }
current_id() { basename "$(readlink -f "$ROOT/current")"; }
# the long-running services of this release (staging still has its own Caddy until the edge cutover; production never does)
app_services() { dc config --services | grep -E '^(backend|caddy)$' | tr '\n' ' '; }
confirm_production() {
  [ "$DS_ENV" = production ] || return 0
  [ "${DS_CONFIRM_PRODUCTION:-}" = "$1" ] || { echo "production: set DS_CONFIRM_PRODUCTION=$1 to confirm this release id"; exit 1; }
}

wait_healthy() {
  local cid; cid="$(dc ps -q backend)"; [ -n "$cid" ] || { echo "backend container missing"; return 1; }
  for _ in $(seq 1 45); do
    s="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid")"
    [ "$s" = healthy ] && { echo "[release] backend healthy"; return 0; }
    [ "$(docker inspect --format '{{.State.Running}}' "$cid")" = true ] || { echo "[release] backend not running"; docker logs --tail 40 "$cid" 2>&1 | sed -E 's#(://[^:/@ ]+:)[^@ ]+@#\1***@#'; return 1; }
    sleep 2
  done
  echo "[release] backend not healthy in 90s"; return 1
}

cmd="${1:-}"; shift || true
case "$cmd" in
  deploy)
    PKG="${1:?package}"; ID="${2:?package id}"
    [[ "$ID" =~ ^[0-9a-f]{12}$ ]] || { echo "bad package id"; exit 1; }
    confirm_production "$ID"
    DEST="$ROOT/releases/$ID"
    if [ ! -d "$DEST" ]; then
      TMP="$(mktemp -d "$ROOT/releases/.incoming.XXXXXX")"
      tar -xzf "$PKG" -C "$TMP"
      [ "$(sha256sum "$TMP/MANIFEST.sha256" | cut -c1-12)" = "$ID" ] || { echo "package id does not match MANIFEST.sha256"; rm -rf "$TMP"; exit 1; }
      (cd "$TMP" && sha256sum --quiet -c MANIFEST.sha256) || { echo "file hash mismatch"; rm -rf "$TMP"; exit 1; }
      mv "$TMP" "$DEST"
      echo "[release] package $ID verified and extracted"
    else echo "[release] $ID already extracted"; fi
    REL="$ID"
    PREV=""; [ -L "$ROOT/current" ] && PREV="$(current_id)"
    echo "[release] building images (tag $ID)"
    dc build migrate backend
    dc up -d db
    for _ in $(seq 1 30); do [ "$(docker inspect --format '{{.State.Health.Status}}' "$(dc ps -q db)" 2>/dev/null)" = healthy ] && break; sleep 2; done
    if [ -n "$PREV" ] && docker exec "$(dc ps -q db)" psql -U ds -d "$DBNAME" -Atc "select to_regclass('_prisma_migrations') is not null" 2>/dev/null | grep -q t; then
      "$(dirname "$(readlink -f "$0")")/backup-db.sh" "pre-migrate-$ID"
    fi
    echo "[release] prisma migrate deploy"
    dc run --rm migrate
    # shellcheck disable=SC2046
    dc up -d $(app_services)
    wait_healthy
    [ -n "$PREV" ] && [ "$PREV" != "$ID" ] && ln -sfn "$ROOT/releases/$PREV" "$ROOT/previous"
    ln -sfn "$DEST" "$ROOT/current"
    echo "[release] current=$ID previous=${PREV:-none}"
    ;;
  rollback)
    ID="${1:?package id}"; REL="$ID"
    confirm_production "$ID"
    [ -d "$ROOT/releases/$ID" ] || { echo "unknown release"; exit 1; }
    docker image inspect "$PROJECT-backend:$ID" >/dev/null || { echo "image $PROJECT-backend:$ID is gone: rebuild with deploy"; exit 1; }
    OLD="$(current_id)"
    # shellcheck disable=SC2046
    dc up -d --no-build $(app_services)
    wait_healthy
    ln -sfn "$ROOT/releases/$OLD" "$ROOT/previous"; ln -sfn "$ROOT/releases/$ID" "$ROOT/current"
    echo "[release] rolled back to $ID (schema is not rolled back: migrations are additive; restore a pre-migrate dump only for a data rollback)"
    ;;
  restart) REL="$(current_id)"; SVC="${1:-backend}"; [[ "$SVC" =~ ^(backend|caddy)$ ]] || { echo "restart backend|caddy"; exit 1; }
           dc up -d --force-recreate --no-deps --no-build "$SVC"; [ "$SVC" = backend ] && wait_healthy || true ;;
  status)  REL="$(current_id)"; echo "env=$DS_ENV current=$REL previous=$( [ -L "$ROOT/previous" ] && basename "$(readlink -f "$ROOT/previous")" || echo none)"; dc ps ;;
  logs)    REL="$(current_id)"; dc logs --no-log-prefix --tail 100 "${1:-backend}" ;;
  *) sed -n 2,11p "$0"; exit 1 ;;
esac
