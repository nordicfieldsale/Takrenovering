#!/bin/sh
# Hämtar senaste koden och startar om utan driftstopp värt namnet.
set -e
cd "$(dirname "$0")/.."
./scripts/backup.sh || true
docker compose build
docker compose up -d
docker image prune -f
echo "Uppdaterat."
