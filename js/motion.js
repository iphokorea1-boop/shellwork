/* Shellwork — motion. Shells glide from where they were to where they land (FLIP),
 * new shells grow in, removed ones shrink away, and the camera eases between views.
 * Two styles the person can pick: 'smooth' (short, quiet) and 'bouncy' (springy overshoot). */
(function (SW) {
  'use strict';
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const STYLES = {
    smooth: { move: 280, moveEase: 'cubic-bezier(.2,.8,.2,1)', enter: 220, exit: 170, cam: 440, stagger: 30 },
    bouncy: { move: 620, moveEase: 'cubic-bezier(.34,1.56,.64,1)', enter: 520, exit: 300, cam: 620, stagger: 60 },
  };
  const M = SW.motion = { style: SW.ls.get('shellwork.motion') || 'smooth' };
  if (!['smooth', 'bouncy', 'off'].includes(M.style)) M.style = 'smooth';
  M.on = () => M.style !== 'off' && !reduce.matches;
  M.cfg = () => STYLES[M.style] || STYLES.smooth;
  M.set = (st) => { M.style = st; SW.ls.set('shellwork.motion', st); document.documentElement.dataset.motion = st; };
  document.documentElement.dataset.motion = M.style;

  const enterFrames = () => M.style === 'bouncy'
    ? [{ transform: 'scale(.5)', opacity: 0 }, { transform: 'scale(1.07)', opacity: 1, offset: 0.55 }, { transform: 'scale(.97)', offset: 0.8 }, { transform: 'none', opacity: 1 }]
    : [{ transform: 'scale(.96) translateY(4px)', opacity: 0 }, { transform: 'none', opacity: 1 }];
  const exitFrames = () => M.style === 'bouncy'
    ? [{ transform: 'none', opacity: 1 }, { transform: 'scale(1.06)', opacity: 1, offset: 0.3 }, { transform: 'scale(.35)', opacity: 0 }]
    : [{ transform: 'none', opacity: 1 }, { transform: 'scale(.97)', opacity: 0 }];

  /* keep arrows glued to shells while they move */
  let wireUntil = 0, wireRaf = 0;
  M.trackWires = (ms) => {
    wireUntil = Math.max(wireUntil, performance.now() + ms);
    if (wireRaf) return;
    const tick = () => {
      SW.canvas.drawWires();
      if (performance.now() < wireUntil) wireRaf = requestAnimationFrame(tick);
      else { wireRaf = 0; SW.canvas.drawWires(); }
    };
    wireRaf = requestAnimationFrame(tick);
  };

  M.capture = (els) => {
    const m = new Map();
    els.forEach((el, id) => { const r = el.getBoundingClientRect(); if (r.width) m.set(id, r); });
    return m;
  };

  /* els must be in document pre-order (parents before children) */
  M.play = ({ before, oldEls, els, k, ghostLayer, toWorld, from }) => {
    const cfg = M.cfg(); const off = new Map(); let entering = 0, longest = 0;
    els.forEach((el, id) => {
      const parentEl = el.parentElement && el.parentElement.closest('.shell');
      const po = (parentEl && off.get(parentEl)) || { x: 0, y: 0 };
      const old = from && from.id === id ? from.rect : before.get(id);
      if (!old) {
        off.set(el, po);
        const delay = Math.min(entering++, 12) * cfg.stagger;
        el.animate(enterFrames(), { duration: cfg.enter, delay, easing: M.style === 'bouncy' ? 'ease-out' : 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
        longest = Math.max(longest, cfg.enter + delay);
        return;
      }
      const r = el.getBoundingClientRect();
      const d = { x: old.left - r.left, y: old.top - r.top };
      off.set(el, d);
      const own = { x: (d.x - po.x) / k, y: (d.y - po.y) / k };
      if (Math.abs(own.x) < 0.5 && Math.abs(own.y) < 0.5) return;
      el.animate([{ transform: 'translate(' + own.x + 'px,' + own.y + 'px)' }, { transform: 'none' }], { duration: cfg.move, easing: cfg.moveEase });
      longest = Math.max(longest, cfg.move);
    });
    oldEls.forEach((el, id) => {
      if (els.has(id)) return;
      const pEl = el.parentElement && el.parentElement.closest('.shell');
      if (pEl && pEl.dataset.id && oldEls.get(pEl.dataset.id) === pEl && !els.has(pEl.dataset.id)) return; // its parent's ghost carries it
      const r = before.get(id); if (!r) return;
      const w = toWorld(r.left, r.top);
      el.classList.remove('selected', 'busy', 'nested', 'd1', 'd2', 'd3'); el.classList.add('root', 'ghost');
      el.style.left = w.x + 'px'; el.style.top = w.y + 'px'; el.style.width = (r.width / k) + 'px';
      ghostLayer.appendChild(el);
      const a = el.animate(exitFrames(), { duration: cfg.exit, easing: 'ease-in', fill: 'forwards' });
      a.onfinish = () => el.remove();
      longest = Math.max(longest, cfg.exit);
    });
    if (longest) M.trackWires(longest + 40);
  };

  /* a ring that ripples out of a shell that just received something */
  M.flash = (el) => {
    if (!el || !M.on()) return;
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 800);
    if (M.style === 'bouncy') {
      el.animate([{ transform: 'none' }, { transform: 'scale(1.035)' }, { transform: 'scale(.99)' }, { transform: 'none' }],
        { duration: 420, delay: M.cfg().move * 0.55, easing: 'ease-out' });
    }
  };

  /* camera glide: interpolate the world point at the screen centre, zoom in log space */
  let camRaf = 0;
  M.camera = (target, dur) => {
    const C = SW.canvas; cancelAnimationFrame(camRaf); camRaf = 0;
    if (!M.on()) { C.view = Object.assign({}, target); C.applyView(); return; }
    const from = Object.assign({}, C.view), T = dur || M.cfg().cam, t0 = performance.now();
    const vr = C.vpRect(), cx = vr.width / 2, cy = vr.height / 2;
    const c0 = { x: (cx - from.x) / from.k, y: (cy - from.y) / from.k };
    const c1 = { x: (cx - target.x) / target.k, y: (cy - target.y) / target.k };
    const ease = M.style === 'bouncy'
      ? (t) => 1 + 2.1 * Math.pow(t - 1, 3) + 1.1 * Math.pow(t - 1, 2)
      : (t) => 1 - Math.pow(1 - t, 3);
    const step = (now) => {
      const t = Math.min(1, (now - t0) / T), e = ease(t);
      const k = Math.exp(Math.log(from.k) + (Math.log(target.k) - Math.log(from.k)) * e);
      const c = { x: c0.x + (c1.x - c0.x) * e, y: c0.y + (c1.y - c0.y) * e };
      C.view = { k, x: cx - c.x * k, y: cy - c.y * k }; C.applyView();
      if (t < 1) camRaf = requestAnimationFrame(step);
      else { camRaf = 0; C.view = Object.assign({}, target); C.applyView(); }
    };
    camRaf = requestAnimationFrame(step);
  };
  M.stopCamera = () => { cancelAnimationFrame(camRaf); camRaf = 0; };

  /* a short scripted run on the current board, then everything is put back */
  M.demo = async () => {
    const S = SW.store, C = SW.canvas;
    if (M.demoing) return; M.demoing = true;
    SW.main.setView('canvas');
    const snap = S.snapshot(), undoLen = S.undoStack.length;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const beat = M.style === 'bouncy' ? 1250 : 1000;
    try {
      C.fit(); await wait(600);
      const host = S.ordered().map(S.get)[0];
      const at = host ? { x: host.x + (host.w || 300) + 70, y: host.y + 20 } : C.center();
      const s = S.add({ title: '애니메이션 미리 보기', body: '생기고 → 다른 셸 안으로 들어가고 → 다시 나온 뒤 → 사라져요.', x: Math.round(at.x), y: Math.round(at.y), color: 'amber' }, null);
      S.notify(); await wait(beat);
      if (host) {
        S.place(s.id, host.id, 'into'); S.notify(); M.flash(C.els.get(host.id)); await wait(beat + 200);
        S.place(s.id, null, 'root', { x: at.x, y: at.y + 60 }); S.notify(); M.flash(C.els.get(s.id)); await wait(beat);
      }
      S.remove(s.id); S.notify(); await wait(beat * 0.6);
    } finally {
      S.restoreSnapshot(snap); S.undoStack.length = undoLen; S.notify(); M.demoing = false;
    }
  };
})(window.SW);
