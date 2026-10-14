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
├─ docker-compose.yml        # php-fpm, nginx, mongo, (node nur für Frontend-Build)
├─ docker/ (php/Dockerfile, nginx/default.conf, mongo/init)
├─ README.md                 # Installation/Betrieb für IT.NRW
├─ docs/ (UMSETZUNGSPLAN.md, BETRIEB.md, SICHERHEIT.md  ← Mapping auf APP.3.1)
├─ config/
│  ├─ app.php                # PHP-Version-Check, Session, Proxy, Intervalle
│  ├─ services.php           # ALLE externen Endpunkte + Lizenz/Attribution (recherchiert, nicht geraten)
│  └─ .env.example
├─ backend/
│  ├─ composer.json          # slim/slim, mongodb/mongodb, php-di, monolog, phpunit …
│  ├─ public/index.php       # Front-Controller
│  ├─ src/
│  │  ├─ Http/ (Routes, Middleware: Auth, Rolle, CSRF, RateLimit, SecurityHeaders/CSP, Json-Fehler)
│  │  ├─ Controller/  Auth, Facility, Category, Scenario, User, Boundary, Event, Geocode, Proxy, Warning, Export
│  │  ├─ Domain/      Repositories (MongoDB), Services (Admin-Zuordnung, Lage-Abfrage, Puffer)
│  │  ├─ Validation/  strikte Typ-/Schema-Prüfung, Operator-Injection-Filter
│  │  ├─ Geo/         Puffer, Projektion 4326↔25832, Point-in-Polygon
│  │  └─ Proxy/       HTTP-Client (ausgehender Proxy), Cache, Allowlist
│  ├─ bin/ (seed.php, import-boundaries.php, create-indexes.php)
│  ├─ storage/ (cache, boundaries-download, logs)  # nicht web-erreichbar
│  └─ tests/ (Unit + Integration gegen echte MongoDB)
└─ frontend/                 # Vite, Vanilla-JS (ES-Module), OpenLayers, proj4 – alles lokal gebündelt
   ├─ src/ (main.js, api/, state/, map/, ui/, views/, print/, offline/, styles/)
   ├─ public/ (sw.js, manifest, Icons)
   └─ tests/ (Vitest)
```

Auslieferung: `vite build` → `backend/public/assets`. Keine Runtime-Abhängigkeit von Node auf dem Server.

## 2. Datenmodell (MongoDB)

- **users**: `username` (unique), `passwordHash` (Argon2id), `role` (`lesen|admin`), `mustChangePassword`, `active`, `failedLogins`, `lockedUntil`, createdAt/By, updatedAt/By.
- **categories / scenarios**: `name`, `color`, `symbol`, `order`, `active`, Metadaten.
- **facilities**: `name`, `categoryId`, `address{street,zip,city}`, `location` (GeoJSON Point WGS84, 2dsphere),
  `admin{regbez,kreis,gemeinde,plz5}`, `hazards[]`, `contact{person,function,phone,email}`, `note`, Metadaten.
  Für Stufe 3 bereits vorgesehen: `externalId` (optional), `normalizedKey` (normalisiert aus Name+PLZ+Straße für Dublettenerkennung, Index), `source` (`manual|import`), `importBatchId`.
  Indizes: `location` 2dsphere, `categoryId`, `hazards`, `admin.*`, Text-Index auf name/address/city.
- **boundaries**: `level` (`regbez|kreis|gemeinde|plz2|plz5`), `code`, `name`, `parentCodes`, `geometry` (Polygon/MultiPolygon, 2dsphere), `bbox`, `source`, `license`, `importedAt`.
- **events**: `name`, `occurredAt`, `geometry`, `bufferMeters`, `bufferGeometry`, `definition` (Typ: polygon|circle|boundary + Parameter), `resultSnapshot{inArea[], inBuffer[], counts, createdAt}`, Metadaten.
- **audit_log** (zusätzlich, für APP.3.1): Login-Erfolg/-Fehler, Rechteänderungen, Löschungen.
- **sessions** werden serverseitig in MongoDB gehalten (TTL-Index), Cookie nur mit Session-ID.

Seed: 4 Kategorien, 7 Szenarien, ein Admin mit Initialpasswort (zufällig generiert und einmalig in der Konsole ausgegeben, `mustChangePassword=true`). Keine Einrichtungen.

## 3. API (JSON, Präfix `/api`, CSRF-Token-Header bei allen schreibenden Methoden)

| Bereich | Endpunkte | Rolle |
|---|---|---|
| Auth | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/change-password` | – / alle |
| Stammdaten | `GET /categories`, `GET /scenarios` · `POST/PUT/DELETE …/{id}` | lesen / admin |
| Einrichtungen | `GET /facilities` (Filter: categoryId, hazard, regbez, kreis, plzPrefix, q, bbox, Paging), `GET /facilities/{id}`, `POST`, `PUT`, `DELETE` | lesen / admin |
| Hinweise | `POST /facilities/hints` (Stufe 2: GetFeatureInfo/Warngebiete) | admin |
| Grenzen | `GET /boundaries?level=&bbox=&simplify=`, `GET /boundaries/{level}/{code}` | lesen |
| Lage | `POST /situation/query` (Geometrie, Puffer → im Gebiet / Pufferzone), `GET/POST/PUT/DELETE /events`, `GET /events/{id}/export.csv` | lesen (Speichern/Löschen: admin) |
| Proxy | `GET /proxy/wms/{layer}` (Allowlist aus `services.php`), `GET /proxy/tiles/{source}/{z}/{x}/{y}`, `GET /geocode?q=` | lesen |
| Warnungen (St. 2) | `GET /warnings` (aggregiert + Status je Dienst), `GET /warnings/status` | lesen |
| Benutzer | `GET/POST/PUT/DELETE /users`, `POST /users/{id}/reset-password` | admin |
| Betrieb | `GET /health` | – |
| Import (St. 3) | `POST /import/preview`, `POST /import/commit`, `GET /facilities/export.xlsx|csv` | admin |

