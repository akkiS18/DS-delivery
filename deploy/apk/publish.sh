#!/usr/bin/env bash
# Publishes a staff app (restaurant / taxi APK) to the download site (apk.<domain>, served by the edge Caddy from /opt/ds-apk).
#   deploy/apk/publish.sh <restoran|taksi> <file.apk> <versionName> <versionCode>
# The new file replaces the previous one (only the newest version is kept), latest.json is rewritten atomically, and the sha256 is verified after
# the move. Run on the VPS as `deploy`. Version fields are read from the APK by the caller (aapt2) - this script only records them.
set -euo pipefail
APP="${1:?restoran|taksi}"; SRC="${2:?apk file}"; VNAME="${3:?versionName}"; VCODE="${4:?versionCode}"
DIR=/opt/ds-apk
[[ "$APP" =~ ^(restoran|taksi)$ ]] || { echo "app must be restoran or taksi"; exit 1; }
[[ "$VNAME" =~ ^[0-9A-Za-z._-]{1,32}$ && "$VCODE" =~ ^[0-9]{1,9}$ ]] || { echo "bad version"; exit 1; }
[ -f "$SRC" ] || { echo "no such file: $SRC"; exit 1; }
install -d -m 0755 "$DIR" "$DIR/.meta"
SHA="$(sha256sum "$SRC" | cut -d' ' -f1)"; SIZE="$(stat -c %s "$SRC")"; NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
install -m 0644 "$SRC" "$DIR/.$APP.apk.new"
mv -f "$DIR/.$APP.apk.new" "$DIR/$APP.apk"                        # atomic replace: a download in progress keeps the old inode
[ "$(sha256sum "$DIR/$APP.apk" | cut -d' ' -f1)" = "$SHA" ] || { echo "sha256 mismatch after copy"; exit 1; }
printf '"%s":{"version":"%s","versionCode":%s,"size":%s,"sha256":"%s","updatedAt":"%s"}' "$APP" "$VNAME" "$VCODE" "$SIZE" "$SHA" "$NOW" > "$DIR/.meta/$APP.json"
{ printf '{'; first=1
  for a in restoran taksi; do
    [ -f "$DIR/.meta/$a.json" ] || continue
    [ $first = 1 ] || printf ','; first=0; cat "$DIR/.meta/$a.json"
  done; printf '}\n'; } > "$DIR/.latest.json.new"
mv -f "$DIR/.latest.json.new" "$DIR/latest.json"; chmod 0644 "$DIR/latest.json"
echo "[apk] $APP $VNAME ($VCODE) $SIZE bytes sha256=$SHA"
