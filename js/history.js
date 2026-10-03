/* Shellwork — version history, kept like a lab notebook: a dated snapshot of the board every
 * 10 minutes of work, plus any version someone names. Any snapshot can be restored (and that restore can be undone). */
(function (SW) {
  'use strict';
  const S = SW.store, P = SW.persist;
  const $ = (q) => document.querySelector(q);
  const H = SW.history = { lastAuto: 0, lastSig: '' };
  const AUTO_GAP = 10 * 60 * 1000, KEEP = 40, KEEP_LOCAL = 15, LS = 'shellwork.versions.';
  const content = () => ({ name: S.board.name, shells: S.board.shells, roots: S.board.roots, arrows: S.board.arrows, sections: S.board.sections || [] });
  const col = () => (S.board.shared
    ? P.db.collection('shared/' + S.board.id + '/versions')
    : P.db.doc('data/users/' + P.uid + '/' + S.board.id).collection('versions'));
  const readLocal = () => { try { return JSON.parse(SW.ls.get(LS + S.board.id) || '[]'); } catch (e) { return []; } };

  H.list = async () => {
    if (P.mode === 'cloud') {
      const snap = await col().orderBy('at', 'desc').limit(KEEP + 10).get();
      const rows = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
      rows.slice(KEEP).filter((r) => r.auto).forEach((r) => col().doc(r.id).delete().catch(() => {})); // keep the list short
      return rows.slice(0, KEEP);
    }
    if (P.mode === 'local') return readLocal().sort((a, b) => b.at - a.at);
    return [];
  };
  H.save = async (label, auto) => {
    if (!S.board || S.board.example || P.mode === 'memory') return null;
    const data = JSON.stringify(content());
    const v = { at: Date.now(), label: String(label || '').slice(0, 80), auto: !!auto, by: (SW.collab && SW.collab.me) || null, count: S.count(), data };
    if (P.mode === 'cloud') await col().doc(SW.uid('v')).set(v);
    else {
      const arr = readLocal(); arr.push(Object.assign({ id: SW.uid('v') }, v));
      while (arr.length > KEEP_LOCAL) arr.splice(arr.findIndex((x) => x.auto) >= 0 ? arr.findIndex((x) => x.auto) : 0, 1);
      while (arr.length && !SW.ls.set(LS + S.board.id, JSON.stringify(arr))) arr.shift();
    }
    H.lastAuto = v.at; H.lastSig = data.length + ':' + S.count();
    return v;
  };
  /* called after every successful save */
  H.afterSave = () => {
    const sig = JSON.stringify(content()).length + ':' + S.count();
    if (Date.now() - H.lastAuto < AUTO_GAP || sig === H.lastSig) return;
    H.save('', true).catch(() => {});
  };
  H.reset = () => { H.lastAuto = 0; H.lastSig = ''; };

  async function restore(v) {
    const d = JSON.parse(v.data);
    try { await H.save('되돌리기 직전', true); } catch (e) { /* restoring still works */ }
    S.checkpoint();
    S.board.shells = d.shells || {}; S.board.roots = d.roots || []; S.board.arrows = d.arrows || []; S.board.sections = d.sections || [];
    if (d.name) S.board.name = d.name;
    SW.canvas.selected.clear(); SW.main.showBoardName(); S.changed();
    H.close();
    SW.ui.toast(fmt(v.at) + ' 버전으로 되돌렸어요', '취소', S.undo);
  }

  const fmt = (t) => {
    const d = new Date(t), diff = Date.now() - t;
    if (diff < 60000) return '방금';
    if (diff < 3600000) return Math.round(diff / 60000) + '분 전';
    const sameDay = new Date().toDateString() === d.toDateString();
    return (sameDay ? '오늘 ' : d.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }) + ' ') + d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  };

  async function render() {
    const list = $('#histList'); list.textContent = '';
    const note = document.createElement('p'); note.className = 'hist-empty'; note.textContent = '불러오는 중…'; list.append(note);
    let rows = [];
    try { rows = await H.list(); } catch (e) { note.textContent = '기록을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.'; return; }
    list.textContent = '';
    if (!rows.length) {
      const p = document.createElement('p'); p.className = 'hist-empty';
      p.textContent = S.board.example ? '예시 보드는 기록을 남기지 않아요. 고치면 내 보드가 되고, 그때부터 기록돼요.' : P.mode === 'memory' ? '이 화면에서는 저장이 꺼져 있어 기록도 남지 않아요.' : '아직 기록이 없어요. 작업하면 10분마다 자동으로 남고, 위에서 직접 남길 수도 있어요.';
      list.append(p); return;
    }
    let names = {};
    const ids = [...new Set(rows.map((r) => r.by).filter(Boolean))];
    if (S.board.shared && ids.length && SW.collab.user) { try { names = await SW.collab.user.profiles(ids); } catch (e) { names = {}; } }
    rows.forEach((r) => {
      const row = document.createElement('div'); row.className = 'hist-row';
      const main = document.createElement('div'); main.className = 'hist-main';
      const t = document.createElement('strong'); t.textContent = r.label || (r.auto ? '자동 저장' : '저장한 버전'); main.append(t);
      const m = document.createElement('span'); m.className = 'hist-meta';
      const who = r.by && names[r.by] && names[r.by].name ? ' · ' + names[r.by].name : '';
      m.textContent = fmt(r.at) + ' · ' + (r.count || 0) + '개' + who; main.append(m);
      const b = document.createElement('button'); b.className = 'btn'; b.textContent = '되돌리기';
      b.onclick = () => {
        if (b.dataset.armed) { restore(r); return; }
        b.dataset.armed = '1'; b.textContent = '정말 되돌릴까요?'; b.classList.add('primary');
        setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = '되돌리기'; b.classList.remove('primary'); } }, 4000);
      };
      row.append(main, b); list.append(row);
    });
  }

  H.open = () => { $('#history').hidden = false; $('#histLabel').value = ''; render(); };
  H.close = () => { $('#history').hidden = true; };
  H.init = () => {
    $('#history').addEventListener('pointerdown', (e) => { if (e.target.id === 'history') H.close(); });
    $('#histClose').onclick = H.close;
    $('#histSave').onclick = async () => {
      const btn = $('#histSave'); btn.disabled = true;
      try { const v = await H.save($('#histLabel').value.trim() || '저장한 버전', false); if (v) SW.ui.toast('지금 버전을 기록했어요'); else SW.ui.toast('예시 보드나 미리보기에서는 기록을 남길 수 없어요'); $('#histLabel').value = ''; render(); }
      catch (e) { SW.ui.toast('기록하지 못했어요. 잠시 뒤 다시 시도해 주세요.'); }
      finally { btn.disabled = false; }
    };
    $('#histLabel').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); $('#histSave').click(); } if (e.key === 'Escape') H.close(); });
  };
})(window.SW);
