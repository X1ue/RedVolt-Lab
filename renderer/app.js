'use strict';

const api = window.optimizer;

const state = {
  targets: [],
  byId: new Map(),
  scan: new Map(),
  selected: new Set(),
  startup: [],
  startupMeta: null,
  infoLoaded: false,
  paths: null,
  busy: false,
  wsAdvice: null,
  drvGroups: null,
  drvPicked: new Set(),
};

const $ = (id) => document.getElementById(id);

// ---------- 通用工具 ----------

function fmtBytes(n) {
  n = Number(n) || 0;
  if (n >= 1073741824) return (n / 1073741824).toFixed(2) + ' GB';
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
  return n + ' B';
}

function fmtDate(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '';
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function fmtUptime(sec) {
  sec = Math.max(0, Math.round(Number(sec) || 0));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return (d ? d + ' 天 ' : '') + h + ' 小时 ' + m + ' 分';
}

// 一律用 textContent 构建 DOM，磁盘上的文件名等外部数据不进入 HTML
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = String(text);
  return e;
}

let statusTimer = null;
function status(msg, kind) {
  const s = $('status');
  s.textContent = msg;
  s.className = 'status' + (kind ? ' ' + kind : '');
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { s.className = 'status hidden'; }, kind ? 7000 : 3500);
}

function setBusy(on, msg) {
  state.busy = on;
  refreshButtons();
  if (msg) status(msg);
}

function statusLabel(r) {
  if (!r) return '未扫描';
  switch (r.status) {
    case 'ok': return '';
    case 'missing': return '不存在，将自动跳过';
    case 'skip': return r.message || '已跳过';
    case 'needs-admin': return '需要管理员权限后扫描';
    case 'refused': return '已被安全规则拒绝';
    default: return r.message || '无法扫描';
  }
}

// ---------- 确认弹窗 ----------

function confirmDialog(opts) {
  return new Promise((resolve) => {
    const modal = $('modal');
    const ok = $('modalOk');
    const cancel = $('modalCancel');
    const ack = $('modalAck');
    const ackWrap = $('modalAckWrap');

    $('modalTitle').textContent = opts.title || '确认操作';
    $('modalDesc').textContent = opts.desc || '';

    const list = $('modalList');
    list.textContent = '';
    for (const it of opts.items || []) {
      const row = el('div', 'modal-item');
      row.appendChild(el('div', 'n', it.name));
      row.appendChild(el('div', 's', it.size !== undefined && it.size !== null ? fmtBytes(it.size) : (it.text || '')));
      list.appendChild(row);
    }

    const requireAck = !!opts.requireAck;
    ack.checked = false;
    ackWrap.classList.toggle('hidden', !requireAck);
    ok.textContent = opts.okText || '确认执行';
    ok.className = 'btn ' + (opts.okClass || 'danger');
    ok.disabled = requireAck;

    const sync = () => { ok.disabled = requireAck && !ack.checked; };
    const close = (val) => {
      modal.classList.add('hidden');
      ack.removeEventListener('change', sync);
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      resolve(val);
    };
    const onOk = () => close(true);
    const onCancel = () => close(false);

    ack.addEventListener('change', sync);
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    modal.classList.remove('hidden');
  });
}

function resultDialog(title, lines, desc) {
  return confirmDialog({
    title,
    desc: desc || '',
    items: lines.map((l) => ({ name: l.name, text: l.text })),
    requireAck: false,
    okText: '知道了',
    okClass: 'primary',
  });
}

// ---------- 标签页 ----------

function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + name));
  if (name === 'home') startMonitor(); else stopMonitor();
  if (name === 'startup' && !state.startup.length) loadStartup();
  if (name === 'gpu' && window.gpu) window.gpu.ensureLoaded();
  if (name === 'power' && window.power) window.power.ensureLoaded();
  if (name === 'game' && window.game) window.game.ensureLoaded();
  if (name !== 'gpu' && window.gpu && window.gpu.pause) window.gpu.pause();
  if (name === 'info') {
    if (!state.infoLoaded) loadInfo();
    // 基线右列默认是实时值，每次进这一页重新采一次
    loadBaseline();
  }
  if (name === 'log') { loadLog(); loadLedger(); }
}

// ---------- 清理项列表 ----------

function renderTargets(group) {
  const host = $(group === 'disk' ? 'diskList' : 'systemList');
  host.textContent = '';
  let section = null;
  for (const t of state.targets.filter((x) => x.group === group)) {
    const sec = t.section || '';
    if (sec !== section) {
      section = sec;
      if (sec) host.appendChild(el('div', 'secLabel', sec));
    }
    host.appendChild(renderRow(t));
  }
}

function renderRow(t) {
  const checked = state.selected.has(t.id);
  const row = el('label', 'row' + (checked ? ' checked' : ''));

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = checked;
  cb.addEventListener('change', () => {
    if (cb.checked) state.selected.add(t.id);
    else state.selected.delete(t.id);
    row.classList.toggle('checked', cb.checked);
    refreshButtons();
  });
  row.appendChild(cb);

  const body = el('div', 'body');
  const head = el('div', 'head');
  head.appendChild(el('span', 'name', t.name));
  head.appendChild(el('span', 'badge ' + (t.level === 'caution' ? 'caution' : 'safe'), t.level === 'caution' ? '注意' : '安全'));
  if (t.admin) head.appendChild(el('span', 'badge admin', '需管理员'));
  body.appendChild(head);
  body.appendChild(el('div', 'note', t.note));

  const r = state.scan.get(t.id);
  const label = statusLabel(r);
  if (label) body.appendChild(el('div', 'examples', label));
  if (r && r.message && r.status === 'ok') body.appendChild(el('div', 'examples', r.message));
  if (r && r.examples && r.examples.length) {
    body.appendChild(el('div', 'examples', '例如: ' + r.examples.join('、')));
  }
  row.appendChild(body);

  const right = el('div', 'right');
  const scannable = r && (r.status === 'ok');
  right.appendChild(el('div', 'size', scannable ? fmtBytes(r.size) : '—'));
  const countParts = [];
  if (scannable) {
    countParts.push(r.count + ' 项');
    const d = fmtDate(r.lastWrite);
    if (d) countParts.push('最新 ' + d);
  }
  right.appendChild(el('div', 'count', countParts.join(' · ') || (r ? '' : '未扫描')));
  row.appendChild(right);

  return row;
}

function hasSelection(group) {
  return state.targets.some((t) => t.group === group && state.selected.has(t.id));
}

function refreshButtons() {
  const busy = state.busy;
  $('diskScan').disabled = busy;
  $('diskClean').disabled = busy || !hasSelection('disk');
  $('sysScan').disabled = busy;
  $('sysClean').disabled = busy || !hasSelection('system');
  $('diskSelectSafe').disabled = busy;
  $('diskSelectNone').disabled = busy;
  $('startupRefresh').disabled = busy;
  $('folderScan').disabled = busy;
  $('logRefresh').disabled = busy;
  if ($('wsAnalyze')) $('wsAnalyze').disabled = busy;
  if ($('wsClean')) $('wsClean').disabled = busy || !wsCanClean();
  if ($('wsResetBase')) $('wsResetBase').disabled = busy || !wsCanClean();
  if ($('drvScan')) $('drvScan').disabled = busy;
  if ($('drvClean')) $('drvClean').disabled = busy || !state.drvPicked.size;
  updateHeroStats();
}

function updateHeroStats() {
  const picked = [...state.selected];
  $('statPicked').textContent = String(picked.length);
  let est = 0;
  let any = false;
  for (const id of picked) {
    const r = state.scan.get(id);
    if (r && r.status === 'ok') { est += Number(r.size) || 0; any = true; }
  }
  $('statEst').textContent = any ? fmtBytes(est) : '—';
}

// ---------- 扫描 ----------

function mergeSystemResults(results, targetsForIds) {
  const merged = new Map();
  for (const r of results || []) {
    const prev = merged.get(r.id);
    const cur = {
      id: r.id,
      status: r.status === 'refused' ? 'refused' : (r.status || 'ok'),
      message: r.message || '',
      size: Number(r.size) || 0,
      count: Number(r.count) || 0,
      lastWrite: r.last || null,
      examples: [],
    };
    if (!prev) { merged.set(r.id, cur); continue; }
    prev.size += cur.size;
    prev.count += cur.count;
    if (prev.status === 'missing' && cur.status === 'ok') prev.status = 'ok';
    if (cur.message && !prev.message) prev.message = cur.message;
  }
  const out = [];
  for (const t of targetsForIds) {
    const m = merged.get(t.id);
    out.push(m || { id: t.id, status: 'missing', message: '未返回结果', size: 0, count: 0, examples: [] });
  }
  return out;
}

