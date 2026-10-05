/* Shellwork — PowerPoint (.pptx). A deck is first a plain description (slides of a few kinds, speaker notes), made
 * straight from the board or written by the AI; then PptxGenJS (loaded only when needed) draws it in one of three themes.
 * Slide kinds: cover · agenda · section · statement (one big sentence) · bullets · cards (a shell's children side by side,
 * the board's own look) · table · image · closing. */
(function (SW) {
  'use strict';
  const S = SW.store;
  const NL = String.fromCharCode(10);
  const LIB = 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js';
  const X = SW.pptx = {};

  X.THEMES = {
    light: { label: '화이트', bg: 'FFFFFF', ink: '1D1D1F', sub: '55555D', faint: '9A9AA2', accent: '2D6BF6', card: 'F4F4F6', line: 'E4E4E9', alt: 'F5F6F8', head: 'EEF2FB', rule: 'D9D9DE' },
    canvas: { label: '캔버스', bg: 'F2F2F0', ink: '1D1D1F', sub: '55555D', faint: '9A9AA2', accent: '2D6BF6', card: 'FFFFFF', line: 'E1E1DD', alt: 'E9E9E6', head: 'F1F3F7', rule: 'D8D8D3' },
    dark: { label: '다크', bg: '141416', ink: 'F5F5F7', sub: 'B9B9C1', faint: '7C7C85', accent: '6E9BFF', card: '1F1F23', line: '2F2F35', alt: '1B1B1F', head: '2A2A31', rule: '3A3A42' },
  };
  const SHELL = { rose: 'E8607A', amber: 'E5A03A', lime: '68A94A', sky: '3E82F7', violet: '8B5CF6', slate: '6B7685' };

  /* ---------- the deck straight from the board ---------- */
  const strip = (t) => String(t || '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1$2').replace(/`/g, '').trim();
  const cut = (t, n) => { t = strip(t); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
  /* body → bullet lines, tables and plain paragraphs */
  function readBody(body) {
    const lines = String(body || '').split(NL), bullets = [], tables = [];
    let paras = 0, listy = false;
    for (let i = 0; i < lines.length; i++) {
      if (SW.isTableStart(lines, i)) { const j = SW.tableEnd(lines, i); tables.push(SW.mdTable(lines.slice(i, j))); i = j - 1; continue; }
      const l = lines[i]; if (!l.trim()) continue;
      const m = /^(\s*)(?:[-*•]|\d+[.)])\s+(.*)$/.exec(l), h = /^#{1,6}\s+(.*)$/.exec(l);
      if (m) listy = true; else paras++;
      if (m && m[1].replace(/\t/g, '  ').length >= 2 && bullets.length) { const last = bullets[bullets.length - 1]; last.sub = (last.sub || []).concat(strip(m[2])); }
      else bullets.push({ text: strip(m ? m[2] : h ? h[1] : l) });
    }
    return { bullets, tables, paras, listy };
  }
  /* a few short lines that sum up a shell, for a card */
  function cardLines(s) {
    const { bullets, tables } = readBody(s.body);
    const kids = s.children.map(S.get).filter((k) => k && !S.isImage(k));
    let lines = bullets.map((b) => b.text);
    if (!lines.length) lines = kids.map((k) => (S.isText(k) ? k.body.trim().split(NL)[0] : k.title.trim())).filter(Boolean);
    if (tables.length) lines.push('표 ' + (tables[0].length - 1) + '행 · 다음 장');
    return lines.slice(0, 4).map((t) => cut(t, 70));
  }
  X.fromBoard = () => {
    const slides = [], add = (d) => { if (slides.length < 60) slides.push(d); };
    const roots = S.ordered().map(S.get);
    const parts = roots.filter((s) => !S.isText(s));
    const first = parts[0];
    add({ type: 'cover', title: S.board.name, subtitle: first && first.body.trim() && first.body.trim().length < 90 && !/\n/.test(first.body.trim()) ? strip(first.body) : '' });
    if (parts.length >= 3) add({ type: 'agenda', title: '목차', items: parts.map((s) => cut(s.title || '(제목 없음)', 40)).slice(0, 8) });
    let n = 0;
    roots.forEach((s) => {
      if (S.isImage(s)) { const cap = s.body.trim().split(NL); add({ type: 'image', title: cap[0].slice(0, 60) || '그림', image: s.img, caption: cap.slice(1).join(' ').trim() }); return; }
      if (S.isText(s)) return;
      n++;
      const tag = String(n).padStart(2, '0') + '  ' + cut(s.title || '(제목 없음)', 30), title = s.title.trim() || '(제목 없음)', notes = s.notes || '';
      const { bullets, tables, paras, listy } = readBody(s.body);
      const kids = s.children.map(S.get), shells = kids.filter((k) => !S.isText(k)), pics = kids.filter(S.isImage);
      const notesLines = kids.filter((k) => S.isText(k) && !S.isImage(k)).map((k) => ({ text: cut(k.body.trim().split(NL)[0], 90) }));
      if (shells.length >= 2) {
        const intro = bullets.length === 1 && !listy ? cut(bullets[0].text, 110) : '';
        if (bullets.length && !intro) add({ type: 'bullets', tag, title, bullets: bullets.slice(0, 6), notes });
        for (let i = 0; i < shells.length; i += 4) {
          const group = shells.slice(i, i + 4);
          add({ type: 'cards', tag, title: i ? title + ' (계속)' : title, subtitle: i ? '' : intro, notes: i || bullets.length && !intro ? '' : notes,
            cards: group.map((k) => ({ title: cut(k.title || '(제목 없음)', 40), text: cardLines(k), color: k.color || s.color || '' })) });
        }
      } else if (!shells.length && !pics.length && !listy && paras === 1 && !tables.length && bullets[0] && bullets[0].text.length <= 120) {
        add({ type: 'statement', tag, title, text: bullets[0].text, notes });
      } else if (pics.length === 1 && !tables.length) {
        add({ type: 'image', tag, title, image: pics[0].img, caption: pics[0].body.trim(), bullets: bullets.concat(shells.map((k) => ({ text: k.title.trim(), sub: cardLines(k).slice(0, 2) }))).slice(0, 5), notes });
      } else {
        const b = bullets.concat(shells.map((k) => ({ text: k.title.trim() || '(제목 없음)', sub: cardLines(k).slice(0, 3) }))).concat(notesLines);
        if (b.length || !tables.length) add({ type: 'bullets', tag, title, bullets: b.slice(0, 7), notes });
      }
      tables.forEach((t, i) => add({ type: 'table', tag, title, table: t, notes: !bullets.length && !i ? notes : '' }));
      if (pics.length > 1 || (pics.length === 1 && (tables.length || shells.length >= 2))) pics.forEach((p) => add({ type: 'image', tag, title, image: p.img, caption: p.body.trim() }));
      // a child with more than a card can hold gets its own slide
      shells.forEach((k) => {
        const r = readBody(k.body), kp = k.children.map(S.get).filter(S.isImage);
        r.tables.forEach((t) => add({ type: 'table', tag, title: k.title.trim() || title, table: t, notes: k.notes || '' }));
        kp.forEach((p) => add({ type: 'image', tag, title: k.title.trim() || title, image: p.img, caption: p.body.trim(), notes: k.notes || '' }));
        if (shells.length >= 2 && r.bullets.length > 4) add({ type: 'bullets', tag, title: k.title.trim(), bullets: r.bullets.slice(0, 7), notes: k.notes || '' });
      });
    });
    add({ type: 'closing', title: '감사합니다', subtitle: '질문을 받겠습니다' });
    return { title: S.board.name, slides };
  };

  /* ---------- drawing ---------- */
  let libP = null;
  const loadLib = () => (window.PptxGenJS ? Promise.resolve() : libP || (libP = new Promise((res, rej) => {
    const sc = document.createElement('script'); sc.src = LIB; sc.async = true;
    sc.onload = () => (window.PptxGenJS ? res() : rej(new Error('lib')));
    sc.onerror = () => { libP = null; rej(new Error('lib')); };
    (document.head || document.documentElement).append(sc);
  })));

  const F = 'Malgun Gothic', W = 13.333, H = 7.5, M = 0.75;
  const date = () => { const d = new Date(); return d.getFullYear() + '. ' + (d.getMonth() + 1) + '. ' + d.getDate() + '.'; };
  const asItem = (b) => (typeof b === 'string' ? { text: b } : b && b.text ? b : null);

  X.build = async (deck, themeName) => {
    await loadLib();
    const T = X.THEMES[themeName] || X.THEMES.light;
    const pptx = new window.PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE'; pptx.title = deck.title || S.board.name; pptx.company = 'Shellwork';
    const deckTitle = cut(deck.title || S.board.name, 60);
    pptx.defineSlideMaster({
      title: 'SW', background: { color: T.bg },
      objects: [{ text: { text: deckTitle, options: { x: M, y: H - 0.48, w: 8, h: 0.28, fontFace: F, fontSize: 10, color: T.faint, margin: 0 } } }],
      slideNumber: { x: W - M - 0.8, y: H - 0.48, w: 0.8, h: 0.28, fontFace: F, fontSize: 10, color: T.faint, align: 'right' },
    });
    const txt = (sl, text, o) => sl.addText(text, Object.assign({ fontFace: F, color: T.ink, margin: 0, valign: 'top' }, o));
    const bar = (sl, x, y, w, h, color) => sl.addShape('rect', { x, y, w, h, fill: { color: color || T.accent }, line: { color: color || T.accent, width: 0 } });
    const round = (sl, x, y, w, h, fill, line) => sl.addShape('roundRect', { x, y, w, h, rectRadius: 0.14, fill: { color: fill }, line: line ? { color: line, width: 0.75 } : { color: fill, width: 0 } });
    function chrome(sl, d) { // the section tag above the title, and the title
      if (d.tag) txt(sl, d.tag, { x: M, y: 0.42, w: 8, h: 0.3, fontSize: 12, bold: true, color: T.accent, charSpacing: 1 });
      txt(sl, strip(d.title), { x: M, y: d.tag ? 0.74 : 0.6, w: W - M * 2, h: 0.85, fontSize: 30, bold: true, fit: 'shrink' });
    }
    function bulletRuns(items, size) {
      const out = [];
      items.map(asItem).filter(Boolean).forEach((b) => {
        out.push({ text: strip(b.text), options: { bullet: { indent: 22 }, fontSize: size, color: T.ink, paraSpaceAfter: Math.round(size * 0.55), breakLine: true } });
        (b.sub || []).slice(0, 4).forEach((t) => out.push({ text: strip(t), options: { bullet: { indent: 18 }, indentLevel: 1, fontSize: size - 5, color: T.sub, paraSpaceAfter: 6, breakLine: true } }));
      });
      return out;
    }
    function placePic(sl, imgId, box) { // fit inside the box, centred
      const url = SW.images && SW.images.url(imgId); if (!url) return false;
      const node = Object.values(S.board.shells).find((s) => s.img === imgId), r = (node && node.ratio) || 0.75;
      let w = box.w, h = w * r; if (h > box.h) { h = box.h; w = h / r; }
      sl.addImage({ data: url, x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h });
      return true;
    }
    let part = 0;
    (deck.slides || []).forEach((d) => {
      const type = d.type || 'bullets';
      const items = (d.bullets || []).map(asItem).filter(Boolean);
      if (type === 'cover') {
        const sl = pptx.addSlide(); sl.background = { color: T.bg };
        bar(sl, 0.95, 2.35, 0.75, 0.09);
        txt(sl, strip(d.title || deck.title), { x: 0.95, y: 2.62, w: W - 1.9, h: 1.8, fontSize: 46, bold: true, fit: 'shrink' });
        if (d.subtitle) txt(sl, strip(d.subtitle), { x: 0.95, y: 4.5, w: W - 2.6, h: 0.9, fontSize: 20, color: T.sub });
        txt(sl, date(), { x: 0.95, y: H - 1.15, w: 5, h: 0.4, fontSize: 13, color: T.faint });
        if (d.notes) sl.addNotes(String(d.notes));
        return;
      }
      if (type === 'closing') {
        const sl = pptx.addSlide(); sl.background = { color: T.bg };
        txt(sl, strip(d.title || '감사합니다'), { x: M, y: 2.85, w: W - M * 2, h: 1.1, fontSize: 46, bold: true, align: 'center' });
        if (d.subtitle) txt(sl, strip(d.subtitle), { x: M, y: 4.0, w: W - M * 2, h: 0.6, fontSize: 19, color: T.sub, align: 'center' });
        if (d.notes) sl.addNotes(String(d.notes));
        return;
      }
      const sl = pptx.addSlide({ masterName: 'SW' });
      const top = 1.85, bottom = H - 0.85, box = { x: M, y: top, w: W - M * 2, h: bottom - top };
      if (type === 'section') {
        part++; sl.background = { color: T.alt };
        txt(sl, String(part).padStart(2, '0'), { x: M, y: 1.75, w: 4, h: 1.3, fontSize: 72, bold: true, color: T.accent });
        txt(sl, strip(d.title), { x: M, y: 3.15, w: W - M * 2, h: 1.2, fontSize: 40, bold: true, fit: 'shrink' });
        if (d.subtitle) txt(sl, strip(d.subtitle), { x: M, y: 4.4, w: W - M * 2, h: 0.8, fontSize: 19, color: T.sub });
      } else if (type === 'agenda') {
        chrome(sl, d);
        const list = (d.items || items.map((b) => b.text)).slice(0, 8), two = list.length > 4, rows = two ? Math.ceil(list.length / 2) : list.length;
        const rowH = Math.min(1.0, box.h / Math.max(rows, 1)), colW = two ? box.w / 2 : box.w;
        list.forEach((t, i) => {
          const c = two ? Math.floor(i / rows) : 0, r = two ? i % rows : i, x = M + c * colW, y = top + r * rowH;
          txt(sl, String(i + 1).padStart(2, '0'), { x, y, w: 0.9, h: rowH, fontSize: 26, bold: true, color: T.accent, valign: 'middle' });
          txt(sl, strip(t), { x: x + 0.95, y, w: colW - 1.2, h: rowH, fontSize: 24, valign: 'middle', fit: 'shrink' });
          if (r < rows - 1) bar(sl, x, y + rowH - 0.01, colW - 0.3, 0.01, T.line);
        });
      } else if (type === 'statement') {
        if (d.tag) txt(sl, d.tag, { x: M, y: 0.42, w: 8, h: 0.3, fontSize: 12, bold: true, color: T.accent, charSpacing: 1 });
        txt(sl, strip(d.title), { x: M, y: d.tag ? 0.74 : 0.6, w: W - M * 2, h: 0.6, fontSize: 20, bold: true, color: T.sub });
        bar(sl, M, 2.35, 0.09, 2.7);
        txt(sl, strip(d.text || (items[0] && items[0].text) || ''), { x: M + 0.45, y: 2.25, w: W - M * 2 - 1.2, h: 2.9, fontSize: 34, bold: true, valign: 'middle', fit: 'shrink', lineSpacingMultiple: 1.15 });
        if (d.subtitle) txt(sl, strip(d.subtitle), { x: M + 0.45, y: 5.35, w: W - M * 2 - 1.2, h: 0.7, fontSize: 17, color: T.sub });
      } else if (type === 'cards' && Array.isArray(d.cards) && d.cards.length) {
        chrome(sl, d);
        const cards = d.cards.slice(0, 4), n = cards.length, linesOf = (c) => (Array.isArray(c.text) ? c.text : c.text ? [c.text] : []).slice(0, 5);
        const grid = n === 4 && cards.some((c) => linesOf(c).join('').length > 50);
        const cols = grid ? 2 : n, rows = grid ? 2 : 1, gap = 0.32;
        const y0 = d.subtitle ? top + 0.7 : top + 0.1;
        if (d.subtitle) txt(sl, strip(d.subtitle), { x: M, y: top - 0.05, w: box.w, h: 0.55, fontSize: 19, color: T.sub, fit: 'shrink' });
        const cw = (box.w - gap * (cols - 1)) / cols;
        const fs = rows === 1 && n <= 2 ? 22 : cols >= 4 ? 16 : 19, tfs = fs + 4;
        // as tall as the longest card needs (wrapped lines estimated from the card width), never past the bottom
        const perLine = Math.max(8, Math.floor((cw - 0.75) * 72 / (fs * 0.95)));
        const need = Math.max(...cards.map((c) => linesOf(c).reduce((t, l) => t + Math.max(1, Math.ceil(strip(l).length / perLine)), 0)));
        const maxH = (bottom - y0 - gap * (rows - 1)) / rows;
        const ch = Math.min(maxH, Math.max(2.3, 1.5 + need * (fs / 72) * 1.6));
        const spare = bottom - y0 - (ch * rows + gap * (rows - 1)), yc = y0 + Math.max(0, spare) * 0.35; // short cards sit a little above the middle
        cards.forEach((c, i) => {
          const x = M + (i % cols) * (cw + gap), y = yc + Math.floor(i / cols) * (ch + gap);
          round(sl, x, y, cw, ch, T.card, T.line);
          bar(sl, x + 0.32, y + 0.34, 0.46, 0.07, SHELL[c.color] || T.accent);
          txt(sl, strip(c.title), { x: x + 0.32, y: y + 0.52, w: cw - 0.64, h: 0.62, fontSize: tfs, bold: true, fit: 'shrink' });
          const lines = linesOf(c);
          if (lines.length) txt(sl, lines.map((t) => ({ text: strip(t), options: { bullet: { indent: 15 }, breakLine: true, paraSpaceAfter: 5 } })),
            { x: x + 0.32, y: y + 1.2, w: cw - 0.64, h: ch - 1.4, fontSize: fs, color: T.sub, fit: 'shrink' });
        });
      } else if (type === 'table' && d.table && (d.table.header || Array.isArray(d.table))) {
        chrome(sl, d);
        const rows = Array.isArray(d.table) ? d.table : [d.table.header].concat(d.table.rows || []);
        const k = Math.min(rows.length, 16), n = Math.max(...rows.map((r) => r.length));
        const fs = k <= 4 ? 19 : k <= 7 ? 16 : k <= 10 ? 14 : k <= 13 ? 12 : 11; // fewer rows, bigger type
        const data = rows.slice(0, 16).map((r, ri) => Array.from({ length: n }, (_, i) => ({
          text: strip(r[i] == null ? '' : String(r[i])),
          options: ri === 0 ? { bold: true, fill: { color: T.head }, color: T.ink } : { color: T.ink, fill: { color: T.bg === 'FFFFFF' ? 'FFFFFF' : T.card } },
        })));
        const tH = Math.min(box.h - (items.length ? 1.2 : 0), k * (fs / 72 * 2.4));
        sl.addTable(data, { x: M, y: top, w: box.w, colW: Array(n).fill(box.w / n), fontFace: F, fontSize: fs, border: { type: 'solid', pt: 0.75, color: T.rule }, margin: [0.07, 0.14, 0.07, 0.14], valign: 'middle', autoPage: false, rowH: tH / k });
        if (items.length) txt(sl, bulletRuns(items.slice(0, 3), 18), { x: M, y: top + tH + 0.3, w: box.w, h: bottom - top - tH - 0.3 });
        if (d.caption) txt(sl, strip(d.caption), { x: M, y: bottom - 0.3, w: box.w, h: 0.3, fontSize: 11, color: T.sub });
      } else if (type === 'image' && d.image) {
        chrome(sl, d);
        const withText = items.length > 0;
        const picBox = withText ? { x: M, y: top, w: 7.2, h: box.h - 0.45 } : { x: M, y: top, w: box.w, h: box.h - 0.45 };
        if (!placePic(sl, d.image, picBox)) txt(sl, '(그림을 찾지 못했어요)', { x: picBox.x, y: picBox.y, w: picBox.w, h: picBox.h, fontSize: 14, color: T.faint, align: 'center', valign: 'middle', fill: { color: T.card } });
        if (d.caption) txt(sl, strip(d.caption).split(NL)[0], { x: picBox.x, y: picBox.y + picBox.h + 0.1, w: picBox.w, h: 0.35, fontSize: 12, color: T.sub, align: withText ? 'left' : 'center' });
        if (withText) txt(sl, bulletRuns(items.slice(0, 5), 19), { x: M + 7.65, y: top + 0.1, w: box.w - 7.65, h: box.h - 0.1, fit: 'shrink' });
      } else {
        chrome(sl, d);
        const size = items.length > 6 ? 18 : items.length > 4 ? 21 : 24;
        if (items.length) txt(sl, bulletRuns(items.slice(0, 9), size), { x: M, y: top + 0.05, w: box.w, h: box.h, fit: 'shrink' });
        else if (d.subtitle || d.text) txt(sl, strip(d.subtitle || d.text), { x: M, y: top, w: box.w, h: 1.2, fontSize: 22, color: T.sub });
      }
      if (d.notes) sl.addNotes(String(d.notes));
    });
    return pptx.write({ outputType: 'blob' });
  };
})(window.SW);
