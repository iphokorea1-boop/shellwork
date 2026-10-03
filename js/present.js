/* Shellwork — presentation mode. The board becomes the slides: the camera glides from shell to shell
 * in reading order, everything else dims, and an optional AI-written script sits under the controls. */
(function (SW) {
  'use strict';
  const S = SW.store, C = SW.canvas;
  const $ = (q) => document.querySelector(q);
  const Pr = SW.present = { on: false, steps: [], i: 0, notes: false };
  const TOP = 40;

  const bottomPad = () => (Pr.notes ? 250 : 104);
  function buildSteps() {
    const out = [{ id: null }];
    S.walk((s) => { if (!S.isText(s)) out.push({ id: s.id }); });
    out.push({ id: null, end: true });
    return out;
  }

  function targetFor(step) {
    if (!step.id) return C.frameTarget(C.boardRect(), { top: TOP + 24, bottom: bottomPad(), side: 64, maxK: 1 });
    const el = C.els.get(step.id); if (!el) return null;
    const R = C.worldRect(el), pad = 26;
    const R2 = { x: R.x - pad, y: R.y - pad, w: R.w + pad * 2, h: R.h + pad * 2 };
    const t = C.frameTarget(R2, { top: TOP, bottom: bottomPad(), side: 48, minK: 0.6, maxK: 1.6 });
    const availH = C.vpRect().height - TOP - bottomPad();
    if (R2.h * t.k > availH + 1) t.y = TOP - R2.y * t.k; // too tall: start from its top
    return t;
  }

  function spotlight(id) {
    const layer = $('#shellLayer');
    C.els.forEach((el) => el.classList.remove('spot', 'spot-root'));
    layer.classList.toggle('spotlight', !!id);
    if (!id || !C.els.get(id)) return;
    C.els.get(id).classList.add('spot');
    C.els.get(S.rootOf(id).id).classList.add('spot-root');
  }

  function showNotes() {
    const st = Pr.steps[Pr.i], s = st && st.id ? S.get(st.id) : null;
    const has = Object.values(S.board.shells).some((x) => x.notes);
    $('#notesGen').textContent = has ? 'AI로 대본 다시 만들기' : 'AI로 대본 만들기';
    const p = $('#notesText');
    if (!s) p.textContent = Pr.i === 0 ? '전체 흐름을 먼저 보여 주는 화면이에요. 오늘 이야기할 순서를 짧게 소개해 보세요.' : '마지막 화면이에요. 핵심을 한 문장으로 정리하고 질문을 받아 보세요.';
    else p.textContent = s.notes || '이 셸에는 아직 대본이 없어요. 위 버튼을 누르면 AI가 셸 전체의 대본을 한 번에 써 줘요.';
    p.classList.toggle('empty', !s || !s.notes);
  }

  function go(i) {
    if (!Pr.on) return;
    let n = Math.max(0, Math.min(Pr.steps.length - 1, i));
    while (Pr.steps[n] && Pr.steps[n].id && !C.els.get(Pr.steps[n].id) && n < Pr.steps.length - 1) n += (i >= Pr.i ? 1 : -1) || 1;
    Pr.i = n; const st = Pr.steps[n];
    spotlight(st.id);
    const t = targetFor(st); if (t) SW.motion.camera(t, SW.motion.cfg().cam + 220);
    const s = st.id ? S.get(st.id) : null;
    $('#presTitle').textContent = s ? (s.title.trim() || '제목 없음') : n === 0 ? S.board.name : '전체 보기';
    $('#presCount').textContent = (n + 1) + ' / ' + Pr.steps.length;
    $('#presentFill').style.width = (Pr.steps.length > 1 ? (n / (Pr.steps.length - 1)) * 100 : 100) + '%';
    $('#presPrev').disabled = n === 0; $('#presNext').disabled = n === Pr.steps.length - 1;
    if (Pr.notes) showNotes();
  }
  Pr.next = () => go(Pr.i + 1);
  Pr.prev = () => go(Pr.i - 1);
  const refit = () => { if (Pr.on) requestAnimationFrame(() => go(Pr.i)); };

  Pr.start = () => {
    if (!S.count()) { SW.ui.toast('발표할 셸이 없어요. 먼저 셸을 만들어 주세요.'); return; }
    SW.main.setView('canvas'); SW.ui.closeMenus(); $('#aiPanel').hidden = true;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    Pr.on = true; Pr.steps = buildSteps(); Pr.i = 0;
    $('#app').classList.add('presenting'); $('#presentUI').hidden = false;
    C.clearSelection(); C.forceOpen = true; C.render({ instant: true }); $('#shellLayer').inert = true;
    try { const r = document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* optional */ }
    requestAnimationFrame(() => requestAnimationFrame(() => go(0)));
  };
  Pr.stop = () => {
    if (!Pr.on) return;
    Pr.on = false; spotlight(null);
    $('#app').classList.remove('presenting'); $('#presentUI').hidden = true;
    C.forceOpen = false; $('#shellLayer').inert = false; C.render({ instant: true });
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    requestAnimationFrame(() => C.fit());
  };
  const toggleNotes = () => { Pr.notes = !Pr.notes; $('#presentNotes').hidden = !Pr.notes; if (Pr.notes) showNotes(); go(Pr.i); };

  async function makeNotes() {
    const b = $('#notesGen'); if (b.disabled) return;
    b.disabled = true; const old = b.textContent; b.textContent = '대본 쓰는 중…';
    try {
      const r = await SW.ai.speakerNotes();
      if (!r) return;
      let n = 0;
      Object.keys(r).forEach((k) => { const s = S.get(k.replace(/[[\]]/g, '')); if (s && r[k]) { s.notes = String(r[k]).slice(0, 1200); n++; } });
      SW.persist.schedule(); showNotes();
      SW.ui.toast(n + '개 셸의 대본을 만들었어요');
    } catch (e) { SW.ui.toast(SW.ai.errText(e)); } finally { b.disabled = false; if (b.textContent === '대본 쓰는 중…') b.textContent = old; showNotes(); }
  }

  Pr.init = () => {
    $('#presentBtn').onclick = Pr.start;
    $('#presPrev').onclick = Pr.prev; $('#presNext').onclick = Pr.next; $('#presExit').onclick = Pr.stop;
    $('#presNotes').onclick = toggleNotes; $('#notesGen').onclick = makeNotes;
    $('#presentHit').addEventListener('click', (e) => { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX - r.left < r.width * 0.25) Pr.prev(); else Pr.next(); });
    window.addEventListener('keydown', (e) => {
      if (!Pr.on) return;
      const k = e.key;
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(k)) Pr.next();
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(k)) Pr.prev();
      else if (k === 'Home') go(0);
      else if (k === 'End') go(Pr.steps.length - 1);
      else if (k === 'Escape') Pr.stop();
      else if (k === 'n' || k === 'N') toggleNotes();
      else return;
      e.preventDefault(); e.stopImmediatePropagation();
    }, true);
    window.addEventListener('resize', refit);
    document.addEventListener('fullscreenchange', refit);
  };
})(window.SW);
