/* Shellwork — PowerPoint (.pptx). A deck is first a plain description (title, slides of bullets / table / picture,
 * speaker notes), made straight from the board or written by the AI; then PptxGenJS (loaded only when needed)
 * draws it in one quiet style: white slides, a thin blue mark, big type. */
(function (SW) {
  'use strict';
  const S = SW.store;
  const NL = String.fromCharCode(10);
  const LIB = 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js';
  const X = SW.pptx = {};

  /* ---------- the deck straight from the board ---------- */
  const strip = (t) => String(t || '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1$2').replace(/`/g, '').trim();
  /* body → bullet lines and tables */
  function readBody(body) {
    const lines = String(body || '').split(NL), bullets = [], tables = [];
    for (let i = 0; i < lines.length; i++) {
      if (SW.isTableStart(lines, i)) { const j = SW.tableEnd(lines, i); tables.push(SW.mdTable(lines.slice(i, j))); i = j - 1; continue; }
      const l = lines[i]; if (!l.trim()) continue;
      const m = /^(\s*)(?:[-*•]|\d+[.)])\s+(.*)$/.exec(l), h = /^#{1,6}\s+(.*)$/.exec(l);
      if (m && m[1].replace(/\t/g, '  ').length >= 2 && bullets.length) { const last = bullets[bullets.length - 1]; last.sub = (last.sub || []).concat(strip(m[2])); }
      else bullets.push({ text: strip(m ? m[2] : h ? h[1] : l) });
    }
    return { bullets, tables };
  }
  X.fromBoard = () => {
    const slides = [{ type: 'cover', title: S.board.name, subtitle: '' }];
    /* one slide per shell (bullets from its body), a slide per table and picture, a divider for an empty top shell */
    const visit = (s, depth) => {
      if (slides.length > 60) return;
      const title = s.title.trim() || '(제목 없음)';
      if (S.isImage(s)) { const cap = s.body.trim().split(NL); slides.push({ type: 'image', title: cap[0].slice(0, 60) || '그림', image: s.img, caption: cap.slice(1).join(' ').trim() }); return; }
      if (S.isText(s)) return;
      const { bullets, tables } = readBody(s.body);
      const kids = s.children.map(S.get), shellKids = kids.filter((k) => !S.isText(k)), pics = kids.filter(S.isImage);
      const notes = s.notes || '';
      // an empty grouping shell lists what is inside it
      const b = bullets.length ? bullets.slice(0, 7) : shellKids.slice(0, 6).map((k) => ({ text: k.title.trim() || '(제목 없음)' }));
      if (depth === 0 && !bullets.length && !tables.length && !pics.length && shellKids.length) slides.push({ type: 'section', title, subtitle: b.map((x) => x.text).join(' · ').slice(0, 90), notes });
      else if (pics.length === 1 && !tables.length) slides.push({ type: 'image', title, image: pics[0].img, caption: pics[0].body.trim(), bullets: b, notes });
      else if (b.length || !tables.length) slides.push({ type: 'bullets', title, bullets: b, notes });
      tables.forEach((t, i) => slides.push({ type: 'table', title, table: t, notes: !b.length && !i ? notes : '' }));
      if (pics.length > 1 || (pics.length === 1 && tables.length)) pics.forEach((p) => slides.push({ type: 'image', title, image: p.img, caption: p.body.trim() }));
      shellKids.forEach((k) => visit(k, depth + 1));
    };
    S.ordered().forEach((id) => visit(S.get(id), 0));
    slides.push({ type: 'closing', title: '감사합니다', subtitle: '질문을 받겠습니다' });
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

  const F = 'Malgun Gothic', INK = '1D1D1F', SUB = '6E6E73', FAINT = '8E8E93', ACCENT = '2D6BF6', TINT = 'F5F5F7', RULE = 'D9D9DE';
  const W = 13.333, H = 7.5, M = 0.7;
  const date = () => { const d = new Date(); return d.getFullYear() + '. ' + (d.getMonth() + 1) + '. ' + d.getDate() + '.'; };
  const asItem = (b) => (typeof b === 'string' ? { text: b } : b && b.text ? b : null);

  function heading(sl, title) {
    sl.addShape('rect', { x: M, y: 0.52, w: 0.42, h: 0.06, fill: { color: ACCENT }, line: { color: ACCENT, width: 0 } });
    sl.addText(strip(title), { x: M, y: 0.66, w: W - M * 2, h: 0.9, fontFace: F, fontSize: 28, bold: true, color: INK, valign: 'top', margin: 0, fit: 'shrink' });
  }
  function bulletRuns(items, size) {
    const out = [];
    items.map(asItem).filter(Boolean).forEach((b) => {
      out.push({ text: strip(b.text), options: { bullet: { indent: 18 }, fontSize: size, color: INK, paraSpaceAfter: 8, breakLine: true } });
      (b.sub || []).slice(0, 4).forEach((t) => out.push({ text: strip(t), options: { bullet: { indent: 16 }, indentLevel: 1, fontSize: size - 4, color: SUB, paraSpaceAfter: 4, breakLine: true } }));
    });
    return out;
  }
  /* fit a picture of shape `ratio` (height / width) inside a box, centred */
  function placePic(sl, imgId, box) {
    const url = SW.images && SW.images.url(imgId); if (!url) return false;
    const node = Object.values(S.board.shells).find((s) => s.img === imgId), r = (node && node.ratio) || 0.75;
    let w = box.w, h = w * r; if (h > box.h) { h = box.h; w = h / r; }
    sl.addImage({ data: url, x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h });
    return true;
  }

  X.build = async (deck) => {
    await loadLib();
    const pptx = new window.PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE'; pptx.title = deck.title || S.board.name; pptx.company = 'Shellwork';
    pptx.defineSlideMaster({
      title: 'SW', background: { color: 'FFFFFF' },
      objects: [{ text: { text: strip(deck.title || S.board.name).slice(0, 60), options: { x: M, y: H - 0.5, w: 8, h: 0.3, fontFace: F, fontSize: 10, color: FAINT, margin: 0 } } }],
      slideNumber: { x: W - M - 0.8, y: H - 0.5, w: 0.8, h: 0.3, fontFace: F, fontSize: 10, color: FAINT, align: 'right' },
    });
    let part = 0;
    (deck.slides || []).forEach((d) => {
      const type = d.type || 'bullets';
      if (type === 'cover') {
        const sl = pptx.addSlide();
        sl.background = { color: 'FFFFFF' };
        sl.addShape('rect', { x: 0.9, y: 2.45, w: 0.7, h: 0.08, fill: { color: ACCENT }, line: { color: ACCENT, width: 0 } });
        sl.addText(strip(d.title || deck.title), { x: 0.9, y: 2.7, w: W - 1.8, h: 1.7, fontFace: F, fontSize: 44, bold: true, color: INK, valign: 'top', margin: 0, fit: 'shrink' });
        if (d.subtitle) sl.addText(strip(d.subtitle), { x: 0.9, y: 4.45, w: W - 1.8, h: 0.7, fontFace: F, fontSize: 20, color: SUB, valign: 'top', margin: 0 });
        sl.addText(date(), { x: 0.9, y: H - 1.2, w: 4, h: 0.4, fontFace: F, fontSize: 13, color: FAINT, margin: 0 });
        if (d.notes) sl.addNotes(String(d.notes));
        return;
      }
      if (type === 'section') {
        part++;
        const sl = pptx.addSlide({ masterName: 'SW' }); sl.background = { color: TINT };
        sl.addText('PART ' + String(part).padStart(2, '0'), { x: M, y: 2.5, w: 6, h: 0.45, fontFace: F, fontSize: 14, bold: true, color: ACCENT, margin: 0, charSpacing: 2 });
        sl.addText(strip(d.title), { x: M, y: 3.0, w: W - M * 2, h: 1.3, fontFace: F, fontSize: 40, bold: true, color: INK, valign: 'top', margin: 0, fit: 'shrink' });
        if (d.subtitle) sl.addText(strip(d.subtitle), { x: M, y: 4.35, w: W - M * 2, h: 0.6, fontFace: F, fontSize: 18, color: SUB, margin: 0 });
        if (d.notes) sl.addNotes(String(d.notes));
        return;
      }
      if (type === 'closing') {
        const sl = pptx.addSlide();
        sl.addText(strip(d.title || '감사합니다'), { x: M, y: 2.8, w: W - M * 2, h: 1.1, fontFace: F, fontSize: 44, bold: true, color: INK, align: 'center', margin: 0 });
        if (d.subtitle) sl.addText(strip(d.subtitle), { x: M, y: 3.95, w: W - M * 2, h: 0.6, fontFace: F, fontSize: 18, color: SUB, align: 'center', margin: 0 });
        if (d.notes) sl.addNotes(String(d.notes));
        return;
      }
      const sl = pptx.addSlide({ masterName: 'SW' });
      heading(sl, d.title || '');
      const top = 1.75, bottom = H - 0.85, box = { x: M, y: top, w: W - M * 2, h: bottom - top };
      const items = (d.bullets || []).map(asItem).filter(Boolean);
      if (type === 'table' && d.table && (d.table.header || Array.isArray(d.table))) {
        const rows = Array.isArray(d.table) ? d.table : [d.table.header].concat(d.table.rows || []);
        const k = Math.min(rows.length, 16), n = Math.max(...rows.map((r) => r.length));
        const fs = k <= 4 ? 18 : k <= 7 ? 16 : k <= 10 ? 14 : k <= 13 ? 12 : 11; // fewer rows, bigger type
        const data = rows.slice(0, 16).map((r, ri) => Array.from({ length: n }, (_, i) => ({
          text: strip(r[i] == null ? '' : String(r[i])),
          options: ri === 0 ? { bold: true, fill: { color: 'F2F4F8' }, color: INK } : { color: INK },
        })));
        const tH = Math.min(box.h - (items.length ? 1.2 : 0), k * (fs / 72 * 2.3));
        sl.addTable(data, { x: M, y: top, w: box.w, colW: Array(n).fill(box.w / n), fontFace: F, fontSize: fs, border: { type: 'solid', pt: 0.75, color: RULE }, margin: [0.06, 0.12, 0.06, 0.12], valign: 'middle', autoPage: false, rowH: tH / k });
        if (items.length) sl.addText(bulletRuns(items.slice(0, 3), 16), { x: M, y: top + tH + 0.25, w: box.w, h: bottom - top - tH - 0.25, fontFace: F, valign: 'top', margin: 0 });
        if (d.caption) sl.addText(strip(d.caption), { x: M, y: bottom - 0.35, w: box.w, h: 0.3, fontFace: F, fontSize: 11, color: SUB, margin: 0 });
      } else if (type === 'image' && d.image) {
        const withText = items.length > 0;
        const picBox = withText ? { x: M, y: top, w: 7.3, h: box.h - 0.45 } : { x: M, y: top, w: box.w, h: box.h - 0.45 };
        const ok = placePic(sl, d.image, picBox);
        if (!ok) sl.addText('(그림을 찾지 못했어요)', { x: picBox.x, y: picBox.y, w: picBox.w, h: picBox.h, fontFace: F, fontSize: 14, color: FAINT, align: 'center', valign: 'middle', fill: { color: TINT } });
        if (d.caption) sl.addText(strip(d.caption).split(NL)[0], { x: picBox.x, y: picBox.y + picBox.h + 0.08, w: picBox.w, h: 0.35, fontFace: F, fontSize: 12, color: SUB, align: withText ? 'left' : 'center', margin: 0 });
        if (withText) sl.addText(bulletRuns(items.slice(0, 6), 18), { x: M + 7.7, y: top, w: box.w - 7.7, h: box.h, fontFace: F, valign: 'top', margin: 0 });
      } else {
        const size = items.length > 6 ? 17 : items.length > 4 ? 20 : 22;
        if (items.length) sl.addText(bulletRuns(items.slice(0, 9), size), { x: M, y: top, w: box.w, h: box.h, fontFace: F, valign: 'top', margin: 0, fit: 'shrink' });
        else if (d.subtitle) sl.addText(strip(d.subtitle), { x: M, y: top, w: box.w, h: 1, fontFace: F, fontSize: 20, color: SUB, valign: 'top', margin: 0 });
      }
      if (d.notes) sl.addNotes(String(d.notes));
    });
    return pptx.write({ outputType: 'blob' });
  };
})(window.SW);
