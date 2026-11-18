#!/usr/bin/env bash
# Einmalige Einrichtung eines frischen Hetzner-Servers (Ubuntu 24.04), als root ausführen.
set -euo pipefail

apt-get update && apt-get -y upgrade
apt-get install -y ca-certificates curl git ufw unattended-upgrades

# Docker
curl -fsSL https://get.docker.com | sh

# Firewall: nur SSH und Web
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# Code holen
mkdir -p /opt && cd /opt
[ -d tree-map ] || git clone https://github.com/Strongbeard-UG/Inception-e-v.git tree-map
cd tree-map

echo
echo "Fertig. Jetzt /opt/tree-map/.env aus .env.example anlegen und ausfüllen, danach:"
echo "  cd /opt/tree-map && docker compose up -d --build"
echo
echo "Nächtlicher Sync (03:00 Uhr Berlin) per crontab -e:"
echo "  0 2 * * * cd /opt/tree-map && docker compose --profile sync run --rm sync >> /var/log/tree-map-sync.log 2>&1"
