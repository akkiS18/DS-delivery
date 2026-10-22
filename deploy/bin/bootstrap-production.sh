#!/usr/bin/env bash
# Prepares the PRODUCTION directories on the existing VPS (run as `deploy`; uses sudo only to create /opt/ds-prod). Idempotent; changes nothing running.
#   bootstrap-production.sh
# Creates /opt/ds-prod/{releases,inbox,config,backups/db,watchdog} with the same permissions as staging. Server preparation itself (Docker, firewall,
# deploy user, ssh hardening) was done once by deploy/staging/bin/bootstrap-server.sh and serves both environments.
set -euo pipefail
sudo install -d -m 0750 -o deploy -g deploy /opt/ds-prod /opt/ds-prod/releases /opt/ds-prod/inbox
sudo install -d -m 0700 -o deploy -g deploy /opt/ds-prod/config /opt/ds-prod/backups /opt/ds-prod/backups/db /opt/ds-prod/watchdog
docker network inspect ds-edge >/dev/null 2>&1 || docker network create ds-edge >/dev/null
echo "[bootstrap-production] ready: $(ls -d /opt/ds-prod/*/ | tr '\n' ' ')"
echo "Next: DS_ENV=production deploy/bin/init-config.sh <production-domain>, then edge.sh init, then the first deploy (docs/RUNBOOK_PRODUCTION.md)."
