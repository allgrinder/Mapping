# KRITIS-Lagekarte NRW

Interaktive Karte krisenrelevanter Einrichtungen in NRW. Planung: [docs/UMSETZUNGSPLAN.md](docs/UMSETZUNGSPLAN.md).

**Stand:** Stufe 1, Arbeitspakete 1–2: Backend-Gerüst, Anmeldung mit Initialpasswort-Wechsel, Sitzungen, CSRF, Rollen; Administration (Benutzer, Kategorien, Krisenszenarien) mit Oberfläche nach UI-Design. Arbeitspaket 3: Grenzimport, Karte (OpenLayers, EPSG:25832) mit Hintergründen, Grenz-/PLZ-Ebenen, Legende und Leerzustand. Arbeitspaket 4: Einrichtungen anlegen/bearbeiten/löschen mit Adresssuche, verschiebbarem Marker, automatischer Gebietszuordnung, kombinierbaren Filtern, Trefferliste, Clustering und Detailansicht. Arbeitspaket 5: Lagemodus (Fläche zeichnen, Radius um Punkt, Verwaltungs-/PLZ-Gebiet, Pufferzone, Betroffene getrennt nach Gebiet/Puffer, CSV- und PDF-Lageliste, Ereignisse speichern/öffnen). Arbeitspaket 6: Druck des gefilterten Bestands als PDF (DIN A2 ein Blatt oder DIN A4 gestückelt mit Blattschnittübersicht, Überlappung, Passermarken; nummerierte Punkte, Legende, Maßstab, Nordpfeil, Stand, Quellen, Kontaktverzeichnis; 150 dpi).

## Demo im Browser (GitHub Pages)
Bei jedem Push baut `.github/workflows/pages.yml` eine **Demo-Version** und veröffentlicht sie auf GitHub Pages.
In der Demo läuft statt PHP/MariaDB ein kleiner Ersatz-Server im Browser (`frontend/src/demo/server.js`);
Daten bleiben nur im jeweiligen Browser (localStorage). Zugänge: `admin` / `demo` und `leser` / `demo`.
Die Verwaltungsgrenzen lädt der Workflow beim Bauen frisch von Geobasis NRW (DVG2, dl-de/zero-2.0).
Lokal: `cd frontend && npm run build:demo` (Ergebnis in `frontend/dist-demo/`).
Die Demo ersetzt **nicht** den Betrieb: Anmeldung, Rechte und Daten sind dort nicht geschützt.

## Technik
PHP ≥ 8.3 (Mindestversion über `PHP_MIN_VERSION` konfigurierbar), Slim 4, MariaDB ≥ 10.11 (PDO), Composer.
Karte (folgt): OpenLayers, EPSG:25832, **offline-first** – Kartenquellen sind austauschbar (siehe Plan Abschnitt 2a).

## Frontend bauen
Node.js ≥ 20 wird nur zum Bauen benötigt, nicht im Betrieb. Alle Bibliotheken werden lokal gebündelt (keine CDN).
```
cd frontend && npm ci && npm run build   # schreibt nach backend/public/
npm test                                  # Vitest
```

## Entwicklung ohne Docker
```
cd backend && php -S 127.0.0.1:8000 -t public bin/dev-router.php   # mit APP_ENV=development COOKIE_SECURE=false HSTS=false
cd frontend && npm run dev                                         # http://localhost:5173, /api wird an :8000 weitergeleitet
```

## Entwicklung mit Docker
```
docker compose up -d --build
docker compose exec php composer install
docker compose exec php php bin/migrate.php
docker compose exec php php bin/seed.php      # gibt das Initialpasswort des Admins einmalig aus
```
Vorher einmal das Frontend bauen (siehe oben).
Anwendung: http://localhost:8080 (API unter `/api`).

## Installation ohne Docker (IT.NRW)
1. PHP ≥ 8.3 mit `pdo_mysql`, `sodium`, `mbstring`, `intl`; MariaDB ≥ 10.11.
2. Datenbank und Benutzer anlegen (`utf8mb4`), Zugangsdaten per Umgebungsvariablen setzen:
   `DB_HOST DB_PORT DB_NAME DB_USER DB_PASS`.
