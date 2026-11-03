#!/usr/bin/env bash
# Puts the Humocard-reader Telegram session into the production `gmail` volume next to the Gmail files (run as `deploy`). The file comes from
# /opt/ds-prod/inbox (uploaded by the owner over SSH/SCP from his own PC, where `npm run humo:login` was done) and is DELETED from the inbox
# afterwards. The session is a FULL login of that Telegram account: treat it like a password. Nothing is printed from the file.
#   scp humo-session.txt ds-staging:/opt/ds-prod/inbox/     (from the PC)
#   DS_ENV=production /opt/ds-prod/current/deploy/bin/install-humo-session.sh
# Second / third / fourth Telegram account (its own Humo cards): the file is humo-session-2.txt (-3, -4) and the argument is the number:
#   DS_ENV=production /opt/ds-prod/current/deploy/bin/install-humo-session.sh 2
# then HUMO_TG_API_ID_2, HUMO_TG_API_HASH_2 and HUMO_TG_SESSION_FILE_2=/app/data/gmail/humo-session-2.txt go into production.env.
set -euo pipefail
. "$(dirname "$(readlink -f "$0")")/../lib/env.sh"
[ "$DS_ENV" = production ] || { echo "production only"; exit 1; }
IN="$ROOT/inbox"
N="${1:-}"
case "$N" in ''|2|3|4) ;; *) echo "account must be empty, 2, 3 or 4"; exit 1;; esac
F="humo-session${N:+-$N}.txt"
[ -s "$IN/$F" ] || { echo "missing $IN/$F"; exit 1; }
docker volume inspect "${PROJECT}_gmail" >/dev/null 2>&1 || docker volume create "${PROJECT}_gmail" >/dev/null
docker run --rm -v "${PROJECT}_gmail:/g" -v "$IN:/in:ro" alpine sh -c \
  "cp /in/$F /g/ && chown 1000:1000 /g/$F && chmod 600 /g/$F && ls -l /g/$F"
shred -u "$IN/$F" 2>/dev/null || rm -f "$IN/$F"
echo "[humo] session installed in volume ${PROJECT}_gmail; inbox cleaned. Add HUMO_TG_ENABLED=true, HUMO_TG_API_ID, HUMO_TG_API_HASH, HUMO_TG_BOT to production.env, then: release.sh restart backend"
