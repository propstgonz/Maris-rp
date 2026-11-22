import { escapeHtml } from './html';

function safeHref(alreadyHtmlEscaped: string): string | null {
  const url = alreadyHtmlEscaped.trim();
  if (!/^(https?:\/\/|\/|#)/i.test(url)) return null;
  return url.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function inlineMd(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (whole, label: string, url: string) => {
      const href = safeHref(url);
      return href ? `<a href="${href}" target="_blank" rel="noopener">${label}</a>` : whole;
    });
}

export function renderMarkdown(md: string): string {
  const lines = md.split('\n');
  const htmlParts: string[] = [];
  let inList = false, inCodeBlock = false, inBlockquote = false;
  let codeBuffer: string[] = [];

  function closeList() { if (inList) { htmlParts.push('</ul>'); inList = false; } }
  function closeBlockquote() { if (inBlockquote) { htmlParts.push('</blockquote>'); inBlockquote = false; } }

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) { htmlParts.push(`<pre><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`); codeBuffer = []; inCodeBlock = false; }
      else { closeList(); closeBlockquote(); inCodeBlock = true; }
      continue;
    }
    if (inCodeBlock) { codeBuffer.push(line); continue; }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) { closeList(); closeBlockquote(); htmlParts.push(`<h${heading[1].length}>${inlineMd(heading[2])}</h${heading[1].length}>`); continue; }

    if (line.trim() === '---') { closeList(); closeBlockquote(); htmlParts.push('<hr>'); continue; }

    if (line.trim().startsWith('- ')) {
      closeBlockquote();
      if (!inList) { htmlParts.push('<ul>'); inList = true; }
      htmlParts.push(`<li>${inlineMd(line.trim().slice(2))}</li>`);
      continue;
    }
    closeList();

    if (line.trim().startsWith('> ')) {
      if (!inBlockquote) { htmlParts.push('<blockquote>'); inBlockquote = true; }
      htmlParts.push(`<p>${inlineMd(line.trim().slice(2))}</p>`);
      continue;
    }
    closeBlockquote();

    if (line.trim() === '') continue;
    htmlParts.push(`<p>${inlineMd(line.trim())}</p>`);
  }
  closeList();
  closeBlockquote();
  return htmlParts.join('\n');
}
