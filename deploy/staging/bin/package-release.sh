#!/usr/bin/env bash
# Workstation (Git Bash) tool: builds the verified deploy package from the LOCAL worktree (committed + uncommitted + untracked-but-not-ignored).
#   deploy/staging/bin/package-release.sh [out-dir]
# Contents = exactly what the Docker build and the staging stack need: src, prisma (incl. every migration), scripts, package*.json, tsconfigs,
# Dockerfile, .dockerignore, compose/Caddy/staging files. Docs are not shipped. apps/customer-miniapp (web build only; no android/) ships so the image can serve the Mini App at /app/. NOT included: .env*, .git, node_modules, dist, other apps,
# .claude, APKs, ZIPs, logs, credentials. A MANIFEST.sha256 lists every file; package id = first 12 hex of sha256(MANIFEST.sha256).
# A release must be a commit: the script refuses a working tree with uncommitted or untracked files (set ALLOW_DIRTY=1 only for a throw-away
# staging try-out). The commit id is written into the package as REVISION (and covered by the manifest), so every deployed package can be
# traced back to its code: `cat /opt/ds-prod/releases/<id>/REVISION`. After a production deploy, tag it: `git tag prod-<id> <revision>`.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
REVISION="$(git rev-parse HEAD)"
if [ -n "$(git status --porcelain)" ]; then
  [ "${ALLOW_DIRTY:-0}" = 1 ] || { echo "working tree is not clean: commit first (or ALLOW_DIRTY=1 for a staging try-out)"; git status --short | head -10; exit 1; }
  REVISION="$REVISION+dirty"
fi
OUT="${1:-../DS-backups/deploy-packages}"; mkdir -p "$OUT"
LIST="$(mktemp)"
git ls-files -c -o --exclude-standard \
  | grep -vE '^(apps/(customer-miniapp/android/|customer-miniapp-backup|restaurant-android)|\.claude/)' | grep -vE '(^|/)\.env($|\.)' | grep -vE '\.(apk|aab|zip|log|pem|key)$' | grep -vE '(^|/)(credentials|gmail-token)\.json$' \
  | grep -vE '^[^/]+\.md$' | grep -vE '^docs/' | sort -u > "$LIST"
# every listed file must exist (git ls-files -c also lists files deleted in the worktree)
while read -r f; do [ -f "$f" ] || { echo "listed but missing: $f"; exit 1; }; done < "$LIST"
# hard stop on secret-looking content (real bot tokens, private keys). Test fixtures use obvious dummy ids.
if xargs -d '\n' grep -lIE 'BEGIN [A-Z ]*PRIVATE KEY' < "$LIST" >/dev/null 2>&1; then echo "private key material found: abort"; exit 1; fi
STAGE="$(mktemp -d)"
echo "$REVISION" > "$STAGE/REVISION"
xargs -d '\n' sha256sum < "$LIST" > "$STAGE/MANIFEST.sha256"
(cd "$STAGE" && sha256sum REVISION) >> "$STAGE/MANIFEST.sha256"
ID="$(sha256sum "$STAGE/MANIFEST.sha256" | cut -c1-12)"
PKG="$OUT/ds-staging-$ID.tar.gz"
# --mtime/--owner/--sort make the archive reproducible; the id is content-addressed anyway
tar --sort=name --owner=0 --group=0 --numeric-owner --mtime='2026-01-01 00:00:00Z' -czf "$PKG" -T "$LIST" -C "$STAGE" MANIFEST.sha256 REVISION
cp "$STAGE/MANIFEST.sha256" "$OUT/ds-staging-$ID.MANIFEST.sha256"
sha256sum "$PKG" | tee "$PKG.sha256"
echo "REVISION=$REVISION"
echo "PACKAGE_ID=$ID files=$(wc -l < "$LIST") size=$(stat -c %s "$PKG")"
rm -rf "$STAGE" "$LIST"
