# KRITIS-Lagekarte NRW – Umsetzungsplan (zur Freigabe)

Stand: 2026-10-14 · Status: **Entwurf, wartet auf Freigabe – es wurde noch kein Anwendungscode geschrieben.**

## 0. Design-Vorlage (Claude Design, 13 Boards)

| Board | Inhalt | Stufe |
|---|---|---|
| 01 Anmeldung | Glas-Karte 400 px auf unscharfer NRW-Silhouette | 1 |
| 02 Hauptansicht | Karte, schwebende Glas-Panels (Suche/Filter/Trefferliste, Ebenen, Legende) | 1 |
| 03 Leerzustand | Start ohne Einrichtungsdaten | 1 |
| 04 Offline | Banner „Offline – Datenstand vom …“, Detailansicht | 1 |
| 05 Einrichtung | Anlegen/Bearbeiten, Geokodierung, Marker verschieben | 1 (WMS-Hinweise: 2) |
| 06 Lagemodus | Polygon / Kreis / Verwaltungsgebiet, Puffer, Ergebnis im Gebiet / Pufferzone | 1 |
| 07 Live-Warnlage (Dunkelmodus) | Warngebiete, Dienststatus | 2 |
| 08 Administration | Benutzer, Kategorien, Szenarien | 1 |
| 09–12 Druck | Dialog mit Vorschau, A2 quer, A4-Blattschnittübersicht, A4-Kartenblatt | 1 |
| 13 Komponenten | Button, Input, Glas-Panel, Chips, Listen … | 1 |

Tokens aus den Boards (werden 1:1 als CSS-Variablen in `frontend/src/styles/tokens.css` übernommen,
Light = `.kl-light`, Dark = `.kl-dark`):
Systemschrift (`-apple-system … system-ui`, kein Webfont, keine CDN), Basis 14 px/1.4;
Akzent `#0A66D8` (dark `#4C95F2`), Danger `#C42B2B` / `#F06A63`, Text `#111318`, Fläche `#FFFFFF`,
Kartenhintergrund `#E4E8EC`; Glas: `blur(30px) saturate(180%)`, Radius 20 (Karte 28), Eingabefelder/Buttons
44 px Höhe, Radius 12; Label 13/600, Caption 12.
Beim Bau lese ich alle Boards vollständig und gleiche Maße ab; Abweichungen melde ich.

## 1. Verzeichnisstruktur

```
/
├─ docker-compose.yml        # php-fpm, nginx, mariadb, (node nur für Frontend-Build)
├─ docker/ (php/Dockerfile, nginx/default.conf, mariadb/init)
├─ README.md                 # Installation/Betrieb für IT.NRW
├─ docs/ (UMSETZUNGSPLAN.md, BETRIEB.md, SICHERHEIT.md  ← Mapping auf APP.3.1)
├─ config/
│  ├─ app.php                # PHP-Version-Check, Session, Proxy, Intervalle
│  ├─ services.php           # ALLE externen Endpunkte + Lizenz/Attribution (recherchiert, nicht geraten)
│  └─ .env.example
├─ backend/
│  ├─ composer.json          # slim/slim, slim/psr7, phpunit (DB via PDO)
│  ├─ public/index.php       # Front-Controller
│  ├─ src/
│  │  ├─ Http/ (Routes, Middleware: Auth, Rolle, CSRF, RateLimit, SecurityHeaders/CSP, Json-Fehler)
│  │  ├─ Controller/  Auth, Facility, Category, Scenario, User, Boundary, Event, Geocode, Proxy, Warning, Export
│  │  ├─ Domain/      Repositories (MariaDB), Services (Admin-Zuordnung, Lage-Abfrage, Puffer)
│  │  ├─ Validation/  strikte Typ-/Schema-Prüfung, Operator-Injection-Filter
│  │  ├─ Geo/         Puffer, Projektion 4326↔25832, Point-in-Polygon
│  │  └─ Proxy/       HTTP-Client (ausgehender Proxy), Cache, Allowlist
│  ├─ bin/ (seed.php, import-boundaries.php, create-indexes.php)
│  ├─ storage/ (cache, boundaries-download, logs)  # nicht web-erreichbar
│  └─ tests/ (Unit + Integration gegen echte MariaDB)
└─ frontend/                 # Vite, Vanilla-JS (ES-Module), OpenLayers, proj4 – alles lokal gebündelt
   ├─ src/ (main.js, api/, state/, map/, ui/, views/, print/, offline/, styles/)
   ├─ public/ (sw.js, manifest, Icons)
   └─ tests/ (Vitest)
```