async function doScan(group) {
  if (state.busy) return;
  const groupTargets = state.targets.filter((t) => t.group === group);
  const ids = groupTargets.map((t) => t.id);
  setBusy(true, '正在扫描（只读，不会删除任何内容）……');
  try {
    if (group === 'disk') {
      const results = await api.scanUser(ids);
      for (const r of results) state.scan.set(r.id, r);
      await refreshBrowserBanner();
    } else {
      const res = await api.scanSystem(ids);
      if (res.canceled) { status(res.message || '已取消管理员授权，未做任何修改', 'err'); setBusy(false); return; }
      if (!res.ok) { status(res.message || '系统级扫描失败', 'err'); setBusy(false); return; }
      for (const r of mergeSystemResults(res.results, groupTargets)) state.scan.set(r.id, r);
    }
    renderTargets(group);
    status('扫描完成：以上仅为预览，未删除任何内容', 'ok');
  } catch (e) {
    status('扫描出错: ' + (e && e.message ? e.message : e), 'err');
  } finally {
    setBusy(false);
  }
}

// ---------- 清理 ----------

async function doClean(group) {
  if (state.busy) return;
  const picked = state.targets.filter((t) => t.group === group && state.selected.has(t.id));
  if (!picked.length) { status('请先勾选要清理的项目', 'err'); return; }
  const ids = picked.map((t) => t.id);

  // 执行前重新扫描一次，弹窗里显示的是当下真实数据
  setBusy(true, '正在重新扫描勾选项（只读）……');
  let fresh = [];
  try {
    if (group === 'disk') {
      fresh = await api.scanUser(ids);
    } else {
      const res = await api.scanSystem(ids);
      if (res.canceled || !res.ok) {
        status(res.message || '扫描失败，已中止（未删除任何内容）', 'err');
        setBusy(false);
        return;
      }
      fresh = mergeSystemResults(res.results, picked);
    }
    for (const r of fresh) state.scan.set(r.id, r);
    renderTargets(group);
  } catch (e) {
    status('扫描出错，已中止: ' + (e && e.message ? e.message : e), 'err');
    setBusy(false);
    return;
  }
  setBusy(false);

  const items = fresh.map((r) => {
    const t = state.byId.get(r.id) || {};
    return { name: t.name || r.id, size: r.size, level: t.level || 'safe', status: r.status };
  });
  const cleanable = items.filter((it) => it.status === 'ok' || it.status === undefined);
  const total = cleanable.reduce((s, it) => s + (Number(it.size) || 0), 0);
  const requireAck = items.some((it) => it.level === 'caution');

  if (!cleanable.length) {
    await resultDialog('没有需要清理的内容', [{ name: '勾选的项目都不存在或为空，未执行任何删除', text: '' }]);
    return;
  }

  const ok = await confirmDialog({
    title: group === 'disk' ? '确认清理以下项目？' : '确认清理以下系统级项目？',
    desc: `共 ${cleanable.length} 项，预计释放 ${fmtBytes(total)}。执行时会逐项复查安全规则（保护清单、允许范围、拒绝链接），被占用的文件自动跳过。`,
    items: cleanable.map((it) => ({ name: it.name, size: it.size })),
    requireAck,
    okText: '确认清理',
  });
  if (!ok) { status('已取消，未删除任何内容'); return; }

  setBusy(true, '正在清理……');
  const t0 = Date.now();
  try {
    const res = group === 'disk' ? await api.cleanUser(ids, true) : await api.cleanSystem(ids, true);
    if (res.canceled) { status(res.message || '已取消管理员授权，未做任何修改', 'err'); return; }
    if (!res.ok) { status(res.message || '清理失败', 'err'); return; }

    const lines = [];
    let freed = 0;
    for (const r of res.results || []) {
      const t = state.byId.get(r.id) || {};
      freed += Number(r.freed) || 0;
      if (r.status === 'done') {
        lines.push({ name: t.name || r.id, text: '已清理 ' + fmtBytes(r.freed || 0) + (r.locked ? `（${r.locked} 项被占用跳过）` : '') });
      } else {
        lines.push({ name: t.name || r.id, text: (r.status === 'skipped' ? '已跳过: ' : '失败: ') + (r.message || '') });
      }
      for (const w of r.warnings || []) lines.push({ name: '  ⚠ ' + (t.name || r.id), text: w });
    }
    for (const rf of res.refused || []) {
      lines.push({ name: '  ⚠ 已拒绝', text: `${rf.name || rf.id}: ${rf.reason}` });
    }
    const diskLine = res.before != null && res.after != null
      ? `C 盘可用: ${fmtBytes(res.before)} → ${fmtBytes(res.after)}`
      : '';
    lines.unshift({ name: '本次释放（按文件累计）', text: fmtBytes(freed) });
    if (diskLine) lines.unshift({ name: '磁盘实际变化', text: diskLine });

    const skipped = (res.results || []).filter((r) => r.status !== 'done').length + (res.refused || []).length;
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    await resultDialog('清理完成', lines, `释放 ${fmtBytes(freed)} · 跳过 ${skipped} 项 · 耗时 ${secs} 秒`);
    await refreshFree();
    await doScanSilent(group);
  } catch (e) {
    status('清理出错: ' + (e && e.message ? e.message : e), 'err');
  } finally {
    setBusy(false);
  }
}

async function doScanSilent(group) {
  const ids = state.targets.filter((t) => t.group === group).map((t) => t.id);
  try {
    if (group === 'disk') {
      for (const r of await api.scanUser(ids)) state.scan.set(r.id, r);
    }
    renderTargets(group);
  } catch (e) { /* 刷新失败不影响主流程 */ }
}

// ---------- 组件存储 WinSxS ----------

const WS_LEVEL = { warn: ['DISM 建议清理', 'caution'], good: ['无需清理', 'safe'], info: ['可清可不清', 'off'] };

function wsCanClean() {
  return !!state.wsAdvice && state.wsAdvice.level === 'warn';
}

function wsRender(msg, advice) {
  const body = $('wsBody');
  body.textContent = '';
  if (advice) {
    body.classList.remove('muted');
    const lv = WS_LEVEL[advice.level] || ['提示', 'off'];
    const head = el('div', 'ws-advice');
    head.appendChild(el('span', 'badge ' + lv[1], lv[0]));
    head.appendChild(el('span', '', advice.title));
    body.appendChild(head);
    body.appendChild(el('div', 'ws-detail', advice.detail));
    if (!wsCanClean()) {
      body.appendChild(el('div', 'ws-detail',
        'DISM 没有建议清理，所以清理按钮保持禁用。这不是故障：强行清理要占用十几分钟 CPU 和磁盘，换回的空间通常很小。'));
    }
  } else {
    body.classList.add('muted');
    body.appendChild(el('div', '', msg || ''));
  }
}

async function doWsAnalyze() {
  if (state.busy) return;
  setBusy(true, '正在读取 DISM 组件存储报告，需要一次管理员授权……');
  try {
    const r = await api.winsxsAnalyze();
    if (r.ok) {
      state.wsAdvice = r.advice;
      wsRender('', r.advice);
      status('组件存储分析完成（只读，没有改动任何内容）', 'ok');
    } else {
      state.wsAdvice = null;
      wsRender(r.message || '已取消，没有读取组件存储');
      status(r.canceled ? (r.message || '已取消管理员授权') : (r.message || '组件存储分析失败'), r.canceled ? 'err' : 'err');
    }
  } catch (e) {
    state.wsAdvice = null;
    wsRender('分析出错: ' + ((e && e.message) || e));
    status('分析出错: ' + ((e && e.message) || e), 'err');
  } finally {
    setBusy(false);
  }
}