Der Proxy akzeptiert nur Schlüssel aus der Konfiguration, niemals frei übergebene URLs (SSRF-Schutz).

## 4. Zentrale technische Entscheidungen

- **Sicherheit**: Slim-Middleware-Kette (SecurityHeaders/CSP → Session → CSRF → Auth → Rolle → Validierung). Session-Cookie Secure/HttpOnly/SameSite=Strict, `session_regenerate_id` nach Login, Rate-Limit pro IP+Benutzer (MongoDB-Zähler), Lockout mit Backoff. Eingaben werden nur als Skalare/typisierte Strukturen akzeptiert (Arrays/Objekte mit `$`-Schlüsseln werden abgelehnt), Filter werden serverseitig aus Whitelist-Parametern gebaut. CSP ohne `unsafe-inline`.
- **Karte**: OpenLayers mit EPSG:25832 (proj4), Extent auf NRW begrenzt. Hintergrund „Topografisch“ und WMS über Proxy; „Politisch“ aus Grenz-Polygonen (Regierungsbezirksfarben), Vereinfachung je Zoomstufe vom Server. Clustering über `ol/source/Cluster`.
- **Lagemodus**: Server-Query mit `$geoWithin`/`$geoIntersects` auf `facilities.location`. Pufferzone = Puffergeometrie minus Ereignisgebiet. Puffer wird in EPSG:25832 (metrisch) berechnet und zurück nach WGS84 transformiert.
- **Druck/PDF**: Karte wird im Browser in Zielauflösung (≥150 dpi, A2 quer = 3508×2480 px) auf Canvas gerendert (durch den Proxy nicht „tainted“); A4-Kachelung mit Überlappung, Passermarken, Blattschnittübersicht; Kontaktverzeichnis als Folgeseiten.
- **Offline**: Service Worker (Workbox-frei, eigene schlanke Implementierung): App-Shell, `GET /facilities` (letzter Stand + Zeitstempel), Kartenkacheln (LRU-begrenzt), NRW-Übersicht Zoom 6–9 vorab. Banner nur Lesebetrieb.
- **Tests**: PHPUnit-Integrationstests gegen MongoDB-Testinstanz für `$geoWithin`/`$geoIntersects`, Puffer, Admin-Zuordnung (Point-in-Polygon), Rollenmatrix (jeder Endpunkt × Rolle × unauthentifiziert), CSRF, Operator-Injection; Vitest für Frontend-Logik.

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
