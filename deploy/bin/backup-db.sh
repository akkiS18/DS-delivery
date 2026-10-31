#!/usr/bin/env bash
# Custom-format pg_dump of the environment's database to $ROOT/backups/db (mode 700 dir, 600 files), with a SHA-256 and a retention per kind.
#   [DS_ENV=production] backup-db.sh [label]      label defaults to "nightly"; "hourly" is the hourly safety copy (owner 2026-10-31)
# Retention: the newest 48 "hourly" sets (two days) and, separately, the newest 14 of every other label (nightly, pre-migrate-*, ...), so a run
# every hour can never push the nightly or pre-migration copies out.
# What is archived next to the dump (a restore needs every half): the refund receipt photos and, in production, the Gmail OAuth token volume.
# Dumps hold customer phone numbers/addresses: never commit them, never add them to a source ZIP.
set -euo pipefail
. "$(dirname "$(readlink -f "$0")")/../lib/env.sh"
OUT="$BACKUPS"; LABEL="${1:-nightly}"
[[ "$LABEL" =~ ^[A-Za-z0-9._-]{1,40}$ ]] || { echo "bad label"; exit 1; }
mkdir -p "$OUT"
CID="$(docker ps -q --filter label=com.docker.compose.project="$PROJECT" --filter label=com.docker.compose.service=db)"
[ -n "$CID" ] || { echo "db container is not running"; exit 1; }
umask 077
STAMP="$(date -u +%Y%m%dT%H%M%SZ)-$LABEL"
F="$OUT/$DBNAME-$STAMP.dump"
docker exec "$CID" pg_dump -U ds -d "$DBNAME" -Fc --no-owner > "$F.part"
[ -s "$F.part" ] || { rm -f "$F.part"; echo "empty dump"; exit 1; }
mv "$F.part" "$F"
(cd "$OUT" && sha256sum "$(basename "$F")" > "$(basename "$F").sha256")
echo "[backup] $F ($(stat -c %s "$F") bytes)"
# Files that live in volumes, not in PostgreSQL: archive them with the same timestamp/label.
BID="$(docker ps -q --filter label=com.docker.compose.project="$PROJECT" --filter label=com.docker.compose.service=backend)"
archive() { # $1 = directory name under /app/data, $2 = file prefix
  if [ -n "$BID" ] && docker exec "$BID" test -d "/app/data/$1"; then
    local A="$OUT/$2-$STAMP.tar"
    docker exec "$BID" tar -C /app/data -cf - "$1" > "$A.part" && mv "$A.part" "$A"
    (cd "$OUT" && sha256sum "$(basename "$A")" > "$(basename "$A").sha256")
    echo "[backup] $A ($(stat -c %s "$A") bytes, $(docker exec "$BID" sh -c "ls /app/data/$1 | wc -l") files)"
  else echo "[backup] no $1 volume yet (nothing to archive)"; fi
}
archive receipts receipts
[ "$DS_ENV" = production ] && archive gmail gmail   # contains the OAuth token: the archive is as sensitive as the mailbox (encrypted before it leaves the server)
# retention: hourly sets and all other sets are counted separately (the label is the last part of the name: <stamp>-<label>.<ext>)
prune() { # $1 = file pattern, $2 = hourly|other, $3 = how many to keep
  { ls -1t "$OUT"/$1 2>/dev/null || true; } \
    | { if [ "$2" = hourly ]; then grep -- '-hourly\.' || true; else grep -v -- '-hourly\.' || true; fi; } \
    | tail -n +"$(( $3 + 1 ))" | while read -r old; do rm -f "$old" "$old.sha256" "$old.age"; done
}
for pat in '*.dump' 'receipts-*.tar' 'gmail-*.tar'; do
  prune "$pat" hourly 48
  prune "$pat" other 14
done
