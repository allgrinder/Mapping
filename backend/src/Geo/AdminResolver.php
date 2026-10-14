<?php
declare(strict_types=1);

namespace Kritis\Geo;

use PDO;

/** Ermittelt per Point-in-Polygon Regierungsbezirk, Kreis, Gemeinde und PLZ eines Punkts (WGS84). */
final class AdminResolver
{
    public function __construct(private PDO $db)
    {
    }

    /** @return array{regbez:?string,kreis:?string,gemeinde:?string,plz5:?string,inNrw:bool} */
    public function resolve(float $lon, float $lat): array
    {
        $st = $this->db->prepare("SELECT level, code FROM boundaries
            WHERE level IN ('land','regbez','kreis','gemeinde','plz5')
              AND MBRContains(geom, ST_GeomFromText(:p1)) AND ST_Contains(geom, ST_GeomFromText(:p2))");
        $pt = sprintf('POINT(%.7F %.7F)', $lon, $lat);
        $st->execute([':p1' => $pt, ':p2' => $pt]);
        $out = ['regbez' => null, 'kreis' => null, 'gemeinde' => null, 'plz5' => null, 'inNrw' => false];
        foreach ($st->fetchAll() as $r) {
            if ($r['level'] === 'land') {
                $out['inNrw'] = true;
            } else {
                $out[$r['level']] ??= $r['code'];
            }
        }
        if ($out['regbez'] || $out['kreis']) {
            $out['inNrw'] = true;
        }
        return $out;
    }
}
