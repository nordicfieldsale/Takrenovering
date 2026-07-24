#!/bin/sh
# Säkerhetskopierar databasen till ./backups och behåller 14 dagar.
# Lägg in i crontab:  0 3 * * *  cd /opt/villa-booking && ./scripts/backup.sh
set -e
cd "$(dirname "$0")/.."
STAMP=$(date +%Y-%m-%d)
docker compose exec -T db pg_dump -U villa villa_booking | gzip > "backups/villa-$STAMP.sql.gz"
find backups -name 'villa-*.sql.gz' -mtime +14 -delete
echo "Säkerhetskopia klar: backups/villa-$STAMP.sql.gz"