async function doWsClean(mode) {
  if (state.busy) return;
  if (!wsCanClean()) { status('DISM 没有建议清理，已拒绝执行', 'err'); return; }
  const deep = mode === 'cleanup-resetbase';
  const ok = await confirmDialog({
    title: deep ? '深度清理组件存储？' : '清理组件存储？',
    desc: deep
      ? '会执行 DISM /StartComponentCleanup /ResetBase，把所有被取代的组件版本永久移除。清理完成后，已经安装的 Windows 更新将无法卸载（不能再回退到上一个补丁版本）。DISM 可能运行 10–30 分钟甚至更久，中途强行结束有损坏组件存储的风险。'
      : '会执行 DISM /StartComponentCleanup，移除被取代的组件版本，通常 10–30 分钟。期间请不要关机，也不要强行结束本软件；中途打断 DISM 有损坏组件存储的风险。',
    items: [{ name: '组件存储 WinSxS', text: deep ? 'StartComponentCleanup /ResetBase' : 'StartComponentCleanup' }],
    requireAck: deep,
    okText: deep ? '我已了解，开始深度清理' : '开始清理',
  });
  if (!ok) return;

  const box = $('wsProgress');
  box.classList.remove('hidden');
  box.textContent = 'DISM 已启动，等待进度……';
  setBusy(true, '正在清理组件存储，可能需要 10–30 分钟，请不要关闭软件……');
  try {
    const r = await api.winsxsCleanup(mode, true);
    const text = r.ok ? r.message : (r.message || '清理未完成');
    box.textContent = r.canceled ? '已取消管理员授权，组件存储没有任何改动' : text;
    status(text, r.ok ? 'ok' : 'err');
    // 清理之后原来的 DISM 报告就过期了，必须重新分析才能再给建议
    state.wsAdvice = null;
    wsRender(r.ok ? '清理已结束。上面的分析结果已经过期，点「分析」重新读取 DISM 报告。' : text);
    if (r.ok) await refreshFree();
  } catch (e) {
    box.textContent = '清理出错: ' + ((e && e.message) || e);
    status('清理出错: ' + ((e && e.message) || e), 'err');
  } finally {
    setBusy(false);
  }
}

// ---------- 旧驱动包 ----------

function drvKey(g) {
  return String((g && g.orig) || '').toLowerCase();
}

function drvRender(msg, groups) {
  const body = $('drvBody');
  body.textContent = '';
  if (!groups) {
    body.classList.add('muted');
    body.appendChild(el('div', '', msg || ''));
    return;
  }
  if (!groups.length) {
    body.classList.add('muted');
    body.appendChild(el('div', '', '驱动库里没有发现重复的驱动包，不需要处理。'));
    return;
  }
  body.classList.remove('muted');
  for (const g of groups) {
    const key = drvKey(g);
    const row = el('label', 'drv-row');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = state.drvPicked.has(key);
    cb.addEventListener('change', () => {
      if (cb.checked) state.drvPicked.add(key);
      else state.drvPicked.delete(key);
      refreshButtons();
    });
    row.appendChild(cb);

    const main = el('div', 'drv-main');
    main.appendChild(el('div', 'drv-name', String(g.orig || key)));
    const keep = g.keep || {};
    main.appendChild(el('div', 'drv-sub drv-keep',
      `保留 ${keep.pub || '?'} · ${keep.version || '?'} (${keep.date || '日期未知'})`));
    for (const o of (g.old || [])) {
      main.appendChild(el('div', 'drv-sub', `可删 ${o.pub} · ${o.version || '?'} (${o.date || '日期未知'})`));
    }
    main.appendChild(el('div', 'drv-sub', [g.provider, g.class].filter(Boolean).join(' · ')));
    row.appendChild(main);
    body.appendChild(row);
  }
}

async function drvScanNow() {
  const r = await api.driversList();
  if (!r.ok) {
    state.drvGroups = null;
    state.drvPicked.clear();
    drvRender(r.message || '读取驱动库失败');
    return { ok: false, message: r.message || '读取驱动库失败' };
  }
  state.drvGroups = Array.isArray(r.groups) ? r.groups : [];
  state.drvPicked.clear();
  drvRender('', state.drvGroups);
  return { ok: true, total: r.total, groups: state.drvGroups.length, oldCount: r.oldCount };
}

async function doDrvScan() {
  if (state.busy) return;
  setBusy(true, '正在读取驱动库（只读，不需要管理员授权）……');
  try {
    const r = await drvScanNow();
    if (r.ok) status(`驱动库共 ${r.total} 个包，发现 ${r.groups} 组重复、${r.oldCount} 个旧版本`, 'ok');
    else status(r.message, 'err');
  } catch (e) {
    drvRender('扫描出错: ' + ((e && e.message) || e));
    status('扫描出错: ' + ((e && e.message) || e), 'err');
  } finally {
    setBusy(false);
  }
}

async function doDrvClean() {
  if (state.busy) return;
  const picked = (state.drvGroups || []).filter((g) => state.drvPicked.has(drvKey(g)));
  if (!picked.length) { status('请先勾选要删除的旧驱动包', 'err'); return; }
  const pubs = [];
  const items = [];
  for (const g of picked) {
    for (const o of (g.old || [])) {
      pubs.push(o.pub);
      items.push({ name: `${g.orig} → ${o.pub}`, text: `${o.version || '?'} (${o.date || '日期未知'}) → 保留 ${(g.keep && g.keep.version) || '?'}` });
    }
  }
  const ok = await confirmDialog({
    title: '删除旧驱动包？',
    desc: '只从驱动库移除同一个 inf 的旧版本，最新的一份保留。仍被设备使用的包会被 pnputil 自己拒绝，本软件不加 /force、也不加 /uninstall，不会动到正在使用的驱动。删除后本软件无法把它放回去；确实需要时让 Windows 重新联网更新驱动即可。',
    items,
    requireAck: true,
    okText: '确认删除',
  });
  if (!ok) return;

  setBusy(true, '正在删除旧驱动包，需要一次管理员授权……');
  try {
    const r = await api.driversRemove(pubs, true);
    if (r.canceled) { status(r.message || '已取消管理员授权，没有删除任何驱动包', 'err'); return; }
    if (!r.ok) { status(r.message || '删除驱动包失败', 'err'); return; }
    const parts = [`已删除 ${r.removed.length} 个旧驱动包`];
    if (r.skipped.length) {
      parts.push(`${r.skipped.length} 个被系统拒绝：` + r.skipped.map((x) => `${x.pub}（${x.reason}）`).join('；'));
    }
    status(parts.join('，'), r.removed.length ? 'ok' : 'err');
    await drvScanNow();
  } catch (e) {
    status('删除出错: ' + ((e && e.message) || e), 'err');
  } finally {
    setBusy(false);
  }
}

function initSystemCards() {
  $('wsAnalyze').addEventListener('click', doWsAnalyze);
  $('wsClean').addEventListener('click', () => doWsClean('cleanup'));
  $('wsResetBase').addEventListener('click', () => doWsClean('cleanup-resetbase'));
  $('drvScan').addEventListener('click', doDrvScan);
  $('drvClean').addEventListener('click', doDrvClean);
  api.onWinsxsProgress((p) => {
    const box = $('wsProgress');
    if (!box || !p) return;
    box.classList.remove('hidden');
    const sec = Math.max(0, Math.round(Number(p.seconds) || 0));
    const used = `已用 ${Math.floor(sec / 60)} 分 ${String(sec % 60).padStart(2, '0')} 秒`;
    if (p.done) { box.textContent = `DISM 已结束 · ${used}`; return; }
    const pct = p.percent == null ? null : Number(p.percent).toFixed(1);
    box.textContent = `正在清理 ${pct == null ? '…' : pct + '%'} · ${used}`;
  });
}

// ---------- 浏览器占用提示 ----------

async function refreshBrowserBanner() {
  const banner = $('browserBanner');
  try {
    const st = await api.browserStatus();
    if (!st.running) { banner.classList.add('hidden'); banner.textContent = ''; return; }
    banner.textContent = '';
    banner.classList.remove('hidden');
    banner.appendChild(el('span', '', `检测到 ${st.names.join(' / ')} 正在运行，其缓存文件会被占用而跳过。`));
    const btn = el('button', 'btn ghost small', '关闭浏览器');
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: '关闭浏览器？',
        desc: '将强制结束 Chrome / Edge 进程，未保存的网页内容可能丢失。',
        items: [{ name: 'chrome / msedge', text: '强制结束' }],
        requireAck: true,
        okText: '关闭浏览器',
      });
      if (!ok) return;
      const r = await api.closeBrowsers();
      status(r.ok ? '浏览器已关闭' : `仍有 ${r.left} 个进程未关闭`, r.ok ? 'ok' : 'err');
      await refreshBrowserBanner();
    });
    banner.appendChild(btn);
  } catch (e) {
    banner.classList.add('hidden');
  }
}

// ---------- 启动项 ----------

async function loadStartup() {
  setBusy(true, '正在读取启动项……');
  try {
    const res = await api.startupList();
    state.startup = res.items || [];
    state.startupMeta = res;
    $('backupPath').textContent = `备份目录: ${res.backupDir || '—'}    禁用记录: ${res.storePath || '—'}`;
    renderStartup();
    if (res.error) status(res.error, 'err');
  } catch (e) {
    status('读取启动项失败: ' + (e && e.message ? e.message : e), 'err');
  } finally {
    setBusy(false);
  }
}

