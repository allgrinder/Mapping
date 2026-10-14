<?php
declare(strict_types=1);

namespace Kritis\Tests;

use Kritis\Geo\BoundaryImporter;
use Kritis\Support\ZipReader;

final class ZipReaderTest extends TestCase
{
    private function makeZip(int $method): string
    {
        $file = sys_get_temp_dir() . '/kl-zip-' . bin2hex(random_bytes(4)) . '.zip';
        $src = __DIR__ . '/fixtures/dvg';
        $py = 'import sys,zipfile,os' . "\n"
            . 'z=zipfile.ZipFile(sys.argv[1],"w",int(sys.argv[3]))' . "\n"
            . 'for f in sorted(os.listdir(sys.argv[2])): z.write(os.path.join(sys.argv[2],f),"dvg2_EPSG25832_Shape/"+f)' . "\n"
            . 'z.writestr("dvg2_EPSG25832_Shape/info.txt","Hinweis äöü")' . "\n" . 'z.close()';
        exec('python3 -c ' . escapeshellarg($py) . ' ' . escapeshellarg($file) . ' ' . escapeshellarg($src) . ' ' . $method, $o, $rc);
        $this->assertSame(0, $rc, 'python3 zum Erzeugen der Test-ZIPs benötigt');
        return $file;
    }

    public function testReadsStoredAndDeflatedEntries(): void
    {
        foreach ([0, 8] as $method) {
            $zip = $this->makeZip($method);
            $all = ZipReader::read($zip, fn () => true);
            $this->assertSame('Hinweis äöü', $all['dvg2_EPSG25832_Shape/info.txt']);
            foreach (glob(__DIR__ . '/fixtures/dvg/*') as $f) {
                $this->assertSame(file_get_contents($f), $all['dvg2_EPSG25832_Shape/' . basename($f)], basename($f));
            }
            $shp = ZipReader::read($zip, fn ($n) => str_ends_with($n, '.shp'));
            $this->assertNotEmpty($shp);
            $this->assertSame([], array_filter(array_keys($shp), fn ($n) => !str_ends_with($n, '.shp')));
            unlink($zip);
        }
    }

    public function testRejectsBrokenFilesAndImportsDvgZip(): void
    {
        $bad = tempnam(sys_get_temp_dir(), 'kl');
        file_put_contents($bad, 'kein zip');
        try {
            ZipReader::read($bad, fn () => true);
            $this->fail('Exception erwartet');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('Kein gültiges ZIP', $e->getMessage());
        }
        unlink($bad);
        $zip = $this->makeZip(8);

        (new BoundaryImporter(self::$db, require dirname(__DIR__, 2) . '/config/boundaries.php'))->importDvg($zip);
        $this->assertSame(2, (int) self::$db->query("SELECT COUNT(*) FROM boundaries WHERE level = 'regbez'")->fetchColumn());
        unlink($zip);
    }

    public function testDetectsCorruptedEntry(): void
    {
        $zip = $this->makeZip(0);
        $bytes = file_get_contents($zip);
        $pos = strpos($bytes, 'Hinweis');
        $bytes[$pos] = 'X';
        file_put_contents($zip, $bytes);
        $this->expectExceptionMessage('beschädigt');
        try {
            ZipReader::read($zip, fn ($n) => str_ends_with($n, 'info.txt'));
        } finally {
            unlink($zip);
        }
    }
}