3. `cd backend && composer install --no-dev --optimize-autoloader`; Frontend-Build (`backend/public/index.html` und `assets/`) aus dem Release übernehmen oder selbst bauen.
4. `php bin/migrate.php && php bin/seed.php`
5. Webserver-DocumentRoot auf `backend/public`; Anfragen unter `/api/` an `index.php` weiterleiten (Beispiel: `docker/nginx/default.conf`). **Nur HTTPS betreiben** (Session-Cookie ist `Secure`).

## Grenzdaten importieren (einmalig, ohne Internet auf dem Server)
Bezugsquellen und Lizenzen stehen in `config/services.php` (→ `boundaries`). Dateien auf einem Rechner mit Internet laden und auf den Server kopieren:

1. **Verwaltungsgrenzen** (Geobasis NRW, dl-de/zero-2.0): `dvg2_EPSG25832_Shape.zip` von
   https://www.opengeodata.nrw.de/produkte/geobasis/vkg/dvg/dvg2/
   ```
   php bin/import-boundaries.php --dvg=/pfad/dvg2_EPSG25832_Shape.zip
   ```
2. **PLZ-Gebiete** (OpenStreetMap, ODbL): GeoJSON der 5-stelligen PLZ-Gebiete, z. B. von https://www.suche-postleitzahl.org/downloads
   (Dateiname vor Ort prüfen). Die Datei darf ganz Deutschland enthalten; der Import schneidet auf NRW zu und bildet die 2-stelligen Leitregionen selbst.
   ```
   php bin/import-boundaries.php --plz5=/pfad/plz-5stellig.geojson
   ```
Feldnamen und Dateimuster sind in `config/boundaries.php` anpassbar. Ein erneuter Import ersetzt die jeweilige Ebene.

## Hintergrundkarten (offline-first)
`config/basemaps.php`: „Politisch“ wird aus den importierten Grenzen gezeichnet und braucht nie Netz.
„Topografisch“ nutzt Kacheln aus `backend/storage/tiles/topografisch/`. Ist eine Quelle gesetzt (`TOPO_UPSTREAM=dtk` und
`DTK_WMS_LAYERS=<Layername aus den GetCapabilities des DTK-WMS>`), lädt der Server fehlende Kacheln über den Proxy nach und speichert sie.
Für Betrieb ohne Internet die Kacheln vorab erzeugen und das Verzeichnis kopieren:
```
php bin/prefetch-tiles.php --basemap=topografisch --max-zoom=6
```
Ohne Kacheln und ohne Quelle ist „Topografisch“ in der Oberfläche ausgegraut.

## Wichtige Umgebungsvariablen
| Variable | Standard | Bedeutung |
|---|---|---|
| `APP_ENV` | production | `development` zeigt Fehlertexte |
| `COOKIE_SECURE` | true | nur in der Entwicklung über HTTP auf false |
| `SESSION_IDLE_TTL` / `SESSION_ABSOLUTE_TTL` | 1800 / 28800 | Sitzungsdauer in Sekunden |
| `LOGIN_MAX_PER_USER` / `LOGIN_MAX_PER_IP` / `LOGIN_WINDOW` | 5 / 30 / 900 | Login-Ratenbegrenzung |
| `TRUST_PROXY_HEADERS` | false | `X-Forwarded-For` nur hinter vertrauenswürdigem Proxy |
| `OUTBOUND_PROXY` | leer | ausgehender Proxy für externe Dienste |
| `TOPO_UPSTREAM` / `DTK_WMS_LAYERS` | dtk / leer | Quelle für topografische Kacheln; ohne Layername kein Netzzugriff |
| `BASEMAP_DEFAULT` | politisch | Start-Hintergrund |
| `GEOCODER_URL` | Nominatim | Adresssuche; `off` = abgeschaltet (Standort per Klick setzen) |
| `GEOCODER_MIN_INTERVAL_MS` | 1100 | Mindestabstand zwischen Anfragen (Nutzungsbedingungen Nominatim) |

## Tests
Benötigen eine MariaDB mit Datenbank `kritis_test` (Benutzer/Passwort per `DB_USER`/`DB_PASS`, Standard `kritis`/`kritis`):
```
cd backend && composer install && vendor/bin/phpunit
```
Frontend: `cd frontend && npm test`.

Geprüft werden u. a. Login, Sitzungshärtung, CSRF, Ratenbegrenzung, Passwortwechsel, Eingabevalidierung/SQL-Injection und die Rechtematrix (Route × anonym/lesen/admin), Stammdaten-Pflege (Reihenfolge, Löschschutz bei Verwendung).