function renderStartup() {
  const host = $('startupList');
  host.textContent = '';
  if (!state.startup.length) {
    host.appendChild(el('div', 'hint', '没有发现开机自启项。'));
    return;
  }
  const sorted = state.startup.slice().sort((a, b) => (a.enabled === b.enabled ? 0 : a.enabled ? -1 : 1));
  for (const it of sorted) {
    const row = el('div', 'row' + (it.enabled ? '' : ' checked'));
    const body = el('div', 'body');
    const head = el('div', 'head');
    head.appendChild(el('span', 'name', it.name));
    const src = it.source === 'registry' ? `注册表 ${it.hive}` : `启动文件夹(${it.hive})`;
    head.appendChild(el('span', 'badge off', src));
    if (it.needsAdmin) head.appendChild(el('span', 'badge admin', '需管理员'));
    head.appendChild(el('span', 'badge ' + (it.enabled ? 'safe' : 'off'), it.enabled ? '已启用' : '已禁用'));
    body.appendChild(head);
    body.appendChild(el('div', 'note', it.command || ''));
    body.appendChild(el('div', 'examples', it.keyPath || ''));
    row.appendChild(body);

    const right = el('div', 'right');
    const btn = el('button', 'btn small ' + (it.enabled ? 'danger' : 'primary'), it.enabled ? '禁用' : '恢复');
    btn.addEventListener('click', () => toggleStartup(it, btn));
    right.appendChild(btn);
    row.appendChild(right);
    host.appendChild(row);
  }
}

async function toggleStartup(it, btn) {
  if (state.busy) return;
  const enabling = !it.enabled;
  const ok = await confirmDialog({
    title: enabling ? '恢复该启动项？' : '禁用该启动项？',
    desc: enabling
      ? '将把备份的原始值写回注册表 / 把启动文件移回启动文件夹。'
      : '禁用前会先完整备份原始注册表值或启动文件，之后可随时恢复。' + (it.needsAdmin ? '该项属于所有用户（HKLM），会弹一次管理员授权。' : ''),
    items: [{ name: it.name, text: enabling ? '恢复' : '禁用' }, { name: it.command || '', text: '' }],
    requireAck: true,
    okText: enabling ? '确认恢复' : '确认禁用',
    okClass: enabling ? 'primary' : 'danger',
  });
  if (!ok) return;
  btn.disabled = true;
  setBusy(true, enabling ? '正在恢复……' : '正在禁用（先备份）……');
  try {
    const r = await api.startupSet(it.id, enabling, true);
    status(r.message || (r.ok ? '完成' : '失败'), r.ok ? 'ok' : 'err');
    await loadStartup();
  } catch (e) {
    status('操作失败: ' + (e && e.message ? e.message : e), 'err');
    btn.disabled = false;
  } finally {
    setBusy(false);
  }
}

// ---------- 系统信息 ----------

function card(k, v, small) {
  const c = el('div', 'card');
  c.appendChild(el('div', 'k', k));
  c.appendChild(el('div', 'v' + (small ? ' small' : ''), v));
  return c;
}

async function loadInfo() {
  const host = $('infoCards');
  host.textContent = '';
  host.appendChild(el('div', 'hint', '正在读取系统信息……'));
  try {
    const d = await api.sysInfo();
    state.infoLoaded = true;
    host.textContent = '';
    const l = d.local || {};
    host.appendChild(card('操作系统', [d.osCaption, d.osArch].filter(Boolean).join(' ')));
    host.appendChild(card('版本 / 内核', `${d.osVersion || ''}  (${l.release || ''})`));
    host.appendChild(card('计算机 / 用户', `${l.hostname || ''} / ${l.user || ''}`));
    host.appendChild(card('CPU', d.cpuName || (l.cpuModels || [])[0] || '—', true));
    host.appendChild(card('逻辑核心', String(d.cpuCores || l.cpuThreads || '—')));
    host.appendChild(card('CPU 占用', `${Number(d.cpuLoad || 0).toFixed(0)} %`));
    host.appendChild(card('内存', `${fmtBytes((d.totalRam || l.totalRam) - (d.freeRam || l.freeRam))} / ${fmtBytes(d.totalRam || l.totalRam)}`));
    host.appendChild(card('已开机', fmtUptime(l.uptimeSec)));
    host.appendChild(card('上次启动', d.lastBoot ? new Date(d.lastBoot).toLocaleString('zh-CN') : '—', true));
    host.appendChild(card('系统安装时间', d.installDate ? new Date(d.installDate).toLocaleString('zh-CN') : '—', true));

    for (const disk of d.disks || []) {
      const total = Number(disk.total) || 0;
      const free = Number(disk.free) || 0;
      const used = Math.max(0, total - free);
      const c = card(`${disk.device} ${disk.label || ''}`.trim(), `${fmtBytes(free)} 可用 / ${fmtBytes(total)}`);
      const bar = el('div', 'bar');
      const fill = document.createElement('i');
      fill.style.width = total ? Math.min(100, (used / total) * 100).toFixed(1) + '%' : '0%';
      bar.appendChild(fill);
      c.appendChild(bar);
      host.appendChild(c);
    }
    if (d.error) status(d.error, 'err');
  } catch (e) {
    host.textContent = '';
    host.appendChild(el('div', 'hint', '读取失败: ' + (e && e.message ? e.message : e)));
  }
}

// ---------- 性能基线（优化前 / 优化后） ----------

const BENCH_ERR_TEXT = {
  canceled: '你取消了管理员授权',
  'needs-admin': '系统拒绝以管理员运行 winsat',
  'no-winsat': '这台系统里没有 winsat',
  'no-datastore': '找不到 winsat 的报告目录',
  'no-report': '跑完了，但报告里没有磁盘这一项',
};

function baseLabel(key) {
  if (key === 'memFree') return '空闲内存';
  if (key === 'bench') return '磁盘 4K 随机读';
  if (key.indexOf('disk:') === 0) {
    const dev = key.slice(5);
    return /[A-Za-z]:$/.test(dev) ? dev.slice(0, 1) + ' 盘可用' : dev + ' 可用';
  }
  return key;
}

function baseVal(v, kind) {
  if (v === null || v === undefined) return '—';
  return kind === 'mbps' ? v.toFixed(1) + ' MB/s' : fmtBytes(v);
}

function baseDiff(r) {
  if (r.diff === null || r.diff === undefined) return { text: '', cls: '' };
  if (r.diff === 0) return { text: '持平', cls: 'flat' };
  const up = r.diff > 0;
  const mag = r.kind === 'mbps' ? Math.abs(r.diff).toFixed(1) + ' MB/s' : fmtBytes(Math.abs(r.diff));
  // 这几项都是越大越好：空闲内存、各盘可用空间、4K 读速率
  return { text: (up ? '+' : '−') + mag, cls: up ? 'up' : 'down' };
}

function benchNote(snap) {
  if (!snap) return '未记录';
  if (snap.bench) return '';
  if (!snap.benchError) return '未测';
  const why = BENCH_ERR_TEXT[snap.benchError] || ('winsat：' + snap.benchError);
  return '读不到（' + why + '）';
}

