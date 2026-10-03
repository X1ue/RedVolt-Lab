'use strict';
const { app } = require('electron');

// 更新源：GitHub Releases 的最新 release 资产目录（公开仓库，客户端无需任何密钥）
// SYSOPT_FEED_URL 仅用于本地联调冒烟测试，正常分发不需要设置
const FEED_URL = process.env.SYSOPT_FEED_URL || 'https://github.com/X1ue/SYS-OPTIMIZER/releases/latest/download/';
const CHECK_TIMEOUT_MS = 30000;

let push = () => {};
let appendLog = () => {};
let au = null;
let found = null;
let downloaded = false;
let downloading = false;

function msg(e) {
  if (!e) return '未知错误';
  return String(e.message || e).slice(0, 300);
}

/** 把 electron-updater 的英文/HTTP 报错翻译成人能看懂的中文 */
function friendlyError(e) {
  const raw = msg(e);
  if (/404|Cannot find channel|not found/i.test(raw)) {
    return '更新源还没有 latest.yml：请先在 GitHub Releases 发布一个版本（上传 Setup 安装包 + latest.yml）';
  }
  if (/ETIMEDOUT|ECONN|ENOTFOUND|EAI_AGAIN|net::|status reason/i.test(raw)) {
    return '无法访问 GitHub（网络不通或被拦截）';
  }
  return raw;
}

function blockedReason() {
  if (!app.isPackaged) return '当前是开发模式，自动更新只在安装版中生效';
  if (process.env.PORTABLE_EXECUTABLE_DIR) return '便携版（单个 exe）无法自我更新，请改用「Setup 安装版」';
  return null;
}

function brief(info) {
  if (!info) return null;
  const files = Array.isArray(info.files) ? info.files : [];
  const notes = typeof info.releaseNotes === 'string'
    ? info.releaseNotes
    : (Array.isArray(info.releaseNotes) ? info.releaseNotes.map((n) => n && n.note).filter(Boolean).join('\n') : '');
  return {
    version: info.version || '',
    files: files.map((f) => f && f.url).filter(Boolean),
    size: files.reduce((s, f) => s + (Number(f && f.size) || 0), 0),
    releaseDate: info.releaseDate || '',
    releaseNotes: notes,
  };
}

function ensure() {
  if (au) return au;
  const { autoUpdater } = require('electron-updater');
  au = autoUpdater;
  au.autoDownload = false;
  au.autoInstallOnAppQuit = false;
  // GitHub 的下载地址会 302 跳转到对象存储，分块断点续传不可靠，直接整包下载
  au.disableDifferentialDownload = true;
  au.disableWebInstaller = true;
  au.setFeedURL({ provider: 'generic', url: FEED_URL });

  au.on('error', (e) => appendLog('自动更新 | 错误: ' + friendlyError(e)));
  au.on('update-available', (info) => {
    found = brief(info);
    appendLog(`自动更新 | 发现新版本 ${found.version}`);
    push('update:state', state());
  });
  au.on('update-not-available', () => {
    found = null;
    downloaded = false;
    push('update:state', state());
  });
  au.on('download-progress', (p) => {
    push('update:state', { ...state(), progress: Math.round(Number(p.percent) || 0), transferred: p.transferred, total: p.total });
  });
  au.on('update-downloaded', (info) => {
    found = brief(info) || found;
    downloaded = true;
    downloading = false;
    appendLog(`自动更新 | 已下载 ${found ? found.version : ''}，等待用户确认安装`);
    push('update:state', state());
  });
  return au;
}

function state() {
  return {
    blocked: blockedReason(),
    currentVersion: app.getVersion(),
    feedUrl: FEED_URL,
    update: found,
    downloaded,
    downloading,
  };
}

function check() {
  const why = blockedReason();
  if (why) return Promise.resolve({ ok: false, blocked: true, message: why, state: state() });
  const e = ensure();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      e.removeListener('update-available', onAvail);
      e.removeListener('update-not-available', onNone);
      e.removeListener('error', onErr);
      resolve(v);
    };
    const onAvail = (info) => finish({ ok: true, hasUpdate: true, info: brief(info) });
    const onNone = () => finish({ ok: true, hasUpdate: false });
    const onErr = (err) => finish({ ok: false, message: '检查更新失败: ' + friendlyError(err) });
    const timer = setTimeout(() => finish({ ok: false, message: '检查更新超时（无法访问 GitHub 或网络不通）' }), CHECK_TIMEOUT_MS);
    e.once('update-available', onAvail);
    e.once('update-not-available', onNone);
    e.once('error', onErr);
    e.checkForUpdates().catch(onErr);
  }).then((r) => ({ ...r, state: state() }));
}

function download() {
  const why = blockedReason();
  if (why) return Promise.resolve({ ok: false, message: why, state: state() });
  if (!found) return Promise.resolve({ ok: false, message: '没有待下载的更新，请先点「检查更新」', state: state() });
  if (downloading) return Promise.resolve({ ok: false, message: '正在下载中，请稍候', state: state() });
  const e = ensure();
  downloading = true;
  push('update:state', state());
  appendLog(`自动更新 | 用户确认下载 ${found.version}`);
  return e.downloadUpdate()
    .then(() => {
      appendLog(`自动更新 | 下载完成 ${found ? found.version : ''}`);
      return { ok: true, state: state() };
    })
    .catch((err) => {
      downloading = false;
      appendLog('自动更新 | 下载失败: ' + friendlyError(err));
      return { ok: false, message: '下载失败: ' + friendlyError(err), state: state() };
    });
}

/** 安装会关闭所有窗口并重启应用，必须由渲染层显式 confirmed === true */
function install(confirmed) {
  const why = blockedReason();
  if (why) return { ok: false, message: why };
  if (confirmed !== true) return { ok: false, message: '未经确认，已拒绝执行' };
  if (!downloaded) return { ok: false, message: '更新尚未下载完成，请先下载' };
  appendLog(`自动更新 | 用户确认安装 ${found ? found.version : ''} 并重启`);
  // 先让响应回到渲染层，再退出，避免窗口被强杀后 IPC 无返回值
  setTimeout(() => {
    try {
      ensure().quitAndInstall(true, true);
    } catch (e) {
      appendLog('自动更新 | 安装启动失败: ' + msg(e));
    }
  }, 400);
  return { ok: true };
}

module.exports = { init, check, download, install, state };

function init(deps) {
  push = deps.send || push;
  appendLog = deps.appendLog || appendLog;
}
