'use strict';
const { app, BrowserWindow, Tray, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

const config = require('./engine/config');
const scan = require('./engine/scan');
const clean = require('./engine/clean');
const admin = require('./engine/admin');
const startup = require('./engine/startup');
const sysinfo = require('./engine/sysinfo');
const metrics = require('./engine/metrics');
const gload = require('./engine/gload');
const system = require('./engine/system');
const log = require('./engine/log');
const updater = require('./engine/updater');
const settings = require('./engine/settings');
const migrate = require('./engine/migrate');
const gpu = require('./engine/gpu');
const power = require('./engine/power');
const game = require('./engine/game');
const tiers = require('./engine/tiers');
const memtrim = require('./engine/memtrim');
const ledger = require('./engine/ledger');
const health = require('./engine/health');
const restorepoint = require('./engine/restorepoint');
const drivers = require('./engine/drivers');
const winsxs = require('./engine/winsxs');
const baseline = require('./engine/baseline');
const { runCommand } = require('./engine/ps');

let win = null;
let tray = null;
let isQuitting = false;

// 托盘休眠：藏起来满 60 秒就把渲染进程整个拆掉，点托盘再重建。
// 隐藏态的 CPU 实测已接近 0（5 秒 0～16ms），这一刀省的是内存：渲染进程连同页面里
// 攒下的扫描结果、显卡设置表、图表数据一起还回去。代价是唤醒要 0.5～1 秒重建。
const SLEEP_AFTER_MS = 60000;
const TABS = new Set(['home', 'disk', 'system', 'gpu', 'power', 'game', 'startup', 'info', 'update', 'log']);
let sleepTimer = null;
let rendererAsleep = false;
let rendererBusy = false;
let lastBounds = null;
let lastTab = 'home';
let wakeReveal = null;               // 唤醒重建时「可以露脸了」的回调，等渲染层报 ready 才触发
let wakingPending = false;           // 这次窗口是不是唤醒重建的，决定 ready 时要不要补发 win:active

app.setAppUserModelId('com.local.sysoptimizer');

// 锁按 userData 目录算：便携版和安装版共用 %AppData%\RedVolt Lab，所以两者互斥，只能开一个。
const gotSingleLock = app.requestSingleInstanceLock();
if (!gotSingleLock) {
  app.quit();
} else {
  // 再点图标 = 把人叫回前台而不是再起一份：休眠中重建窗口，醒着就露脸聚焦。
  app.on('second-instance', () => { showFromTray(); });
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function cancelRendererSleep() {
  if (sleepTimer != null) { clearTimeout(sleepTimer); sleepTimer = null; }
}

function scheduleRendererSleep() {
  cancelRendererSleep();
  if (rendererAsleep) return;
  sleepTimer = setTimeout(trySleepRenderer, SLEEP_AFTER_MS);
}

function trySleepRenderer() {
  sleepTimer = null;
  if (rendererAsleep || !win || win.isDestroyed()) return;
  if (win.isVisible()) return;                  // 已经回到前台，不拆
  if (!tray || tray.isDestroyed()) return;      // 没有托盘就没有叫醒的路，绝不拆
  // 扫描/清理要跑几十秒到几分钟，结果只活在当前这一个页面里：正忙就再等一轮，别吞掉用户的活儿
  if (rendererBusy) { scheduleRendererSleep(); return; }
  lastBounds = win.getBounds();
  rendererAsleep = true;
  win.destroy();                                // → 'closed' → win = null
}

// 托盘菜单是原生控件，渲染层的翻译器碰不到，只能按设置里的语言自己拼
const TRAY_TEXT = {
  zh: { tip: 'RedVolt Lab 正在后台运行', show: '显示主界面', quit: '退出' },
  en: { tip: 'RedVolt Lab is running in the background', show: 'Show main window', quit: 'Quit' },
};

function trayText() {
  return TRAY_TEXT[settings.get().lang === 'en' ? 'en' : 'zh'];
}

// ---------- 主题图标 ----------
// 托盘和窗口图标是运行时可换的，跟着「界面主题」走；exe 内嵌的那份在打包时就定死了，
// 资源管理器 / 卸载列表 / 固定到任务栏的图标换不了，这是 Electron 的边界，不是没做。
const ICON_FILE = { dark: 'icon.ico', blue: 'icon-blue.ico' };

function themeName() {
  return settings.get().theme === 'blue' ? 'blue' : 'dark';
}

/** 蓝图标缺文件时退回默认图标：托盘一旦建不出来，hideToBackground 会退化成直接关窗口。 */
function themeIconPath(name) {
  const primary = path.join(__dirname, 'build', ICON_FILE[name] || ICON_FILE.dark);
  if (fs.existsSync(primary)) return primary;
  const fallback = path.join(__dirname, 'build', ICON_FILE.dark);
  return fs.existsSync(fallback) ? fallback : null;
}

function applyThemeIcons(name) {
  const p = themeIconPath(name === 'blue' ? 'blue' : themeName());
  if (!p) return;
  if (tray && !tray.isDestroyed()) tray.setImage(p);
  if (win && !win.isDestroyed()) win.setIcon(p);
}

/** 首次进后台才建托盘，平时不给任务栏添图标。图标是 .ico，Windows 原生支持。 */
function ensureTray() {
  if (tray && !tray.isDestroyed()) return tray;
  const p = themeIconPath(themeName());
  if (!p) return null;
  tray = new Tray(p);
  const t = trayText();
  tray.setToolTip(t.tip);
  // 右键菜单每次弹出时现拼，语言切换后不需要重建托盘
  tray.on('right-click', () => {
    const tt = trayText();
    tray.popUpContextMenu(Menu.buildFromTemplate([
      { label: tt.show, click: () => showFromTray() },
      { type: 'separator' },
      { label: tt.quit, click: () => closeWindow() },
    ]));
  });
  tray.on('click', () => {
    // 休眠中 win 是 null，这里必须能叫得醒，否则托盘成了死图标
    if (rendererAsleep || !win || win.isDestroyed()) { showFromTray(); return; }
    if (win.isVisible()) win.hide(); else showFromTray();
  });
  return tray;
}

function showFromTray() {
  if (rendererAsleep) {
    cancelRendererSleep();
    rendererAsleep = false;
    createWindow({ waking: true });
    return;
  }
  if (!win || win.isDestroyed()) return;
  cancelRendererSleep();
  win.show();
  win.focus();
  // 隐藏期间切了语言的话，趁这次回到前台补上
  send('win:show');
}

/** 收进后台：窗口藏起来，靠托盘图标回来。 */
function hideToBackground() {
  if (!win || win.isDestroyed()) return;
  // 托盘建不出来就绝不能藏窗口，否则用户没有把程序叫回来的路
  if (!ensureTray()) {
    closeWindow();
    return;
  }
  win.hide();
}

/** 真正退出：先立旗，否则 win.on('close') 会把这次关闭也拦下来。 */
function closeWindow() {
  if (!win || win.isDestroyed()) {
    app.quit();
    return;
  }
  isQuitting = true;
  win.close();
}

function createWindow(opts = {}) {
  const waking = opts.waking === true;
  rendererBusy = false;            // 新页面必然不忙，清零旧标志，休眠不会永久卡住
  wakingPending = waking;
  const iconPath = themeIconPath(themeName());
  const bounds = waking && lastBounds ? lastBounds : { width: 1080, height: 780 };
  win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 900,
    minHeight: 640,
    title: 'RedVolt Lab',
    backgroundColor: '#000000',
    frame: false,
    maximizable: false,
    // 唤醒时先不显示，等页面画好再揭，避免用户看到一帧空壳
    show: !waking,
    icon: iconPath || undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.setMenuBarVisibility(false);
  // 靠 URL 参数回原标签页：页面自己从 location.search 读，不等 IPC，没有时序竞争。
  // wake=1 同时告诉渲染层「这是唤醒重建，首屏先别采样」，等露脸的 show 事件再起监控。
  // theme 也走 query：预加载脚本在沙箱里读不到 settings.json，让渲染层自己读文件更麻烦，
  // 而主进程手上就有这个值 —— 首屏画出来之前就把主题定死，蓝主题不会先闪一帧暗红。
  const indexPath = path.join(__dirname, 'renderer', 'index.html');
  const theme = themeName();
  if (waking) win.loadFile(indexPath, { query: { wake: '1', tab: lastTab, theme } });
  else win.loadFile(indexPath, { query: { theme } });
  win.on('closed', () => { win = null; });
  if (waking) {
    let revealed = false;
    const w = win;
    const reveal = () => {
      if (revealed || w.isDestroyed()) return;
      revealed = true;
      wakeReveal = null;
      w.show();
      w.focus();
    };
    // 等页面自己报「我装好了」再露脸：ready-to-show 只保证画了第一帧，不等等于事件监听器装好，
    // 那时候发 win:active 会石沉大海，首页指标就一直是空的。
    wakeReveal = reveal;
    // 兜底：渲染层初始化挂了也没人报 ready，2 秒后照样露脸，不能把界面锁在黑里
    setTimeout(reveal, 2000);
  }
  // ✕ 和 Alt+F4 都走这里：没记住选择就先问，问了再决定收起还是退出
  win.on('close', (e) => {
    if (isQuitting || rendererAsleep) return;
    const s = settings.get();
    if (s.closeRemember !== true || !s.closeBehavior) {
      e.preventDefault();
      send('win:closeAsk');
      return;
    }
    if (s.closeBehavior === 'hide') {
      e.preventDefault();
      hideToBackground();
    }
  });
  // 看不见的时候别白干活：渲染进程靠这两个事件停掉采样和背景动画
  // 藏进托盘再满 60 秒，就顺带排一次「拆渲染进程」的闹钟；最小化不排（随时要点回来）
  win.on('hide', () => { send('win:active', false); scheduleRendererSleep(); });
  win.on('minimize', () => send('win:active', false));
  win.on('show', () => { cancelRendererSleep(); send('win:active', true); });
  win.on('restore', () => { cancelRendererSleep(); send('win:active', true); });
}

async function freeSpace() {
  const r = await runCommand('(Get-PSDrive C).Free');
  const n = Number(String(r.stdout).trim());
  return Number.isFinite(n) ? n : null;
}

function realPath(value) {
  try { return fs.realpathSync.native(path.resolve(value)); }
  catch (e) { return null; }
}

/** 检查规范化后的实际路径边界，拒绝 .. 路径和越界的 junction / 符号链接。 */
function isWithinPath(target, root) {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

/** 渲染进程只能传 ID；路径一律由主进程从配置解析，杜绝任意路径删除 */
function validIds(input, wantAdmin) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const id of input) {
    if (typeof id !== 'string') continue;
    const t = config.getTarget(id);
    if (!t) continue;
    if (!!t.admin !== !!wantAdmin) continue;
    out.push(id);
  }
  return out;
}

function fmtMB(bytes) {
  return (Number(bytes || 0) / 1048576).toFixed(1) + ' MB';
}

function summarize(results) {
  let freed = 0;
  const warnings = [];
  const skipped = [];
  for (const r of results) {
    freed += Number(r.freed || 0);
    for (const w of r.warnings || []) warnings.push(`${r.name || r.id}: ${w}`);
    if (r.status === 'skipped' || r.status === 'refused') skipped.push(`${r.name || r.id}: ${r.message || '已跳过'}`);
    if (r.status === 'error') warnings.push(`${r.name || r.id}: ${r.message || '执行出错'}`);
  }
  return { freed, warnings, skipped };
}

// ==================== 变更账本辅助 ====================

function hexId(s) {
  const v = parseInt(String(s).replace(/^0x/i, ''), 16);
  return Number.isFinite(v) ? '0x' + ((v >>> 0).toString(16).toUpperCase()).padStart(8, '0') : null;
}

function hexVal(n) {
  const v = Number(n);
  return Number.isFinite(v) ? '0x' + ((v >>> 0).toString(16).toUpperCase()).padStart(8, '0') : null;
}

/** N 卡设置项的人话名称（驱动枚举出的 3D 设置标签表） */
function gpuSettingLabel(id, value) {
  const L = gpu.labelTable() || {};
  const key = hexId(id) || String(id);
  const name = (L.settings || {})[key] || key;
  if (value == null) return `${name} → 驱动默认`;
  const opt = ((L.values || {})[key] || {})[hexVal(value)];
  return opt ? `${name} → ${opt}` : `${name} → ${value}`;
}

/** 读回某项 N 卡设置的当前值，作为撤销时要写回的原值；null 表示驱动默认 */
async function gpuBeforeValue(profile, name, id) {
  const key = hexId(id);
  if (!key) return null;
  const all = await gpu.getAll(profile, name).catch(() => null);
  const v = all && all.ok && all.values ? all.values[key] : null;
  if (!v || v.value == null) return null;
  const n = parseInt(String(v.value).replace(/^0x/i, ''), 16);
  return Number.isFinite(n) ? n : null;
}

/** 清理类操作不可逆，账本如实标注，不假装能恢复 */
const NO_UNDO_DELETE = '删除的文件不经过回收站，物理上无法恢复；这条只作为记录';

/** 电源计划切换：原 GUID 由 power 模块回传，撤销就是切回去 */
function recordPower(r, key) {
  if (!r || !r.ok || r.unchanged) return;
  const prev = r.before || null;
  const next = r.target || null;
  ledger.record({
    source: '电源优化',
    label: `电源计划 → ${next ? next.name : key}`,
    undo: prev && prev.guid ? { type: 'power', guid: prev.guid } : null,
    undoHint: prev && prev.guid ? `撤销 = 切回「${prev.name || prev.guid}」` : '没读到切换前的计划，无法自动撤销',
  });
}

const GAME_NAMES = {
  hags: '硬件加速 GPU 计划（HAGS）',
  gamedvr: '游戏录制（Game DVR）',
  gamebar: 'Xbox 游戏栏',
  gamemode: '游戏模式',
  transparency: '窗口透明效果',
  visualfx: '视觉效果',
};
const MODE_NAMES = { on: '开启', off: '关闭', default: '恢复系统默认', 1: '最佳外观', 2: '最佳性能', 3: '自定义' };

function gameLabel(id, mode) {
  const n = GAME_NAMES[id] || String(id);
  const m = MODE_NAMES[String(mode)] || String(mode);
  return `${n} → ${m}`;
}

const TIER_NAMES = { balanced: '一档 · 平衡模式', quality: '二档 · 质量模式', esports: '三档 · 电竞模式' };

// ==================== IPC ====================

// hideWhenMissing 的项目（开发工具缓存等）本机不存在就整项不显示，避免列表里堆一堆「目录不存在」。
// 系统级目录普通权限根本 lstat 不到（EPERM），不能据此判断不存在，交给提权扫描如实报告。
ipcMain.handle('targets:list', async () => {
  const out = [];
  for (const t of config.targets) {
    if (t.hideWhenMissing && !t.admin) {
      let any = false;
      for (const d of config.targetPaths(t)) { if (await scan.pathExists(d)) { any = true; break; } }
      if (!any) continue;
    }
    out.push({
      id: t.id, name: t.name, group: t.group, level: t.level, note: t.note,
      admin: !!t.admin, kind: t.kind, defaultChecked: !!t.defaultChecked,
      section: t.section || '',
    });
  }
  return out;
});

ipcMain.handle('disk:free', () => freeSpace());

ipcMain.handle('scan:user', (e, ids) => scan.scanTargets(validIds(ids, false)));

ipcMain.handle('scan:system', (e, ids) => system.scanSystem(validIds(ids, true)));

ipcMain.handle('clean:user', async (e, ids, confirmed) => {
  if (confirmed !== true) return { ok: false, results: [], message: '未经确认，已拒绝执行' };
  const list = validIds(ids, false);
  if (!list.length) return { ok: true, results: [], message: '没有选中可清理的项目' };
  const before = await freeSpace();
  const results = await clean.cleanTargets(list, (p) => send('clean:progress', p));
  const after = await freeSpace();
  const s = summarize(results);
  const names = list.map((id) => config.getTarget(id).name).join('、');
  log.append(`用户态清理 | 项目: ${names} | 释放 ${fmtMB(s.freed)}` +
    (before != null && after != null ? ` | C盘可用 ${fmtMB(before)} → ${fmtMB(after)}` : '') +
    (s.warnings.length ? ` | 警告: ${s.warnings.join('；')}` : '') +
    (s.skipped.length ? ` | 跳过: ${s.skipped.join('；')}` : ''));
  ledger.record({
    source: '磁盘清理',
    label: `${names}（释放 ${fmtMB(s.freed)}）`,
    undo: null,
    undoHint: NO_UNDO_DELETE,
  });
  return { ok: true, results, before, after, summary: s };
});

ipcMain.handle('clean:system', async (e, ids, confirmed) => {
  if (confirmed !== true) return { ok: false, results: [], message: '未经确认，已拒绝执行' };
  const list = validIds(ids, true);
  if (!list.length) return { ok: true, results: [], canceled: false, message: '没有选中系统级项目' };
  const before = await freeSpace();
  const r = await system.cleanSystem(list);
  const after = await freeSpace();
  const named = (r.results || []).map((x) => {
    const t = config.getTarget(x.id);
    return { ...x, name: t ? t.name : x.id };
  });
  const s = summarize(named);
  if (!r.canceled) {
    log.append(`系统级清理 | 项目: ${list.map((id) => config.getTarget(id).name).join('、')}` +
      ` | 释放 ${fmtMB(s.freed)}` +
      (before != null && after != null ? ` | C盘可用 ${fmtMB(before)} → ${fmtMB(after)}` : '') +
      (r.message ? ` | ${r.message}` : '') +
      (s.warnings.length ? ` | 警告: ${s.warnings.join('；')}` : ''));
    ledger.record({
      source: '系统级清理',
      label: `${named.map((x) => x.name).join('、')}（释放 ${fmtMB(s.freed)}）`,
      undo: null,
      undoHint: NO_UNDO_DELETE,
    });
  }
  return { ...r, results: named, before, after, summary: s };
});

// ==================== 旧驱动包 ====================

ipcMain.handle('drivers:list', () => drivers.list());

ipcMain.handle('drivers:remove', async (e, pubs, confirmed) => {
  const r = await drivers.remove(pubs, confirmed);
  if (r.canceled || !r.removed.length) return r;
  log.append(`删除旧驱动包 | ${r.removed.join('、')}` +
    (r.skipped.length ? ` | 拒绝 ${r.skipped.length} 个: ${r.skipped.map((x) => `${x.pub}（${x.reason}）`).join('；')}` : ''));
  ledger.record({
    source: '旧驱动包',
    label: `删除 ${r.removed.length} 个旧驱动包（${r.removed.join('、')}）`,
    undo: null,
    undoHint: '驱动包已从驱动库移除，本软件无法把它放回去；确实需要时让 Windows 重新联网更新驱动，或用厂商安装包重装',
  });
  return r;
});

// ==================== 组件存储 WinSxS ====================

ipcMain.handle('winsxs:analyze', () => winsxs.analyze());

ipcMain.handle('winsxs:cleanup', async (e, mode, confirmed) => {
  const label = mode === 'cleanup-resetbase' ? '深度清理（/ResetBase）' : '常规清理';
  const r = await winsxs.cleanup(mode, confirmed, (p) => send('winsxs:progress', p));
  if (r.canceled) return r;
  if (r.ok) {
    log.append(`组件存储${label} | ${r.message}${r.tail ? ' | ' + r.tail : ''}`);
    ledger.record({
      source: '组件存储',
      label: `WinSxS ${label}`,
      undo: null,
      undoHint: mode === 'cleanup-resetbase'
        ? '被取代的组件版本已永久移除，之后已安装的 Windows 更新无法卸载；这条只作为记录'
        : '被取代的组件已经删除，无法放回；这条只作为记录',
    });
  } else if (confirmed === true) {
    log.append(`组件存储${label}失败 | ${r.message}`);
  }
  return r;
});

ipcMain.handle('browsers:status', async () => {
  const r = await runCommand(
    '@(Get-Process chrome, msedge -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name -Unique) -join ","'
  );
  const names = String(r.stdout).trim().split(',').filter(Boolean);
  return { running: names.length > 0, names };
});

ipcMain.handle('browsers:close', async () => {
  await runCommand('Stop-Process -Name chrome, msedge -Force -ErrorAction SilentlyContinue');
  for (let i = 0; i < 10; i++) {
    const st = await runCommand('@(Get-Process chrome, msedge -ErrorAction SilentlyContinue).Count');
    if (Number(String(st.stdout).trim()) === 0) break;
    await new Promise((res) => setTimeout(res, 400));
  }
  const after = await runCommand('@(Get-Process chrome, msedge -ErrorAction SilentlyContinue).Count');
  const left = Number(String(after.stdout).trim()) || 0;
  log.append(`关闭浏览器 | 剩余进程 ${left}`);
  return { ok: left === 0, left };
});

ipcMain.handle('startup:list', () => startup.list());

ipcMain.handle('startup:set', async (e, id, enabled, confirmed) => {
  if (typeof id !== 'string' || !id) return { ok: false, message: '参数错误' };
  if (confirmed !== true) return { ok: false, message: '未经确认，已拒绝修改' };
  const r = await startup.setEnabled(id, !!enabled);
  log.append(`启动项 ${enabled ? '启用' : '禁用'} | ${id} | ${r.ok ? '成功' : '失败: ' + r.message}`);
  if (r.ok) {
    ledger.record({
      source: '启动项',
      label: `${enabled ? '启用' : '禁用'}「${String(id).split('|').pop() || id}」`,
      undo: { type: 'startup', id, enabled: !enabled },
      undoHint: enabled ? '撤销 = 重新禁用该启动项' : '撤销 = 从备份恢复原注册表值 / 启动文件',
    });
  }
  return r;
});

ipcMain.handle('sysinfo:get', () => sysinfo.get());
ipcMain.handle('metrics:get', () => metrics.get());

ipcMain.handle('gpu:meta', () => gpu.meta());
ipcMain.handle('gpu:list', () => gpu.list());
ipcMain.handle('gpu:installed', (e, force) => gpu.installed(force === true));
ipcMain.handle('gpu:get', (e, profile, name) => gpu.get(profile, name));
ipcMain.handle('gpu:getAll', (e, profile, name) => gpu.getAll(profile, name));
ipcMain.handle('gpu:catalog', (e, force) => gpu.catalog(force === true));
ipcMain.handle('gpu:icons', (e, paths) => gpu.icons(Array.isArray(paths) ? paths : []));

// 只接受由本机文件对话框选出的 exe，渲染层无法指定任意路径写入驱动配置
const pickedExes = new Set();

ipcMain.handle('gpu:pickExe', async () => {
  if (!dialog || !win) return { ok: false, message: '窗口不可用' };
  const r = await dialog.showOpenDialog(win, {
    title: '选择程序主程序（.exe）',
    properties: ['openFile'],
    filters: [{ name: 'Program (exe)', extensions: ['exe'] }],
  });
  if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
  const p = r.filePaths[0];
  pickedExes.add(p);
  if (pickedExes.size > 20) pickedExes.delete(pickedExes.values().next().value);
  return { ok: true, exe: p };
});

ipcMain.handle('gpu:addApp', async (e, exePath, confirmed) => {
  if (confirmed !== true) return { ok: false, message: '未经确认，已拒绝修改' };
  const p = typeof exePath === 'string' ? exePath : '';
  if (!p || !pickedExes.has(p)) return { ok: false, message: '请先通过「添加程序」选择可执行文件' };
  const r = await gpu.addApp(p);
  log.append(`显卡添加程序 | ${path.basename(p)} | ${r.ok ? (r.existed ? '已存在方案' : '成功') : '失败: ' + r.error}`);
  if (r.ok && !r.existed && r.item) {
    ledger.record({
      source: '显卡优化',
      label: `新建方案「${r.item.label || r.item.name}」`,
      undo: { type: 'gpuProfile', profile: r.item.spec, name: r.item.name },
      undoHint: '撤销 = 删除这个新建的方案（该程序回到全局设置）',
    });
  }
  return r;
});

ipcMain.handle('gpu:delProfile', async (e, profile, name, confirmed) => {
  if (confirmed !== true) return { ok: false, message: '未经确认，已拒绝修改' };
  const label = typeof name === 'string' ? name : '';
  if (!label) return { ok: false, message: '缺少方案名' };
  const r = await gpu.delProfile(profile, label);
  log.append(`显卡移除方案 | ${label} | ${r.ok ? '成功' : '失败: ' + r.error}`);
  if (r.ok) {
    ledger.record({
      source: '显卡优化',
      label: `移除方案「${label}」`,
      undo: null,
      undoHint: '方案里的各项设置已随删除丢失，无法自动撤销；需要时重新「添加程序」再设一遍',
    });
  }
  return r;
});

ipcMain.handle('gpu:set', async (e, profile, name, id, value, confirmed) => {
  if (confirmed !== true) return { ok: false, message: '未经确认，已拒绝修改' };
  const before = await gpuBeforeValue(profile, name, id);
  const r = await gpu.set(profile, name, id, value);
  log.append(`显卡设置 | ${name || profile} ${id}=${value} | ${r.ok ? '成功' : '失败: ' + r.error}`);
  if (r.ok && before !== Number(value)) {
    ledger.record({
      source: '显卡优化',
      label: `「${name || '全局'}」${gpuSettingLabel(id, value)}`,
      undo: { type: 'gpu', profile, name: name || '', items: [{ id: hexId(id), value: before }] },
      undoHint: before == null ? '撤销 = 把该项恢复为驱动默认' : '撤销 = 写回原值 ' + before,
    });
  }
  return r;
});

ipcMain.handle('gpu:reset', async (e, profile, name, id, confirmed) => {
  if (confirmed !== true) return { ok: false, message: '未经确认，已拒绝修改' };
  const before = await gpuBeforeValue(profile, name, id);
  const r = await gpu.reset(profile, name, id);
  log.append(`显卡恢复默认 | ${name || profile} ${id} | ${r.ok ? '成功' : '失败: ' + r.error}`);
  if (r.ok && before != null) {
    ledger.record({
      source: '显卡优化',
      label: `「${name || '全局'}」${gpuSettingLabel(id, null)}`,
      undo: { type: 'gpu', profile, name: name || '', items: [{ id: hexId(id), value: before }] },
      undoHint: '撤销 = 写回原值 ' + before,
    });
  }
  return r;
});

ipcMain.handle('power:get', () => power.status());
ipcMain.handle('power:set', async (e, key, confirmed) => {
  if (confirmed !== true) return { ok: false, message: '未经确认，已拒绝修改' };
  const r = await power.apply(key, true);
  log.append(`电源计划 | ${key} | ${r.ok ? (r.unchanged ? '已是当前' : '成功') : '失败: ' + r.message}`);
  recordPower(r, String(key));
  return r;
});
ipcMain.handle('power:setGuid', async (e, guid, confirmed) => {
  if (confirmed !== true) return { ok: false, message: '未经确认，已拒绝修改' };
  const r = await power.applyGuid(guid, true);
  log.append(`电源计划 | ${guid} | ${r.ok ? (r.unchanged ? '已是当前' : '成功') : '失败: ' + r.message}`);
  recordPower(r, String(guid));
  return r;
});

// ==================== 游戏开关（注册表白名单，改前备份） ====================

ipcMain.handle('game:get', () => game.status());

ipcMain.handle('game:apply', async (e, id, mode, confirmed) => {
  if (confirmed !== true) return { ok: false, message: '未经确认，已拒绝修改' };
  const r = await game.apply(id, mode, true);
  log.append(`游戏开关 | ${id} → ${mode} | ${r.ok ? (r.unchanged ? '已是该状态' : '成功') : '失败: ' + (r.message || '')}`);
  if (r.ok && !r.unchanged) {
    ledger.record({
      source: '游戏开关',
      label: gameLabel(id, mode),
      undo: { type: 'game', ids: [String(id)] },
      undoHint: '撤销 = 按改前备份写回原来的注册表值',
    });
  }
  return r;
});

ipcMain.handle('game:restore', async (e, confirmed) => {
  if (confirmed !== true) return { ok: false, message: '未经确认，已拒绝修改' };
  const r = await game.restoreAll(true);
  log.append(`游戏开关还原 | ${r.ok ? '已还原 ' + (r.restored || 0) + ' 项' : '失败: ' + (r.message || '')}`);
  if (r.ok) {
    ledger.record({
      source: '游戏开关',
      label: `一键还原全部开关（${r.restored || 0} 项）`,
      undo: null,
      undoHint: '这本身就是一次还原，账本不支持「撤销还原」；需要的话重新逐项应用',
    });
  }
  return r;
});

// ==================== 一键优化模式（三档预设） ====================

ipcMain.handle('tiers:info', () => tiers.info());
ipcMain.handle('tiers:preview', (e, key) => tiers.preview(typeof key === 'string' ? key : ''));

ipcMain.handle('tiers:apply', async (e, key, confirmed, opts) => {
  if (confirmed !== true) return { ok: false, message: '未经确认，已拒绝修改' };
  const k = typeof key === 'string' ? key : '';
  // 1C：改前兜底。开了「优化前自动创建还原点」就先建（24 小时内已有则复用），
  // 建不成就把原因原样带给界面，绝不因为还原点失败而假装已保护
  let rp = null;
  if (settings.get().autoRestorePoint === true) {
    send('restorepoint:state', { phase: 'working', message: '正在创建系统还原点…' });
    rp = await restorepoint.ensureBefore(`RedVolt Lab 一键优化前（${TIER_NAMES[k] || k}）`);
    log.append(`优化前还原点 | ${rp.created ? '已创建' : rp.reused ? '复用已有' : '未创建'} | ${rp.reason || ''}`);
    send('restorepoint:state', { phase: 'done', ...rp });
  }
  const r = await tiers.apply(k, true, opts && opts.skipPower === true ? { skipPower: true } : null);
  const drift = opts && opts.skipPower === true;
  const parts = [];
  if (r.power) parts.push('电源' + (r.power.ok ? '已改' : '失败'));
  if (r.game) parts.push('系统开关' + r.game.count + '项' + (r.game.ok ? '已改' : '失败'));
  if (r.gpu) parts.push('N卡' + r.gpu.count + '项' + (r.gpu.ok ? '已改' : '失败'));
  // 体检里的「重新应用」只改开关与 N 卡，日志要按真实入口记，别混成一键优化
  log.append(`${drift ? '体检·重新应用（不动电源计划）' : '一键优化'} | ${key} | ${r.ok ? (r.unchanged ? '已是该档位状态' : parts.join('，')) : '失败: ' + (r.errors || []).join('；')}`);
  if (r.ok && !r.unchanged) {
    ledger.record({
      source: '一键优化',
      label: `${drift ? '重新应用' : '应用'}「${TIER_NAMES[k] || k}」（${parts.join('，') || '已改'}）`,
      undo: { type: 'tier' },
      undoHint: '撤销 = 按优化前快照回写电源计划、系统开关与 N 卡设置',
    });
  }
  return { ...r, restorePoint: rp };
});

ipcMain.handle('tiers:restore', async (e, confirmed) => {
  if (confirmed !== true) return { ok: false, message: '未经确认，已拒绝修改' };
  const r = await tiers.restore(true);
  log.append(`一键优化还原 | ${r.ok ? '已按快照还原（N卡 ' + r.restored.gpu + ' 项、开关 ' + r.restored.game + ' 项）' : '失败: ' + (r.message || '')}`);
  if (r.ok) {
    ledger.record({
      source: '一键优化',
      label: '还原到优化前（按快照回写）',
      undo: null,
      undoHint: '这本身就是一次还原，账本不支持「撤销还原」；需要的话重新应用档位',
    });
  }
  return r;
});

// ==================== 内存一键释放（只收工作集，不结束进程） ====================

ipcMain.handle('mem:trim', async (e, confirmed) => {
  if (confirmed !== true) return { ok: false, message: '未经确认，已拒绝执行' };
  const r = await memtrim.trim();
  log.append(`内存释放 | ${r.ok ? '整理 ' + r.trimmed + ' 个进程，工作集 ' + r.beforeMB.toFixed(0) + ' MB → ' + r.afterMB.toFixed(0) + ' MB（跳过 ' + r.skipped + ' 个）' : '失败: ' + (r.message || '')}`);
  return r;
});

ipcMain.handle('sysinfo:topFolders', (e, root, limit) => {
  const allowed = [
    os.homedir(), config.paths.LOCALAPPDATA, config.paths.APPDATA,
    config.paths.TEMP, config.paths.PROGRAMDATA,
  ];
  const target = typeof root === 'string' && root.trim() ? root.trim() : os.homedir();
  const realTarget = realPath(target);
  const ok = !!realTarget && allowed.some((r) => {
    const realRoot = realPath(r);
    return !!realRoot && isWithinPath(realTarget, realRoot);
  });
  if (!ok) {
    return Promise.resolve({
      root: target, items: [], error: '只允许扫描用户目录、AppData、Temp、ProgramData 及其子目录（只读）',
    });
  }
  const lim = Math.min(Math.max(parseInt(limit, 10) || 12, 1), 50);
  return sysinfo.topFolders(target, lim, (p) => send('folders:progress', p));
});

ipcMain.handle('log:read', () => log.readTail(200));

// ==================== 变更记录与撤销 ====================

ipcMain.handle('ledger:list', (e, limit) => {
  const n = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 500);
  return { ok: true, entries: ledger.list(n), stats: ledger.stats(), path: ledger.getPath() };
});

