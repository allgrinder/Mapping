<?php
declare(strict_types=1);

namespace Kritis\Support;

class HttpException extends \RuntimeException
{
    /** @param array<string,string> $fields */
    public function __construct(
        public readonly int $status,
        public readonly string $errorCode,
        string $message,
        public readonly array $fields = [],
        public readonly array $headers = [],
    ) {
        parent::__construct($message);
    }
}
