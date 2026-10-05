/* Shellwork — board files. One board (or every board) with its pictures in a single .shellwork.json file, to move work
 * between the website and the claude.ai page where AI works, or to keep a backup. The extension ends in .json because
 * claude.ai only saves files with known extensions; the "format" field is what marks it as a Shellwork board. */
(function (SW) {
  'use strict';
  const S = SW.store, P = SW.persist;
  const FORMAT = 'shellwork-board';
  const AI_URL = 'https://claude.ai/artifact/8iQWLuStXZsvzAGe8mooXV';
  const SITE_URL = 'https://iphokorea1-boop.github.io/shellwork/';
  const Tr = SW.transfer = { AI_URL, SITE_URL };
  const fileName = (name) => (String(name || '').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'shellwork') + '.shellwork.json';
  const stamp = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

  /* ---------- out ---------- */
  const plain = (b) => ({
    name: b.name, shells: b.shells, roots: b.roots, arrows: b.arrows || [], sections: b.sections || [],
    createdAt: b.createdAt || Date.now(), updatedAt: b.updatedAt || Date.now(),
  });
  async function pack(boards) {
    const images = {};
    for (const b of boards) {
      const ids = Object.values(b.shells || {}).filter((s) => s.kind === 'image' && s.img).map((s) => s.img);
      for (const id of ids) {
        if (images[id]) continue;
        const url = b === S.board ? (SW.images.url(id) || await SW.images.fetch(id)) : await SW.images.urlFor(b, id);
        if (url) images[id] = url;
      }
    }
    return JSON.stringify({ format: FORMAT, version: 1, app: 'Shellwork', exportedAt: Date.now(), boards: boards.map(plain), images });
  }
  Tr.exportBoard = async () => {
    await P.flush().catch(() => {});
    SW.ui.toast('보드 파일을 만드는 중…');
    try { await SW.main.saveFile(fileName(S.board.name), await pack([S.board])); }
    catch (e) { SW.ui.toast('보드 파일을 만들지 못했어요.'); }
  };
  Tr.exportAll = async () => {
    await P.flush().catch(() => {});
    let list = []; try { list = await P.list(); } catch (e) { list = []; }
    if (!list.length) { await Tr.exportBoard(); return; }
    SW.ui.toast('보드 ' + list.length + '개를 모으는 중…');
    const boards = [];
    for (const it of list) {
      try { const b = it.id === S.board.id ? S.board : await P.load(it.id, it.shared); if (b) boards.push(b); } catch (e) { /* skip one that will not load */ }
    }
    try { await SW.main.saveFile('Shellwork 보드 ' + boards.length + '개 ' + stamp() + '.shellwork.json', await pack(boards)); }
    catch (e) { SW.ui.toast('보드 파일을 만들지 못했어요.'); }
  };

  /* ---------- in ---------- */
  /* a board from a file: keep only what a board holds, and repair the tree so every node has exactly one place */
  function sanitize(src) {
    const shells = {};
    Object.keys(src.shells || {}).forEach((id) => {
      const s = src.shells[id]; if (!s || typeof s !== 'object' || !/^[\w-]{1,40}$/.test(id)) return;
      const n = {
        id, title: String(s.title || '').slice(0, 400), body: String(s.body || '').slice(0, 60000), parent: null,
        children: Array.isArray(s.children) ? s.children.map(String) : [], x: Math.round(+s.x || 0), y: Math.round(+s.y || 0),
        w: Math.max(160, Math.min(900, Math.round(+s.w || 320))), collapsed: !!s.collapsed, ai: !!s.ai,
      };
      if (s.kind === 'text') n.kind = 'text';
      if (s.kind === 'image' && typeof s.img === 'string') { n.kind = 'image'; n.img = s.img.slice(0, 40); n.ratio = Math.max(0.05, Math.min(20, +s.ratio || 0.75)); }
      if (typeof s.color === 'string' && s.color) n.color = s.color.slice(0, 12);
      if (typeof s.notes === 'string' && s.notes) n.notes = s.notes.slice(0, 4000);
      if (s.src && typeof s.src === 'object') n.src = { kind: String(s.src.kind || 'photo').slice(0, 12), name: String(s.src.name || '').slice(0, 120), date: +s.src.date || 0, page: String(s.src.page || '').slice(0, 20), thumb: typeof s.src.thumb === 'string' && /^data:image\//.test(s.src.thumb) ? s.src.thumb : '' };
      shells[id] = n;
    });
    const claimed = new Set();
    Object.values(shells).forEach((s) => {
      s.children = s.children.filter((c) => shells[c] && c !== s.id && !claimed.has(c) && claimed.add(c));
      s.children.forEach((c) => { shells[c].parent = s.id; });
    });
    let roots = (Array.isArray(src.roots) ? src.roots.map(String) : []).filter((id, i, a) => shells[id] && !claimed.has(id) && a.indexOf(id) === i);
    Object.keys(shells).forEach((id) => { if (!claimed.has(id) && !roots.includes(id)) roots.push(id); });
    for (let guard = 0; guard < 50; guard++) { // nodes caught in a loop of parents are lifted onto the canvas
      const seen = new Set(), walk = (id) => { if (seen.has(id)) return; seen.add(id); shells[id].children.forEach(walk); };
      roots.forEach(walk);
      const lost = Object.keys(shells).find((id) => !seen.has(id)); if (!lost) break;
      const p = shells[lost].parent; if (p && shells[p]) shells[p].children = shells[p].children.filter((c) => c !== lost);
      shells[lost].parent = null; roots.push(lost);
    }
    roots.forEach((id) => { shells[id].parent = null; });
    const arrows = (Array.isArray(src.arrows) ? src.arrows : []).filter((a) => a && shells[a.from] && shells[a.to] && a.from !== a.to)
      .map((a) => Object.assign({ id: SW.uid('a'), from: a.from, to: a.to }, a.label ? { label: String(a.label).slice(0, 30) } : {}));
    const sections = (Array.isArray(src.sections) ? src.sections : []).filter((g) => g && typeof g === 'object')
      .map((g) => ({ id: SW.uid('g'), x: Math.round(+g.x || 0), y: Math.round(+g.y || 0), w: Math.max(180, Math.round(+g.w || 400)), h: Math.max(110, Math.round(+g.h || 300)), title: String(g.title || '섹션').slice(0, 80), color: String(g.color || '').slice(0, 12) }));
    return { id: SW.uid('b'), name: String(src.name || '가져온 보드').slice(0, 80), shells, roots, arrows, sections, createdAt: +src.createdAt || Date.now(), updatedAt: Date.now() };
  }
  Tr.isBoardFile = (f) => /\.shellwork(\.json)?$/i.test(f.name || '') || /\.json$/i.test(f.name || '');
  Tr.importFile = async (file) => {
    let data;
    try { data = JSON.parse(await file.text()); } catch (e) { SW.ui.toast('보드 파일을 읽지 못했어요. Shellwork에서 내보낸 .shellwork.json 파일인지 확인해 주세요.'); return; }
    if (!data || data.format !== FORMAT || !Array.isArray(data.boards) || !data.boards.length) { SW.ui.toast('Shellwork 보드 파일이 아니에요.'); return; }
    await P.flush().catch(() => {});
    let names = []; try { names = (await P.list()).map((b) => b.name); } catch (e) { names = []; }
    const images = data.images && typeof data.images === 'object' ? data.images : {};
    const made = []; let failed = 0;
    for (const src of data.boards.slice(0, 100)) {
      const b = sanitize(src);
      if (names.includes(b.name)) b.name = (b.name + ' (가져옴)').slice(0, 80);
      names.push(b.name);
      try {
        const ids = Object.values(b.shells).filter((s) => s.kind === 'image').map((s) => s.img);
        for (const id of ids) { const url = images[id]; if (typeof url === 'string' && /^data:image\/(png|jpeg|gif|webp);base64,/.test(url) && url.length < 260000) await SW.images.storeFor(b, id, url); }
        if (P.mode !== 'memory') await P.write(b);
        made.push(b);
      } catch (e) { failed++; }
    }
    if (!made.length) { SW.ui.toast('보드를 가져오지 못했어요.' + (failed ? ' 보드가 너무 크거나 저장 공간이 부족할 수 있어요.' : '')); return; }
    SW.main.openImported(made[0]);
    SW.ui.toast(made.length > 1 ? '보드 ' + made.length + '개를 가져왔어요. 왼쪽 위 보드 목록에서 고를 수 있어요' : '“' + made[0].name + '” 보드를 가져왔어요' + (P.mode === 'memory' ? ' (이 화면에서는 저장되지 않아요)' : ''));
  };
  Tr.pickFile = () => {
    const inp = document.querySelector('#boardInput'); inp.value = '';
    inp.onchange = () => { const f = inp.files[0]; if (f) Tr.importFile(f); };
    inp.click();
  };

  /* ---------- the website ↔ the AI page ---------- */
  const ON_AI = () => !!window.claude;
  Tr.moveDialog = () => {
    const toAI = !ON_AI();
    const box = document.createElement('ol'); box.className = 'move-steps';
    const step = (title, text, btn) => {
      const li = document.createElement('li'); const t = document.createElement('strong'); t.textContent = title;
      const p = document.createElement('span'); p.textContent = text; li.append(t, p); if (btn) li.append(btn); box.append(li);
    };
    const b1 = document.createElement('button'); b1.className = 'btn'; b1.textContent = '보드 파일 받기'; b1.onclick = () => Tr.exportBoard();
    const b2 = document.createElement('a'); b2.className = 'btn'; b2.textContent = toAI ? 'AI 버전 열기' : '웹사이트 열기'; b2.href = toAI ? AI_URL : SITE_URL; b2.target = '_blank'; b2.rel = 'noopener';
    step('지금 보드를 파일로 받기', '“' + S.board.name + '”과 사진이 .shellwork.json 파일 하나에 담겨요.', b1);
    step(toAI ? 'AI 버전 열기' : '웹사이트 열기', toAI ? 'claude.ai에서 내 Claude 계정으로 AI를 쓸 수 있는 Shellwork예요.' : 'AI 없이 쓰는 웹사이트 Shellwork예요.', b2);
    step('파일 가져오기', '받은 파일을 캔버스에 끌어 놓거나, 위쪽 내보내기 버튼 → "보드 파일 가져오기"를 눌러요. 새 보드로 들어가요.');
    SW.ui.modal({
      title: toAI ? '이 보드를 AI 버전으로 옮기기' : '이 보드를 웹사이트로 옮기기', node: box,
      text: toAI ? 'AI 기능은 claude.ai에 게시된 Shellwork에서 동작해요. 보드 파일로 옮겨서 AI를 쓰고, 다 쓰면 같은 방법으로 다시 가져올 수 있어요.' : '보드 파일로 옮기면 웹사이트에서도 이어서 쓸 수 있어요.',
      actions: [{ label: '닫기', cls: 'primary', act: () => false }],
    });
  };
})(window.SW);