ipcMain.handle('ledger:undo', async (e, id, confirmed) => {
  if (confirmed !== true) return { ok: false, message: '未经确认，已拒绝撤销' };
  if (typeof id !== 'string' || !id) return { ok: false, message: '参数错误' };
  return ledger.undo(id, true);
});

ipcMain.handle('ledger:undoAll', async (e, confirmed) => {
  if (confirmed !== true) return { ok: false, message: '未经确认，已拒绝撤销' };
  return ledger.undoAll(true);
});

// ==================== 只读体检（不改任何设置） ====================

let lastHealth = null;

ipcMain.handle('health:quick', async () => {
  const r = await health.quick();
  if (r.ok) lastHealth = r;
  return r;
});

ipcMain.handle('health:deep', async () => {
  const r = await health.deep((p) => send('health:progress', p));
  if (r.ok) lastHealth = r;
  return r;
});

ipcMain.handle('health:export', async (e, text) => {
  if (!lastHealth || !Array.isArray(lastHealth.findings)) return { ok: false, messageKey: 'noResult' };
  if (!win) return { ok: false, message: '窗口不可用' };
  // 报告文本由渲染层按界面语言生成，主进程只负责落盘
  if (typeof text !== 'string' || !text.length || text.length > 2000000) return { ok: false, message: '报告内容异常，已拒绝写入' };
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const r = await dialog.showSaveDialog(win, {
    title: '保存体检报告',
    defaultPath: path.join(app.getPath('desktop'), `RedVolt体检报告-${stamp}.txt`),
    filters: [{ name: 'Text', extensions: ['txt'] }],
  });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  try {
    fs.writeFileSync(r.filePath, text, 'utf8');
  } catch (err) {
    return { ok: false, message: '写入失败：' + ((err && err.message) || err) };
  }
  log.append(`导出体检报告 | ${r.filePath}`);
  return { ok: true, path: r.filePath };
});