function blTime(iso) {
  if (!iso) return '读不到';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '读不到' : d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

async function loadBaseline() {
  const host = $('baselineBody');
  $('baseRefresh').disabled = true;
  let d = null;
  try {
    d = await api.baselineGet();
  } catch (e) {
    host.textContent = '读取失败: ' + (e && e.message ? e.message : e);
    $('baseRefresh').disabled = false;
    return;
  }
  $('baseRefresh').disabled = false;

  const store = d.store || {};
  const before = store.before || null;
  const after = store.after || null;
  host.textContent = '';

  const head = el('div', 'bl-row bl-head');
  head.appendChild(el('div', 'bl-k', '指标'));
  head.appendChild(el('div', 'bl-v', before ? '优化前' : '优化前（未记录）'));
  head.appendChild(el('div', 'bl-v', after ? '优化后' : '现在'));
  head.appendChild(el('div', 'bl-d', '变化'));
  host.appendChild(head);

  const rows = d.rows || [];
  if (!before) {
    host.appendChild(el('div', 'bl-empty', '还没有记录过「优化前」。按下面的步骤做一遍，这里的数字就能对比。'));
  }
  for (const r of rows) {
    const row = el('div', 'bl-row');
    // 4K 这一行没数值时，说清是没测、被取消还是读不到，别只留一个破折号
    const cell = (snap, v) => (r.key === 'bench' && v === null ? (benchNote(snap) || '—') : baseVal(v, r.kind));
    row.appendChild(el('div', 'bl-k', baseLabel(r.key)));
    row.appendChild(el('div', 'bl-v', cell(before, r.before)));
    row.appendChild(el('div', 'bl-v', cell(after || d.live, r.after)));
    const df = baseDiff(r);
    row.appendChild(el('div', 'bl-d ' + df.cls, df.text));
    host.appendChild(row);
  }

  const meta = el('div', 'bl-meta');
  meta.appendChild(el('span', '', before
    ? '优化前记录于 ' + blTime(before.at) + '（当时上次开机 ' + blTime(before.lastBoot) + '）'
    : '优化前：未记录'));
  meta.appendChild(el('span', '', after
    ? '优化后记录于 ' + blTime(after.at) + '（当时上次开机 ' + blTime(after.lastBoot) + '）'
    : '优化后：未记录，右列是当前实时值'));
  host.appendChild(meta);
}

async function snapshotBaseline(slot) {
  const withBench = $('baseBench').checked;
  const btns = [$('baseBefore'), $('baseAfter'), $('baseClear'), $('baseRefresh')];
  for (const b of btns) b.disabled = true;
  $('baseProgress').textContent = withBench ? '正在跑磁盘实测，可能弹一次 UAC……' : '正在采集……';
  try {
    const r = await api.baselineSnapshot(slot, withBench);
    const err = r && r.store && r.store[slot] && r.store[slot].benchError;
    status(err ? '已记录，但磁盘实测没成功：' + (BENCH_ERR_TEXT[err] || err) : (slot === 'before' ? '已记录「优化前」' : '已记录「优化后」'), err ? 'err' : 'ok');
  } catch (e) {
    status('记录失败: ' + (e && e.message ? e.message : e), 'err');
  } finally {
    for (const b of btns) b.disabled = false;
    $('baseProgress').textContent = '';
  }
  await loadBaseline();
}

function initBaseline() {
  $('baseBefore').addEventListener('click', () => snapshotBaseline('before'));
  $('baseAfter').addEventListener('click', () => snapshotBaseline('after'));
  $('baseRefresh').addEventListener('click', () => loadBaseline());
  $('baseClear').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: '清除性能基线',
      desc: '只删掉本机记录的对比数字，不会改动系统任何设置。',
      okText: '清除',
      okClass: 'danger',
    });
    if (!ok) return;
    try {
      await api.baselineClear();
      status('已清除性能基线', 'ok');
    } catch (e) {
      status('清除失败: ' + (e && e.message ? e.message : e), 'err');
    }
    await loadBaseline();
  });
}

function buildFolderRoots() {  const sel = $('folderRoot');
  sel.textContent = '';
  const p = state.paths || {};
  const opts = [
    ['用户目录', p.homedir],
    ['AppData\\Local', p.localAppData],
    ['AppData\\Roaming', p.appData],
    ['Temp', p.temp],
    ['ProgramData', p.programData],
  ];
  for (const [label, value] of opts) {
    if (!value) continue;
    const o = document.createElement('option');
    o.value = value;
    o.textContent = `${label}  (${value})`;
    sel.appendChild(o);
  }
}

async function doFolderScan() {
  if (state.busy) return;
  const root = $('folderRoot').value;
  if (!root) { status('没有可扫描的目录', 'err'); return; }
  const host = $('folderList');
  host.textContent = '';
  setBusy(true, '正在统计目录体积（只读）……');
  try {
    const res = await api.topFolders(root, 15);
    if (res.error) { status(res.error, 'err'); return; }
    for (const it of res.items || []) {
      const row = el('div', 'row');
      const body = el('div', 'body');
      body.appendChild(el('div', 'head')).appendChild(el('span', 'name', it.name));
      body.appendChild(el('div', 'examples', it.path));
      row.appendChild(body);
      const right = el('div', 'right');
      right.appendChild(el('div', 'size', fmtBytes(it.size)));
      right.appendChild(el('div', 'count', it.count + ' 个文件'));
      row.appendChild(right);
      host.appendChild(row);
    }
    status(`统计完成：共扫描 ${res.totalScanned} 个一级目录（只读）`, 'ok');
  } catch (e) {
    status('统计失败: ' + (e && e.message ? e.message : e), 'err');
  } finally {
    $('folderProgress').textContent = '';
    setBusy(false);
  }
}

// ---------- 自动更新 ----------

const upd = {
  checking: false,
  checked: false,
  current: '',
  blocked: '',
  update: null,
  downloaded: false,
  downloading: false,
  progress: -1,
};

function applyUpdateState(s) {
  if (!s) return;
  if (typeof s.blocked === 'string') upd.blocked = s.blocked;
  if (s.currentVersion) upd.current = s.currentVersion;
  upd.update = s.update || null;
  upd.downloaded = !!s.downloaded;
  upd.downloading = !!s.downloading;
  if (typeof s.progress === 'number') upd.progress = s.progress;
  renderUpdate();
}

function renderUpdate() {
  const hasUpdate = !!upd.update;
  $('updateDot').classList.toggle('hidden', !hasUpdate || upd.downloaded);
  $('updateDownload').classList.toggle('hidden', !(hasUpdate && !upd.downloaded && !upd.downloading));
  $('updateInstall').classList.toggle('hidden', !upd.downloaded);

  const bar = $('updateBar');
  const fill = bar.querySelector('i');
  if (upd.downloading) {
    bar.classList.remove('hidden');
    fill.style.width = Math.max(0, Math.min(100, upd.progress)) + '%';
  } else {
    bar.classList.add('hidden');
    fill.style.width = '0%';
  }

  let line;
  if (upd.checking) line = '正在检查更新（访问 GitHub，可能需要几秒）……';
  else if (upd.blocked) line = upd.blocked;
  else if (upd.downloading) line = `正在下载新版本 ${upd.update ? upd.update.version : ''}：${upd.progress}%`;
  else if (upd.downloaded) line = `新版本 ${upd.update ? upd.update.version : ''} 已下载完成，点「安装并重启」完成更新`;
  else if (hasUpdate) line = `发现新版本 ${upd.update.version}（当前 ${upd.current}），点「下载更新」开始下载`;
  else if (upd.checked) line = '已检查：当前就是最新版本';
  else line = '尚未检查更新';
  $('updateState').textContent = line;

  const host = $('updateCards');
  host.textContent = '';
  host.appendChild(card('当前版本', upd.current || '—'));
  host.appendChild(card('最新版本', hasUpdate ? upd.update.version : (upd.blocked ? '—' : (upd.checked ? '已是最新' : '未检查'))));
  if (hasUpdate) {
    host.appendChild(card('安装包', upd.update.size ? fmtBytes(upd.update.size) : '—', true));
    if (upd.update.releaseDate) host.appendChild(card('发布时间', upd.update.releaseDate, true));
  }

  const notes = $('updateNotes');
  const parts = [];
  if (hasUpdate && upd.update.releaseNotes) parts.push('更新说明: ' + upd.update.releaseNotes);
  if (hasUpdate && upd.update.files && upd.update.files.length) parts.push('文件: ' + upd.update.files.join('、'));
  notes.textContent = parts.join('    ');
  notes.classList.toggle('hidden', !parts.length);
}

async function loadUpdate() {
  try {
    applyUpdateState(await api.updateGet());
  } catch (e) { /* 状态读取失败不阻塞界面 */ }
}

async function doUpdateCheck() {
  if (upd.checking) return;
  upd.checking = true;
  upd.progress = -1;
  $('updateCheck').disabled = true;
  renderUpdate();
  try {
    const r = await api.updateCheck();
    if (!r.ok && r.message) status(r.message, 'err');
    else if (r.ok && !r.hasUpdate) status('当前已是最新版本', 'ok');
    else if (r.ok) status(`发现新版本 ${r.info.version}`, 'ok');
    upd.checked = true;
    applyUpdateState(r.state);
  } catch (e) {
    status('检查更新失败: ' + (e && e.message ? e.message : e), 'err');
  } finally {
    upd.checking = false;
    $('updateCheck').disabled = false;
    renderUpdate();
  }
}

async function doUpdateDownload() {
  if (upd.downloading) return;
  const ok = await confirmDialog({
    title: '下载新版本？',
    desc: '将从 GitHub Releases 下载安装包到本机临时目录，期间可正常使用软件。下载完不会自动安装、不会自动重启。',
    items: [{
      name: '版本 ' + (upd.update ? upd.update.version : ''),
      text: upd.update && upd.update.size ? fmtBytes(upd.update.size) : '',
    }],
    requireAck: false,
    okText: '开始下载',
    okClass: 'primary',
  });
  if (!ok) { status('已取消下载', 'ok'); return; }
  upd.downloading = true;
  upd.progress = 0;
  renderUpdate();
  try {
    const r = await api.updateDownload();
    if (r.state) applyUpdateState(r.state);
    else upd.downloading = false;
    if (r.ok) status('更新下载完成，可点击「安装并重启」', 'ok');
    else status(r.message || '下载失败', 'err');
  } catch (e) {
    upd.downloading = false;
    status('下载失败: ' + (e && e.message ? e.message : e), 'err');
  }
  renderUpdate();
}

