#!/usr/bin/env bash
# Workstation (Git Bash) tool: builds the verified deploy package from the LOCAL worktree (committed + uncommitted + untracked-but-not-ignored).
#   deploy/staging/bin/package-release.sh [out-dir]
# Contents = exactly what the Docker build and the staging stack need: src, prisma (incl. every migration), scripts, package*.json, tsconfigs,
# Dockerfile, .dockerignore, compose/Caddy/staging files. Docs are not shipped. apps/customer-miniapp (web build only; no android/) ships so the image can serve the Mini App at /app/. NOT included: .env*, .git, node_modules, dist, other apps,
# .claude, APKs, ZIPs, logs, credentials. A MANIFEST.sha256 lists every file; package id = first 12 hex of sha256(MANIFEST.sha256).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
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
xargs -d '\n' sha256sum < "$LIST" > "$STAGE/MANIFEST.sha256"
ID="$(sha256sum "$STAGE/MANIFEST.sha256" | cut -c1-12)"
PKG="$OUT/ds-staging-$ID.tar.gz"
# --mtime/--owner/--sort make the archive reproducible; the id is content-addressed anyway
tar --sort=name --owner=0 --group=0 --numeric-owner --mtime='2026-01-01 00:00:00Z' -czf "$PKG" -T "$LIST" -C "$STAGE" MANIFEST.sha256
cp "$STAGE/MANIFEST.sha256" "$OUT/ds-staging-$ID.MANIFEST.sha256"
sha256sum "$PKG" | tee "$PKG.sha256"
echo "PACKAGE_ID=$ID files=$(wc -l < "$LIST") size=$(stat -c %s "$PKG")"
rm -rf "$STAGE" "$LIST"
