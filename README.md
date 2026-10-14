# KRITIS-Lagekarte NRW

Interaktive Karte krisenrelevanter Einrichtungen in NRW. Planung: [docs/UMSETZUNGSPLAN.md](docs/UMSETZUNGSPLAN.md).

**Stand:** Stufe 1, Arbeitspakete 1–2: Backend-Gerüst, Anmeldung mit Initialpasswort-Wechsel, Sitzungen, CSRF, Rollen; Administration (Benutzer, Kategorien, Krisenszenarien) mit Oberfläche nach UI-Design. Arbeitspaket 3: Grenzimport, Karte (OpenLayers, EPSG:25832) mit Hintergründen, Grenz-/PLZ-Ebenen, Legende und Leerzustand. Arbeitspaket 4: Einrichtungen anlegen/bearbeiten/löschen mit Adresssuche, verschiebbarem Marker, automatischer Gebietszuordnung, kombinierbaren Filtern, Trefferliste, Clustering und Detailansicht. Arbeitspaket 5: Lagemodus (Fläche zeichnen, Radius um Punkt, Verwaltungs-/PLZ-Gebiet, Pufferzone, Betroffene getrennt nach Gebiet/Puffer, CSV- und PDF-Lageliste, Ereignisse speichern/öffnen). Optional mit **Krisenszenario**: Dann gelten nur die für dieses Szenario als „gefährdet bei“ markierten Einrichtungen als gefährdet und stehen oben; die übrigen im Gebiet erscheinen grau unter „Weitere – nicht für das Szenario markiert“. Szenarien, die in den Stammdaten als **flächig** gekennzeichnet sind (Vorgabe: Stromausfall, Cyberangriff), betreffen alle Einrichtungen im Gebiet. Arbeitspaket 6: Druck des gefilterten Bestands als PDF (DIN A2 ein Blatt oder DIN A4 gestückelt mit Blattschnittübersicht, Überlappung, Passermarken; nummerierte Punkte, Legende, Maßstab, Nordpfeil, Stand, Quellen, Kontaktverzeichnis; 150 dpi). Arbeitspaket 7: Offline-Betrieb über Service Worker (App, letzter Datenstand, zuletzt genutzte Kacheln, NRW-Übersicht vorab; Banner „Offline – Datenstand vom …“, reiner Lesebetrieb).

**Stufe 2:** Hochwassergefahrenkarten NRW als zuschaltbare WMS-Ebene (über Proxy, mit Cache) und Hinweise beim Speichern (GetFeatureInfo HQhäufig/HQ100/HQextrem, aktive Warngebiete, Waldbrandindex – nur Vorschläge); Live-Warnlage aus NINA (MoWaS, DWD) und DWD-Waldbrandgefahrenindex mit periodischem Abruf, Statusanzeige je Dienst und Rückfall auf den letzten Stand bei Ausfall.

**Stufe 3:** Import von Einrichtungen aus Excel (.xlsx) oder CSV unter *Administration › Import & Export*: Spaltenzuordnung mit Vorschlag anhand der Überschriften, Prüfung jeder Zeile (Pflichtfelder, Kategorie/Szenarien per Name, PLZ, E-Mail, Koordinaten WGS84 oder UTM 32, Lage in NRW), optionale Standortermittlung über die Adresssuche, Dublettenerkennung gegen Bestand und Datei (ID, externe ID, Name+PLZ+Straße, gleicher Name im Umkreis von 200 m), Vorschau mit Status, Fehlerbericht als CSV, Übernahme nach Bestätigung als Ganzes (Server prüft erneut, alles oder nichts, Protokoll mit Import-Kennung). Export des Bestands als .xlsx/.csv sowie der gefilterten Auswahl direkt aus der Karte; Exportdateien lassen sich wieder einlesen (Spalte „ID“ → Bestand aktualisieren).

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

## Betrieb mit Docker (z. B. Unraid)
Ein fertiges Image enthält Frontend, Backend und Webserver; die Datenbank läuft als zweiter Container (MariaDB 10.11).
Beim ersten Start richtet sich alles selbst ein: Tabellen, Stammdaten, Admin (Initialpasswort im Container-Log)
und – bei Internetzugang – die Verwaltungsgrenzen NRW (DVG2 von Geobasis NRW).

Das Image baut GitHub bei jedem Push automatisch (`.github/workflows/docker.yml`) → `ghcr.io/allgrinder/mapping:latest` (öffentlich, kein Login nötig).

**Unraid mit Templates (empfohlen):** Zwei Vorlagen in `deploy/unraid/templates/` – App und passende MariaDB.
1. Unraid-Terminal (oder *Tools → Terminal*), Vorlagen holen:
   ```
   cd /boot/config/plugins/dockerMan/templates-user
   wget -O my-KRITIS-MariaDB.xml   https://raw.githubusercontent.com/allgrinder/Mapping/HEAD/deploy/unraid/templates/kritis-mariadb.xml
   wget -O my-KRITIS-Lagekarte.xml https://raw.githubusercontent.com/allgrinder/Mapping/HEAD/deploy/unraid/templates/kritis-lagekarte.xml
   ```
   (Alternativ unter *Docker → Template Repositories* `https://github.com/allgrinder/Mapping` eintragen.)
