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
# Refund receipt photos live in a volume, not in PostgreSQL: archive them next to the dump (same timestamp/label), so a restore has both halves.
BID="$(docker ps -q --filter label=com.docker.compose.project=ds-staging --filter label=com.docker.compose.service=backend)"
if [ -n "$BID" ] && docker exec "$BID" test -d /app/data/receipts; then
  R="$OUT/receipts-$(basename "$F" | sed -E 's/^ds_delivery_test-//; s/.dump$//').tar"
  docker exec "$BID" tar -C /app/data -cf - receipts > "$R.part" && mv "$R.part" "$R"
  (cd "$OUT" && sha256sum "$(basename "$R")" > "$(basename "$R").sha256")
  echo "[backup] $R ($(stat -c %s "$R") bytes, $(docker exec "$BID" sh -c 'ls /app/data/receipts | wc -l') receipt files)"
else echo "[backup] no receipts volume yet (nothing to archive)"; fi
# retention: keep the newest 14 dumps and 14 receipt archives
ls -1t "$OUT"/*.dump 2>/dev/null | tail -n +15 | while read -r old; do rm -f "$old" "$old.sha256"; done
ls -1t "$OUT"/receipts-*.tar 2>/dev/null | tail -n +15 | while read -r old; do rm -f "$old" "$old.sha256"; done
