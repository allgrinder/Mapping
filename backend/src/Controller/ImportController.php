<?php
declare(strict_types=1);

namespace Kritis\Controller;

use Kritis\Support\HttpException;
use Kritis\Support\Json;
use Kritis\Support\Normalize;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Übernahme eines im Browser geprüften Imports (Excel/CSV). Der Server validiert jede Zeile erneut mit denselben Regeln
 * wie das Formular, prüft Dubletten gegen den Bestand und innerhalb der Datei und schreibt alles oder nichts.
 */
final class ImportController
{
    public const MAX_ROWS = 5000;

    public function __construct(private PDO $db, private FacilityController $facilities)
    {
    }

    public function commit(Request $req, Response $res): Response
    {
        $body = (array) $req->getParsedBody();
        $rows = $body['rows'] ?? null;
        if (!is_array($rows) || !array_is_list($rows) || $rows === []) {
            throw new HttpException(422, 'validation_failed', 'Keine Zeilen zum Import.', ['rows' => 'Keine Zeilen zum Import.']);
        }
        if (count($rows) > self::MAX_ROWS) {
            throw new HttpException(422, 'validation_failed', 'Höchstens ' . self::MAX_ROWS . ' Zeilen je Import.', ['rows' => 'Zu viele Zeilen.']);
        }
        $fileName = is_string($body['fileName'] ?? null) ? mb_substr(trim($body['fileName']), 0, 200) : '';
        $batch = 'imp-' . gmdate('Ymd-His') . '-' . bin2hex(random_bytes(4));

        $errors = [];
        $valid = [];
        $seenKeys = [];
        $seenExt = [];
        $keyStmt = $this->db->prepare('SELECT id FROM facilities WHERE normalized_key = ? LIMIT 1');
        $extStmt = $this->db->prepare('SELECT id FROM facilities WHERE external_id = ? LIMIT 1');
        $idStmt = $this->db->prepare('SELECT 1 FROM facilities WHERE id = ?');
        foreach ($rows as $i => $r) {
            $line = is_array($r) && is_int($r['row'] ?? null) ? $r['row'] : $i + 1;
            if (!is_array($r) || !is_array($r['data'] ?? null) || !in_array($r['action'] ?? null, ['create', 'update'], true)) {
                $errors[] = ['row' => $line, 'fields' => ['_' => 'Ungültiger Zeilenaufbau.']];
                continue;
            }
            $id = null;
            if ($r['action'] === 'update') {
                $id = $r['id'] ?? null;
                $idStmt->execute([is_int($id) ? $id : 0]);
                if (!is_int($id) || !$idStmt->fetchColumn()) {
                    $errors[] = ['row' => $line, 'fields' => ['_' => 'Zu aktualisierende Einrichtung existiert nicht (mehr).']];
                    continue;
                }
            }
            try {
                $data = $this->facilities->validate(['importBatchId' => $batch] + $r['data'], true);
            } catch (HttpException $e) {
                $errors[] = ['row' => $line, 'fields' => $e->fields ?: ['_' => $e->getMessage()]];
                continue;
            }
            $data['importBatchId'] = $batch;
            $key = Normalize::facilityKey($data['name'], $data['zip'], $data['street']);
            $ext = $data['externalId'];
            $dup = null;
            if (isset($seenKeys[$key]) || ($ext !== null && isset($seenExt[$ext]))) {
                $dup = 'Doppelt in der Datei (Zeile ' . ($seenKeys[$key] ?? $seenExt[$ext]) . ').';
            } elseif ($r['action'] === 'create') {
                $keyStmt->execute([$key]);
                $hit = $keyStmt->fetchColumn();
                if (!$hit && $ext !== null) {
                    $extStmt->execute([$ext]);
                    $hit = $extStmt->fetchColumn();
                }
                if ($hit) {
                    $dup = 'Dublette zu bestehender Einrichtung #' . $hit . '.';
                }
            }
            if ($dup !== null) {
                $errors[] = ['row' => $line, 'fields' => ['_' => $dup], 'duplicate' => true];
                continue;
            }
            $seenKeys[$key] = $line;
            if ($ext !== null) {
                $seenExt[$ext] = $line;
            }
            $valid[] = [$r['action'], $id, $data];
        }
        if ($errors) {
            return Json::respond($res, ['error' => [
                'code' => 'import_invalid',
                'message' => count($errors) . ' Zeile(n) fehlerhaft – es wurde nichts importiert.',
                'rows' => array_slice($errors, 0, 1000),
            ]], 422);
        }

        $actor = (int) $req->getAttribute('user')['id'];
        $created = $updated = 0;
        $this->db->beginTransaction();
        try {
            foreach ($valid as [$action, $id, $data]) {
                if ($action === 'create') {
                    $this->facilities->insert($data, $actor);
                    $created++;
                } else {
                    $this->facilities->store($id, $data, $actor);
                    $updated++;
                }
            }
            $this->db->prepare('INSERT INTO audit_log (user_id, action, detail) VALUES (?, "facilities_imported", ?)')
                ->execute([$actor, mb_substr("$batch: $created neu, $updated aktualisiert" . ($fileName !== '' ? " aus $fileName" : ''), 0, 500)]);
            $this->db->commit();
        } catch (\Throwable $e) {
            $this->db->rollBack();
            throw $e;
        }
        return Json::respond($res, ['batchId' => $batch, 'created' => $created, 'updated' => $updated]);
    }
}
