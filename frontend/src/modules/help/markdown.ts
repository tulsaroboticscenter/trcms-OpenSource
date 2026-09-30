import DOMPurify from "dompurify";

/**
 * Small, self-contained Markdown → sanitized HTML renderer for help articles.
 * Supports headings, bold/italic, inline code, fenced code, links, images,
 * ordered/unordered lists, blockquotes, horizontal rules, and paragraphs.
 * HTML in the source is escaped first, then DOMPurify sanitizes the output.
 */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Placeholder delimiter: a NUL char, which cannot appear in escaped article text.
const TOK = String.fromCharCode(0xE000);

function inline(s: string): string {
  // Stash links/images/inline-code as placeholder tokens BEFORE the emphasis pass,
  // so `_` or `*` inside a URL are never mistaken for italics/bold. Without this a URL
  // like reg_2.cfm renders as reg<em>2.cfm — the underscore becomes an <em> tag and the
  // link breaks (worse when the link text is also the URL: the two underscores pair up).
  const tokens: string[] = [];
  const stash = (html: string) => `${TOK}${tokens.push(html) - 1}${TOK}`;

  // images ![alt](url) then links [text](url)
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt, url) => stash(`<img src="${url}" alt="${alt}" style="max-width:100%" />`));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text, url) => stash(`<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`));
  s = s.replace(/`([^`]+)`/g, (_m, c) => stash(`<code>${c}</code>`));

  // Emphasis — safe now that links/code are out of the string.
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  s = s.replace(/_([^_]+)_/g, "<em>$1</em>");

  // Restore stashed tokens. Loop (comparing strings, not regex state) covers the rare
  // image-inside-link nesting; a fresh regex each pass avoids /g lastIndex pitfalls.
  let prev = "";
  while (s !== prev) { prev = s; s = s.replace(new RegExp(`${TOK}(\\d+)${TOK}`, "g"), (_m, n) => tokens[Number(n)] ?? ""); }
  return s;
}

export function renderMarkdown(src: string): string {
  const lines = esc(src ?? "").replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let i = 0;
  let listType: "ul" | "ol" | null = null;
  const closeList = () => { if (listType) { html.push(`</${listType}>`); listType = null; } };

  while (i < lines.length) {
    const line = lines[i];

    // fenced code block
    if (/^```/.test(line)) {
      closeList();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      html.push(`<pre><code>${buf.join("\n")}</code></pre>`);
      continue;
    }
    // heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { closeList(); const n = h[1].length; html.push(`<h${n}>${inline(h[2])}</h${n}>`); i++; continue; }
    // horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { closeList(); html.push("<hr />"); i++; continue; }
    // blockquote
    if (/^>\s?/.test(line)) {
      closeList();
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, "")); i++; }
      html.push(`<blockquote>${inline(buf.join(" "))}</blockquote>`);
      continue;
    }
    // unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      if (listType !== "ul") { closeList(); html.push("<ul>"); listType = "ul"; }
      html.push(`<li>${inline(line.replace(/^\s*[-*+]\s+/, ""))}</li>`);
      i++; continue;
    }
    // ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      if (listType !== "ol") { closeList(); html.push("<ol>"); listType = "ol"; }
      html.push(`<li>${inline(line.replace(/^\s*\d+\.\s+/, ""))}</li>`);
      i++; continue;
    }
    // blank line
    if (/^\s*$/.test(line)) { closeList(); i++; continue; }
    // paragraph (gather consecutive non-blank, non-block lines)
    closeList();
    const para: string[] = [line];
    i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6}\s|```|>\s?|\s*[-*+]\s+|\s*\d+\.\s+|(-{3,}|\*{3,}|_{3,})\s*$)/.test(lines[i])) {
      para.push(lines[i]); i++;
    }
    html.push(`<p>${inline(para.join("<br />"))}</p>`);
  }
  closeList();

  return DOMPurify.sanitize(html.join("\n"), { ADD_ATTR: ["target", "rel"] });
}
