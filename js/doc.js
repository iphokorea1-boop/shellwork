/* Shellwork — document view (the same tree read top to bottom) and mind map view. */
(function (SW) {
  'use strict';
  const S = SW.store;
  const $ = (q) => document.querySelector(q);
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const PLAIN = (() => { const d = document.createElement('div'); d.contentEditable = 'plaintext-only'; return d.contentEditable === 'plaintext-only'; })();
  const editable = (e) => { e.contentEditable = PLAIN ? 'plaintext-only' : 'true'; e.spellcheck = false; return e; };
  const readText = (e) => e.innerText.replace(/ /g, ' ').replace(/\n$/, '');

  const D = SW.doc = {};
  let body, toc, editCheckpoint = true;

  /* ---------- document ---------- */
  D.render = () => {
    const a = document.activeElement; let focus = null;
    if (a && body.contains(a) && a.dataset.f) focus = { id: a.closest('.sec') ? a.closest('.sec').dataset.id : null, f: a.dataset.f };
    body.textContent = '';
    const title = editable(mk('h1', 'doc-title', S.board.name)); title.dataset.f = 'boardName'; title.dataset.ph = '보드 이름';
    body.append(title, mk('div', 'doc-meta', '셸 ' + S.count() + '개 · 캔버스와 같은 내용이에요. 여기서 고쳐도 캔버스에 그대로 반영돼요.'));
    if (!S.count()) body.append(mk('p', 'empty', '아직 셸이 없어요. 아래 버튼이나 캔버스 더블클릭으로 시작하세요.'));
    const depth = (s) => { let d = 0, p = s.parent; while (p) { if (!S.isText(S.get(p))) d++; p = S.get(p).parent; } return d; };
    S.walk((s) => {
      const sec = mk('section', 'sec' + (S.isText(s) ? ' note' : '')); sec.id = 'sec-' + s.id; sec.dataset.id = s.id;
      if (!S.isText(s)) {
        const d = depth(s);
        const h = editable(mk('div', 'h h' + Math.min(d + 1, 6), s.title)); h.dataset.f = 'title'; h.dataset.ph = '제목 없음';
        h.setAttribute('role', 'heading'); h.setAttribute('aria-level', String(Math.min(d + 2, 6)));
        sec.append(h);
      }
      const p = editable(mk('div', 'p md')); p.dataset.f = 'body'; p.dataset.ph = S.isText(s) ? '글을 입력하세요' : '내용을 적어 보세요';
      p.innerHTML = SW.md(s.body);
      sec.append(p); body.append(sec);
    });
    const rel = S.board.arrows.filter((x) => S.get(x.from) && S.get(x.to));
    if (rel.length) {
      const box = mk('div', 'relations'); box.append(mk('h3', '', '관계 (캔버스 화살표)'));
      const ul = mk('ul'); rel.forEach((x) => ul.append(mk('li', '', S.label(S.get(x.from)) + ' → ' + S.label(S.get(x.to)))));
      box.append(ul); body.append(box);
    }
    const add = mk('button', 'btn add-sec', '+ 섹션 추가');
    add.onclick = D.addSection; body.append(add);
    if (focus) D.focus(focus.id, focus.f);
    editCheckpoint = true;
  };

  D.focus = (id, f) => {
    const t = id ? body.querySelector('#sec-' + id + ' [data-f="' + (f || 'title') + '"]') : body.querySelector('[data-f="boardName"]');
    if (!t) return;
    t.focus(); const r = document.createRange(); r.selectNodeContents(t); r.collapse(false);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  };

  D.addSection = () => {
    S.checkpoint();
    const roots = S.board.roots.map(S.get);
    const y = roots.length ? Math.max(...roots.map((r) => r.y)) + 220 : 80;
    const x = roots.length ? Math.min(...roots.map((r) => r.x)) : 80;
    const s = S.add({ x, y }, null); S.changed(); D.focus(s.id);
  };
  const addAfter = (id) => {
    const s = S.get(id); S.checkpoint(); let n;
    if (s.parent) n = S.add({}, s.parent, S.get(s.parent).children.indexOf(id) + 1);
    else n = S.add({ x: s.x, y: s.y + 160, w: s.w }, null);
    S.changed(); D.focus(n.id);
  };
  const indent = (id) => {
    const s = S.get(id); const sib = s.parent ? S.get(s.parent).children : S.ordered(); const prev = sib[sib.indexOf(id) - 1];
    if (!prev) return; S.checkpoint(); S.place(id, prev, 'into'); S.changed(); D.focus(id);
  };
  const outdent = (id) => {
    const s = S.get(id); if (!s.parent) return; const p = S.get(s.parent); S.checkpoint();
    if (p.parent) S.place(id, p.id, 'after'); else S.place(id, null, 'root', { x: p.x, y: p.y + 40 });
    S.changed(); D.focus(id);
  };

  /* ---------- mind map ---------- */
  const ctx = document.createElement('canvas').getContext('2d');
  const fitText = (t, max) => {
    ctx.font = '13px "Noto Sans KR", system-ui, sans-serif';
    if (ctx.measureText(t).width <= max) return t;
    let s = t; while (s.length > 1 && ctx.measureText(s + '…').width > max) s = s.slice(0, -1);
    return s + '…';
  };
  D.renderMap = () => {
    const sel = $('#mapRoot'); const keep = sel.value;
    sel.textContent = ''; sel.append(new Option('보드 전체', ''));
    const shellIds = (ids) => ids.filter((i) => !S.isText(S.get(i)));
    shellIds(S.ordered()).forEach((id) => sel.append(new Option(S.get(id).title || '제목 없음', id)));
    sel.value = keep && S.get(keep) && !S.get(keep).parent ? keep : '';

    const make = (id) => ({ id, label: S.get(id).title || '제목 없음', kids: shellIds(S.get(id).children).map(make) });
    const tree = sel.value ? make(sel.value) : { id: null, label: S.board.name, kids: shellIds(S.ordered()).map(make) };
    const colW = [], ROW = 40, GAP = 64, PAD = 14;
    let leaf = 0;
    const lay = (n, d, b) => {
      n.d = d; n.b = b; n.text = fitText(n.label, 220); ctx.font = (d === 0 ? '700 ' : '500 ') + '13px "Noto Sans KR", system-ui, sans-serif';
      n.w = Math.ceil(ctx.measureText(n.text).width) + PAD * 2; colW[d] = Math.max(colW[d] || 0, n.w);
      if (!n.kids.length) { n.y = leaf++ * ROW; } else { n.kids.forEach((k, i) => lay(k, d + 1, d === 0 ? i % 8 : b)); n.y = (n.kids[0].y + n.kids[n.kids.length - 1].y) / 2; }
    };
    lay(tree, 0, 0);
    const colX = [0]; for (let i = 1; i < colW.length; i++) colX[i] = colX[i - 1] + colW[i - 1] + GAP;
    const W = colX[colX.length - 1] + colW[colW.length - 1] + 4, H = Math.max(1, leaf) * ROW + 4;
    const svg = $('#mapSvg'); svg.setAttribute('width', W); svg.setAttribute('height', H); svg.setAttribute('viewBox', '-2 -2 ' + W + ' ' + H);
    svg.textContent = '';
    const NS = 'http://www.w3.org/2000/svg';
    const el = (t, a) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
    const links = el('g', {}), nodes = el('g', {});
    const draw = (n) => {
      const x = colX[n.d], cy = n.y + 15;
      n.kids.forEach((k) => {
        const x1 = x + n.w, x2 = colX[k.d], ky = k.y + 15, mx = (x1 + x2) / 2;
        links.append(el('path', { class: 'link', style: 'stroke: var(--br' + k.b + ')', d: 'M' + x1 + ',' + cy + ' C' + mx + ',' + cy + ' ' + mx + ',' + ky + ' ' + x2 + ',' + ky }));
        draw(k);
      });
      const g = el('g', { class: 'node' + (n.d === 0 ? ' root' : '') + (n.id && n.id === D.mapSel ? ' sel' : ''), tabindex: n.id ? '0' : '-1', style: '--brc: var(--br' + n.b + ')' });
      if (n.id) { g.dataset.id = n.id; if (S.get(n.id).color) g.setAttribute('data-color', S.get(n.id).color); }
      g.append(el('rect', { x, y: n.y, width: n.w, height: 30, rx: 15 }));
      const t = el('text', { x: x + PAD, y: n.y + 20 }); t.textContent = n.text; g.append(t);
      const tt = el('title', {}); tt.textContent = n.label; g.append(tt);
      nodes.append(g);
    };
    draw(tree); svg.append(links, nodes);
  };

  /* ---------- mind map editing, Xmind-style: Tab child, Enter sibling, F2 rename, arrows to move ---------- */
  D.mapSel = null;
  D.mapSelect = (id) => {
    D.mapSel = id;
    document.querySelectorAll('#mapSvg .node').forEach((g) => g.classList.toggle('sel', g.dataset.id === id));
  };
  D.mapRename = (id) => {
    const s = S.get(id), g = document.querySelector('#mapSvg .node[data-id="' + id + '"]'); if (!s || !g) return;
    D.mapSelect(id);
    const wrap = $('.map-scroll'), r = g.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
    const inp = document.createElement('input'); inp.className = 'map-input'; inp.value = S.label(s); inp.setAttribute('aria-label', '가지 이름');
    Object.assign(inp.style, { left: (r.left - wr.left + wrap.scrollLeft) + 'px', top: (r.top - wr.top + wrap.scrollTop) + 'px', width: Math.max(160, r.width + 40) + 'px', height: r.height + 'px' });
    wrap.append(inp); inp.focus(); inp.select();
    let done = false;
    const finish = (save) => {
      if (done) return; done = true; const v = inp.value.trim(); inp.remove();
      if (save && v && v !== S.label(s)) { S.checkpoint(); if (S.isText(s)) s.body = v; else s.title = v; S.changed(); }
      setTimeout(() => D.mapSelect(id), 0);
    };
    inp.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    inp.addEventListener('blur', () => finish(true));
  };
  function mapAdd(id, asChild) {
    const s = S.get(id); if (!s) return;
    let n;
    S.checkpoint();
    if (asChild) {
      if (S.isText(s)) { S.undoStack.pop(); SW.ui.toast('글 조각 아래에는 가지를 붙일 수 없어요'); return; }
      if (S.level(id) >= S.MAX_LEVEL) { S.undoStack.pop(); SW.canvas.depthWarn(); return; }
      n = S.add({ title: '새 가지' }, id); s.collapsed = false;
    } else if (s.parent) n = S.add({ title: '새 가지' }, s.parent, S.get(s.parent).children.indexOf(id) + 1);
    else n = S.add({ title: '새 가지', x: s.x, y: s.y + 200, w: s.w || 320 }, null);
    S.changed(); D.mapSel = n.id; D.renderMap(); D.mapRename(n.id);
  }
  function mapKeys(e) {
    if (SW.main.view !== 'map' || e.isComposing || e.keyCode === 229) return;
    const a = document.activeElement; if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable)) return;
    if (!$('#modal').hidden || !$('#keysheet').hidden || (SW.keys && SW.keys.paletteOpen)) return;
    const id = D.mapSel && S.get(D.mapSel) ? D.mapSel : null;
    const pick = (x) => { if (x) { D.mapSelect(x); const g = document.querySelector('#mapSvg .node[data-id="' + x + '"]'); if (g && g.scrollIntoView) g.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } };
    if (!id) { if (/^Arrow/.test(e.key)) { e.preventDefault(); pick(S.ordered().find((x) => !S.isText(S.get(x)))); } return; }
    const s = S.get(id), sib = (s.parent ? S.get(s.parent).children : S.ordered()).filter((x) => !S.isText(S.get(x)));
    if (e.key === 'Tab') { e.preventDefault(); mapAdd(id, !e.shiftKey); }
    else if (e.key === 'Enter') { e.preventDefault(); mapAdd(id, false); }
    else if (e.key === 'F2') { e.preventDefault(); D.mapRename(id); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); const next = s.parent || null; S.checkpoint(); S.remove(id); D.mapSel = next; S.changed(); SW.ui.toast('가지를 지웠어요', '되돌리기', S.undo); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); pick(s.parent); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); pick(s.children.find((x) => !S.isText(S.get(x)))); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); pick(sib[sib.indexOf(id) - 1]); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); pick(sib[sib.indexOf(id) + 1]); }
  }

  D.init = () => {
    body = $('#docBody');
    /* body text shows formatted; clicking in swaps to the raw text to edit, leaving swaps back */
    body.addEventListener('focusin', (e) => {
      editCheckpoint = true;
      const t = e.target; if (!t.dataset || t.dataset.f !== 'body') return;
      const s = S.get(t.closest('.sec').dataset.id); if (!s) return;
      t.textContent = s.body;
      const r = document.createRange(); r.selectNodeContents(t); r.collapse(false);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    });
    body.addEventListener('focusout', (e) => {
      const t = e.target; if (!t.dataset || t.dataset.f !== 'body') return;
      const sec = t.closest('.sec'), s = sec && S.get(sec.dataset.id); if (s) t.innerHTML = SW.md(s.body);
    });
    body.addEventListener('input', (e) => {
      const t = e.target; if (!t.dataset || !t.dataset.f) return;
      if (editCheckpoint) { S.checkpoint(); editCheckpoint = false; }
      if (t.dataset.f === 'boardName') { S.board.name = readText(t).replace(/\n/g, ' ').trim() || '제목 없는 보드'; SW.main.showBoardName(); S.changed('text'); return; }
      const id = t.closest('.sec').dataset.id; const s = S.get(id); if (!s) return;
      if (t.dataset.f === 'title') s.title = readText(t).replace(/\n/g, ' ');
      else s.body = readText(t);
      S.changed('text');
    });
    body.addEventListener('keydown', (e) => {
      const t = e.target; if (!t.dataset || !t.dataset.f || e.isComposing || e.keyCode === 229) return;
      if (t.dataset.f === 'boardName') { if (e.key === 'Enter') { e.preventDefault(); t.blur(); } return; }
      const id = t.closest('.sec').dataset.id;
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addAfter(id); }
      else if (e.key === 'Enter' && t.dataset.f === 'title') { e.preventDefault(); D.focus(id, 'body'); }
      else if (e.key === 'Tab') { e.preventDefault(); if (e.shiftKey) outdent(id); else indent(id); }
    });
    if (!PLAIN) body.addEventListener('paste', (e) => {
      const t = e.target.closest && e.target.closest('[data-f]'); if (!t) return;
      e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain'));
    });
    $('#mapRoot').addEventListener('change', D.renderMap);
    $('#mapSvg').addEventListener('click', (e) => { const g = e.target.closest('g.node[data-id]'); if (g) D.mapSelect(g.dataset.id); });
    $('#mapSvg').addEventListener('dblclick', (e) => { const g = e.target.closest('g.node[data-id]'); if (g) D.mapRename(g.dataset.id); });
    $('#mapGo').addEventListener('click', () => { if (!D.mapSel || !S.get(D.mapSel)) { SW.ui.toast('먼저 가지 하나를 골라 주세요'); return; } const id = D.mapSel; SW.main.setView('canvas'); SW.canvas.reveal(id); });
    document.addEventListener('keydown', mapKeys);
  };
})(window.SW);