2. *Docker → Add Container → Template „KRITIS-MariaDB“*: Datenbank- und Root-Passwort wählen → *Apply*.
3. *Add Container → Template „KRITIS-Lagekarte“*: Datenbank-Host = IP des Unraid-Servers, Port 3307, dasselbe Datenbank-Passwort → *Apply*.
4. *Docker → KRITIS-Lagekarte → Logs*: Initialpasswort für `admin`. Aufruf über *WebUI* bzw. `http://<unraid-ip>:8085`.

Aktualisieren: *Docker → Check for Updates* bzw. *Force Update* beim Container KRITIS-Lagekarte.

**Unraid mit Docker Compose Manager (Alternative):** Plugin „Docker Compose Manager“ → *Add New Stack* „kritis“ →
Inhalt von `deploy/unraid/docker-compose.yml` einfügen, unter *Edit Env* `deploy/unraid/env.example` einfügen, Passwörter ändern → *Compose Up*.
Aktualisieren: *Compose Pull*, dann *Compose Up*. Daten liegen unter `/mnt/user/appdata/kritis/` (`mysql/`, `storage/` mit
Kachelvorrat, Caches und `import/`). Ohne Internet: DVG-ZIP bzw. PLZ-GeoJSON nach `storage/import/` legen und den Container neu starten.
Hinter einem HTTPS-Reverse-Proxy (SWAG, Nginx Proxy Manager) `COOKIE_SECURE=true` und `TRUST_PROXY_HEADERS=true` setzen.

Hilfsbefehle im Container (bei Compose heißt er `kritis-app`):
```
docker exec -it -u www-data KRITIS-Lagekarte php bin/reset-password.php admin     # Passwort vergessen → neues Einmalpasswort
docker exec -it -u www-data KRITIS-Lagekarte php bin/wms-layers.php dtk          # Layerwahl der topografischen Karte prüfen
docker exec -it -u www-data KRITIS-Lagekarte php bin/prefetch-tiles.php --basemap=topografisch --max-zoom=7   # Kachelvorrat anlegen
```
Selbst bauen statt Download: `docker build -t kritis-lagekarte .` im Projektordner, dann im Template bzw. in der `.env`
(`KRITIS_IMAGE`) `kritis-lagekarte` als Image eintragen.

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

## Hintergrundkarten (offline-first, krisenfest)
`config/basemaps.php`: „Politisch“ wird aus den importierten Grenzen gezeichnet und braucht nie Netz.

„Topografisch“ (DTK von Geobasis NRW) arbeitet zweistufig:
1. **Vorrat auf dem Server:** Kacheln liegen in `backend/storage/tiles/topografisch/` und werden immer zuerst ausgeliefert – ohne Netz.
2. **Automatisches Nachladen:** Fehlt eine Kachel und ist der DTK-WMS erreichbar (`TOPO_UPSTREAM=dtk`, über `OUTBOUND_PROXY`),
   holt der Server sie und legt sie dauerhaft ab. Den Layer wählt er selbst aus den GetCapabilities (farbiger Sammellayer in EPSG:25832)
   und merkt ihn sich 30 Tage; fällt der Dienst aus, bleibt die letzte Wahl gültig. Festlegen lässt er sich mit `DTK_WMS_LAYERS=<Name>`.

Prüfen, welche Layer der Dienst anbietet und welcher gewählt wird:
```
php bin/wms-layers.php dtk
```
Vorrat anlegen (auf einem Rechner mit Netz; abgebrochene Läufe einfach neu starten, Vorhandenes wird übersprungen):
```
php bin/prefetch-tiles.php --basemap=topografisch --max-zoom=7 --dry-run      # Anzahl/Größe anzeigen
php bin/prefetch-tiles.php --basemap=topografisch --max-zoom=7                # ganz NRW bis ca. 9 m/Pixel (~22.000 Kacheln)
php bin/prefetch-tiles.php --basemap=topografisch --min-zoom=8 --max-zoom=10 \
    --extent=340000,5620000,380000,5660000                                    # Detailstufen für einen Ausschnitt (EPSG:25832)
```
Danach `backend/storage/tiles/topografisch/` auf den Zielserver kopieren. Ohne Vorrat und ohne erreichbaren Dienst ist „Topografisch“
in der Oberfläche ausgegraut. Zusätzlich hält der Browser die zuletzt angesehenen Kacheln offline vor (Service Worker).

