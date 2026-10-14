ARG PHP_VERSION=8.3
FROM php:${PHP_VERSION}-fpm-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends libsodium-dev libicu-dev unzip git \
    && docker-php-ext-install pdo_mysql intl opcache \
    && rm -rf /var/lib/apt/lists/*
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
RUN { echo 'expose_php=0'; echo 'display_errors=0'; echo 'log_errors=1'; echo 'session.use_strict_mode=1'; } > /usr/local/etc/php/conf.d/hardening.ini
WORKDIR /app/backend
