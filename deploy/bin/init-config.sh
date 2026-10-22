#!/usr/bin/env bash
# Creates the environment's env file ONCE with random secrets. Never overwrites an existing file. Prints variable names only.
#   staging:     init-config.sh
#   production:  DS_ENV=production init-config.sh <production-domain>      (e.g. api.example.uz)
# Production starts SAFE: bots off, Gmail off, no CONFIRM_REAL_PAYMENTS (the backend refuses to start REAL payments in production without it).
set -euo pipefail
. "$(dirname "$(readlink -f "$0")")/../lib/env.sh"
[ -e "$CONF" ] && { echo "[init-config] $CONF exists: left unchanged"; exit 0; }
umask 077
install -d -m 0700 "$ROOT/config"
hex() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }
if [ "$DS_ENV" = production ]; then
  DOMAIN="${1:?usage: DS_ENV=production init-config.sh <production-domain>}"
  [[ "$DOMAIN" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$ ]] || { echo "bad domain"; exit 1; }
  {
    echo "# production.env - secrets live ONLY here (chmod 600). Names are documented in deploy/production/production.env.example."
    echo "PROD_DOMAIN=$DOMAIN"
    echo "POSTGRES_PASSWORD=$(hex 24)"
    echo "INTERNAL_API_KEY=$(hex 32)"
    echo "SHUTDOWN_TIMEOUT_SECONDS=15"
    echo "BOT_ENABLED=false"
    echo "BOT_TOKEN=100000001:PLACEHOLDER$(hex 16)"
    echo "MINIAPP_ENABLED=true"
    echo "MINIAPP_URL=https://$DOMAIN/app/"
    echo "ANDROID_GUEST_ENABLED=true"
    echo "GUEST_BOOTSTRAP_PER_IP_HOUR=20"
    echo "BOT_PAYMENT_MODE=REAL"
    echo "GMAIL_ENABLED=false"
    echo "GMAIL_FROM=noreply@info.uzcard.uz"
    echo "TAXI_OPERATOR_ALLOWLIST=0"
    echo "RECEIPT_RETENTION_DAYS=365"
  } > "$CONF"
else
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
fi
chmod 600 "$CONF"
echo "[init-config] created $CONF (mode $(stat -c %a "$CONF")); variables: $(cut -d= -f1 "$CONF" | grep -v '^#' | tr '\n' ' ')"
