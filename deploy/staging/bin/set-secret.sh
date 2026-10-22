#!/usr/bin/env bash
# Sets or replaces ONE variable in /opt/ds-staging/config/staging.env without echoing the value.
#   interactive (hidden prompt):  ssh -t ds-staging /opt/ds-staging/current/deploy/staging/bin/set-secret.sh BOT_TOKEN
#   non-secret value from argv:   set-secret.sh STAGING_ALLOW_IPS --value "203.0.113.5 198.51.100.7"
# Secret values must NOT be passed on the command line (they would land in shell history and `ps`): use the hidden prompt.
set -euo pipefail
CONF=/opt/ds-staging/config/staging.env
NAME="${1:?usage: set-secret.sh NAME [--value VALUE]}"
[[ "$NAME" =~ ^[A-Z][A-Z0-9_]*$ ]] || { echo "bad variable name"; exit 1; }
if [ "${2:-}" = "--value" ]; then VALUE="${3-}"; else
  read -r -s -p "Value for $NAME (hidden): " VALUE; echo
fi
[ -n "$VALUE" ] || { echo "empty value refused"; exit 1; }
BAD='[$"`\'"'"']'   # characters compose/env parsing would interpret: $ " ` \ '
if [[ "$VALUE" =~ $BAD ]] || [[ "$VALUE" == *$'\n'* ]] || [[ "$VALUE" == *$'\r'* ]] || [[ "$VALUE" == *$'\t'* ]]; then
  echo "value contains a quote, \$, backtick, backslash, tab or newline: refused (compose would interpolate it)"; exit 1
fi
umask 077
TMP="$(mktemp "$CONF.XXXXXX")"
grep -v "^${NAME}=" "$CONF" > "$TMP" || true
printf '%s=%s\n' "$NAME" "$VALUE" >> "$TMP"
chmod 600 "$TMP"; mv "$TMP" "$CONF"
echo "[set-secret] $NAME updated (value not shown). Apply with: release.sh restart [backend|caddy]"
