<?php
declare(strict_types=1);

namespace Kritis\Security;

final class PasswordHasher
{
    private const OPTIONS = ['memory_cost' => 65536, 'time_cost' => 4, 'threads' => 1];

    public function hash(string $password): string
    {
        return password_hash($password, PASSWORD_ARGON2ID, self::OPTIONS);
    }

    public function verify(string $password, string $hash): bool
    {
        return password_verify($password, $hash);
    }

    public function needsRehash(string $hash): bool
    {
        return password_needs_rehash($hash, PASSWORD_ARGON2ID, self::OPTIONS);
    }

    /** Dummy-Hash, damit Login-Zeit für unbekannte Benutzer nicht auffällt. */
    public function dummy(): string
    {
        static $h = null;
        return $h ??= $this->hash('dummy-' . bin2hex(random_bytes(8)));
    }
}
