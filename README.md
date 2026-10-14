# KRITIS-Lagekarte NRW

Interaktive Karte krisenrelevanter Einrichtungen in NRW. Planung: [docs/UMSETZUNGSPLAN.md](docs/UMSETZUNGSPLAN.md).

**Stand:** Stufe 1, Arbeitspaket 1 (Backend-Gerüst, Anmeldung, Sitzungen, CSRF, Rollen, Tests). Frontend und Karte folgen.

## Technik
PHP ≥ 8.3 (Mindestversion über `PHP_MIN_VERSION` konfigurierbar), Slim 4, MariaDB ≥ 10.11 (PDO), Composer.
Karte (folgt): OpenLayers, EPSG:25832, **offline-first** – Kartenquellen sind austauschbar (siehe Plan Abschnitt 2a).

## Entwicklung mit Docker
```
docker compose up -d --build
docker compose exec php composer install
docker compose exec php php bin/migrate.php
docker compose exec php php bin/seed.php      # gibt das Initialpasswort des Admins einmalig aus
```
Anwendung: http://localhost:8080 (API unter `/api`).

## Installation ohne Docker (IT.NRW)
1. PHP ≥ 8.3 mit `pdo_mysql`, `sodium`, `mbstring`, `intl`; MariaDB ≥ 10.11.
2. Datenbank und Benutzer anlegen (`utf8mb4`), Zugangsdaten per Umgebungsvariablen setzen:
   `DB_HOST DB_PORT DB_NAME DB_USER DB_PASS`.
3. `cd backend && composer install --no-dev --optimize-autoloader`
4. `php bin/migrate.php && php bin/seed.php`
5. Webserver-DocumentRoot auf `backend/public`; Anfragen unter `/api/` an `index.php` weiterleiten (Beispiel: `docker/nginx/default.conf`). **Nur HTTPS betreiben** (Session-Cookie ist `Secure`).

## Wichtige Umgebungsvariablen
| Variable | Standard | Bedeutung |
|---|---|---|
| `APP_ENV` | production | `development` zeigt Fehlertexte |
| `COOKIE_SECURE` | true | nur in der Entwicklung über HTTP auf false |
| `SESSION_IDLE_TTL` / `SESSION_ABSOLUTE_TTL` | 1800 / 28800 | Sitzungsdauer in Sekunden |
| `LOGIN_MAX_PER_USER` / `LOGIN_MAX_PER_IP` / `LOGIN_WINDOW` | 5 / 30 / 900 | Login-Ratenbegrenzung |
| `TRUST_PROXY_HEADERS` | false | `X-Forwarded-For` nur hinter vertrauenswürdigem Proxy |
| `OUTBOUND_PROXY` | leer | ausgehender Proxy für externe Dienste |

## Tests
Benötigen eine MariaDB mit Datenbank `kritis_test` (Benutzer/Passwort per `DB_USER`/`DB_PASS`, Standard `kritis`/`kritis`):
```
cd backend && composer install && vendor/bin/phpunit
```
Geprüft werden u. a. Login, Sitzungshärtung, CSRF, Ratenbegrenzung, Passwortwechsel, Eingabevalidierung/SQL-Injection und die Rechtematrix (Route × anonym/lesen/admin).
