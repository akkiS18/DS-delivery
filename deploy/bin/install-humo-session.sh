#!/usr/bin/env bash
# Puts the Humocard-reader Telegram session into the production `gmail` volume next to the Gmail files (run as `deploy`). The file comes from
# /opt/ds-prod/inbox (uploaded by the owner over SSH/SCP from his own PC, where `npm run humo:login` was done) and is DELETED from the inbox
# afterwards. The session is a FULL login of that Telegram account: treat it like a password. Nothing is printed from the file.
#   scp humo-session.txt ds-staging:/opt/ds-prod/inbox/     (from the PC)
#   DS_ENV=production /opt/ds-prod/current/deploy/bin/install-humo-session.sh
set -euo pipefail
. "$(dirname "$(readlink -f "$0")")/../lib/env.sh"
[ "$DS_ENV" = production ] || { echo "production only"; exit 1; }
IN="$ROOT/inbox"
[ -s "$IN/humo-session.txt" ] || { echo "missing $IN/humo-session.txt"; exit 1; }
docker volume inspect "${PROJECT}_gmail" >/dev/null 2>&1 || docker volume create "${PROJECT}_gmail" >/dev/null
docker run --rm -v "${PROJECT}_gmail:/g" -v "$IN:/in:ro" alpine sh -c \
  'cp /in/humo-session.txt /g/ && chown 1000:1000 /g/humo-session.txt && chmod 600 /g/humo-session.txt && ls -l /g/humo-session.txt'
shred -u "$IN/humo-session.txt" 2>/dev/null || rm -f "$IN/humo-session.txt"
echo "[humo] session installed in volume ${PROJECT}_gmail; inbox cleaned. Add HUMO_TG_ENABLED=true, HUMO_TG_API_ID, HUMO_TG_API_HASH, HUMO_TG_BOT to production.env, then: release.sh restart backend"