async function doUpdateInstall() {
  const ok = await confirmDialog({
    title: '安装更新并重启？',
    desc: '软件会立刻关闭所有窗口并静默安装新版本，正在进行的扫描或清理会被中断。安装完成后自动重新启动。',
    items: [{ name: `${upd.current} → ${upd.update ? upd.update.version : ''}`, text: '将覆盖当前安装' }],
    requireAck: true,
    okText: '安装并重启',
  });
  if (!ok) { status('已取消，未做任何修改'); return; }
  const r = await api.updateInstall(true);
  if (!r.ok) status(r.message || '安装失败', 'err');
}

// ---------- 日志 ----------

async function loadLog() {
  try {
    const lines = await api.readLog();
    $('logBody').textContent = lines.length ? lines.join('\n') : '（暂无记录）';
    if (state.paths && state.paths.logPath) $('logPath').textContent = state.paths.logPath;
  } catch (e) {
    $('logBody').textContent = '读取失败: ' + (e && e.message ? e.message : e);
  }
}

// ---------- 首页实时监控（CPU / GPU / 内存，只读） ----------

let monTimer = null;
const monHist = { Cpu: [], Gpu: [], Ram: [] };

function pushHist(key, v) {
  const a = monHist[key];
  a.push(Math.max(0, Math.min(100, Number(v) || 0)));
  if (a.length > 60) a.shift();
}

// 最近 60 次采样的迷你折线，横轴固定 60 格，不足时从左侧开始画
function drawSpark(key) {
  const cv = $('spark' + key);
  if (!cv) return;
  const w = cv.clientWidth;
  const h = cv.clientHeight;
  if (!w || !h) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.floor(w * dpr);
  cv.height = Math.floor(h * dpr);
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  const data = monHist[key];
  if (data.length < 2) return;
  const px = (i) => (i / 59) * w;
  const py = (v) => h - 2 - (v / 100) * (h - 4);
  c.beginPath();
  for (let i = 0; i < data.length; i++) {
    if (i === 0) c.moveTo(px(i), py(data[i]));
    else c.lineTo(px(i), py(data[i]));
  }
  c.strokeStyle = 'rgba(255,92,72,.95)';
  c.lineWidth = 1.4;
  c.shadowColor = 'rgba(255,59,59,.75)';
  c.shadowBlur = 6;
  c.stroke();
  c.shadowBlur = 0;
  c.lineTo(px(data.length - 1), h);
  c.lineTo(0, h);
  c.closePath();
  c.fillStyle = 'rgba(255,59,59,.12)';
  c.fill();
}

function setBar(key, load, value, note) {
  const pct = Math.max(0, Math.min(100, Number(load) || 0));
  const bar = $('bar' + key);
  if (bar) bar.style.width = pct.toFixed(0) + '%';
  const v = $('val' + key);
  if (v) v.textContent = value;
  if (note !== undefined) {
    const n = $('note' + key);
    if (n) n.textContent = note;
  }
}

async function refreshMetrics() {
  try {
    const m = await api.metrics();
    setBar('Cpu', m.cpu.load, Math.round(m.cpu.load) + ' %', (m.cpu.cores || 0) + ' 线程');
    pushHist('Cpu', m.cpu.load);
    drawSpark('Cpu');
    if (m.gpu && m.gpu.load != null) {
      const mem = m.gpu.totalMiB
        ? ` ${(m.gpu.usedMiB / 1024).toFixed(1)} / ${(m.gpu.totalMiB / 1024).toFixed(1)} GB`
        : '';
      setBar('Gpu', m.gpu.load, Math.round(m.gpu.load) + ' %', (m.gpu.name || 'GPU') + ' ·' + mem);
      pushHist('Gpu', m.gpu.load);
    } else if (m.gpu) {
      setBar('Gpu', 0, '—', (m.gpu.name || 'GPU') + ' · 占用暂不可读');
      pushHist('Gpu', 0);
    } else {
      setBar('Gpu', 0, '不可用', '未检测到可用的 GPU 监控接口');
      pushHist('Gpu', 0);
    }
    drawSpark('Gpu');
    setBar('Ram', m.ram.load, Math.round(m.ram.load) + ' %', `${fmtBytes(m.ram.used)} / ${fmtBytes(m.ram.total)}`);
    pushHist('Ram', m.ram.load);
    drawSpark('Ram');
  } catch (e) {
    setBar('Cpu', 0, '—', '');
  }
}

function startMonitor() {
  refreshMetrics();
  if (monTimer == null) monTimer = setInterval(() => {
    if (!document.hidden) refreshMetrics();
  }, 2000);
}

function stopMonitor() {
  if (monTimer != null) clearInterval(monTimer);
  monTimer = null;
}

// ---------- 磁盘可用空间 ----------

async function refreshFree() {
  let text = '—';
  try {
    const n = await api.diskFree();
    text = n == null ? '—' : fmtBytes(n);
  } catch (e) { /* 保持占位符 */ }
  $('freeSpace').textContent = text;
  const s = $('statFree');
  if (s) s.textContent = text;
}

// ---------- 内存一键释放 ----------

async function doMemTrim() {
  if (state.busy) return;
  const yes = await confirmDialog({
    title: '内存一键释放',
    desc: '只把后台进程占用的工作集交还给系统，不结束任何进程。关键系统进程、本软件、以及正在前台全屏运行的程序（游戏）都会自动跳过。被整理过的程序下次使用时可能短暂卡顿（数据要从磁盘读回）。',
    items: [],
    requireAck: false,
    okText: '确认释放',
    okClass: 'primary',
  });
  if (!yes) return;
  setBusy(true, '正在释放内存…');
  try {
    const r = await api.memTrim(true);
    if (r && r.ok) {
      status(`已整理 ${r.trimmed} 个进程 · 工作集 ${Math.round(r.beforeMB)} MB → ${Math.round(r.afterMB)} MB（跳过 ${r.skipped} 个）`, 'ok');
      await refreshMetrics();
    } else {
      status('内存释放失败：' + ((r && r.message) || '未知错误'), 'err');
    }
  } catch (e) {
    status('内存释放失败：' + (e && e.message ? e.message : String(e)), 'err');
  } finally {
    setBusy(false);
  }
}

// ---------- 变更记录与撤销 ----------