Auslieferung: `vite build` → `backend/public/assets`. Keine Runtime-Abhängigkeit von Node auf dem Server.

## 2. Datenmodell (MariaDB 10.11+, InnoDB, utf8mb4)

**Entscheidung (Rückmeldung 2026-10-14): MariaDB statt MariaDB.** Zugriff über PDO (`pdo_mysql`), Schema-Migrationen als SQL-Dateien in `backend/migrations/` (Skript `bin/migrate.php`).
Geodaten als `GEOMETRY`/`POINT` mit Spatial Index (Koordinaten WGS84 lon/lat, planare Berechnung – für NRW ausreichend).
MariaDB 10.11 hat `ST_Within`, `ST_Intersects`, `ST_Buffer`, aber **kein `ST_Transform`**: Reprojektion WGS84↔EPSG:25832 erfolgt in PHP (eigene UTM-Implementierung, getestet). Der Puffer wird in UTM-Metern per `ST_Buffer` in MariaDB gerechnet und zurückprojiziert – die offene Puffer-Frage entfällt damit.

- **users**: `id`, `username` (unique), `password_hash` (Argon2id), `role` ENUM(`lesen`,`admin`), `must_change_password`, `active`, `failed_logins`, `locked_until`, created_at/by, updated_at/by.
- **sessions**: `id_hash` (SHA-256 der Cookie-ID), `user_id`, `csrf_token`, `data`, `expires_at`, `created_at`. Eigene Session-Verwaltung statt PHP-Session (testbar, Regeneration nach Login).
- **categories / scenarios**: `id`, `name`, `color`, `symbol`, `sort_order`, `active`, Metadaten.
- **facilities**: `id`, `name`, `category_id`, `street`, `zip`, `city`, `location POINT NOT NULL` (SPATIAL INDEX), `regbez`, `kreis`, `gemeinde`, `plz5` (indexiert, per Point-in-Polygon beim Speichern), `contact_person/function/phone/email`, `note`, Metadaten; Stufe 3: `external_id`, `normalized_key` (Index), `source`, `import_batch_id`. FULLTEXT auf name/city.
- **facility_hazards**: `facility_id`, `scenario_id` (n:m).
- **boundaries**: `id`, `level` (`regbez|kreis|gemeinde|plz2|plz5`), `code`, `name`, `parent_codes` (JSON), `geom GEOMETRY NOT NULL` (SPATIAL INDEX), `source`, `license`, `imported_at`.
- **events**: `id`, `name`, `occurred_at`, `geom`, `buffer_m`, `buffer_geom`, `definition` (JSON), `result_snapshot` (JSON), Metadaten.
- **audit_log**, **rate_limits** (TTL per Cleanup-Job/Abfrage).

Seed: 4 Kategorien, 7 Szenarien, ein Admin (zufälliges Initialpasswort, einmalig in der Konsole, `must_change_password=1`). Keine Einrichtungen.

## 2a. Karten: Offline-first, Quellen austauschbar (Rückmeldung 2026-10-14)

Es kann sein, dass im Betrieb **gar kein Internetzugriff** möglich ist. Deshalb:

- Die Karte läuft **standardmäßig vollständig ohne externe Dienste**. Hintergrund „Politisch“ wird aus den lokal in der Datenbank liegenden Verwaltungsgrenzen gerendert; Einrichtungen, Lagemodus und Druck brauchen kein Netz.
- Hintergrund „Topografisch“ ist eine **austauschbare Quelle** (`config/basemaps.php`), jeweils mit gleichem Interface im Frontend:
  `local-tiles` (vorgerenderte XYZ-/MBTiles-Pakete, vom Server ausgeliefert – Standard, sobald ein Paket installiert ist),
  `wms-proxy` (Geobasis NRW über den PHP-Proxy, nur wenn Netz vorhanden),
  `none`. Tausch = Konfigurationsänderung, kein Codeumbau.
