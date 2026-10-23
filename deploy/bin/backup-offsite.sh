#!/usr/bin/env bash
# Encrypts the newest backup set and copies it OFF this server (run after backup-db.sh, from the same cron entry).
#   [DS_ENV=production] backup-offsite.sh
# Needs on the host: `age` (https://age-encryption.org) and, for the remote copy, `rclone`. Settings in the environment's env file ($ROOT/config/<env>.env):
#   BACKUP_AGE_RECIPIENT=age1...       the owner's PUBLIC key. The private key never touches the server: only the owner can decrypt.
#   OFFSITE_RCLONE_REMOTE=name:bucket/path   an rclone remote (its credentials live in $ROOT/config/rclone.conf, mode 600, created by the owner)
# Without BACKUP_AGE_RECIPIENT nothing is uploaded (the script says so and exits 0): plaintext never leaves the server.
# Every file is encrypted BEFORE upload: the database dump (customer phones/addresses), the receipt photos (bank details) and the Gmail token archive.
# Decrypt on the owner's PC:  age -d -i <private-key-file> -o restored.dump <file>.age
set -euo pipefail
. "$(dirname "$(readlink -f "$0")")/../lib/env.sh"
get() { { grep -m1 "^$1=" "$CONF" || true; } | cut -d= -f2-; }   # a setting that is not there yet (no bucket) is empty, not a pipefail exit
RECIPIENT="$(get BACKUP_AGE_RECIPIENT)"; REMOTE="$(get OFFSITE_RCLONE_REMOTE)"
[ -n "$RECIPIENT" ] || { echo "[offsite] BACKUP_AGE_RECIPIENT is not set: nothing is uploaded"; exit 0; }
[[ "$RECIPIENT" =~ ^age1[a-z0-9]{50,}$ ]] || { echo "[offsite] BACKUP_AGE_RECIPIENT is not an age public key"; exit 1; }
command -v age >/dev/null || { echo "[offsite] age is not installed (sudo apt-get install -y age)"; exit 1; }
if [ -n "$REMOTE" ]; then command -v rclone >/dev/null || { echo "[offsite] rclone is not installed (sudo apt-get install -y rclone)"; exit 1; }; fi
STATE="$ROOT/backups/offsite.done"; touch "$STATE"
ENC="$ROOT/backups/offsite"; install -d -m 0700 "$ENC"
umask 077
newest() { ls -1t "$BACKUPS"/$1 2>/dev/null | head -1; }
status=0
for f in "$(newest '*.dump')" "$(newest 'receipts-*.tar')" "$(newest 'gmail-*.tar')"; do
  [ -n "$f" ] && [ -f "$f" ] || continue
  name="$(basename "$f")"
  grep -qxF "$name" "$STATE" && continue
  age -r "$RECIPIENT" -o "$ENC/$name.age" "$f"
  if [ -n "$REMOTE" ]; then
    RCLONE_CONFIG="$ROOT/config/rclone.conf" rclone copyto "$ENC/$name.age" "$REMOTE/$DS_ENV/$name.age" --immutable || { echo "[offsite] upload failed: $name"; status=1; continue; }
    RCLONE_CONFIG="$ROOT/config/rclone.conf" rclone check "$ENC" "$REMOTE/$DS_ENV" --include "$name.age" --one-way >/dev/null || { echo "[offsite] verification failed: $name"; status=1; continue; }
  fi
  echo "$name" >> "$STATE"
  echo "[offsite] $name -> encrypted$( [ -n "$REMOTE" ] && echo " and uploaded to $REMOTE/$DS_ENV")"
done
# keep the newest 14 encrypted files locally (the remote keeps its own, longer history: set a lifecycle rule on the bucket)
{ ls -1t "$ENC"/*.age 2>/dev/null || true; } | tail -n +15 | while read -r old; do rm -f "$old"; done
date -u +%s > "$ROOT/backups/offsite.last"
exit $status
