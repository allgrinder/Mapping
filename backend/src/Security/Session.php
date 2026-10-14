<?php
declare(strict_types=1);

namespace Kritis\Security;

/** Sitzung eines Requests. Die Persistenz übernimmt SessionStore. */
final class Session
{
    public bool $dirty = false;
    public bool $regenerate = false;
    public bool $destroyed = false;

    public function __construct(
        public ?string $id,
        public ?int $userId,
        private ?string $csrf,
        public int $createdAt,
    ) {
    }

    public function csrfToken(): string
    {
        if ($this->csrf === null) {
            $this->csrf = self::randomToken();
            $this->dirty = true;
        }
        return $this->csrf;
    }

    public function peekCsrf(): ?string
    {
        return $this->csrf;
    }

    public function login(int $userId): void
    {
        $this->userId = $userId;
        $this->csrf = self::randomToken();
        $this->regenerate = true;
        $this->dirty = true;
    }

    public function regenerate(): void
    {
        $this->csrf = self::randomToken();
        $this->regenerate = true;
        $this->dirty = true;
    }

    public function destroy(): void
    {
        $this->destroyed = true;
        $this->userId = null;
        $this->dirty = true;
    }

    public static function randomToken(): string
    {
        return rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    }
}
