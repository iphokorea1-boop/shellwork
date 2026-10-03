/* Shellwork — keyboard. One list of commands drives the shortcuts, the command palette (Ctrl/⌘ K),
 * the shortcut sheet (?) and the tooltips on buttons. Keys are matched by physical key (e.code),
 * so shortcuts work while the keyboard is in Korean input mode. */
(function (SW) {
  'use strict';
  const S = SW.store, C = SW.canvas;
  const $ = (q) => document.querySelector(q);
  const MAC = /Mac|iPhone|iPad/.test(navigator.platform || '') || /Mac OS X/.test(navigator.userAgent);
  const K = SW.keys = { mac: MAC, paletteOpen: false, clip: null };
  const NAMES = MAC
    ? { Mod: '⌘', Alt: '⌥', Shift: '⇧', Enter: '↵', Delete: '⌫', Esc: 'esc' }
    : { Mod: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Enter: 'Enter', Delete: 'Del', Esc: 'Esc' };
  const CODE = { '?': 'Slash', '/': 'Slash', '\\': 'Backslash', '0': 'Digit0', '1': 'Digit1', '2': 'Digit2', '3': 'Digit3' };

  const split = (c) => (c === '+' ? ['+'] : c.endsWith('++') ? c.slice(0, -2).split('+').concat('+') : c.split('+'));
  K.parts = (combo) => split(combo).map((p) => NAMES[p] || p);
  K.fmt = (combo) => (MAC ? K.parts(combo).join('') : K.parts(combo).join('+'));
  /* <span class="keys"><kbd>Ctrl</kbd><kbd>G</kbd></span> */
  K.chips = (combo) => {
    const wrap = document.createElement('span'); wrap.className = 'keys';
    combo.split(' / ').forEach((c, i) => {
      if (i) { const o = document.createElement('span'); o.className = 'or'; o.textContent = '/'; wrap.append(o); }
      K.parts(c).forEach((p) => { const k = document.createElement('kbd'); k.textContent = p; wrap.append(k); });
    });
    return wrap;
  };

  function hit(e, combo) {
    const p = split(combo), key = p.pop();
    const mod = p.includes('Mod'), alt = p.includes('Alt'), shift = p.includes('Shift');
    if (mod !== (e.ctrlKey || e.metaKey) || alt !== e.altKey) return false;
    if (key === '?') return e.shiftKey && (e.code === 'Slash' || e.key === '?');
    if (key === '+') return e.key === '+' || e.key === '=' || e.code === 'NumpadAdd';
    if (key === '-') return !e.shiftKey && (e.key === '-' || e.code === 'Minus' || e.code === 'NumpadSubtract');
    if (shift !== e.shiftKey) return false;
    if (key === 'Delete') return e.key === 'Delete' || e.key === 'Backspace';
    if (key === 'Esc') return e.key === 'Escape';
    if (key === 'Enter') return e.key === 'Enter';
    if (CODE[key]) return e.code === CODE[key] || (key.length === 1 && /\d/.test(key) && e.code === 'Numpad' + key);
    if (/^[A-Z]$/.test(key)) return e.code === 'Key' + key;
    return e.key === key;
  }

  const typing = () => { const a = document.activeElement; return !!a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT' || a.tagName === 'SELECT' || a.isContentEditable); };
  const blurTyping = () => { if (typing()) document.activeElement.blur(); };
  const onCanvas = () => SW.main.view === 'canvas';
  const sel = () => [...C.selected].filter((i) => S.get(i));
  const top = (ids) => ids.filter((id) => !ids.some((o) => o !== id && S.isAncestor(o, id)));
  const one = () => { const s = sel(); return s.length === 1 ? S.get(s[0]) : null; };
  const toggleAI = () => { const p = $('#aiPanel'); p.hidden = !p.hidden; if (!p.hidden) $('#aiInput').focus(); };

  /* ---------- actions that only live here ---------- */
  function frameSelection() {
    const ids = sel().filter((i) => C.els.get(i)); if (!ids.length) return;
    const rs = ids.map((i) => C.worldRect(C.els.get(i)));
    const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
    const x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h));
    SW.motion.camera(C.frameTarget({ x: x0 - 40, y: y0 - 40, w: x1 - x0 + 80, h: y1 - y0 + 80 }, { maxK: 1.4 }));
  }
  function mdOf(ids) {
    const out = [];
    const walk = (id, d) => {
      const s = S.get(id);
      if (S.isText(s)) { if (s.body.trim()) out.push(s.body.trim(), ''); }
      else { out.push('#'.repeat(Math.min(6, d + 1)) + ' ' + (s.title.trim() || '(제목 없음)'), ''); if (s.body.trim()) out.push(s.body.trim(), ''); }
      s.children.forEach((c) => walk(c, S.isText(s) ? d : d + 1));
    };
    ids.forEach((id) => walk(id, 1));
    return out.join('\n').trim();
  }
  const snap = (id) => { const s = S.get(id); return { kind: s.kind, title: s.title, body: s.body, color: s.color, w: s.w, ai: s.ai, collapsed: s.collapsed, x: s.x, y: s.y, root: !s.parent, children: s.children.map(snap) }; };
  function copy(cut) {
    const ids = top(sel()); if (!ids.length) return;
    const md = mdOf(ids);
    K.clip = { trees: ids.map(snap), md, at: Date.now(), times: 0, written: false };
    try { navigator.clipboard.writeText(md).then(() => { if (K.clip) K.clip.written = true; }, () => {}); } catch (e) { /* internal copy still works */ }
    if (cut) { C.deleteSelected(); SW.ui.toast(ids.length + '개를 잘라 냈어요'); } else SW.ui.toast(ids.length + '개를 복사했어요');
  }
  /* paste what we copied ourselves, keeping shells, colours and layout; true when handled */
  K.pasteClip = (text) => {
    const c = K.clip; if (!c) return false;
    const same = text != null && text.trim() === c.md.trim();
    if (!same && (c.written || Date.now() - c.at > 5 * 60 * 1000)) return false;
    c.times++;
    S.checkpoint();
    const add = (t, parent, pos) => {
      const f = { body: t.body || '', ai: !!t.ai, collapsed: !!t.collapsed, w: t.w, x: pos ? pos.x : 0, y: pos ? pos.y : 0 };
      if (t.kind === 'text') f.kind = 'text'; else f.title = t.title || '';
      if (t.color) f.color = t.color;
      const s = S.add(f, parent); t.children.forEach((ch) => add(ch, s.id)); return s;
    };
    const ctr = C.center(), off = 32 * c.times;
    const made = c.trees.map((t, i) => add(t, null, t.root ? { x: t.x + off, y: t.y + off } : { x: Math.round(ctr.x - 160 + i * 24), y: Math.round(ctr.y - 60 + i * 24) }));
    S.changed(); C.selectMany(made.map((m) => m.id));
    SW.ui.toast(made.length + '개를 붙여 넣었어요', '되돌리기', S.undo);
    return true;
  };
  function duplicate() {
    const ids = top(sel()); if (!ids.length) return;
    if (ids.length === 1) { C.duplicate(ids[0]); return; }
    K.clip = { trees: ids.map(snap), md: '', at: Date.now(), times: 0, written: false };
    K.pasteClip(null);
  }
  function unwrap() {
    const s = one(); if (!s || S.isText(s) || !s.children.length) return;
    S.checkpoint(); S.unwrap(s.id); S.changed(); SW.ui.toast('셸을 풀었어요', '되돌리기', S.undo);
  }
  let nudgeTimer = null;
  function nudge(e) {
    const ids = sel().filter((id) => !S.get(id).parent); if (!ids.length) return false;
    const d = e.shiftKey ? 40 : 8;
    const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
    if (!nudgeTimer) S.checkpoint();
    clearTimeout(nudgeTimer); nudgeTimer = setTimeout(() => { nudgeTimer = null; }, 700);
    ids.forEach((id) => { const s = S.get(id), el = C.els.get(id); s.x += dx; s.y += dy; if (el) { el.style.left = s.x + 'px'; el.style.top = s.y + 'px'; } });
    C.drawWires(); C.placeSelBar(); S.changed('text');
    return true;
  }

  /* ---------- the command list ---------- */
  const G = { make: '만들기', edit: '편집', struct: '구조', view: '보기', ai: 'AI · 발표', board: '보드', help: '도움' };
  K.commands = [
    { id: 'shell', g: G.make, label: '새 셸', keys: 'S', when: onCanvas, run: () => C.addRoot() },
    { id: 'text', g: G.make, label: '새 글', keys: 'T', when: onCanvas, run: () => C.addText() },
    { id: 'pasteDlg', g: G.make, label: '글 붙여 넣어 조각으로 펼치기', run: () => $('#pasteBtn').click() },
    { id: 'photo', g: G.make, label: '사진을 셸로 정리', run: () => $('#photoBtn').click() },

    { id: 'edit', g: G.edit, label: '고른 것 편집', keys: 'Enter', when: () => onCanvas() && one(), run: () => C.focusShell(one().id) },
    { id: 'copy', g: G.edit, label: '복사', keys: 'Mod+C', when: () => onCanvas() && sel().length, run: () => copy(false) },
    { id: 'cut', g: G.edit, label: '잘라내기', keys: 'Mod+X', when: () => onCanvas() && sel().length, run: () => copy(true) },
    { id: 'pasteKey', g: G.edit, label: '붙여넣기', keys: 'Mod+V', display: true },
    { id: 'dup', g: G.edit, label: '복제', keys: 'Mod+D', when: () => onCanvas() && sel().length, run: duplicate },
    { id: 'del', g: G.edit, label: '삭제', keys: 'Delete', when: () => onCanvas() && (sel().length || C.selArrow), run: () => C.deleteSelected() },
    { id: 'all', g: G.edit, label: '모두 선택', keys: 'Mod+A', when: onCanvas, run: () => C.selectMany(S.board.roots.slice()) },
    { id: 'nudge', g: G.edit, label: '조금씩 옮기기 (크게: Shift)', keys: '← ↑ → ↓', display: true },
    { id: 'undo', g: G.edit, label: '실행 취소', keys: 'Mod+Z', run: () => S.undo() },
    { id: 'redo', g: G.edit, label: '다시 실행', keys: 'Mod+Shift+Z', alt: 'Mod+Y', run: () => S.redo() },

    { id: 'wrap', g: G.struct, label: '셸로 감싸기', keys: 'Mod+G', alt: 'Mod+Alt+Enter', typing: true, when: () => onCanvas() && sel().length, run: () => { blurTyping(); C.wrapSelection(); } },
    { id: 'unwrap', g: G.struct, label: '감싼 셸 풀기', keys: 'Mod+Shift+G', typing: true, when: () => onCanvas() && one() && !S.isText(one()) && one().children.length, run: () => { blurTyping(); unwrap(); } },
    { id: 'indent', g: G.struct, label: '앞 셸 안으로 / 밖으로 (편집 중)', keys: 'Tab / Shift+Tab', display: true },
    { id: 'section', g: G.struct, label: '섹션으로 묶기 (목차는 그대로)', keys: 'Shift+S', when: () => onCanvas() && sel().length, run: () => C.sectionFromSelection() },
    { id: 'convert', g: G.struct, label: '글 ↔ 셸 바꾸기', when: () => onCanvas() && one(), run: () => C.convert(one().id) },

    { id: 'focus', g: G.view, label: '집중 (고른 셸) / 전체 보기', keys: 'F', when: onCanvas, run: () => { const s = one(); if (s && !S.isText(s)) C.focus(s.id); else C.fit(); } },
    { id: 'fit', g: G.view, label: '전체 보기', keys: 'Shift+1', when: onCanvas, run: () => C.fit() },
    { id: 'zsel', g: G.view, label: '고른 것으로 확대', keys: 'Shift+2', when: () => onCanvas() && sel().length, run: frameSelection },
    { id: 'z100', g: G.view, label: '100%로', keys: '0', when: onCanvas, run: () => C.zoomCenter(1 / C.view.k) },
    { id: 'zin', g: G.view, label: '확대', keys: '+', when: onCanvas, run: () => C.zoomCenter(1.25) },
    { id: 'zout', g: G.view, label: '축소', keys: '-', when: onCanvas, run: () => C.zoomCenter(0.8) },
    { id: 'order', g: G.view, label: '문서 순서 번호 보기', keys: 'O', when: onCanvas, run: () => { C.toggleOrder(); const b = $('#orderBtn'); if (b) b.setAttribute('aria-pressed', String(C.showOrder)); } },
    { id: 'pan', g: G.view, label: '화면 이동', keys: 'H / Space', display: true },
    { id: 'select', g: G.view, label: '선택 도구', keys: 'V', when: onCanvas, run: () => SW.input.setTool('select') },
    { id: 'hand', g: G.view, label: '화면 이동 도구', keys: 'H', when: onCanvas, run: () => SW.input.setTool('hand'), hidden: true },
    { id: 'v1', g: G.view, label: '캔버스 보기', keys: '1', run: () => SW.main.setView('canvas') },
    { id: 'v2', g: G.view, label: '문서 보기', keys: '2', run: () => SW.main.setView('doc') },
    { id: 'v3', g: G.view, label: '마인드맵 보기', keys: '3', run: () => SW.main.setView('map') },
    { id: 'side', g: G.view, label: '사이드바 열고 닫기', keys: 'Mod+\\', typing: true, run: () => SW.main.setSidebar(document.querySelector('#app').classList.contains('side-collapsed')) },

    { id: 'chat', g: G.ai, label: 'AI에게 보내기 / AI 패널', keys: 'Mod+L', typing: true, run: () => { const s = sel(); blurTyping(); if (s.length && onCanvas()) SW.ai.attach(s); else toggleAI(); } },
    { id: 'organize', g: G.ai, label: 'AI 구조화: 흩어진 조각 묶기', run: () => SW.ai.organize() },
    { id: 'fill', g: G.ai, label: 'AI: 빈 본문 채우기', run: () => SW.ai.fill() },
    { id: 'critique', g: G.ai, label: 'AI: 논리 빈틈 찾기', run: () => { $('#aiPanel').hidden = false; SW.ai.critique(); } },
    { id: 'present', g: G.ai, label: '발표 시작', keys: 'P', when: () => SW.store.count() > 0, run: () => SW.present.start() },
    { id: 'word', g: G.ai, label: 'Word(.docx)로 내보내기', run: () => SW.main.exportWord() },
    { id: 'export', g: G.ai, label: '마크다운으로 내보내기', keys: 'Mod+Shift+E', typing: true, run: () => { blurTyping(); $('#exportBtn').click(); } },

    { id: 'newBlank', g: G.board, label: '새 보드: 빈 보드', run: () => SW.main.newBoard() },
    { id: 'newRne', g: G.board, label: '새 보드: R&E 탐구 템플릿', run: () => SW.main.newBoard('rne') },
    { id: 'newPlan', g: G.board, label: '새 보드: R&E 연구 계획서', run: () => SW.main.newBoard('plan') },
    { id: 'newMid', g: G.board, label: '새 보드: R&E 중간 보고', run: () => SW.main.newBoard('mid') },
    { id: 'newFinal', g: G.board, label: '새 보드: R&E 최종 보고서', run: () => SW.main.newBoard('final') },
    { id: 'history', g: G.board, label: '버전 기록', keys: 'Shift+H', run: () => SW.history.open() },
    { id: 'newTalk', g: G.board, label: '새 보드: 연구 발표 템플릿', run: () => SW.main.newBoard('talk') },
    { id: 'boards', g: G.board, label: '보드 목록 열기', run: () => { SW.main.setSidebar(true); $('#boardBtn').click(); } },

    { id: 'palette', g: G.help, label: '명령 찾기', keys: 'Mod+K', typing: true, run: () => K.openPalette() },
    { id: 'sheet', g: G.help, label: '단축키 보기', keys: '?', run: () => K.openSheet() },
    { id: 'dataGuide', g: G.help, label: '데이터와 AI 안내', run: () => SW.main.dataGuide() },
    { id: 'guideAgain', g: G.help, label: '처음 사용 안내 다시 보기', run: () => SW.main.showGuide() },
    { id: 'mSmooth', g: G.help, label: '애니메이션: 부드럽게', run: () => { SW.motion.set('smooth'); SW.motion.demo(); } },
    { id: 'mBouncy', g: G.help, label: '애니메이션: 통통 튀게', run: () => { SW.motion.set('bouncy'); SW.motion.demo(); } },
    { id: 'mOff', g: G.help, label: '애니메이션: 끄기', run: () => { SW.motion.set('off'); SW.ui.toast('애니메이션을 껐어요'); } },
  ];
  const TEXT_KEYS = [
    ['제목에서 본문으로', 'Enter'], ['아래에 새 항목', 'Mod+Enter'], ['굵게 / 기울임', 'Mod+B / Mod+I'],
    ['목록 들여쓰기', 'Tab / Shift+Tab'], ['편집 끝내기', 'Esc'],
  ];

  /* ---------- dispatch ---------- */
  document.addEventListener('keydown', (e) => {
    if ((SW.present && SW.present.on) || K.paletteOpen || e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') {
      if (!$('#keysheet').hidden) { K.closeSheet(); return; }
      if (!$('#history').hidden) { SW.history.close(); return; }
      if (!$('#modal').hidden) { SW.ui.closeModal(); return; }
      if (document.querySelector('.menu:not([hidden])')) { SW.ui.closeMenus(); return; }
      if (typing()) return; // the editor handles its own Escape
      if (onCanvas()) { if (C.focusId) C.unfocus(); else C.clearSelection(); }
      return;
    }
    if (!$('#modal').hidden || !$('#keysheet').hidden || !$('#history').hidden) return;
    const t = typing();
    for (const c of K.commands) {
      if (!c.keys || c.display || !c.run) continue;
      if (![c.keys].concat(c.alt ? [c.alt] : []).some((k) => hit(e, k))) continue;
      if (t && !c.typing) continue;
      if (c.when && !c.when()) continue;
      e.preventDefault(); c.run(); return;
    }
    if (!t && onCanvas() && /^Arrow/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey && nudge(e)) e.preventDefault();
  });
  document.addEventListener('paste', (e) => {
    if (typing() || !onCanvas() || !$('#modal').hidden || K.paletteOpen) return;
    const cd = e.clipboardData || window.clipboardData; if (!cd) return;
    const pics = [...(cd.files || [])].filter((f) => f.type.indexOf('image/') === 0);
    if (pics.length) { e.preventDefault(); SW.ai.photo(pics); return; }
    const text = cd.getData('text/plain');
    if (K.pasteClip(text)) { e.preventDefault(); return; }
    if (text && text.trim()) { e.preventDefault(); C.insertText(text); }
  });

  /* ---------- command palette ---------- */
  const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
  const initials = (s) => [...s].map((ch) => { const c = ch.charCodeAt(0) - 0xAC00; return c >= 0 && c < 11172 ? CHO[Math.floor(c / 588)] : ch; }).join('');
  const matches = (hay, q) => { hay = hay.toLowerCase(); return hay.includes(q) || (/^[ㄱ-ㅎ]+$/.test(q) && initials(hay).replace(/\s+/g, '').includes(q)); };
  let palItems = [], palIndex = 0;
  function palRender() {
    const q = $('#palInput').value.trim().toLowerCase(), list = $('#palList');
    list.textContent = ''; palItems = [];
    const groups = new Map();
    const push = (g, item) => { if (!groups.has(g)) groups.set(g, []); groups.get(g).push(item); };
    if (q) {
      Object.values(S.board.shells).filter((s) => matches(S.label(s) + ' ' + s.body, q)).slice(0, 6)
        .forEach((s) => push('셸로 이동', { label: S.label(s), sub: S.isText(s) ? '글' : '셸', run: () => { SW.main.setView('canvas'); C.reveal(s.id); } }));
    }
    K.commands.filter((c) => c.run && !c.display && !c.hidden && (!c.when || c.when()) && (!q || matches(c.label + ' ' + c.g, q)))
      .forEach((c) => push(c.g, { label: c.label, keys: c.keys, run: c.run }));
    groups.forEach((items, g) => {
      const h = document.createElement('div'); h.className = 'pal-group'; h.textContent = g; list.append(h);
      items.forEach((it) => {
        const i = palItems.length; palItems.push(it);
        const row = document.createElement('div'); row.className = 'pal-item'; row.setAttribute('role', 'option'); row.dataset.i = i;
        const l = document.createElement('span'); l.className = 'pal-label'; l.textContent = it.label; row.append(l);
        if (it.sub) { const s = document.createElement('span'); s.className = 'pal-sub'; s.textContent = it.sub; row.append(s); }
        if (it.keys) row.append(K.chips(it.keys));
        list.append(row);
      });
    });
    if (!palItems.length) { const e = document.createElement('div'); e.className = 'pal-empty'; e.textContent = '맞는 명령이나 셸이 없어요'; list.append(e); }
    palIndex = 0; palMark();
  }
  function palMark() {
    document.querySelectorAll('.pal-item').forEach((r) => {
      const on = +r.dataset.i === palIndex; r.classList.toggle('on', on); r.setAttribute('aria-selected', String(on));
      if (on) r.scrollIntoView({ block: 'nearest' });
    });
  }
  function palRun(i) { const it = palItems[i]; if (!it) return; K.closePalette(); setTimeout(it.run, 0); }
  K.openPalette = () => {
    if (SW.present && SW.present.on) return;
    SW.ui.closeMenus(); K.paletteOpen = true; $('#palette').hidden = false;
    const inp = $('#palInput'); inp.value = ''; palRender(); inp.focus();
  };
  K.closePalette = () => { K.paletteOpen = false; $('#palInput').blur(); $('#palette').hidden = true; };

  /* ---------- shortcut sheet ---------- */
  K.openSheet = () => {
    const body = $('#sheetBody'); body.textContent = '';
    const groups = new Map();
    K.commands.filter((c) => c.keys).forEach((c) => { if (!groups.has(c.g)) groups.set(c.g, []); groups.get(c.g).push([c.label, c.keys + (c.alt ? ' / ' + c.alt : '')]); });
    groups.set('글 편집', TEXT_KEYS);
    groups.forEach((rows, g) => {
      const sec = document.createElement('section'); sec.className = 'sheet-sec';
      const h = document.createElement('h3'); h.textContent = g; sec.append(h);
      rows.forEach(([label, keys]) => {
        const r = document.createElement('div'); r.className = 'sheet-row';
        const l = document.createElement('span'); l.textContent = label; r.append(l);
        if (/^[←↑→↓ ]+$/.test(keys)) { const k = document.createElement('span'); k.className = 'keys'; keys.split(' ').forEach((a) => { const b = document.createElement('kbd'); b.textContent = a; k.append(b); }); r.append(k); }
        else r.append(K.chips(keys));
        sec.append(r);
      });
      body.append(sec);
    });
    const rules = document.createElement('section'); rules.className = 'sheet-sec sheet-rules';
    const rh = document.createElement('h3'); rh.textContent = '보드의 규칙'; rules.append(rh);
    [
      '셸은 문서의 제목, 글 조각은 문단이 돼요',
      '셸 안에 셸을 넣으면 제목 단계가 내려가요 (H1~H6, 6단계까지)',
      '캔버스 위 순서는 위에서 아래, 같은 줄은 왼쪽부터예요 (O로 번호 보기)',
      '섹션과 화살표는 보기 위한 것이라 목차를 바꾸지 않아요',
    ].forEach((txt) => { const r = document.createElement('div'); r.className = 'sheet-row'; r.textContent = txt; rules.append(r); });
    body.prepend(rules);
    document.querySelectorAll('[data-motion-pick]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.motionPick === SW.motion.style)));
    $('#keysheet').hidden = false; $('#sheetClose').focus();
  };
  K.closeSheet = () => { $('#keysheet').hidden = true; };

  /* ---------- tooltips with the shortcut ---------- */
  let tipTimer = null, tipFor = null;
  const hideTip = () => { clearTimeout(tipTimer); tipFor = null; const t = $('#tip'); if (t) t.hidden = true; };
  function showTip(el) {
    const tip = $('#tip'); tip.textContent = '';
    const l = document.createElement('span'); l.textContent = el.dataset.tip; tip.append(l);
    if (el.dataset.kbd) tip.append(K.chips(el.dataset.kbd));
    tip.hidden = false;
    const r = el.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
    const below = r.top < 80;
    tip.style.left = Math.max(8, Math.min(window.innerWidth - tw - 8, r.left + r.width / 2 - tw / 2)) + 'px';
    tip.style.top = (below ? r.bottom + 8 : r.top - th - 8) + 'px';
  }

  K.init = () => {
    document.addEventListener('pointerover', (e) => {
      const el = e.target.closest && e.target.closest('[data-tip]');
      if (el === tipFor) return;
      hideTip(); if (!el || e.pointerType === 'touch') return;
      tipFor = el; tipTimer = setTimeout(() => { if (tipFor === el && el.isConnected) showTip(el); }, 380);
    });
    document.addEventListener('pointerdown', hideTip, true);
    window.addEventListener('blur', hideTip);
    document.querySelectorAll('[data-kbd-label]').forEach((el) => el.append(K.chips(el.dataset.kbdLabel)));

    const inp = $('#palInput');
    inp.addEventListener('input', palRender);
    inp.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); palIndex = Math.min(palItems.length - 1, palIndex + 1); palMark(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); palIndex = Math.max(0, palIndex - 1); palMark(); }
      else if (e.key === 'Enter') { e.preventDefault(); palRun(palIndex); }
      else if (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && e.code === 'KeyK')) { e.preventDefault(); K.closePalette(); }
    });
    $('#palList').addEventListener('pointermove', (e) => { const r = e.target.closest('.pal-item'); if (r && +r.dataset.i !== palIndex) { palIndex = +r.dataset.i; palMark(); } });
    $('#palList').addEventListener('click', (e) => { const r = e.target.closest('.pal-item'); if (r) palRun(+r.dataset.i); });
    $('#palette').addEventListener('pointerdown', (e) => { if (e.target.id === 'palette') K.closePalette(); });

    $('#keysheet').addEventListener('pointerdown', (e) => { if (e.target.id === 'keysheet') K.closeSheet(); });
    $('#sheetClose').onclick = K.closeSheet;
    document.querySelectorAll('[data-motion-pick]').forEach((b) => {
      b.onclick = () => { const st = b.dataset.motionPick; SW.motion.set(st); K.closeSheet(); if (st === 'off') SW.ui.toast('애니메이션을 껐어요'); else SW.motion.demo(); };
    });
    document.querySelectorAll('[data-open-palette]').forEach((b) => { b.onclick = K.openPalette; });
  };
})(window.SW);
