/* Shellwork — a tiny Markdown renderer for what people type into shells:
 * "- " and "1. " lists, **bold**, *italic*, `code`, ~~strike~~, "# " sub-headings and | tables |. Everything is escaped first.
 * opts.headings renders # … ### as real headings (written documents); opts.figure(id) resolves [[그림:id]] lines to an image. */
(function (SW) {
  'use strict';
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/(^|\s)->(\s|$)/g, '$1→$2');

  /* | a | b | rows; the second line is the |---|:---:| separator */
  const ROW = /^\s*\|.*\|\s*$/;
  const SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
  const KEEP = String.fromCharCode(1); // stands in for an escaped \| while splitting
  const cells = (line) => line.trim().replace(/\\\|/g, KEEP).replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim().split(KEEP).join('|'));
  function table(lines) {
    const head = cells(lines[0]), align = cells(lines[1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : ''));
    const cell = (tag, t, i) => '<' + tag + (align[i] ? ' style="text-align:' + align[i] + '"' : '') + '>' + inline(t) + '</' + tag + '>';
    let h = '<div class="tbl"><table><thead><tr>' + head.map((t, i) => cell('th', t, i)).join('') + '</tr></thead><tbody>';
    lines.slice(2).forEach((l) => { const r = cells(l); h += '<tr>' + head.map((_, i) => cell('td', r[i] || '', i)).join('') + '</tr>'; });
    return h + '</tbody></table></div>';
  }
  /* the rows of a Markdown table as arrays (header first), for Word and PowerPoint */
  SW.mdTable = (lines) => [cells(lines[0])].concat(lines.slice(2).map(cells));
  SW.isTableStart = (lines, i) => ROW.test(lines[i] || '') && SEP.test(lines[i + 1] || '') && (lines[i + 1] || '').includes('-');
  SW.tableEnd = (lines, i) => { let j = i + 2; while (j < lines.length && ROW.test(lines[j])) j++; return j; };
  SW.FIGURE = /^\s*\[\[그림:([A-Za-z0-9_-]+)\]\]\s*$/;

  SW.md = (text, opts) => {
    opts = opts || {};
    const out = []; let list = null;
    const close = () => { if (list) { out.push('</' + list + '>'); list = null; } };
    const lines = String(text || '').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (SW.isTableStart(lines, i)) { close(); const j = SW.tableEnd(lines, i); out.push(table(lines.slice(i, j))); i = j - 1; continue; }
      const fig = opts.figure && SW.FIGURE.exec(raw);
      if (fig) { close(); out.push(opts.figure(fig[1])); continue; }
      const ul = /^(\s*)[-*•]\s+(.*)$/.exec(raw);
      const ol = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(raw);
      const h = /^(#{1,6})\s+(.*)$/.exec(raw);
      if (ul || ol) {
        const type = ul ? 'ul' : 'ol', indent = (ul || ol)[1].replace(/\t/g, '  ').length;
        if (list !== type) { close(); out.push(type === 'ol' && ol[2] !== '1' ? '<ol start="' + ol[2] + '">' : '<' + type + '>'); list = type; }
        out.push('<li' + (indent >= 2 ? ' class="sub"' : '') + '>' + inline(ul ? ul[2] : ol[3]) + '</li>');
      } else if (h && opts.headings) { close(); const n = Math.min(4, h[1].length); out.push('<h' + (n + 1) + ' class="mh' + n + '">' + inline(h[2]) + '</h' + (n + 1) + '>'); }
      else if (h) { close(); out.push('<p class="mh">' + inline(h[2]) + '</p>'); }
      else if (!raw.trim()) { close(); if (out.length && out[out.length - 1] !== '<p class="gap"></p>') out.push('<p class="gap"></p>'); }
      else { close(); out.push('<p>' + inline(raw) + '</p>'); }
    }
    close();
    while (out.length && out[out.length - 1] === '<p class="gap"></p>') out.pop();
    return out.join('');
  };
})(window.SW);
