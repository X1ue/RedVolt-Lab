'use strict';
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
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
const { runCommand } = require('./engine/ps');

let win = null;

app.setAppUserModelId('com.local.sysoptimizer');

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function createWindow() {
  const iconPath = path.join(__dirname, 'build', 'icon.ico');
  win = new BrowserWindow({
    width: 1080,
    height: 780,
    minWidth: 900,
    minHeight: 640,
    title: 'RedVolt Lab',
    backgroundColor: '#000000',
    frame: false,
    maximizable: false,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('closed', () => { win = null; });
}

async function freeSpace() {
  const r = await runCommand('(Get-PSDrive C).Free');
  const n = Number(String(r.stdout).trim());
  return Number.isFinite(n) ? n : null;
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

// ==================== IPC ====================

ipcMain.handle('targets:list', () => config.targets.map((t) => ({
  id: t.id, name: t.name, group: t.group, level: t.level, note: t.note,
  admin: !!t.admin, kind: t.kind, defaultChecked: !!t.defaultChecked,
})));

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
  }
  return { ...r, results: named, before, after, summary: s };
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
  return r;
});

ipcMain.handle('gpu:delProfile', async (e, profile, name, confirmed) => {
  if (confirmed !== true) return { ok: false, message: '未经确认，已拒绝修改' };
  const label = typeof name === 'string' ? name : '';
  if (!label) return { ok: false, message: '缺少方案名' };
  const r = await gpu.delProfile(profile, label);
  log.append(`显卡移除方案 | ${label} | ${r.ok ? '成功' : '失败: ' + r.error}`);
  return r;
});

ipcMain.handle('gpu:set', async (e, profile, name, id, value, confirmed) => {
  if (confirmed !== true) return { ok: false, message: '未经确认，已拒绝修改' };
  const r = await gpu.set(profile, name, id, value);
  log.append(`显卡设置 | ${name || profile} ${id}=${value} | ${r.ok ? '成功' : '失败: ' + r.error}`);
  return r;
});

ipcMain.handle('gpu:reset', async (e, profile, name, id, confirmed) => {
  if (confirmed !== true) return { ok: false, message: '未经确认，已拒绝修改' };
  const r = await gpu.reset(profile, name, id);
  log.append(`显卡恢复默认 | ${name || profile} ${id} | ${r.ok ? '成功' : '失败: ' + r.error}`);
  return r;
});

ipcMain.handle('power:get', () => power.status());
ipcMain.handle('power:set', async (e, key, confirmed) => {
  if (confirmed !== true) return { ok: false, message: '未经确认，已拒绝修改' };
  const r = await power.apply(key, true);
  log.append(`电源计划 | ${key} | ${r.ok ? (r.unchanged ? '已是当前' : '成功') : '失败: ' + r.message}`);
  return r;
});
ipcMain.handle('power:setGuid', async (e, guid, confirmed) => {
  if (confirmed !== true) return { ok: false, message: '未经确认，已拒绝修改' };
  const r = await power.applyGuid(guid, true);
  log.append(`电源计划 | ${guid} | ${r.ok ? (r.unchanged ? '已是当前' : '成功') : '失败: ' + r.message}`);
  return r;
});

// ==================== 游戏开关（注册表白名单，改前备份） ====================

ipcMain.handle('game:get', () => game.status());

ipcMain.handle('game:apply', async (e, id, mode, confirmed) => {
  if (confirmed !== true) return { ok: false, message: '未经确认，已拒绝修改' };
  const r = await game.apply(id, mode, true);
  log.append(`游戏开关 | ${id} → ${mode} | ${r.ok ? (r.unchanged ? '已是该状态' : '成功') : '失败: ' + (r.message || '')}`);
  return r;
});

ipcMain.handle('game:restore', async (e, confirmed) => {
  if (confirmed !== true) return { ok: false, message: '未经确认，已拒绝修改' };
  const r = await game.restoreAll(true);
  log.append(`游戏开关还原 | ${r.ok ? '已还原 ' + (r.restored || 0) + ' 项' : '失败: ' + (r.message || '')}`);
  return r;
});

// ==================== 一键优化模式（三档预设） ====================

ipcMain.handle('tiers:info', () => tiers.info());
ipcMain.handle('tiers:preview', (e, key) => tiers.preview(typeof key === 'string' ? key : ''));

ipcMain.handle('tiers:apply', async (e, key, confirmed) => {
  if (confirmed !== true) return { ok: false, message: '未经确认，已拒绝修改' };
  const r = await tiers.apply(typeof key === 'string' ? key : '', true);
  const parts = [];
  if (r.power) parts.push('电源' + (r.power.ok ? '已改' : '失败'));
  if (r.game) parts.push('系统开关' + r.game.count + '项' + (r.game.ok ? '已改' : '失败'));
  if (r.gpu) parts.push('N卡' + r.gpu.count + '项' + (r.gpu.ok ? '已改' : '失败'));
  log.append(`一键优化 | ${key} | ${r.ok ? (r.unchanged ? '已是该档位状态' : parts.join('，')) : '失败: ' + (r.errors || []).join('；')}`);
  return r;
});

ipcMain.handle('tiers:restore', async (e, confirmed) => {
  if (confirmed !== true) return { ok: false, message: '未经确认，已拒绝修改' };
  const r = await tiers.restore(true);
  log.append(`一键优化还原 | ${r.ok ? '已按快照还原（N卡 ' + r.restored.gpu + ' 项、开关 ' + r.restored.game + ' 项）' : '失败: ' + (r.message || '')}`);
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
  const low = target.toLowerCase();
  const ok = allowed.some((r) => {
    const rl = r.toLowerCase();
    return low === rl || low.startsWith(rl + path.sep);
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

ipcMain.handle('paths:get', () => ({
  userData: app.getPath('userData'),
  backupDir: startup.info().backupDir,
  logPath: log.getPath(),
  homedir: os.homedir(),
  localAppData: config.paths.LOCALAPPDATA,
  appData: config.paths.APPDATA,
  temp: config.paths.TEMP,
  programData: config.paths.PROGRAMDATA,
}));

ipcMain.handle('shell:openPath', (e, target) => {
  if (typeof target !== 'string' || !target) return 'invalid';
  const allowed = [app.getPath('userData'), startup.info().backupDir, log.getPath()].filter(Boolean);
  const low = target.toLowerCase();
  const ok = allowed.some((a) => low === a.toLowerCase() || low.startsWith(a.toLowerCase() + path.sep));
  if (!ok) return 'not-allowed';
  return shell.openPath(target);
});

// ==================== 自动更新 ====================

ipcMain.handle('update:get', () => updater.state());
ipcMain.handle('update:check', () => updater.check());
ipcMain.handle('update:download', () => updater.download());
ipcMain.handle('update:install', (e, confirmed) => updater.install(confirmed));

// ==================== 设置（界面语言等） ====================

ipcMain.handle('settings:get', () => settings.get());
ipcMain.handle('settings:set', (e, patch) => settings.set(patch));
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


// ==================== 生命周期 ====================

app.whenReady().then(() => {
  const migrated = migrate.run();
  const userData = app.getPath('userData');
  admin.init(userData);
  startup.init(userData);
  log.init(userData);
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
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  gload.stop();
  if (process.platform !== 'darwin') app.quit();
});