// ==================== 系统还原点（改前兜底，一次 UAC） ====================

ipcMain.handle('restorepoint:status', (e, force) => restorepoint.status(force === true));

ipcMain.handle('restorepoint:create', async (e, confirmed) => {
  if (confirmed !== true) return { ok: false, message: '未经确认，已拒绝创建' };
  const r = await restorepoint.ensureBefore('RedVolt Lab 手动创建', { force: true });
  log.append(`创建还原点 | ${r.created ? '成功' : r.reused ? '复用已有' : '未创建'} | ${r.reason || ''}`);
  return r;
});

ipcMain.handle('paths:get', () => ({
  userData: app.getPath('userData'),
  backupDir: startup.info().backupDir,
  logPath: log.getPath(),
  ledgerPath: ledger.getPath(),
  homedir: os.homedir(),
  localAppData: config.paths.LOCALAPPDATA,
  appData: config.paths.APPDATA,
  temp: config.paths.TEMP,
  programData: config.paths.PROGRAMDATA,
}));

ipcMain.handle('shell:openPath', (e, target) => {
  if (typeof target !== 'string' || !target) return 'invalid';
  const allowed = [app.getPath('userData'), startup.info().backupDir, log.getPath()].filter(Boolean);
  const realTarget = realPath(target);
  const ok = !!realTarget && allowed.some((a) => {
    const realRoot = realPath(a);
    return !!realRoot && isWithinPath(realTarget, realRoot);
  });
  if (!ok) return 'not-allowed';
  return shell.openPath(target);
});

