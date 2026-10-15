<?php
declare(strict_types=1);

namespace Kritis\Support;

/** Ausgehende HTTP-Anfragen (nur zu konfigurierten Diensten) über den optionalen IT.NRW-Proxy. */
class HttpClient
{
    /** @param int $maxBytes Obergrenze je Antwort (Schutz vor übergroßen Antworten); große Datenabrufe setzen sie gezielt höher */
    public function __construct(private string $proxy = '', private int $timeout = 10, private string $userAgent = 'KRITIS-Lagekarte-NRW/1.0', private int $maxBytes = 20_000_000)
    {
    }

    /** @return array{status:int, body:string, contentType:string} */
    public function get(string $url): array
    {
        if (!preg_match('#^https?://#i', $url)) {
            throw new \InvalidArgumentException('Nur HTTP(S)-URLs erlaubt.');
        }
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => min(5, $this->timeout),
            CURLOPT_TIMEOUT => $this->timeout,
            CURLOPT_USERAGENT => $this->userAgent,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_MAXFILESIZE => $this->maxBytes,
            CURLOPT_ENCODING => '', // gzip/deflate annehmen – spart bei großen Antworten (Overpass) viel Übertragung
        ]);
        if ($this->proxy !== '') {
            curl_setopt($ch, CURLOPT_PROXY, $this->proxy);
        }
        $body = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $type = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
        $err = curl_error($ch);
        curl_close($ch);
        if ($body === false) {
            throw new \RuntimeException('Dienst nicht erreichbar: ' . $err);
        }
        return ['status' => $status, 'body' => (string) $body, 'contentType' => $type];
    }
}
