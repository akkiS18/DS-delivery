#!/usr/bin/env bash
# Compatibility wrapper: the staging command lines keep working. The real script is deploy/bin/backup-db.sh (DS_ENV selects the environment).
exec env DS_ENV=staging "$(dirname "$(readlink -f "$0")")/../../bin/backup-db.sh" "$@"