function fmtStamp(ms) {
  const d = new Date(Number(ms) || Date.now());
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 撤销之后让相关页面重新读取，避免界面还停在旧状态 */
async function refreshSources(list) {
  const s = new Set((list || []).map((x) => String(x)));
  try {
    if (s.has('启动项')) await loadStartup();
    if (s.has('游戏开关') || s.has('一键优化')) { if (window.game) await window.game.reload(); }
    if (s.has('电源优化') || s.has('一键优化')) { if (window.power) await window.power.reload(); }
    if (s.has('显卡优化') || s.has('一键优化')) { if (window.gpu) await window.gpu.reload(); }
    if (s.has('一键优化') && window.tiers) await window.tiers.refreshInfo();
  } catch (e) { /* 页面刷新失败不影响撤销本身的结果 */ }
}

function ledgerRow(e) {
  const cls = e.status === 'undone' ? ' undone' : e.status === 'failed' ? ' failed' : '';
  const row = el('div', 'lrow' + cls);
  row.appendChild(el('span', 'lwhen', fmtStamp(e.at)));

  const main = el('div', 'lmain');
  const title = el('div', 'ltitle');
  title.appendChild(el('span', 'lsrc', e.source || '其他'));
  title.appendChild(document.createTextNode(e.label || '（无描述）'));
  main.appendChild(title);
  main.appendChild(el('div', 'lhint', e.status === 'undone' ? '已按记录里的原值撤销' : (e.undoHint || '')));
  if (e.error) main.appendChild(el('div', 'lerr', '撤销失败：' + e.error));
  row.appendChild(main);

  const acts = el('div', 'lacts');
  if (e.status === 'applied' && e.undo) {
    const b = el('button', 'btn ghost small', '撤销');
    b.addEventListener('click', () => doUndo(e, b));
    acts.appendChild(b);
  } else if (e.status === 'failed') {
    const b = el('button', 'btn ghost small', '重试');
    b.addEventListener('click', () => doUndo(e, b));
    acts.appendChild(b);
  } else if (e.status === 'undone') {
    acts.appendChild(el('span', 'lstate ok', '已撤销'));
  } else {
    acts.appendChild(el('span', 'lstate no', '无法撤销'));
  }
  row.appendChild(acts);
  return row;
}

async function loadLedger() {
  const host = $('ledgerList');
  let r;
  try {
    r = await api.ledgerList(200);
  } catch (e) {
    host.textContent = '';
    host.appendChild(el('div', 'ledger-empty', '读取变更记录失败: ' + ((e && e.message) || e)));
    return;
  }
  const st = r.stats || {};
  $('ledgerStats').textContent = `共 ${st.total || 0} 条记录 · 生效中 ${st.applied || 0} · 其中可撤销 ${st.undoable || 0} · 已撤销 ${st.undone || 0}` +
    (st.failed ? ` · 撤销失败 ${st.failed}` : '');
  host.textContent = '';
  const list = r.entries || [];
  if (!list.length) {
    host.appendChild(el('div', 'ledger-empty', '还没有改动记录。清理、改开关、切电源计划、改 N 卡设置、禁用启动项，都会在这里留一条。'));
    return;
  }
  for (const e of list) host.appendChild(ledgerRow(e));
}

async function doUndo(e, btn) {
  if (state.busy) return;
  const yes = await confirmDialog({
    title: '撤销这条改动',
    desc: '按这条记录里存的原值精确写回，只影响这一项，其它改动保持不变。HKLM 项（如 HAGS）会弹一次管理员授权。',
    items: [{ name: `${e.source || ''} · ${e.label || ''}`, text: fmtStamp(e.at) }],
    requireAck: false,
    okText: '确认撤销',
    okClass: 'primary',
  });
  if (!yes) return;
  if (btn) btn.disabled = true;
  setBusy(true, '正在撤销…');
  try {
    const r = await api.ledgerUndo(e.id, true);
    if (r && r.ok) {
      status('已撤销：' + (e.label || ''), 'ok');
      await refreshSources([e.source]);
    } else {
      status('撤销失败：' + ((r && r.message) || '未知错误'), 'err');
    }
  } catch (err) {
    status('撤销失败：' + ((err && err.message) || err), 'err');
  } finally {
    setBusy(false);
    await loadLedger();
  }
}

async function doUndoAll() {
  if (state.busy) return;
  let r0 = null;
  try { r0 = await api.ledgerList(500); } catch (e) { r0 = null; }
  const todo = ((r0 && r0.entries) || []).filter((x) => x.status === 'applied' && x.undo);
  if (!todo.length) { status('没有可撤销的变更', 'err'); return; }
  const yes = await confirmDialog({
    title: '全部撤销',
    desc: `按时间倒序撤销 ${todo.length} 条可撤销的改动，逐条写回记录里的原值。删文件类记录不在其中（物理上无法恢复）。过程中可能弹多次管理员授权。`,
    items: todo.slice(0, 14).map((x) => ({ name: `${x.source || ''} · ${x.label || ''}`, text: fmtStamp(x.at) })),
    requireAck: true,
    okText: '确认全部撤销',
    okClass: 'danger',
  });
  if (!yes) return;
  setBusy(true, '正在逐条撤销…');
  try {
    const r = await api.ledgerUndoAll(true);
    const done = (r && r.undone) || 0;
    const bad = (r && r.failed) || [];
    if (r && r.ok) status(`已撤销 ${done} 条改动`, 'ok');
    else status(`撤销 ${done} 条，失败 ${bad.length} 条${bad.length ? '：' + bad[0] : ''}`, 'err');
    await refreshSources(todo.map((x) => x.source));
  } catch (e) {
    status('撤销失败：' + ((e && e.message) || e), 'err');
  } finally {
    setBusy(false);
    await loadLedger();
  }
}

// ---------- 系统还原点（改前兜底） ----------

function rpText(s) {
  if (!s) return '还原点：读取失败';
  if (s.canceled) return '还原点：' + (s.message || '已取消管理员授权，未读取');
  if (!s.available) return '还原点：本机不可用 —— ' + (s.reason || s.message || '未知原因');
  const last = s.last
    ? `最近一个「${s.last.description || '无描述'}」@ ${String(s.last.at || '').slice(0, 16).replace('T', ' ')}`
    : '还没有还原点';
  const sh = s.shadow && s.shadow.max ? `；卷影存储已用 ${fmtBytes(s.shadow.used)} / 上限 ${fmtBytes(s.shadow.max)}` : '';
  return `还原点：共 ${s.count || 0} 个，${last}${sh}`;
}

async function showRestorePoint() {
  if (state.busy) return;
  setBusy(true, '正在读取还原点状态，需要一次管理员授权…');
  try {
    // 传 false：60 秒内的重复点击复用上次结果，不再弹第二次 UAC
    const s = await api.restorePointStatus(false);
    $('rpState').textContent = rpText(s);
  } catch (e) {
    $('rpState').textContent = '还原点：读取失败 ' + ((e && e.message) || e);
  } finally {
    setBusy(false);
  }
}

async function doCreateRestorePoint() {
  if (state.busy) return;
  const yes = await confirmDialog({
    title: '创建系统还原点',
    desc: '调用 Windows 自带的 Checkpoint-Computer 建一个还原点，只写系统还原数据，不动任何用户文件，需要一次管理员授权。注意 Windows 限制 24 小时内只能建一个，间隔内会失败并把原因告诉你。',
    items: [],
    requireAck: false,
    okText: '确认创建',
    okClass: 'primary',
  });
  if (!yes) return;
  setBusy(true, '正在创建还原点，可能要一两分钟…');
  try {
    const r = await api.restorePointCreate(true);
    $('rpState').textContent = '还原点：' + (r.reason || (r.ok ? '已就绪' : '未创建'));
    if (r && r.ok) status(r.created ? '还原点已创建' : '已复用现有还原点', 'ok');
    else status('创建还原点失败：' + ((r && r.reason) || '未知错误'), 'err');
  } catch (e) {
    status('创建还原点失败：' + ((e && e.message) || e), 'err');
  } finally {
    setBusy(false);
  }
}

// ---------- 只读体检报告 ----------

const SEV_LABEL = { risk: '风险', warn: '建议处理', info: '供参考', good: '正常' };

function renderHealth(r) {
  const host = $('healthBody');
  host.textContent = '';
  if (!r || !r.ok || !Array.isArray(r.findings)) {
    host.appendChild(el('div', 'health-idle', (r && r.message) || '体检失败，没有拿到结果'));
    $('healthCounts').textContent = '';
    $('healthExport').classList.add('hidden');
    return;
  }
  const c = r.counts || {};
  $('healthCounts').textContent = `${r.quick ? '快速' : '深度'} · 风险 ${c.risk || 0} · 建议处理 ${c.warn || 0} · 供参考 ${c.info || 0} · 正常 ${c.good || 0}`;
  $('healthExport').classList.remove('hidden');
  if (r.message) host.appendChild(el('div', 'health-idle', r.message));
  for (const x of r.findings) {
    const box = el('div', 'finding ' + (x.severity || 'info'));
    const head = el('div', 'fhead');
    head.appendChild(el('span', 'fsev', SEV_LABEL[x.severity] || String(x.severity || '')));
    head.appendChild(el('span', 'ftitle', x.title));
    head.appendChild(el('span', 'fgroup', x.group || ''));
    box.appendChild(head);
    if (x.detail) box.appendChild(el('div', 'fdetail', x.detail));
    if (x.tip) box.appendChild(el('div', 'ftip', '建议：' + x.tip));
    host.appendChild(box);
  }
}

async function runHealth(deep) {
  if (state.busy) return;
  const btn = $(deep ? 'healthDeep' : 'healthQuick');
  btn.disabled = true;
  setBusy(true, deep ? '深度体检中，会弹一次管理员授权…' : '正在体检（只读）…');
  $('healthCounts').textContent = deep ? '正在请求管理员授权…' : '正在采集系统信息…';
  try {
    const r = deep ? await api.healthDeep() : await api.healthQuick();
    renderHealth(r);
    if (r && r.ok) status('体检完成', 'ok');
    else status('体检失败：' + ((r && r.message) || '未知错误'), 'err');
  } catch (e) {
    renderHealth({ ok: false, message: (e && e.message) || String(e) });
    status('体检失败：' + ((e && e.message) || e), 'err');
  } finally {
    btn.disabled = false;
    setBusy(false);
  }
}

function openHealth() {
  $('healthModal').classList.remove('hidden');
  if (!$('healthBody').childNodes.length) {
    $('healthBody').appendChild(el('div', 'health-idle', '点上面的「快速体检」或「深度体检」开始。全程只读，不改任何设置、不删任何文件。'));
  }
}

async function doHealthExport() {
  if (state.busy) return;
  setBusy(true, '正在导出体检报告…');
  try {
    const r = await api.healthExport();
    if (r && r.ok) status('已保存到 ' + r.path, 'ok');
    else if (r && r.canceled) status('已取消保存');
    else status('导出失败：' + ((r && r.message) || '未知错误'), 'err');
  } catch (e) {
    status('导出失败：' + ((e && e.message) || e), 'err');
  } finally {
    setBusy(false);
  }
}

// ---------- 初始化 ----------

async function init() {
  if (window.i18n) await window.i18n.init(api);
  await window.eula.ensure(api);

  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  document.querySelectorAll('.qcard').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.goto)));

  $('homeOneKey').addEventListener('click', () => {
    state.selected.clear();
    for (const t of state.targets) {
      if (t.group === 'disk' && t.defaultChecked && t.level === 'safe') state.selected.add(t.id);
    }
    renderTargets('disk');
    refreshButtons();
    doClean('disk');
  });
  $('homeManual').addEventListener('click', () => switchTab('disk'));
  $('memTrim').addEventListener('click', doMemTrim);
  $('winMin').addEventListener('click', () => api.winMinimize());
  $('winClose').addEventListener('click', () => api.winClose());

  $('diskScan').addEventListener('click', () => doScan('disk'));
  $('diskClean').addEventListener('click', () => doClean('disk'));
  $('sysScan').addEventListener('click', () => doScan('system'));
  $('sysClean').addEventListener('click', () => doClean('system'));
  $('refreshFree').addEventListener('click', refreshFree);

  $('diskSelectSafe').addEventListener('click', () => {
    state.selected.clear();
    for (const t of state.targets) {
      if (t.group === 'disk' && t.defaultChecked && t.level === 'safe') state.selected.add(t.id);
    }
    renderTargets('disk');
    refreshButtons();
  });
  $('diskSelectNone').addEventListener('click', () => {
    for (const t of state.targets) if (t.group === 'disk') state.selected.delete(t.id);
    renderTargets('disk');
    refreshButtons();
  });

  $('startupRefresh').addEventListener('click', loadStartup);
  $('openBackup').addEventListener('click', async () => {
    if (state.startupMeta && state.startupMeta.backupDir) await api.openPath(state.startupMeta.backupDir);
  });

  $('folderScan').addEventListener('click', doFolderScan);
  $('updateCheck').addEventListener('click', doUpdateCheck);
  $('updateDownload').addEventListener('click', doUpdateDownload);
  $('updateInstall').addEventListener('click', doUpdateInstall);
  api.onUpdateState(applyUpdateState);
  $('logRefresh').addEventListener('click', loadLog);
  $('logOpen').addEventListener('click', async () => {
    if (state.paths && state.paths.logPath) await api.openPath(state.paths.logPath);
  });

  $('ledgerRefresh').addEventListener('click', loadLedger);
  $('ledgerUndoAll').addEventListener('click', doUndoAll);
  $('rpStatus').addEventListener('click', showRestorePoint);
  $('rpCreate').addEventListener('click', doCreateRestorePoint);

  $('homeHealth').addEventListener('click', openHealth);
  $('healthQuick').addEventListener('click', () => runHealth(false));
  $('healthDeep').addEventListener('click', () => runHealth(true));
  $('healthExport').addEventListener('click', doHealthExport);
  $('healthClose').addEventListener('click', () => $('healthModal').classList.add('hidden'));
  api.onHealthProgress((p) => {
    if (p && p.message) $('healthCounts').textContent = p.message;
  });
  api.onRestorePointState((s) => {
    if (!s) return;
    if (s.phase === 'working') status(s.message || '正在创建还原点…');
    else $('rpState').textContent = '还原点：' + (s.reason || '');
  });

  api.onCleanProgress((p) => {
    if (p.phase === 'start') {
      const t = state.byId.get(p.id);
      status('正在处理: ' + (t ? t.name : p.id));
    }
  });
  api.onFolderProgress((p) => {
    $('folderProgress').textContent = `正在统计 ${p.done}/${p.total}: ${p.name}`;
  });

  state.paths = await api.getPaths();
  buildFolderRoots();

  state.targets = await api.listTargets();
  state.byId = new Map(state.targets.map((t) => [t.id, t]));
  for (const t of state.targets) if (t.defaultChecked) state.selected.add(t.id);

  renderTargets('disk');
  renderTargets('system');
  initSystemCards();
  refreshButtons();
  await refreshFree();
  await refreshBrowserBanner();
  startMonitor();
  initSettings();
  initBaseline();
  if (window.tiers) await window.tiers.ensureLoaded();
}

