/**
 * Minimal, safe Markdown renderer for assistant text (`public/js/markdown.js`).
 * All input is HTML-escaped first; only a fixed set of Markdown constructs is turned back into tags
 * (headings, lists, blockquotes, fenced/inline code, bold, italic, http(s) links). No raw HTML passes through.
 */

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Inline formatting on an already-escaped line
function renderInline(escaped) {
  const codeSpans = [];
  let out = escaped.replace(/`([^`]+)`/g, (_, code) => {
    codeSpans.push(`<code>${code}</code>`);
    return `\u0000${codeSpans.length - 1}\u0000`;
  });

  out = out
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => codeSpans[Number(i)]);
}

export function renderMarkdown(text = "") {
  const lines = String(text).replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let paragraph = [];
  let list = null; // { tag: "ul" | "ol", items: [] }

  const flushParagraph = () => {
    if (paragraph.length) {
      html.push(`<p>${paragraph.map((l) => renderInline(escapeHtml(l))).join("<br>")}</p>`);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      html.push(`<${list.tag}>${list.items.map((i) => `<li>${renderInline(escapeHtml(i))}</li>`).join("")}</${list.tag}>`);
      list = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fence = line.match(/^```\s*([\w+-]*)\s*$/);
    if (fence) {
      flushParagraph();
      flushList();
      const code = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      const lang = fence[1] ? ` data-lang="${escapeHtml(fence[1])}"` : "";
      html.push(`<pre${lang}><button type="button" class="md-copy-btn">Copy</button><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(3, heading[1].length);
      html.push(`<h${level}>${renderInline(escapeHtml(heading[2]))}</h${level}>`);
      continue;
    }

    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      flushParagraph();
      const tag = bullet ? "ul" : "ol";
      if (list && list.tag !== tag) flushList();
      if (!list) list = { tag, items: [] };
      list.items.push((bullet || numbered)[1]);
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      flushList();
      html.push(`<blockquote>${renderInline(escapeHtml(quote[1]))}</blockquote>`);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return html.join("");
}

// Wire up the copy buttons inside rendered code blocks
export function bindMarkdownCopyButtons(root) {
  root.querySelectorAll(".md-copy-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const code = btn.parentElement.querySelector("code")?.textContent || "";
      navigator.clipboard.writeText(code).then(() => {
        btn.textContent = "Copied";
        setTimeout(() => (btn.textContent = "Copy"), 1200);
      });
    });
  });
}
