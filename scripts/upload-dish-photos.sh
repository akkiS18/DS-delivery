#!/usr/bin/env bash
# Puts dish pictures from a local folder onto PRODUCTION without a release (owner request 2026-11-20).
#   scripts/upload-dish-photos.sh muslima ../DS-backups/muslima-photos          # plan only, writes nothing
#   scripts/upload-dish-photos.sh muslima ../DS-backups/muslima-photos --apply  # write
# File name = dish name (see src/tools/set-dish-photos.ts for the matching and replacing rules).
# The prod container's root is read-only, so the tool and the pictures go to its /tmp (tmpfs, gone after a restart) and import
# the deployed code by absolute /app paths. Needs: ssh alias ds-staging, npx esbuild.
set -euo pipefail
SLUG=${1:?restaurant slug}; DIR=${2:?local picture folder}; shift 2
C=ds-prod-backend-1
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

(cd "$ROOT" && npx esbuild src/tools/set-dish-photos.ts src/tools/dish-photo-match.ts --format=esm --platform=node --target=node20 --outdir="$WORK" --log-level=warning)
sed -i -e 's#from "sharp"#from "/app/node_modules/sharp/dist/index.cjs"#' \
       -e 's#from "\.\./lib/db\.js"#from "/app/dist/src/lib/db.js"#' \
       -e 's#from "\.\./modules/restaurant-catalog/images\.js"#from "/app/dist/src/modules/restaurant-catalog/images.js"#' "$WORK/set-dish-photos.js"
mkdir "$WORK/photos"
find "$DIR" -maxdepth 1 -type f \( -iname '*.webp' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' \) -exec cp {} "$WORK/photos/" \;
tar -C "$WORK" -cf "$WORK/bundle.tar" set-dish-photos.js dish-photo-match.js photos

ssh ds-staging "docker exec -i $C sh -c 'rm -rf /tmp/dish-tool && mkdir -p /tmp/dish-tool && tar -xf - -C /tmp/dish-tool' && docker exec -w /app $C node /tmp/dish-tool/set-dish-photos.js --restaurant '$SLUG' --dir /tmp/dish-tool/photos $*" < "$WORK/bundle.tar"
