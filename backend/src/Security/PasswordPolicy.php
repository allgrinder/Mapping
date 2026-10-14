<?php
declare(strict_types=1);

namespace Kritis\Security;

use Kritis\Support\HttpException;

final class PasswordPolicy
{
    public function __construct(private int $minLength = 12)
    {
    }

    public function assert(string $password, string $username, ?string $currentHash = null): void
    {
        $err = null;
        if (mb_strlen($password) < $this->minLength) {
            $err = "Das Passwort muss mindestens {$this->minLength} Zeichen lang sein.";
        } elseif (mb_strlen($password) > 256) {
            $err = 'Das Passwort ist zu lang.';
        } elseif (stripos($password, $username) !== false) {
            $err = 'Das Passwort darf den Benutzernamen nicht enthalten.';
        } elseif (!preg_match('/\p{Ll}/u', $password) || !preg_match('/\p{Lu}/u', $password) || !preg_match('/[\p{N}\p{P}\p{S}]/u', $password)) {
            $err = 'Das Passwort braucht Groß- und Kleinbuchstaben sowie mindestens eine Ziffer oder ein Sonderzeichen.';
        } elseif ($currentHash !== null && password_verify($password, $currentHash)) {
            $err = 'Das neue Passwort muss sich vom bisherigen unterscheiden.';
        }
        if ($err !== null) {
            throw new HttpException(422, 'weak_password', $err, ['newPassword' => $err]);
        }
    }

    /** Zufälliges Initialpasswort (erfüllt die Policy). */
    public static function generate(): string
    {
        $alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        $pw = '';
        for ($i = 0; $i < 16; $i++) {
            $pw .= $alphabet[random_int(0, strlen($alphabet) - 1)];
        }
        return substr($pw, 0, 6) . '-' . substr($pw, 6, 5) . '7' . substr($pw, 11) . 'aK';
    }
}
