/* Shellwork — canvas input, Arky-style:
 * click selects, a second click edits, drag moves (onto a shell = put inside), drag the empty canvas to
 * box-select, space / middle button / hand tool / touch to pan, side dots to draw arrows. */
(function (SW) {
  'use strict';
  const S = SW.store, C = SW.canvas;
  const $ = (q) => document.querySelector(q);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const I = SW.input = { space: false };
  const LIST = /^(\s*)([-*•]|\d+[.)])\s+(.*)$/;
  let vp, layer, wireLayer, tempWire, editCheckpoint = true;

  const part = (el, sel) => el.querySelector(':scope > .shell-body > ' + sel);
  const panning = (e) => e.button === 1 || C.tool === 'hand' || I.space;
  const markClasses = ['drop-into', 'drop-before', 'drop-after', 'arrow-target'];
  const unmark = () => layer.querySelectorAll('.' + markClasses.join(',.')).forEach((x) => x.classList.remove(...markClasses));
  const listen = (move, up) => {
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  };

  function nodeAt(cx, cy, exclude) {
    for (const n of document.elementsFromPoint(cx, cy)) {
      const sh = n.closest && n.closest('#shellLayer .shell');
      if (!sh || sh.classList.contains('drag-clone')) continue;
      if (exclude && exclude.some((x) => x === sh || x.contains(sh))) return { self: true };
      return { el: sh };
    }
    return null;
  }
  function dropMode(t, cy) {
    const s = S.get(t.dataset.id); if (!s) return null;
    if (t.classList.contains('root')) return S.isText(s) ? null : 'into';
    const top = t.getBoundingClientRect().top, bottom = t.querySelector(':scope > .shell-body').getBoundingClientRect().bottom;
    if (S.isText(s)) return cy < (top + bottom) / 2 ? 'before' : 'after';
    if (cy > bottom) return 'into';
    const rel = (cy - top) / Math.max(1, bottom - top), open = s.children.length && !s.collapsed;
    if (rel < 0.3) return 'before';
    if (rel > 0.72 && !open) return 'after';
    return 'into';
  }

  /* ---------- move / nest ---------- */
  function startDrag(e, el, onClick) {
    const id = el.dataset.id, s = S.get(id), isRoot = !s.parent;
    const sx = e.clientX, sy = e.clientY;
    let dragging = false, target = null, mode = null, movers = [], clone = null, off = null, others = [], snap = { dx: 0, dy: 0 };
    const begin = () => {
      dragging = true; C.dragging = true; SW.ui.closeMenus(); C.placeSelBar();
      const p = C.toWorld(sx, sy);
      if (isRoot) {
        const group = C.selected.has(id) ? [...C.selected].filter((i) => S.get(i) && !S.get(i).parent && C.els.get(i)) : [];
        if (!group.includes(id)) group.push(id);
        movers = group.map((i) => ({ id: i, el: C.els.get(i), s: S.get(i), ox: p.x - S.get(i).x, oy: p.y - S.get(i).y }));
        movers.forEach((m) => m.el.classList.add('lifted'));
        const moving = new Set(movers.map((m) => m.id));
        others = S.board.roots.filter((r) => !moving.has(r) && C.els.get(r)).map((r) => { const el = C.els.get(r), s2 = S.get(r); return { x: s2.x, y: s2.y, w: el.offsetWidth, h: el.offsetHeight }; });
      } else {
        const r = el.getBoundingClientRect(), tl = C.toWorld(r.left, r.top);
        off = { x: p.x - tl.x, y: p.y - tl.y };
        clone = el.cloneNode(true); clone.classList.remove('selected', 'nested', 'd1', 'd2', 'd3', 'editing'); clone.classList.add('root', 'drag-clone');
        clone.style.width = (r.width / C.view.k) + 'px';
        const src = el.querySelectorAll('textarea'); clone.querySelectorAll('textarea').forEach((t, i) => { t.value = src[i].value; });
        layer.appendChild(clone); el.classList.add('ghosted');
      }
    };
    const stop = listen((ev) => {
      if (ev.pointerId !== e.pointerId) return;
      if (!dragging) { if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return; begin(); }
      const w = C.toWorld(ev.clientX, ev.clientY);
      if (isRoot) {
        snap = snapTo(movers.find((m) => m.id === id) || movers[0], w, others);
        movers.forEach((m) => { m.el.style.left = (w.x - m.ox + snap.dx) + 'px'; m.el.style.top = (w.y - m.oy + snap.dy) + 'px'; });
        C.updateOrder(true);
      }
      else { clone.style.left = (w.x - off.x) + 'px'; clone.style.top = (w.y - off.y) + 'px'; }
      C.drawWires(); unmark();
      const hit = nodeAt(ev.clientX, ev.clientY, isRoot ? movers.map((m) => m.el) : [el]);
      target = hit && hit.el ? hit.el : null;
      mode = hit && hit.self ? 'self' : target ? dropMode(target, ev.clientY) : null;
      if (target && !mode) target = null;
      if (target) target.classList.add('drop-' + mode);
    }, (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      stop();
      if (!dragging) { if (ev.type === 'pointerup') onClick(ev); return; }
      C.dragging = false; unmark();
      guides(null); if (isRoot) movers.forEach((m) => m.el.classList.remove('lifted'));
      else { C.flipFrom = { id, rect: clone.getBoundingClientRect() }; clone.remove(); el.classList.remove('ghosted'); }
      if (ev.type === 'pointercancel') { C.flipFrom = null; C.render(); return; }
      const w = C.toWorld(ev.clientX, ev.clientY);
      S.checkpoint();
      if (target) {
        const tid = target.dataset.id;
        const ids = (isRoot ? movers.map((m) => m.id) : [id]).sort((a, b) => S.get(a).y - S.get(b).y);
        let ok = false;
        (mode === 'after' ? ids.slice().reverse() : ids).forEach((i) => { if (S.place(i, tid, mode)) ok = true; });
        if (ok) { S.changed(); SW.motion.flash(C.els.get(mode === 'into' ? tid : id)); } else { S.undoStack.pop(); C.render(); if (S.lastError === 'depth') C.depthWarn(); }
      } else if (mode === 'self') { S.undoStack.pop(); C.render(); }
      else if (isRoot) { movers.forEach((m) => { m.s.x = Math.round(w.x - m.ox + snap.dx); m.s.y = Math.round(w.y - m.oy + snap.dy); }); S.changed(); }
      else { S.place(id, null, 'root', { x: w.x - off.x, y: w.y - off.y }); C.selected = new Set([id]); S.changed(); SW.motion.flash(C.els.get(id)); }
    });
  }

  /* ---------- alignment: snap the dragged shell's edges or centre to its neighbours ---------- */
  function snapTo(m, w, others) {
    if (!m) return { dx: 0, dy: 0 };
    const T = 6 / C.view.k, px = w.x - m.ox, py = w.y - m.oy, pw = m.el.offsetWidth, ph = m.el.offsetHeight;
    let bx = null, by = null;
    others.forEach((o) => {
      [o.x, o.x + o.w / 2, o.x + o.w].forEach((cx) => [px, px + pw / 2, px + pw].forEach((v) => {
        const d = cx - v; if (Math.abs(d) < T && (!bx || Math.abs(d) < Math.abs(bx.d))) bx = { d, x: cx, o };
      }));
      [o.y, o.y + o.h / 2, o.y + o.h].forEach((cy) => [py, py + ph / 2, py + ph].forEach((v) => {
        const d = cy - v; if (Math.abs(d) < T && (!by || Math.abs(d) < Math.abs(by.d))) by = { d, y: cy, o };
      }));
    });
    const r = { dx: bx ? bx.d : 0, dy: by ? by.d : 0 };
    const me = { x: px + r.dx, y: py + r.dy, w: pw, h: ph };
    guides(bx || by ? {
      v: bx ? { x: bx.x, y1: Math.min(me.y, bx.o.y) - 16, y2: Math.max(me.y + me.h, bx.o.y + bx.o.h) + 16 } : null,
      h: by ? { y: by.y, x1: Math.min(me.x, by.o.x) - 16, x2: Math.max(me.x + me.w, by.o.x + by.o.w) + 16 } : null,
    } : null);
    return r;
  }
  function guides(g) {
    const svg = $('#guideLayer'); if (!svg) return;
    svg.textContent = ''; if (!g) return;
    const NS = 'http://www.w3.org/2000/svg';
    const line = (x1, y1, x2, y2) => { const l = document.createElementNS(NS, 'line'); l.setAttribute('x1', x1); l.setAttribute('y1', y1); l.setAttribute('x2', x2); l.setAttribute('y2', y2); svg.append(l); };
    if (g.v) line(g.v.x, g.v.y1, g.v.x, g.v.y2);
    if (g.h) line(g.h.x1, g.h.y, g.h.x2, g.h.y);
  }

  /* ---------- sections: drag by the label (contents come along), resize at the corner ---------- */
  function startSection(e, sec, secEl) {
    C.selectSection(sec.id);
    const r0 = { x: sec.x, y: sec.y, w: sec.w, h: sec.h }, p0 = C.toWorld(e.clientX, e.clientY);
    const resizing = e.target.classList.contains('section-resize');
    const inside = resizing ? [] : S.board.roots.filter((id) => {
      const el = C.els.get(id), s = S.get(id); if (!el) return false;
      return s.x >= sec.x - 2 && s.y >= sec.y - 2 && s.x + el.offsetWidth <= sec.x + sec.w + 2 && s.y + el.offsetHeight <= sec.y + sec.h + 2;
    }).map((id) => ({ id, x: S.get(id).x, y: S.get(id).y }));
    let moved = false;
    const stop = listen((ev) => {
      if (ev.pointerId !== e.pointerId) return;
      const p = C.toWorld(ev.clientX, ev.clientY), dx = p.x - p0.x, dy = p.y - p0.y;
      if (!moved && Math.hypot(dx, dy) * C.view.k < 4) return;
      if (!moved) { moved = true; S.checkpoint(); }
      if (resizing) {
        sec.w = Math.round(Math.max(180, r0.w + dx)); sec.h = Math.round(Math.max(110, r0.h + dy));
        secEl.style.width = sec.w + 'px'; secEl.style.height = sec.h + 'px';
      } else {
        sec.x = Math.round(r0.x + dx); sec.y = Math.round(r0.y + dy); secEl.style.left = sec.x + 'px'; secEl.style.top = sec.y + 'px';
        inside.forEach((o) => { const s = S.get(o.id), el = C.els.get(o.id); s.x = Math.round(o.x + dx); s.y = Math.round(o.y + dy); if (el) { el.style.left = s.x + 'px'; el.style.top = s.y + 'px'; } });
        C.drawWires();
      }
    }, (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      stop(); if (moved) { S.changed('text'); C.updateOrder(); }
    });
  }

  /* ---------- arrows from the side dots ---------- */
  function startArrow(e, el) {
    const from = el.dataset.id; let target = null;
    const stop = listen((ev) => {
      if (ev.pointerId !== e.pointerId) return;
      const A = C.headRect(from), p = C.toWorld(ev.clientX, ev.clientY);
      tempWire.setAttribute('d', C.route(A, { x: p.x, y: p.y, w: 0, h: 0 }));
      unmark(); const hit = nodeAt(ev.clientX, ev.clientY, [el]);
      target = hit && hit.el ? hit.el : null; if (target) target.classList.add('arrow-target');
    }, (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      stop(); tempWire.setAttribute('d', ''); unmark();
      if (!target || ev.type !== 'pointerup') return;
      const to = target.dataset.id;
      if (S.board.arrows.some((a) => a.from === from && a.to === to)) return;
      S.checkpoint(); S.board.arrows.push({ id: SW.uid('a'), from, to }); S.changed();
    });
  }
  function startResize(e, el) {
    const s = S.get(el.dataset.id), sx = e.clientX, w0 = s.w || 320; let done = false;
    const stop = listen((ev) => {
      if (ev.pointerId !== e.pointerId) return;
      if (!done) { S.checkpoint(); done = true; }
      s.w = Math.round(clamp(w0 + (ev.clientX - sx) / C.view.k, 180, 760)); el.style.width = s.w + 'px';
      el.querySelectorAll('textarea:not([hidden])').forEach(C.autosize); C.drawWires(); C.placeSelBar();
    }, (ev) => { if (ev.pointerId !== e.pointerId) return; stop(); if (done) S.changed(); });
  }

  /* ---------- typing ---------- */
  function onKey(e) {
    const ta = e.target; if (ta.tagName !== 'TEXTAREA' || e.isComposing || e.keyCode === 229) return;
    const el = ta.closest('.shell'), id = el.dataset.id, s = S.get(id), body = ta.dataset.f === 'body';
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.altKey) { e.preventDefault(); C.addSiblingAfter(id); return; }
    if (e.key === 'Escape') { e.preventDefault(); ta.blur(); C.select(id); return; }
    if (!body) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); C.editBody(id); }
      else if (e.key === 'Tab') { e.preventDefault(); if (e.shiftKey) C.outdent(id); else C.indent(id); }
      else if (e.key === 'Backspace' && !s.title && !s.body && !s.children.length && s.parent) {
        e.preventDefault(); const p = s.parent; S.checkpoint(); S.remove(id); S.changed(); C.focusShell(p);
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.code === 'KeyB' || e.code === 'KeyI')) { // bold / italic toggle
      e.preventDefault();
      const mark = e.code === 'KeyB' ? '**' : '*', a = ta.selectionStart, b = ta.selectionEnd, val = ta.value, n = mark.length;
      const wrapped = val.slice(a - n, a) === mark && val.slice(b, b + n) === mark;
      ta.value = wrapped ? val.slice(0, a - n) + val.slice(a, b) + val.slice(b + n) : val.slice(0, a) + mark + val.slice(a, b) + mark + val.slice(b);
      ta.setSelectionRange(wrapped ? a - n : a + n, wrapped ? b - n : b + n);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const v = ta.value, at = ta.selectionStart, ls = v.lastIndexOf('\n', at - 1) + 1, le = v.indexOf('\n', at) < 0 ? v.length : v.indexOf('\n', at);
    const line = v.slice(ls, le), m = LIST.exec(line);
    const set = (nv, caret) => { ta.value = nv; ta.setSelectionRange(caret, caret); ta.dispatchEvent(new Event('input', { bubbles: true })); };
    if (e.key === 'Enter' && !e.shiftKey && m && ta.selectionEnd === at) {
      e.preventDefault();
      if (!m[3].trim()) { set(v.slice(0, ls) + v.slice(le), ls); return; } // empty item ends the list
      const marker = /\d/.test(m[2]) ? (parseInt(m[2], 10) + 1) + m[2].replace(/\d+/, '') : m[2];
      const ins = '\n' + m[1] + marker + ' ';
      set(v.slice(0, at) + ins + v.slice(at), at + ins.length);
    } else if (e.key === 'Tab' && m) {
      e.preventDefault();
      if (e.shiftKey) { const cut = Math.min(2, m[1].length); if (cut) set(v.slice(0, ls) + line.slice(cut) + v.slice(le), Math.max(ls, at - cut)); }
      else set(v.slice(0, ls) + '  ' + line + v.slice(le), at + 2);
    } else if (e.key === 'Tab') { e.preventDefault(); if (e.shiftKey) C.outdent(id); else C.indent(id); }
  }

  I.init = () => {
    vp = $('#viewport'); layer = $('#shellLayer'); wireLayer = $('#wireLayer'); tempWire = $('#tempWire');

    layer.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || panning(e)) return;
      let sh = e.target.closest('.shell'); if (!sh) return;
      const t = e.target;
      if (t.closest('button')) { e.stopPropagation(); return; }
      e.stopPropagation();
      if (t.classList.contains('port')) { e.preventDefault(); startArrow(e, sh); return; }
      if (t.classList.contains('resize')) { e.preventDefault(); startResize(e, sh); return; }
      const id = sh.dataset.id, only = C.selected.has(id) && C.selected.size === 1;
      const ta = t.closest('textarea');
      if (ta && (document.activeElement === ta || only)) return; // typing: leave the caret alone
      const ae = document.activeElement;
      if (ae && layer.contains(ae) && ae.closest('.shell') !== sh) { ae.blur(); sh = C.els.get(id); if (!sh) return; }
      e.preventDefault();
      const onText = !!(t.closest('.md') || t.closest('textarea'));
      startDrag(e, sh, (ev) => {
        if (ev.shiftKey || ev.metaKey || ev.ctrlKey) { C.select(id, true); return; }
        if (!only) { C.select(id); return; }
        const n = S.get(id);
        if (onText || (S.isText(n) && !S.isImage(n))) C.editBody(id); // a picture edits only from its caption
      });
    });
    layer.addEventListener('dblclick', (e) => {
      const sh = e.target.closest('.shell'); if (!sh || e.target.closest('button')) return;
      const id = sh.dataset.id;
      if (e.target.closest('.pic-frame')) SW.images.view(id);
      else if (e.target.closest('textarea.t')) C.focusShell(id, 'title');
      else if ((S.isText(S.get(id)) && !S.isImage(S.get(id))) || e.target.closest('.md')) C.editBody(id);
      else C.focusShell(id, 'title');
    });
    layer.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]'); if (!b) return;
      const id = b.closest('.shell').dataset.id;
      if (b.dataset.act === 'fold') { S.checkpoint(); S.get(id).collapsed = !S.get(id).collapsed; S.changed(); }
      else if (b.dataset.act === 'src') C.showSource(id);
    });
    layer.addEventListener('focusin', (e) => { if (e.target.tagName === 'TEXTAREA') editCheckpoint = true; });
    layer.addEventListener('focusout', (e) => {
      const ta = e.target; if (ta.tagName !== 'TEXTAREA' || ta.dataset.f !== 'body') return;
      const el = ta.closest('.shell'); if (el) C.endEdit(el);
    });
    layer.addEventListener('input', (e) => {
      const ta = e.target; if (ta.tagName !== 'TEXTAREA') return;
      const s = S.get(ta.closest('.shell').dataset.id); if (!s) return;
      if (editCheckpoint && C.fresh !== s.id) { S.checkpoint(); editCheckpoint = false; }
      if (C.fresh === s.id && ta.value) { C.fresh = null; editCheckpoint = false; }
      s[ta.dataset.f] = ta.value; C.autosize(ta); C.drawWires(); C.placeSelBar(); S.changed('text');
    });
    layer.addEventListener('keydown', onKey);

    const secLayer = $('#sectionLayer');
    secLayer.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || panning(e) || e.target.classList.contains('section-input')) return;
      const secEl = e.target.closest('.section'); if (!secEl) return;
      const sec = (S.board.sections || []).find((x) => x.id === secEl.dataset.sid); if (!sec) return;
      e.stopPropagation(); e.preventDefault();
      const ae = document.activeElement; if (ae && layer.contains(ae)) ae.blur();
      startSection(e, sec, secEl);
    });
    secLayer.addEventListener('dblclick', (e) => { const l = e.target.closest('.section-label'); if (l) C.renameSection(l.parentElement.dataset.sid); });

    /* arrows: click selects (a bar offers name / flip / delete), double-click names the relation */
    const pickArrow = (e) => {
      const g = e.target.closest('g[data-id], .wire-label'); if (!g || panning(e)) return;
      e.stopPropagation(); const ae = document.activeElement; if (ae && layer.contains(ae)) ae.blur();
      C.selectArrow(g.dataset.id);
    };
    const nameArrow = (e) => { const g = e.target.closest('g[data-id], .wire-label'); if (!g) return; e.stopPropagation(); C.editArrowLabel(g.dataset.id); };
    wireLayer.addEventListener('pointerdown', pickArrow);
    wireLayer.addEventListener('dblclick', nameArrow);
    const labelLayer = $('#wireLabels');
    labelLayer.addEventListener('pointerdown', (e) => { if (e.target.classList.contains('wire-label')) pickArrow(e); });
    labelLayer.addEventListener('dblclick', (e) => { if (e.target.classList.contains('wire-label')) nameArrow(e); });

    /* background: box-select with the mouse, pan with touch / space / middle button / hand tool */
    const pts = new Map(); let pan = null, pinch = null, box = null;
    const marquee = $('#marquee');
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    vp.addEventListener('pointerdown', (e) => {
      if (e.button === 2) return;
      const onNode = e.target.closest('.shell') || e.target.closest('g[data-id]') || e.target.closest('.wire-label, .wire-input');
      if (onNode && !panning(e)) return;
      SW.ui.closeMenus(); SW.motion.stopCamera();
      const ae = document.activeElement; if (ae && layer.contains(ae)) ae.blur();
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { vp.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d: dist(a, b) || 1, k: C.view.k, m: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, vx: C.view.x, vy: C.view.y }; pan = null; box = null; marquee.hidden = true;
      } else if (panning(e) || e.pointerType === 'touch') {
        pan = { sx: e.clientX, sy: e.clientY, vx: C.view.x, vy: C.view.y, moved: false }; vp.classList.add('panning');
      } else {
        box = { sx: e.clientX, sy: e.clientY, add: e.shiftKey || e.metaKey, base: e.shiftKey || e.metaKey ? [...C.selected] : [], moved: false };
      }
      if (e.button === 1) e.preventDefault();
    });
    vp.addEventListener('pointermove', (e) => {
      if (SW.collab && SW.collab.active) SW.collab.cursor(C.toWorld(e.clientX, e.clientY));
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pts.size >= 2) {
        const [a, b] = [...pts.values()], r = vp.getBoundingClientRect();
        const k2 = clamp(pinch.k * dist(a, b) / pinch.d, 0.15, 2.5);
        const wx = (pinch.m.x - r.left - pinch.vx) / pinch.k, wy = (pinch.m.y - r.top - pinch.vy) / pinch.k;
        const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        C.view = { k: k2, x: m.x - r.left - wx * k2, y: m.y - r.top - wy * k2 }; C.applyView();
      } else if (pan) {
        const dx = e.clientX - pan.sx, dy = e.clientY - pan.sy;
        if (Math.abs(dx) + Math.abs(dy) > 3) pan.moved = true;
        C.view.x = pan.vx + dx; C.view.y = pan.vy + dy; C.applyView();
      } else if (box) {
        if (!box.moved && Math.hypot(e.clientX - box.sx, e.clientY - box.sy) < 4) return;
        box.moved = true;
        const r = vp.getBoundingClientRect();
        const x0 = Math.min(box.sx, e.clientX), y0 = Math.min(box.sy, e.clientY), x1 = Math.max(box.sx, e.clientX), y1 = Math.max(box.sy, e.clientY);
        Object.assign(marquee.style, { left: (x0 - r.left) + 'px', top: (y0 - r.top) + 'px', width: (x1 - x0) + 'px', height: (y1 - y0) + 'px' });
        marquee.hidden = false;
        const hits = S.board.roots.filter((id) => { const q = C.els.get(id) && C.els.get(id).getBoundingClientRect(); return q && q.left < x1 && q.right > x0 && q.top < y1 && q.bottom > y0; });
        const next = [...new Set([...box.base, ...hits])];
        if (next.join() !== [...C.selected].join()) C.selectMany(next);
      }
    });
    const endPtr = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (pts.size) return;
      if (box && !box.moved && !box.add) C.clearSelection();
      if (pan && !pan.moved && e.pointerType === 'touch') C.clearSelection();
      box = null; marquee.hidden = true; pan = null; vp.classList.remove('panning');
    };
    vp.addEventListener('pointerup', endPtr); vp.addEventListener('pointercancel', endPtr);
    vp.addEventListener('dblclick', (e) => {
      if (e.target.closest('.shell') || e.target.closest('g[data-id]') || e.target.closest('.wire-label, .wire-input')) return;
      C.addText(C.toWorld(e.clientX, e.clientY));
    });
    vp.addEventListener('wheel', (e) => {
      e.preventDefault(); SW.motion.stopCamera();
      const unit = e.deltaMode === 1 ? 16 : 1;
      if (e.ctrlKey || e.metaKey) C.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * unit * 0.0022));
      else { C.view.x -= e.deltaX * unit; C.view.y -= e.deltaY * unit; C.applyView(); }
    }, { passive: false });

    /* hold space to pan */
    const typingNow = () => { const a = document.activeElement; return a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT' || a.isContentEditable); };
    window.addEventListener('keydown', (e) => { if (e.code === 'Space' && !typingNow() && !(SW.present && SW.present.on)) { if (!I.space) { I.space = true; vp.classList.add('hand'); } e.preventDefault(); } });
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') { I.space = false; vp.classList.toggle('hand', C.tool === 'hand'); } });

    /* AI answers, pictures and text files dragged onto the canvas */
    const MIME = 'application/x-shellwork';
    const hasFiles = (e) => [...e.dataTransfer.types].includes('Files');
    const shellUnder = (e) => { const hit = nodeAt(e.clientX, e.clientY); return hit && hit.el && !S.isText(S.get(hit.el.dataset.id)) ? hit.el : null; };
    vp.addEventListener('dragover', (e) => {
      const ours = [...e.dataTransfer.types].includes(MIME);
      if (!ours && !hasFiles(e)) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; unmark();
      const t = shellUnder(e); if (t) t.classList.add('drop-into');
    });
    vp.addEventListener('dragleave', (e) => { if (e.target === vp) unmark(); });
    vp.addEventListener('drop', (e) => {
      const files = [...(e.dataTransfer.files || [])];
      const photos = files.filter((f) => f.type.indexOf('image/') === 0);
      if (photos.length) { // a picture goes in as it is; dropped on a shell it goes inside
        e.preventDefault(); const t = shellUnder(e); unmark();
        SW.images.insertFiles(photos, C.toWorld(e.clientX, e.clientY), t ? t.dataset.id : null); return;
      }
      const boardFile = files.find((f) => SW.transfer.isBoardFile(f));
      if (boardFile) { e.preventDefault(); unmark(); SW.transfer.importFile(boardFile); return; }
      const doc = files.find((f) => SW.main.isTextFile(f));
      if (doc) { e.preventDefault(); unmark(); SW.main.importFile(doc); return; }
      if (files.length) { e.preventDefault(); unmark(); SW.ui.toast('사진, .md, .txt, 보드 파일(.shellwork.json)을 넣을 수 있어요'); return; }
      const raw = e.dataTransfer.getData(MIME); if (!raw) return;
      e.preventDefault(); unmark();
      let trees; try { trees = JSON.parse(raw); } catch (err) { return; }
      const hit = nodeAt(e.clientX, e.clientY);
      S.checkpoint();
      if (hit && hit.el && !S.isText(S.get(hit.el.dataset.id))) { S.insertTrees(trees, 0, 0, hit.el.dataset.id); S.changed(); }
      else { const w = C.toWorld(e.clientX, e.clientY); const made = S.insertTrees(trees, w.x - 20, w.y - 14); S.changed(); C.tidy(made.map((m) => m.id)); }
      SW.ui.toast('AI 답변을 캔버스에 놓았어요', '되돌리기', S.undo);
    });
  };
  I.setTool = (t) => {
    C.tool = t; vp.classList.toggle('hand', t === 'hand');
    document.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
  };
})(window.SW);