// ==================== 自动更新 ====================

ipcMain.handle('update:get', () => updater.state());
ipcMain.handle('update:check', () => updater.check());
ipcMain.handle('update:download', () => updater.download());
ipcMain.handle('update:install', (e, confirmed) => updater.install(confirmed));

// ==================== 性能基线（优化前 / 优化后） ====================

ipcMain.handle('baseline:get', async () => {
  const store = baseline.get();
  let live = null;
  let error = '';
  try {
    live = await baseline.capture({});
  } catch (e) {
    error = (e && e.message) || String(e);
  }
  // 「优化后」没记过就用当前值顶上，界面上会标明这是实时数字
  const after = store.after || live;
  return { store, live, error, afterIsLive: !store.after, rows: baseline.compare(store.before, after) };
});

// slot 只认 before / after，其余值一律丢掉，避免渲染层往文件里塞任意结构
ipcMain.handle('baseline:snapshot', async (e, slot, withBench) => {
  const key = slot === 'after' ? 'after' : 'before';
  const snap = await baseline.capture({ withBench: withBench === true });
  const store = baseline.write({ [key]: snap });
  log.append(`记录性能基线（${key === 'before' ? '优化前' : '优化后'}）| 空闲内存 ${fmtMB(snap.memFree)} | 4K ${snap.bench ? snap.bench.value + ' ' + snap.bench.units : '未测'}`);
  return { store, benchError: snap.benchError || '' };
});

