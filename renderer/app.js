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
  if (name === 'info' && !state.infoLoaded) loadInfo();
  if (name === 'log') loadLog();
}

// ---------- 清理项列表 ----------

function renderTargets(group) {
  const host = $(group === 'disk' ? 'diskList' : 'systemList');
  host.textContent = '';
  for (const t of state.targets.filter((x) => x.group === group)) {
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

function buildFolderRoots() {
  const sel = $('folderRoot');
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
  refreshButtons();
  await refreshFree();
  await refreshBrowserBanner();
  startMonitor();
  initSettings();
  if (window.tiers) await window.tiers.ensureLoaded();
}

// ---------- 软件设置 ----------

async function initSettings() {
  const modal = $('settingsModal');
  let s = {};
  try { s = (await api.settingsGet()) || {}; } catch (e) { /* 读不到就用默认值 */ }

  if (window.bgFx) window.bgFx.setEnabled(s.fx !== false);
  $('setFx').checked = s.fx !== false;
  $('setAutoUpdate').checked = s.autoUpdate !== false;
  $('setLang').value = window.i18n ? window.i18n.lang : 'zh';

  $('openSettings').addEventListener('click', () => {
    $('setLang').value = window.i18n ? window.i18n.lang : 'zh';
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

  try {
    const v = await api.appVersion();
    if (v) $('setVersion').textContent = 'v' + v;
  } catch (e) { /* 版本号显示失败留空 */ }
}

init().catch((e) => status('初始化失败: ' + (e && e.message ? e.message : e), 'err'));
