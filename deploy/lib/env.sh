# Sourced by deploy/bin/*.sh. Selects the environment: DS_ENV=staging (default) or DS_ENV=production.
# Staging and production live side by side on ONE VPS and share nothing but the machine and the edge proxy: different directories, compose
# projects, databases, volumes, secrets and Telegram bots. Every script below reads its paths from here, so a command can never reach the
# other environment by a typo in a path.
DS_ENV="${DS_ENV:-staging}"
case "$DS_ENV" in
  staging)
    ROOT=/opt/ds-staging; PROJECT=ds-staging; ENVDIR=staging; CONF_NAME=staging.env
    DBNAME=ds_delivery_test; DOMAIN_VAR=STAGING_DOMAIN; LABEL_TEXT=staging ;;
  production)
    ROOT=/opt/ds-prod; PROJECT=ds-prod; ENVDIR=production; CONF_NAME=production.env
    DBNAME=ds_prod; DOMAIN_VAR=PROD_DOMAIN; LABEL_TEXT=production ;;
  *) echo "DS_ENV must be 'staging' or 'production' (got '$DS_ENV')" >&2; exit 1 ;;
esac
CONF="$ROOT/config/$CONF_NAME"
COMPOSE_REL="deploy/$ENVDIR/docker-compose.$ENVDIR.yml"
BACKUPS="$ROOT/backups/db"
# Names Docker Compose gives the containers of this project.
CTR_DB="$PROJECT-db-1"; CTR_BACKEND="$PROJECT-backend-1"