- Grenz-Importskript nimmt auch **lokale Dateien** (GeoJSON/Shape/GPKG) statt Download; die Rohdaten werden einmalig außerhalb beschafft und per Datenträger eingespielt.
- Externe Dienste (Geokodierung, Warnungen, Hochwasser-WMS) sind **optionale Zusatzfunktionen** mit sichtbarem Status „nicht erreichbar“; ohne Netz bleibt alles andere voll nutzbar. Geokodierung offline: manuelles Setzen des Markers.
- Service Worker bleibt als zweite Schicht (Daten-/Kachel-Cache).

## 3. API (JSON, Präfix `/api`, CSRF-Token-Header bei allen schreibenden Methoden)

| Bereich | Endpunkte | Rolle |
|---|---|---|
| Auth | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/change-password` | – / alle |
| Stammdaten | `GET /categories`, `GET /scenarios` · `POST/PUT/DELETE …/{id}` | lesen / admin |
| Einrichtungen | `GET /facilities` (Filter: categoryId, hazard, regbez, kreis, plzPrefix, q, bbox, Paging), `GET /facilities/{id}`, `POST`, `PUT`, `DELETE` | lesen / admin |
| Hinweise | `POST /facilities/hints` (Stufe 2: GetFeatureInfo/Warngebiete) | admin |
| Grenzen | `GET /boundaries?level=&bbox=&simplify=`, `GET /boundaries/{level}/{code}` | lesen |
| Lage | `POST /situation/query` (Geometrie, Puffer → im Gebiet / Pufferzone, SQL-Spatial), `GET/POST/PUT/DELETE /events`, `GET /events/{id}/export.csv` | lesen (Speichern/Löschen: admin) |
| Proxy | `GET /proxy/wms/{layer}` (Allowlist aus `services.php`), `GET /proxy/tiles/{source}/{z}/{x}/{y}`, `GET /geocode?q=` | lesen |
| Warnungen (St. 2) | `GET /warnings` (aggregiert + Status je Dienst), `GET /warnings/status` | lesen |
| Benutzer | `GET/POST/PUT/DELETE /users`, `POST /users/{id}/reset-password` | admin |
| Betrieb | `GET /health` | – |
| Import (St. 3) | `POST /import/preview`, `POST /import/commit`, `GET /facilities/export.xlsx|csv` | admin |

Der Proxy akzeptiert nur Schlüssel aus der Konfiguration, niemals frei übergebene URLs (SSRF-Schutz).

## 4. Zentrale technische Entscheidungen

- **Sicherheit**: Slim-Middleware-Kette (SecurityHeaders/CSP → Session → CSRF → Auth → Rolle → Validierung). Session-Cookie Secure/HttpOnly/SameSite=Strict, `session_regenerate_id` nach Login, Rate-Limit pro IP+Benutzer (DB-Zähler), Lockout mit Backoff. Ausschließlich Prepared Statements; Eingaben werden typisiert validiert, Filter/Sortierung nur aus Whitelists gebaut. CSP ohne `unsafe-inline`.
- **Karte**: OpenLayers mit EPSG:25832 (proj4), Extent auf NRW begrenzt. Hintergrund „Topografisch“ und WMS über Proxy; „Politisch“ aus Grenz-Polygonen (Regierungsbezirksfarben), Vereinfachung je Zoomstufe vom Server. Clustering über `ol/source/Cluster`.
- **Lagemodus**: Server-Query mit `ST_Within`/`ST_Intersects` auf `facilities.location` (Spatial Index). Pufferzone = Puffergeometrie minus Ereignisgebiet. Puffer per `ST_Buffer` in EPSG:25832 (metrisch), Projektion in PHP.
- **Druck/PDF**: Karte wird im Browser in Zielauflösung (≥150 dpi, A2 quer = 3508×2480 px) auf Canvas gerendert (durch den Proxy nicht „tainted“); A4-Kachelung mit Überlappung, Passermarken, Blattschnittübersicht; Kontaktverzeichnis als Folgeseiten.
- **Offline**: Service Worker (Workbox-frei, eigene schlanke Implementierung): App-Shell, `GET /facilities` (letzter Stand + Zeitstempel), Kartenkacheln (LRU-begrenzt), NRW-Übersicht Zoom 6–9 vorab. Banner nur Lesebetrieb.
- **Tests**: PHPUnit-Integrationstests gegen MariaDB-Testdatenbank für ST_Within/ST_Intersects, Puffer, Projektion, Admin-Zuordnung (Point-in-Polygon), Rollenmatrix (jeder Endpunkt × Rolle × unauthentifiziert), CSRF, SQL-Injection (nur Prepared Statements); Vitest für Frontend-Logik.

## 5. Phasen

- **Stufe 1** (in Arbeitspaketen, je mit Commit): (1) Gerüst + Docker + Auth/Sessions/CSRF/Rollen + Tests → (2) Stammdaten + Admin-UI → (3) Grenzimport + Karte/Hintergründe/Proxy → (4) Einrichtungen + Geokodierung + Filter/Liste → (5) Lagemodus + Export CSV + Ereignisse → (6) Druck → (7) Offline.
- **Stufe 2**: Hochwasser-WMS + Hinweise, Warnlage (NINA/MoWaS, DWD Warnungen, DWD Waldbrandgefahrenindex) mit Statusanzeige.
- **Stufe 3**: Excel/CSV-Import (Spaltenzuordnung, Validierung, Fehlerbericht, Vorschau, Dubletten) und Export.

## 6. Offene Fragen / Annahmen (bitte bestätigen)

1. **„Einschränkung im LVN“**: Ich verstehe das als Netzbeschränkung (Landesverwaltungsnetz → externe Dienste evtl. nicht direkt erreichbar). Annahme: Alle Aufrufe laufen über den konfigurierbaren Proxy, und jeder Dienst hat Status/Fallback. Stimmt das, oder meinst du etwas anderes?
2. **Puffer-Berechnung serverseitig in PHP**: PHP hat keine eingebaute Geometrie-Buffer-Funktion. Optionen: (a) GEOS-PHP-Extension im Docker-Image (beste Qualität, aber zusätzliche Extension bei IT.NRW), (b) reine PHP-Bibliothek/eigene Implementierung (Polygon-Offset, für Kreise/einfache Polygone ausreichend). **Empfehlung (b)**, GEOS optional, falls vorhanden. Einverstanden?
3. **PDF-Erzeugung im Browser** (jsPDF, lokal gebündelt) statt serverseitig – Empfehlung wegen Kartenrendering mit OpenLayers. Alternative: Server (z. B. mPDF) mit Bild vom Client. OK?
4. **Frontend-Sprache**: Vanilla-JS (ES-Module) ohne Framework, passend zu „kein schweres Framework“. Oder lieber leichtgewichtig mit Preact/Lit?
5. **Dienst-URLs/Lizenzen**: werden zu Beginn von Arbeitspaket 3 bzw. Stufe 2 recherchiert und mit Quellenangabe in `config/services.php` abgelegt. Falls die Entwicklungsumgebung externe Hosts blockiert, kann ich sie dort nicht live testen; dann markiere ich sie als „ungetestet“.
6. **Mehrsprachigkeit**: nur Deutsch. **Browser**: aktuelle Chromium/Firefox-Desktop-Versionen.
7. **Branch**: Entwicklung auf `claude/vigilant-mccarthy-o1vnp1`, kein PR ohne Aufforderung.

## 7. Entscheidungen während der Umsetzung

- **PLZ-Filter:** Das Design zeigt „PLZ von/bis“, die Anforderung nennt einen Präfix („41“). Umgesetzt ist ein Präfixfeld „PLZ-Bereich (Anfang der PLZ)“.
- **Grenzdaten:** Import aus lokalen Dateien (DVG-Shape-ZIP, PLZ-GeoJSON); DVG-Schlüssel (`KN`) werden auf AGS-Länge der Ebene gekürzt (RB 3, Kreis 5, Gemeinde 8 Stellen). Ohne `dvg2bld` wird die Landesfläche aus den Regierungsbezirken vereinigt.
- **Kachelraster:** eigenes EPSG:25832-Raster (Ursprung 270000/5850000, 256 px, 12 Stufen) – gemeinsam für Cache, Vorabladen und Druck.