## Offline-Betrieb
Der Service Worker (`sw.js`, beim Frontend-Build erzeugt) speichert App, letzten Datenstand (Einrichtungen, Stammdaten, Grenzen,
Ereignisse) und bis zu 4.000 Kartenkacheln im Browser. Nach der Anmeldung lädt er die NRW-Übersicht (Zoomstufen 0–4) vor.
Ohne Verbindung zeigt die Anwendung „Offline – Datenstand vom …“ und erlaubt nur Lesen. Beim Abmelden werden die
zwischengespeicherten Daten gelöscht. Voraussetzung: Auslieferung über HTTPS (oder localhost); `sw.js` darf nicht lange gecacht werden
(siehe `docker/nginx/default.conf`).

## Live-Warnlage und Hochwasser (Stufe 2)
Quellen und Lizenzen: `config/services.php` (`wms.hochwasser`, `warnings`). Abruf erfolgt nur serverseitig über `OUTBOUND_PROXY`.
Die Warnlage wird bei Bedarf höchstens alle `WARNINGS_INTERVAL` Sekunden erneuert; alternativ per Cron:
```
*/5 * * * * cd /pfad/backend && php bin/refresh-warnings.php
```
Fällt ein Dienst aus, bleibt der letzte Stand sichtbar und der Status wird angezeigt. Die Layer der Hochwassergefahrenkarten
werden aus den GetCapabilities ermittelt (HQhäufig/HQ100/HQextrem); bei Bedarf über `HWGK_LAYER_HQ100` usw. festlegen.

## Import & Export (Stufe 3)
- Formate: `.xlsx` (Excel 2007+) und CSV (Trennzeichen `;` `,` Tab, UTF-8 oder Windows-1252). Altes `.xls` bitte vorher in Excel als `.xlsx` speichern.
- Höchstens 5000 Zeilen je Import (`ImportController::MAX_ROWS`), Datei bis 15 MB. Die Datei wird nur im Browser gelesen; an den Server gehen ausschließlich die geprüften Datensätze als JSON.
- Eine Vorlage mit den Spalten und den gültigen Kategorien/Szenarien gibt es unter *Vorlage herunterladen*.
- Dubletten: wahlweise überspringen oder den Bestand überschreiben. Neue Zeilen, die serverseitig auf einen vorhandenen Schlüssel treffen, werden abgelehnt.
- Exportiert werden Werte, nie Formeln; CSV-Zellen, die mit `= + - @` beginnen, werden maskiert.

## Wichtige Umgebungsvariablen
| Variable | Standard | Bedeutung |
|---|---|---|
| `APP_ENV` | production | `development` zeigt Fehlertexte |
| `COOKIE_SECURE` | true | nur in der Entwicklung über HTTP auf false |
| `SESSION_IDLE_TTL` / `SESSION_ABSOLUTE_TTL` | 1800 / 28800 | Sitzungsdauer in Sekunden |
| `LOGIN_MAX_PER_USER` / `LOGIN_MAX_PER_IP` / `LOGIN_WINDOW` | 5 / 30 / 900 | Login-Ratenbegrenzung |
| `TRUST_PROXY_HEADERS` | false | `X-Forwarded-For` nur hinter vertrauenswürdigem Proxy |
| `OUTBOUND_PROXY` | leer | ausgehender Proxy für externe Dienste |
| `TOPO_UPSTREAM` / `DTK_WMS_LAYERS` | dtk / leer | Quelle für topografische Kacheln; Layer leer = automatisch aus den GetCapabilities, `TOPO_UPSTREAM=none` = nur lokaler Vorrat, nie Netz |
| `BASEMAP_DEFAULT` | politisch | Start-Hintergrund |
| `GEOCODER_URL` | Nominatim | Adresssuche; `off` = abgeschaltet (Standort per Klick setzen) |
| `GEOCODER_MIN_INTERVAL_MS` | 1100 | Mindestabstand zwischen Anfragen (Nutzungsbedingungen Nominatim) |
| `WARNINGS_INTERVAL` | 300 | Abrufintervall Warnlage in Sekunden |
| `HWGK_WMS_URL` | wms.nrw.de/umwelt/wasser/HW_Gefahrenkarte | Hochwassergefahrenkarten; `off` = abgeschaltet |
| `NINA_BASE_URL` / `DWD_WBI_URL` | amtliche Endpunkte | Warnquellen |

## Tests
Benötigen eine MariaDB mit Datenbank `kritis_test` (Benutzer/Passwort per `DB_USER`/`DB_PASS`, Standard `kritis`/`kritis`):
```
cd backend && composer install && vendor/bin/phpunit
```
Frontend: `cd frontend && npm test`.

Geprüft werden u. a. Login, Sitzungshärtung, CSRF, Ratenbegrenzung, Passwortwechsel, Eingabevalidierung/SQL-Injection und die Rechtematrix (Route × anonym/lesen/admin), Stammdaten-Pflege (Reihenfolge, Löschschutz bei Verwendung). Außerdem Geo-Abfragen (Gebietszuordnung, Lagemodus, Puffer), Warnlage/Hochwasser mit Testdoubles sowie der Import (alles oder nichts, Dubletten, Fehler je Zeile) und im Frontend CSV-Lesen, Spaltenzuordnung, Zeilenprüfung und Dublettenerkennung.
