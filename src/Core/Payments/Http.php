<?php
declare(strict_types=1);

namespace App\Core\Payments;

/** Minimal JSON-over-HTTPS helper (cURL) so we need no extra composer deps. */
final class Http
{
    /**
     * @return array{status:int, body:array, raw:string}
     * @throws \RuntimeException on transport failure
     */
    public static function request(string $method, string $url, array $headers = [], ?array $json = null): array
    {
        $ch = curl_init($url);
        $hdr = [];
        foreach ($headers as $k => $v) $hdr[] = "$k: $v";
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 30,
            CURLOPT_HTTPHEADER => $hdr,
        ]);
        if ($json !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($json));
        }
        $raw = curl_exec($ch);
        if ($raw === false) {
            $err = curl_error($ch); curl_close($ch);
            throw new \RuntimeException("Payment provider request failed: $err");
        }
        $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        $body = json_decode((string)$raw, true);
        return ['status' => $status, 'body' => is_array($body) ? $body : [], 'raw' => (string)$raw];
    }
}
