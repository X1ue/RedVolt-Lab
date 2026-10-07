'use strict';
const os = require('os');
const path = require('path');

const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const APPDATA = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const TEMP = process.env.TEMP || os.tmpdir();
const PROGRAMDATA = process.env.ProgramData || 'C:\\ProgramData';
const WINDIR = process.env.windir || 'C:\\Windows';
const USERPROFILE = process.env.USERPROFILE || os.homedir();
const SYSTEMDRIVE = process.env.SystemDrive || 'C:';

const paths = { LOCALAPPDATA, APPDATA, TEMP, PROGRAMDATA, WINDIR };

// 开发工具缓存散落在用户目录各处，只把「确认可删的叶子目录」加进允许根，
// 绝不整目录放行（例如只放行 %APPDATA%\Code\Cache，而不是 %APPDATA%\Code）
const devRoots = [
  path.join(USERPROFILE, '.cargo', 'registry', 'cache'),
  path.join(USERPROFILE, '.gradle', 'caches'),
  path.join(APPDATA, 'Code', 'Cache'),
  path.join(APPDATA, 'Code', 'CachedData'),
  path.join(APPDATA, 'Code', 'Code Cache'),
  path.join(APPDATA, 'Code', 'logs'),
];

// 用户态目标只允许出现在这些根目录内，越界一律拒绝删除
const allowedRoots = [LOCALAPPDATA, TEMP].concat(devRoots);

