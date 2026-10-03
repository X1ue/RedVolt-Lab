'use strict';
const os = require('os');
const path = require('path');

const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const APPDATA = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const TEMP = process.env.TEMP || os.tmpdir();
const PROGRAMDATA = process.env.ProgramData || 'C:\\ProgramData';
const WINDIR = process.env.windir || 'C:\\Windows';

const paths = { LOCALAPPDATA, APPDATA, TEMP, PROGRAMDATA, WINDIR };

// 用户态目标只允许出现在这些根目录内，越界一律拒绝删除
const allowedRoots = [LOCALAPPDATA, TEMP];

// 保护清单：以这些路径开头的目标永不清理（可手动添加，例如 NVIDIA 全目录）
const protectList = [];

// Temp 只清理超过这个天数的项，避免删掉正在使用的程序文件
const TEMP_AGE_DAYS = 1;

// 系统级目标的精确白名单：不在表内的系统路径一律拒绝
const systemAllowed = [
  path.join(WINDIR, 'SoftwareDistribution', 'Download'),
  path.join(PROGRAMDATA, 'Microsoft', 'Windows', 'WER', 'ReportQueue'),
  path.join(PROGRAMDATA, 'Microsoft', 'Windows', 'WER', 'ReportArchive'),
  path.join(WINDIR, 'Prefetch'),
];

