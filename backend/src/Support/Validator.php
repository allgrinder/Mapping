<?php
declare(strict_types=1);

namespace Kritis\Support;

/** Strikte Eingabevalidierung: nur Skalare der erwarteten Typen, keine verschachtelten Strukturen. */
final class Validator
{
    /** @var array<string,string> */
    private array $errors = [];

    /** @param array<string,mixed> $data */
    public function __construct(private array $data)
    {
    }

    public function string(string $key, int $min = 1, int $max = 255, ?string $pattern = null, bool $trim = true): string
    {
        $v = $this->data[$key] ?? null;
        if (!is_string($v)) {
            $this->errors[$key] = 'Pflichtfeld (Text erwartet).';
            return '';
        }
        if ($trim) {
            $v = trim($v);
        }
        $len = mb_strlen($v);
        if (!mb_check_encoding($v, 'UTF-8') || preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', $v)) {
            $this->errors[$key] = 'Ungültige Zeichen.';
        } elseif ($len < $min || $len > $max) {
            $this->errors[$key] = "Länge muss zwischen $min und $max Zeichen liegen.";
        } elseif ($pattern !== null && !preg_match($pattern, $v)) {
            $this->errors[$key] = 'Ungültiges Format.';
        }
        return $v;
    }

    /** @param list<string> $allowed */
    public function enum(string $key, array $allowed): string
    {
        $v = $this->data[$key] ?? null;
        if (!is_string($v) || !in_array($v, $allowed, true)) {
            $this->errors[$key] = 'Ungültiger Wert.';
            return $allowed[0];
        }
        return $v;
    }

    public function bool(string $key, bool $default): bool
    {
        if (!array_key_exists($key, $this->data)) {
            return $default;
        }
        if (!is_bool($this->data[$key])) {
            $this->errors[$key] = 'Wahrheitswert erwartet.';
            return $default;
        }
        return $this->data[$key];
    }

    public function has(string $key): bool
    {
        return array_key_exists($key, $this->data);
    }

    public function fail(string $key, string $msg): void
    {
        $this->errors[$key] = $msg;
    }

    public function assertValid(): void
    {
        if ($this->errors) {
            throw new HttpException(422, 'validation_failed', 'Eingaben ungültig.', $this->errors);
        }
    }
}
