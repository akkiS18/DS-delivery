#!/usr/bin/env bash
# Proves a dump restores: starts a DISPOSABLE PostgreSQL container (own tmpfs data dir, no volume, no network, removed afterwards), restores the
# dump into a database named ds_delivery_test there and compares per-table row counts with the running staging DB. The live DB is only read.
#   restore-check.sh [dump-file]     default = newest dump
set -euo pipefail
ROOT=/opt/ds-staging
DUMP="${1:-$(ls -1t "$ROOT"/backups/db/*.dump | head -n1)}"
[ -f "$DUMP" ] || { echo "no dump"; exit 1; }
(cd "$(dirname "$DUMP")" && sha256sum --quiet -c "$(basename "$DUMP").sha256") && echo "[restore-check] checksum ok"
LIVE="$(docker ps -q --filter label=com.docker.compose.project=ds-staging --filter label=com.docker.compose.service=db)"
IMG="$(docker inspect --format '{{.Config.Image}}' "$LIVE")"
PW="$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
NAME="ds-restore-check-$$"
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$NAME" --network none --tmpfs /var/lib/postgresql:rw,size=1g -e POSTGRES_USER=ds -e POSTGRES_PASSWORD="$PW" -e POSTGRES_DB=ds_delivery_test "$IMG" >/dev/null
for _ in $(seq 1 40); do docker exec "$NAME" pg_isready -h 127.0.0.1 -U ds -d ds_delivery_test -q 2>/dev/null && break; sleep 1; done
docker exec "$NAME" psql -U ds -d ds_delivery_test -Atc 'select 1' >/dev/null
docker exec -i "$NAME" pg_restore -U ds -d ds_delivery_test --no-owner --no-privileges --exit-on-error < "$DUMP"
counts() { # $1 = container: "table|rowcount" for every user table
  local q
  q="$(docker exec "$1" psql -U ds -d ds_delivery_test -Atc "select string_agg(format('select %L as t, count(*) as n from %I.%I', relname, schemaname, relname), ' union all ' order by relname) from pg_stat_user_tables")"
  docker exec "$1" psql -U ds -d ds_delivery_test -At -c "$q" | sort
}
counts "$NAME" > /tmp/restore_counts.$$
counts "$LIVE" > /tmp/live_counts.$$
TABLES="$(wc -l < /tmp/restore_counts.$$)"
if diff -q /tmp/restore_counts.$$ /tmp/live_counts.$$ >/dev/null; then echo "[restore-check] PASS: $TABLES tables, row counts identical to the live staging DB"; RC=0
else echo "[restore-check] row counts differ (expected only if the app wrote since the dump):"; diff /tmp/restore_counts.$$ /tmp/live_counts.$$ || true; RC=2; fi
echo "[restore-check] migrations in restored copy: $(docker exec "$NAME" psql -U ds -d ds_delivery_test -Atc 'select count(*) from _prisma_migrations where finished_at is not null')"
rm -f /tmp/restore_counts.$$ /tmp/live_counts.$$
exit $RC
