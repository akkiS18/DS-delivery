#!/usr/bin/env bash
# Puts the Gmail OAuth files into the production `gmail` volume (run as `deploy`). Files come from /opt/ds-prod/inbox (uploaded by the owner over SSH/SCP
# from his own PC, where the OAuth consent was done) and are DELETED from the inbox afterwards. Nothing is printed from the files.
#   scp credentials.json gmail-token.json ds-staging:/opt/ds-prod/inbox/     (from the PC)
#   DS_ENV=production /opt/ds-prod/current/deploy/bin/install-gmail-files.sh
set -euo pipefail
. "$(dirname "$(readlink -f "$0")")/../lib/env.sh"
[ "$DS_ENV" = production ] || { echo "production only"; exit 1; }
IN="$ROOT/inbox"
for f in credentials.json gmail-token.json; do [ -s "$IN/$f" ] || { echo "missing $IN/$f"; exit 1; }; done
command -v python3 >/dev/null && { python3 -c "import json,sys; [json.load(open(sys.argv[1]+'/'+n)) for n in ('credentials.json','gmail-token.json')]" "$IN" || { echo "the files are not valid JSON"; exit 1; }; }
docker volume inspect "${PROJECT}_gmail" >/dev/null 2>&1 || docker volume create "${PROJECT}_gmail" >/dev/null
docker run --rm -v "${PROJECT}_gmail:/g" -v "$IN:/in:ro" alpine sh -c \
  'cp /in/credentials.json /in/gmail-token.json /g/ && chown 1000:1000 /g/credentials.json /g/gmail-token.json && chmod 600 /g/credentials.json /g/gmail-token.json && ls -l /g'
shred -u "$IN/credentials.json" "$IN/gmail-token.json" 2>/dev/null || rm -f "$IN/credentials.json" "$IN/gmail-token.json"
echo "[gmail] installed in volume ${PROJECT}_gmail; inbox cleaned. Set GMAIL_ENABLED=true, then: release.sh restart backend; check /health/ready -> gmail: ok"