const CHROME_USERDATA = path.join(LOCALAPPDATA, 'Google', 'Chrome', 'User Data');
const EDGE_USERDATA = path.join(LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data');
const CHROME_DEFAULT = path.join(CHROME_USERDATA, 'Default');
const EDGE_DEFAULT = path.join(EDGE_USERDATA, 'Default');

// 保护清单：以这些路径开头的目标永不清理（凭据、UWP 数据、注册表配置单元等）
const protectList = [
  path.join(LOCALAPPDATA, 'Packages'),                          // 商店应用数据，含游戏存档
  path.join(LOCALAPPDATA, 'Microsoft', 'Protect'),              // DPAPI 主密钥
  path.join(LOCALAPPDATA, 'Microsoft', 'Credentials'),
  path.join(LOCALAPPDATA, 'Microsoft', 'Vault'),
  path.join(LOCALAPPDATA, 'Microsoft', 'BitLocker'),            // 恢复密钥
  path.join(LOCALAPPDATA, 'Microsoft', 'WindowsApps'),          // 应用执行别名
  path.join(LOCALAPPDATA, 'Microsoft', 'Windows', 'WebCache'),
  path.join(LOCALAPPDATA, 'Microsoft', 'Windows', 'Notifications'),
  path.join(LOCALAPPDATA, 'Microsoft', 'Windows', 'UsrClass.dat'), // 用户注册表配置单元
  path.join(LOCALAPPDATA, 'Microsoft', 'OneDrive'),
  path.join(LOCALAPPDATA, 'ConnectedDevicesPlatform'),
  CHROME_USERDATA,                                              // 书签/密码/历史所在，仅放行下方缓存例外
  EDGE_USERDATA,
];

// 保护清单的例外：这些子路径虽然位于受保护目录内，但确认可安全清理
const protectExceptions = [
  path.join(CHROME_DEFAULT, 'Cache'),
  path.join(CHROME_DEFAULT, 'Code Cache'),
  path.join(CHROME_DEFAULT, 'File System'),
  path.join(CHROME_USERDATA, 'ShaderCache'),
  path.join(CHROME_USERDATA, 'GrShaderCache'),
  path.join(EDGE_DEFAULT, 'Cache'),
  path.join(EDGE_DEFAULT, 'Code Cache'),
  path.join(EDGE_USERDATA, 'ShaderCache'),
  path.join(EDGE_USERDATA, 'GrShaderCache'),
];

// Temp 只清理超过这个天数的项，避免删掉正在使用的程序文件
const TEMP_AGE_DAYS = 1;

// 系统级目标的精确白名单：不在表内的系统路径一律拒绝
const systemAllowed = [
  path.join(WINDIR, 'SoftwareDistribution', 'Download'),
  path.join(PROGRAMDATA, 'Microsoft', 'Windows', 'WER', 'ReportQueue'),
  path.join(PROGRAMDATA, 'Microsoft', 'Windows', 'WER', 'ReportArchive'),
  path.join(WINDIR, 'Prefetch'),
  path.join(WINDIR, 'Temp'),
  path.join(WINDIR, 'Logs', 'CBS'),
  path.join(WINDIR, 'ServiceProfiles', 'NetworkService', 'AppData', 'Local',
    'Microsoft', 'Windows', 'DeliveryOptimization', 'Cache'),
  path.join(SYSTEMDRIVE + path.sep, 'Windows.old'),
  path.join(SYSTEMDRIVE + path.sep, '$WINDOWS.~BT'),
];

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

  // ---------- 开发工具缓存：本机没有对应目录时整项不显示 ----------
  {
    id: 'devElectronCache', group: 'disk', kind: 'clearDir', level: 'safe',
    defaultChecked: false, hideWhenMissing: true, section: '开发工具缓存',
    name: 'Electron 安装包缓存', path: path.join(LOCALAPPDATA, 'electron', 'Cache'),
    note: '@electron/get 下载的 Electron zip，同一个版本常会存好几份；删掉后下次构建重新下载',
  },
  {
    id: 'devElectronBuilder', group: 'disk', kind: 'clearDir', level: 'caution',
    defaultChecked: false, hideWhenMissing: true, section: '开发工具缓存',
    name: 'electron-builder 打包缓存', path: path.join(LOCALAPPDATA, 'electron-builder', 'Cache'),
    note: '打包用的 NSIS / 7zip 与下载缓存；删掉后下次打包会重新下载，可能要等一会儿',
  },
  {
    id: 'devPip', group: 'disk', kind: 'clearDir', level: 'safe',
    defaultChecked: false, hideWhenMissing: true, section: '开发工具缓存',
    name: 'pip 缓存', path: path.join(LOCALAPPDATA, 'pip', 'Cache'),
    note: 'Python 包下载缓存，等同 pip cache purge；不影响已装好的包',
  },
  {
    id: 'devYarn', group: 'disk', kind: 'clearDir', level: 'safe',
    defaultChecked: false, hideWhenMissing: true, section: '开发工具缓存',
    name: 'Yarn 缓存', path: path.join(LOCALAPPDATA, 'Yarn', 'Cache'),
    note: '等同 yarn cache clean；不影响已安装的项目',
  },
  {
    id: 'devPnpm', group: 'disk', kind: 'clearDir', level: 'caution',
    defaultChecked: false, hideWhenMissing: true, section: '开发工具缓存',
    name: 'pnpm 全局存储', path: path.join(LOCALAPPDATA, 'pnpm', 'store'),
    note: '已装项目的 node_modules 是硬链接到这里；删掉不会立刻破坏现有项目，但下次 pnpm install 要重新下载全部依赖',
  },
  {
    id: 'devNuget', group: 'disk', kind: 'clearDir', level: 'safe',
    defaultChecked: false, hideWhenMissing: true, section: '开发工具缓存',
    name: 'NuGet 缓存', path: path.join(LOCALAPPDATA, 'NuGet', 'v3-cache'),
    note: '.NET 包的 HTTP 缓存；已还原到项目里的包不受影响',
  },
  {
    id: 'devGoBuild', group: 'disk', kind: 'clearDir', level: 'safe',
    defaultChecked: false, hideWhenMissing: true, section: '开发工具缓存',
    name: 'Go 构建缓存', path: path.join(LOCALAPPDATA, 'go-build'),
    note: '等同 go clean -cache；下次编译会慢一些，源码和已下载的模块都不动',
  },
  {
    id: 'devCargo', group: 'disk', kind: 'clearDir', level: 'safe',
    defaultChecked: false, hideWhenMissing: true, section: '开发工具缓存',
    name: 'Cargo 下载缓存', path: path.join(USERPROFILE, '.cargo', 'registry', 'cache'),
    note: '只删下载下来的 .crate 压缩包；已解压的源码、配置和凭据都不动',
  },
  {
    id: 'devGradle', group: 'disk', kind: 'clearDir', level: 'caution',
    defaultChecked: false, hideWhenMissing: true, section: '开发工具缓存',
    name: 'Gradle 缓存', path: path.join(USERPROFILE, '.gradle', 'caches'),
    note: '包含已下载的依赖 jar；删掉后下次构建要重新联网下载，Android 项目会明显变慢',
  },
  {
    id: 'devVSCode', group: 'disk', kind: 'clearDir', level: 'safe',
    defaultChecked: false, hideWhenMissing: true, section: '开发工具缓存',
    name: 'VS Code 缓存',
    paths: ['Cache', 'CachedData', 'Code Cache', 'logs'].map((n) => path.join(APPDATA, 'Code', n)),
    note: 'VS Code 的网页缓存与日志；settings.json、扩展、快捷键、工作区历史都不动',
  },
  {
    id: 'devD3DSCache', group: 'disk', kind: 'clearDir', level: 'safe',
    defaultChecked: false, hideWhenMissing: true, section: '开发工具缓存',
    name: 'DirectX 着色器缓存', path: path.join(LOCALAPPDATA, 'D3DSCache'),
    note: '系统级 D3D 着色器缓存，首次运行相关程序时会重建',
  },
  {
    id: 'chromeShaderCache', group: 'disk', kind: 'clearDir', level: 'safe',
    defaultChecked: false, hideWhenMissing: true, section: '开发工具缓存', browser: 'chrome',
    name: 'Chrome 着色器缓存',
    paths: [path.join(CHROME_USERDATA, 'ShaderCache'), path.join(CHROME_USERDATA, 'GrShaderCache')],
    note: '网页 WebGL/Canvas 的着色器缓存；不影响书签/密码/历史，占用中的会自动跳过',
  },
  {
    id: 'edgeShaderCache', group: 'disk', kind: 'clearDir', level: 'safe',
    defaultChecked: false, hideWhenMissing: true, section: '开发工具缓存', browser: 'msedge',
    name: 'Edge 着色器缓存',
    paths: [path.join(EDGE_USERDATA, 'ShaderCache'), path.join(EDGE_USERDATA, 'GrShaderCache')],
    note: '网页 WebGL/Canvas 的着色器缓存；不影响书签/密码/历史，占用中的会自动跳过',
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

  // ---------- 更新与升级残留 ----------
  {
    id: 'windowsTemp', group: 'system', kind: 'clearDir', level: 'caution', defaultChecked: false,
    admin: true, hideWhenMissing: true, name: '系统临时文件 Windows\\Temp',
    path: path.join(WINDIR, 'Temp'),
    note: '系统和程序运行时留下的临时文件；正在被占用的会逐项跳过',
  },
  {
    id: 'cbsLogs', group: 'system', kind: 'clearDir', level: 'caution', defaultChecked: false,
    admin: true, hideWhenMissing: true, name: '组件服务日志 CBS',
    path: path.join(WINDIR, 'Logs', 'CBS'),
    note: 'Windows 更新与组件安装的过程日志（CBS.log）。排查更新失败时很有用，删掉不影响系统运行；正在写入的文件会跳过',
  },
  {
    id: 'deliveryOpt', group: 'system', kind: 'clearDir', level: 'safe', defaultChecked: false,
    admin: true, hideWhenMissing: true, name: '传递优化下载缓存',
    path: path.join(WINDIR, 'ServiceProfiles', 'NetworkService', 'AppData', 'Local',
      'Microsoft', 'Windows', 'DeliveryOptimization', 'Cache'),
    note: 'Windows 更新的点对点分发缓存；删掉后系统会按需重新下载',
  },
  {
    id: 'windowsOld', group: 'system', kind: 'removeDirs', level: 'caution', defaultChecked: false,
    admin: true, hideWhenMissing: true, name: '升级前的旧系统 Windows.old',
    path: path.join(SYSTEMDRIVE + path.sep, 'Windows.old'),
    note: '大版本升级前留下的完整旧系统，通常好几个 GB。删掉就不能再「返回上一版本」，确认新系统用着没问题再删；部分文件属 TrustedInstaller，可能删不干净',
  },
  {
    id: 'windowsBt', group: 'system', kind: 'removeDirs', level: 'caution', defaultChecked: false,
    admin: true, hideWhenMissing: true, name: '升级临时目录 $WINDOWS.~BT',
    path: path.join(SYSTEMDRIVE + path.sep, '$WINDOWS.~BT'),
    note: '升级安装过程的临时目录；删掉不影响已经装好的系统，同样可能删不干净',
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
  allowedRoots, protectList, protectExceptions, systemAllowed, TEMP_AGE_DAYS,
};
