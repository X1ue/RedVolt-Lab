'use strict';
// 电源优化页：三档电源计划（标准 / 高性能 / 卓越性能）+ 本机其他方案（自建 / 改版系统自带），读写都走 powercfg，应用前二次确认。
(function () {
  const api = window.optimizer;
  const $ = (id) => document.getElementById(id);

  const TEXT = {
    zh: {
      opts: {
        balanced: { name: '标准', desc: 'Windows 平衡方案：按负载调频，日常安静省电' },
        high: { name: '高性能', desc: '处理器与显卡倾向高频，游戏帧数更稳，风扇更响' },
        ultimate: { name: '卓越性能', desc: '最高档位：尽量维持最高频率，适合竞技游戏与重负载' },
      },
      stGuid: '本机已有',
      stName: '本机已有（同名方案）',
      stCreate: '应用时自动创建',
      stNo: '不可用：系统已移除该模板',
      stActive: '当前使用中',
      pick: (n) => '将把系统电源计划切换为：' + n,
      pickCreate: (n) => '将创建并启用电源计划：' + n,
      already: '（当前已是该档位，应用后不会改变）',
      apply: '应用',
      cancel: '取消',
      done: (n) => '已切换到「' + n + '」',
      unchanged: '当前已是该档位，无需切换',
      fail: (m) => '切换失败：' + m,
      loadFail: (m) => '读取电源计划失败：' + m,
      extra: '本机其他电源计划（自建方案或改版系统自带，如 AtlasOS，可直接切换）',
      stPick: '点选后可切换',
      unknown: '未知方案',
    },
    en: {
      opts: {
        balanced: { name: 'Balanced', desc: 'Windows balanced plan: clocks follow the load, quiet and efficient' },
        high: { name: 'High performance', desc: 'CPU/GPU favour high clocks: steadier frames, louder fans' },
        ultimate: { name: 'Ultimate Performance', desc: 'Top tier: holds maximum clocks, for competitive games and heavy loads' },
      },
      stGuid: 'Available on this PC',
      stName: 'Available (same-name plan)',
      stCreate: 'Will be created on apply',
      stNo: 'Unavailable: template removed by this OS',
      stActive: 'Currently active',
      pick: (n) => 'Switch the system power plan to: ' + n,
      pickCreate: (n) => 'Create and activate power plan: ' + n,
      already: ' (already active; applying changes nothing)',
      apply: 'Apply',
      cancel: 'Cancel',
      done: (n) => 'Switched to "' + n + '"',
      unchanged: 'Already on this tier, nothing to do',
      fail: (m) => 'Switch failed: ' + m,
      loadFail: (m) => 'Failed to read power plans: ' + m,
      extra: 'Other plans on this PC (custom or from a modified OS like AtlasOS — switchable)',
      stPick: 'Select to switch',
      unknown: 'Unknown plan',
    },
  };

  const ORDER = ['balanced', 'high', 'ultimate'];
  // 系统方案名的英文对照（英文界面下显示，中文界面原样）
  const NAME_MAP = {
    '平衡': 'Balanced',
    '高性能': 'High performance',
    '卓越性能': 'Ultimate Performance',
    '节能': 'Power saver',
    '最小电源管理': 'Power saver',
  };
  const state = { loaded: false, data: null, pending: null, busy: false };

  function t() { return TEXT[(window.i18n && window.i18n.lang === 'en') ? 'en' : 'zh']; }
  function isEn() { return !!(window.i18n && window.i18n.lang === 'en'); }
  function dispName(n) { const s = String(n || ''); return isEn() ? (NAME_MAP[s] || s) : s; }
  function el(tag, cls) { const n = document.createElement(tag); if (cls) n.className = cls; return n; }

  function targetOf(guid) {
    if (!guid || !state.data) return null;
    for (const k of ORDER) {
      const s = state.data.targets[k];
      if (s && s.present && s.guid === guid) return k;
    }
    return null;
  }

  function render() {
    const T = t();
    const d = state.data;
    const curName = $('powerCurName');
    const curGuid = $('powerCurGuid');
    const activeKey = d ? targetOf(d.active ? d.active.guid : null) : null;
    if (!d) { curName.textContent = '—'; curGuid.textContent = ''; }
    else {
      curName.textContent = activeKey ? T.opts[activeKey].name : dispName((d.active && d.active.name) || T.unknown);
      curGuid.textContent = d.active ? d.active.guid : '';
    }

    const host = $('powerOpts');
    host.textContent = '';
    if (!d) return;

    for (const key of ORDER) {
      const o = T.opts[key];
      const st = d.targets[key];
      const card = el('label', 'power-card' + (key === activeKey ? ' active' : '') + (st.present || st.creatable ? '' : ' off'));
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'powerOpt';
      radio.value = key;
      radio.checked = state.pending === key;
      radio.disabled = !(st.present || st.creatable);
      radio.addEventListener('change', () => { if (radio.checked) showPending(key); });
      card.appendChild(radio);

      const body = el('div', 'power-card-body');
      const name = el('strong', 'power-name');
      name.textContent = o.name;
      const desc = el('span', 'power-desc');
      desc.textContent = o.desc;
      const line = el('span', 'power-state');
      line.textContent = key === activeKey ? T.stActive : st.present ? (st.how === 'guid' ? T.stGuid : T.stName) : st.creatable ? T.stCreate : T.stNo;
      body.appendChild(name); body.appendChild(desc); body.appendChild(line);
      card.appendChild(body);
      host.appendChild(card);
    }

    const extra = $('powerExtra');
    const others = d.schemes.filter((s) => !targetOf(s.guid));
    if (others.length) {
      extra.classList.remove('hidden');
      extra.textContent = '';
      const head = el('div', 'power-extra-head');
      head.textContent = T.extra;
      extra.appendChild(head);
      const activeGuid = d.active ? d.active.guid : null;
      for (const s of others) {
        const gid = 'guid:' + s.guid;
        const label = el('label', 'power-extra-row' + (s.guid === activeGuid ? ' active' : ''));
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'powerOpt';
        radio.value = gid;
        radio.checked = state.pending === gid;
        radio.addEventListener('change', () => { if (radio.checked) showPendingGuid(s); });
        label.appendChild(radio);
        const body = el('div', 'power-extra-body');
        const nm = el('strong', 'power-extra-name');
        nm.textContent = dispName(s.name || T.unknown);
        const st = el('span', 'power-extra-state');
        st.textContent = s.guid === activeGuid ? T.stActive : T.stPick;
        const gd = el('span', 'power-extra-guid');
        gd.textContent = s.guid;
        body.appendChild(nm); body.appendChild(st); body.appendChild(gd);
        label.appendChild(body);
        extra.appendChild(label);
      }
    } else {
      extra.classList.add('hidden');
      extra.textContent = '';
    }
  }

  function hidePending() {
    state.pending = null;
    const box = $('powerPending');
    box.classList.add('hidden');
    box.textContent = '';
  }

  function showPending(key) {
    const T = t();
    const st = state.data.targets[key];
    const isActive = targetOf(state.data.active ? state.data.active.guid : null) === key;
    const box = $('powerPending');
    box.classList.remove('hidden');
    box.textContent = '';
    const msg = document.createElement('span');
    msg.textContent = (st.present ? T.pick(T.opts[key].name) : T.pickCreate(T.opts[key].name)) + (isActive ? T.already : '');
    const ok = el('button', 'btn primary small');
    ok.textContent = T.apply;
    const no = el('button', 'btn ghost small');
    no.textContent = T.cancel;
    ok.addEventListener('click', () => doApply(key));
    no.addEventListener('click', () => { hidePending(); render(); });
    box.appendChild(msg); box.appendChild(ok); box.appendChild(no);
    state.pending = key;
  }

  async function doApply(key) {
    if (state.busy) return;
    state.busy = true;
    const T = t();
    try {
      const r = await api.powerSet(key, true);
      hidePending();
      if (r && r.ok) {
        state.data = r.schemes && r.targets ? r : await load();
        status(r.unchanged ? T.unchanged : T.done(T.opts[key].name), 'ok');
      } else {
        status(T.fail((r && r.message) || '?'), 'err');
      }
      render();
    } catch (e) {
      hidePending();
      status(T.fail(e && e.message ? e.message : String(e)), 'err');
    } finally {
      state.busy = false;
    }
  }

  function showPendingGuid(s) {
    const T = t();
    const gid = 'guid:' + s.guid;
    const isActive = !!(state.data.active && state.data.active.guid === s.guid);
    const box = $('powerPending');
    box.classList.remove('hidden');
    box.textContent = '';
    const msg = document.createElement('span');
    msg.textContent = T.pick(dispName(s.name || T.unknown)) + (isActive ? T.already : '');
    const ok = el('button', 'btn primary small');
    ok.textContent = T.apply;
    const no = el('button', 'btn ghost small');
    no.textContent = T.cancel;
    ok.addEventListener('click', () => doApplyGuid(s));
    no.addEventListener('click', () => { hidePending(); render(); });
    box.appendChild(msg); box.appendChild(ok); box.appendChild(no);
    state.pending = gid;
  }

  async function doApplyGuid(s) {
    if (state.busy) return;
    state.busy = true;
    const T = t();
    try {
      const r = await api.powerSetGuid(s.guid, true);
      hidePending();
      if (r && r.ok) {
        state.data = r.schemes && r.targets ? r : await load();
        status(r.unchanged ? T.unchanged : T.done(dispName(s.name || T.unknown)), 'ok');
      } else {
        status(T.fail((r && r.message) || '?'), 'err');
      }
      render();
    } catch (e) {
      hidePending();
      status(T.fail(e && e.message ? e.message : String(e)), 'err');
    } finally {
      state.busy = false;
    }
  }

  function status(text, cls) {
    const bar = document.querySelector('#tab-power .power-head');
    if (!bar) return;
    let s = bar.querySelector('.power-status');
    if (!s) { s = el('span', 'power-status'); bar.insertBefore(s, bar.querySelector('.spacer')); }
    s.textContent = text;
    s.className = 'power-status ' + (cls || '');
    setTimeout(() => { if (s.parentNode) s.textContent = ''; }, 6000);
  }

  async function load() {
    const d = await api.powerGet();
    if (!d || d.ok === false) {
      state.data = null;
      status(t().loadFail((d && d.message) || '?'), 'err');
      return null;
    }
    state.data = d;
    return d;
  }

  async function ensureLoaded() {
    hidePending();
    if (state.loaded) { render(); return; }
    state.loaded = true;
    await load();
    render();
  }

  async function reload() { hidePending(); await load(); render(); }

  $('powerReload').addEventListener('click', reload);

  window.power = { ensureLoaded, render, reload, dispName };
})();
