<?php
declare(strict_types=1);

namespace Kritis\Support;

final class Normalize
{
    /** Vergleichsschlüssel für Dublettenerkennung: Name|PLZ|Straße, ohne Groß-/Kleinschreibung, Umlaute, Satzzeichen. */
    public static function facilityKey(string $name, ?string $zip, ?string $street): string
    {
        $n = static function (?string $s): string {
            $s = mb_strtolower(trim((string) $s));
            $s = strtr($s, ['ä' => 'ae', 'ö' => 'oe', 'ü' => 'ue', 'ß' => 'ss', 'str.' => 'strasse', 'straße' => 'strasse']);
            return preg_replace('/[^a-z0-9]+/', '', $s) ?? '';
        };
        return mb_substr($n($name) . '|' . $n($zip) . '|' . $n($street), 0, 255);
    }
}
