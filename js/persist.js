/* Shellwork — saving boards.
 * cloud: claude.ai artifact database, each person's boards under their private data/users/<id>/ path
 * local: this browser's localStorage (when the page is opened as a plain file)
 * memory: nothing is kept (storage blocked) */
(function (SW) {
  'use strict';
  const S = SW.store;
  const LS_INDEX = 'shellwork.index', LS_BOARD = 'shellwork.board.', LS_LAST = 'shellwork.last';
  const MAX_BYTES = 240000;

  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  SW.ls = ls;

  const P = SW.persist = { mode: 'memory', db: null, uid: null, timer: null, saving: false, dirty: false, again: false, onStatus: () => {} };

  P.init = async () => {
    try {
      if (window.claude && typeof window.claude.use === 'function') {
        const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
        const id = user ? await user.id() : null;
        if (db && id) { P.db = db; P.uid = id; P.mode = 'cloud'; return P.mode; }
      }
    } catch (e) { /* fall through to local */ }
    P.mode = ls.set('shellwork.probe', '1') ? 'local' : 'memory';
    return P.mode;
  };

  const col = () => P.db.collection('data/users/' + P.uid);
  const bodyOf = (b) => ({
    name: b.name, shells: b.shells, roots: b.roots, arrows: b.arrows, sections: b.sections || [],
    createdAt: b.createdAt || Date.now(), updatedAt: b.updatedAt || Date.now(),
  });
  const normalize = (id, d) => {
    const b = JSON.parse(JSON.stringify(d));
    b.id = id; b.shells = b.shells || {}; b.roots = b.roots || []; b.arrows = b.arrows || []; b.sections = b.sections || [];
    Object.values(b.shells).forEach((s) => { s.children = s.children || []; s.title = s.title || ''; s.body = s.body || ''; });
    return b;
  };

  P.list = async () => {
    if (P.mode === 'cloud') {
      const [snap, shared] = await Promise.all([col().orderBy('updatedAt', 'desc').limit(100).get(), SW.collab.list().catch(() => [])]);
      return snap.docs.map((d) => ({ id: d.id, name: d.data().name, updatedAt: d.data().updatedAt })).concat(shared);
    }
    if (P.mode === 'local') {
      try { return JSON.parse(ls.get(LS_INDEX) || '[]').sort((a, b) => b.updatedAt - a.updatedAt); } catch (e) { return []; }
    }
    return [];
  };

  P.load = async (id, shared) => {
    if (P.mode === 'cloud' && shared) return SW.collab.load(id);
    if (P.mode === 'cloud') {
      const d = await col().doc(id).get();
      return d.exists ? normalize(id, d.data()) : null;
    }
    if (P.mode === 'local') {
      const raw = ls.get(LS_BOARD + id);
      try { return raw ? normalize(id, JSON.parse(raw)) : null; } catch (e) { return null; }
    }
    return null;
  };

  P.write = async (b) => {
    if (b.shared && P.mode === 'cloud') { await SW.collab.flush(); return; }
    const body = bodyOf(b); const json = JSON.stringify(body);
    if (json.length > MAX_BYTES) throw { code: 'too_big', message: '보드가 너무 커서 저장할 수 없어요. 셸 일부를 새 보드로 옮겨 주세요.' };
    if (P.mode === 'cloud') { await col().doc(b.id).set(body); return; }
    if (P.mode === 'local') {
      if (!ls.set(LS_BOARD + b.id, json)) throw { code: 'local_full', message: '브라우저 저장 공간이 가득 찼어요.' };
      let idx = []; try { idx = JSON.parse(ls.get(LS_INDEX) || '[]'); } catch (e) { idx = []; }
      idx = idx.filter((x) => x.id !== b.id); idx.push({ id: b.id, name: b.name, updatedAt: body.updatedAt });
      ls.set(LS_INDEX, JSON.stringify(idx));
    }
  };

  P.removePrivate = async (id) => { await col().doc(id).delete(); };
  P.remove = async (id, shared) => {
    if (P.mode === 'cloud' && shared) { await SW.collab.remove(id); return; }
    if (P.mode === 'cloud') {
      const vs = await col().doc(id).collection('versions').get().catch(() => null);
      if (vs) await Promise.all(vs.docs.map((d) => col().doc(id).collection('versions').doc(d.id).delete().catch(() => {})));
      await col().doc(id).delete(); return;
    }
    if (P.mode === 'local') {
      ls.del(LS_BOARD + id); ls.del('shellwork.versions.' + id);
      try { ls.set(LS_INDEX, JSON.stringify(JSON.parse(ls.get(LS_INDEX) || '[]').filter((x) => x.id !== id))); } catch (e) { /* ignore */ }
    }
  };

  P.rememberLast = (id) => ls.set(LS_LAST, id);
  P.lastId = () => ls.get(LS_LAST);

  /* debounced, one write at a time */
  P.schedule = () => {
    if (!S.board) return;
    if (S.board.example) { S.board.example = false; } // the example becomes the person's own board once edited
    P.dirty = true; P.onStatus('pending');
    clearTimeout(P.timer); P.timer = setTimeout(P.flush, 900);
  };
  P.flush = async () => {
    clearTimeout(P.timer);
    if (!P.dirty || !S.board || P.mode === 'memory') { if (P.mode === 'memory') P.onStatus('memory'); return; }
    if (P.saving) { P.again = true; return; }
    P.saving = true; P.dirty = false; P.onStatus('saving');
    try { await P.write(S.board); P.onStatus('saved'); if (SW.history) SW.history.afterSave(); }
    catch (e) {
      if (e && e.code === 'unavailable' && !P.retried) { P.retried = true; P.dirty = true; setTimeout(P.flush, 1200 + Math.random() * 800); }
      else { P.dirty = true; P.onStatus('error', e); }
    } finally {
      P.saving = false;
      if (P.again) { P.again = false; P.flush(); } else P.retried = false;
    }
  };
  window.addEventListener('pagehide', () => { if (P.dirty) P.flush(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && P.dirty) P.flush(); });
})(window.SW);
