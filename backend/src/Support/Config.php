<?php
declare(strict_types=1);

namespace Kritis\Support;

final class Config
{
    /** @param array<string,mixed> $data */
    public function __construct(private array $data)
    {
    }

    public static function load(?string $file = null): self
    {
        $file ??= dirname(__DIR__, 3) . '/config/app.php';
        return new self(require $file);
    }

    public function get(string $path, mixed $default = null): mixed
    {
        $cur = $this->data;
        foreach (explode('.', $path) as $seg) {
            if (!is_array($cur) || !array_key_exists($seg, $cur)) {
                return $default;
            }
            $cur = $cur[$seg];
        }
        return $cur;
    }

    /** @param array<string,mixed> $overrides dotted paths */
    public function with(array $overrides): self
    {
        $data = $this->data;
        foreach ($overrides as $path => $value) {
            $ref = &$data;
            foreach (explode('.', $path) as $seg) {
                if (!isset($ref[$seg]) || !is_array($ref[$seg])) {
                    $ref[$seg] = $ref[$seg] ?? [];
                }
                $ref = &$ref[$seg];
            }
            $ref = $value;
            unset($ref);
        }
        return new self($data);
    }
}
