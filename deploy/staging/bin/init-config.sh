#!/usr/bin/env bash
# Creates /opt/ds-staging/config/staging.env ONCE with random secrets. Never overwrites an existing file. Prints variable names only.
set -euo pipefail
CONF=/opt/ds-staging/config/staging.env
[ -e "$CONF" ] && { echo "[init-config] $CONF exists: left unchanged"; exit 0; }
umask 077
hex() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }
{
  echo "# staging.env - secrets live ONLY here (chmod 600). Names are documented in deploy/staging/staging.env.example."
  echo "STAGING_DOMAIN=staging.sultonxoja.uz"
  echo "STAGING_ALLOW_IPS=127.0.0.1"
  echo "POSTGRES_PASSWORD=$(hex 24)"
  echo "INTERNAL_API_KEY=$(hex 32)"
  echo "SHUTDOWN_TIMEOUT_SECONDS=15"
  echo "MINIAPP_ENABLED=true"
  echo "ANDROID_GUEST_ENABLED=true"
  echo "GUEST_BOOTSTRAP_PER_IP_HOUR=20"
  echo "BOT_ENABLED=false"
  echo "BOT_TOKEN=100000001:PLACEHOLDER$(hex 16)"
  echo "TAXI_OPERATOR_ALLOWLIST=0"
} > "$CONF"
chmod 600 "$CONF"
echo "[init-config] created $CONF (mode $(stat -c %a "$CONF")); variables: $(cut -d= -f1 "$CONF" | grep -v '^#' | tr '\n' ' ')"
