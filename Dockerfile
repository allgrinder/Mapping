# KRITIS-Lagekarte NRW – vollständiges Anwendungs-Image (Frontend, Backend, Apache). Datenbank: separater MariaDB-Container.
#   docker build -t kritis-lagekarte .
# Alles wird im Image gebaut – auf dem Host sind weder PHP, Composer noch Node nötig.
ARG PHP_VERSION=8.3

FROM node:22-bookworm-slim AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN mkdir -p ../backend/public && npm run build

FROM composer:2 AS vendor
WORKDIR /src/backend
COPY backend/composer.json backend/composer.lock ./
RUN composer install --no-dev --no-interaction --prefer-dist --no-progress --ignore-platform-reqs --no-scripts --optimize-autoloader

FROM php:${PHP_VERSION}-apache-bookworm
# Nur pdo_mysql nachrüsten – alles andere (sodium, mbstring, curl, zlib, opcache) ist im offiziellen Image enthalten
RUN docker-php-ext-install pdo_mysql \
    && a2enmod rewrite headers \
    && a2dissite 000-default \
    && sed -ri 's/^Listen 80$/Listen 8080/' /etc/apache2/ports.conf
RUN { echo 'expose_php=0'; echo 'display_errors=0'; echo 'log_errors=1'; echo 'memory_limit=512M'; \
      echo 'post_max_size=10M'; echo 'upload_max_filesize=10M'; echo 'opcache.enable=1'; echo 'opcache.validate_timestamps=0'; } \
      > /usr/local/etc/php/conf.d/kritis.ini
COPY docker/app/apache.conf /etc/apache2/sites-enabled/kritis.conf
WORKDIR /app
COPY config/ config/
COPY backend/ backend/
COPY --from=vendor /src/backend/vendor/ backend/vendor/
COPY --from=frontend /src/backend/public/ backend/public/
COPY docker/app/entrypoint.sh /usr/local/bin/kritis-entrypoint
RUN rm -rf backend/tests backend/storage/* && mkdir -p backend/storage && chown -R www-data:www-data backend/storage
WORKDIR /app/backend
ENV APP_ENV=production COOKIE_SECURE=false HSTS=false
VOLUME ["/app/backend/storage"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s CMD php -r 'exit(@file_get_contents("http://127.0.0.1:8080/api/health") ? 0 : 1);'
ENTRYPOINT ["kritis-entrypoint"]
