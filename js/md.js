/* Shellwork — a tiny Markdown renderer for what people type into shells:
 * "- " and "1. " lists, **bold**, *italic*, `code`, ~~strike~~ and "# " sub-headings. Everything is escaped first. */
(function (SW) {
  'use strict';
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/(^|\s)->(\s|$)/g, '$1→$2');

  SW.md = (text) => {
    const out = []; let list = null;
    const close = () => { if (list) { out.push('</' + list + '>'); list = null; } };
    String(text || '').split('\n').forEach((raw) => {
      const ul = /^(\s*)[-*•]\s+(.*)$/.exec(raw);
      const ol = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(raw);
      const h = /^#{1,6}\s+(.*)$/.exec(raw);
      if (ul || ol) {
        const type = ul ? 'ul' : 'ol', indent = (ul || ol)[1].replace(/\t/g, '  ').length;
        if (list !== type) { close(); out.push(type === 'ol' && ol[2] !== '1' ? '<ol start="' + ol[2] + '">' : '<' + type + '>'); list = type; }
        out.push('<li' + (indent >= 2 ? ' class="sub"' : '') + '>' + inline(ul ? ul[2] : ol[3]) + '</li>');
      } else if (h) { close(); out.push('<p class="mh">' + inline(h[1]) + '</p>'); }
      else if (!raw.trim()) { close(); if (out.length && out[out.length - 1] !== '<p class="gap"></p>') out.push('<p class="gap"></p>'); }
      else { close(); out.push('<p>' + inline(raw) + '</p>'); }
    });
    close();
    while (out.length && out[out.length - 1] === '<p class="gap"></p>') out.pop();
    return out.join('');
  };
})(window.SW);
