<?php
declare(strict_types=1);

namespace Kritis\Security;

use PDO;

final class SessionStore
{
    public function __construct(private PDO $db, private int $idleTtl, private int $absoluteTtl)
    {
    }

    public function load(?string $cookieId, ?int $now = null): Session
    {
        $now ??= time();
        if ($cookieId !== null && preg_match('/^[A-Za-z0-9_-]{43}$/', $cookieId)) {
            $st = $this->db->prepare('SELECT user_id, csrf_token, created_at, last_seen FROM sessions WHERE id_hash = ?');
            $st->execute([hash('sha256', $cookieId)]);
            $row = $st->fetch();
            if ($row && $now - (int) $row['last_seen'] <= $this->idleTtl && $now - (int) $row['created_at'] <= $this->absoluteTtl) {
                $s = new Session($cookieId, $row['user_id'] !== null ? (int) $row['user_id'] : null, $row['csrf_token'], (int) $row['created_at']);
                if ($now - (int) $row['last_seen'] > 60) {
                    $this->db->prepare('UPDATE sessions SET last_seen = ? WHERE id_hash = ?')->execute([$now, hash('sha256', $cookieId)]);
                }
                return $s;
            }
            $this->delete($cookieId);
        }
        return new Session(null, null, null, $now);
    }

    /** Persistiert die Sitzung; gibt die (ggf. neue) Cookie-ID zurück oder null, wenn kein Cookie nötig ist. */
    public function save(Session $s, ?int $now = null): ?string
    {
        $now ??= time();
        if ($s->destroyed) {
            if ($s->id !== null) {
                $this->delete($s->id);
            }
            return null;
        }
        if (!$s->dirty) {
            return null;
        }
        if ($s->regenerate && $s->id !== null) {
            $this->delete($s->id);
            $s->id = null;
            $s->createdAt = $now;
        }
        if ($s->id === null) {
            $s->id = Session::randomToken();
            $this->db->prepare('INSERT INTO sessions (id_hash, user_id, csrf_token, created_at, last_seen) VALUES (?,?,?,?,?)')
                ->execute([hash('sha256', $s->id), $s->userId, $s->csrfToken(), $s->createdAt, $now]);
        } else {
            $this->db->prepare('UPDATE sessions SET user_id = ?, csrf_token = ?, last_seen = ? WHERE id_hash = ?')
                ->execute([$s->userId, $s->csrfToken(), $now, hash('sha256', $s->id)]);
        }
        $s->dirty = false;
        $s->regenerate = false;
        return $s->id;
    }

    public function delete(string $cookieId): void
    {
        $this->db->prepare('DELETE FROM sessions WHERE id_hash = ?')->execute([hash('sha256', $cookieId)]);
    }

    public function deleteForUser(int $userId, ?string $exceptCookieId = null): void
    {
        $st = $this->db->prepare('DELETE FROM sessions WHERE user_id = ? AND id_hash <> ?');
        $st->execute([$userId, $exceptCookieId !== null ? hash('sha256', $exceptCookieId) : '']);
    }

    public function purgeExpired(?int $now = null): void
    {
        $now ??= time();
        $this->db->prepare('DELETE FROM sessions WHERE last_seen < ? OR created_at < ?')
            ->execute([$now - $this->idleTtl, $now - $this->absoluteTtl]);
    }
}
