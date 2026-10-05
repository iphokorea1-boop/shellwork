/* Shellwork — AI. Uses the claude.ai artifact `sample` capability: calls run on the viewer's own
 * Claude account, so the page holds no API key. Outside claude.ai the AI controls explain that. */
(function (SW) {
  'use strict';
  const S = SW.store;
  const $ = (q) => document.querySelector(q);
  const MIME = 'application/x-shellwork';

  const A = SW.ai = { sample: null, disabled: false, busy: new Set(), turns: [], ctl: null };

  const ERR = {
    not_granted: 'AI 사용을 허용하지 않아 실행하지 않았어요. 쓰려면 페이지를 새로 고친 뒤 허용해 주세요.',
    sampling_disabled: '이 계정에서는 AI를 쓸 수 없어요.',
    rate_limited: '요청이 몰려 잠시 막혔어요. 조금 뒤에 다시 눌러 주세요.',
    session_expired: 'claude.ai에 다시 로그인해 주세요.',
    prompt_too_large: '보드 내용이 너무 길어요. 셸 일부를 다른 보드로 옮긴 뒤 다시 시도해 주세요.',
    refused: 'AI가 이 요청에는 답하지 않았어요. 표현을 바꿔 보세요.',
    empty_completion: 'AI가 빈 답을 보냈어요. 다시 눌러 주세요.',
    invalid_json: 'AI 답을 셸 구조로 읽지 못했어요. 한 번 더 눌러 주세요.',
    upstream_error: '연결이 끊겼어요. 다시 시도해 주세요.',
  };
  const PERMANENT = ['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'];
  A.errText = (e) => ERR[e && e.code] || ERR.upstream_error;
  function fail(e) {
    if (e && e.code === 'cancelled') return;
    if (e && PERMANENT.includes(e.code)) A.disabled = true;
    SW.ui.toast(A.errText(e));
  }
  function ensure() {
    if (A.sample && !A.disabled) return true;
    SW.ui.toast(A.disabled ? '이 화면에서는 AI를 쓸 수 없어요.' : 'AI는 claude.ai에 게시된 페이지에서 동작해요. 지금은 편집만 할 수 있어요.');
    return false;
  }

  /* ---------- the board as text for the prompt ---------- */
  A.outline = () => {
    const lines = [];
    S.walk((s, d) => {
      const pos = d === 0 ? ' (x:' + s.x + ', y:' + s.y + ')' : '';
      const body = s.body.trim().replace(/\s*\n+\s*/g, ' / ');
      if (S.isImage(s)) { lines.push('  '.repeat(d) + '- [' + s.id + '] (그림 id=' + s.img + ')' + pos + ': ' + (body.slice(0, 300) || '설명 없음')); return; }
      if (S.isText(s)) { lines.push('  '.repeat(d) + '- [' + s.id + '] (메모)' + pos + ': ' + (body.slice(0, 700) || '(비어 있음)')); return; }
      lines.push('  '.repeat(d) + '- [' + s.id + '] ' + (s.title.trim() || '(제목 없음)') + pos + (body ? ': ' + body.slice(0, 700) : ''));
    });
    const rel = S.board.arrows.filter((a) => S.get(a.from) && S.get(a.to));
    if (rel.length) lines.push('', '화살표(관계): ' + rel.map((a) => '[' + a.from + '] → [' + a.to + ']' + (a.label ? ' (' + a.label + ')' : '')).join(', '));
    (S.board.sections || []).forEach((sec) => {
      const inside = S.board.roots.filter((id) => { const s = S.get(id); return s.x >= sec.x && s.y >= sec.y && s.x < sec.x + sec.w && s.y < sec.y + sec.h; });
      if (inside.length) lines.push('섹션(시각적 묶음, 목차 아님) "' + (sec.title || '섹션') + '": ' + inside.map((id) => '[' + id + ']').join(', '));
    });
    const text = '보드 이름: ' + S.board.name + '\n' + lines.join('\n');
    return text.length > 90000 ? text.slice(0, 90000) + '\n…(이하 생략)' : text;
  };
  const LANG = '보드에 쓰인 언어(대개 한국어)로 써. 사용자는 과학 탐구(R&E)를 하는 고등학생이니 근거와 연구 방법을 중시해.';
  const shellLine = (s) => '[' + s.id + '] "' + (s.title || '(제목 없음)') + '"' + (s.body.trim() ? ' — 본문: ' + s.body.trim() : '');
  const clean = (t, n) => String(t == null ? '' : t).replace(/\s+$/g, '').slice(0, n);

  /* ---------- per-shell actions ---------- */
  const mark = (id, on) => { const el = SW.canvas.els.get(id); if (el) el.classList.toggle('busy', on); };
  async function withShell(id, fn) {
    if (!ensure() || A.busy.has(id)) return;
    A.busy.add(id); mark(id, true);
    try { await fn(S.get(id)); } catch (e) { fail(e); } finally { A.busy.delete(id); mark(id, false); }
  }
  function streamBody(id) {
    return ({ text }) => {
      const s = S.get(id); if (!s) return; s.body = text;
      const el = SW.canvas.els.get(id); if (!el) return;
      const t = el.querySelector(':scope > .shell-body > textarea[data-f="body"]'), md = el.querySelector(':scope > .shell-body > .md');
      if (t && !t.hidden) { t.value = text; t.classList.add('streaming'); SW.canvas.autosize(t); }
      else if (md) { md.innerHTML = SW.md(text); md.classList.add('streaming'); }
      SW.canvas.drawWires();
    };
  }
  async function addChildren(s, items, prefix) {
    const list = (Array.isArray(items) ? items : (items && (items.items || items.ideas || items.questions)) || [])
      .filter((x) => x && (typeof x === 'string' || x.title)).slice(0, 6);
    if (!list.length) throw { code: 'empty_completion' };
    S.checkpoint();
    list.forEach((x) => S.add(typeof x === 'string'
      ? { title: clean(prefix ? prefix + x : x, 140), ai: true }
      : { title: clean((prefix || '') + x.title, 140), body: clean(x.body, 1200), ai: true }, s.id));
    s.collapsed = false; S.changed();
    SW.ui.toast(list.length + '개 하위 셸을 만들었어요', '되돌리기', S.undo);
  }

  A.expand = (id) => withShell(id, async (s) => {
    const r = await A.sample.json(
      '너는 생각을 넓혀 주는 공동 작업자야. ' + LANG + '\n\n전체 보드:\n' + A.outline() +
      '\n\n대상 셸: ' + shellLine(s) + (s.children.length ? '\n이미 있는 하위 셸: ' + s.children.map((c) => S.get(c).title).join(', ') : '') +
      '\n\n이 셸을 더 깊게 발전시킬 하위 아이디어 3~5개를 제안해. 이미 있는 것과 겹치지 말고, 보드의 다른 셸과 맥락이 맞게. ' +
      '제목은 25자 이내, 본문은 구체적인 1~2문장.\nJSON 배열만 답해: [{"title": "...", "body": "..."}]');
    await addChildren(s, r);
  });

  A.questions = (id) => withShell(id, async (s) => {
    const r = await A.sample.json(
      '너는 날카로운 지도 교사야. ' + LANG + '\n\n전체 보드:\n' + A.outline() + '\n\n대상 셸: ' + shellLine(s) +
      '\n\n이 셸의 생각을 더 단단하게 만들기 위해 스스로 답해 봐야 할 질문 3개를 만들어. 짧고 구체적으로.\nJSON 문자열 배열만 답해: ["...", "...", "..."]',
      { modelTier: 'quick' });
    await addChildren(s, r, '질문: ');
  });

  A.counter = (id) => withShell(id, async (s) => {
    const r = await A.sample.json(
      '너는 반대 입장에서 검토하는 토론 상대야. ' + LANG + '\n\n전체 보드:\n' + A.outline() + '\n\n대상 셸: ' + shellLine(s) +
      '\n\n이 주장이나 계획에 대한 가장 강한 반론 2~3개를 써. 각각 짧은 제목과 근거 한두 문장.\nJSON 배열만 답해: [{"title": "...", "body": "..."}]');
    await addChildren(s, r, '반론: ');
  });

  async function rewriteBody(id, instruction) {
    await withShell(id, async (s) => {
      const before = s.body;
      S.checkpoint();
      try {
        const { text } = await A.sample(
          '너는 글을 다듬는 편집자야. ' + LANG + '\n\n전체 보드:\n' + A.outline() + '\n\n대상 셸: ' + shellLine(s) +
          (s.children.length ? '\n하위 셸:\n' + s.children.map((c) => '- ' + shellLine(S.get(c))).join('\n') : '') +
          '\n\n' + instruction + '\n본문 텍스트만 답해. 머리말, 따옴표, 제목은 붙이지 마.',
          { onText: streamBody(id), cache: false });
        s.body = text.trim(); S.changed();
        SW.ui.toast('본문을 바꿨어요', '되돌리기', S.undo);
      } catch (e) {
        if (e && e.text) { s.body = e.text; } else { s.body = before; S.undoStack.pop(); }
        S.changed(); throw e;
      }
    });
  }
  A.refine = (id) => rewriteBody(id, S.get(id).body.trim()
    ? '이 셸의 본문을 더 명확하고 구체적으로 다듬어. 뜻은 유지하고 길이는 원래의 1.5배를 넘기지 마.'
    : '제목과 보드의 맥락을 바탕으로 이 셸의 본문 초안을 2~4문장으로 써.');
  A.summarize = (id) => rewriteBody(id, '하위 셸들의 내용을 종합해 이 셸의 본문을 2~4문장 요약으로 새로 써.');

  const TABLE_ASK = '이 내용에서 비교하거나 수치·조건이 나열된 부분을 마크다운 표(| 머리글 | … | 다음 줄 | --- | … |)로 정리해. ' +
    '값과 단위는 원문 그대로 옮기고 없는 값을 지어내지 마. 표로 옮긴 문장은 빼고, 표 앞뒤에는 꼭 필요한 문장만 남겨.';
  A.openShellMenu = (id, anchor) => {
    const s = S.get(id);
    if (S.isImage(s)) {
      SW.ui.openMenu(anchor, [{ heading: 'AI로 그림 읽기' },
        { label: '내용을 셸로 정리하기', meta: '필기·도표', act: () => A.readImage(id) },
        { label: s.body.trim() ? '설명 다시 쓰기' : '설명 써 주기', act: () => A.caption(id) }]);
      return;
    }
    if (S.isText(s)) {
      SW.ui.openMenu(anchor, [{ heading: 'AI로 다듬기' },
        { label: '문장 다듬기', act: () => rewriteBody(id, '이 메모를 더 명확한 문장으로 다듬어. 목록이면 목록 형태를 유지하고, 뜻은 바꾸지 마.') },
        { label: '목록으로 정리하기', act: () => rewriteBody(id, '이 메모의 핵심을 "- " 글머리표 목록 3~6개로 정리해.') },
        { label: '표로 정리하기', act: () => rewriteBody(id, TABLE_ASK) },
        { label: '이어서 쓰기', act: () => rewriteBody(id, '이 메모를 그대로 두고 뒤에 자연스럽게 이어지는 내용을 2~3문장 덧붙인 전체 글을 써.') }]);
      return;
    }
    // thinking prompts first: the AI asks, the student answers
    const items = [
      { heading: '생각 키우기' },
      { label: '스스로 물어볼 질문', meta: '추천', act: () => A.questions(id) },
      { label: '반론 들어 보기', act: () => A.counter(id) },
      { label: '하위 아이디어 펼치기', act: () => A.expand(id) },
      '-',
      { heading: '글 다듬기' },
      { label: s.body.trim() ? '본문 다듬기' : '본문 초안 쓰기', act: () => A.refine(id) },
    ];
    if (s.children.length) items.push({ label: '하위 내용으로 본문 요약', act: () => A.summarize(id) });
    if (s.body.trim()) items.push({ label: '본문을 표로 정리', act: () => rewriteBody(id, TABLE_ASK) });
    SW.ui.openMenu(anchor, items);
  };

  /* ---------- board actions ---------- */
  A.organize = async () => {
    if (!ensure()) return;
    if (S.count() < 3) { SW.ui.toast('셸이 3개 이상 있어야 묶을 수 있어요.'); return; }
    const btn = $('#organizeBtn'); btn.disabled = true; const label = btn.querySelector('.label'); const old = label.textContent; label.textContent = '정리하는 중…';
    try {
      const res = await A.sample.json(
        '너는 흩어진 생각을 구조로 묶는 편집자야. ' + LANG + '\n아래는 캔버스에 놓인 아이디어 셸이야. 위치(x,y)가 가까운 셸은 관련 있을 가능성이 높아.\n\n' +
        '목표: 관련된 셸끼리 묶어 계층(트리)을 만든다. 필요하면 묶음을 대표하는 새 상위 셸을 만든다.\n규칙:\n' +
        '- 모든 기존 셸 id를 정확히 한 번씩 쓴다. 기존 셸의 제목과 본문은 바꾸지 않는다.\n' +
        '- 이미 잘 묶인 하위 구조는 가급적 유지한다.\n' +
        '- 새 셸은 {"new": true, "title": "...", "body": "한 문장 설명", "children": [...]} 형태로, 최대 5개.\n' +
        '- 최상위 묶음은 2~6개.\n\n' +
        'JSON만 답해: {"tree": [{"id": "기존id", "children": [ ... ]}, {"new": true, "title": "...", "body": "...", "children": [{"id": "..."}]}], "summary": "무엇을 어떻게 묶었는지 한 문장"}\n\n' +
        A.outline());
      if (!res || !Array.isArray(res.tree)) throw { code: 'invalid_json' };
      if (!(await previewTree(res.tree, res.summary))) { SW.ui.toast('구조화를 취소했어요. 보드는 그대로예요'); return; }
      applyTree(res.tree);
      SW.ui.toast(res.summary ? clean(res.summary, 140) : '셸을 묶었어요', '되돌리기', S.undo);
      A.log('bot', '구조화 결과: ' + (res.summary || '셸을 묶었어요') + '\n마음에 들지 않으면 되돌리기(Ctrl+Z)를 누르세요.');
    } catch (e) { fail(e); } finally { btn.disabled = false; label.textContent = old; }
  };

  /* show the proposed structure and wait for the student's decision; resolves true only on "적용" */
  function previewTree(tree, summary) {
    return new Promise((resolve) => {
      const seen = new Set(); let fresh = 0, moved = 0;
      const list = (nodes, parentId, depth) => {
        const ul = document.createElement('ul');
        nodes.forEach((n) => {
          const li = document.createElement('li');
          if (n && n.new) {
            fresh++;
            const b = document.createElement('span'); b.className = 'tp-badge new'; b.textContent = '새 셸';
            li.append(b, document.createTextNode(' ' + clean(n.title || '새 묶음', 80)));
          } else if (n && typeof n.id === 'string' && S.get(n.id) && !seen.has(n.id)) {
            seen.add(n.id);
            const s = S.get(n.id), was = s.parent || null;
            li.append(document.createTextNode(S.label(s)));
            if (was !== (parentId || null)) { moved++; const b = document.createElement('span'); b.className = 'tp-badge moved'; b.textContent = '옮겨짐'; li.append(' ', b); }
          } else return;
          if (Array.isArray(n.children) && n.children.length && depth < 6) li.append(list(n.children, n.new ? '__new' : n.id, depth + 1));
          ul.append(li);
        });
        return ul;
      };
      const box = document.createElement('div'); box.className = 'tree-preview'; box.append(list(tree, null, 0));
      SW.ui.modal({
        title: 'AI가 제안한 구조',
        text: (summary ? clean(summary, 200) + ' ' : '') + '새 셸 ' + fresh + '개, 자리가 바뀌는 항목 ' + moved + '개. 적용한 뒤에도 Ctrl+Z로 되돌릴 수 있어요.',
        node: box, onClose: () => resolve(false),
        actions: [{ label: '취소', act: () => { resolve(false); } }, { label: '적용', cls: 'primary', act: () => { resolve(true); } }],
      });
    });
  }

  function applyTree(tree) {
    const B = S.board;
    const orig = {}; Object.values(B.shells).forEach((s) => { orig[s.id] = { parent: s.parent, kids: s.children.slice() }; });
    const rootPos = {}; Object.keys(B.shells).forEach((id) => { const r = S.rootOf(id); rootPos[id] = { x: r.x, y: r.y }; });
    const order = []; S.walk((s) => order.push(s.id));
    S.checkpoint();
    const used = new Set(), fresh = [], placedRoots = [];
    const build = (node, parent) => {
      let id;
      if (node && node.new) {
        if (fresh.length >= 6) return null;
        const s = S.newShell({ title: clean(node.title || '새 묶음', 80), body: clean(node.body, 400), ai: true });
        B.shells[s.id] = s; id = s.id; fresh.push(id);
      } else if (node && typeof node.id === 'string' && B.shells[node.id] && !fresh.includes(node.id) && !used.has(node.id)) id = node.id;
      else return null;
      used.add(id);
      const s = B.shells[id]; s.parent = parent; s.children = [];
      (Array.isArray(node.children) ? node.children : []).forEach((c) => { const cid = build(c, id); if (cid) s.children.push(cid); });
      return id;
    };
    const roots = tree.map((n) => build(n, null)).filter(Boolean);
    order.filter((id) => !used.has(id)).forEach((id) => {
      const o = orig[id], s = B.shells[id]; s.children = s.children || [];
      if (o.parent && used.has(o.parent)) { s.parent = o.parent; B.shells[o.parent].children.push(id); }
      else { s.parent = null; roots.push(id); }
      used.add(id);
    });
    roots.forEach((id) => {
      const s = B.shells[id];
      if (fresh.includes(id)) {
        const pts = S.descendants(id).filter((d) => rootPos[d]).map((d) => rootPos[d]);
        const p = pts.length ? pts.reduce((a, b) => ({ x: a.x + b.x / pts.length, y: a.y + b.y / pts.length }), { x: 0, y: 0 }) : SW.canvas.center();
        s.x = Math.round(p.x); s.y = Math.round(p.y); placedRoots.push(id);
      } else if (orig[id].parent) { s.x = rootPos[id].x + 40; s.y = rootPos[id].y + 40; placedRoots.push(id); }
    });
    B.roots = roots;
    S.changed(); SW.canvas.tidy(placedRoots);
  }

  A.fill = async () => {
    if (!ensure()) return;
    const empty = Object.values(S.board.shells).filter((s) => !s.body.trim() && s.title.trim());
    if (!empty.length) { SW.ui.toast('본문이 비어 있는 셸이 없어요.'); return; }
    const msg = A.log('bot thinking', '빈 본문 ' + empty.length + '개를 채우는 중…');
    try {
      const r = await A.sample.json(
        '너는 생각을 글로 풀어 주는 공동 작업자야. ' + LANG + '\n\n전체 보드:\n' + A.outline() +
        '\n\n본문이 비어 있는 셸: ' + empty.slice(0, 30).map((s) => '[' + s.id + '] ' + s.title).join(', ') +
        '\n\n각 셸의 제목과 주변 맥락에 맞는 본문을 1~3문장으로 써.\nJSON 객체만 답해: {"셸id": "본문", ...}');
      if (!r || typeof r !== 'object') throw { code: 'invalid_json' };
      S.checkpoint(); let n = 0;
      Object.keys(r).forEach((k) => { const id = k.replace(/[[\]]/g, ''); const s = S.get(id); if (s && !s.body.trim() && r[k]) { s.body = clean(r[k], 1200); n++; } });
      S.changed();
      msg.className = 'msg bot'; msg.textContent = n + '개 셸의 본문을 채웠어요. 되돌리려면 Ctrl+Z.';
      SW.ui.toast(n + '개 본문을 채웠어요', '되돌리기', S.undo);
    } catch (e) { msg.className = 'msg bot err'; msg.textContent = A.errText(e); fail(e); }
  };

  /* ---------- photo → shells ---------- */
  function cleanTree(n, depth, budget) {
    if (!n || typeof n !== 'object' || budget.left <= 0) return null;
    budget.left--;
    const out = { title: clean(n.title || '', 140), body: clean(n.body || '', 2000), ai: true, children: [] };
    if (depth < 4 && Array.isArray(n.children)) n.children.forEach((c) => { const x = cleanTree(c, depth + 1, budget); if (x) out.children.push(x); });
    return out.title || out.body || out.children.length ? out : null;
  }
  /* a small JPEG of the photo (longest side 420px) so the source can be shown later without storing the original */
  async function thumbOf(file) {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 420 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    if (bmp.close) bmp.close();
    return cv.toDataURL('image/jpeg', 0.62);
  }
  A.photo = async (files, at) => {
    if (!ensure()) return;
    const lim = await A.sample.limits().catch(() => null);
    if (!lim || !lim.images) { SW.ui.toast('이 화면에서는 사진을 AI에게 보낼 수 없어요.'); return; }
    const okTypes = lim.images.mediaTypes || [];
    const imgs = [...files].filter((f) => okTypes.includes(f.type)).slice(0, lim.images.maxCount || 1);
    if (!imgs.length) { SW.ui.toast('JPG, PNG, WebP, GIF 사진만 읽을 수 있어요.'); return; }
    SW.main.setView('canvas');
    const pos = at || SW.canvas.center();
    const card = document.createElement('div'); card.className = 'photo-pending';
    card.style.left = Math.round(pos.x - 20) + 'px'; card.style.top = Math.round(pos.y - 14) + 'px';
    const url = URL.createObjectURL(imgs[0]); const img = document.createElement('img'); img.src = url; img.alt = '';
    const txt = document.createElement('div'); const st = document.createElement('strong'); st.textContent = '사진 읽는 중…';
    txt.append(st, document.createTextNode(imgs.length > 1 ? imgs.length + '장의 필기와 도표를 셸로 바꾸고 있어요' : '필기와 도표를 셸로 바꾸고 있어요'));
    card.append(img, txt); $('#ghostLayer').append(card);
    if (SW.motion.on()) card.animate([{ transform: 'scale(.92)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: 'ease-out' });
    try {
      const r = await A.sample.json(
        ['너는 과학 탐구(R&E)를 하는 고등학생의 자료 정리를 돕는 조수야. ' + LANG,
          '첨부한 사진(공책 필기, 칠판, 교과서, 실험 기록, 논문 일부 등)을 읽고 내용을 셸 구조로 정리해.',
          '규칙:',
          '- 사진에 실제로 있는 내용만 쓰고, 읽기 어려운 부분은 "(판독 어려움)"이라고 적어.',
          '- 수식, 단위, 수치, 표의 값은 그대로 옮겨.',
          '- 제목은 25자 이내, 본문은 핵심만.',
          '- 깊이는 3단계까지, 셸은 모두 합쳐 25개 이하. 사진이 여러 장이면 하나의 구조로 합쳐.',
          '- 교재나 노트의 쪽 번호가 보이면 "page"에 적고, 안 보이면 빈 문자열로 둬.',
        ].join(String.fromCharCode(10)) + String.fromCharCode(10) +
        'JSON만 답해: {"title": "사진 전체를 대표하는 제목", "body": "한두 문장 요약", "page": "", "children": [{"title": "...", "body": "...", "children": []}]}',
        { images: imgs });
      const tree = cleanTree(Array.isArray(r) ? { title: '사진 정리', children: r } : r, 0, { left: 40 });
      if (!tree) throw { code: 'empty_completion' };
      const thumb = await thumbOf(imgs[0]).catch(() => '');
      card.remove();
      S.checkpoint(); const made = S.insertTrees([tree], pos.x - 20, pos.y - 14);
      // where this came from: kept on the shell so the student can always check the original
      made[0].src = { kind: 'photo', name: imgs.map((f) => f.name).join(', ').slice(0, 120), date: imgs[0].lastModified || Date.now(), page: r && !Array.isArray(r) && r.page ? String(r.page).slice(0, 20) : '', thumb };
      S.changed(); SW.canvas.tidy(made.map((m) => m.id));
      SW.ui.toast('사진을 셸 ' + (1 + S.descendants(made[0].id).length) + '개로 정리했어요', '되돌리기', S.undo);
    } catch (e) { fail(e); } finally { card.remove(); URL.revokeObjectURL(url); }
  };

  /* ---------- a picture already on the board ---------- */
  A.readImage = async (id) => {
    const s = S.get(id); if (!s || !ensure()) return;
    const blob = await SW.images.blob(s.img); if (!blob) { SW.ui.toast('그림을 불러오지 못했어요'); return; }
    const el = SW.canvas.els.get(S.rootOf(id).id), r = el ? SW.canvas.worldRect(el) : null;
    A.photo([new File([blob], (s.body.trim().split(NL)[0] || '보드 그림').slice(0, 40) + (blob.type === 'image/png' ? '.png' : '.jpg'), { type: blob.type })],
      r ? { x: r.x + r.w + 60, y: r.y } : null);
  };
  A.caption = (id) => withShell(id, async (s) => {
    const lim = await A.sample.limits().catch(() => null);
    if (!lim || !lim.images) { SW.ui.toast('이 화면에서는 그림을 AI에게 보낼 수 없어요.'); return; }
    const blob = await SW.images.blob(s.img); if (!blob) throw { code: 'empty_completion' };
    const { text } = await A.sample('너는 연구 보고서의 그림 설명(캡션)을 쓰는 편집자야. ' + LANG + NL +
      '보드의 맥락:' + NL + A.outline().slice(0, 20000) + NL + NL +
      '첨부한 그림이 무엇을 보여 주는지 1~2문장의 캡션으로 써. 보이는 수치나 축 이름이 있으면 그대로 써. 캡션 문장만 답해.', { images: [blob] });
    S.checkpoint(); s.body = clean(text.trim().replace(/^["'“]|["'”]$/g, ''), 400); S.changed();
    SW.ui.toast('그림 설명을 썼어요', '되돌리기', S.undo);
  });

  /* ---------- text or a Markdown file → shells, relation lines and tables ----------
   * The AI never retypes the text: it gets numbered blocks and answers with a structure that points at them,
   * so every sentence of the original lands on the board exactly as written. */
  const NL = String.fromCharCode(10);
  function splitBlocks(text) {
    const lines = String(text || '').replace(/\r/g, '').split(NL), out = [];
    let cur = null;
    const flush = () => { if (cur && cur.lines.join('').trim()) out.push({ kind: cur.kind, text: cur.lines.join(NL).replace(/\s+$/, '') }); cur = null; };
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (SW.isTableStart(lines, i)) { flush(); const j = SW.tableEnd(lines, i); out.push({ kind: 'table', text: lines.slice(i, j).join(NL) }); i = j - 1; continue; }
      const h = /^(#{1,6})\s+(.*)$/.exec(l);
      if (h) { flush(); out.push({ kind: 'h', level: h[1].length, text: h[2].trim() }); continue; }
      if (!l.trim()) { flush(); continue; }
      const list = /^\s*(?:[-*•]|\d+[.)])\s+/.test(l);
      if (cur && cur.kind === 'list' && (list || /^\s{2,}\S/.test(l))) { cur.lines.push(l); continue; }
      if (list) { flush(); cur = { kind: 'list', lines: [l] }; continue; }
      if (cur && cur.kind === 'p') { cur.lines.push(l); continue; }
      flush(); cur = { kind: 'p', lines: [l] };
    }
    flush();
    out.forEach((b, i) => { b.id = 'b' + (i + 1); b.index = i; });
    return out;
  }
  const KIND_LABEL = { h: '제목', p: '문단', list: '목록', table: '표' };
  const mdCell = (v) => String(v == null ? '' : v).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim();
  const tableRows = (t) => {
    if (!t || !Array.isArray(t.header) || !t.header.length || !Array.isArray(t.rows)) return null;
    const rows = t.rows.filter(Array.isArray).slice(0, 30);
    return rows.length ? [t.header.slice(0, 8)].concat(rows.map((r) => r.slice(0, 8))) : null;
  };
  A.tableMd = (rows) => {
    const n = Math.max(...rows.map((r) => r.length));
    const line = (r) => '| ' + Array.from({ length: n }, (_, i) => mdCell(r[i])).join(' | ') + ' |';
    return [line(rows[0]), '| ' + Array(n).fill('---').join(' | ') + ' |'].concat(rows.slice(1).map(line)).join(NL);
  };
  function assemble(res, blocks) {
    const byId = new Map(blocks.map((b) => [b.id, b])), used = new Map(), keys = new Map(), all = [];
    let tables = 0;
    const ref = (x) => byId.get(String(x).replace(/[[\]\s]/g, ''));
    const build = (n, depth) => {
      if (!n || typeof n !== 'object' || all.length >= 90) return null;
      const node = { title: clean(n.title || '', 80), parts: [], table: null, children: [] };
      const rows = n.table && tables < 8 ? tableRows(n.table) : null;
      if (rows) { // the table takes the place of the blocks it was made from, but only blocks that really hold its values
        node.table = rows; tables++;
        const vals = [...new Set(rows.slice(1).flat().map((v) => String(v == null ? '' : v).trim()).filter((v) => v.length > 0 && v.length < 40))];
        (Array.isArray(n.table.from) ? n.table.from : []).forEach((x) => {
          const b = ref(x); if (!b || used.has(b.id) || b.kind === 'h') return;
          const hits = vals.filter((v) => b.text.includes(v)).length;
          if (hits >= Math.min(2, vals.length)) used.set(b.id, node);
        });
      }
      (Array.isArray(n.use) ? n.use : []).forEach((x) => {
        const b = ref(x); if (!b || used.has(b.id)) return;
        used.set(b.id, node);
        if (b.kind === 'h') { if (!node.title) node.title = clean(b.text, 80); } else node.parts.push(b);
      });
      if (depth < 4 && Array.isArray(n.children)) n.children.forEach((c) => { const k = build(c, depth + 1); if (k) node.children.push(k); });
      if (!node.title) node.title = node.parts.length ? clean(node.parts[0].text.split(NL)[0].replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ''), 30) : '(제목 없음)';
      all.push(node); if (n.key != null) keys.set(String(n.key), node);
      return node;
    };
    const roots = (Array.isArray(res && res.shells) ? res.shells : []).map((n) => build(n, 0)).filter(Boolean);
    if (!roots.length) throw { code: 'invalid_json' };
    // anything the AI skipped joins the shell that holds the text just before it
    blocks.filter((b) => b.kind !== 'h' && !used.has(b.id)).forEach((b) => {
      let host = null; for (let i = b.index - 1; i >= 0 && !host; i--) host = used.get(blocks[i].id) || null;
      host = host || roots[0]; host.parts.push(b); used.set(b.id, host);
    });
    const finish = (node) => {
      node.parts.sort((a, b) => a.index - b.index);
      node.body = node.parts.map((p) => p.text).join(NL + NL);
      if (node.table) node.body = (node.body ? node.body + NL + NL : '') + A.tableMd(node.table);
      node.children.forEach(finish);
    };
    roots.forEach(finish);
    const links = (Array.isArray(res.links) ? res.links : []).map((l) => ({ from: keys.get(String(l && l.from)), to: keys.get(String(l && l.to)), label: clean(l && l.label || '', 14) }))
      .filter((l) => l.from && l.to && l.from !== l.to).slice(0, 16);
    return { roots, links, tables, count: all.length, title: clean(res.title || '', 60), summary: clean(res.summary || '', 200) };
  }
  function previewImport(r) {
    return new Promise((resolve) => {
      const box = document.createElement('div'); box.className = 'tree-preview';
      const list = (nodes) => {
        const ul = document.createElement('ul');
        nodes.forEach((n) => {
          const li = document.createElement('li'); li.append(document.createTextNode(n.title));
          if (n.table) { const b = document.createElement('span'); b.className = 'tp-badge table'; b.textContent = '표'; li.append(' ', b); }
          const nLink = r.links.filter((l) => l.from === n || l.to === n).length;
          if (nLink) { const b = document.createElement('span'); b.className = 'tp-badge link'; b.textContent = '관계 ' + nLink; li.append(' ', b); }
          if (n.children.length) li.append(list(n.children));
          ul.append(li);
        });
        return ul;
      };
      box.append(list(r.roots));
      if (r.links.length) {
        const h = document.createElement('div'); h.className = 'tp-head'; h.textContent = '관계선'; box.append(h);
        const ul = document.createElement('ul'); ul.className = 'tp-links';
        r.links.forEach((l) => { const li = document.createElement('li'); li.textContent = l.from.title + ' → ' + l.to.title + (l.label ? ' (' + l.label + ')' : ''); ul.append(li); });
        box.append(ul);
      }
      SW.ui.modal({
        title: 'AI가 만든 구조', node: box, wide: true,
        text: (r.summary ? r.summary + ' ' : '') + '셸 ' + r.count + '개, 관계선 ' + r.links.length + '개, 표 ' + r.tables + '개. 원문 문장은 그대로 옮겨요. 놓은 뒤에도 Ctrl+Z로 되돌릴 수 있어요.',
        onClose: () => resolve(false),
        actions: [{ label: '취소', act: () => { resolve(false); } }, { label: '캔버스에 놓기', cls: 'primary', act: () => { resolve(true); } }],
      });
    });
  }
  function placeImport(r) {
    const C = SW.canvas, origin = C.freeSpot();
    S.checkpoint();
    if (!S.count() && r.title) { S.board.name = r.title; SW.main.showBoardName(); }
    const hasTable = (n) => !!n.table || n.children.some(hasTable);
    const add = (n, parent) => {
      const s = S.add(parent ? { title: n.title, body: n.body } : { title: n.title, body: n.body, x: origin.x, y: origin.y, w: hasTable(n) ? 480 : 360 }, parent);
      n.id = s.id; n.children.forEach((c) => add(c, s.id)); return s;
    };
    const made = r.roots.map((n) => add(n, null).id);
    r.links.forEach((l) => S.board.arrows.push(Object.assign({ id: SW.uid('a'), from: l.from.id, to: l.to.id }, l.label ? { label: l.label } : {})));
    S.changed();
    const cols = made.length <= 3 ? made.length : made.length === 4 ? 2 : 3;
    requestAnimationFrame(() => {
      C.layoutRows(made, origin, cols); C.selectMany(made); C.frameIds(made);
    });
    SW.ui.toast('셸 ' + r.count + '개, 관계선 ' + r.links.length + '개로 펼쳤어요', '되돌리기', S.undo);
  }
  A.importText = async (text, name) => {
    if (!ensure()) return false;
    const blocks = splitBlocks(text);
    if (!blocks.some((b) => b.kind !== 'h')) { SW.ui.toast('구조로 바꿀 글이 없어요.'); return false; }
    const lim = await A.sample.limits().catch(() => null), cap = (lim && lim.maxPromptBytes) || 262144;
    const encLen = (t) => new TextEncoder().encode(t).length;
    let budget = cap - 9000, shown = 0; const lines = [];
    for (const b of blocks) {
      const line = '[' + b.id + '] (' + KIND_LABEL[b.kind] + (b.kind === 'h' ? ' ' + b.level + '단계' : '') + ') ' + b.text;
      const n = encLen(line) + 1; if (n > budget) break;
      budget -= n; lines.push(line); shown++;
    }
    const part = shown < blocks.length ? blocks.slice(0, shown) : blocks;
    if (shown < blocks.length) SW.ui.toast('글이 길어서 앞부분(블록 ' + shown + '개)만 구조로 바꿔요. 나머지는 나눠서 넣어 주세요.');
    SW.main.setView('canvas');
    const card = document.createElement('div'); card.className = 'photo-pending doc-pending';
    const pos = SW.canvas.center(); card.style.left = Math.round(pos.x - 150) + 'px'; card.style.top = Math.round(pos.y - 40) + 'px';
    const ic = document.createElement('div'); ic.className = 'doc-ic'; ic.innerHTML = '<svg aria-hidden="true"><use href="#i-doc"/></svg>';
    const txt = document.createElement('div'); const st = document.createElement('strong'); st.textContent = '글을 읽는 중…';
    txt.append(st, document.createTextNode((name ? name + ' · ' : '') + '제목·관계·표를 찾고 있어요')); card.append(ic, txt);
    $('#ghostLayer').append(card);
    try {
      const res = await A.sample.json([
        '너는 긴 글을 Shellwork 보드(셸 = 제목 + 본문, 셸 안에 셸)로 구조화하는 편집자야. ' + LANG,
        '아래 글은 번호 붙은 블록으로 나뉘어 있어. 블록 내용을 다시 쓰지 말고, 블록 id로만 가리켜서 구조를 만들어.',
        '',
        '규칙:',
        '- 문단·목록·표 블록은 모두 정확히 한 번씩 어느 셸의 "use"에 넣어. 원문 순서를 되도록 지켜.',
        '- 제목 블록은 그 내용을 셸 제목으로 쓰고 "use"에도 넣어. 원문에 제목이 없으면 내용을 대표하는 제목(25자 이내, 명사형)을 지어.',
        '- 계층은 4단계까지, 최상위 셸은 2~7개. 셸 하나에 블록이 너무 많으면 하위 셸로 나눠.',
        '- "table": 원문에 여러 대상을 비교하거나 수치·조건이 나열된 부분이 있을 때만 만들어. 값과 단위는 원문 그대로 옮기고 새 숫자를 지어내지 마. "from"에는 표가 대신하는 블록 id를 넣어(그 블록은 use에 넣지 마). 원문에 이미 있는 표 블록은 use로만 써. 표는 많아야 6개.',
        '- "links": 셸 사이의 의미 있는 관계만 화살표로 이어. 원인→결과, 근거→주장, 문제→해결, 단계의 순서, 비교, 반박 같은 것. 부모와 자식 사이는 잇지 마. 많아야 12개, label은 2~6자(예: 원인, 근거, 다음 단계, 반박, 비교).',
        '- "key"는 셸마다 다른 짧은 문자열(s1, s2 …).',
        '',
        'JSON만 답해: {"title": "글 전체 제목", "summary": "어떻게 나눴는지 한 문장", "shells": [{"key": "s1", "title": "...", "use": ["b1", "b2"], "table": {"header": ["..."], "rows": [["..."]], "from": ["b3"]}, "children": [ ... ]}], "links": [{"from": "s1", "to": "s2", "label": "원인"}]}',
        '("table"은 필요할 때만 넣어.)',
        '',
        '글' + (name ? ' (' + name + ')' : '') + ':',
        lines.join(NL),
      ].join(NL), { modelTier: 'default' });
      card.remove();
      const r = assemble(res, part);
      if (!(await previewImport(r))) { SW.ui.toast('취소했어요. 보드는 그대로예요'); return false; }
      placeImport(r);
      return true;
    } catch (e) { fail(e); return false; } finally { card.remove(); }
  };

  /* ---------- the board → a written piece (Markdown, streamed) ---------- */
  A.fullOutline = () => {
    const lines = [], cap = 150000; let size = 0;
    S.walk((s, d) => {
      let l;
      if (S.isImage(s)) l = '[[그림:' + s.img + ']] 그림 설명: ' + (s.body.trim().replace(/\s*\n\s*/g, ' ') || '없음');
      else if (S.isText(s)) l = s.body.trim();
      else l = '#'.repeat(Math.min(6, S.level(s.id) + 1)) + ' ' + (s.title.trim() || '(제목 없음)') + (s.body.trim() ? NL + s.body.trim() : '');
      if (!l || size > cap) return;
      size += l.length; lines.push(l, '');
    });
    const rel = S.relations();
    if (rel.length) lines.push('관계(화살표): ' + rel.map((r) => r.text).join(' / '));
    return '# ' + S.board.name + NL + NL + lines.join(NL);
  };
  const WRITE_KINDS = {
    report: ['연구 보고서', '서론(연구 배경·목적·질문), 이론적 배경, 연구 방법, 결과, 논의, 결론 순서의 R&E 보고서. 보드에 있는 내용만 근거로 쓰고, 빠진 부분은 지어내지 말고 "(보충 필요: 무엇)"이라고 표시해.'],
    essay: ['설명하는 글', '보드의 구조를 따라 자연스럽게 이어지는 문단으로 풀어 쓴 설명문. 각 큰 셸이 한 절이 되게.'],
    summary: ['한 쪽 요약', 'A4 한 쪽 분량의 요약. 핵심 질문, 방법, 주요 결과, 의미를 짧은 절로.'],
    script: ['발표 대본', '셸 순서를 따라 발표자가 그대로 읽을 수 있는 대본. 슬라이드가 바뀌는 곳마다 ## 제목을 달고, 말투는 "~습니다".'],
  };
  A.write = async (kind, extra, onText, signal) => {
    if (!ensure()) return null;
    const k = WRITE_KINDS[kind] || WRITE_KINDS.report;
    const { text, truncated } = await A.sample([
      '너는 과학 탐구(R&E)를 하는 고등학생의 글쓰기를 돕는 편집자야. ' + LANG,
      '아래 보드(셸 트리)를 바탕으로 "' + k[0] + '"을(를) 써. ' + k[1],
      '',
      '형식:',
      '- 마크다운. 첫 줄은 "# 문서 제목", 큰 절은 ##, 작은 절은 ###.',
      '- 비교나 수치가 있으면 마크다운 표로. 값은 보드에 있는 그대로.',
      '- 보드의 그림을 넣을 자리에는 그 줄에 [[그림:그림id]]만 따로 써. 보드에 있는 그림 id만 써.',
      '- 보드에 없는 사실, 수치, 인용, 참고 문헌을 지어내지 마.',
      extra ? '- 추가 요청: ' + extra : '',
      '',
      '보드:',
      A.fullOutline(),
    ].join(NL), { onText, signal, cache: false });
    return text + (truncated ? NL + NL + '(글이 길어 중간에 끊겼어요. 분량을 줄여 다시 써 보세요.)' : '');
  };

  /* ---------- the board → slides (a deck description for SW.pptx) ---------- */
  const DECK_LEN = { short: '6~8장', normal: '10~14장', long: '15~20장' };
  A.deck = async (len, extra) => {
    if (!ensure()) return null;
    const imgs = new Set(S.imageIds());
    const r = await A.sample.json([
      '너는 고등학생의 연구 발표 자료를 만드는 발표 디자이너야. ' + LANG,
      '아래 보드로 발표 슬라이드 ' + (DECK_LEN[len] || DECK_LEN.normal) + '를 구성해.',
      '',
      '규칙:',
      '- 첫 장은 "cover"(제목, 부제), 마지막 장은 "closing". 큰 단락이 바뀌는 곳에는 "section"을 써도 돼.',
      '- "bullets": 요점 3~5개, 한 줄에 40자 이내의 개조식. 필요하면 {"text": "...", "sub": ["..."]}로 하위 요점 2개까지.',
      '- "table": 보드에 비교나 수치가 있을 때만. 값은 보드 그대로, 행은 8개 이하.',
      '- "image": 보드에 있는 그림 id만 "image"에 써. 그림 옆에 요점 0~3개, "caption"에 짧은 설명.',
      '- 모든 장에 "notes": 발표자가 말할 대본 2~4문장("~습니다" 말투, 슬라이드 글을 그대로 읽지 말 것).',
      '- 보드에 없는 사실이나 수치를 지어내지 마.',
      extra ? '- 추가 요청: ' + extra : '',
      '',
      'JSON만 답해: {"title": "...", "subtitle": "...", "slides": [{"type": "cover|section|bullets|table|image|closing", "title": "...", "subtitle": "", "bullets": ["..."], "table": {"header": ["..."], "rows": [["..."]]}, "image": "그림id", "caption": "", "notes": "..."}]}',
      '',
      '보드:',
      A.fullOutline(),
    ].join(NL), { modelTier: 'default' });
    if (!r || !Array.isArray(r.slides) || !r.slides.length) throw { code: 'invalid_json' };
    const TYPES = ['cover', 'section', 'bullets', 'table', 'image', 'closing'];
    const slides = r.slides.slice(0, 30).map((d) => {
      if (!d || typeof d !== 'object') return null;
      const o = { type: TYPES.includes(d.type) ? d.type : 'bullets', title: clean(d.title || '', 90), subtitle: clean(d.subtitle || '', 140), notes: clean(d.notes || '', 1200) };
      o.bullets = (Array.isArray(d.bullets) ? d.bullets : []).slice(0, 8).map((b) => (typeof b === 'string' ? { text: clean(b, 120) } : b && b.text ? { text: clean(b.text, 120), sub: (Array.isArray(b.sub) ? b.sub : []).slice(0, 4).map((x) => clean(x, 100)) } : null)).filter(Boolean);
      if (o.type === 'table') { const rows = tableRows(d.table); if (rows) o.table = rows; else o.type = 'bullets'; }
      if (o.type === 'image') { const id = String(d.image || '').replace(/^\[\[그림:|\]\]$/g, ''); if (imgs.has(id)) { o.image = id; o.caption = clean(d.caption || '', 160); } else o.type = 'bullets'; }
      return o;
    }).filter(Boolean);
    return { title: clean(r.title || S.board.name, 90), subtitle: clean(r.subtitle || '', 140), slides };
  };

  /* ---------- presentation script ---------- */
  A.speakerNotes = async () => {
    if (!ensure()) return null;
    const r = await A.sample.json(
      ['너는 고등학생의 연구 발표를 돕는 발표 코치야. ' + LANG, '', '보드:', A.outline(), '', ''].join(String.fromCharCode(10)) +
      '발표 모드에서 셸을 문서 순서대로 한 화면씩 보여 줄 거야. 셸마다 발표자가 말할 대본을 1~3문장의 자연스러운 발표 말투(~습니다)로 써. ' +
      '셸 내용을 그대로 읽지 말고 앞뒤 흐름이 이어지게 해. JSON 객체만 답해: {"셸id": "대본", ...}');
    if (!r || typeof r !== 'object') throw { code: 'invalid_json' };
    return r;
  };

  A.critique = () => A.ask('이 보드의 논리 흐름을 검토해 줘. 빠진 근거, 서로 맞지 않는 부분, 다음에 해야 할 일을 항목별로 짧게 짚어 줘.');

  /* ---------- chat panel ---------- */
  A.log = (cls, text) => {
    const log = $('#aiLog'); const empty = log.querySelector('.ai-empty'); if (empty) empty.remove();
    const m = document.createElement('div'); m.className = 'msg ' + cls; m.textContent = text; log.append(m);
    log.scrollTop = log.scrollHeight; return m;
  };
  const markAi = (n) => { n.ai = true; (n.children || []).forEach(markAi); return n; };
  function answerTrees(text, q) {
    let trees = S.parseText(text);
    if (trees.length > 1) trees = [{ title: clean(q || 'AI 답변', 40), body: '', children: trees }];
    return trees.map(markAi);
  }
  function finishBot(m, text, q) {
    m.className = 'msg bot'; m.textContent = text; m.draggable = true;
    m.addEventListener('dragstart', (e) => { e.dataTransfer.setData(MIME, JSON.stringify(answerTrees(text, q))); e.dataTransfer.setData('text/plain', text); e.dataTransfer.effectAllowed = 'copy'; });
    const bar = document.createElement('div'); bar.className = 'msg-actions';
    const add = document.createElement('button'); add.className = 'btn'; add.textContent = '셸로 추가';
    add.onclick = () => {
      S.checkpoint(); const c = SW.canvas.center(); const made = S.insertTrees(answerTrees(text, q), c.x - 140, c.y - 80); S.changed();
      SW.canvas.tidy(made.map((x) => x.id)); SW.main.setView('canvas'); SW.canvas.reveal(made[0].id);
      SW.ui.toast('답변을 셸로 추가했어요', '되돌리기', S.undo);
    };
    const copy = document.createElement('button'); copy.className = 'btn'; copy.textContent = '복사';
    copy.onclick = () => SW.ui.copy(text);
    const note = document.createElement('span'); note.className = 'drag-note'; note.textContent = '캔버스로 끌어 놓을 수도 있어요';
    bar.append(add, copy, note); m.append(bar);
  }

  A.ask = async (q) => {
    if (!ensure()) return;
    if (A.ctl) return;
    A.log('user', q);
    const m = A.log('bot thinking', '생각하는 중…');
    const picked = A.attached.filter((id) => S.get(id));
    const ctx = picked.length ? ['', '', '사용자가 이 질문과 함께 고른 내용(이것을 중심으로 답해):'].concat(picked.map((id) => {
      const out = []; const walk = (i, d) => { const s = S.get(i); out.push('  '.repeat(d) + '- ' + (S.isText(s) ? '' : s.title + ': ') + s.body.replace(/\s*\n+\s*/g, ' / ').slice(0, 1500)); s.children.forEach((c) => walk(c, d + 1)); };
      walk(id, 0); return out.join(String.fromCharCode(10));
    })).join(String.fromCharCode(10)) : '';
    A.attached = []; renderChips();
    A.turns.push({ role: 'user', content: q + ctx });
    const rules = '너는 Shellwork라는 생각 정리 캔버스의 AI 도우미야. ' + LANG + ' 아래 보드 내용을 근거로 짧고 구체적으로 답해. ' +
      '제목(#)과 목록(-)을 쓰면 답변이 그대로 셸 구조로 바뀌니, 구조가 있는 답은 그렇게 써. 셸 id는 답에 쓰지 마.\n\n현재 보드:\n' + A.outline();
    A.ctl = new AbortController(); setSending(true);
    try {
      const { text, truncated } = await A.sample([{ role: 'user', content: rules }, ...A.turns.slice(-12)], {
        cache: false, signal: A.ctl.signal,
        onText: ({ text }) => { m.className = 'msg bot'; m.textContent = text; $('#aiLog').scrollTop = 1e9; },
      });
      A.turns.push({ role: 'assistant', content: text });
      finishBot(m, text + (truncated ? '\n\n(답이 길어 중간에 끊겼어요)' : ''), q);
    } catch (e) {
      A.turns.pop();
      if (e && e.text) finishBot(m, e.text + '\n\n(중간에 멈췄어요)', q);
      else { m.className = 'msg bot err'; m.textContent = e && e.code === 'cancelled' ? '멈췄어요.' : A.errText(e); }
      fail(e);
    } finally { A.ctl = null; setSending(false); }
  };
  /* "AI에게 보내기": what is selected on the canvas rides along with the next question */
  A.attached = [];
  function renderChips() {
    const box = $('#aiChips'); if (!box) return;
    box.textContent = ''; box.hidden = !A.attached.length;
    A.attached.forEach((id) => {
      const s = S.get(id); if (!s) return;
      const c = document.createElement('span'); c.className = 'ctx-chip'; c.textContent = S.label(s);
      const x = document.createElement('button'); x.type = 'button'; x.textContent = '×'; x.setAttribute('aria-label', S.label(s) + ' 빼기');
      x.onclick = () => { A.attached = A.attached.filter((i) => i !== id); renderChips(); };
      c.append(x); box.append(c);
    });
  }
  A.attach = (ids) => {
    A.attached = [...new Set(A.attached.concat(ids))].filter((id) => S.get(id));
    $('#aiPanel').hidden = false; renderChips(); $('#aiInput').focus();
  };
  function setSending(on) { const b = $('#aiSend'); b.textContent = on ? '멈추기' : '보내기'; b.classList.toggle('primary', !on); }

  A.init = async () => {
    $('#aiForm').addEventListener('submit', (e) => {
      e.preventDefault();
      if (A.ctl) { A.ctl.abort(); return; }
      const box = $('#aiInput'); const q = box.value.trim(); if (!q) return;
      box.value = ''; A.ask(q);
    });
    $('#aiInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); $('#aiForm').requestSubmit(); }
    });
    document.querySelectorAll('[data-board-action]').forEach((b) => {
      b.addEventListener('click', () => { const a = b.dataset.boardAction; if (a === 'organize') A.organize(); else if (a === 'fill') A.fill(); else A.critique(); });
    });
    $('#organizeBtn').addEventListener('click', A.organize);
    $('#photoInput').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) A.photo(f); });
    try { A.sample = window.claude && typeof window.claude.use === 'function' ? await window.claude.use('sample') : null; } catch (e) { A.sample = null; }
    $('#aiOff').hidden = !!A.sample;
  };
})(window.SW);
