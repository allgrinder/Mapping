<?php
declare(strict_types=1);

namespace Kritis\Support;

/**
 * Minimaler ZIP-Leser (gespeichert/Deflate) ohne ext-zip – nutzt nur zlib, das in jedem PHP enthalten ist.
 * Reicht für Datenpakete wie das DVG-Shape-ZIP; kein ZIP64, keine Verschlüsselung.
 */
final class ZipReader
{
    /** @return array<string,string> Name → Inhalt der Einträge, für die $accept(name) true liefert */
    public static function read(string $path, callable $accept, int $maxBytes = 1_000_000_000): array
    {
        $fh = @fopen($path, 'rb');
        if (!$fh) {
            throw new \RuntimeException("ZIP nicht lesbar: $path");
        }
        try {
            $size = (int) fstat($fh)['size'];
            $tailLen = min($size, 65557); // EOCD (22 Byte) + max. Kommentar
            fseek($fh, $size - $tailLen);
            $tail = (string) fread($fh, $tailLen);
            $eocd = strrpos($tail, "PK\x05\x06");
            if ($eocd === false || strlen($tail) - $eocd < 22) {
                throw new \RuntimeException("Kein gültiges ZIP: $path");
            }
            $e = unpack('vdisk/vcdDisk/ventriesDisk/ventries/VcdSize/VcdOffset', substr($tail, $eocd + 4, 16));
            if ($e['cdOffset'] === 0xFFFFFFFF || $e['entries'] === 0xFFFF) {
                throw new \RuntimeException('ZIP64 wird nicht unterstützt.');
            }
            fseek($fh, $e['cdOffset']);
            $cd = (string) fread($fh, $e['cdSize']);
            $out = [];
            $total = 0;
            for ($p = 0, $i = 0; $i < $e['entries']; $i++) {
                if (substr($cd, $p, 4) !== "PK\x01\x02") {
                    throw new \RuntimeException('ZIP-Verzeichnis beschädigt.');
                }
                $h = unpack('vmade/vneed/vflags/vmethod/vtime/vdate/Vcrc/Vcsize/Vusize/vnlen/vxlen/vclen/vdisk/vint/Vext/Voffset', substr($cd, $p + 4, 42));
                $name = substr($cd, $p + 46, $h['nlen']);
                $p += 46 + $h['nlen'] + $h['xlen'] + $h['clen'];
                if (str_ends_with($name, '/') || !$accept($name)) {
                    continue;
                }
                if ($h['flags'] & 1) {
                    throw new \RuntimeException("Verschlüsselter Eintrag: $name");
                }
                $total += $h['usize'];
                if ($total > $maxBytes) {
                    throw new \RuntimeException('ZIP-Inhalt zu groß.');
                }
                fseek($fh, $h['offset']);
                $lh = (string) fread($fh, 30);
                if (substr($lh, 0, 4) !== "PK\x03\x04") {
                    throw new \RuntimeException("Lokaler Kopf fehlt: $name");
                }
                $l = unpack('vnlen/vxlen', substr($lh, 26, 4));
                fseek($fh, $h['offset'] + 30 + $l['nlen'] + $l['xlen']);
                $raw = $h['csize'] > 0 ? (string) fread($fh, $h['csize']) : '';
                $data = match ($h['method']) {
                    0 => $raw,
                    8 => @gzinflate($raw, max($h['usize'], 1)),
                    default => throw new \RuntimeException("Komprimierung {$h['method']} nicht unterstützt: $name"),
                };
                if ($data === false || strlen($data) !== $h['usize'] || (crc32($data) & 0xFFFFFFFF) !== $h['crc']) {
                    throw new \RuntimeException("Eintrag beschädigt: $name");
                }
                $out[$name] = $data;
            }
            return $out;
        } finally {
            fclose($fh);
        }
    }
}
