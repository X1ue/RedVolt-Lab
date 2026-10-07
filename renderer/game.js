'use strict';
// 游戏开关页：只读回白名单注册表值，改动前先备份、再二次确认；HAGS 需要管理员授权并重启生效。
(function () {
  const api = window.optimizer;
  const $ = (id) => document.getElementById(id);

  const TEXT = {
    zh: {
      head: '游戏相关系统开关',
      items: {
        hags: { name: '硬件加速 GPU 计划（HAGS）', desc: '由显卡自行管理显存调度，部分游戏帧生成更稳；改完必须重启电脑才生效' },
        gamedvr: { name: '游戏录制（Game DVR）', desc: '后台录制与截图会持续占用显卡和磁盘，纯玩游戏建议关掉' },
        gamebar: { name: 'Xbox 游戏栏', desc: 'Win+G 呼出的浮层和开机提示面板，关掉可减少一层系统叠加' },
        gamemode: { name: '游戏模式', desc: '系统检测到游戏时优先分配资源；关掉可避免后台调度插手' },
        transparency: { name: '窗口透明效果', desc: '任务栏与窗口的透明/亚克力效果，关掉能省一点显卡开销' },
        visualfx: { name: '视觉效果', desc: 'Windows 的动画、阴影等外观效果，性能优先可设为「最佳性能」' },
      },
      fx: { absent: '让 Windows 选择（默认）', 1: '最佳外观', 2: '最佳性能', 3: '自定义' },
      st: { on: '已开启', off: '已关闭', mixed: '部分开启', absent: '系统默认', unknown: '未知' },
      btnOn: '开', btnOff: '关', btnDefault: '恢复默认',
      pick: (n, from, to) => '将把「' + n + '」由 ' + from + ' 改为 ' + to,
      needAdmin: '（需要管理员授权，会弹一次 UAC）',
      needReboot: '（生效需要重启电脑）',
      pendReboot: '改过了，重启后才生效',
      apply: '应用', cancel: '取消',
      done: (n) => '已修改「' + n + '」',
      unchanged: '当前已是该状态，无需修改',
      fail: (m) => '修改失败：' + m,
      loadFail: (m) => '读取系统开关失败：' + m,
      restore: (n) => '还原到修改前（' + n + ' 项）',
      restorePick: (n) => '将把 ' + n + ' 项开关还原到你修改之前的值',
      restoreDone: (n) => '已还原 ' + n + ' 项',
      restoreNone: '还没有备份，无需还原',
      backedUp: '已备份原值',
      sum: (total, on) => '共 ' + total + ' 项 · 已开启 ' + on + ' 项',
    },
    en: {
      head: 'Gaming-related system switches',
      items: {
        hags: { name: 'Hardware-accelerated GPU scheduling (HAGS)', desc: 'The GPU manages its own memory scheduling; steadier frame pacing in some games. A reboot is required' },
        gamedvr: { name: 'Game recording (Game DVR)', desc: 'Background recording and captures keep using GPU and disk; turn off for pure gaming' },
        gamebar: { name: 'Xbox Game Bar', desc: 'The Win+G overlay and its startup panel; turning it off removes one system layer' },
        gamemode: { name: 'Game Mode', desc: 'Windows prioritises resources for games; off avoids background scheduling interference' },
        transparency: { name: 'Transparency effects', desc: 'Taskbar and window transparency/acrylic; off saves a little GPU work' },
        visualfx: { name: 'Visual effects', desc: 'Windows animations and shadows; choose "Best performance" to favour frames' },
      },
      fx: { absent: 'Let Windows choose (default)', 1: 'Best appearance', 2: 'Best performance', 3: 'Custom' },
      st: { on: 'On', off: 'Off', mixed: 'Partly on', absent: 'System default', unknown: 'Unknown' },
      btnOn: 'On', btnOff: 'Off', btnDefault: 'Restore default',
      pick: (n, from, to) => 'Change "' + n + '" from ' + from + ' to ' + to,
      needAdmin: ' (needs administrator approval — one UAC prompt)',
      needReboot: ' (a reboot is required to take effect)',
      pendReboot: 'Changed — takes effect after a reboot',
      apply: 'Apply', cancel: 'Cancel',
      done: (n) => 'Changed "' + n + '"',
      unchanged: 'Already in this state, nothing to do',
      fail: (m) => 'Change failed: ' + m,
      loadFail: (m) => 'Failed to read system switches: ' + m,
      restore: (n) => 'Restore pre-change values (' + n + ')',
      restorePick: (n) => 'Restore ' + n + ' switch(es) to the values recorded before your changes',
      restoreDone: (n) => 'Restored ' + n + ' item(s)',
      restoreNone: 'No backup yet, nothing to restore',
      backedUp: 'Original value backed up',
      sum: (total, on) => total + ' switches · ' + on + ' on',
    },
  };

  const state = { loaded: false, data: null, pending: null, busy: false };

  function t() { return TEXT[(window.i18n && window.i18n.lang === 'en') ? 'en' : 'zh']; }
  function el(tag, cls) { const n = document.createElement(tag); if (cls) n.className = cls; return n; }

  function itemOf(id) {
    return (state.data && state.data.switches || []).filter((s) => s.id === id)[0] || null;
  }

  function stateLabel(sw) {
    const T = t();
    if (sw.kind === 'select') return T.fx[String(sw.state)] || T.st.unknown;
    return T.st[sw.state] || T.st.unknown;
  }

  function targetLabel(sw, mode) {
    const T = t();
    if (sw.kind === 'select') return mode === 'default' ? T.fx.absent : (T.fx[String(mode)] || T.st.unknown);
    if (mode === 'default') return T.st.absent;
    return mode === 'on' ? T.st.on : T.st.off;
  }

  function render() {
    const T = t();
    const d = state.data;
    const host = $('gameList');
    const sum = $('gameSummary');
    const restore = $('gameRestore');
    host.textContent = '';
    if (!d) { sum.textContent = '—'; restore.classList.add('hidden'); return; }

    const on = d.switches.filter((s) => s.state === 'on').length;
    sum.textContent = T.sum(d.switches.length, on);
    if (d.backupCount) {
      restore.classList.remove('hidden');
      restore.textContent = T.restore(d.backupCount);
    } else {
      restore.classList.add('hidden');
    }

    for (const sw of d.switches) {
      const meta = T.items[sw.id] || { name: sw.id, desc: '' };
      const row = el('div', 'game-row');
      const body = el('div', 'game-body');
      const name = el('strong', 'game-name');
      name.textContent = meta.name;
      const desc = el('span', 'game-desc');
      desc.textContent = meta.desc;
      body.appendChild(name); body.appendChild(desc);
      row.appendChild(body);

      const cur = el('span', 'badge' + (sw.kind === 'select' ? '' : sw.state === 'on' ? ' safe' : ' off'));
      cur.textContent = stateLabel(sw);
      row.appendChild(cur);
      if (sw.backedUp) {
        const b = el('span', 'badge caution');
        b.textContent = T.backedUp;
        row.appendChild(b);
      }
      // 状态徽章是注册表里的值，写下去不等于本次会话生效；没重启就明说还没生效
      if (sw.pendingReboot) {
        const p = el('span', 'badge caution');
        p.textContent = T.pendReboot;
        row.appendChild(p);
      }
      if (sw.admin) {
        const a = el('span', 'badge admin');
        a.textContent = 'UAC';
        row.appendChild(a);
      }

      const acts = el('div', 'game-acts');
      if (sw.kind === 'select') {
        const sel = document.createElement('select');
        sel.className = 'game-sel';
        for (const code of sw.options || []) {
          const o = document.createElement('option');
          o.value = String(code);
          o.textContent = T.fx[String(code)] || String(code);
          sel.appendChild(o);
        }
        sel.value = String(sw.state);
        sel.addEventListener('change', () => {
          const mode = sel.value === 'absent' ? 'default' : Number(sel.value);
          showPending(sw.id, mode);
        });
        acts.appendChild(sel);
      } else {
        const mk = (label, mode, cls) => {
          const b = el('button', 'btn small ' + cls);
          b.textContent = label;
          b.disabled = state.busy;
          b.addEventListener('click', () => showPending(sw.id, mode));
          acts.appendChild(b);
        };
        mk(T.btnOn, 'on', 'ghost');
        mk(T.btnOff, 'off', 'ghost');
        mk(T.btnDefault, 'default', 'ghost');
      }
      row.appendChild(acts);
      host.appendChild(row);
    }
  }

  function hidePending() {
    state.pending = null;
    const box = $('gamePending');
    box.classList.add('hidden');
    box.textContent = '';
  }

  function showPending(id, mode) {
    const T = t();
    const sw = itemOf(id);
    if (!sw) return;
    const meta = T.items[id] || { name: id };
    const box = $('gamePending');
    box.classList.remove('hidden');
    box.textContent = '';
    const msg = document.createElement('span');
    msg.textContent = T.pick(meta.name, stateLabel(sw), targetLabel(sw, mode))
      + (sw.admin ? T.needAdmin : '') + (sw.reboot ? T.needReboot : '');
    const ok = el('button', 'btn primary small');
    ok.textContent = T.apply;
    const no = el('button', 'btn ghost small');
    no.textContent = T.cancel;
    ok.addEventListener('click', () => doApply(id, mode));
    no.addEventListener('click', () => { hidePending(); render(); });
    box.appendChild(msg); box.appendChild(ok); box.appendChild(no);
    state.pending = id + ':' + mode;
  }

  function showRestorePending() {
    const T = t();
    const d = state.data;
    if (!d || !d.backupCount) { status(T.restoreNone, 'err'); return; }
    const box = $('gamePending');
    box.classList.remove('hidden');
    box.textContent = '';
    const msg = document.createElement('span');
    msg.textContent = T.restorePick(d.backupCount);
    const ok = el('button', 'btn primary small');
    ok.textContent = T.apply;
    const no = el('button', 'btn ghost small');
    no.textContent = T.cancel;
    ok.addEventListener('click', async () => {
      if (state.busy) return;
      state.busy = true;
      try {
        const r = await api.gameRestore(true);
        hidePending();
        if (r && r.ok) { status(T.restoreDone(r.restored || 0), 'ok'); await load(); }
        else status(T.fail((r && r.message) || '?'), 'err');
        render();
      } catch (e) {
        hidePending();
        status(T.fail(e && e.message ? e.message : String(e)), 'err');
      } finally { state.busy = false; }
    });
    no.addEventListener('click', () => { hidePending(); render(); });
    box.appendChild(msg); box.appendChild(ok); box.appendChild(no);
    state.pending = 'restore';
  }

  async function doApply(id, mode) {
    if (state.busy) return;
    state.busy = true;
    const T = t();
    try {
      const r = await api.gameApply(id, mode, true);
      hidePending();
      if (r && r.ok) {
        if (r.unchanged) status(T.unchanged, 'ok');
        else {
          const meta = T.items[id] || { name: id };
          status(T.done(meta.name), 'ok');
        }
        await load();
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
    const bar = document.querySelector('#tab-game .power-head');
    if (!bar) return;
    let s = bar.querySelector('.power-status');
    if (!s) { s = el('span', 'power-status'); bar.insertBefore(s, bar.querySelector('.spacer')); }
    s.textContent = text;
    s.className = 'power-status ' + (cls || '');
    setTimeout(() => { if (s.parentNode) s.textContent = ''; }, 6000);
  }

  async function load() {
    const d = await api.gameGet();
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

  $('gameReload').addEventListener('click', reload);
  $('gameRestore').addEventListener('click', () => showRestorePending());

  window.game = { ensureLoaded, render, reload, words: t, stateLabel, targetLabel };
})();
