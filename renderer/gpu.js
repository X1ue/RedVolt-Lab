'use strict';
/** 显卡优化页：左侧只列本机存在的程序（可展开全部驱动方案），右侧 NVIDIA 3D 设置项。写入前需用户在待确认条上点「应用」。 */
(function () {
  const api = window.optimizer;
  const $ = (id) => document.getElementById(id);
  const RENDER_CAP = 400;

  const TEXT = {
    zh: {
      global: '全局设置',
      groupGlobal: '全局设置',
      groupMine: '用户自建方案',
      groupLocal: '本机检测到的程序',
      groupAll: '驱动内置方案',
      groupDead: '已失效的方案（程序已卸载或路径变了）',
      unsupported: '未检测到 NVIDIA 显卡驱动（NVAPI 不可用），显卡优化暂不可用。',
      amdTitle: '显卡优化 · A卡版',
      editionAmd: 'A卡版',
      editionOther: '非N卡',
      amdDetected: '已识别到本机显卡',
      amdDriver: '驱动版本',
      amdMode: '当前显示',
      amdLoad: '实时 3D 占用',
      amdLoadWait: '采集中…',
      amdNoNvapi: '本页的 3D 参数（电源管理、低延迟、垂直同步等）是通过 NVIDIA 驱动自带的 NVAPI 配置接口读写的，AMD 驱动没有对应的公开接口，因此不能像 N 卡那样在软件里直接改。',
      amdWhere: 'A 卡的同名开关在「AMD Software: Adrenalin Edition」里：快捷键 Alt+R → 游戏 / 图形 → 全局图形，逐项名称与本页一致（ Radeon Anti-Lag ≈ 低延迟模式、Radeon Chill ≈ 帧率上限、等待垂直刷新 ≈ 垂直同步）。',
      amdSafe: 'A卡版只读取显卡信息，不会改动 AMD 驱动或注册表的任何设置。首页的实时监控对 A 卡同样有效。',
      otherTitle: '显卡优化',
      otherNoNvapi: (n) => `本机显卡为「${n}」，不是 NVIDIA，驱动 3D 配置接口（NVAPI）不可用，因此本页不提供可写入的调优项。`,
      noneNoNvapi: '没有检测到任何显示适配器（远程桌面或虚拟机里常见），显卡优化不可用。',
      noItems: '当前驱动没有暴露可调节的 3D 设置项。',
      groupCommon: '常用设置',
      groupWritable: '其他可写入设置',
      groupReadOnly: '只读（本机驱动没给出可选取值，或取值名称尚未核对，不提供下拉写入）',
      curVal: '当前',
      defVal: '驱动默认',
      notSet: '未覆盖',
      noMatch: '没有匹配的设置项',
      showAllSets: (n) => `显示驱动全部 ${n} 项设置`,
      hideAllSets: '只看可修改的设置',
      setPh: '搜索设置项…',
      localEmpty: '没有检测到已安装的程序。点「＋ 添加程序」可以手动为某个 exe 建立方案。',
      none: '没有匹配的方案',
      scanning: '正在扫描本机程序（首次约几秒）…',
      scanFailed: '扫描本机程序失败，可点「重新读取」再试；驱动内置方案仍可展开查看。',
      defOpt: '默认（不覆盖）',
      otherOpt: '其他',
      pending: (s, v) => `将写入 NVIDIA 驱动配置：${s} → ${v}`,
      resetPending: (s) => `将恢复默认：${s}（删除该配置项的覆盖值）`,
      addPending: (n) => `将为「${n}」创建 NVIDIA 驱动配置方案（只写驱动配置，不动任何文件）`,
      delPending: (n) => `将从 NVIDIA 驱动配置中删除你自己添加的方案「${n}」（含该方案内的所有 3D 覆盖值；驱动内置方案不会被删除）`,
      apply: '应用',
      cancel: '取消',
      busy: '处理中…',
      applied: '已应用',
      failed: (e) => '失败：' + e,
      loadFailed: '读取驱动配置失败',
      writeFailed: '写入 NVIDIA 驱动配置失败（驱动可能不允许修改该方案）',
      many: (n, cap) => `共 ${n} 个配置方案，已显示前 ${cap} 个；输入关键词可精确筛选`,
      settings: {
        power: '电源管理模式',
        lowLatency: '低延迟模式',
        vsync: '垂直同步',
        prerender: '最大预渲染帧数',
        textureQuality: '纹理过滤 - 质量',
      },
      values: {
        optimal: '最优（推荐）', adaptive: '自适应', consistent: '正常', max: '最高', min: '最低',
        ultra: '超级', on: '开', off: '关', app: '使用 3D 应用程序设置',
        half: '开：1/2 刷新率', third: '开：1/3 刷新率', quarter: '开：1/4 刷新率',
        n1: '1', n2: '2', n3: '3', n4: '4', n5: '5', n6: '6',
        highPerf: '高性能', perf: '性能', quality: '质量', highQuality: '高质量',
      },
    },
    en: {
      global: 'Global settings',
      groupGlobal: 'Global settings',
      groupMine: 'User-created profiles',
      groupLocal: 'Detected on this PC',
      groupAll: 'Built-in driver profiles',
      groupDead: 'Stale profiles (program uninstalled or moved)',
      unsupported: 'No NVIDIA driver (NVAPI) detected — GPU tuning is unavailable.',
      amdTitle: 'GPU Tuning · AMD Edition',
      editionAmd: 'AMD',
      editionOther: 'Non-NVIDIA',
      amdDetected: 'Detected GPU',
      amdDriver: 'Driver',
      amdMode: 'Display mode',
      amdLoad: 'Live 3D load',
      amdLoadWait: 'Sampling…',
      amdNoNvapi: 'The 3D settings on this page (power management, low latency, vertical sync, …) are read and written through NVIDIA\'s NVAPI driver interface. AMD drivers expose no equivalent public API, so they cannot be changed here the way N-card settings can.',
      amdWhere: 'The equivalent AMD switches live in AMD Software: Adrenalin Edition — Alt+R → Gaming / Graphics → Global Graphics. The names line up with this page (Radeon Anti-Lag ≈ Low-Latency Mode, Radeon Chill ≈ frame-rate limit, Wait for Vertical Refresh ≈ Vertical sync).',
      amdSafe: 'The AMD edition only reads GPU information; it never changes AMD driver or registry settings. Live GPU monitoring on the Home tab works for AMD cards too.',
      otherTitle: 'GPU Tuning',
      otherNoNvapi: (n) => `This PC uses "${n}", which is not NVIDIA, so the driver 3D settings interface (NVAPI) is unavailable and no writable tuning options are shown.`,
      noneNoNvapi: 'No display adapter was detected (typical for Remote Desktop or a VM), so GPU tuning is unavailable.',
      noItems: 'This driver exposes no adjustable 3D settings.',
      groupCommon: 'Common settings',
      groupWritable: 'Other writable settings',
      groupReadOnly: 'Read-only (this driver lists no selectable values, or the value names are not verified yet)',
      curVal: 'current',
      defVal: 'driver default',
      notSet: 'not overridden',
      noMatch: 'No matching setting',
      showAllSets: (n) => `Show all ${n} driver settings`,
      hideAllSets: 'Show writable only',
      setPh: 'Search settings…',
      localEmpty: 'No installed programs detected. Use "+ Add program" to create a profile for an exe yourself.',
      none: 'No matching profile',
      scanning: 'Scanning local programs (a few seconds on first run)…',
      scanFailed: 'Could not scan local programs — "Reload" to try again; built-in driver profiles can still be shown.',
      defOpt: 'Default (no override)',
      otherOpt: 'Other',
      pending: (s, v) => `Will write to NVIDIA driver settings: ${s} → ${v}`,
      resetPending: (s) => `Will restore default: ${s} (remove this override)`,
      addPending: (n) => `Will create an NVIDIA driver profile for "${n}" (driver settings only, no files touched)`,
      delPending: (n) => `Will delete your own driver profile "${n}" (including every 3D override stored in it; built-in driver profiles can never be deleted)`,
      apply: 'Apply',
      cancel: 'Cancel',
      busy: 'Working…',
      applied: 'Applied',
      failed: (e) => 'Failed: ' + e,
      loadFailed: 'Failed to read driver settings',
      writeFailed: 'Could not write to the NVIDIA driver (this profile may be read-only)',
      many: (n, cap) => `${n} driver profiles in total — showing the first ${cap}; type a keyword to narrow down`,
      settings: {
        power: 'Power management mode',
        lowLatency: 'Low-Latency Mode',
        vsync: 'Vertical sync',
        prerender: 'Max pre-rendered frames',
        textureQuality: 'Texture filtering - Quality',
      },
      values: {
        optimal: 'Optimal (recommended)', adaptive: 'Adaptive', consistent: 'Normal', max: 'Prefer maximum', min: 'Prefer minimum',
        ultra: 'Ultra', on: 'On', off: 'Off', app: 'Use the 3D application setting',
        half: 'On: half refresh rate', third: 'On: 1/3 refresh rate', quarter: 'On: 1/4 refresh rate',
        n1: '1', n2: '2', n3: '3', n4: '4', n5: '5', n6: '6',
        highPerf: 'High-performance', perf: 'Performance', quality: 'Quality', highQuality: 'High quality',
      },
    },
  };

  const state = {
    loaded: false,
    meta: null,
    hw: null,
    local: null,
    scanFailed: false,
    scanning: false,
    showAll: false,
    profiles: [],
    profilesLoading: false,
    spec: 'global',
    specName: '',
    profileName: null,
    catalog: null,
    vals: null,
    showSets: false,
    setQuery: '',
    pending: null,
    pendingAdd: null,
    pendingDel: null,
    icons: {},
    iconBusy: false,
    busy: false,
    notice: null,
    hwLoad: null,
  };

  let hwTimer = null;

  function t() { return TEXT[(window.i18n && window.i18n.lang === 'en') ? 'en' : 'zh']; }

  function setEdition(text) {
    const el = $('gpuEdition');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('hidden', !text);
  }

  function baseName(p) {
    const leaf = String(p || '').split(/[\\/]/).pop() || String(p || '');
    return leaf.replace(/\.exe$/i, '');
  }

  function globalItem() {
    return { key: 'global', spec: 'global', specName: '', label: t().global, glyph: '⚙', icon: null, sub: '', title: '', group: 'g' };
  }

  function localRows() {
    const list = state.local || [];
    const mine = [];
    const found = [];
    const dead = [];
    for (const it of list) {
      const row = {
        key: it.spec,
        spec: it.spec,
        specName: it.name,
        label: it.label || it.name,

        sub: it.appEntry || '',
        title: it.exe || '',
        exists: it.exists !== false,
        glyph: it.isPredefined ? '🎮' : '★',
        icon: null,
        group: it.exists === false ? 'x' : (it.isPredefined ? 'l' : 'm'),
      };
      row.icon = state.icons[String(it.exe || '').toLowerCase()] || null;
      (row.group === 'x' ? dead : (it.isPredefined ? found : mine)).push(row);
    }
    return { mine, found, dead };
  }

  function exeFor(name) {
    const hit = (state.local || []).find((it) => it.name === name);
    if (!hit) return null;
    return { sub: hit.appEntry || '', title: hit.exe || '', icon: state.icons[String(hit.exe || '').toLowerCase()] || null, exists: hit.exists !== false };
  }

  function allRows() {
    const rows = [];
    for (const p of state.profiles) {
      if (p.error) continue;
      const known = p.isGlobal ? null : exeFor(p.name);
      rows.push({
        key: 'idx:' + p.index,
        spec: p.isGlobal ? 'global' : 'idx:' + p.index,
        specName: p.isGlobal ? '' : (p.name || ''),
        label: p.isGlobal ? t().global : (p.name || '#' + p.index),
        glyph: p.isGlobal ? '⚙' : (!p.isPredefined ? '★' : ((p.numApps || 0) > 0 ? '🎮' : '📁')),
        sub: known ? known.sub : '',
        title: known ? known.title : '',
        icon: known && known.icon ? known.icon : null,
        exists: known ? known.exists : null,
        exists: known ? known.exists : null,
        group: p.isGlobal ? 'g' : (!p.isPredefined ? 'm' : 'a'),
      });
    }
    return rows;
  }

  function currentRows() {
    if (state.showAll) {
      if (state.profiles.length) return allRows();
      const lr = localRows();
      return [globalItem()].concat(lr.mine, lr.found, lr.dead);
    }
    const { mine, found, dead } = localRows();
    return [globalItem()].concat(mine, found, dead);
  }

  function nvReady() {
    if (!state.meta || !state.meta.available) return false;
    if (!state.catalog) return true; // 设置项目录还没读出来，先按可用处理
    return state.catalog.length > 0;
  }

  /** 非 N 卡（或 NVAPI 不可用）时，用 WMI 识别结果展示「A卡版 / 核显版」信息卡，而不是直接判定「没有显卡」 */
  function hwMode() {
    return !nvReady() && !!(state.hw && (state.hw.adapters || []).length);
  }

  function modeRow(a) {
    if (!a.width || !a.height) return '';
    return `${a.width} × ${a.height}` + (a.refresh ? ` @ ${a.refresh} Hz` : '');
  }

  function renderHw() {
    const host = $('gpuAmd');
    const layout = $('gpuLayout');
    const banner = $('gpuBanner');
    banner.textContent = '';
    banner.classList.add('hidden');
    layout.classList.toggle('hidden', true);
    host.classList.remove('hidden');
    host.textContent = '';

    const list = state.hw.adapters || [];
    const amd = state.hw.vendor === 'amd';
    const head = document.createElement('div');
    head.className = 'hw-head';
    head.textContent = amd ? t().amdTitle : t().otherTitle;
    host.appendChild(head);

    const label = document.createElement('div');
    label.className = 'hw-label';
    label.textContent = t().amdDetected;
    host.appendChild(label);

    for (const a of list) {
      const card = document.createElement('div');
      card.className = 'hw-card' + (state.hw.primary && a.name === state.hw.primary.name ? ' main' : '');
      const nm = document.createElement('div');
      nm.className = 'hw-name';
      nm.textContent = a.name;
      card.appendChild(nm);
      const meta = [];
      if (a.driver) meta.push(`${t().amdDriver} ${a.driver}`);
      const m = modeRow(a);
      if (m) meta.push(`${t().amdMode} ${m}`);
      if (meta.length) {
        const sub = document.createElement('div');
        sub.className = 'hw-sub';
        sub.textContent = meta.join('  ·  ');
        card.appendChild(sub);
      }
      host.appendChild(card);
    }

    const load = document.createElement('div');
    load.className = 'hw-load';
    const lv = document.createElement('b');
    lv.textContent = state.hwLoad == null ? t().amdLoadWait : Math.round(state.hwLoad) + ' %';
    load.appendChild(document.createTextNode(t().amdLoad + ' '));
    load.appendChild(lv);
    host.appendChild(load);

    const why = document.createElement('p');
    why.className = 'hint';
    why.textContent = amd
      ? t().amdNoNvapi
      : t().otherNoNvapi((state.hw.primary && state.hw.primary.name) || list[0].name);
    host.appendChild(why);

    if (amd) {
      for (const k of ['amdWhere', 'amdSafe']) {
        const p = document.createElement('p');
        p.className = 'hint';
        p.textContent = t()[k];
        host.appendChild(p);
      }
    }
    startHwPoll();
  }

  async function pollHw() {
    if (!hwMode()) return;
    let g = null;
    try {
      const m = await api.metrics();
      g = m && m.gpu;
    } catch (e) {
      g = null;
    }
    state.hwLoad = g && g.load != null ? g.load : null;
    if (hwMode()) renderHw();
  }

  function startHwPoll() {
    if (hwTimer) return;
    pollHw();
    hwTimer = setInterval(() => {
      if (!document.hidden) pollHw();
    }, 2000);
  }

  function stopHwPoll() {
    if (hwTimer) {
      clearInterval(hwTimer);
      hwTimer = null;
    }
  }

  async function ensureLoaded() {
    if (state.loaded) { render(); return; }
    try {
      const meta = await api.gpuMeta();
      state.meta = meta;
      state.hw = { vendor: meta.vendor || null, adapters: meta.adapters || [], primary: null };
      state.hw.primary = (state.hw.adapters || []).find((a) => a.vendor === 'nvidia' || a.vendor === 'amd')
        || state.hw.adapters[0] || null;
      if (!nvReady()) {
        state.loaded = true;
        render();
        if (hwMode()) startHwPoll(); else stopHwPoll();
        return;
      }
      stopHwPoll();
      state.spec = 'global';
      state.specName = '';
      state.loaded = true;
      render();
      await loadCatalog();
      if (!nvReady()) {
        render();
        startHwPoll();
        return;
      }
      await loadLocal(false);
      await loadValues();
      render();
    } catch (e) {
      state.notice = { why: 'load' };
      state.loaded = true;
      render();
    }
  }

  async function loadLocal(force) {
    if (state.scanning) return;
    state.scanning = true;
    render();
    let r = null;
    try {
      r = await api.gpuInstalled(force);
    } catch (e) {
      r = null;
    }
    state.scanning = false;
    if (r && r.ok) {
      state.local = r.items || [];
      state.scanFailed = false;
    } else {
      state.local = state.local || [];
      state.scanFailed = true;
    }
    loadIcons();
    if (state.showAll && !state.profiles.length) await loadProfiles();
  }

  async function loadIcons() {
    if (state.iconBusy) return;
    const paths = (state.local || []).filter((it) => it.exists !== false && it.exe).map((it) => String(it.exe));
    if (!paths.length) return;
    state.iconBusy = true;
    let r = null;
    try {
      r = await api.gpuIcons(paths);
    } catch (e) {
      r = null;
    }
    if (r && r.ok && r.icons) Object.assign(state.icons, r.icons);
    state.iconBusy = false;
    render();
  }

  async function loadProfiles() {
    if (state.profilesLoading) return;
    state.profilesLoading = true;
    render();
    let r = null;
    try {
      r = await api.gpuList();
    } catch (e) {
      r = null;
    }
    if (r && r.ok) {
      state.profiles = sortProfiles(r.profiles || []);
    } else {
      state.profiles = [];
      state.notice = { why: 'load' }; // 全部驱动方案列表读取失败
    }
    state.profilesLoading = false;
    render();
  }

  async function loadValues() {
    const r = await api.gpuGetAll(state.spec, state.specName);
    if (r && r.ok) {
      state.vals = r.values;
      state.profileName = r.profileName || null;
      state.notice = null;
    } else {
      state.vals = null;
      state.notice = { why: 'load' };
    }
  }

  async function loadCatalog() {
    const r = await api.gpuCatalog();
    state.catalog = r && r.ok ? r.items || [] : null;
    if (!state.catalog) state.notice = { why: 'load' };
  }

  function sortProfiles(list) {
    const ok = list.filter((p) => !p.error);
    const name = (p) => (p.name || '').toLowerCase();
    const global = ok.filter((p) => p.isGlobal);
    const user = ok.filter((p) => !p.isGlobal && !p.isPredefined).sort((a, b) => name(a).localeCompare(name(b)));
    const games = ok.filter((p) => !p.isGlobal && p.isPredefined && !/^0x[0-9a-f]+:0x[0-9a-f]+$/i.test(p.name || ''))
      .sort((a, b) => name(a).localeCompare(name(b)));
    const rest = ok.filter((p) => !p.isGlobal && p.isPredefined && /^0x[0-9a-f]+:0x[0-9a-f]+$/i.test(p.name || ''));
    return global.concat(user, games, rest);
  }

  function displayName(row) { return row.label; }

  function isEn() { return !!(window.i18n && window.i18n.lang === 'en'); }

  function settingLabel(item) {
    if (!item) return '';
    if (item.label) return isEn() ? item.label.en : item.label.zh;
    return item.name || item.id;
  }

  function hexOf(code) { return String(code || '').replace(/^0x/, '').toUpperCase(); }

  function valueLabel(opt) {
    if (!opt) return '';
    if (opt.label) return isEn() ? opt.label.en : opt.label.zh;
    return `0x${hexOf(opt.code)}`;
  }

  function currentSetting() {
    if (!state.pending || !state.catalog) return null;
    return state.catalog.find((x) => x.id === state.pending.id) || null;
  }

  function onPick(id, code) {
    if (state.busy) return;
    const item = (state.catalog || []).find((x) => x.id === id);
    if (!item) return;
    if (code === '') {
      state.pending = { id, reset: true };
    } else {
      const opt = item.opts.find((o) => o.code === code);
      if (!opt || !opt.label) return; // 没有核对过中文名的取值一律不给写入
      state.pending = { id, code, value: parseInt(code, 16) >>> 0, text: valueLabel(opt) };
    }
    render();
  }

  async function applyPending() {
    if (state.pendingAdd) return applyAddPending();
    if (state.pendingDel) return applyDelPending();
    const p = state.pending;
    const s = currentSetting();
    if (!p || !s || state.busy) return;
    state.busy = true;
    render();
    let r;
    try {
      r = p.reset ? await api.gpuReset(state.spec, state.specName, s.id, true) : await api.gpuSet(state.spec, state.specName, s.id, p.value, true);
    } catch (e) {
      r = { ok: false, message: String(e) };
    }
    state.busy = false;
    if (r && r.ok) {
      state.pending = null;
      state.notice = null;
      await loadValues();
    } else {
      state.notice = { why: 'write', text: r && r.message };
    }
    render();
  }

  async function pickExe() {
    if (state.busy) return;
    let r;
    try {
      r = await api.gpuPickExe();
    } catch (e) {
      r = { ok: false, message: String(e) };
    }
    if (r && r.ok && r.exe) {
      state.pending = null;
      state.pendingAdd = { exe: r.exe, label: baseName(r.exe) };
    } else if (r && !r.ok && !r.canceled) {
      state.notice = { why: 'write', text: r.message };
    }
    render();
  }

  async function applyAddPending() {
    const a = state.pendingAdd;
    if (!a || state.busy) return;
    state.busy = true;
    render();
    let r;
    try {
      r = await api.gpuAddApp(a.exe, true);
    } catch (e) {
      r = { ok: false, message: String(e) };
    }
    state.busy = false;
    if (r && r.ok) {
      const item = r.item;
      state.pendingAdd = null;
      state.notice = null;
      if (item) {
        state.local = [item].concat((state.local || []).filter((x) => x.name !== item.name));
        state.spec = item.spec;
        state.specName = item.name;
      }
      await loadValues();
    } else {
      state.pendingAdd = null;
      state.notice = { why: 'write', text: r && r.message };
    }
    render();
  }

  async function applyDelPending() {
    const d = state.pendingDel;
    if (!d || state.busy) return;
    state.busy = true;
    render();
    let r;
    try {
      r = await api.gpuDelProfile(d.spec, d.name, true);
    } catch (e) {
      r = { ok: false, message: String(e) };
    }
    state.busy = false;
    if (r && r.ok) {
      state.pendingDel = null;
      state.notice = null;
      state.local = (state.local || []).filter((x) => x.name !== d.name);
      state.spec = 'global';
      state.specName = '';
      await loadValues();
    } else {
      state.pendingDel = null;
      state.notice = { why: 'write', text: r && r.message };
    }
    render();
  }

  function cancelPending() {
    state.pending = null;
    state.pendingAdd = null;
    state.pendingDel = null;
    render();
  }

  function pickRow(row) {
    if (state.busy) return;
    state.spec = row.spec;
    state.specName = row.specName;
    state.pending = null;
    state.pendingAdd = null;
    state.pendingDel = null;
    loadValues().then(render);
  }

  function groupTitle(g) {
    if (g === 'g') return t().groupGlobal;
    if (g === 'm') return t().groupMine;
    if (g === 'l') return t().groupLocal;
    if (g === 'x') return t().groupDead;
    return t().groupAll;
  }

  function render() {
    if (!$('gpuProfiles')) return;
    const host = $('gpuBanner');
    if (hwMode()) {
      const amd = state.hw.vendor === 'amd';
      setEdition(amd ? t().editionAmd : t().editionOther);
      renderHw();
      return;
    }
    $('gpuAmd').classList.add('hidden');
    $('gpuAmd').textContent = '';
    setEdition('');
    const unavailable = !nvReady();
    $('gpuLayout').classList.toggle('hidden', unavailable);
    host.textContent = unavailable
      ? (state.hw && !(state.hw.adapters || []).length ? t().noneNoNvapi : t().unsupported)
      : '';
    host.classList.toggle('hidden', !unavailable);

    const filterEl = $('gpuFilter');
    filterEl.placeholder = (window.i18n && window.i18n.lang === 'en') ? 'Search programs…' : '搜索程序…';
    const setFilterEl = $('gpuSetFilter');
    if (setFilterEl) setFilterEl.placeholder = t().setPh;
    const setShowEl = $('gpuShowSetsLabel');
    if (setShowEl) setShowEl.textContent = t().showAllSets((state.catalog || []).length);

    const rows = unavailable ? [] : currentRows();
    const q = (filterEl.value || '').trim().toLowerCase();
    const hits = rows.filter((r) => !q
      || displayName(r).toLowerCase().includes(q)
      || (r.sub || '').toLowerCase().includes(q)
      || (r.title || '').toLowerCase().includes(q)
      || (r.specName || '').toLowerCase().includes(q));

    const list = $('gpuProfiles');
    list.textContent = '';
    const cap = state.showAll ? RENDER_CAP : 4000;
    let lastGroup = null;
    let shown = 0;
    for (const r of hits.slice(0, cap)) {
      if (r.group !== lastGroup) {
        const head = document.createElement('div');
        head.className = 'gpu-group';
        head.textContent = groupTitle(r.group);
        list.appendChild(head);
        lastGroup = r.group;
      }
      const b = document.createElement('button');
      b.className = 'gpu-profile' + (r.spec === state.spec ? ' active' : '');
      if (r.title) b.title = r.title;
      let ico;
      if (r.icon) {
        ico = document.createElement('img');
        ico.className = 'gico gimg';
        ico.src = 'data:image/png;base64,' + r.icon;
      } else {
        ico = document.createElement('span');
        ico.className = 'gico';
        ico.textContent = r.glyph || (r.group === 'x' ? '⚠' : '📁');
      }
      const body = document.createElement('span');
      body.className = 'gbody';
      const nm = document.createElement('span');
      nm.className = 'gname';
      nm.textContent = displayName(r);
      body.appendChild(nm);
      if (r.sub && r.sub.toLowerCase() !== displayName(r).toLowerCase()) {
        const sub = document.createElement('span');
        sub.className = 'gexe';
        sub.textContent = r.sub;
        body.appendChild(sub);
      }
      b.appendChild(ico);
      b.appendChild(body);
      b.addEventListener('click', () => pickRow(r));
      list.appendChild(b);
      shown++;
    }
    if (hits.length > shown) {
      const tip = document.createElement('div');
      tip.className = 'gpu-more';
      tip.textContent = t().many(hits.length, cap);
      list.appendChild(tip);
    }
    if (!state.scanning && !state.profilesLoading && !unavailable && !hits.length) {
      const tip = document.createElement('div');
      tip.className = 'gpu-more';
      tip.textContent = q || state.showAll ? t().none : t().localEmpty;
      list.appendChild(tip);
    }
    if (state.scanning || state.profilesLoading) {
      const tip = document.createElement('div');
      tip.className = 'gpu-more';
      tip.textContent = state.profilesLoading && !state.scanning ? t().groupAll + '…' : t().scanning;
      list.appendChild(tip);
    } else if (state.scanFailed) {
      const tip = document.createElement('div');
      tip.className = 'gpu-more';
      tip.textContent = t().scanFailed;
      list.appendChild(tip);
    }

    const cur = rows.find((r) => r.spec === state.spec);
    $('gpuProfileName').textContent = cur ? displayName(cur) : (state.profileName || '—');
    const exeEl = $('gpuProfileExe');
    if (exeEl) {
      const parts = [];
      if (cur && cur.sub) parts.push(cur.sub);
      if (cur && cur.title && cur.title.toLowerCase() !== cur.sub.toLowerCase()) parts.push(cur.title);
      exeEl.textContent = parts.join('  ·  ');
    }

    const headIcon = $('gpuProfileIcon');
    if (headIcon) {
      const hi = cur && cur.icon;
      headIcon.classList.toggle('hidden', !hi);
      if (hi) headIcon.src = 'data:image/png;base64,' + hi;
    }

    const delBtn = $('gpuDelProfile');
    if (delBtn) delBtn.classList.toggle('hidden', !(cur && cur.group === 'm' && !state.busy));

    renderSettings();
    renderPending();
  }

  const SET_GROUP_ORDER = { c: 0, w: 1, r: 2 };

  function setGroup(x) {
    if (!x.editable) return 'r';
    return x.common ? 'c' : 'w';
  }

  function setGroupTitle(g) {
    if (g === 'c') return t().groupCommon;
    if (g === 'w') return t().groupWritable;
    return t().groupReadOnly;
  }

  function setRows() {
    const all = state.catalog || [];
    const q = (state.setQuery || '').trim().toLowerCase();
    const rows = all.filter((x) => (state.showSets || x.editable) && (!q
      || settingLabel(x).toLowerCase().includes(q)
      || String(x.name || '').toLowerCase().includes(q)
      || (x.opts || []).some((o) => valueLabel(o).toLowerCase().includes(q))));
    rows.sort((a, b) => {
      const ga = SET_GROUP_ORDER[setGroup(a)];
      const gb = SET_GROUP_ORDER[setGroup(b)];
      if (ga !== gb) return ga - gb;
      return settingLabel(a).localeCompare(settingLabel(b));
    });
    return rows;
  }

  function curText(item, cur) {
    if (!cur || cur.value == null) return `${t().notSet} · ${t().defVal} ${item.def || '—'}`;
    const opt = (item.opts || []).find((o) => o.code === cur.value);
    if (opt && opt.label) return valueLabel(opt);
    return `${t().curVal} 0x${hexOf(cur.value)}`;
  }

  function renderSettings() {
    const box = $('gpuSettings');
    box.textContent = '';
    if (!state.catalog || !state.vals) return;
    const rows = setRows();
    let lastGroup = null;
    for (const item of rows) {
      const g = setGroup(item);
      if (g !== lastGroup) {
        const head = document.createElement('div');
        head.className = 'gpu-group';
        head.textContent = setGroupTitle(g);
        box.appendChild(head);
        lastGroup = g;
      }
      const cur = state.vals[item.id];
      const row = document.createElement('div');
      row.className = 'gpu-set' + (g === 'r' ? ' ro' : '');
      const lab = document.createElement('label');
      lab.textContent = settingLabel(item);
      if (item.label && state.showSets) lab.title = `${item.name} · ${item.id}`;
      else lab.title = item.id;
      row.appendChild(lab);
      if (g === 'r') {
        const v = document.createElement('span');
        v.className = 'gpu-ro';
        v.textContent = curText(item, cur);
        row.appendChild(v);
        box.appendChild(row);
        continue;
      }
      const selEl = document.createElement('select');
      const o0 = document.createElement('option');
      o0.value = '';
      o0.textContent = t().defOpt;
      selEl.appendChild(o0);
      for (const o of item.opts) {
        if (!o.label) continue;
        const el = document.createElement('option');
        el.value = o.code;
        el.textContent = valueLabel(o);
        selEl.appendChild(el);
      }
      const known = cur && cur.value != null && item.opts.some((o) => o.code === cur.value && o.label);
      selEl.value = known ? cur.value : '';
      if (cur && cur.value != null && !known) {
        const info = document.createElement('span');
        info.className = 'gpu-ro';
        info.textContent = `0x${hexOf(cur.value)}`;
        row.appendChild(info);
      }
      selEl.addEventListener('change', () => onPick(item.id, selEl.value));
      row.appendChild(selEl);
      box.appendChild(row);
    }
    if (!rows.length) {
      const tip = document.createElement('div');
      tip.className = 'gpu-more';
      tip.textContent = state.setQuery ? t().noMatch : t().noItems;
      box.appendChild(tip);
    }
  }

  function renderPending() {
    const bar = $('gpuPending');
    if (!state.pending && !state.pendingAdd && !state.pendingDel) {
      bar.textContent = '';
      bar.className = 'gpu-pending hidden';
      return;
    }
    const s = currentSetting();
    bar.className = 'gpu-pending';
    bar.textContent = '';
    const msg = document.createElement('span');
    if (state.busy) {
      msg.textContent = t().busy;
    } else if (state.pendingAdd) {
      msg.textContent = t().addPending(state.pendingAdd.label);
    } else if (state.pendingDel) {
      msg.textContent = t().delPending(state.pendingDel.label);
    } else {
      msg.textContent = state.pending.reset ? t().resetPending(settingLabel(s)) : t().pending(settingLabel(s), state.pending.text);
    }
    bar.appendChild(msg);
    const ok = document.createElement('button');
    ok.className = 'btn primary small';
    ok.textContent = t().apply;
    ok.disabled = state.busy;
    ok.addEventListener('click', applyPending);
    const no = document.createElement('button');
    no.className = 'btn ghost small';
    no.textContent = t().cancel;
    no.disabled = state.busy;
    no.addEventListener('click', cancelPending);
    bar.appendChild(ok);
    bar.appendChild(no);
  }

  function renderNotice() {
    if (!state.notice) return;
    const bar = $('gpuPending');
    const msg = document.createElement('span');
    msg.className = 'gpu-error';
    const n = state.notice || {};
    msg.textContent = n.why === 'write'
      ? (n.text ? t().failed(String(n.text)) : t().writeFailed)
      : t().loadFailed;
    if (state.pending || state.pendingAdd || state.pendingDel) {
      bar.appendChild(msg);
    } else {
      bar.className = 'gpu-pending';
      bar.textContent = '';
      bar.appendChild(msg);
    }
    state.notice = null;
  }

  const origRender = render;
  render = function () { origRender(); renderNotice(); };

  async function reloadAll() {
    if (state.busy) return;
    state.profiles = [];
    state.loaded = true;
    $('gpuFilter').value = '';
    await loadLocal(true);
    if (state.showAll) await loadProfiles();
    await loadValues();
    render();
  }

  $('gpuReload').addEventListener('click', reloadAll);

  $('gpuAddApp').addEventListener('click', pickExe);

  $('gpuDelProfile').addEventListener('click', () => {
    if (state.busy || !state.specName) return;
    const row = currentRows().find((r) => r.spec === state.spec);
    if (!row || row.group !== 'm') return;
    state.pending = null;
    state.pendingAdd = null;
    state.pendingDel = { spec: row.spec, name: row.specName, label: row.label };
    render();
  });

  $('gpuShowAll').addEventListener('change', async (e) => {
    state.showAll = !!e.target.checked;
    if (state.showAll && !state.profiles.length) await loadProfiles();
    render();
  });

  $('gpuFilter').addEventListener('input', render);

  $('gpuSetFilter').addEventListener('input', (e) => {
    state.setQuery = e.target.value || '';
    render();
  });

  $('gpuShowSets').addEventListener('change', (e) => {
    state.showSets = !!e.target.checked;
    render();
  });

  window.gpu = { ensureLoaded, renderStatic: render, pause: stopHwPoll, reload: reloadAll };
})();
