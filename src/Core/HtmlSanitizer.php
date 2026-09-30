<?php
declare(strict_types=1);

namespace App\Core;

use DOMComment;
use DOMDocument;
use DOMElement;
use DOMNode;

/**
 * Allowlist HTML sanitizer for rich-text stored server-side (security finding #2).
 *
 * Parses the input into a DOM tree (ext-dom) and rebuilds it keeping only an allowlist of tags
 * and attributes — this is a parse-tree walk, not a regex, so it is not defeated by the usual
 * regex-sanitizer bypasses. It is matched to what the TipTap RichTextEditor emits (headings,
 * lists, links, images, alignment). Anything else — <script>, <style>, <iframe>, event handlers,
 * javascript:/data: URLs, unknown attributes — is dropped.
 *
 * This is the WRITE-side layer. Rendered output is sanitized again with DOMPurify on the client,
 * and a Content-Security-Policy is the final backstop.
 */
final class HtmlSanitizer
{
    /** tag => list of attributes allowed on it. */
    private const ALLOWED = [
        'p' => ['style'], 'br' => [], 'span' => ['style'], 'div' => ['style'],
        'strong' => [], 'b' => [], 'em' => [], 'i' => [], 'u' => [], 's' => [], 'strike' => [],
        'h1' => ['style'], 'h2' => ['style'], 'h3' => ['style'], 'h4' => ['style'], 'h5' => ['style'], 'h6' => ['style'],
        'ul' => [], 'ol' => [], 'li' => [], 'blockquote' => [], 'pre' => [], 'code' => [], 'hr' => [],
        'a' => ['href', 'title', 'target', 'rel'],
        'img' => ['src', 'alt', 'title', 'style'],
    ];

    /** Tags whose entire subtree is discarded (not unwrapped) — script/style/etc carry the payload. */
    private const STRIP_TREE = [
        'script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'button',
        'select', 'option', 'svg', 'math', 'link', 'meta', 'base', 'template', 'noscript',
        'title', 'head', 'frame', 'frameset', 'applet', 'audio', 'video', 'source',
    ];

    private const ALLOWED_STYLE_PROPS = ['text-align', 'max-width', 'width', 'height'];

    /** Sanitize a rich-text HTML fragment. Returns '' for empty/blank input. */
    public static function clean(?string $html): string
    {
        $html = (string)$html;
        if (trim($html) === '') return '';

        $doc = new DOMDocument('1.0', 'UTF-8');
        $prev = libxml_use_internal_errors(true);
        // <meta charset> pins UTF-8; the explicit <body> gives us a stable node to read back from.
        $doc->loadHTML(
            '<meta http-equiv="Content-Type" content="text/html; charset=utf-8"><body>' . $html . '</body>',
            LIBXML_NONET | LIBXML_NOWARNING | LIBXML_NOERROR
        );
        libxml_clear_errors();
        libxml_use_internal_errors($prev);

        $body = $doc->getElementsByTagName('body')->item(0);
        if (!$body) return '';
        self::walk($body);

        $out = '';
        foreach (iterator_to_array($body->childNodes) as $child) {
            $out .= $doc->saveHTML($child);
        }
        return trim($out);
    }

    private static function walk(DOMNode $node): void
    {
        // Snapshot children first — we mutate the live child list as we go.
        foreach (iterator_to_array($node->childNodes) as $child) {
            if ($child instanceof DOMComment) {
                $node->removeChild($child);   // comments can carry conditional-comment / mXSS payloads
                continue;
            }
            if (!($child instanceof DOMElement)) {
                continue;                     // text nodes are safe; DOM re-encodes entities on serialize
            }
            $tag = strtolower($child->nodeName);

            if (in_array($tag, self::STRIP_TREE, true)) {
                $node->removeChild($child);
                continue;
            }

            if (!isset(self::ALLOWED[$tag])) {
                // Unknown but not dangerous: clean its descendants, then unwrap (keep the text).
                self::walk($child);
                while ($child->firstChild) {
                    $node->insertBefore($child->firstChild, $child);
                }
                $node->removeChild($child);
                continue;
            }

            self::scrubAttributes($child, $tag);
            self::walk($child);               // recurse into kept element
        }
    }

    private static function scrubAttributes(DOMElement $el, string $tag): void
    {
        $allowed = self::ALLOWED[$tag];
        foreach (iterator_to_array($el->attributes) as $attr) {
            $name = strtolower($attr->nodeName);
            if (str_starts_with($name, 'on') || !in_array($name, $allowed, true)) {
                $el->removeAttribute($attr->nodeName);
                continue;
            }
            if (($name === 'href' || $name === 'src') && !self::safeUrl($attr->nodeValue, $name === 'src')) {
                $el->removeAttribute($attr->nodeName);
                continue;
            }
            if ($name === 'style') {
                $clean = self::safeStyle($attr->nodeValue);
                if ($clean === '') $el->removeAttribute('style');
                else $el->setAttribute('style', $clean);
            }
        }
        // A link opening a new tab must not leak window.opener.
        if ($tag === 'a' && $el->getAttribute('target') !== '') {
            $el->setAttribute('rel', 'noopener noreferrer');
        }
    }

    /** True if a URL is safe to keep. Images: http/https/relative only. Links: also mailto/tel. */
    private static function safeUrl(?string $url, bool $isImage): bool
    {
        $url = trim((string)$url);
        if ($url === '') return false;
        // Strip whitespace and control chars an attacker can splice into a scheme ("java\tscript:").
        $stripped = preg_replace('/[\s\x00-\x1F\x7F]+/', '', $url) ?? '';
        if ($stripped === '') return false;

        // Determine a scheme only if a ':' appears before any '/', '?' or '#'.
        $colon = strpos($stripped, ':');
        if ($colon !== false) {
            $delim = strcspn($stripped, '/?#');
            if ($colon < $delim) {
                $scheme = strtolower(substr($stripped, 0, $colon));
                $ok = $isImage ? ['http', 'https'] : ['http', 'https', 'mailto', 'tel'];
                return in_array($scheme, $ok, true);
            }
        }
        // No scheme → relative path, anchor, or protocol-relative //host — all fine.
        return true;
    }

    /** Keep only a safe subset of inline CSS declarations. */
    private static function safeStyle(?string $style): string
    {
        $out = [];
        foreach (explode(';', (string)$style) as $decl) {
            if (strpos($decl, ':') === false) continue;
            [$prop, $val] = array_map('trim', explode(':', $decl, 2));
            $prop = strtolower($prop);
            if (!in_array($prop, self::ALLOWED_STYLE_PROPS, true)) continue;
            if ($val === '' || preg_match('/url\s*\(|expression|javascript|[<>]/i', $val)) continue;
            $out[] = "{$prop}:{$val}";
        }
        return implode('; ', $out);
    }
}