// ---------- 关闭方式：自绘询问弹窗 ----------

// 主进程在 close 事件里拦下 ✕ / Alt+F4 后通知这里。不用系统消息框：
// 那个弹出来是 Windows 的样式，和整个界面的风格是两套。
function closeAsk() {
  const modal = $('closeModal');
  const remember = $('closeRemember');
  remember.checked = false;
  modal.classList.remove('hidden');

  const answer = (choice) => {
    if (remember.checked) {
      api.winCloseAnswer(choice).then(refreshCloseBehavior).catch(() => {});
    }
    modal.classList.add('hidden');
    // 走 hide/quit 两个专用通道：winClose 会被主进程的 close 监听再拦一次，等于问了又问
    if (choice === 'quit') api.winQuit();
    else api.winHide();
  };
  const cancel = () => modal.classList.add('hidden');
  $('closeHide').onclick = () => answer('hide');
  $('closeQuit').onclick = () => answer('quit');
  $('closeCancel').onclick = cancel;
}

function refreshCloseBehavior() {
  return api.settingsGet().then((s) => {
    const remembered = s.closeRemember === true && (s.closeBehavior === 'hide' || s.closeBehavior === 'quit');
    const label = $('setCloseBehavior');
    label.textContent = !remembered ? '每次询问' : (s.closeBehavior === 'hide' ? '最小化到后台' : '彻底退出');
    $('setCloseReset').classList.toggle('hidden', !remembered);
  });
}

// ---------- 软件设置 ----------

async function initSettings() {
  const modal = $('settingsModal');
  let s = {};
  try { s = (await api.settingsGet()) || {}; } catch (e) { /* 读不到就用默认值 */ }

  if (window.bgFx) window.bgFx.setEnabled(s.fx !== false);
  $('setFx').checked = s.fx !== false;
  $('setAutoUpdate').checked = s.autoUpdate !== false;
  $('setRestorePoint').checked = s.autoRestorePoint === true;
  $('setLang').value = window.i18n ? window.i18n.lang : 'zh';

  $('openSettings').addEventListener('click', () => {
    $('setLang').value = window.i18n ? window.i18n.lang : 'zh';
    refreshCloseBehavior().catch(() => {});
    modal.classList.remove('hidden');
  });
  $('settingsClose').addEventListener('click', () => modal.classList.add('hidden'));

  $('setLang').addEventListener('change', async () => {
    const v = $('setLang').value;
    if (window.i18n) await window.i18n.setLang(v, api);
    const sel = $('langSel');
    if (sel) sel.value = v;
  });
  $('setFx').addEventListener('change', async () => {
    const on = $('setFx').checked;
    if (window.bgFx) window.bgFx.setEnabled(on);
    await api.settingsSet({ fx: on });
  });
  $('setAutoUpdate').addEventListener('change', async () => {
    await api.settingsSet({ autoUpdate: $('setAutoUpdate').checked });
  });
  $('setRestorePoint').addEventListener('change', async () => {
    const on = $('setRestorePoint').checked;
    await api.settingsSet({ autoRestorePoint: on });
    status(on ? '已开启：应用一键优化前会先建还原点（需一次管理员授权）' : '已关闭：应用一键优化前不再自动建还原点', 'ok');
  });

  $('setCloseReset').addEventListener('click', async () => {
    await api.winCloseReset();
    refreshCloseBehavior().catch(() => {});
    status('已恢复：下次关闭程序时会重新询问', 'ok');
  });
  refreshCloseBehavior().catch(() => {});
  api.onCloseAsk(closeAsk);
  // 从托盘唤回时补一次翻译：隐藏期间切过语言的话在这里兜住
  api.onWinShow(() => { if (window.i18n) window.i18n.apply(); });
  // 收起/最小化时停工，回到前台再续：看不见还采样、画动画只是白烧资源
  api.onWinActive((on) => {
    if (window.bgFx) window.bgFx.setPaused(!on);
    const cur = document.querySelector('.tab.active');
    if (!on) { stopMonitor(); return; }
    if (cur && cur.dataset.tab === 'home') startMonitor();
  });

  try {
    const v = await api.appVersion();
    if (v) $('setVersion').textContent = 'v' + v;
  } catch (e) { /* 版本号显示失败留空 */ }
}

init().catch((e) => status('初始化失败: ' + (e && e.message ? e.message : e), 'err'));
