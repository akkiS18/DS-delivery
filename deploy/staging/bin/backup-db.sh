#!/usr/bin/env bash
# Custom-format pg_dump of the staging database to /opt/ds-staging/backups/db (mode 700 dir, 600 files), with a SHA-256 and 14-file retention.
#   backup-db.sh [label]      label defaults to "nightly"
# Dumps hold customer phone numbers/addresses even on staging: never commit them, never add them to a source ZIP.
set -euo pipefail
ROOT=/opt/ds-staging; OUT=$ROOT/backups/db; LABEL="${1:-nightly}"
[[ "$LABEL" =~ ^[A-Za-z0-9._-]{1,40}$ ]] || { echo "bad label"; exit 1; }
CID="$(docker ps -q --filter label=com.docker.compose.project=ds-staging --filter label=com.docker.compose.service=db)"
[ -n "$CID" ] || { echo "db container is not running"; exit 1; }
umask 077
F="$OUT/ds_delivery_test-$(date -u +%Y%m%dT%H%M%SZ)-$LABEL.dump"
docker exec "$CID" pg_dump -U ds -d ds_delivery_test -Fc --no-owner > "$F.part"
[ -s "$F.part" ] || { rm -f "$F.part"; echo "empty dump"; exit 1; }
mv "$F.part" "$F"
(cd "$OUT" && sha256sum "$(basename "$F")" > "$(basename "$F").sha256")
echo "[backup] $F ($(stat -c %s "$F") bytes)"
# retention: keep the newest 14 dumps
ls -1t "$OUT"/*.dump 2>/dev/null | tail -n +15 | while read -r old; do rm -f "$old" "$old.sha256"; done
