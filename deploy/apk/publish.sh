#!/usr/bin/env bash
# Publishes a staff app (restaurant / taxi APK, or the Windows setup program of either) to the download site (apk.<domain>, served by the edge Caddy
# from /opt/ds-apk).
#   deploy/apk/publish.sh <restoran|taksi> <file.apk> <versionName> <versionCode>
#   deploy/apk/publish.sh <restoran-windows|taksi-windows> <setup.exe> <versionName>      (versionCode is 0: Windows programs have none)
# The new file replaces the previous one (only the newest version is kept), latest.json is rewritten atomically, and the sha256 is verified after
# the move. Run on the VPS as `deploy`. Version fields are read from the APK by the caller (aapt2) - this script only records them.
set -euo pipefail
APP="${1:?restoran|taksi|restoran-windows|taksi-windows}"; SRC="${2:?file}"; VNAME="${3:?versionName}"
DIR=/opt/ds-apk
case "$APP" in
  restoran|taksi) EXT=apk; VCODE="${4:?versionCode}" ;;
  restoran-windows|taksi-windows) EXT=exe; VCODE="${4:-0}" ;;
  *) echo "app must be restoran, taksi, restoran-windows or taksi-windows"; exit 1 ;;
esac
[[ "$SRC" == *."$EXT" ]] || { echo "expected a .$EXT file"; exit 1; }
[[ "$VNAME" =~ ^[0-9A-Za-z._-]{1,32}$ && "$VCODE" =~ ^[0-9]{1,9}$ ]] || { echo "bad version"; exit 1; }
[ -f "$SRC" ] || { echo "no such file: $SRC"; exit 1; }
[[ "$EXT" = apk ]] || [ "$(head -c 2 "$SRC")" = "MZ" ] || { echo "not a Windows program (no MZ header)"; exit 1; }
install -d -m 0755 "$DIR" "$DIR/.meta"
SHA="$(sha256sum "$SRC" | cut -d' ' -f1)"; SIZE="$(stat -c %s "$SRC")"; NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
install -m 0644 "$SRC" "$DIR/.$APP.$EXT.new"
mv -f "$DIR/.$APP.$EXT.new" "$DIR/$APP.$EXT"                        # atomic replace: a download in progress keeps the old inode
[ "$(sha256sum "$DIR/$APP.$EXT" | cut -d' ' -f1)" = "$SHA" ] || { echo "sha256 mismatch after copy"; exit 1; }
printf '"%s":{"version":"%s","versionCode":%s,"size":%s,"sha256":"%s","updatedAt":"%s"}' "$APP" "$VNAME" "$VCODE" "$SIZE" "$SHA" "$NOW" > "$DIR/.meta/$APP.json"
{ printf '{'; first=1
  for a in restoran taksi restoran-windows taksi-windows; do
    [ -f "$DIR/.meta/$a.json" ] || continue
    [ $first = 1 ] || printf ','; first=0; cat "$DIR/.meta/$a.json"
  done; printf '}\n'; } > "$DIR/.latest.json.new"
mv -f "$DIR/.latest.json.new" "$DIR/latest.json"; chmod 0644 "$DIR/latest.json"
echo "[apk] $APP $VNAME ($VCODE) $SIZE bytes sha256=$SHA"