ipcMain.handle('baseline:clear', () => ({ store: baseline.write({ before: null, after: null }) }));

// ==================== 设置（界面语言等） ====================

ipcMain.handle('settings:get', () => settings.get());
ipcMain.handle('settings:set', (e, patch) => {
  const merged = settings.set(patch);
  // theme 过了白名单校验才落到 merged 里，这里只认已校验的值
  if (patch && typeof patch === 'object' && 'theme' in patch) applyThemeIcons(merged.theme);
  return merged;
});
ipcMain.handle('app:version', () => app.getVersion());

// ==================== 无边框窗口控制（最小化 / 关闭） ====================

ipcMain.handle('win:minimize', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w) w.minimize();
});

ipcMain.handle('win:close', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w) w.close();
});

// 弹窗只负责收集选择，收起/退出走这两个通道：
// 直接 close 会被上面的 close 监听再拦一次，等于问了又问。
ipcMain.handle('win:hide', () => hideToBackground());

ipcMain.handle('win:quit', () => closeWindow());

ipcMain.handle('win:closeAnswer', (e, choice) => {
  if (choice !== 'hide' && choice !== 'quit') return settings.get();
  return settings.set({ closeBehavior: choice, closeRemember: true });
});

ipcMain.handle('win:closeReset', () => settings.unset(['closeBehavior', 'closeRemember']));

