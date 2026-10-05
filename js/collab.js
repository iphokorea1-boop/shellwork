/* Shellwork — boards shared with friends.
 * A shared board lives at shared/<boardId>; each shell and arrow is its own document, so two people
 * editing different shells never overwrite each other. Changes stream in live through onSnapshot,
 * and the room capability shows everyone's cursor and selected shell. */
(function (SW) {
  'use strict';
  const S = SW.store;
  const $ = (q) => document.querySelector(q);
  const Co = SW.collab = {
    active: false, boardId: null, synced: new Map(), syncedArrows: new Map(), syncedSecs: new Map(), syncedName: null,
    unsubs: [], room: null, user: null, me: null, peers: [], prof: {}, cursorEls: new Map(), composing: false, pending: false,
  };
  const base = (id) => 'shared/' + id;
  const db = () => SW.persist.db;
  const GREY = '#7A7F87';

  const canon = (d) => JSON.stringify(Object.assign({
    kind: d.kind === 'text' || d.kind === 'image' ? d.kind : '', title: d.title || '', body: d.body || '', notes: d.notes || '', parent: d.parent || null, order: d.order || 0,
    x: Math.round(d.x || 0), y: Math.round(d.y || 0), w: d.w || 300, color: d.color || '', collapsed: !!d.collapsed, ai: !!d.ai,
    src: d.src ? { kind: d.src.kind || 'photo', name: d.src.name || '', date: d.src.date || 0, page: d.src.page || '', thumb: d.src.thumb || '' } : null,
  }, d.kind === 'image' ? { img: String(d.img || ''), ratio: +d.ratio || 0.75 } : {}));
  const arrowCanon = (a) => JSON.stringify(Object.assign({ from: a.from, to: a.to }, a.label ? { label: String(a.label).slice(0, 30) } : {}));
  const secCanon = (s) => JSON.stringify({ x: Math.round(s.x || 0), y: Math.round(s.y || 0), w: Math.round(s.w || 0), h: Math.round(s.h || 0), title: s.title || '', color: s.color || '' });

  /* the local tree flattened: id → canonical JSON, with each shell's position among its siblings */
  function flat() {
    const out = new Map();
    S.board.roots.forEach((id, i) => out.set(id, canon(Object.assign({}, S.get(id), { order: i }))));
    Object.values(S.board.shells).forEach((s) => s.children.forEach((c, i) => { if (S.get(c)) out.set(c, canon(Object.assign({}, S.get(c), { order: i }))); }));
    return out;
  }
  /* children arrays and roots from each shell's parent + order */
  function rebuild(b) {
    const list = Object.values(b.shells);
    list.forEach((s) => { s.children = []; if (s.parent && !b.shells[s.parent]) s.parent = null; });
    list.forEach((s) => { let p = s.parent, n = 0; while (p && n++ < 64) { if (p === s.id) { s.parent = null; break; } p = b.shells[p] ? b.shells[p].parent : null; } });
    const by = (a, c) => (a.order - c.order) || (a.id < c.id ? -1 : 1);
    list.slice().sort(by).forEach((s) => { if (s.parent) b.shells[s.parent].children.push(s.id); });
    b.roots = list.filter((s) => !s.parent).sort(by).map((s) => s.id);
    b.arrows = b.arrows.filter((a) => b.shells[a.from] && b.shells[a.to]);
  }

  async function runJobs(jobs) { for (let i = 0; i < jobs.length; i += 8) await Promise.all(jobs.slice(i, i + 8).map((f) => f())); }

  /* ---------- storage ---------- */
  Co.list = async () => {
    const snap = await db().collection('shared').orderBy('updatedAt', 'desc').limit(100).get();
    return snap.docs.map((d) => ({ id: d.id, name: d.data().name, updatedAt: d.data().updatedAt, shared: true }));
  };
  Co.load = async (id) => {
    const [meta, shells, arrows, secs] = await Promise.all([db().doc(base(id)).get(), db().collection(base(id) + '/shells').get(), db().collection(base(id) + '/arrows').get(), db().collection(base(id) + '/sections').get().catch(() => ({ docs: [] }))]);
    if (!meta.exists) return null;
    const m = meta.data();
    const b = { id, name: m.name || '함께 쓰는 보드', shared: true, shells: {}, roots: [], arrows: [], createdAt: m.createdAt, updatedAt: m.updatedAt };
    shells.docs.forEach((d) => { const v = JSON.parse(canon(d.data())); if (!v.kind) delete v.kind; b.shells[d.id] = Object.assign({ id: d.id, children: [] }, v); });
    arrows.docs.forEach((d) => { const a = JSON.parse(arrowCanon(d.data())); if (a.from && a.to) b.arrows.push(Object.assign({ id: d.id }, a)); });
    b.sections = secs.docs.map((d) => Object.assign({ id: d.id }, JSON.parse(secCanon(d.data()))));
    rebuild(b);
    Co.synced = new Map(shells.docs.map((d) => [d.id, canon(d.data())]));
    Co.syncedArrows = new Map(arrows.docs.map((d) => [d.id, arrowCanon(d.data())]));
    Co.syncedSecs = new Map(secs.docs.map((d) => [d.id, secCanon(d.data())]));
    Co.syncedName = b.name;
    return b;
  };
  /* write only what changed since the store last agreed with us */
  Co.flush = async () => {
    const id = S.board.id, cur = flat(), jobs = [];
    cur.forEach((j, sid) => { if (Co.synced.get(sid) !== j) jobs.push(() => db().doc(base(id) + '/shells/' + sid).set(JSON.parse(j)).then(() => Co.synced.set(sid, j))); });
    [...Co.synced.keys()].forEach((sid) => { if (!cur.has(sid)) jobs.push(() => db().doc(base(id) + '/shells/' + sid).delete().then(() => Co.synced.delete(sid))); });
    const curA = new Map(S.board.arrows.map((a) => [a.id, arrowCanon(a)]));
    curA.forEach((j, aid) => { if (Co.syncedArrows.get(aid) !== j) jobs.push(() => db().doc(base(id) + '/arrows/' + aid).set(JSON.parse(j)).then(() => Co.syncedArrows.set(aid, j))); });
    [...Co.syncedArrows.keys()].forEach((aid) => { if (!curA.has(aid)) jobs.push(() => db().doc(base(id) + '/arrows/' + aid).delete().then(() => Co.syncedArrows.delete(aid))); });
    const curS = new Map((S.board.sections || []).map((s) => [s.id, secCanon(s)]));
    curS.forEach((j, sid) => { if (Co.syncedSecs.get(sid) !== j) jobs.push(() => db().doc(base(id) + '/sections/' + sid).set(JSON.parse(j)).then(() => Co.syncedSecs.set(sid, j))); });
    [...Co.syncedSecs.keys()].forEach((sid) => { if (!curS.has(sid)) jobs.push(() => db().doc(base(id) + '/sections/' + sid).delete().then(() => Co.syncedSecs.delete(sid))); });
    if (jobs.length || S.board.name !== Co.syncedName) {
      const name = S.board.name;
      jobs.push(() => db().doc(base(id)).set({ name, createdAt: S.board.createdAt || Date.now(), updatedAt: Date.now() }).then(() => { Co.syncedName = name; }));
    }
    await runJobs(jobs);
  };
  /* move the open private board into the shared space */
  Co.share = async () => {
    const b = S.board;
    await SW.images.load(); // pictures come along: read them from the private board first
    Co.synced = new Map(); Co.syncedArrows = new Map(); Co.syncedSecs = new Map(); Co.syncedName = null;
    b.shared = true;
    try { await SW.images.copyHere(S.imageIds()); await Co.flush(); } catch (e) { b.shared = false; throw e; }
    try { await SW.persist.removePrivate(b.id); } catch (e) { /* the shared copy is what matters */ }
    Co.start(b);
  };
  Co.remove = async (id) => {
    const kinds = ['shells', 'arrows', 'sections', 'versions', 'images'];
    const snaps = await Promise.all(kinds.map((k) => db().collection(base(id) + '/' + k).get().catch(() => ({ docs: [] }))));
    await runJobs(snaps.flatMap((sn, i) => sn.docs.map((d) => () => db().doc(base(id) + '/' + kinds[i] + '/' + d.id).delete())));
    await db().doc(base(id)).delete();
  };

  /* ---------- live updates from others ---------- */
  Co.redraw = () => { if (Co.composing) { Co.pending = true; return; } S.notify('struct'); };
  document.addEventListener('compositionstart', () => { Co.composing = true; });
  document.addEventListener('compositionend', () => {
    Co.composing = false;
    if (Co.pending) { Co.pending = false; setTimeout(() => S.notify('struct'), 0); }
  });

  function patchText(id) {
    const s = S.get(id); if (!s) return;
    const el = SW.canvas.els.get(id);
    if (el) {
      el.querySelectorAll(':scope > .shell-body > textarea').forEach((ta) => {
        if (document.activeElement === ta || ta.value === s[ta.dataset.f]) return;
        ta.value = s[ta.dataset.f]; ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px';
      });
      SW.canvas.drawWires();
    }
    const sec = document.getElementById('sec-' + id);
    if (sec) sec.querySelectorAll('[data-f]').forEach((n) => { if (document.activeElement !== n && n.textContent !== s[n.dataset.f]) n.textContent = s[n.dataset.f]; });
    S.notify('text');
  }

  function onShells(snap) {
    if (!Co.active || S.board.id !== Co.boardId) return;
    const B = S.board, local = flat(); let structural = false; const texts = [];
    B.roots.forEach((id, i) => { if (B.shells[id]) B.shells[id].order = i; });
    Object.values(B.shells).forEach((s) => s.children.forEach((c, i) => { if (B.shells[c]) B.shells[c].order = i; }));
    snap.docChanges().forEach((ch) => {
      const id = ch.doc.id;
      if (ch.type === 'removed') {
        if (!Co.synced.has(id)) return; // our own delete
        Co.synced.delete(id);
        if (B.shells[id]) { delete B.shells[id]; structural = true; }
        return;
      }
      const j = canon(ch.doc.data()), prev = Co.synced.get(id);
      if (prev === j) return;
      Co.synced.set(id, j);
      const mine = local.get(id);
      if (mine === j) return; // our own write coming back
      if (mine !== undefined && prev !== undefined && mine !== prev) return; // unsent local edits win; they go out on the next save
      const d = JSON.parse(j), s = B.shells[id]; if (!d.kind) delete d.kind;
      if (!s) { B.shells[id] = Object.assign({ id, children: [] }, d); structural = true; return; }
      const was = JSON.parse(mine || prev || '{}');
      if (['kind', 'parent', 'order', 'x', 'y', 'w', 'collapsed', 'color', 'ai', 'src', 'img', 'ratio'].some((k) => JSON.stringify(was[k]) !== JSON.stringify(d[k]))) structural = true; else texts.push(id);
      Object.assign(s, d); if (!d.kind) delete s.kind;
      if (d.kind !== 'image') { delete s.img; delete s.ratio; }
    });
    if (structural) { rebuild(B); Co.redraw(); } else texts.forEach(patchText);
  }
  function onSections(snap) {
    if (!Co.active || S.board.id !== Co.boardId) return;
    let changed = false; S.board.sections = S.board.sections || [];
    snap.docChanges().forEach((ch) => {
      const id = ch.doc.id;
      if (ch.type === 'removed') { if (Co.syncedSecs.delete(id)) { S.board.sections = S.board.sections.filter((s) => s.id !== id); changed = true; } return; }
      const j = secCanon(ch.doc.data()); if (Co.syncedSecs.get(id) === j) return;
      Co.syncedSecs.set(id, j);
      const d = JSON.parse(j), s = S.board.sections.find((x) => x.id === id);
      if (s) Object.assign(s, d); else S.board.sections.push(Object.assign({ id }, d));
      changed = true;
    });
    if (changed) Co.redraw();
  }
  function onArrows(snap) {
    if (!Co.active || S.board.id !== Co.boardId) return;
    let changed = false;
    snap.docChanges().forEach((ch) => {
      const id = ch.doc.id;
      if (ch.type === 'removed') {
        if (Co.syncedArrows.delete(id)) { S.board.arrows = S.board.arrows.filter((a) => a.id !== id); changed = true; }
        return;
      }
      const j = arrowCanon(ch.doc.data()), prev = Co.syncedArrows.get(id); if (prev === j) return;
      Co.syncedArrows.set(id, j);
      const d = JSON.parse(j), mine = S.board.arrows.find((a) => a.id === id);
      if (!mine) { if (S.get(d.from) && S.get(d.to)) { S.board.arrows.push(Object.assign({ id }, d)); changed = true; } return; }
      const local = arrowCanon(mine);
      if (local === j || (prev !== undefined && local !== prev)) return; // ours coming back, or an unsent local edit that wins
      mine.from = d.from; mine.to = d.to; if (d.label) mine.label = d.label; else delete mine.label; changed = true; // a name or direction changed elsewhere
    });
    if (changed) SW.canvas.drawWires();
  }
  function onMeta(snap) {
    if (!Co.active || S.board.id !== Co.boardId) return;
    if (!snap.exists) { Co.stop(); SW.ui.toast('다른 사람이 이 보드를 삭제했어요.'); SW.main.openFirst(); return; }
    const name = snap.data().name;
    if (name && name !== S.board.name && name !== Co.syncedName) { S.board.name = name; Co.syncedName = name; SW.main.showBoardName(); }
  }
  const onErr = (e) => { if (e && e.code !== 'revoked') SW.ui.toast('실시간 연결이 끊겼어요. 새로 고치면 다시 이어져요.'); };

  /* ---------- people ---------- */
  let cursorTimer = null, lastCursor = null, selSig = '';
  const send = () => {
    cursorTimer = null;
    if (Co.room) Co.room.presence({ cursor: lastCursor, sel: [...SW.canvas.selected][0] || null, uid: Co.me }).catch(() => {});
  };
  Co.cursor = (w) => { if (!Co.room) return; lastCursor = { x: Math.round(w.x), y: Math.round(w.y) }; if (!cursorTimer) cursorTimer = setTimeout(send, 40); };
  Co.sendPresence = () => { if (Co.room && !cursorTimer) cursorTimer = setTimeout(send, 0); };

  const who = (p) => p.by || (p.presence && typeof p.presence.uid === 'string' ? p.presence.uid : null);
  const nameOf = (p) => { const pr = Co.prof[who(p)]; return (pr && pr.name) || '함께 쓰는 사람'; };
  const colorOf = (p) => { const pr = Co.prof[who(p)]; return (pr && pr.color) || GREY; };

  async function loadProfiles() {
    const ids = [...new Set(Co.peers.map(who).filter(Boolean))];
    if (!ids.length || !Co.user) return;
    try { Co.prof = Object.assign({}, Co.prof, await Co.user.profiles(ids)); } catch (e) { /* names are optional */ }
  }
  function renderAvatars() {
    const box = $('#peers'); box.textContent = ''; box.hidden = !Co.active;
    if (!Co.active) return;
    const people = new Map(); Co.peers.forEach((p) => { const k = who(p) || p.peer; if (!people.has(k)) people.set(k, p); });
    const live = document.createElement('span'); live.className = 'live';
    live.textContent = people.size ? (people.size + 1) + '명이 함께 보는 중' : '함께 쓰는 보드';
    box.append(live);
    [...people.values()].slice(0, 5).forEach((p) => {
      const pr = Co.prof[who(p)];
      const av = document.createElement('img'); av.className = 'av'; av.alt = nameOf(p); av.title = nameOf(p);
      av.style.setProperty('--pc', colorOf(p));
      if (pr && pr.avatarUrl) av.src = pr.avatarUrl; else av.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
      box.append(av);
    });
  }
  Co.placeCursors = () => {
    const layer = $('#cursorLayer'), C = SW.canvas, seen = new Set();
    Co.peers.forEach((p) => {
      const c = p.presence && p.presence.cursor;
      if (!c || typeof c.x !== 'number' || typeof c.y !== 'number') return;
      seen.add(p.peer);
      let el = Co.cursorEls.get(p.peer);
      if (!el) {
        el = document.createElement('div'); el.className = 'peer-cursor';
        el.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.2 1.6l11 5.7-4.8 1.3-2.1 4.6z" fill="currentColor" stroke="#fff" stroke-width="1.1" stroke-linejoin="round"/></svg><span></span>';
        layer.append(el); Co.cursorEls.set(p.peer, el);
      }
      el.style.setProperty('--pc', colorOf(p));
      el.querySelector('span').textContent = nameOf(p);
      el.style.transform = 'translate(' + (c.x * C.view.k + C.view.x) + 'px,' + (c.y * C.view.k + C.view.y) + 'px)';
      el.style.opacity = Date.now() - p.updatedAt > 60000 ? '0.35' : '1';
    });
    Co.cursorEls.forEach((el, peer) => { if (!seen.has(peer)) { el.remove(); Co.cursorEls.delete(peer); } });
  };
  Co.decorate = () => {
    document.querySelectorAll('.shell.peer-sel').forEach((el) => { el.classList.remove('peer-sel'); const t = el.querySelector(':scope > .peer-tag'); if (t) t.remove(); });
    if (!Co.active) return;
    Co.peers.forEach((p) => {
      const sel = p.presence && p.presence.sel; if (typeof sel !== 'string') return;
      const el = SW.canvas.els.get(sel); if (!el || el.classList.contains('peer-sel')) return;
      el.classList.add('peer-sel'); el.style.setProperty('--pc', colorOf(p));
      const tag = document.createElement('span'); tag.className = 'peer-tag'; tag.textContent = nameOf(p); el.append(tag);
    });
  };
  function clearPeople() {
    Co.peers = []; selSig = '';
    Co.cursorEls.forEach((el) => el.remove()); Co.cursorEls.clear();
    Co.decorate(); renderAvatars();
  }

  async function joinRoom(id) {
    try {
      if (!window.claude || typeof window.claude.use !== 'function') return;
      const lobby = await window.claude.use('room');
      if (!lobby || !Co.active || Co.boardId !== id) return;
      const room = await lobby.join(id.toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 48) || 'board');
      if (!Co.active || Co.boardId !== id) { room.leave().catch(() => {}); return; }
      Co.room = room;
      room.onPeers(async (ch) => {
        Co.peers = ch.peers.filter((p) => !p.sameTab && p.kind === 'viewer');
        if (ch.joined.length || ch.left.length) { await loadProfiles(); renderAvatars(); }
        Co.placeCursors();
        const sig = Co.peers.map((p) => p.peer + ':' + (p.presence && p.presence.sel)).join('|');
        if (sig !== selSig) { selSig = sig; Co.decorate(); }
      }, () => {});
      send();
    } catch (e) { /* cursors are a bonus; editing works without them */ }
  }

  /* ---------- lifecycle ---------- */
  Co.start = (b) => {
    Co.stop();
    if (!b || !b.shared || !db()) return;
    Co.active = true; Co.boardId = b.id;
    Co.unsubs.push(db().collection(base(b.id) + '/shells').onSnapshot(onShells, onErr));
    Co.unsubs.push(db().collection(base(b.id) + '/arrows').onSnapshot(onArrows, onErr));
    Co.unsubs.push(db().collection(base(b.id) + '/sections').onSnapshot(onSections, onErr));
    Co.unsubs.push(db().doc(base(b.id)).onSnapshot(onMeta, onErr));
    renderAvatars(); joinRoom(b.id);
  };
  Co.stop = () => {
    Co.unsubs.forEach((u) => { try { u(); } catch (e) { /* already closed */ } }); Co.unsubs = [];
    Co.active = false; Co.boardId = null;
    if (Co.room) { Co.room.leave().catch(() => {}); Co.room = null; }
    clearPeople();
  };
  Co.init = async () => {
    try {
      if (window.claude && typeof window.claude.use === 'function') {
        Co.user = await window.claude.use('user');
        Co.me = Co.user ? await Co.user.id() : null;
      }
    } catch (e) { Co.user = null; }
  };
})(window.SW);
