/* Shellwork — data model.
 * A board is a forest of nodes. A shell = heading (title) + paragraph (body) + children.
 * A text block (kind: 'text') is a loose piece of writing with no heading: notes dumped on the canvas
 * that later get wrapped into shells. Root nodes sit on the canvas at (x, y); nested ones live inside their parent.
 * The canvas and the document view are two renderings of this same tree. */
window.SW = window.SW || {};
(function (SW) {
  'use strict';

  const uid = (p) => p + Math.random().toString(36).slice(2, 7) + Date.now().toString(36).slice(-4);
  SW.uid = uid;

  const S = SW.store = { board: null, listeners: new Set(), undoStack: [], redoStack: [] };

  S.newShell = (f) => Object.assign(
    { id: uid('s'), title: '', body: '', parent: null, children: [], x: 0, y: 0, w: 300, collapsed: false, ai: false }, f);

  S.emptyBoard = (name) => ({
    id: uid('b'), name: name || '제목 없는 보드', shells: {}, roots: [], arrows: [], sections: [],
    createdAt: Date.now(), updatedAt: Date.now(),
  });

  /* ---------- tree helpers ---------- */
  S.get = (id) => S.board.shells[id];
  S.isText = (s) => !!s && s.kind === 'text';
  S.count = () => Object.keys(S.board.shells).length;
  S.depth = (id) => { let d = 0, s = S.get(id); while (s && s.parent) { d++; s = S.get(s.parent); } return d; };
  S.isAncestor = (a, b) => { let s = S.get(b); while (s) { if (s.id === a) return true; s = s.parent ? S.get(s.parent) : null; } return false; };
  S.rootOf = (id) => { let s = S.get(id); while (s.parent) s = S.get(s.parent); return s; };
  S.descendants = (id) => { const out = []; const walk = (i) => S.get(i).children.forEach((c) => { out.push(c); walk(c); }); walk(id); return out; };
  S.siblingsOf = (id) => { const s = S.get(id); return s.parent ? S.get(s.parent).children : S.board.roots; };

  S.detach = (id) => {
    const arr = S.siblingsOf(id); const i = arr.indexOf(id);
    if (i >= 0) arr.splice(i, 1);
    S.get(id).parent = null;
  };
  S.attach = (id, parentId, index) => {
    S.get(id).parent = parentId || null;
    const arr = parentId ? S.get(parentId).children : S.board.roots;
    if (index == null || index < 0 || index > arr.length) arr.push(id); else arr.splice(index, 0, id);
  };

  /* mode: 'into' (last child of target) | 'before' | 'after' (sibling of target) | 'root' (free on canvas at pos) */
  /* heading rule: a shell is a heading, and headings go six levels deep at most (H1–H6, like Markdown) */
  S.MAX_LEVEL = 6;
  S.level = (id) => { let n = 0, s = S.get(id); while (s) { if (!S.isText(s)) n++; s = s.parent ? S.get(s.parent) : null; } return n; };
  S.height = (id) => { const s = S.get(id); const own = S.isText(s) ? 0 : 1; return own + s.children.reduce((m, c) => Math.max(m, S.height(c)), 0); };
  S.fits = (id, parentId) => (parentId ? S.level(parentId) : 0) + S.height(id) <= S.MAX_LEVEL;
  S.place = (id, targetId, mode, pos) => {
    S.lastError = null;
    if (targetId && S.isAncestor(id, targetId)) return false;
    const newParent = mode === 'into' ? targetId : (mode === 'before' || mode === 'after') ? S.get(targetId).parent : null;
    if (newParent && !S.fits(id, newParent)) { S.lastError = 'depth'; return false; }
    const s = S.get(id);
    S.detach(id);
    if (mode === 'into') {
      S.attach(id, targetId); S.get(targetId).collapsed = false;
    } else if (mode === 'before' || mode === 'after') {
      const t = S.get(targetId);
      const arr = t.parent ? S.get(t.parent).children : S.board.roots;
      let i = arr.indexOf(targetId); if (mode === 'after') i++;
      S.attach(id, t.parent, i);
    } else {
      s.x = Math.round(pos.x); s.y = Math.round(pos.y); S.attach(id, null);
    }
    return true;
  };

  S.add = (f, parentId, index) => {
    const s = S.newShell(f); S.board.shells[s.id] = s; S.attach(s.id, parentId, index); return s;
  };
  S.remove = (id) => {
    const ids = new Set([id, ...S.descendants(id)]);
    S.detach(id);
    ids.forEach((i) => delete S.board.shells[i]);
    S.board.arrows = S.board.arrows.filter((a) => !ids.has(a.from) && !ids.has(a.to));
  };
  /* delete the shell but keep its children, lifting them one level up */
  S.unwrap = (id) => {
    const s = S.get(id); const kids = s.children.slice();
    const arr = S.siblingsOf(id); let i = arr.indexOf(id);
    kids.forEach((c, k) => {
      S.detach(c);
      if (s.parent) S.attach(c, s.parent, i + k);
      else { const cs = S.get(c); cs.x = s.x + k * 24; cs.y = s.y + k * 120; S.attach(c, null); }
    });
    S.remove(id);
  };

  /* reading order for roots: top-to-bottom rows, left-to-right inside a row */
  S.ordered = () => {
    const list = S.board.roots.map(S.get).sort((a, b) => a.y - b.y);
    const rows = [];
    for (const s of list) { const r = rows[rows.length - 1]; if (r && s.y - r[0].y < 80) r.push(s); else rows.push([s]); }
    return rows.flatMap((r) => r.sort((a, b) => a.x - b.x)).map((s) => s.id);
  };
  /* depth-first walk in document order */
  S.walk = (fn) => {
    const go = (id, d) => { fn(S.get(id), d); S.get(id).children.forEach((c) => go(c, d + 1)); };
    S.ordered().forEach((id) => go(id, 0));
  };

  /* ---------- history ---------- */
  const snap = () => JSON.stringify({ shells: S.board.shells, roots: S.board.roots, arrows: S.board.arrows, sections: S.board.sections || [] });
  const restore = (str) => Object.assign(S.board, JSON.parse(str));
  S.checkpoint = () => {
    S.undoStack.push(snap()); if (S.undoStack.length > 150) S.undoStack.shift();
    S.redoStack.length = 0;
  };
  S.undo = () => { if (!S.undoStack.length) return false; S.redoStack.push(snap()); restore(S.undoStack.pop()); S.changed(); return true; };
  S.redo = () => { if (!S.redoStack.length) return false; S.undoStack.push(snap()); restore(S.redoStack.pop()); S.changed(); return true; };

  S.snapshot = snap;
  S.restoreSnapshot = restore;

  /* kind: 'struct' → re-render canvas; 'text' → content only (no re-render while typing) */
  S.on = (fn) => S.listeners.add(fn);
  S.notify = (kind) => S.listeners.forEach((fn) => fn(kind || 'struct')); // redraw without saving (demo, remote edits)
  S.changed = (kind) => {
    S.board.updatedAt = Date.now();
    S.notify(kind);
    SW.persist.schedule();
  };

  /* ---------- markdown out ---------- */
  S.toMarkdown = () => {
    const out = ['# ' + S.board.name, ''];
    S.walk((s, d) => {
      if (S.isText(s)) { if (s.body.trim()) out.push(s.body.trim(), ''); return; }
      out.push('#'.repeat(Math.min(6, d + 2)) + ' ' + (s.title.trim() || '(제목 없음)'), '');
      if (s.body.trim()) out.push(s.body.trim(), '');
    });
    const rel = S.board.arrows.filter((a) => S.get(a.from) && S.get(a.to));
    if (rel.length) {
      out.push('## 관계', '');
      rel.forEach((a) => out.push('- ' + S.label(S.get(a.from)) + ' → ' + S.label(S.get(a.to))));
      out.push('');
    }
    return out.join('\n');
  };
  /* a short name for any node: the shell title, or the first line of a text block */
  S.label = (s) => (S.isText(s) ? s.body.trim().split('\n')[0].replace(/^[-*•]\s+|^\d+[.)]\s+|^#+\s+/, '').slice(0, 40) : s.title.trim()) || '(제목 없음)';

  /* ---------- text in → node trees {kind?, title, body, children} ----------
   * Like dumping notes on a desk: headings become shells, everything else lands as loose text blocks. */
  S.parseText = (text) => {
    const clean = text.replace(/\r/g, '');
    const lines = clean.split('\n');
    if (lines.some((l) => /^#{1,6}\s+\S/.test(l))) {
      const roots = [], stack = []; let cur = null, loose = null;
      for (const l of lines) {
        const m = /^(#{1,6})\s+(.*)$/.exec(l);
        if (m) {
          const lvl = m[1].length; cur = { title: m[2].trim(), body: '', children: [], lvl }; loose = null;
          while (stack.length && stack[stack.length - 1].lvl >= lvl) stack.pop();
          (stack.length ? stack[stack.length - 1].children : roots).push(cur); stack.push(cur);
        } else if (cur) {
          if (l.trim() || cur.body) cur.body += (cur.body ? '\n' : '') + l.replace(/\s+$/, '');
        } else if (l.trim()) {
          if (!loose) { loose = { kind: 'text', body: '', children: [] }; roots.push(loose); }
          loose.body += (loose.body ? '\n' : '') + l.replace(/\s+$/, '');
        }
      }
      const tidy = (n) => { n.body = n.body.replace(/\n{3,}/g, '\n\n').trim(); n.children.forEach(tidy); };
      roots.forEach(tidy);
      return roots;
    }
    return clean.split(/\n\s*\n/).map((b) => b.replace(/\s+$/, '')).filter((b) => b.trim())
      .map((block) => ({ kind: 'text', body: block.replace(/^\n+/, ''), children: [] }));
  };
  /* add node trees to the board; roots are laid out in a loose grid from (x, y) */
  S.insertTrees = (trees, x, y, parentId) => {
    const made = [];
    const addTree = (n, parent, pos) => {
      const f = { body: n.body || '', ai: !!n.ai, x: pos ? pos.x : 0, y: pos ? pos.y : 0 };
      if (n.kind === 'text') { f.kind = 'text'; f.w = 340; } else f.title = n.title || '';
      const s = S.add(f, parent);
      (n.children || []).forEach((c) => addTree(c, s.id));
      return s;
    };
    trees.forEach((n, i) => {
      const pos = parentId ? null : { x: x + (i % 3) * 370, y: y + Math.floor(i / 3) * 190 };
      made.push(addTree(n, parentId || null, pos));
    });
    return made;
  };
  /* "wrap in shell": put the given nodes inside a new shell that takes the first one's place */
  S.wrap = (ids, pos) => {
    ids = ids.filter((id, i) => S.get(id) && !ids.some((o, j) => j !== i && S.isAncestor(o, id)));
    if (!ids.length) return null;
    const first = S.get(ids[0]);
    S.lastError = null;
    const base = first.parent ? S.level(first.parent) : 0;
    if (ids.some((id) => base + 1 + S.height(id) > S.MAX_LEVEL)) { S.lastError = 'depth'; return null; }
    const sh = S.newShell({ x: Math.round(pos.x), y: Math.round(pos.y), w: Math.round(pos.w || 320) });
    S.board.shells[sh.id] = sh;
    if (first.parent) S.attach(sh.id, first.parent, S.get(first.parent).children.indexOf(first.id));
    else S.attach(sh.id, null);
    ids.forEach((id) => { S.detach(id); S.attach(id, sh.id); });
    return sh;
  };

  /* ---------- example board (shown until the person makes their own) ---------- */
  S.exampleBoard = () => {
    const prev = S.board, NL = String.fromCharCode(10); S.board = S.emptyBoard('예시 · 운동장 표면 온도 탐구');
    const q = S.add({ title: '연구 질문', body: '학교 운동장의 **인조잔디**와 **흙 바닥**은 한낮 표면 온도가 얼마나 다를까?', x: 80, y: 90, w: 320, color: 'sky' });
    const h = S.add({ title: '가설', body: '인조잔디가 정오에 흙보다 10°C 이상 뜨거울 것이다.' }, q.id);
    S.add({ title: '변인', body: ['- **독립:** 바닥 재질', '- **종속:** 표면 온도', '- **통제:** 측정 시각, 날씨, 측정 높이'].join(NL) }, q.id);
    const m = S.add({ title: '측정 방법', body: ['1. 적외선 온도계로 9시 · 12시 · 15시에 측정', '2. 재질별로 5곳씩, 높이 1m에서', '3. 맑은 날 3일 반복'].join(NL), x: 500, y: 80, w: 320 });
    S.add({ title: '준비물', body: '적외선 온도계, 기록지, 그늘막 위치 사진' }, m.id);
    const g = S.add({ title: '그래프 아이디어', body: '시간대별 온도 꺾은선 그래프, 재질별로 색 구분', x: 500, y: 470, w: 300 });
    S.add({ kind: 'text', body: ['- 선행 연구: 인조잔디 열섬 논문 2~3편', '- 측정 높이를 어떻게 정했는지 확인하기'].join(NL), x: 90, y: 520, w: 330 });
    S.add({ kind: 'text', body: '열화상 사진 한 장이 숫자 표보다 설득력 있을 듯. 발표 첫 화면에 쓰기?', x: 900, y: 120, w: 300 });
    S.add({ kind: 'text', body: '흐린 날은 차이가 줄어들 수 있음 → 날씨도 기록', x: 900, y: 300, w: 280 });
    S.board.arrows.push({ id: uid('a'), from: h.id, to: m.id }, { id: uid('a'), from: m.id, to: g.id });
    S.board.example = true;
    const b = S.board; S.board = prev; return b;
  };

  /* ---------- templates ---------- */
  S.templateBoard = (kind) => {
    const prev = S.board, NL = String.fromCharCode(10);
    const link = (a, b) => S.board.arrows.push({ id: uid('a'), from: a.id, to: b.id });
    if (kind === 'rne') {
      S.board = S.emptyBoard('R&E 탐구 · 제목을 바꿔 주세요');
      const q = S.add({ title: '연구 주제와 질문', body: '무엇이 궁금한가요? 한 문장 질문으로 적어 보세요.', x: 80, y: 80, w: 320, color: 'sky' });
      S.add({ title: '연구 동기', body: '이 주제를 고른 이유, 처음 궁금해진 계기' }, q.id);
      S.add({ title: '연구 질문', body: '측정하거나 비교할 수 있는 형태로' }, q.id);
      const bg = S.add({ title: '배경 이론과 선행 연구', body: '이미 알려진 것과 아직 모르는 것', x: 80, y: 470, w: 320, color: 'slate' });
      S.add({ title: '핵심 개념', body: '' }, bg.id);
      S.add({ title: '참고한 논문·자료', body: '저자, 제목, 연도와 내 연구에 쓸 점' }, bg.id);
      const hy = S.add({ title: '가설', body: '"~하면 ~할 것이다" 형태로, 그렇게 예상하는 이유와 함께', x: 500, y: 80, w: 300, color: 'amber' });
      const ex = S.add({ title: '실험 설계', body: '', x: 500, y: 310, w: 300, color: 'lime' });
      S.add({ title: '변인', body: ['독립 변인:', '종속 변인:', '통제 변인:'].join(NL) }, ex.id);
      S.add({ title: '실험 방법', body: '순서대로, 반복 횟수 포함' }, ex.id);
      S.add({ title: '준비물과 안전', body: '' }, ex.id);
      const rs = S.add({ title: '결과', body: '측정값, 표, 그래프', x: 900, y: 80, w: 300, color: 'violet' });
      S.add({ title: '데이터 정리', body: '평균, 오차, 반복 측정 결과' }, rs.id);
      const ds = S.add({ title: '논의와 결론', body: '', x: 900, y: 360, w: 300, color: 'rose' });
      S.add({ title: '가설 검증', body: '결과가 가설을 지지하나요?' }, ds.id);
      S.add({ title: '한계와 오차 원인', body: '' }, ds.id);
      S.add({ title: '후속 연구', body: '' }, ds.id);
      S.add({ title: '참고 문헌', body: '', x: 900, y: 760, w: 300 });
      link(q, hy); link(bg, hy); link(hy, ex); link(ex, rs); link(rs, ds);
    } else if (kind === 'plan') {
      S.board = S.emptyBoard('R&E 연구 계획서 · 제목을 바꿔 주세요');
      const a = S.add({ title: '연구 제목', body: '한 문장으로, 무엇을 어떻게 알아볼지 드러나게', x: 80, y: 80, w: 320, color: 'sky' });
      S.add({ title: '연구 동기', body: '이 주제가 궁금해진 계기' }, a.id);
      S.add({ title: '연구 목적', body: '이 연구로 알아내고 싶은 것' }, a.id);
      const b = S.add({ title: '이론적 배경', body: '', x: 80, y: 420, w: 320, color: 'slate' });
      S.add({ title: '핵심 개념', body: '' }, b.id);
      S.add({ title: '선행 연구', body: ['- 저자 (연도). 제목. 출처', '- 내 연구와의 차이점:'].join(NL) }, b.id);
      const c = S.add({ title: '연구 질문과 가설', body: ['- **질문:**', '- **가설:** ~하면 ~할 것이다', '- **근거:**'].join(NL), x: 480, y: 80, w: 320, color: 'amber' });
      const d = S.add({ title: '연구 방법', body: '', x: 480, y: 320, w: 320, color: 'lime' });
      S.add({ title: '변인', body: ['- **독립 변인:**', '- **종속 변인:**', '- **통제 변인:**'].join(NL) }, d.id);
      S.add({ title: '실험 절차', body: ['1. ', '2. ', '3. '].join(NL) }, d.id);
      S.add({ title: '준비물과 안전', body: '' }, d.id);
      const e = S.add({ title: '연구 일정', body: ['- **1개월:** 문헌 조사, 실험 설계', '- **2개월:** 예비 실험', '- **3개월:** 본 실험과 분석', '- **4개월:** 보고서와 발표 준비'].join(NL), x: 880, y: 80, w: 300, color: 'violet' });
      S.add({ title: '기대 효과', body: '', x: 880, y: 330, w: 300, color: 'rose' });
      S.add({ title: '참고 문헌', body: '', x: 880, y: 500, w: 300 });
      link(a, c); link(b, c); link(c, d); link(d, e);
    } else if (kind === 'mid') {
      S.board = S.emptyBoard('R&E 중간 보고 · 제목을 바꿔 주세요');
      const a = S.add({ title: '지금까지 한 일', body: '', x: 80, y: 80, w: 320, color: 'sky' });
      S.add({ title: '실험 1', body: '날짜, 조건, 반복 횟수' }, a.id);
      S.add({ title: '실험 2', body: '' }, a.id);
      const b = S.add({ title: '중간 결과', body: '', x: 480, y: 80, w: 320, color: 'violet' });
      S.add({ title: '데이터 요약', body: '평균, 범위, 눈에 띄는 경향' }, b.id);
      S.add({ title: '그래프와 표', body: '' }, b.id);
      const c = S.add({ title: '문제와 해결', body: '', x: 480, y: 400, w: 320, color: 'rose' });
      S.add({ title: '예상과 달랐던 점', body: '' }, c.id);
      S.add({ title: '바꾼 방법', body: '' }, c.id);
      const d = S.add({ title: '앞으로의 계획', body: ['- [ ] ', '- [ ] '].join(NL), x: 880, y: 80, w: 300, color: 'lime' });
      S.add({ title: '도움이 필요한 점', body: '지도 교사나 팀원에게 물어볼 것', x: 880, y: 300, w: 300, color: 'slate' });
      link(a, b); link(b, c); link(c, d);
    } else if (kind === 'final') {
      S.board = S.emptyBoard('R&E 최종 보고서 · 제목을 바꿔 주세요');
      S.add({ title: '초록', body: '연구 목적, 방법, 주요 결과, 결론을 4~5문장으로 (마지막에 쓰기)', x: 80, y: 80, w: 320, color: 'amber' });
      const a = S.add({ title: '서론', body: '', x: 80, y: 250, w: 320, color: 'sky' });
      S.add({ title: '연구 배경', body: '' }, a.id);
      S.add({ title: '연구 목적과 질문', body: '' }, a.id);
      const b = S.add({ title: '이론적 배경', body: '', x: 80, y: 560, w: 320, color: 'slate' });
      S.add({ title: '핵심 개념', body: '' }, b.id);
      const c = S.add({ title: '연구 방법', body: '', x: 480, y: 80, w: 320, color: 'lime' });
      S.add({ title: '변인과 가설', body: '' }, c.id);
      S.add({ title: '실험 절차', body: '' }, c.id);
      const d = S.add({ title: '결과', body: '', x: 480, y: 400, w: 320, color: 'violet' });
      S.add({ title: '실험 결과 1', body: '표나 그래프와 함께' }, d.id);
      S.add({ title: '실험 결과 2', body: '' }, d.id);
      const e = S.add({ title: '논의', body: '', x: 880, y: 80, w: 300, color: 'rose' });
      S.add({ title: '가설 검증', body: '' }, e.id);
      S.add({ title: '오차와 한계', body: '' }, e.id);
      S.add({ title: '결론과 제언', body: '', x: 880, y: 400, w: 300 });
      S.add({ title: '참고 문헌', body: '', x: 880, y: 560, w: 300 });
      link(a, c); link(b, c); link(c, d); link(d, e);
    } else {
      S.board = S.emptyBoard('연구 발표 · 제목을 바꿔 주세요');
      const a = S.add({ title: '도입: 관심 끌기', body: '청중이 "어, 왜 그렇지?" 하게 만드는 사진, 질문, 숫자 하나', x: 80, y: 80, w: 300, color: 'amber' });
      const b = S.add({ title: '연구 질문', body: '한 문장으로', x: 440, y: 80, w: 300, color: 'sky' });
      const c = S.add({ title: '어떻게 알아봤나', body: '실험·조사 방법을 그림 한 장으로', x: 800, y: 80, w: 300, color: 'lime' });
      const d = S.add({ title: '무엇을 알아냈나', body: '', x: 80, y: 360, w: 300, color: 'violet' });
      S.add({ title: '핵심 결과 1', body: '' }, d.id);
      S.add({ title: '핵심 결과 2', body: '' }, d.id);
      const e = S.add({ title: '그래서 무엇이 중요한가', body: '의미, 한계, 다음 단계', x: 440, y: 360, w: 300, color: 'rose' });
      S.add({ title: '예상 질문과 답', body: '심사위원이 물어볼 만한 질문 3개', x: 800, y: 360, w: 300, color: 'slate' });
      link(a, b); link(b, c); link(c, d); link(d, e);
    }
    const out = S.board; S.board = prev; return out;
  };
})(window.SW);