const CHROME_DEFAULT = path.join(LOCALAPPDATA, 'Google', 'Chrome', 'User Data', 'Default');
const EDGE_DEFAULT = path.join(LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data', 'Default');

/**
 * kind 说明:
 *   tempOld    删除目录下超过 N 天的顶层项
 *   clearDir   清空目录内容（保留目录本身）
 *   removeDirs 删除目录本身（更新器残留）
 *   recycle    清空回收站
 *   npm        npm cache clean --force
 *   flushDns   ipconfig /flushdns
 */
const targets = [
  // ---------- 磁盘清理 ----------
  {
    id: 'tempOld', group: 'disk', kind: 'tempOld', level: 'safe', defaultChecked: true,
    name: 'Temp 旧文件（超过 1 天）', path: TEMP,
    note: '只删 1 天前的文件，正在使用的会自动跳过',
  },
  {
    id: 'recycleBin', group: 'disk', kind: 'recycle', level: 'caution', defaultChecked: true,
    name: '回收站',
    note: '清空后无法恢复，请确认里面没有要留的东西',
  },
  {
    id: 'chromeCache', group: 'disk', kind: 'clearDir', level: 'safe', defaultChecked: true,
    name: 'Chrome 缓存', path: path.join(CHROME_DEFAULT, 'Cache'), browser: 'chrome',
    note: '网页缓存，不影响书签/密码/历史',
  },
  {
    id: 'chromeCodeCache', group: 'disk', kind: 'clearDir', level: 'safe', defaultChecked: true,
    name: 'Chrome 代码缓存', path: path.join(CHROME_DEFAULT, 'Code Cache'), browser: 'chrome',
    note: '网页缓存，不影响书签/密码/历史',
  },
  {
    id: 'edgeCache', group: 'disk', kind: 'clearDir', level: 'safe', defaultChecked: true,
    name: 'Edge 缓存', path: path.join(EDGE_DEFAULT, 'Cache'), browser: 'msedge',
    note: '网页缓存，不影响书签/密码/历史',
  },
  {
    id: 'edgeCodeCache', group: 'disk', kind: 'clearDir', level: 'safe', defaultChecked: true,
    name: 'Edge 代码缓存', path: path.join(EDGE_DEFAULT, 'Code Cache'), browser: 'msedge',
    note: '网页缓存，不影响书签/密码/历史',
  },
  {
    id: 'npmCache', group: 'disk', kind: 'npm', level: 'safe', defaultChecked: true,
    name: 'npm 缓存', path: path.join(LOCALAPPDATA, 'npm-cache'),
    note: '通过 npm cache clean 清理，下次安装会重新下载',
  },
  {
    id: 'crashDumps', group: 'disk', kind: 'clearDir', level: 'safe', defaultChecked: true,
    name: '崩溃转储', path: path.join(LOCALAPPDATA, 'CrashDumps'),
    note: '程序崩溃时产生的转储文件，排障结束后即可删',
  },
  {
    id: 'updaterResidue', group: 'disk', kind: 'removeDirs', level: 'safe', defaultChecked: true,
    name: '软件更新器残留',
    paths: ['qoder-updater', 'yinyun-windows-updater', 'lamzu-aurora-updater', 'mineradio-updater']
      .map((n) => path.join(LOCALAPPDATA, n)),
    note: '更新程序留下的临时目录，删掉不影响已装软件',
  },
  {
    id: 'thumbnailCache', group: 'disk', kind: 'clearDir', level: 'caution', defaultChecked: false,
    name: '缩略图缓存', path: path.join(LOCALAPPDATA, 'Microsoft', 'Windows', 'Explorer'),
    fileFilter: /^thumbcache_.*\.db$/i,
    note: '只删 thumbcache_*.db；资源管理器占用中的会自动跳过，下次浏览图片会重建',
  },
  {
    id: 'chromeFileSystem', group: 'disk', kind: 'clearDir', level: 'caution', defaultChecked: false,
    name: 'Chrome 网页应用沙盒数据', path: path.join(CHROME_DEFAULT, 'File System'), browser: 'chrome',
    note: '个别网页应用的离线数据可能重置（登录状态一般不受影响）',
  },
  // ---------- NVIDIA：默认不勾选，必须用户主动选 ----------
  {
    id: 'nvidiaDXCache', group: 'disk', kind: 'clearDir', level: 'safe', defaultChecked: false,
    name: 'NVIDIA 着色器缓存 DXCache', path: path.join(LOCALAPPDATA, 'NVIDIA', 'DXCache'),
    note: '游戏/软件首次启动会重建，略慢属正常',
  },
  {
    id: 'nvidiaGLCache', group: 'disk', kind: 'clearDir', level: 'safe', defaultChecked: false,
    name: 'NVIDIA 着色器缓存 GLCache', path: path.join(LOCALAPPDATA, 'NVIDIA', 'GLCache'),
    note: '游戏/软件首次启动会重建，略慢属正常',
  },

  // ---------- 系统级（需要管理员权限） ----------
  {
    id: 'windowsUpdateCache', group: 'system', kind: 'clearDir', level: 'safe', defaultChecked: false,
    name: 'Windows 更新缓存', admin: true,
    path: path.join(WINDIR, 'SoftwareDistribution', 'Download'),
    note: '已安装更新的下载包；清理后系统会按需重新下载',
  },
  {
    id: 'werReports', group: 'system', kind: 'clearDir', level: 'safe', defaultChecked: false,
    name: '系统错误报告', admin: true,
    paths: [
      path.join(PROGRAMDATA, 'Microsoft', 'Windows', 'WER', 'ReportQueue'),
      path.join(PROGRAMDATA, 'Microsoft', 'Windows', 'WER', 'ReportArchive'),
    ],
    note: '程序崩溃上报给微软的记录，删除不影响系统',
  },
  {
    id: 'prefetch', group: 'system', kind: 'clearDir', level: 'caution', defaultChecked: false,
    name: '预取文件 Prefetch', admin: true,
    path: path.join(WINDIR, 'Prefetch'),
    note: '加速程序启动的索引；删后头几次启动会变慢，系统会自动重建',
  },
  {
    id: 'dnsCache', group: 'system', kind: 'flushDns', level: 'safe', defaultChecked: false,
    name: 'DNS 缓存', admin: true,
    note: '执行 ipconfig /flushdns，不删任何文件；网络偶发解析异常时有用',
  },
];

const byId = new Map(targets.map((t) => [t.id, t]));

function getTarget(id) {
  return byId.get(id) || null;
}

function targetPaths(t) {
  if (t.paths) return t.paths.slice();
  if (t.path) return [t.path];
  return [];
}

module.exports = {
  paths, targets, byId, getTarget, targetPaths,
  allowedRoots, protectList, systemAllowed, TEMP_AGE_DAYS,
};
