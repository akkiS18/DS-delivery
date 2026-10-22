#!/usr/bin/env bash
# Stage 7C-B2: idempotent staging host preparation. Run as root on the VPS AFTER inspecting it (see docs/STAGE_7C_B2.md section 3).
# Usage: sudo bash bootstrap-server.sh /path/to/deploy_user_public_key.pub
# It never removes anything: it installs Docker Engine + Compose plugin, creates the `deploy` user, directories, Docker log rotation and the
# firewall (current SSH port + 80/443 only). It does NOT touch sshd_config (hardening is a separate, tested step).
set -euo pipefail
PUBKEY_FILE="${1:?usage: bootstrap-server.sh <public-key-file>}"
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
grep -q '^ssh-ed25519 ' "$PUBKEY_FILE" || { echo "not an ed25519 public key"; exit 1; }
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a

SSH_PORT="$(sshd -T 2>/dev/null | awk '/^port /{print $2; exit}')"
SSH_PORT="${SSH_PORT:-22}"
echo "[bootstrap] SSH port kept open: $SSH_PORT"

apt-get update -y
apt-get -y -o Dpkg::Options::=--force-confold upgrade
apt-get install -y --no-install-recommends ca-certificates curl gnupg ufw
# One clock for host and containers: UTC (the Asia/Tashkent restaurant rules are explicit in the application code, not taken from the host zone).
timedatectl set-timezone UTC
# Docker Engine from Docker's official apt repository
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
# Log rotation for every container, unless an admin already configured the daemon (then stop and look).
if [ ! -s /etc/docker/daemon.json ]; then
  install -d -m 0755 /etc/docker
  cat > /etc/docker/daemon.json <<'JSON'
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "5" }, "live-restore": true }
JSON
  systemctl restart docker
else
  echo "[bootstrap] /etc/docker/daemon.json already exists: left unchanged, review it by hand"
fi
systemctl enable --now docker containerd

# deploy user: key-only, docker group, passwordless sudo (the box is single-purpose staging)
id deploy >/dev/null 2>&1 || adduser --disabled-password --gecos "DS staging deploy" deploy
usermod -aG docker deploy
install -d -m 0700 -o deploy -g deploy /home/deploy/.ssh
touch /home/deploy/.ssh/authorized_keys
grep -qF "$(cut -d' ' -f2 "$PUBKEY_FILE")" /home/deploy/.ssh/authorized_keys || cat "$PUBKEY_FILE" >> /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys; chmod 600 /home/deploy/.ssh/authorized_keys
echo 'deploy ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/90-deploy; chmod 440 /etc/sudoers.d/90-deploy; visudo -cf /etc/sudoers.d/90-deploy

install -d -m 0750 -o deploy -g deploy /opt/ds-staging /opt/ds-staging/releases /opt/ds-staging/inbox
install -d -m 0700 -o deploy -g deploy /opt/ds-staging/config /opt/ds-staging/backups /opt/ds-staging/backups/db

# Firewall: keep SSH, open HTTP/HTTPS. PostgreSQL 5432 and backend 4000 are not published by compose at all (Docker bypasses ufw for published ports).
ufw default deny incoming
ufw default allow outgoing
ufw limit "${SSH_PORT}/tcp"
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status verbose
docker --version; docker compose version
echo "[bootstrap] done"
