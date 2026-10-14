#!/bin/sh
# Start im Container: Speicher vorbereiten, Datenbank einrichten (bin/docker-init.php), dann Apache im Vordergrund.
set -e
S=/app/backend/storage
mkdir -p "$S/cache" "$S/logs" "$S/tiles" "$S/import"
chown -R www-data:www-data "$S"
cd /app/backend
su -s /bin/sh www-data -c "php bin/docker-init.php" || echo "[kritis] Einrichtung mit Fehler beendet – siehe oben. Die Weboberfläche startet trotzdem."
exec apache2-foreground
