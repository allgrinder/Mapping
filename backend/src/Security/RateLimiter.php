<?php
declare(strict_types=1);

namespace Kritis\Security;

use PDO;

/** Festes Zeitfenster pro Bucket, in der Datenbank gezählt (funktioniert über mehrere PHP-Worker). */
final class RateLimiter
{
    public function __construct(private PDO $db)
    {
    }

    /** Gibt die verbleibenden Sekunden der Sperre zurück oder 0, wenn erlaubt. */
    public function blockedFor(string $bucket, int $max, int $window, ?int $now = null): int
    {
        $now ??= time();
        $st = $this->db->prepare('SELECT hits, window_start FROM rate_limits WHERE bucket = ?');
        $st->execute([$bucket]);
        $row = $st->fetch();
        if (!$row || $now >= (int) $row['window_start'] + $window) {
            return 0;
        }
        return (int) $row['hits'] >= $max ? (int) $row['window_start'] + $window - $now : 0;
    }

    public function hit(string $bucket, int $window, ?int $now = null): void
    {
        $now ??= time();
        $st = $this->db->prepare(
            'INSERT INTO rate_limits (bucket, hits, window_start) VALUES (:b, 1, :n)
             ON DUPLICATE KEY UPDATE
               hits = IF(window_start + :w <= :n2, 1, hits + 1),
               window_start = IF(window_start + :w2 <= :n3, :n4, window_start)'
        );
        $st->execute([':b' => $bucket, ':n' => $now, ':w' => $window, ':n2' => $now, ':w2' => $window, ':n3' => $now, ':n4' => $now]);
    }

    public function reset(string $bucket): void
    {
        $this->db->prepare('DELETE FROM rate_limits WHERE bucket = ?')->execute([$bucket]);
    }
}
