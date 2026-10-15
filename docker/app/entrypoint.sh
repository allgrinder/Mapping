#!/bin/sh
# Start im Container: Speicher vorbereiten, Datenbank einrichten (bin/docker-init.php), dann Apache im Vordergrund.
set -e
S=/app/backend/storage
mkdir -p "$S/cache" "$S/logs" "$S/tiles" "$S/import"
chown -R www-data:www-data "$S"
cd /app/backend
su -s /bin/sh www-data -c "php bin/docker-init.php" || echo "[kritis] Einrichtung mit Fehler beendet – siehe oben. Die Weboberfläche startet trotzdem."
# PLZ-Gebiete aus OpenStreetMap: fehlend → laden, sonst täglich prüfen und nach PLZ_REFRESH_DAYS erneuern (Vorrat bleibt bei Ausfall)
su -s /bin/sh www-data -c 'while true; do php bin/import-plz-osm.php --auto; sleep 86400; done' &
# Live-Warnlage im Hintergrund aktualisieren (unabhängig von Seitenaufrufen)
su -s /bin/sh www-data -c "php bin/warnings-worker.php" &
exec apache2-foreground
