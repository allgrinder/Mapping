<?php
declare(strict_types=1);

/**
 * Notfall: neues Einmalpasswort für einen Benutzer setzen (z. B. wenn das Admin-Initialpasswort verloren ging).
 *   php bin/reset-password.php admin
 * Bestehende Sitzungen des Benutzers werden beendet; das Passwort muss bei der nächsten Anmeldung geändert werden.
 */

require __DIR__ . '/../vendor/autoload.php';

use Kritis\Security\PasswordHasher;
use Kritis\Security\PasswordPolicy;
use Kritis\Support\Config;
use Kritis\Support\Database;

$user = $argv[1] ?? '';
if ($user === '') {
    fwrite(STDERR, "Aufruf: php bin/reset-password.php BENUTZERNAME\n");
    exit(1);
}
$db = Database::connect(Config::load());
$st = $db->prepare('SELECT id FROM users WHERE username = ?');
$st->execute([$user]);
$id = $st->fetchColumn();
if (!$id) {
    fwrite(STDERR, "Benutzer „{$user}“ nicht gefunden.\n");
    exit(2);
}
$pw = PasswordPolicy::generate();
$db->prepare('UPDATE users SET password_hash = ?, must_change_password = 1, active = 1, updated_at = UTC_TIMESTAMP() WHERE id = ?')
    ->execute([(new PasswordHasher())->hash($pw), $id]);
$db->prepare('DELETE FROM sessions WHERE user_id = ?')->execute([$id]);
$db->prepare('INSERT INTO audit_log (user_id, action, detail) VALUES (NULL, "password_reset_cli", ?)')->execute([$user]);
echo "Neues Einmalpasswort für $user: $pw\n";
