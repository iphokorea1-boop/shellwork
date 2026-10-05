/* Shellwork — pictures on the board.
 * A picture node holds only an id. The picture itself is shrunk to a JPEG or PNG data URL small enough for one
 * database document (under 190 KB) and kept beside the board: in the board's images collection on claude.ai,
 * in IndexedDB when the page runs in a plain browser. A memory cache serves rendering, export and AI. */
(function (SW) {
  'use strict';
  const S = SW.store;
  const MAX = 190000; // characters of data URL; a db document holds 256 KiB
  const Im = SW.images = { cache: new Map(), loading: new Map(), here: new Set() };
  const P = () => SW.persist;

  /* ---------- shrink a file to something we can store ---------- */
  async function decode(file) {
    if (window.createImageBitmap) { try { return await createImageBitmap(file); } catch (e) { /* fall back to <img> */ } }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image(); img.src = url; await img.decode();
      return img;
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
  Im.prepare = async (file) => {
    const bmp = await decode(file);
    const W = bmp.width || bmp.naturalWidth, H = bmp.height || bmp.naturalHeight;
    if (!W || !H) throw new Error('empty image');
    const draw = (side, white) => {
      const k = Math.min(1, side / Math.max(W, H));
      const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(W * k)); cv.height = Math.max(1, Math.round(H * k));
      const g = cv.getContext('2d');
      if (white) { g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); } // JPEG has no transparency
      g.drawImage(bmp, 0, 0, cv.width, cv.height);
      return cv;
    };
    let url = '';
    if (/png|gif|webp|svg/.test(file.type)) { // diagrams and screenshots stay crisp when they fit as PNG
      const png = draw(1400, false).toDataURL('image/png');
      if (png.length <= MAX) url = png;
    }
    let side = 1600, q = 0.86;
    for (let i = 0; !url && i < 12; i++) {
      const jpg = draw(side, true).toDataURL('image/jpeg', q);
      if (jpg.length <= MAX) url = jpg;
      else if (q > 0.66) q -= 0.08; else side = Math.round(side * 0.82);
    }
    if (bmp.close) bmp.close();
    if (!url) throw new Error('too big');
    return { url, ratio: Math.round((H / W) * 10000) / 10000 };
  };

  /* ---------- where pictures are kept ---------- */
  let idbP = null;
  const idb = () => idbP || (idbP = new Promise((res, rej) => {
    try {
      const r = indexedDB.open('shellwork', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('images');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  }));
  const idbDo = async (mode, fn) => {
    const d = await idb();
    return new Promise((res, rej) => {
      const t = d.transaction('images', mode), req = fn(t.objectStore('images'));
      t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  };
  const col = (board) => (board.shared
    ? P().db.collection('shared/' + board.id + '/images')
    : P().db.doc('data/users/' + P().uid + '/' + board.id).collection('images'));

  async function write(id, url) {
    const mode = P().mode;
    if (mode === 'cloud') await col(S.board).doc(id).set({ url, createdAt: Date.now() });
    else if (mode === 'local') await idbDo('readwrite', (st) => st.put(url, id));
    Im.here.add(id);
  }
  async function read(id) {
    const mode = P().mode;
    if (mode === 'cloud') { const d = await col(S.board).doc(id).get(); return d.exists ? d.data().url : null; }
    if (mode === 'local') return (await idbDo('readonly', (st) => st.get(id))) || null;
    return null;
  }

  /* add a picture file: shrink, store, and return the fields for a picture node */
  Im.add = async (file) => {
    const { url, ratio } = await Im.prepare(file);
    const id = SW.uid('i');
    Im.cache.set(id, url);
    await write(id, url);
    return { img: id, ratio, name: (file.name || '').slice(0, 80) };
  };
  Im.url = (id) => Im.cache.get(id) || '';
  /* fetch one picture (once), then paint every <img data-img> showing it */
  Im.fetch = (id) => {
    if (!id) return Promise.resolve('');
    if (Im.cache.has(id)) return Promise.resolve(Im.cache.get(id));
    if (Im.loading.has(id)) return Im.loading.get(id);
    const p = read(id).catch(() => null).then((url) => {
      Im.loading.delete(id);
      if (url) { Im.cache.set(id, url); Im.here.add(id); Im.paint(id); }
      else document.querySelectorAll('img[data-img="' + id + '"]').forEach((el) => el.closest('.pic-frame, figure') && el.closest('.pic-frame, figure').classList.add('missing'));
      return url || '';
    });
    Im.loading.set(id, p);
    return p;
  };
  Im.paint = (id) => {
    const url = Im.url(id); if (!url) return;
    document.querySelectorAll('img[data-img="' + id + '"]').forEach((el) => { if (el.getAttribute('src') !== url) el.src = url; const f = el.closest('.pic-frame, figure'); if (f) f.classList.remove('loading', 'missing'); });
  };
  /* everything a board shows, fetched up front so export and AI have it */
  Im.load = async () => {
    Im.here = new Set();
    const ids = S.imageIds();
    if (!ids.length) return;
    if (P().mode === 'cloud') {
      try { const snap = await col(S.board).get(); snap.docs.forEach((d) => { if (d.data().url) { Im.cache.set(d.id, d.data().url); Im.here.add(d.id); Im.paint(d.id); } }); } catch (e) { /* fetch one by one below */ }
    }
    await Promise.all(ids.filter((id) => !Im.cache.has(id)).map(Im.fetch));
  };
  /* pictures pasted in from another board are copied into this board's store */
  Im.adopt = (ids) => {
    ids.filter((id) => Im.cache.has(id) && !Im.here.has(id)).forEach((id) => write(id, Im.cache.get(id)).catch(() => {}));
  };
  Im.copyHere = async (ids) => {
    Im.here = new Set();
    const list = ids.filter((id) => Im.cache.has(id));
    for (let i = 0; i < list.length; i += 4) await Promise.all(list.slice(i, i + 4).map((id) => write(id, Im.cache.get(id))));
  };
  /* a Blob for sending to the AI or a file */
  Im.blob = async (id) => {
    const url = Im.url(id) || await Im.fetch(id); if (!url) return null;
    const m = /^data:([^;]+);base64,(.*)$/.exec(url); if (!m) return null;
    const bin = atob(m[2]), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: m[1] });
  };
  /* forget a deleted board's pictures */
  Im.removeBoard = async (board) => {
    if (P().mode === 'cloud') {
      const snap = await col(board).get().catch(() => null);
      if (snap) for (let i = 0; i < snap.docs.length; i += 8) await Promise.all(snap.docs.slice(i, i + 8).map((d) => col(board).doc(d.id).delete().catch(() => {})));
    } else if (P().mode === 'local') {
      const ids = []; Object.values(board.shells || {}).forEach((s) => { if (s.kind === 'image' && s.img) ids.push(s.img); });
      await Promise.all(ids.map((id) => idbDo('readwrite', (st) => st.delete(id)).catch(() => {})));
    }
  };

  /* ---------- putting pictures on the canvas ---------- */
  Im.insertFiles = async (files, at, parentId) => {
    const pics = [...files].filter((f) => f.type.indexOf('image/') === 0).slice(0, 12);
    if (!pics.length) return [];
    SW.main.setView('canvas');
    const c = at || SW.canvas.center();
    const made = [];
    SW.ui.toast(pics.length > 1 ? '사진 ' + pics.length + '장을 넣는 중…' : '사진을 넣는 중…');
    for (const f of pics) {
      try { made.push(Object.assign(await Im.add(f), { file: f })); }
      catch (e) {
        SW.ui.toast(e && e.message === 'too big' ? '사진이 너무 커서 넣지 못했어요.'
          : e && (e.code === 'quota_exceeded' || e.name === 'QuotaExceededError') ? '사진을 저장할 공간이 가득 찼어요. 쓰지 않는 보드나 사진을 지워 주세요.'
            : '사진을 넣지 못했어요. 다른 파일로 해 보세요.');
      }
    }
    if (!made.length) return [];
    S.checkpoint();
    const nodes = made.map((m, i) => (parentId
      ? S.add({ kind: 'image', img: m.img, ratio: m.ratio, body: '' }, parentId)
      : S.add({ kind: 'image', img: m.img, ratio: m.ratio, body: '', w: 360, x: Math.round(c.x - 180 + i * 28), y: Math.round(c.y - 120 + i * 28) }, null)));
    if (parentId) S.get(parentId).collapsed = false;
    S.changed();
    if (!parentId) SW.canvas.tidy(nodes.map((n) => n.id));
    SW.canvas.selectMany(nodes.map((n) => n.id));
    const first = made[0].file;
    SW.ui.toast(nodes.length > 1 ? '사진 ' + nodes.length + '장을 넣었어요' : '사진을 넣었어요. 아래에 설명을 적을 수 있어요',
      'AI로 읽어 셸 만들기', () => SW.ai.photo([first], { x: c.x + 220, y: c.y - 120 }));
    return nodes;
  };
  Im.view = (id) => {
    const s = S.get(id); if (!s || !S.isImage(s)) return;
    const show = (url) => SW.ui.modal({ title: s.body.trim() ? s.body.trim().split('\n')[0].slice(0, 80) : '그림', image: url, wide: true, actions: [{ label: '닫기', cls: 'primary', act: () => false }] });
    if (Im.url(s.img)) show(Im.url(s.img)); else Im.fetch(s.img).then((u) => { if (u) show(u); else SW.ui.toast('그림을 불러오지 못했어요'); });
  };
})(window.SW);
