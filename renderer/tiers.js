'use strict';
// 首页「一键优化模式」：三档预设，选档后逐项列出「当前值 → 目标值」，确认后才写；
// 写入前整份快照，随时可「还原到优化前」。N 卡项只写本机驱动确实列出的取值。
(function () {
  const api = window.optimizer;
  const $ = (id) => document.getElementById(id);

  const TEXT = {
    zh: {
      loading: '正在读取当前值…',
      tiers: {
        balanced: { name: '一档 · 平衡模式', desc: '画质与帧数折中：小幅提升游戏帧数，画面不高不低保持平衡' },
        quality: { name: '二档 · 质量模式', desc: '保住画质，同时做一点 Windows 与 N 卡优化，适合单机大作' },
        esports: { name: '三档 · 电竞模式', desc: '不要画质只要帧数与低延迟：系统开销压到最低，N 卡全部走性能取向' },
      },
      groups: { power: '电源计划', game: '系统游戏开关', gpu: 'N 卡 3D 设置（全局方案）' },
      st: { change: '将修改', same: '已是该值', skip: '已跳过', unavailable: '本机不可用', unknown: '读取失败' },
      reason: { 'no-setting': '本机驱动未列出该设置项', 'no-value': '本机驱动未列出该取值' },
      pick: (n, c, s) => '将按「' + n + '」修改 ' + c + ' 项' + (s ? '，另有 ' + s + ' 项本机不支持会跳过' : ''),
      adminNote: '（含 HKLM 项，会弹一次管理员授权）',
      rebootNote: '（含 HAGS，生效需要重启电脑）',
      apply: '应用该档位', cancel: '取消',
      done: (n) => '已应用「' + n + '」',
      unchanged: '当前已经是这一档的状态，无需修改',
      fail: (m) => '应用失败：' + m,
      partial: (m) => '已应用，但有项目没成功：' + m,
      restore: '还原到优化前',
      restorePick: '将按优化前的快照还原电源计划、系统开关与 N 卡设置',
      restoreDone: '已还原到优化前',
      restoreNone: '还没有优化前的快照',
      restoreFail: (m) => '还原失败：' + m,
      arrow: ' → ',
      driverDefault: '驱动默认',
      unnamed: '未命名取值',
      none: '本档没有需要修改的项目',
      loadFail: (m) => '读取当前状态失败：' + m,
      snapYes: '已有优化前快照（可还原）',
      snapNo: '未选择档位',
    },
    en: {
      loading: 'Reading current values…',
      tiers: {
        balanced: { name: 'Tier 1 · Balanced', desc: 'Frames and image quality in balance: a small FPS gain without lowering visuals' },
        quality: { name: 'Tier 2 · Quality', desc: 'Keeps image quality while applying mild Windows and NVIDIA tuning for single-player games' },
        esports: { name: 'Tier 3 · Esports', desc: 'Frames and latency only: minimal system overhead, every NVIDIA setting biased to performance' },
      },
      groups: { power: 'Power plan', game: 'System gaming switches', gpu: 'NVIDIA 3D settings (global profile)' },
      st: { change: 'Will change', same: 'Already set', skip: 'Skipped', unavailable: 'Not available here', unknown: 'Read failed' },
      reason: { 'no-setting': 'This driver does not list the setting', 'no-value': 'This driver does not list that value' },
      pick: (n, c, s) => 'Apply "' + n + '": ' + c + ' item(s) to change' + (s ? ', ' + s + ' unsupported here will be skipped' : ''),
      adminNote: ' (includes HKLM items — one UAC prompt)',
      rebootNote: ' (includes HAGS — a reboot is required)',
      apply: 'Apply this tier', cancel: 'Cancel',
      done: (n) => 'Applied "' + n + '"',
      unchanged: 'Already in this tier state, nothing to do',
      fail: (m) => 'Apply failed: ' + m,
      partial: (m) => 'Applied, but some items failed: ' + m,
      restore: 'Restore pre-tuning values',
      restorePick: 'Restore the power plan, system switches and NVIDIA settings from the pre-tuning snapshot',
      restoreDone: 'Restored to pre-tuning state',
      restoreNone: 'No pre-tuning snapshot yet',
      restoreFail: (m) => 'Restore failed: ' + m,
      arrow: ' → ',
      driverDefault: 'driver default',
      unnamed: 'unnamed value',
      none: 'Nothing to change for this tier',
      loadFail: (m) => 'Failed to read the current state: ' + m,
      snapYes: 'Pre-tuning snapshot available (restorable)',
      snapNo: 'No tier selected',
    },
  };

  const state = { info: null, pick: null, preview: null, busy: false };

  function t() { return TEXT[(window.i18n && window.i18n.lang === 'en') ? 'en' : 'zh']; }
  function en() { return !!(window.i18n && window.i18n.lang === 'en'); }
  function el(tag, cls) { const n = document.createElement(tag); if (cls) n.className = cls; return n; }
  function pick(l) { if (!l) return null; return en() ? (l.en || l.zh) : (l.zh || l.en); }

  function hexOf(v) {
    if (v == null) return null;
    const s = String(v);
    if (/^0x/i.test(s)) return '0x' + s.slice(2).toUpperCase().padStart(8, '0');
    const n = Number(s);
    return Number.isFinite(n) ? '0x' + (n >>> 0).toString(16).toUpperCase().padStart(8, '0') : s;
  }

  function gpuValueText(item, which) {
    const T = t();
    const lab = which === 'target' ? item.targetLabel : item.currentLabel;
    const val = which === 'target' ? item.value : item.current;
    const p = pick(lab);
    if (p) return p;
    if (val == null) return T.driverDefault;
    return hexOf(val) || T.unnamed;
  }

  function gameText(g) {
    const G = window.game;
    const w = G && G.words ? G.words() : null;
    const name = w && w.items[g.id] ? w.items[g.id].name : g.id;
    const cur = G && G.stateLabel ? G.stateLabel({ kind: g.kind, state: g.current }) : String(g.current);
    const to = G && G.targetLabel ? G.targetLabel({ kind: g.kind }, g.mode) : String(g.mode);
    return { name, cur, to };
  }

  function tierName(key) {
    const m = t().tiers[key];
    return m ? m.name : String(key || '');
  }

  // 体检报告里的漂移清单借用这两个分组标题，避免同一份中文再抄一遍
  function groupText(kind) {
    const g = t().groups;
    return (g && g[kind]) || String(kind || '');
  }

  function status(text, cls) {
    const bar = document.querySelector('.tier-card .power-head');
    if (!bar) return;
    let s = bar.querySelector('.power-status');
    if (!s) { s = el('span', 'power-status'); bar.insertBefore(s, bar.querySelector('.spacer')); }
    s.textContent = text;
    s.className = 'power-status ' + (cls || '');
    setTimeout(() => { if (s.parentNode) s.textContent = ''; }, 8000);
  }

  function renderCards() {
    const T = t();
    const host = $('tierOpts');
    host.textContent = '';
    for (const key of ['balanced', 'quality', 'esports']) {
      const meta = T.tiers[key];
      const card = el('label', 'tier-opt' + (state.pick === key ? ' active' : ''));
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'tierOpt';
      radio.value = key;
      radio.checked = state.pick === key;
      radio.disabled = state.busy;
      radio.addEventListener('change', () => { if (radio.checked) select(key); });
      card.appendChild(radio);
      const body = el('div', 'tier-body');
      const name = el('strong', 'tier-name');
      name.textContent = meta.name;
      const desc = el('span', 'tier-desc');
      desc.textContent = meta.desc;
      body.appendChild(name); body.appendChild(desc);
      if (state.pick === key && state.preview) {
        const sum = el('span', 'tier-sum');
        sum.textContent = T.pick(meta.name, state.preview.changes, state.preview.skips);
        body.appendChild(sum);
      }
      card.appendChild(body);
      host.appendChild(card);
    }
    const sum = $('tierSummary');
    if (sum) {
      sum.textContent = state.info && state.info.snapshot ? T.snapYes
        : state.pick ? T.tiers[state.pick].name : T.snapNo;
    }
    const rb = $('tierRestore');
    if (rb) {
      rb.classList.toggle('hidden', !(state.info && state.info.snapshot));
      rb.textContent = T.restore;
    }
  }

  function hidePending() {
    state.pick = null;
    state.preview = null;
    const box = $('tierPending');
    box.classList.add('hidden');
    box.textContent = '';
    const list = $('tierList');
    list.classList.add('hidden');
    list.textContent = '';
  }

  function renderList(p) {
    const T = t();
    const host = $('tierList');
    host.textContent = '';
    const groups = [];
    if (p.power) groups.push({ key: 'power', rows: [powerRow(p.power)] });
    if (p.game && p.game.length) groups.push({ key: 'game', rows: p.game.map(gameRow) });
    if (p.gpu && p.gpu.length) groups.push({ key: 'gpu', rows: p.gpu.map(gpuRow) });
    let shown = 0;
    for (const g of groups) {
      const rows = g.rows.filter(Boolean);
      if (!rows.length) continue;
      shown += rows.length;
      const box = el('div', 'tier-group');
      const h = el('div', 'tier-group-h');
      h.textContent = T.groups[g.key];
      box.appendChild(h);
      for (const r of rows) box.appendChild(r);
      host.appendChild(box);
    }
    if (!shown) {
      const tip = el('div', 'tier-none');
      tip.textContent = T.none;
      host.appendChild(tip);
    }
    host.classList.remove('hidden');
  }

  function badge(statusKey, extra) {
    const T = t();
    const b = el('span', 'badge ' + (statusKey === 'change' ? 'caution' : statusKey === 'same' ? 'safe' : 'off'));
    b.textContent = (T.st[statusKey] || statusKey) + (extra ? (en() ? ': ' : '：') + extra : '');
    return b;
  }

  function row(name, fromTo, statusKey, extra) {
    const r = el('div', 'tier-item');
    const n = el('span', 'tier-n');
    n.textContent = name;
    const v = el('span', 'tier-v');
    v.textContent = fromTo;
    r.appendChild(n); r.appendChild(v); r.appendChild(badge(statusKey, extra));
    return r;
  }

  function powerRow(p) {
    const T = t();
    const name = T.groups.power;
    const dn = (window.power && window.power.dispName) || ((x) => x);
    const target = dn(p.targetName || p.key);
    if (p.status === 'unknown') return row(name, '—', 'unknown');
    if (p.status === 'unavailable') return row(name, target, 'unavailable');
    const from = dn(p.currentName || (p.currentGuid ? p.currentGuid.slice(0, 8) : '—'));
    return row(name, from + T.arrow + target, p.status === 'same' ? 'same' : 'change');
  }

  function gameRow(g) {
    const T = t();
    const w = gameText(g);
    const st = g.status === 'same' ? 'same' : 'change';
    const r = row(w.name, w.cur + T.arrow + w.to, st);
    if (g.reboot && g.status !== 'same') {
      const note = el('span', 'tier-note');
      note.textContent = T.rebootNote;
      r.insertBefore(note, r.lastChild);
    }
    return r;
  }

  function gpuRow(item) {
    const T = t();
    const name = pick(item.name) || item.id;
    if (item.status === 'skip') {
      return row(name, gpuValueText(item, 'target'), 'skip', T.reason[item.reason] || '');
    }
    return row(name, gpuValueText(item, 'current') + T.arrow + gpuValueText(item, 'target'), item.status);
  }

  function showPendingBar(p) {
    const T = t();
    const meta = T.tiers[state.pick] || { name: state.pick };
    const box = $('tierPending');
    box.classList.remove('hidden');
    box.textContent = '';
    const msg = document.createElement('span');
    const needAdmin = (p.game || []).some((g) => g.admin && g.status === 'change');
    const needReboot = (p.game || []).some((g) => g.reboot && g.status === 'change');
    msg.textContent = T.pick(meta.name, p.changes, p.skips) + (needAdmin ? T.adminNote : '') + (needReboot ? T.rebootNote : '');
    const ok = el('button', 'btn primary small');
    ok.textContent = T.apply;
    ok.disabled = state.busy || !p.changes;
    const no = el('button', 'btn ghost small');
    no.textContent = T.cancel;
    ok.addEventListener('click', () => doApply());
    no.addEventListener('click', () => { hidePending(); renderCards(); });
    box.appendChild(msg); box.appendChild(ok); box.appendChild(no);
  }

  async function select(key) {
    if (state.busy) return;
    state.pick = key;
    state.preview = null;
    const T = t();
    renderCards();
    const box = $('tierPending');
    box.classList.remove('hidden');
    box.textContent = T.loading;
    $('tierList').classList.add('hidden');
    try {
      const p = await api.tiersPreview(key);
      if (!p || p.ok === false) {
        box.textContent = T.loadFail((p && p.message) || '?');
        return;
      }
      state.preview = p;
      renderCards();
      showPendingBar(p);
      renderList(p);
    } catch (e) {
      box.textContent = T.loadFail(e && e.message ? e.message : String(e));
    }
  }

  async function doApply() {
    if (state.busy || !state.pick) return;
    state.busy = true;
    const T = t();
    const key = state.pick;
    const meta = T.tiers[key] || { name: key };
    renderCards();
    try {
      const r = await api.tiersApply(key, true);
      const rp = r && r.restorePoint;
      if (r && r.ok) {
        hidePending();
        status(r.unchanged ? T.unchanged : T.done(meta.name), 'ok');
        if (rp && !rp.created && !rp.reused) showRpNote(rp.reason || '未知原因');
      } else if (r && r.errors && r.errors.length && (r.power || r.game || r.gpu)) {
        status(T.partial(r.errors.join('；')), 'err');
      } else {
        status(T.fail((r && r.message) || (r && r.errors ? r.errors.join('；') : '?')), 'err');
      }
      await refreshInfo();
      await select(key);
    } catch (e) {
      status(T.fail(e && e.message ? e.message : String(e)), 'err');
    } finally {
      state.busy = false;
      renderCards();
    }
  }

  // 还原点没建成必须让用户看见，不能被「优化成功」的提示盖掉
  function showRpNote(reason) {
    const box = $('tierPending');
    box.classList.remove('hidden');
    box.textContent = '';
    const s = el('span', 'game-note');
    s.textContent = `还原点未创建：${reason}。档位本身已应用，撤销请用「记录与撤销」页。`;
    box.appendChild(s);
  }

  function showRestore() {
    const T = t();
    if (!(state.info && state.info.snapshot)) { status(T.restoreNone, 'err'); return; }
    const box = $('tierPending');
    box.classList.remove('hidden');
    box.textContent = '';
    const msg = document.createElement('span');
    msg.textContent = T.restorePick;
    const ok = el('button', 'btn primary small');
    ok.textContent = T.restore;
    const no = el('button', 'btn ghost small');
    no.textContent = T.cancel;
    ok.addEventListener('click', async () => {
      if (state.busy) return;
      state.busy = true;
      try {
        const r = await api.tiersRestore(true);
        box.classList.add('hidden');
        box.textContent = '';
        if (r && r.ok) {
          status(T.restoreDone, 'ok');
          await refreshInfo();
          hidePending();
          renderCards();
        } else {
          status(T.restoreFail((r && r.message) || '?'), 'err');
        }
      } catch (e) {
        status(T.restoreFail(e && e.message ? e.message : String(e)), 'err');
      } finally {
        state.busy = false;
        renderCards();
      }
    });
    no.addEventListener('click', () => {
      box.classList.add('hidden');
      box.textContent = '';
      if (state.pick) select(state.pick); else renderCards();
    });
    box.appendChild(msg); box.appendChild(ok); box.appendChild(no);
  }

  async function refreshInfo() {
    try {
      state.info = await api.tiersInfo();
    } catch (e) {
      state.info = null;
    }
    renderCards();
  }

  async function ensureLoaded() {
    await refreshInfo();
  }

  function render() {
    renderCards();
    if (state.pick && state.preview) { showPendingBar(state.preview); renderList(state.preview); }
  }

  $('tierReload').addEventListener('click', async () => {
    hidePending();
    await refreshInfo();
  });
  $('tierRestore').addEventListener('click', () => showRestore());

  window.tiers = { ensureLoaded, render, refreshInfo, gameText, gpuValueText, tierName, groupText };
})();