// 渲染层切标签页时报备一声，休眠重建时才知道该回到哪一页。白名单在 TABS 里，
// 值只用来挑 query 参数，不拼进任何路径或选择器。
ipcMain.on('win:tab', (e, name) => {
  if (typeof name === 'string' && TABS.has(name)) lastTab = name;
});

// 渲染层的「正在忙」由 setBusy 单点上报：正忙时不休眠，避免扫描/清理的结果被拆掉。
// 标志位只影响休眠，不影响任何真实操作；重建窗口时会清零，卡不住。
ipcMain.on('win:busy', (e, on) => { rendererBusy = on === true; });

// 唤醒重建：页面把监听器装好后报一声，主进程此刻才露脸，保证露脸后发的 win:active 有人接。
ipcMain.on('win:ready', () => {
  const reveal = wakeReveal;
  wakeReveal = null;
  if (reveal) reveal();
  // 兜底闹钟可能比页面更早露脸，那一次 win:active 是空发、没人接。这里补一发：
  // 唤醒的窗口本来就是给前台用的，重复的 active true 渲染层是幂等的（startMonitor 有定时器守卫）。
  if (wakingPending) send('win:active', true);
});


// ==================== 生命周期 ====================

app.whenReady().then(() => {
  // app.quit() 在 ready 之前调用不保证拦得住 whenReady，这里兜住：没锁就不建窗、不初始化任何模块
  if (!gotSingleLock) return;
  const migrated = migrate.run();
  const userData = app.getPath('userData');
  admin.init(userData);
  startup.init(userData);
  log.init(userData);
  // 撤销动作全部委托给各模块已有的写通道，账本自己不碰注册表 / 驱动
  ledger.init(userData, { tiers, game, power, gpu, startup, appendLog: log.append });
  baseline.init(userData);
  if (migrated.from) {
    log.append(`迁移旧版本数据 | ${migrated.from} → ${[...migrated.files, ...migrated.dirs].join(', ') || '无可迁移内容'}${migrated.error ? ' | 失败: ' + migrated.error : ''}`);
  }
  updater.init({ send, appendLog: log.append });
  log.append('应用启动');
  createWindow();
  const st = settings.get();
  if (app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR && st.eula && st.autoUpdate !== false) {
    setTimeout(() => { updater.check(); }, 4000);
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) { rendererAsleep = false; createWindow(); }
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  if (tray) { tray.destroy(); tray = null; }
});

app.on('window-all-closed', () => {
  gload.stop();
  // 休眠拆掉的窗口不算「所有窗口关了」：托盘还在，进程得活着等唤醒
  if (rendererAsleep && tray && !tray.isDestroyed()) return;
  if (process.platform !== 'darwin') app.quit();
});
