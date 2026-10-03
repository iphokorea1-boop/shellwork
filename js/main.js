/* Shellwork — boot, boards, views, menus, export, shortcuts. */
(function (SW) {
  'use strict';
  const S = SW.store, P = SW.persist, C = SW.canvas, D = SW.doc;
  const $ = (q) => document.querySelector(q);
  const typing = () => { const a = document.activeElement; return a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT' || a.tagName === 'SELECT' || a.isContentEditable); };

  /* ---------- small UI kit ---------- */
  const ui = SW.ui = {};
  let openEl = null, openAnchor = null, toastTimer = null, outlineTimer = null;
  const COLOR_NAMES = { '': '기본', rose: '분홍', amber: '노랑', lime: '연두', sky: '하늘', violet: '보라', slate: '회색' };
  const narrow = () => window.matchMedia('(max-width: 820px)').matches;
  ui.closeMenus = () => {
    document.querySelectorAll('.menu').forEach((m) => { m.hidden = true; });
    if (openAnchor) openAnchor.setAttribute('aria-expanded', 'false');
    openEl = null; openAnchor = null;
  };
  ui.openMenu = (anchor, items, menu) => {
    const el = menu || $('#shellMenu');
    if (openEl === el && openAnchor === anchor) { ui.closeMenus(); return; }
    ui.closeMenus(); el.textContent = '';
    items.forEach((it) => {
      if (it === '-') { el.append(document.createElement('hr')); return; }
      if (it.heading) { const h = document.createElement('div'); h.className = 'menu-label'; h.textContent = it.heading; el.append(h); return; }
      if (it.note) { const n = document.createElement('div'); n.className = 'menu-note'; n.textContent = it.note; el.append(n); return; }
      if (it.row) {
        const r = document.createElement('div'); r.className = 'menu-row';
        const l = document.createElement('span'); l.textContent = it.row; const k = document.createElement('kbd'); k.textContent = it.meta;
        r.append(l, k); el.append(r); return;
      }
      if (it.swatches) {
        const row = document.createElement('div'); row.className = 'swatches'; row.setAttribute('role', 'radiogroup'); row.setAttribute('aria-label', '셸 색');
        it.swatches.forEach((c) => {
          const b = document.createElement('button'); b.setAttribute('role', 'menuitemradio');
          b.setAttribute('aria-checked', String(c === it.value)); b.title = COLOR_NAMES[c]; b.setAttribute('aria-label', COLOR_NAMES[c]);
          if (c) b.dataset.color = c; if (c === it.value) b.classList.add('on');
          b.onclick = () => { ui.closeMenus(); it.act(c); };
          row.append(b);
        });
        el.append(row); return;
      }
      const b = document.createElement('button'); b.setAttribute('role', 'menuitem');
      b.className = (it.danger ? 'danger' : '') + (it.current ? ' current' : '');
      const l = document.createElement('span'); l.textContent = it.label; b.append(l);
      if (it.meta) { const m = document.createElement('span'); m.className = 'meta'; m.textContent = it.meta; b.append(m); }
      b.onclick = () => { ui.closeMenus(); it.act(); };
      el.append(b);
    });
    el.hidden = false; el.style.position = 'fixed';
    const r = anchor.getBoundingClientRect(), mw = el.offsetWidth, mh = el.offsetHeight;
    el.style.left = Math.max(8, Math.min(r.left, window.innerWidth - mw - 8)) + 'px';
    el.style.top = (r.bottom + mh + 8 > window.innerHeight ? Math.max(8, r.top - mh - 4) : r.bottom + 4) + 'px';
    anchor.setAttribute('aria-expanded', 'true'); openEl = el; openAnchor = anchor;
    const first = el.querySelector('button'); if (first) first.focus({ preventScroll: true });
  };
  document.addEventListener('pointerdown', (e) => {
    if (openEl && !openEl.contains(e.target) && !(openAnchor && openAnchor.contains(e.target))) ui.closeMenus();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (!openEl || !openEl.contains(document.activeElement)) return;
    const bs = [...openEl.querySelectorAll('button')]; const i = bs.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); bs[(i + 1) % bs.length].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); bs[(i - 1 + bs.length) % bs.length].focus(); }
  });

  ui.toast = (msg, actionLabel, action) => {
    const t = $('#toast'); t.textContent = '';
    const s = document.createElement('span'); s.textContent = msg; t.append(s);
    if (actionLabel) { const b = document.createElement('button'); b.textContent = actionLabel; b.onclick = () => { t.hidden = true; action(); }; t.append(b); }
    t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, actionLabel ? 7000 : 4500);
  };

  ui.modal = ({ title, text, area, readonly, input, actions, node, image, onClose }) => {
    const m = $('#modal'); $('#modalTitle').textContent = title; $('#modalText').textContent = text || ''; $('#modalText').hidden = !text;
    const slot = $('#modalNode'); slot.textContent = ''; slot.hidden = !node; if (node) slot.append(node);
    const im = $('#modalImg'); im.hidden = !image; if (image) im.src = image; else im.removeAttribute('src');
    ui._onClose = onClose || null;
    const ta = $('#modalArea'); ta.hidden = area == null && input == null; ta.readOnly = !!readonly;
    ta.value = area != null ? area : (input != null ? input : '');
    ta.style.minHeight = input != null ? '0' : ''; ta.rows = input != null ? 1 : 12;
    const box = $('#modalActions'); box.textContent = '';
    actions.forEach((a) => {
      const b = document.createElement('button'); b.className = 'btn ' + (a.cls || ''); b.textContent = a.label;
      b.onclick = async () => { const keep = await a.act(ta.value, b); if (!keep) ui.closeModal(); };
      box.append(b);
    });
    m.hidden = false;
    setTimeout(() => { if (!ta.hidden) { ta.focus(); if (input != null) ta.select(); } else box.lastChild.focus(); }, 0);
  };
  ui.closeModal = () => {
    $('#modal').hidden = true;
    const f = ui._onClose; ui._onClose = null; if (f) f(); // closing without choosing counts as cancel
  };
  $('#modal').addEventListener('pointerdown', (e) => { if (e.target.id === 'modal') ui.closeModal(); });

  ui.copy = (text) => {
    const done = () => ui.toast('복사했어요');
    try {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text));
    } catch (e) { fallbackCopy(text); }
  };
  function fallbackCopy(text) {
    ui.modal({ title: '직접 복사해 주세요', text: '이 화면에서는 자동 복사가 막혀 있어요. 아래 글을 선택해 복사하세요.', area: text, readonly: true, actions: [{ label: '닫기', act: () => false }] });
    setTimeout(() => $('#modalArea').select(), 30);
  }

  /* ---------- views ---------- */
  const main = SW.main = { view: 'canvas' };
  main.setView = (v) => {
    main.view = v;
    $('#canvasView').hidden = v !== 'canvas'; $('#docView').hidden = v !== 'doc'; $('#mapView').hidden = v !== 'map';
    document.querySelectorAll('.view-switch button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === v)));
    if (v === 'canvas') { C.render(); C.applyView(); } else if (v === 'doc') D.render(); else D.renderMap();
    if (v !== 'canvas' && C.focusId) { C.focusId = null; C.spot(null); $('#focusBar').hidden = true; }
    C.placeSelBar();
    SW.ls.set('shellwork.viewmode', v);
    if (v === 'doc' && main.track) main.track('doc');
  };
  main.showBoardName = () => { $('#boardName').textContent = S.board.name; document.title = S.board.name + ' · Shellwork'; };

  /* ---------- sidebar outline ---------- */
  main.renderOutline = () => {
    const nav = $('#outline'); nav.textContent = '';
    const shells = Object.values(S.board.shells).filter((s) => !S.isText(s)).length;
    $('#shellCount').textContent = shells ? String(shells) : '';
    if (!shells) { const p = document.createElement('p'); p.className = 'outline-empty'; p.textContent = '아직 셸이 없어요. 조각들을 골라 셸로 감싸 보세요'; nav.append(p); return; }
    S.walk((s, d) => {
      if (S.isText(s)) return;
      const b = document.createElement('button');
      b.className = 'ol-item' + (d === 0 ? ' top' : '') + (C.selected.has(s.id) ? ' sel' : ''); b.dataset.id = s.id; b.draggable = true;
      b.style.paddingLeft = (8 + d * 16) + 'px';
      const dot = document.createElement('i'); dot.className = 'dot'; if (s.color) dot.dataset.color = s.color;
      const t = document.createElement('span'); t.textContent = s.title.trim() || '제목 없음'; if (!s.title.trim()) t.className = 'untitled';
      b.append(dot, t); nav.append(b);
    });
  };
  main.markOutline = () => {
    document.querySelectorAll('.ol-item').forEach((b) => b.classList.toggle('sel', C.selected.has(b.dataset.id)));
    if (SW.collab.active) SW.collab.sendPresence();
  };
  main.setSidebar = (open) => {
    $('#app').classList.toggle('side-collapsed', !open);
    $('#sideScrim').hidden = !(open && narrow());
    if (!narrow()) SW.ls.set('shellwork.side', open ? '1' : '0');
  };

  S.on((kind) => {
    if (kind !== 'struct') { clearTimeout(outlineTimer); outlineTimer = setTimeout(main.renderOutline, 250); return; }
    C.render(); main.renderOutline();
    if (main.view === 'doc') D.render(); else if (main.view === 'map') D.renderMap();
  });

  /* ---------- save status ---------- */
  const STATUS = { pending: '변경됨', saving: '저장 중…', memory: '저장되지 않는 미리보기' };
  P.onStatus = (st, err) => {
    const el = $('#saveState'); $('.side-foot').dataset.state = st;
    if (st === 'saved') el.textContent = P.mode === 'cloud' ? 'claude.ai에 저장됨' : '이 브라우저에 저장됨';
    else if (st === 'error') el.textContent = (err && err.message && /[\uAC00-\uD7A3]/.test(err.message)) ? err.message : '저장하지 못했어요. 잠시 뒤 다시 시도해요.';
    else el.textContent = STATUS[st] || '';
  };
  const idleStatus = () => {
    const el = $('#saveState');
    $('.side-foot').dataset.state = S.board.example ? 'example' : P.mode === 'memory' ? 'memory' : 'saved';
    if (S.board.example) el.textContent = '예시 보드 · 고치면 내 보드로 저장돼요';
    else el.textContent = P.mode === 'cloud' ? 'claude.ai에 저장됨' : P.mode === 'local' ? '이 브라우저에 저장됨' : STATUS.memory;
  };

  /* ---------- boards ---------- */
  function openBoard(b) {
    S.board = b; S.undoStack = []; S.redoStack = []; C.selected.clear(); C.selArrow = null; C.selSection = null;
    if (!S.board.sections) S.board.sections = [];
    SW.history.reset();
    main.showBoardName(); if (!b.example) P.rememberLast(b.id);
    main.setView(main.view); main.renderOutline();
    if (!C.loadView()) requestAnimationFrame(() => { C.render({ instant: true }); C.fit(true); });
    idleStatus();
    if (b.shared) SW.collab.start(b); else SW.collab.stop();
  }
  async function switchBoard(id, shared) {
    await P.flush();
    try { const b = await P.load(id, shared); if (b) openBoard(b); else ui.toast('보드를 찾지 못했어요.'); }
    catch (e) { ui.toast('보드를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.'); }
  }
  main.openFirst = async () => {
    const list = await P.list().catch(() => []);
    if (list.length) await switchBoard(list[0].id, list[0].shared); else openBoard(S.exampleBoard());
  };
  main.newBoard = (kind) => newBoard(kind);
  async function newBoard(kind) {
    await P.flush();
    const b = kind ? S.templateBoard(kind) : S.emptyBoard('새 보드 ' + new Date().toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }));
    openBoard(b); S.changed(); main.setView('canvas');
    if (!kind) ui.toast('새 보드를 만들었어요. 빈 곳을 더블클릭해 첫 셸을 만드세요.');
    else requestAnimationFrame(() => C.fit());
  }
  function shareBoard() {
    ui.modal({
      title: '친구와 함께 쓰는 보드로 바꿀까요?',
      text: '이 보드를 함께 쓰는 공간으로 옮겨요. 이 페이지에 접근할 수 있는 사람은 모두 이 보드를 열고 함께 고칠 수 있고, 서로의 커서와 고른 셸이 실시간으로 보여요.',
      actions: [
        { label: '취소', act: () => false },
        { label: '함께 쓰기 시작', cls: 'primary', act: async (v, btn) => {
          btn.disabled = true; btn.textContent = '옮기는 중…';
          try { clearTimeout(P.timer); await SW.collab.share(); }
          catch (e) { ui.toast('옮기지 못했어요. 잠시 뒤 다시 시도해 주세요.'); btn.disabled = false; btn.textContent = '함께 쓰기 시작'; return true; }
          main.showBoardName(); idleStatus();
          ui.modal({
            title: '이제 함께 쓰는 보드예요',
            text: '친구를 초대하려면 이 페이지의 공유 메뉴에서 친구 이메일을 넣고 편집할 수 있는 권한을 주세요. 친구가 링크를 열면 보드 목록의 "함께 쓰는 보드"에서 이 보드를 고를 수 있어요.',
            actions: [{ label: '확인', cls: 'primary', act: () => false }],
          });
          return true;
        } },
      ],
    });
  }
  function renameBoard() {
    ui.modal({ title: '보드 이름 바꾸기', input: S.board.name, actions: [
      { label: '취소', act: () => false },
      { label: '바꾸기', cls: 'primary', act: (v) => { const n = v.replace(/\s+/g, ' ').trim(); if (n) { S.board.name = n.slice(0, 80); main.showBoardName(); S.changed(main.view === 'canvas' ? 'text' : 'struct'); } } },
    ] });
  }
  function deleteBoard() {
    ui.modal({ title: '“' + S.board.name + '” 보드를 삭제할까요?', text: '셸 ' + S.count() + '개가 함께 지워지고 되돌릴 수 없어요.', actions: [
      { label: '취소', act: () => false },
      { label: '삭제', cls: 'danger', act: async () => {
        const id = S.board.id, shared = !!S.board.shared; clearTimeout(P.timer); P.dirty = false;
        if (shared) SW.collab.stop();
        try { await P.remove(id, shared); } catch (e) { ui.toast('삭제하지 못했어요. 잠시 뒤 다시 시도해 주세요.'); return; }
        const rest = (await P.list().catch(() => [])).filter((x) => x.id !== id);
        if (rest.length) await switchBoard(rest[0].id, rest[0].shared); else openBoard(S.exampleBoard());
        ui.toast('보드를 삭제했어요');
      } },
    ] });
  }
  async function boardMenu() {
    const anchor = $('#boardBtn');
    let list = []; try { list = await P.list(); } catch (e) { list = []; }
    const fmt = (t) => t ? new Date(t).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }) : '';
    const items = [{ heading: P.mode === 'cloud' ? '내 보드 (claude.ai에 저장)' : P.mode === 'local' ? '내 보드 (이 브라우저)' : '저장되지 않는 미리보기' }];
    if (S.board.example) items.push({ label: S.board.name, meta: '예시', current: true, act: () => {} });
    const row = (b) => ({ label: b.name || '제목 없음', meta: fmt(b.updatedAt), current: b.id === S.board.id, act: () => b.id !== S.board.id && switchBoard(b.id, b.shared) });
    list.filter((b) => !b.shared).forEach((b) => items.push(row(b)));
    const shared = list.filter((b) => b.shared);
    if (shared.length) { items.push({ heading: '함께 쓰는 보드' }); shared.forEach((b) => items.push(row(b))); }
    items.push('-', { heading: '새 보드' },
      { label: '빈 보드', act: () => newBoard() },
      { label: 'R&E 탐구 템플릿', meta: '질문→가설→실험→결과', act: () => newBoard('rne') },
      { label: 'R&E 연구 계획서', meta: '동기·가설·방법·일정', act: () => newBoard('plan') },
      { label: 'R&E 중간 보고', meta: '한 일·결과·문제·계획', act: () => newBoard('mid') },
      { label: 'R&E 최종 보고서', meta: '초록부터 결론까지', act: () => newBoard('final') },
      { label: '연구 발표 템플릿', meta: '발표 순서', act: () => newBoard('talk') },
      '-', { label: '버전 기록', meta: SW.keys.fmt('Shift+H'), act: () => SW.history.open() }, { label: '이 보드 이름 바꾸기', act: renameBoard });
    if (P.mode === 'cloud' && !S.board.shared && !S.board.example) items.push({ label: '친구와 함께 쓰기…', act: shareBoard });
    if (!S.board.example) items.push({ label: '이 보드 삭제', danger: true, act: deleteBoard });
    items.push('-', { label: '데이터와 AI 안내', act: main.dataGuide });
    ui.openMenu(anchor, items, $('#boardMenu'));
  }

  /* ---------- export & paste ---------- */
  let downloads = null;
  function exportMd() {
    const md = S.toMarkdown();
    const fname = (S.board.name.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'shellwork') + '.md';
    const base = S.board.name.replace(/[\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'shellwork';
    const actions = [{ label: '닫기', act: () => false }, { label: '복사', act: () => { ui.copy(md); return true; } }];
    actions.push({ label: 'Word로 저장 (.docx)', act: async () => { await saveFile(base + '.docx', SW.docx.build()); return true; } });
    if (downloads) actions.push({ label: fname + ' 저장', cls: 'primary', act: async () => {
      try { await downloads.save({ filename: fname, data: md }); ui.toast('파일을 저장했어요'); }
      catch (e) { if (e && e.code !== 'declined') ui.toast('파일로 저장하지 못했어요. 복사 버튼을 써 주세요.'); return true; }
    } });
    ui.modal({ title: '내보내기', text: '셸의 계층이 제목 단계가 돼요. 마크다운은 Notion·블로그에, Word 파일은 학교 제출이나 한글(HWP)에서 열 때 써요.', area: md, readonly: true, actions });
  }
  main.exportWord = () => saveFile((S.board.name.trim().slice(0, 60) || 'shellwork') + '.docx', SW.docx.build());
  /* hand a generated file to the viewer: the claude.ai save dialog when published, a plain download link elsewhere */
  async function saveFile(name, data) {
    if (downloads) {
      try { await downloads.save({ filename: name, data }); ui.toast('파일을 저장했어요'); }
      catch (e) { if (e && e.code !== 'declined') ui.toast('파일로 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.'); }
      return;
    }
    if (window.claude) { ui.toast('이 화면에서는 파일 저장을 쓸 수 없어요. 복사를 써 주세요.'); return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data])); a.download = name;
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function pasteDialog() {
    ui.modal({
      title: '글을 붙여 넣어 셸로 나누기',
      text: '메모, 회의록, 마크다운 무엇이든 괜찮아요. 제목(#)·목록(-)이 있으면 그 계층대로, 없으면 문단마다 셸 하나로 나눕니다.',
      area: '', actions: [
        { label: '취소', act: () => false },
        { label: '셸로 나누기', cls: 'primary', act: (v) => { if (!v.trim()) return true; main.setView('canvas'); C.insertText(v); } },
      ],
    });
  }

  /* shortcuts, the command palette and paste live in keys.js */

  /* ---------- data and AI, in plain words ---------- */
  main.dataGuide = () => {
    const box = document.createElement('div'); box.className = 'guide-text';
    [
      ['보드는 어디에 저장되나요?', 'claude.ai에서 열면 이 페이지의 저장소에 저장돼요. "내 보드"는 나만 볼 수 있고, "함께 쓰는 보드"는 이 페이지를 공유받은 사람이 함께 봐요. 내 컴퓨터에서 파일로 열면 지금 쓰는 브라우저에만 저장돼요.'],
      ['AI에게는 무엇이 보내지나요?', 'AI 기능을 쓸 때만 보드의 제목과 본문(그리고 고른 내용)이 내 Claude 계정을 통해 Claude에게 보내져요. 처음 쓸 때 허락을 묻고, 내 Claude 사용량이 쓰여요. 버튼을 누르지 않으면 아무것도 보내지 않아요.'],
      ['사진은요?', '사진을 셸로 바꿀 때 사진이 Claude에게 보내져요. 보드에는 원본이 아니라 작은 미리보기 한 장만 출처로 남아요.'],
      ['버전 기록은요?', '작업하는 동안 10분마다 자동으로 남고, 직접 이름을 붙여 남길 수도 있어요. 보드마다 최근 40개(브라우저 저장은 15개)까지 보관해요.'],
      ['학생이라면', '이름, 연락처, 학번 같은 개인정보는 보드에 적지 않는 게 안전해요. 함께 쓰는 보드는 초대한 사람만 들어오게 해 주세요.'],
    ].forEach(([q, a]) => { const h = document.createElement('h3'); h.textContent = q; const p = document.createElement('p'); p.textContent = a; box.append(h, p); });
    ui.modal({ title: '데이터와 AI 안내', node: box, actions: [{ label: '확인', cls: 'primary', act: () => false }] });
  };

  /* ---------- outline: drag to reorder or nest ---------- */
  function outlineDnD() {
    const nav = $('#outline'); let dragId = null;
    const clear = () => nav.querySelectorAll('.drop-before,.drop-after,.drop-into').forEach((x) => x.classList.remove('drop-before', 'drop-after', 'drop-into'));
    const modeFor = (row, e) => {
      const r = row.getBoundingClientRect(), rel = (e.clientY - r.top) / r.height, s = S.get(row.dataset.id);
      if (!s) return null;
      if (!s.parent) return S.isText(s) ? null : 'into'; // canvas items keep their spot on the canvas; nest only
      if (rel < 0.3) return 'before'; if (rel > 0.7) return 'after'; return S.isText(s) ? 'after' : 'into';
    };
    nav.addEventListener('dragstart', (e) => { const row = e.target.closest('.ol-item'); if (!row) return; dragId = row.dataset.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', S.label(S.get(dragId))); });
    nav.addEventListener('dragover', (e) => {
      const row = e.target.closest('.ol-item'); if (!dragId || !row || row.dataset.id === dragId) return;
      const m = modeFor(row, e); clear(); if (!m || S.isAncestor(dragId, row.dataset.id)) return;
      e.preventDefault(); row.classList.add('drop-' + m);
    });
    nav.addEventListener('dragleave', (e) => { if (e.target === nav) clear(); });
    nav.addEventListener('drop', (e) => {
      const row = e.target.closest('.ol-item'); clear(); if (!dragId || !row) return;
      e.preventDefault(); const m = modeFor(row, e); if (!m) return;
      S.checkpoint();
      if (S.place(dragId, row.dataset.id, m)) { S.changed(); SW.motion.flash(C.els.get(dragId)); }
      else { S.undoStack.pop(); if (S.lastError === 'depth') C.depthWarn(); }
      dragId = null;
    });
    nav.addEventListener('dragend', () => { dragId = null; clear(); });
  }

  /* ---------- first steps: learn by doing on the board, no shortcuts needed ---------- */
  const STEPS = [
    ['text', '글 조각 만들기', '빈 곳을 더블클릭하고 아무 생각이나 적어요', '만들기', () => { main.setView('canvas'); C.addText(); }],
    ['wrap', '셸로 감싸기', '조각 여러 개를 끌어서 고른 뒤 위 막대의 "셸로 감싸기"', '골라 주기', () => {
      main.setView('canvas'); const ids = S.board.roots.filter((id) => S.isText(S.get(id))).slice(0, 2);
      if (ids.length) { C.selectMany(ids); ui.toast('조각을 골랐어요. 위에 뜬 "셸로 감싸기"를 눌러 보세요'); } else ui.toast('먼저 글 조각을 두 개 이상 만들어 주세요');
    }],
    ['focus', '집중해서 보기', '셸을 고르고 "집중"을 누르면 그 셸만 크게 보여요', '해 보기', () => {
      main.setView('canvas'); const id = S.board.roots.find((x) => !S.isText(S.get(x))); if (id) C.focus(id);
    }],
    ['doc', '문서로 읽기', '같은 내용이 제목 단계가 있는 문서가 돼요', '보기', () => main.setView('doc')],
  ];
  let guideState = {};
  try { guideState = JSON.parse(SW.ls.get('shellwork.guide') || '{}'); } catch (e) { guideState = {}; }
  const saveGuide = () => SW.ls.set('shellwork.guide', JSON.stringify(guideState));
  main.showGuide = () => { guideState = {}; saveGuide(); renderGuide(); if (narrow()) ui.toast('처음 사용 안내는 넓은 화면에서 보여요'); };
  main.track = (step) => { if (guideState[step] || guideState.closed) return; guideState[step] = 1; saveGuide(); renderGuide(true); };
  function renderGuide(justDone) {
    const card = $('#guide'); if (!card) return;
    if (guideState.closed || narrow()) { card.hidden = true; return; }
    const done = STEPS.filter((s) => guideState[s[0]]).length;
    card.hidden = false;
    $('#guideCount').textContent = done + ' / ' + STEPS.length;
    const list = $('#guideList'); list.textContent = '';
    STEPS.forEach(([key, title, how, cta, run]) => {
      const row = document.createElement('div'); row.className = 'guide-row' + (guideState[key] ? ' done' : '');
      const mark = document.createElement('span'); mark.className = 'guide-check'; mark.setAttribute('aria-hidden', 'true');
      const text = document.createElement('div'); const t = document.createElement('strong'); t.textContent = title; const h = document.createElement('span'); h.textContent = how; text.append(t, h);
      row.append(mark, text);
      if (!guideState[key]) { const b = document.createElement('button'); b.className = 'chip'; b.textContent = cta; b.onclick = run; row.append(b); }
      list.append(row);
    });
    if (done === STEPS.length && justDone) {
      ui.toast('기본 흐름을 다 해 봤어요. 나머지는 ? 키로 볼 수 있어요');
      setTimeout(() => { guideState.closed = 1; saveGuide(); renderGuide(); }, 2500);
    }
  }

  /* ---------- boot ---------- */
  async function boot() {
    C.init(); D.init(); SW.present.init(); SW.collab.init(); SW.keys.init();
    document.querySelectorAll('.view-switch button').forEach((b) => { b.onclick = () => main.setView(b.dataset.view); });
    $('#boardBtn').onclick = boardMenu;
    $('#exportBtn').onclick = exportMd;
    $('#pasteBtn').onclick = pasteDialog;
    $('#addShellBtn').onclick = () => { main.setView('canvas'); C.addRoot(); };
    $('#addTextBtn').onclick = () => { main.setView('canvas'); C.addText(); };
    document.querySelectorAll('[data-tool]').forEach((b) => { b.onclick = () => SW.input.setTool(b.dataset.tool); });
    $('#aiBtn').onclick = () => { const p = $('#aiPanel'); p.hidden = !p.hidden; if (!p.hidden) $('#aiInput').focus(); };
    $('#aiClose').onclick = () => { $('#aiPanel').hidden = true; };
    const v = SW.ls.get('shellwork.viewmode'); if (v === 'doc' || v === 'map') main.view = v;

    main.setSidebar(!narrow() && SW.ls.get('shellwork.side') !== '0');
    $('#sideOpen').onclick = () => main.setSidebar(true);
    $('#sideClose').onclick = () => main.setSidebar(false);
    $('#sideScrim').onclick = () => main.setSidebar(false);
    $('#outline').addEventListener('click', (e) => {
      const b = e.target.closest('.ol-item'); if (!b) return;
      const id = b.dataset.id;
      if (main.view === 'doc') { const sec = document.getElementById('sec-' + id); if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      else { if (main.view !== 'canvas') main.setView('canvas'); C.reveal(id); }
      if (narrow()) main.setSidebar(false);
    });
    $('#helpBtn').onclick = () => SW.keys.openSheet();
    $('#historyBtn').onclick = () => SW.history.open();
    $('#orderBtn').onclick = () => { C.toggleOrder(); $('#orderBtn').setAttribute('aria-pressed', String(C.showOrder)); };
    $('#orderBtn').setAttribute('aria-pressed', String(C.showOrder));
    $('#dataGuideBtn').onclick = main.dataGuide;
    $('#guideClose').onclick = () => { guideState.closed = 1; saveGuide(); renderGuide(); };
    SW.history.init(); outlineDnD(); renderGuide();
    $('#aiLog').addEventListener('click', (e) => {
      const li = e.target.closest('.ai-empty li'); if (!li) return;
      $('#aiInput').value = li.textContent; $('#aiInput').focus();
    });

    S.board = S.exampleBoard(); main.showBoardName(); main.setView(main.view); main.renderOutline(); // something to look at while storage answers
    requestAnimationFrame(() => { if (!C.loadView()) C.fit(true); });
    $('#saveState').textContent = '불러오는 중…';

    SW.ai.init();
    if (window.claude && typeof window.claude.use === 'function') window.claude.use('downloads').then((d) => { downloads = d; }, () => {});

    await P.init();
    let board = null;
    try {
      const list = await P.list();
      const last = P.lastId();
      const pick = list.find((b) => b.id === last) || list[0];
      if (pick) board = await P.load(pick.id, pick.shared);
    } catch (e) { ui.toast('저장된 보드를 불러오지 못했어요. 예시 보드를 보여 드려요.'); }
    if (board) openBoard(board); else idleStatus();
  }
  boot();
})(window.SW);
