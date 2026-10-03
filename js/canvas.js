/* Shellwork — spatial canvas: view, rendering, arrows, selection bar, focus and structure edits.
 * Pointer and keyboard handling for the canvas live in input.js. */
(function (SW) {
  'use strict';
  const S = SW.store;
  const $ = (q) => document.querySelector(q);
  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
  const icon = (n) => '<svg aria-hidden="true"><use href="#i-' + n + '"/></svg>';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const C = SW.canvas = { view: { x: 40, y: 20, k: 1 }, selected: new Set(), selArrow: null, els: new Map(), tool: 'select', editing: null, focusId: null, fresh: null };
  let vp, layer, world, wireLayer, tempWire, viewTimer = null;
  C.dom = () => ({ vp, layer, world, wireLayer, tempWire });
  C.COLORS = ['', 'rose', 'amber', 'lime', 'sky', 'violet', 'slate'];

  /* ---------- view ---------- */
  const toWorld = (cx, cy) => { const r = vp.getBoundingClientRect(); return { x: (cx - r.left - C.view.x) / C.view.k, y: (cy - r.top - C.view.y) / C.view.k }; };
  C.toWorld = toWorld;
  C.vpRect = () => vp.getBoundingClientRect();
  C.applyView = () => {
    const { x, y, k } = C.view;
    world.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + k + ')';
    $('#zoomReset').textContent = Math.round(k * 100) + '%';
    if (SW.collab && SW.collab.active) SW.collab.placeCursors();
    C.placeSelBar();
    clearTimeout(viewTimer);
    viewTimer = setTimeout(() => S.board && SW.ls.set('shellwork.view.' + S.board.id, JSON.stringify(C.view)), 400);
  };
  C.loadView = () => {
    try { const v = JSON.parse(SW.ls.get('shellwork.view.' + S.board.id)); if (v && isFinite(v.k)) { C.view = v; C.applyView(); return true; } } catch (e) { /* none */ }
    return false;
  };
  const zoomTarget = (cx, cy, f) => {
    const r = vp.getBoundingClientRect(); const px = cx - r.left, py = cy - r.top;
    const k2 = clamp(C.view.k * f, 0.15, 2.5), m = k2 / C.view.k;
    return { k: k2, x: px - (px - C.view.x) * m, y: py - (py - C.view.y) * m };
  };
  C.zoomAt = (cx, cy, f) => { SW.motion.stopCamera(); C.view = zoomTarget(cx, cy, f); C.applyView(); };
  C.zoomCenter = (f) => { const r = vp.getBoundingClientRect(); SW.motion.camera(zoomTarget(r.left + r.width / 2, r.top + r.height / 2, f)); };
  C.frameTarget = (R, o) => {
    o = Object.assign({ side: 56, top: 76, bottom: 84, minK: 0.2, maxK: 1 }, o);
    const vr = vp.getBoundingClientRect(); if (vr.width < 600) o.side = 20;
    const k = clamp(Math.min((vr.width - o.side * 2) / Math.max(1, R.w), (vr.height - o.top - o.bottom) / Math.max(1, R.h)), o.minK, o.maxK);
    return { k, x: (vr.width - R.w * k) / 2 - R.x * k, y: o.top + (vr.height - o.top - o.bottom - R.h * k) / 2 - R.y * k };
  };
  C.boardRect = () => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    S.board.roots.forEach((id) => { const s = S.get(id), el = C.els.get(id); const w = el ? el.offsetWidth : 320, h = el ? el.offsetHeight : 120;
      x0 = Math.min(x0, s.x); y0 = Math.min(y0, s.y); x1 = Math.max(x1, s.x + w); y1 = Math.max(y1, s.y + h); });
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };
  C.worldRect = (el) => {
    const r = el.getBoundingClientRect(), vr = vp.getBoundingClientRect(), k = C.view.k;
    return { x: (r.left - vr.left - C.view.x) / k, y: (r.top - vr.top - C.view.y) / k, w: r.width / k, h: r.height / k };
  };
  C.fit = (instant) => {
    const vr = vp.getBoundingClientRect();
    const target = !S.board.roots.length || !vr.width ? { x: 40, y: 20, k: 1 } : C.frameTarget(C.boardRect());
    if (instant === true) { SW.motion.stopCamera(); C.view = target; C.applyView(); } else SW.motion.camera(target);
  };
  C.center = () => { const r = vp.getBoundingClientRect(); return toWorld(r.left + r.width / 2, r.top + r.height / 2); };

  /* ---------- render ---------- */
  C.autosize = (ta) => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
  const part = (el, sel) => el.querySelector(':scope > .shell-body > ' + sel);

  function buildNode(id, depth) {
    const s = S.get(id), text = S.isText(s), kids = s.children.length, shut = s.collapsed && kids && !C.forceOpen;
    const el = document.createElement('div');
    el.className = 'shell ' + (depth === 0 ? 'root' : 'nested d' + Math.min(depth, 3)) + (text ? ' text' : '') + (shut ? ' collapsed' : '') +
      (C.selected.has(id) ? ' selected' : '') + (s.ai ? ' ai' : '') + (SW.ai && SW.ai.busy.has(id) ? ' busy' : '');
    el.dataset.id = id;
    if (s.color) el.dataset.color = s.color;
    if (depth === 0) { el.style.left = s.x + 'px'; el.style.top = s.y + 'px'; el.style.width = (s.w || (text ? 340 : 320)) + 'px'; }
    el.innerHTML =
      '<div class="shell-body">' +
        (text ? '' : '<textarea class="t" rows="1" data-f="title" spellcheck="false"></textarea>') +
        '<div class="md" data-f="body"></div><textarea class="b" rows="1" data-f="body" hidden></textarea>' +
        (s.ai ? '<span class="ai-mark" title="AI가 만든 내용">' + icon('spark') + '</span>' : '') +
      '</div>' +
      (s.src ? '<button class="src-chip" data-act="src">' + icon(s.src.kind === 'photo' ? 'camera' : 'doc') + '<span></span></button>' : '') +
      (shut ? '<button class="collapsed-note" data-act="fold">하위 ' + S.descendants(id).length + '개 펼치기</button>' : '') +
      '<div class="children"></div>' +
      (depth === 0 ? '<span class="order-badge"></span><span class="port" data-side="t"></span><span class="port" data-side="r"></span><span class="port" data-side="b"></span><span class="port" data-side="l"></span><span class="resize" title="너비 조절"></span>' : '');
    if (s.src) el.querySelector(':scope > .src-chip > span').textContent = srcLabel(s.src);
    const ta = part(el, 'textarea.t');
    if (ta) { ta.value = s.title; ta.placeholder = depth ? '소제목' : '제목 없음'; ta.setAttribute('aria-label', '셸 제목'); }
    const md = part(el, '.md'); md.innerHTML = SW.md(s.body); md.dataset.ph = text ? '글을 입력하세요' : '내용';
    const tb = part(el, 'textarea.b'); tb.value = s.body; tb.placeholder = text ? '글을 입력하세요' : '내용을 적어 보세요';
    tb.setAttribute('aria-label', text ? '글' : '셸 내용');
    C.els.set(id, el); // parents before children: the motion code relies on this order
    const box = el.querySelector(':scope > .children');
    if (!shut) s.children.forEach((c) => box.appendChild(buildNode(c, depth + 1)));
    return el;
  }

  C.render = (opts) => {
    const M = SW.motion;
    const animate = M && M.on() && !(opts && opts.instant) && C.lastBoard === S.board.id && vp.offsetParent !== null && C.els.size > 0;
    const before = animate ? M.capture(C.els) : null, oldEls = animate ? new Map(C.els) : null;
    const a = document.activeElement; let focus = null;
    if (a && a.tagName === 'TEXTAREA' && layer.contains(a)) focus = { id: a.closest('.shell').dataset.id, f: a.dataset.f, s: a.selectionStart, e: a.selectionEnd };
    C.rendering = true;
    C.els.clear(); layer.textContent = '';
    for (const id of S.board.roots) layer.appendChild(buildNode(id, 0));
    C.renderSections(); C.updateOrder();
    layer.querySelectorAll('textarea.t').forEach(C.autosize);
    [...C.selected].forEach((id) => { if (!S.get(id)) C.selected.delete(id); });
    if (C.editing && !S.get(C.editing)) C.editing = null;
    C.rendering = false;
    if (focus && C.els.get(focus.id)) {
      if (focus.f === 'body') C.editBody(focus.id, focus);
      else { const t = part(C.els.get(focus.id), 'textarea.t'); if (t) { t.focus({ preventScroll: true }); try { t.setSelectionRange(focus.s, focus.e); } catch (e) { /* ignore */ } } }
    } else C.editing = null;
    if (animate) M.play({ before, oldEls, els: C.els, k: C.view.k, ghostLayer: $('#ghostLayer'), toWorld, from: C.flipFrom });
    C.flipFrom = null; C.lastBoard = S.board.id;
    C.drawWires();
    $('#emptyHint').hidden = S.count() > 0;
    if (C.focusId) C.spot(C.focusId);
    C.selSig = null; C.placeSelBar();
    if (SW.collab && SW.collab.decorate) setTimeout(SW.collab.decorate, 0);
  };

  const openAncestors = (id) => {
    let p = S.get(id) && S.get(id).parent, opened = false;
    while (p) { if (S.get(p).collapsed) { S.get(p).collapsed = false; opened = true; } p = S.get(p).parent; }
    if (opened) C.render();
  };
  /* swap a node's rendered text for its editor */
  C.editBody = (id, sel) => {
    openAncestors(id);
    const el = C.els.get(id); if (!el) return;
    if (!C.selected.has(id) || C.selected.size > 1) C.select(id);
    const md = part(el, '.md'), tb = part(el, 'textarea.b');
    md.hidden = true; tb.hidden = false; el.classList.add('editing'); C.editing = id;
    C.autosize(tb); tb.focus({ preventScroll: true });
    const n = tb.value.length;
    try { tb.setSelectionRange(sel && sel.s != null ? sel.s : n, sel && sel.e != null ? sel.e : n); } catch (e) { /* ignore */ }
    C.drawWires(); C.placeSelBar();
  };
  C.endEdit = (el) => {
    if (C.rendering || !el.isConnected) return;
    const id = el.dataset.id, s = S.get(id); if (!s) return;
    const md = part(el, '.md'), tb = part(el, 'textarea.b');
    md.innerHTML = SW.md(s.body); md.hidden = false; tb.hidden = true; el.classList.remove('editing');
    if (C.editing === id) C.editing = null;
    if (S.isText(s) && !s.body.trim() && !s.children.length) { // an empty note disappears, like a cancelled sticky
      if (C.fresh === id) S.undoStack.pop(); else S.checkpoint();
      C.fresh = null; S.remove(id); C.selected.delete(id); S.changed(); return;
    }
    C.drawWires(); C.placeSelBar();
  };
  C.focusShell = (id, field) => {
    openAncestors(id);
    const s = S.get(id); if (!s) return;
    if (S.isText(s) || field === 'body') { C.editBody(id); return; }
    const el = C.els.get(id); if (!el) return;
    if (!C.selected.has(id) || C.selected.size > 1) C.select(id);
    const t = part(el, 'textarea.t');
    if (t) { t.focus({ preventScroll: true }); const n = t.value.length; t.setSelectionRange(n, n); }
  };
  C.reveal = (id) => {
    openAncestors(id);
    const el = C.els.get(id); if (!el) return;
    const r = el.getBoundingClientRect(), vr = vp.getBoundingClientRect();
    SW.motion.camera({
      k: C.view.k,
      x: C.view.x + vr.left + vr.width / 2 - (r.left + r.width / 2),
      y: C.view.y + vr.top + vr.height / 2 - (r.top + Math.min(r.height, vr.height * 0.6) / 2),
    });
    C.select(id); SW.motion.flash(el);
  };

  /* ---------- selection ---------- */
  const afterSelect = () => {
    if (C.selSection) { C.selSection = null; document.querySelectorAll('.section.selected').forEach((e) => e.classList.remove('selected')); }
    C.els.forEach((el, i) => el.classList.toggle('selected', C.selected.has(i)));
    C.drawWires(); C.placeSelBar();
    if (SW.main && SW.main.markOutline) SW.main.markOutline();
  };
  C.select = (id, add) => {
    if (!add) C.selected.clear();
    if (add && C.selected.has(id)) C.selected.delete(id); else C.selected.add(id);
    C.selArrow = null; afterSelect();
  };
  C.selectMany = (ids, add) => { if (!add) C.selected.clear(); ids.forEach((i) => C.selected.add(i)); C.selArrow = null; afterSelect(); };
  C.clearSelection = () => { C.selected.clear(); C.selArrow = null; afterSelect(); };
  C.deleteSelected = () => {
    if (C.selSection) {
      S.checkpoint(); S.board.sections = (S.board.sections || []).filter((x) => x.id !== C.selSection); C.selSection = null; S.changed();
      SW.ui.toast('섹션을 지웠어요. 안의 내용은 그대로예요', '되돌리기', S.undo); return;
    }
    if (C.selArrow) {
      S.checkpoint(); S.board.arrows = S.board.arrows.filter((a) => a.id !== C.selArrow); C.selArrow = null; S.changed();
      SW.ui.toast('화살표를 지웠어요', '되돌리기', S.undo); return;
    }
    const ids = [...C.selected].filter((id) => S.get(id) && ![...C.selected].some((o) => o !== id && S.isAncestor(o, id)));
    if (!ids.length) return;
    S.checkpoint(); ids.forEach((id) => S.remove(id)); C.selected.clear(); S.changed();
    SW.ui.toast(ids.length + '개를 지웠어요', '되돌리기', S.undo);
  };

  /* ---------- arrows: elbow lines between the nearest sides ---------- */
  C.headRect = (id) => {
    let s = S.get(id); while (s && !C.els.get(s.id)) s = s.parent ? S.get(s.parent) : null;
    if (!s) return null;
    const el = C.els.get(s.id), vr = vp.getBoundingClientRect(), k = C.view.k, r = el.getBoundingClientRect();
    const bottom = el.classList.contains('root') ? r.bottom : el.querySelector(':scope > .shell-body').getBoundingClientRect().bottom;
    return { x: (r.left - vr.left - C.view.x) / k, y: (r.top - vr.top - C.view.y) / k, w: r.width / k, h: Math.max(1, (bottom - r.top) / k) };
  };
  const mid = (R) => ({ x: R.x + R.w / 2, y: R.y + R.h / 2 });
  function elbow(pts) {
    let d = 'M' + pts[0].x + ',' + pts[0].y;
    for (let i = 1; i < pts.length - 1; i++) {
      const p0 = pts[i - 1], p = pts[i], p2 = pts[i + 1];
      const d1 = Math.hypot(p.x - p0.x, p.y - p0.y), d2 = Math.hypot(p2.x - p.x, p2.y - p.y);
      const r = Math.min(10, d1 / 2, d2 / 2);
      if (!d1 || !d2 || r < 0.5) { d += ' L' + p.x + ',' + p.y; continue; }
      d += ' L' + (p.x - (p.x - p0.x) / d1 * r) + ',' + (p.y - (p.y - p0.y) / d1 * r) +
           ' Q' + p.x + ',' + p.y + ' ' + (p.x + (p2.x - p.x) / d2 * r) + ',' + (p.y + (p2.y - p.y) / d2 * r);
    }
    const e = pts[pts.length - 1];
    return d + ' L' + e.x + ',' + e.y;
  }
  C.route = (A, B) => {
    const a = mid(A), b = mid(B);
    const gx = Math.max(B.x - (A.x + A.w), A.x - (B.x + B.w)), gy = Math.max(B.y - (A.y + A.h), A.y - (B.y + B.h));
    if (gx >= gy && gx > 12) {
      const oy0 = Math.max(A.y, B.y), oy1 = Math.min(A.y + A.h, B.y + B.h);
      if (oy1 - oy0 > 24) { // rows overlap: one straight line, no kink
        const y = (oy0 + oy1) / 2, r = b.x > a.x;
        return 'M' + (r ? A.x + A.w : A.x) + ',' + y + ' L' + (r ? B.x - 2 : B.x + B.w + 2) + ',' + y;
      }
      const right = b.x > a.x, p1 = { x: right ? A.x + A.w : A.x, y: a.y }, p2 = { x: right ? B.x - 2 : B.x + B.w + 2, y: b.y }, mx = (p1.x + p2.x) / 2;
      return elbow([p1, { x: mx, y: p1.y }, { x: mx, y: p2.y }, p2]);
    }
    if (gy > 12) {
      const ox0 = Math.max(A.x, B.x), ox1 = Math.min(A.x + A.w, B.x + B.w);
      if (ox1 - ox0 > 24) { // columns overlap: straight down or up
        const x = (ox0 + ox1) / 2, dn = b.y > a.y;
        return 'M' + x + ',' + (dn ? A.y + A.h : A.y) + ' L' + x + ',' + (dn ? B.y - 2 : B.y + B.h + 2);
      }
      const down = b.y > a.y, p1 = { x: a.x, y: down ? A.y + A.h : A.y }, p2 = { x: b.x, y: down ? B.y - 2 : B.y + B.h + 2 }, my = (p1.y + p2.y) / 2;
      return elbow([p1, { x: p1.x, y: my }, { x: p2.x, y: my }, p2]);
    }
    return 'M' + a.x + ',' + a.y + ' L' + b.x + ',' + b.y;
  };
  C.drawWires = () => {
    if (!wireLayer) return;
    wireLayer.textContent = '';
    for (const a of S.board.arrows) {
      if (a.from === a.to) continue;
      const A = C.headRect(a.from), B = C.headRect(a.to); if (!A || !B) continue;
      const d = C.route(A, B), sel = C.selArrow === a.id;
      const g = svgEl('g', { 'data-id': a.id, class: sel ? 'sel' : '' });
      g.append(svgEl('path', { class: 'hit', d }), svgEl('path', { class: 'wire', d, 'marker-end': 'url(#' + (sel ? 'ah-sel' : 'ah') + ')' }));
      wireLayer.appendChild(g);
    }
  };

  /* ---------- selection bar (Arky-style actions above what is selected) ---------- */
  const kbd = (t) => '<kbd>' + t + '</kbd>';
  function buildSelBar(ids) {
    const bar = $('#selBar'), one = ids.length === 1 ? S.get(ids[0]) : null;
    const btn = (act, label, extra) => '<button data-sel="' + act + '"' + (extra || '') + '>' + label + '</button>';
    let h = '';
    if (one && !S.isText(one)) h += btn('focus', '집중');
    if (one && one.parent) h += btn('out', '밖으로 빼기 ' + kbd(SW.keys.fmt('Shift+Tab')));
    h += btn('wrap', '셸로 감싸기 ' + kbd(SW.keys.fmt('Mod+G')));
    h += btn('chat', 'AI에게 보내기 ' + kbd(SW.keys.fmt('Mod+L')));
    if (one) h += btn('ai', icon('spark') + ' AI', ' class="ai" title="AI로 발전시키기"');
    h += btn('more', icon('more'), ' class="icon" title="더보기" aria-label="더보기"');
    bar.innerHTML = h;
  }
  C.placeSelBar = () => {
    const bar = $('#selBar'); if (!bar) return;
    const ids = [...C.selected].filter((id) => C.els.get(id));
    if (!ids.length || C.dragging || C.selArrow || (SW.present && SW.present.on) || !vp || vp.offsetParent === null) { bar.hidden = true; return; }
    const sig = ids.join(',');
    if (sig !== C.selSig) { C.selSig = sig; buildSelBar(ids); }
    bar.hidden = false;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    ids.forEach((id) => { const r = C.els.get(id).getBoundingClientRect(); x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom); });
    const sr = bar.parentElement.getBoundingClientRect(), bw = bar.offsetWidth, bh = bar.offsetHeight;
    let top = y0 - sr.top - bh - 10;
    if (top < 58) top = Math.min(y1 - sr.top + 10, sr.height - bh - 80);
    bar.style.left = clamp((x0 + x1) / 2 - sr.left - bw / 2, 8, sr.width - bw - 8) + 'px';
    bar.style.top = Math.max(58, top) + 'px';
  };

  /* ---------- focus: zoom into one shell and dim the rest ---------- */
  C.spot = (id) => {
    layer.classList.toggle('spotlight', !!id);
    C.els.forEach((el) => el.classList.remove('spot', 'spot-root'));
    if (!id || !C.els.get(id)) return;
    C.els.get(id).classList.add('spot'); C.els.get(S.rootOf(id).id).classList.add('spot-root');
  };
  C.focus = (id) => {
    openAncestors(id);
    const el = C.els.get(id); if (!el) return;
    C.focusId = id; C.spot(id);
    const R = C.worldRect(el), pad = 36;
    SW.motion.camera(C.frameTarget({ x: R.x - pad, y: R.y - pad, w: R.w + pad * 2, h: R.h + pad * 2 }, { top: 72, bottom: 90, minK: 0.45, maxK: 1.3 }));
    renderCrumbs(id); $('#focusBar').hidden = false;
    if (SW.main.track) SW.main.track('focus');
  };
  C.unfocus = () => {
    if (!C.focusId) return;
    C.focusId = null; C.spot(null); $('#focusBar').hidden = true; C.fit();
  };

  /* ---------- structure edits ---------- */
  C.addRoot = (pos, fields) => {
    S.checkpoint();
    const c = pos || C.center();
    const s = S.add(Object.assign({ x: Math.round(c.x - 24), y: Math.round(c.y - 24), w: 320 }, fields), null);
    S.changed(); C.tidy([s.id]); C.focusShell(s.id);
    return s;
  };
  C.addText = (pos, parentId) => {
    S.checkpoint();
    const c = pos || C.center();
    const s = parentId ? S.add({ kind: 'text' }, parentId) : S.add({ kind: 'text', x: Math.round(c.x - 8), y: Math.round(c.y - 14), w: 340 }, null);
    if (parentId) S.get(parentId).collapsed = false;
    C.fresh = s.id; S.changed(); C.editBody(s.id);
    if (SW.main.track) SW.main.track('text');
    return s;
  };
  C.addChild = (id) => { S.checkpoint(); const c = S.add({}, id); S.get(id).collapsed = false; S.changed(); C.focusShell(c.id); };
  C.addSiblingAfter = (id) => {
    const s = S.get(id); S.checkpoint(); const f = S.isText(s) ? { kind: 'text' } : {}; let n;
    if (s.parent) n = S.add(f, s.parent, S.get(s.parent).children.indexOf(id) + 1);
    else { const el = C.els.get(id); n = S.add(Object.assign(f, { x: s.x, y: s.y + (el ? el.offsetHeight : 120) + 24, w: s.w }), null); }
    if (S.isText(n)) C.fresh = n.id;
    S.changed(); if (!s.parent) C.tidy([n.id]); C.focusShell(n.id);
  };
  C.indent = (id) => {
    const s = S.get(id); const sib = s.parent ? S.get(s.parent).children : S.ordered();
    const prev = sib.slice(0, sib.indexOf(id)).reverse().find((x) => !S.isText(S.get(x))); if (!prev) return;
    S.checkpoint();
    if (!S.place(id, prev, 'into')) { S.undoStack.pop(); C.depthWarn(); return; }
    S.changed(); C.focusShell(id);
  };
  C.outdent = (id) => {
    const s = S.get(id); if (!s.parent) return; const p = S.get(s.parent);
    S.checkpoint();
    if (p.parent) S.place(id, p.id, 'after'); else S.place(id, null, 'root', { x: p.x + (p.w || 320) + 48, y: p.y });
    S.changed(); if (!S.get(id).parent) C.tidy([id]); C.focusShell(id);
  };
  C.duplicate = (id) => {
    S.checkpoint();
    const copy = (sid, parent, index, pos) => {
      const o = S.get(sid);
      const n = S.add({ kind: o.kind, title: o.title, body: o.body, ai: o.ai, w: o.w, color: o.color, collapsed: o.collapsed, x: pos ? pos.x : 0, y: pos ? pos.y : 0 }, parent, index);
      if (!o.kind) delete n.kind;
      o.children.forEach((c) => copy(c, n.id)); return n;
    };
    const s = S.get(id);
    const n = s.parent ? copy(id, s.parent, S.get(s.parent).children.indexOf(id) + 1) : copy(id, null, null, { x: s.x + 32, y: s.y + 32 });
    S.changed(); if (!s.parent) C.tidy([n.id]); C.select(n.id);
  };
  /* a text block becomes a shell (first line → title) and back */
  C.convert = (id) => {
    const s = S.get(id); S.checkpoint();
    if (S.isText(s)) {
      const lines = s.body.split('\n'); const first = (lines.shift() || '').replace(/^[-*•]\s+|^\d+[.)]\s+|^#+\s+/, '');
      delete s.kind; s.title = first.slice(0, 120); s.body = lines.join('\n').replace(/^\n+/, ''); if (!s.parent) s.w = Math.max(s.w || 320, 300);
    } else { s.kind = 'text'; s.body = [s.title.trim() ? '**' + s.title.trim() + '**' : '', s.body].filter(Boolean).join('\n'); s.title = ''; }
    S.changed();
  };
  C.wrapSelection = () => {
    const order = []; S.walk((s) => order.push(s.id));
    const ids = [...C.selected].filter((id) => S.get(id) && C.els.get(id)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    if (!ids.length) return;
    const rects = ids.map((id) => C.worldRect(C.els.get(id)));
    const x0 = Math.min(...rects.map((r) => r.x)), y0 = Math.min(...rects.map((r) => r.y)), w = Math.max(...rects.map((r) => r.w));
    S.checkpoint();
    const sh = S.wrap(ids, { x: x0 - 22, y: y0 - 62, w: clamp(w + 46, 320, 640) });
    if (!sh) { S.undoStack.pop(); if (S.lastError === 'depth') C.depthWarn(); return; }
    C.selected = new Set([sh.id]); S.changed();
    SW.motion.flash(C.els.get(sh.id)); C.focusShell(sh.id);
    if (SW.main.track) SW.main.track('wrap');
    SW.ui.toast('셸로 감쌌어요. 제목을 붙여 보세요', '되돌리기', S.undo);
  };
  /* move the given roots down until they no longer overlap other roots */
  C.tidy = (ids) => {
    const boxes = new Map();
    S.board.roots.forEach((id) => { const el = C.els.get(id), s = S.get(id); if (el) boxes.set(id, { x: s.x, y: s.y, w: el.offsetWidth, h: el.offsetHeight }); });
    const moving = ids.filter((id) => boxes.has(id));
    const placed = [...boxes.keys()].filter((id) => !moving.includes(id)).map((id) => boxes.get(id));
    let changed = false;
    moving.sort((a, b) => boxes.get(a).y - boxes.get(b).y).forEach((id) => {
      const b = boxes.get(id); let hit, guard = 0;
      while ((hit = placed.find((o) => b.x < o.x + o.w + 24 && b.x + b.w + 24 > o.x && b.y < o.y + o.h + 24 && b.y + b.h + 24 > o.y)) && guard++ < 300) b.y = hit.y + hit.h + 28;
      placed.push(b);
      const s = S.get(id);
      if (s.y !== Math.round(b.y)) { s.y = Math.round(b.y); C.els.get(id).style.top = s.y + 'px'; changed = true; }
    });
    if (changed) { C.drawWires(); C.placeSelBar(); SW.persist.schedule(); }
  };
  C.insertText = (text, at) => {
    const trees = S.parseText(text); if (!trees.length) return 0;
    S.checkpoint();
    const c = at || C.center();
    const made = S.insertTrees(trees, c.x - (trees.length > 1 ? 360 : 160), c.y - 100);
    S.changed(); C.tidy(made.map((m) => m.id)); C.selectMany(made.map((m) => m.id));
    const n = made.reduce((t, m) => t + 1 + S.descendants(m.id).length, 0);
    SW.ui.toast(n + '개 조각으로 펼쳤어요. 골라서 "셸로 감싸기"로 묶어 보세요', '되돌리기', S.undo);
    return n;
  };

  C.colorMenu = (id, anchor) => {
    const s = S.get(id);
    SW.ui.openMenu(anchor, [{ heading: '색' }, { swatches: C.COLORS, value: s.color || '', act: (c) => {
      S.checkpoint(); [...C.selected].forEach((i) => { const n = S.get(i); if (!n) return; if (c) n.color = c; else delete n.color; }); S.changed();
    } }]);
  };
  C.moreMenu = (anchor) => {
    const ids = [...C.selected].filter((i) => S.get(i)); if (!ids.length) return;
    const id = ids[0], s = S.get(id), one = ids.length === 1;
    const items = [{ heading: '색' }, { swatches: C.COLORS, value: s.color || '', act: (c) => {
      S.checkpoint(); ids.forEach((i) => { const n = S.get(i); if (c) n.color = c; else delete n.color; }); S.changed();
    } }, '-'];
    if (one && !S.isText(s)) items.push({ label: '안에 글 추가', act: () => C.addText(null, id) }, { label: '하위 셸 추가', act: () => C.addChild(id) });
    if (one) items.push({ label: S.isText(s) ? '셸로 바꾸기 (첫 줄이 제목)' : '글로 바꾸기', act: () => C.convert(id) });
    if (one && s.parent) items.push({ label: '한 단계 밖으로 빼기', meta: '⇧Tab', act: () => C.outdent(id) });
    if (one && s.children.length) items.push({ label: s.collapsed ? '하위 펼치기' : '하위 접기', act: () => { S.checkpoint(); s.collapsed = !s.collapsed; S.changed(); } });
    if (one) items.push({ label: '복제', act: () => C.duplicate(id) });
    items.push('-');
    if (one && s.children.length) items.push({ label: '감싼 셸만 풀기 (안의 내용은 남김)', act: () => { S.checkpoint(); S.unwrap(id); S.changed(); SW.ui.toast('셸을 풀었어요', '되돌리기', S.undo); } });
    items.push({ label: '삭제', meta: 'Delete', danger: true, act: () => C.deleteSelected() });
    SW.ui.openMenu(anchor, items);
  };

  /* ---------- tree rules made visible ---------- */
  function srcLabel(src) {
    const bits = [src.kind === 'photo' ? '사진 출처' : '출처'];
    if (src.page) bits.push('p.' + src.page);
    if (src.date) bits.push(new Date(src.date).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }));
    return bits.join(' · ');
  }
  C.depthWarn = () => SW.ui.toast('제목은 6단계까지만 넣을 수 있어요 (문서의 H1~H6)');
  /* reading order of what sits on the canvas: top-to-bottom rows, left-to-right; shown as small numbers */
  C.showOrder = SW.ls.get('shellwork.order') === '1';
  C.toggleOrder = () => {
    C.showOrder = !C.showOrder; SW.ls.set('shellwork.order', C.showOrder ? '1' : '0'); C.updateOrder();
    SW.ui.toast(C.showOrder ? '문서 순서 번호를 보여 줘요. 위에서 아래, 왼쪽에서 오른쪽 순서예요' : '문서 순서 번호를 숨겼어요');
  };
  C.updateOrder = (live) => {
    if (!layer) return;
    layer.classList.toggle('show-order', C.showOrder || !!live);
    const items = S.board.roots.map((id) => { const el = C.els.get(id), s = S.get(id); return { el, x: live && el ? el.offsetLeft : s.x, y: live && el ? el.offsetTop : s.y }; }).filter((i) => i.el);
    items.sort((a, b) => a.y - b.y);
    const rows = [];
    items.forEach((i) => { const r = rows[rows.length - 1]; if (r && i.y - r[0].y < 80) r.push(i); else rows.push([i]); });
    let n = 0;
    rows.forEach((r) => r.sort((a, b) => a.x - b.x).forEach((i) => { const b = i.el.querySelector(':scope > .order-badge'); if (b) b.textContent = String(++n); }));
  };

  /* ---------- sections: a shaded area that groups things visually without changing the outline ---------- */
  C.selSection = null;
  C.renderSections = () => {
    const box = $('#sectionLayer'); if (!box) return;
    box.textContent = '';
    (S.board.sections || []).forEach((sec) => {
      const el = document.createElement('div');
      el.className = 'section' + (C.selSection === sec.id ? ' selected' : ''); el.dataset.sid = sec.id;
      if (sec.color) el.dataset.color = sec.color;
      Object.assign(el.style, { left: sec.x + 'px', top: sec.y + 'px', width: sec.w + 'px', height: sec.h + 'px' });
      const label = document.createElement('div'); label.className = 'section-label'; label.textContent = sec.title || '섹션';
      const rz = document.createElement('span'); rz.className = 'section-resize';
      el.append(label, rz); box.append(el);
    });
  };
  C.sectionFromSelection = () => {
    const ids = [...C.selected].filter((id) => S.get(id) && !S.get(id).parent && C.els.get(id));
    if (!ids.length) { SW.ui.toast('캔버스 위 조각이나 셸을 먼저 골라 주세요'); return; }
    const rs = ids.map((id) => C.worldRect(C.els.get(id)));
    const x0 = Math.min(...rs.map((r) => r.x)) - 28, y0 = Math.min(...rs.map((r) => r.y)) - 54;
    const x1 = Math.max(...rs.map((r) => r.x + r.w)) + 28, y1 = Math.max(...rs.map((r) => r.y + r.h)) + 28;
    S.checkpoint(); S.board.sections = S.board.sections || [];
    const sec = { id: SW.uid('g'), x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0), title: '섹션', color: '' };
    S.board.sections.push(sec); S.changed(); C.selectSection(sec.id); C.renameSection(sec.id);
    SW.ui.toast('섹션으로 묶었어요. 문서 목차는 바뀌지 않아요', '되돌리기', S.undo);
  };
  C.selectSection = (sid) => {
    C.selected.clear(); C.selArrow = null; C.selSection = sid;
    C.els.forEach((el) => el.classList.remove('selected'));
    document.querySelectorAll('.section').forEach((e) => e.classList.toggle('selected', e.dataset.sid === sid));
    C.drawWires(); C.placeSelBar();
    if (SW.main && SW.main.markOutline) SW.main.markOutline();
  };
  C.renameSection = (sid) => {
    const label = document.querySelector('.section[data-sid="' + sid + '"] > .section-label');
    const sec = (S.board.sections || []).find((x) => x.id === sid); if (!label || !sec) return;
    const inp = document.createElement('input'); inp.className = 'section-input'; inp.value = sec.title || ''; inp.placeholder = '섹션 이름'; inp.setAttribute('aria-label', '섹션 이름');
    label.replaceWith(inp); inp.focus(); inp.select();
    inp.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
      if (e.key === 'Escape') { inp.dataset.cancel = '1'; inp.blur(); }
      e.stopPropagation();
    });
    inp.addEventListener('blur', () => {
      const v = inp.value.trim() || '섹션';
      if (!inp.dataset.cancel && v !== sec.title) { S.checkpoint(); sec.title = v; S.changed(); } else C.renderSections();
    });
  };

  /* ---------- focus breadcrumb and sources ---------- */
  function renderCrumbs(id) {
    const nav = $('#focusCrumbs'); nav.textContent = '';
    const chain = []; let s = S.get(id); while (s) { chain.unshift(s); s = s.parent ? S.get(s.parent) : null; }
    const add = (label, act, current) => {
      const b = document.createElement(current ? 'span' : 'button'); b.className = 'crumb' + (current ? ' current' : ''); b.textContent = label;
      if (!current) b.onclick = act; nav.append(b);
    };
    add(S.board.name, C.unfocus);
    chain.forEach((n, i) => {
      const sep = document.createElement('span'); sep.className = 'crumb-sep'; sep.textContent = '›'; nav.append(sep);
      add(S.label(n), () => C.focus(n.id), i === chain.length - 1);
    });
  }
  C.showSource = (id) => {
    const s = S.get(id); if (!s || !s.src) return;
    const src = s.src;
    const text = [src.kind === 'photo' ? '사진' : '자료', src.name, src.page ? src.page + '쪽' : '', src.date ? new Date(src.date).toLocaleString('ko-KR') : ''].filter(Boolean).join(' · ');
    SW.ui.modal({ title: '이 셸의 출처', text, image: src.thumb || null, actions: [{ label: '닫기', cls: 'primary', act: () => false }] });
  };

  C.init = () => {
    vp = $('#viewport'); world = $('#world'); layer = $('#shellLayer'); wireLayer = $('#wireLayer'); tempWire = $('#tempWire');
    $('#selBar').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-sel]'); if (!b) return;
      const ids = [...C.selected].filter((i) => S.get(i)); if (!ids.length) return;
      const act = b.dataset.sel;
      if (act === 'focus') C.focus(ids[0]);
      else if (act === 'wrap') C.wrapSelection();
      else if (act === 'chat') SW.ai.attach(ids);
      else if (act === 'ai') SW.ai.openShellMenu(ids[0], b);
      else if (act === 'more') C.moreMenu(b);
      else if (act === 'out') C.outdent(ids[0]);
    });
    $('#focusExit').onclick = C.unfocus;
    $('#zoomIn').onclick = () => C.zoomCenter(1.2);
    $('#zoomOut').onclick = () => C.zoomCenter(1 / 1.2);
    $('#zoomReset').onclick = () => C.zoomCenter(1 / C.view.k);
    $('#zoomFit').onclick = () => C.fit();
    window.addEventListener('resize', () => { C.drawWires(); C.placeSelBar(); });
    SW.input.init();
  };
})(window.SW);
