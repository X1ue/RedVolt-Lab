'use strict';

// 界面双语：默认中文，切到 English 时把 DOM 里的中文文本节点/属性按字典替换。
// 之所以不在每个渲染函数里改字符串，是为了完全不动清理与安全校验逻辑：
// 字典命中就替换，没命中就原样显示中文，永远不会把路径、大小、进程名等真实数据改掉。
(function () {
  const CJK = /[\u3400-\u9fff]/;
  const ATTRS = ['title', 'placeholder', 'alt'];

  // 整段文本完全匹配（app.js 用 textContent 逐个构建，绝大多数属于这种）
  const EXACT = {
    '刷新': 'Refresh',
    '更新': 'Update',
    '取消': 'Cancel',
    '禁用': 'Disable',
    '恢复': 'Restore',
    '完成': 'done',
    '失败': 'failed',
    '内存': 'Memory',
    '启用': 'Enable',
    '成功': 'ok',
    '启动项': 'Startup items',
    '未扫描': 'not scanned',
    '已跳过': 'skipped',
    '知道了': 'Got it',
    '已启用': 'Enabled',
    '已禁用': 'Disabled',
    '已开机': 'Up for',
    '未检查': 'not checked',
    '安装包': 'Installer',
    '回收站': 'Recycle Bin',
    '不存在': 'not found',
    '磁盘清理': 'Disk Cleanup',
    '系统信息': 'System Info',
    '清理日志': 'Cleanup Log',
    '清空勾选': 'Clear selection',
    '清除': 'Clear',
    '刷新列表': 'Refresh list',
    '检查更新': 'Check for updates',
    '下载更新': 'Download update',
    '确认操作': 'Confirm action',
    '确认执行': 'Confirm',
    '无法扫描': 'cannot scan',
    '确认清理': 'Confirm cleanup',
    '清理失败': 'Cleanup failed',
    '清理完成': 'Cleanup done',
    '强制结束': 'Force quit',
    '确认恢复': 'Confirm restore',
    '确认禁用': 'Confirm disable',
    '操作系统': 'OS',
    '逻辑核心': 'Logical cores',
    '上次启动': 'Last boot',
    '用户目录': 'User profile',
    '当前版本': 'Current version',
    '最新版本': 'Latest version',
    '已是最新': 'Up to date',
    '发布时间': 'Release date',
    '开始下载': 'Start download',
    '下载失败': 'Download failed',
    '安装失败': 'Install failed',
    '执行出错': 'Execution error',
    '参数错误': 'Bad argument',
    '应用启动': 'App started',
    '崩溃转储': 'Crash dumps',
    '路径为空': 'empty path',
    '（目录）': '(dir)',
    '读取失败': 'Read failed',
    '操作失败': 'Operation failed',
    '未知错误': 'Unknown error',
    'C 盘可用': 'C: free',
    '系统级清理': 'System-level Cleanup',
    '清理勾选项': 'Clean selected',
    '安装并重启': 'Install and restart',
    '关闭浏览器': 'Close browsers',
    '已取消下载': 'Download cancelled',
    '缩略图缓存': 'Thumbnail cache',
    '只勾选安全项': 'Select safe items only',
    '扫描（只读）': 'Scan (read-only)',
    '打开备份目录': 'Open backup folder',
    '打开日志位置': 'Open log folder',
    '正在清理……': 'Cleaning…',
    '磁盘实际变化': 'Actual disk change',
    '关闭浏览器？': 'Close browsers?',
    '浏览器已关闭': 'Browsers closed',
    '正在恢复……': 'Restoring…',
    'CPU 占用': 'CPU usage',
    '系统安装时间': 'OS install date',
    '尚未检查更新': 'Not checked yet',
    '下载新版本？': 'Download new version?',
    '系统错误报告': 'System error reports',
    'DNS 缓存': 'DNS cache',
    '在保护清单中': 'in protect list',
    '未知的清理项': 'unknown cleanup item',
    '状态没有变化': 'No state change',
    '系统级扫描失败': 'System-level scan failed',
    '  ⚠ 已拒绝': '  ⚠ denied',
    '恢复该启动项？': 'Restore this startup item?',
    '禁用该启动项？': 'Disable this startup item?',
    '版本 / 内核': 'Version / kernel',
    '将覆盖当前安装': 'will overwrite the current installation',
    'Edge 缓存': 'Edge cache',
    '软件更新器残留': 'Updater leftovers',
    '找不到该启动项': 'Startup item not found',
    '已恢复该启动项': 'Startup item restored',
    '无法读取该目录': 'Cannot read this directory',
    '系统级清理失败': 'System-level cleanup failed',
    '已被安全规则拒绝': 'denied by safety rules',
    '计算机 / 用户': 'Computer / user',
    '没有可扫描的目录': 'No directories to scan',
    '当前已是最新版本': 'Already the latest version',
    '安装更新并重启？': 'Install update and restart?',
    '系统信息读取失败': 'Failed to read system info',
    '扫描（需要管理员）': 'Scan (needs admin)',
    '不存在，将自动跳过': 'not found, will be skipped',
    '没有需要清理的内容': 'Nothing to clean',
    '确认清理以下项目？': 'Clean the following items?',
    '正在读取启动项……': 'Reading startup items…',
    '没有选中系统级项目': 'No system-level item selected',
    'Chrome 缓存': 'Chrome cache',
    'Edge 代码缓存': 'Edge code cache',
    '不在系统级白名单内': 'not in system-level whitelist',
    '无法读取回收站信息': 'Cannot read Recycle Bin info',
    '已禁用，原值已备份': 'Disabled, original value backed up',
    '正在下载中，请稍候': 'Downloading, please wait',
    '统计大文件夹（只读）': 'Measure large folders (read-only)',
    '需要管理员权限后扫描': 'Scan after admin elevation',
    '请先勾选要清理的项目': 'Select items to clean first',
    '已取消，未做任何修改': 'Cancelled, nothing changed',
    '未经确认，已拒绝执行': 'Refused without confirmation',
    '没有选中可清理的项目': 'No cleanable item selected',
    '未经确认，已拒绝修改': 'Refused without confirmation',
    '不在允许的清理范围内': 'outside the allowed cleanup scope',
    '执行类操作，无需扫描': 'Action only, no scan needed',
    '该清理项没有配置路径': 'This item has no configured path',
    '目标不存在，无需清理': 'Target not found, nothing to clean',
    '已取消，未删除任何内容': 'Cancelled, nothing deleted',
    '本次释放（按文件累计）': 'Freed this run (sum of files)',
    '正在禁用（先备份）……': 'Disabling (backup first)…',
    'Chrome 代码缓存': 'Chrome code cache',
    '没有可执行的系统级项目': 'No system-level item to run',
    '清理勾选项（需要管理员）': 'Clean selected (needs admin)',
    '确认清理以下系统级项目？': 'Clean the following system-level items?',
    '已检查：当前就是最新版本': 'Checked: already the latest version',
    '是链接/重解析点，已拒绝': 'is a link/reparse point, refused',
    '无法读取 Temp 目录': 'Cannot read Temp directory',
    '系统级项目需走管理员通道': 'System-level items require the admin channel',
    '预取文件 Prefetch': 'Prefetch files',
    '更新尚未下载完成，请先下载': 'Update not fully downloaded yet, download first',
    '正在统计目录体积（只读）……': 'Measuring folder sizes (read-only)…',
    '已取消管理员授权，未做任何修改': 'Admin authorization cancelled, nothing changed',
    '正在重新扫描勾选项（只读）……': 'Re-scanning selected items (read-only)…',
    'Chrome 网页应用沙盒数据': 'Chrome web app sandbox data',
    '部分目录未能删除（可能被占用）': 'Some paths could not be deleted (may be in use)',
    'Temp 旧文件（超过 1 天）': 'Old Temp files (over 1 day)',
    '网页缓存，不影响书签/密码/历史': 'Web cache; bookmarks/passwords/history unaffected',
    '扫描失败，已中止（未删除任何内容）': 'Scan failed, aborted (nothing deleted)',
    '更新下载完成，可点击「安装并重启」': 'Update downloaded; click "Install and restart"',
    '已取消管理员授权，未扫描系统级项目': 'Admin authorization cancelled, system-level items not scanned',
    '我已确认以上项目可以被删除 / 修改': 'I confirm these items may be deleted / modified',
    '游戏/软件首次启动会重建，略慢属正常': 'Rebuilt on the first launch of games/apps; a bit slower is normal',
    '没有待下载的更新，请先点「检查更新」': 'No pending update; click "Check for updates" first',
    '正在扫描（只读，不会删除任何内容）……': 'Scanning (read-only, nothing will be deleted)…',
    '扫描完成：以上仅为预览，未删除任何内容': 'Scan complete: preview only, nothing deleted',
    '勾选的项目都不存在或为空，未执行任何删除': 'All selected items are missing or empty; nothing deleted',
    '清空后无法恢复，请确认里面没有要留的东西': 'Cannot be undone after emptying; make sure nothing needs keeping',
    'NVIDIA 着色器缓存 DXCache': 'NVIDIA shader cache DXCache',
    'NVIDIA 着色器缓存 GLCache': 'NVIDIA shader cache GLCache',
    '程序崩溃上报给微软的记录，删除不影响系统': 'Crash reports sent to Microsoft; deleting them does not affect the system',
    '当前是开发模式，自动更新只在安装版中生效': 'Development mode: auto-update works only in installed builds',
    '只删 1 天前的文件，正在使用的会自动跳过': 'Only files older than 1 day; in-use files are skipped automatically',
    '程序崩溃时产生的转储文件，排障结束后即可删': 'Dump files from crashes; safe to delete once troubleshooting is done',
    '更新程序留下的临时目录，删掉不影响已装软件': 'Temp folders left by updaters; deleting does not affect installed apps',
    '无法访问 GitHub（网络不通或被拦截）': 'Cannot reach GitHub (network down or blocked)',
    '已安装更新的下载包；清理后系统会按需重新下载': 'Downloaded update packages; Windows re-downloads them on demand',
    '勾选 → 扫描预览（只读） → 你确认后才执行删除': 'Select → preview scan (read-only) → delete only after you confirm',
    '该项属于所有用户（HKLM），会弹一次管理员授权。': 'This item applies to all users (HKLM); one admin prompt will appear.',
    '检查更新超时（无法访问 GitHub 或网络不通）': 'Update check timed out (cannot reach GitHub)',
    '正在检查更新（访问 GitHub，可能需要几秒）……': 'Checking for updates (contacting GitHub, may take a few seconds)…',
    '个别网页应用的离线数据可能重置（登录状态一般不受影响）': "Some web apps' offline data may reset (sign-in state is usually unaffected)",
    '加速程序启动的索引；删后头几次启动会变慢，系统会自动重建': 'Index that speeds up app launches; the first launches will be slower and Windows rebuilds it',
    '将把备份的原始值写回注册表 / 把启动文件移回启动文件夹。': 'Writes the backed-up original value back to the registry / moves the startup file back.',
    '禁用前会先完整备份原始注册表值或启动文件，之后可随时恢复。': 'The original registry value or startup file is fully backed up before disabling; restore it any time.',
    '便携版（单个 exe）无法自我更新，请改用「Setup 安装版」': 'The portable (single exe) build cannot self-update; use the Setup installer instead',
    '将强制结束 Chrome / Edge 进程，未保存的网页内容可能丢失。': 'Force-quits Chrome / Edge; unsaved page content may be lost.',
    '大文件夹排行只统计体积，不会删除或修改任何文件。扫描大目录可能需要一两分钟。': 'The large-folder ranking only measures size and never deletes or modifies files. Big folders may take a minute or two.',
    '只删 thumbcache_*.db；资源管理器占用中的会自动跳过，下次浏览图片会重建': 'Only thumbcache_*.db; files held by Explorer are skipped and rebuilt next time you browse images',
    '只允许扫描用户目录、AppData、Temp、ProgramData 及其子目录（只读）': 'Only the user profile, AppData, Temp, ProgramData and their subfolders may be scanned (read-only)',
    '软件会立刻关闭所有窗口并静默安装新版本，正在进行的扫描或清理会被中断。安装完成后自动重新启动。': 'The app closes all windows immediately and installs silently; any running scan or cleanup is interrupted. It restarts automatically when done.',
    '扫描只读取文件信息，不删除任何内容。NVIDIA 缓存与「注意」级项目默认不勾选，需要你主动选。': 'Scanning only reads file info and deletes nothing. NVIDIA caches and "caution" items are unchecked by default; select them yourself.',
    '禁用前会把原始注册表值或启动文件完整备份；随时可以一键恢复。修改 HKLM（所有用户）项需要管理员授权。': 'The original registry value or startup file is fully backed up before disabling; one click restores it. Changing HKLM (all users) items needs admin authorization.',
    '将从 GitHub Releases 下载安装包到本机临时目录，期间可正常使用软件。下载完不会自动安装、不会自动重启。': 'Downloads the installer from GitHub Releases into a local temp folder; you can keep using the app meanwhile. Nothing installs or restarts automatically.',
    '更新源还没有 latest.yml：请先在 GitHub Releases 发布一个版本（上传 Setup 安装包 + latest.yml）': 'The update source has no latest.yml yet: publish a release on GitHub Releases first (upload the Setup installer + latest.yml)',
    '这些项目位于系统目录，扫描和清理都会弹一次 Windows 管理员授权（UAC）。拒绝授权则不做任何修改。提权脚本内部还有一份独立白名单，表外路径一律拒绝。': 'These items live in system directories; scanning and cleaning each trigger one Windows admin (UAC) prompt. Declining changes nothing. The elevated script keeps its own independent whitelist and refuses any path outside it.',
    '软件只读取公开下载地址，不需要任何账号或密钥。只有「Setup 安装版」支持自动更新，便携版不能自我更新。发现新版本后需要你分别点击「下载更新」和「安装并重启」，软件不会静默覆盖文件，也不会不打招呼就重启。': 'The app only reads the public download URL and needs no account or key. Only the Setup-installed build supports auto-update; the portable exe cannot self-update. When a new version is found you click "Download update" and then "Install and restart" yourself — the app never overwrites files silently or restarts without asking.',
    '安全': 'safe',
    '注意': 'caution',
    '大文件夹': 'Large folders',
    '默认目录': 'Default folders',
    '需管理员': 'needs admin',
    'npm 缓存': 'npm cache',
    'Windows 更新缓存': 'Windows Update cache',
    'Windows 更新日志': 'Windows Update logs',
    '通过 npm cache clean 清理，下次安装会重新下载': 'Cleared via npm cache clean; re-downloaded on the next install',
    '执行 ipconfig /flushdns，不删任何文件；网络偶发解析异常时有用': 'Runs ipconfig /flushdns and deletes nothing; helps when DNS resolution misbehaves',
    '系统临时文件 Windows\\Temp': 'System temp files in Windows\\Temp',
    '系统和程序运行时留下的临时文件；正在被占用的会逐项跳过': 'Temp files left behind by the system and running programs; anything in use is skipped item by item',
    '组件服务日志 CBS': 'Component servicing logs (CBS)',
    'Windows 更新与组件安装的过程日志（CBS.log）。排查更新失败时很有用，删掉不影响系统运行；正在写入的文件会跳过': 'Process logs for Windows Update and component servicing (CBS.log). Useful when diagnosing a failed update; deleting them does not affect how the system runs, and files still being written are skipped.',
    '传递优化下载缓存': 'Delivery Optimization cache',
    'Windows 更新的点对点分发缓存；删掉后系统会按需重新下载': 'Peer-to-peer distribution cache for Windows Update; the system re-downloads what it needs afterwards',
    '升级前的旧系统 Windows.old': 'Previous system in Windows.old',
    '大版本升级前留下的完整旧系统，通常好几个 GB。删掉就不能再「返回上一版本」，确认新系统用着没问题再删；部分文件属 TrustedInstaller，可能删不干净': 'A full copy of the old system left by a major upgrade, usually several GB. Once deleted you can no longer "go back to the previous version", so only delete it after you are happy with the new system. Some files belong to TrustedInstaller and may not delete fully.',
    '升级临时目录 $WINDOWS.~BT': 'Upgrade temp folder $WINDOWS.~BT',
    '升级安装过程的临时目录；删掉不影响已经装好的系统，同样可能删不干净': 'Scratch folder used while the upgrade was installing; deleting it does not affect the installed system, and it may also not delete fully',
    '删除勾选项': 'Delete selected',
    '开发工具缓存': 'Dev tool caches',
    'Electron 安装包缓存': 'Electron package cache',
    '@electron/get 下载的 Electron zip，同一个版本常会存好几份；删掉后下次构建重新下载': 'Electron zips downloaded by @electron/get — the same version is often stored several times. Re-downloaded on the next build.',
    'electron-builder 打包缓存': 'electron-builder cache',
    '打包用的 NSIS / 7zip 与下载缓存；删掉后下次打包会重新下载，可能要等一会儿': 'NSIS / 7zip and download cache used for packaging; the next build re-downloads them, which can take a while',
    'pip 缓存': 'pip cache',
    'Python 包下载缓存，等同 pip cache purge；不影响已装好的包': 'Downloaded Python package cache, same as pip cache purge; installed packages are untouched',
    'Yarn 缓存': 'Yarn cache',
    '等同 yarn cache clean；不影响已安装的项目': 'Same as yarn cache clean; installed projects are untouched',
    'pnpm 全局存储': 'pnpm global store',
    '已装项目的 node_modules 是硬链接到这里；删掉不会立刻破坏现有项目，但下次 pnpm install 要重新下载全部依赖': 'Installed projects hard-link into this store; deleting it does not break them right away, but the next pnpm install re-downloads every dependency',
    'NuGet 缓存': 'NuGet cache',
    '.NET 包的 HTTP 缓存；已还原到项目里的包不受影响': 'HTTP cache for .NET packages; packages already restored into projects are unaffected',
    'Go 构建缓存': 'Go build cache',
    '等同 go clean -cache；下次编译会慢一些，源码和已下载的模块都不动': 'Same as go clean -cache; the next build is slower. Sources and downloaded modules are untouched.',
    'Cargo 下载缓存': 'Cargo download cache',
    '只删下载回来的 .crate 压缩包；已解压的源码、配置和凭据都不动': 'Only the downloaded .crate archives; extracted sources, config and credentials are untouched',
    'Gradle 缓存': 'Gradle cache',
    '包含已下载的依赖 jar；删掉后下次构建要重新联网下载，Android 项目会明显变慢': 'Holds downloaded dependency jars; the next build re-downloads them online and Android projects get noticeably slower',
    'VS Code 缓存': 'VS Code cache',
    'VS Code 的网页缓存与日志；settings.json、扩展、快捷键、工作区历史都不动': 'VS Code web caches and logs; settings.json, extensions, keybindings and workspace history are untouched',
    'DirectX 着色器缓存': 'DirectX shader cache',
    '系统级 D3D 着色器缓存，首次运行相关程序时会重建': 'System-wide D3D shader cache, rebuilt the first time each program runs',
    'Chrome 着色器缓存': 'Chrome shader cache',
    'Edge 着色器缓存': 'Edge shader cache',
    '网页 WebGL/Canvas 的着色器缓存；不影响书签/密码/历史，占用中的会自动跳过': 'Shader cache for web WebGL/Canvas; bookmarks, passwords and history are unaffected and files in use are skipped',
    '专业版': 'Pro',
    '家庭版': 'Home',
    '企业版': 'Enterprise',
    '教育版': 'Education',
    '⚙ 软件设置': '⚙ Settings',
    '软件设置': 'Settings',
    '关闭设置': 'Close',
    '关闭 RedVolt Lab': 'Close RedVolt Lab',
    '最小化到后台：窗口收起，程序继续在运行，从右下角托盘图标可以再次打开。': 'Minimize to background hides the window but keeps the app running — click the tray icon at the bottom right to bring it back.',
    '彻底退出：程序完全关闭，不再占用内存。': 'Quit completely closes the app and releases its memory.',
    '记住我的选择，以后不再询问': 'Remember my choice and stop asking',
    '最小化到后台': 'Minimize to background',
    '彻底退出': 'Quit completely',
    '关闭程序时': 'When closing the app',
    '每次询问': 'Ask every time',
    '重新询问': 'Ask again',
    '已恢复：下次关闭程序时会重新询问': 'Reset — you will be asked again the next time you close the app',
    '性能基线': 'Performance baseline',
    '记为优化前': 'Record as before',
    '记为优化后': 'Record as after',
    '附带磁盘 4K 实测（需管理员，约 1 分钟）': 'Include the disk 4K test (needs admin, ~1 min)',
    '基线只是当前状态的快照，记录它不会改动系统。想验证效果：优化前记一次，优化后再记一次，这里给出差值。4K 实测用 Windows 自带的 winsat，跑不起来会如实写明原因，不会用估算数字顶替。': 'A baseline is just a snapshot of the current state — recording it changes nothing on the system. To verify an optimization: record one before, record one after, and the delta appears here. The 4K test uses the built-in Windows winsat; if it cannot run we say why instead of substituting an estimated number.',
    '指标': 'Metric',
    '优化前': 'Before',
    '优化后': 'After',
    '现在': 'Now',
    '优化前（未记录）': 'Before (not recorded)',
    '空闲内存': 'Free memory',
    '磁盘 4K 随机读': 'Disk 4K random read',
    '未测': 'not measured',
    '未记录': 'not recorded',
    '读不到': 'unreadable',
    '持平': 'no change',
    '还没有记录过「优化前」。按下面的步骤做一遍，这里的数字就能对比。': 'No "before" snapshot yet. Record one before you optimize and the numbers here become comparable.',
    '你取消了管理员授权': 'You declined the admin prompt',
    '系统拒绝以管理员运行 winsat': 'The system refused to run winsat elevated',
    '这台系统里没有 winsat': 'This system has no winsat',
    '找不到 winsat 的报告目录': 'The winsat report folder was not found',
    '跑完了，但报告里没有磁盘这一项': 'It finished, but the report has no disk entry',
    '已记录「优化前」': 'Recorded the "before" snapshot',
    '已记录「优化后」': 'Recorded the "after" snapshot',
    '正在采集……': 'Sampling…',
    '正在跑磁盘实测，可能弹一次 UAC……': 'Running the disk test — one UAC prompt may appear…',
    '清除性能基线': 'Clear performance baseline',
    '只删掉本机记录的对比数字，不会改动系统任何设置。': 'This only deletes the comparison numbers stored by the app. No system setting is touched.',
    '已清除性能基线': 'Performance baseline cleared',
    // 4K 实测的失败原因是有限集合，整句收进来；拼出来的半句在英文下会剩中文残渣
    '读不到（你取消了管理员授权）': 'Not measured (you declined the admin prompt)',
    '读不到（系统拒绝以管理员运行 winsat）': 'Not measured (the system refused to run winsat elevated)',
    '读不到（这台系统里没有 winsat）': 'Not measured (this system has no winsat)',
    '读不到（找不到 winsat 的报告目录）': 'Not measured (the winsat report folder was not found)',
    '读不到（跑完了，但报告里没有磁盘这一项）': 'Not measured (it finished, but the report has no disk entry)',
    '优化前：未记录': 'Before: not recorded',
    '优化后：未记录，右列是当前实时值': 'After: not recorded — the right column shows the live values',
    '变化': 'Change',
    // 这几条是前缀，后面接动态内容，只能当片段用
    '已记录，但磁盘实测没成功：': 'Recorded, but the disk test failed: ',
    '记录失败: ': 'Failed to record: ',
    '清除失败: ': 'Failed to clear: ',
    '界面语言': 'UI language',
    '界面主题': 'UI theme',
    '暗红': 'Dark red',
    '亮蓝': 'Bright blue',
    '换主题会同时换背景闪电的配色和托盘/窗口图标。安装程序图标是打包时内嵌进 exe 的，换肤换不到它，这是 Windows 的边界。': 'Switching theme recolours the background lightning and swaps the tray / window icon. The installer icon is baked into the exe at build time and cannot follow the skin - that is a Windows limitation.',
    '背景闪电动效': 'Background lightning effect',
    '启动时自动检查更新': 'Check for updates on startup',
    '极致的性能强化': 'Ultimate Performance Boost',
    '实时掌握 CPU / GPU / 内存占用。清理一律先只读扫描预览，逐项复查安全规则，你确认后才执行删除。': 'Watch CPU / GPU / memory in real time. Cleanup always begins with a read-only scan preview, re-checks every safety rule per item, and deletes only after you confirm.',
    '无自启 · 无遥测 · 无广告 ｜ 每一步都能撤销 ｜ 效果能量化': 'No autostart · no telemetry · no ads | Every step is undoable | Measurable results',
    '首页': 'Home',
    '开始清理': 'Start cleanup',
    '启动项管理': 'Startup manager',
    '实时监控': 'Live monitor',
    '最小化窗口': 'Minimize window',
    '关闭窗口': 'Close window',
    '一键清理': 'One-click cleanup',
    '手动选择': 'Pick items manually',
    '不可用': 'unavailable',
    '未检测到可用的 GPU 监控接口': 'No usable GPU monitoring interface detected',
    '浏览器缓存、Temp、回收站等 8 类用户目录': 'Browser caches, Temp, Recycle Bin and 8 user-folder categories',
    '更新缓存、预取、DNS 缓存（需管理员）': 'Update cache, prefetch, DNS cache (needs admin)',
    '开机自启管理，禁用前先备份': 'Manage startup items; fully backed up before disabling',
    '显卡优化': 'GPU Tuning',
    '电源优化': 'Power Plans',
    '当前电源计划': 'Active power plan',
    '应用': 'Apply',
    '切换只调用系统自带的 powercfg 修改「当前活动电源计划」，不删除任何方案、不改注册表其它项；点选后还会再确认一次才生效。改版系统（如 AtlasOS）若移除了方案模板，对应档位会显示为不可用；你自己新建的、或改版系统自带的其它计划，会在下方「本机其他电源计划」里列出，同样可以点选切换。': 'Switching only calls the built-in powercfg to change the active power plan; no plan is deleted and no other registry value is touched. Picking a plan asks for one more confirmation before it applies. On modified systems (e.g. AtlasOS) a tier shows as unavailable if its template was removed; your own plans or extra ones from a modified OS are listed under "Other plans on this PC" below and can be switched the same way.',
    '重新读取': 'Reload',
    '游戏开关': 'Game Switches',
    '游戏相关系统开关': 'Gaming-related system switches',
    '还原到修改前': 'Restore pre-change values',
    '这里只改与游戏相关的几个系统开关（注册表白名单里的值），不动任何文件、不结束任何进程。改动前会把原值备份到本软件目录，随时可以「还原到修改前」；每一项都要再点一次「应用」才生效。硬件加速 GPU 计划（HAGS）写在 HKLM，需要一次管理员授权，并且要重启电脑才生效。': 'Only a few gaming-related system switches are changed here (values on the registry whitelist); no file is touched and no process is ended. Original values are backed up inside this app\'s own folder before any change, so you can "Restore pre-change values" at any time; each row still needs one more click on "Apply" to take effect. Hardware-accelerated GPU scheduling (HAGS) lives in HKLM, needs one administrator prompt, and only takes effect after a reboot.',
    '一键优化模式': 'One-click tuning mode',
    '还原到优化前': 'Restore pre-tuning values',
    '三档预设只会改档位里列出的项目，其余设置一律不动。应用前逐项列出「当前值 → 目标值」，并把原值整份快照到本软件目录，随时可以「还原到优化前」。N 卡项只写本机驱动确实列出的取值，驱动没提供的会在清单里标明「已跳过」，不会硬写。': 'The three presets only change the items listed in that tier; everything else is left alone. Before applying, every item is listed as "current → target" and the original values are snapshotted into this app\'s own folder, so you can "Restore pre-tuning values" at any time. NVIDIA items are only written when this driver really lists that value; anything the driver does not offer is marked "Skipped" in the list and never force-written.',
    '一键释放': 'Free now',
    '内存一键释放': 'Free memory now',
    '确认释放': 'Free memory',
    '只把后台进程占用的工作集交还给系统，不结束任何进程。关键系统进程、本软件、以及正在前台全屏运行的程序（游戏）都会自动跳过。被整理过的程序下次使用时可能短暂卡顿（数据要从磁盘读回）。': 'Hands the working set of background processes back to the system without ending any process. Critical system processes, this app, and any program running fullscreen in the foreground (a game) are skipped automatically. A trimmed program may stutter briefly the next time you use it while its data is read back from disk.',
    '正在释放内存…': 'Freeing memory…',
    '移除该方案': 'Remove profile',
    '＋ 添加程序': '＋ Add program',
    '显示全部驱动方案': 'Show all driver profiles',
    '搜索程序…': 'Search programs…',
    '搜索设置项…': 'Search settings…',
    '显示驱动全部设置项': 'Show all driver settings',
    '显卡优化 · A卡版': 'GPU Tuning · AMD Edition',
    'A卡版': 'AMD',
    '非N卡': 'Non-NVIDIA',
    '修改只写入 NVIDIA 驱动的 3D 配置（与控制面板同源），不删除任何文件。左侧只列出本机确实存在的程序和用户自建方案；勾选「显示全部驱动方案」可展开驱动内置的全部方案。': 'Changes are written only to the NVIDIA driver 3D settings (same store as the Control Panel); no files are deleted. The list on the left only shows programs that really exist on this PC plus your own profiles; tick "Show all driver profiles" to expand the full built-in set.',
    '硬件概览与大文件夹排行（只读）': 'Hardware overview and large-folder ranking (read-only)',
    '已勾选项目': 'Items selected',
    '预计释放': 'Est. to free',
    '（暂无记录）': '(no records yet)',
    '清理确认、NVIDIA 缓存等安全规则不受这里的影响，删除前永远会先扫描预览并让你确认。': 'Safety rules such as delete confirmation and the NVIDIA-cache opt-out are not affected by these settings: nothing is ever deleted before you scan a preview and confirm.',
    ' 64 位': ' 64-bit',
    ' 32 位': ' 32-bit',
    '用户态清理 | 项目: ': 'User-level cleanup | item: ',
    '系统级清理 | 项目: ': 'System-level cleanup | item: ',
    '自动更新 | 发现新版本 ': 'Auto-update | found new version ',
    '自动更新 | 下载完成 ': 'Auto-update | download complete ',
    '自动更新 | 已下载 ': 'Auto-update | downloaded ',
    '自动更新 | 用户确认下载 ': 'Auto-update | user confirmed download of ',
    '自动更新 | 用户确认安装 ': 'Auto-update | user confirmed install of ',
    '自动更新 | 安装并重启': 'Auto-update | installing and restarting',
    '，等待用户确认安装': ', waiting for the user to confirm installation',
    ' | 释放 ': ' | freed ',
    '应用启动': 'App started',

    // ---------- 记录与撤销 ----------
    '记录与撤销': 'Changes & Undo',
    '刷新记录': 'Refresh changes',
    '全部撤销': 'Undo all',
    '立即创建还原点': 'Create restore point now',
    '还原点状态': 'Restore point status',
    '刷新日志': 'Refresh log',
    '撤销这条改动': 'Undo this change',
    '创建系统还原点': 'Create a system restore point',
    '确认撤销': 'Undo it',
    '确认创建': 'Create it',
    '撤销': 'Undo',
    '重试': 'Retry',
    '已撤销': 'undone',
    '无法撤销': 'not undoable',
    '没有可撤销的变更': 'Nothing left to undo',
    '体检完成': 'Health check done',
    '已取消保存': 'Save cancelled',
    '还原点已创建': 'Restore point created',
    '已复用现有还原点': 'Reused the existing restore point',
    '这里按时间倒序列出本软件做过的每一次改动，能撤销的会给出「撤销」按钮，撤销就是把记录里的原值精确写回去。删文件类操作物理上不可恢复，会如实标注「无法撤销」，不假装能还原。': 'Every change this app made is listed newest first. Undoable ones get an "Undo" button, which writes the recorded original value straight back. File deletions cannot be recovered physically and are honestly marked "not undoable" instead of pretending otherwise.',
    '按这条记录里存的原值精确写回，只影响这一项，其它改动保持不变。HKLM 项（如 HAGS）会弹一次管理员授权。': 'Writes back the original value stored in this record and affects only this item; every other change stays as it is. HKLM items (such as HAGS) trigger one administrator prompt.',
    '调用 Windows 自带的 Checkpoint-Computer 建一个还原点，只写系统还原数据，不动任何用户文件，需要一次管理员授权。注意 Windows 限制 24 小时内只能建一个，间隔内会失败并把原因告诉你。': 'Calls the built-in Windows Checkpoint-Computer to create a restore point. Only restore data is written, no user file is touched, and one administrator prompt is needed. Note that Windows allows only one restore point per 24 hours; inside that window it fails and tells you why.',
    '还没有改动记录。清理、改开关、切电源计划、改 N 卡设置、禁用启动项，都会在这里留一条。': 'No changes recorded yet. Cleanup, switch changes, power-plan switches, NVIDIA settings and startup disables all leave an entry here.',
    '已开启：应用一键优化前会先建还原点（需一次管理员授权）': 'On: a restore point is created before one-click tuning (one admin prompt)',
    '已关闭：应用一键优化前不再自动建还原点': 'Off: no restore point before one-click tuning',

    // ---------- 只读体检 ----------
    '只读体检': 'Health check',
    '只读体检报告': 'Read-only health report',
    '快速体检': 'Quick check',
    '深度体检（需管理员）': 'Deep check (needs admin)',
    '导出报告': 'Export report',
    '关闭体检': 'Close',
    '风险': 'risk',
    '建议处理': 'advised',
    '供参考': 'FYI',
    '体检失败，没有拿到结果': 'Health check failed; no result returned',
    '还没有体检结果，请先跑一次体检': 'No health result yet — run a check first',
    '窗口不可用': 'The window is not available',
    '报告内容异常，已拒绝写入': 'The report content looks wrong, so writing was refused',
    '点上面的「快速体检」或「深度体检」开始。全程只读，不改任何设置、不删任何文件。': 'Click "Quick check" or "Deep check" above to start. Read-only throughout: no setting is changed and no file is deleted.',
    '体检只读取系统信息，不改任何设置、不删任何文件。快速体检用普通权限，几秒出结果；深度体检需要一次管理员授权（UAC），才能读到组件存储、TRIM、还原点、驱动库和启动诊断日志。': 'The health check only reads system information; it changes no setting and deletes no file. The quick check runs with normal rights and returns in seconds; the deep check needs one administrator prompt (UAC) to read the component store, TRIM, restore points, the driver store and the boot diagnostics log.',

    // ---------- 设置：还原点 ----------
    '应用一键优化前先建还原点': 'Create a restore point before one-click tuning',
    '还原点只是兜底：真正的撤销靠「记录与撤销」页里逐条记录的原值。Windows 限制 24 小时内只能建一个还原点，间隔内会自动复用已有的；建不成会把原因如实显示，不会假装已保护。': 'The restore point is only a safety net: real undo comes from the original values recorded per change on the "Changes & Undo" page. Windows allows one restore point per 24 hours, so an existing one is reused inside that window; if it cannot be created the reason is shown honestly instead of pretending you are protected.',

    // ---------- 设置：本软件的承诺 ----------
    '本软件的承诺': 'What this app promises',
    '不注册计划任务、不写启动项、不留后台常驻进程。关掉窗口就是真的退出了。': 'No scheduled tasks, no startup entries, no background process. Closing the window really does quit the app.',
    '唯一的联网动作是「检查更新」，它只读取 GitHub 上公开的版本号；上面可以关掉。除此之外不上传任何数据。': 'The only network action is "Check for updates", which reads the public version number on GitHub and can be switched off above. Nothing else is ever uploaded.',
    '没有广告、没有捆绑安装、没有「推荐软件」。': 'No ads, no bundled installs, no "recommended software".',
    '每一处改动都会在「记录与撤销」里记下改前的原值，可以单条还原；注册表与电源方案改动还会另存一份改前备份。': 'Every change records its original value on "Changes & Undo" and can be reverted one by one; registry and power-plan changes also keep a separate before-the-change backup.',
    '任何删除都先只读扫描，列出清单和体积，你确认后才动手。': 'Anything to be deleted is scanned read-only first, listed with its size, and only removed after you confirm.',
    '优化前后的空闲内存、磁盘可用空间和 4K 随机读都在「性能基线」里实测对比，效果是数字不是感觉。': 'Free memory, disk space and 4K random read are measured before and after tuning on the "Performance baseline" page — the result is a number, not a feeling.',

    // ---------- 系统级：组件存储 WinSxS ----------
    '组件存储 WinSxS': 'Component store (WinSxS)',
    '分析（只读，需管理员）': 'Analyze (read-only, needs admin)',
    '常规清理': 'Regular cleanup',
    '深度清理': 'Deep cleanup',
    '组件存储': 'Component store',
    'DISM 建议清理': 'DISM recommends cleanup',
    '无需清理': 'Nothing to clean',
    '可清可不清': 'Optional',
    'DISM 建议清理组件存储': 'DISM recommends cleaning the component store',
    '组件存储里没有可回收的东西': 'Nothing reclaimable in the component store',
    'DISM 认为不值得清理': 'DISM does not consider it worthwhile',
    '开始清理': 'Start cleanup',
    '我已了解，开始深度清理': 'I understand — start deep cleanup',
    '清理组件存储？': 'Clean the component store?',
    '深度清理组件存储？': 'Deep-clean the component store?',
    'WinSxS 里的文件大多是指向系统文件的硬链接，资源管理器显示的体积远大于真实占用，所以这里一律以 DISM 自己的报告为准：DISM 说该清才会放开「清理」按钮，读不到就如实说读不到，不估一个「大概能省几个 G」。': 'Most files in WinSxS are hard links to system files, so the size Explorer shows is far larger than the real footprint. Everything here therefore follows DISM\'s own report: the "Clean up" button is only enabled when DISM recommends it, and when DISM cannot be read the app says so instead of guessing "you could save a few GB".',
    '还没有分析。点「分析」会弹一次管理员授权，只读取 DISM 报告，不改动任何东西。': 'Not analyzed yet. Clicking "Analyze" asks for admin once and only reads the DISM report; nothing is changed.',
    'DISM 已启动，等待进度……': 'DISM started, waiting for progress…',
    '正在读取 DISM 组件存储报告，需要一次管理员授权……': 'Reading the DISM component store report; this needs one admin prompt…',
    '组件存储分析完成（只读，没有改动任何内容）': 'Component store analysis finished (read-only, nothing was changed)',
    '已取消，没有读取组件存储': 'Cancelled — the component store was not read',
    'DISM 没有建议清理，已拒绝执行': 'DISM did not recommend cleanup, so this was refused',
    'DISM 没有建议清理，所以清理按钮保持禁用。这不是故障：强行清理要占用十几分钟 CPU 和磁盘，换回的空间通常很小。': 'DISM did not recommend cleanup, so the buttons stay disabled. This is not a fault: forcing it burns CPU and disk for many minutes and usually reclaims very little.',
    '正在清理组件存储，可能需要 10–30 分钟，请不要关闭软件……': 'Cleaning the component store; this can take 10–30 minutes, please keep the app open…',
    '清理已结束。上面的分析结果已经过期，点「分析」重新读取 DISM 报告。': 'Cleanup finished. The analysis above is now stale — click "Analyze" to read the DISM report again.',
    '已取消管理员授权，组件存储没有任何改动': 'Admin prompt declined; the component store was not changed',
    '清理未完成': 'Cleanup did not complete',
    'DISM 会移除被取代的组件版本，通常 10–30 分钟。期间请不要关机，也不要强行结束本软件；中途打断 DISM 有损坏组件存储的风险。': 'DISM removes superseded component versions and usually takes 10–30 minutes. Do not shut down or force-quit the app meanwhile — interrupting DISM can corrupt the component store.',
    '会执行 DISM /StartComponentCleanup /ResetBase，把所有被取代的组件版本永久移除。清理完成后，已经安装的 Windows 更新将无法卸载（不能再回退到上一个补丁版本）。DISM 可能运行 10–30 分钟甚至更久，中途强行结束有损坏组件存储的风险。': 'Runs DISM /StartComponentCleanup /ResetBase and permanently removes every superseded component version. Afterwards the installed Windows updates can no longer be uninstalled (no rollback to the previous patch level). DISM may run 10–30 minutes or more, and force-quitting it can corrupt the component store.',
    'DISM 拒绝执行（错误 740）。已经提权仍被拒绝，通常是组策略限制或精简系统去掉了组件服务；读不到就不报数字，也不猜': 'DISM refused to run (error 740). It still refused after elevation, which usually means a group-policy restriction or a stripped-down Windows without component servicing. No numbers are reported and nothing is guessed.',
    'DISM 拒绝执行（错误 740），组件存储没有任何改动': 'DISM refused to run (error 740); the component store was not changed',
    'DISM 的输出无法解析': 'Could not parse the DISM output',
    'DISM 没有返回结果': 'DISM returned no result',
    'DISM 报告可回收包数量为 0': 'DISM reports zero reclaimable packages',
    '未经确认，已拒绝清理组件存储': 'Refused to clean the component store without confirmation',
    '未知的清理方式': 'Unknown cleanup mode',
    '已取消管理员授权，没有对组件存储做任何操作': 'Admin prompt declined; nothing was done to the component store',
    '工作目录未初始化': 'Work directory not initialized',
    'WinSxS 常规清理': 'WinSxS regular cleanup',
    'WinSxS 深度清理（/ResetBase）': 'WinSxS deep cleanup (/ResetBase)',
    '被取代的组件已经删除，无法放回；这条只作为记录': 'The superseded components are gone and cannot be put back; this entry is only a record',
    '被取代的组件版本已永久移除，之后已安装的 Windows 更新无法卸载；这条只作为记录': 'Superseded component versions are permanently removed, so installed Windows updates can no longer be uninstalled; this entry is only a record',

    // ---------- 系统级：旧驱动包 ----------
    '旧驱动包': 'Outdated driver packages',
    '只列出「同一个 inf 在驱动库里存了多份」的情况，保留最新的一份（按 Windows 自己的排序规则：日期新者优先，日期相同再比版本号）。删除用 pnputil /delete-driver，不带 /force 也不带 /uninstall，任何仍被设备使用的包都会被系统自己拒绝。': 'Only lists cases where the same inf exists several times in the driver store, keeping the newest copy (ranked the way Windows ranks drivers: newest date first, then version number when dates tie). Deletion uses pnputil /delete-driver without /force and without /uninstall, so Windows itself refuses any package a device still depends on.',
    '还没有扫描。扫描只读驱动库，不需要管理员权限，也不会删除任何驱动。': 'Not scanned yet. Scanning only reads the driver store — no admin rights needed and no driver is removed.',
    '驱动库里没有发现重复的驱动包，不需要处理。': 'No duplicate driver packages in the driver store; nothing to do.',
    '正在读取驱动库（只读，不需要管理员授权）……': 'Reading the driver store (read-only, no admin prompt needed)…',
    '读取驱动库失败': 'Failed to read the driver store',
    '请先勾选要删除的旧驱动包': 'Select the outdated driver packages to delete first',
    '删除旧驱动包？': 'Delete outdated driver packages?',
    '确认删除': 'Delete',
    '只从驱动库移除同一个 inf 的旧版本，最新的一份保留。仍被设备使用的包会被 pnputil 自己拒绝，本软件不加 /force、也不加 /uninstall，不会动到正在使用的驱动。删除后本软件无法把它放回去；确实需要时让 Windows 重新联网更新驱动即可。': 'Only the older versions of the same inf are removed from the driver store; the newest copy stays. Packages still used by a device are refused by pnputil itself — this app adds neither /force nor /uninstall, so drivers in use are never touched. Deleted packages cannot be put back by this app; if you need one again, let Windows re-download it through driver update.',
    '正在删除旧驱动包，需要一次管理员授权……': 'Deleting outdated driver packages; this needs one admin prompt…',
    '已取消管理员授权，没有删除任何驱动包': 'Admin prompt declined; no driver package was deleted',
    '删除驱动包失败': 'Failed to delete driver packages',
    '未经确认，已拒绝删除驱动包': 'Refused to delete driver packages without confirmation',
    '没有勾选要删除的驱动包': 'No driver package selected for deletion',
    '名字不是 oemXX.inf 形式，已拒绝': 'The name is not of the form oemXX.inf — refused',
    '驱动库里已经没有这个包（可能被其它操作删掉了）': 'This package is no longer in the driver store (another operation may have removed it)',
    '它是同一驱动的最新一份，删掉设备就没驱动可用了，已拒绝': 'This is the newest copy of that driver; deleting it would leave the device without a driver — refused',
    '仍有设备在用这个驱动包，pnputil 拒绝删除': 'A device still uses this package, so pnputil refused to delete it',
    'pnputil 没有列出任何驱动包（精简系统或权限问题）': 'pnputil listed no driver packages (stripped-down Windows or a permissions problem)',
    '驱动包已从驱动库移除，本软件无法把它放回去；确实需要时让 Windows 重新联网更新驱动，或用厂商安装包重装': 'The package is gone from the driver store and this app cannot put it back; if you need it again let Windows re-download it through driver update, or reinstall from the vendor package',
    '日期未知': 'date unknown',
  };

  // 带 ${} 插值的串，运行到界面时数字/路径已经替换进去了，只能按片段或正则处理
  const FRAG = {
    '扫描出错: ': 'Scan error: ',
    '写入失败：': 'Write failed: ',
    '清理出错: ': 'Cleanup error: ',
    '操作失败: ': 'Operation failed: ',
    '统计失败: ': 'Size scan failed: ',
    '更新说明: ': 'Release notes: ',
    '下载失败: ': 'Download failed: ',
    '读取失败: ': 'Read failed: ',
    '正在处理: ': 'Processing: ',
    '已跳过: ': 'Skipped: ',
    '初始化失败: ': 'Init failed: ',
    '检查更新失败: ': 'Update check failed: ',
    '读取启动项失败: ': 'Failed to read startup items: ',
    '部分目录不存在: ': 'Some paths missing: ',
    '自动更新 | 错误: ': 'Auto-update | error: ',
    '自动更新 | 下载失败: ': 'Auto-update | download failed: ',
    '自动更新 | 安装启动失败: ': 'Auto-update | failed to start install: ',
    '扫描出错，已中止: ': 'Scan error, aborted: ',
    '内存释放失败：': 'Memory trim failed: ',
    // ---------- 记录与撤销 / 还原点 / 体检 ----------
    '撤销失败：': 'Undo failed: ',
    '已撤销：': 'Undone: ',
    '已保存到 ': 'Saved to ',
    '导出失败：': 'Export failed: ',
    '体检失败：': 'Health check failed: ',
    // 体检计数条是整串动态拼出来的，只能按开头片段替换；不单独翻「快速」，否则会误伤「快速启动已关闭」
    '快速 · 风险 ': 'Quick · risk ',
    '深度 · 风险 ': 'Deep · risk ',
    '读取变更记录失败: ': 'Failed to read change records: ',
    '还原点：本机不可用 —— ': 'Restore point unavailable here — ',
    '还原点：共 ': 'Restore points: ',
    '还原点未创建：': 'Restore point not created: ',
    '还原点：读取失败 ': 'Restore point: read failed ',
    '还原点：': 'Restore point: ',
    ' 个，最近一个「': ', latest "',
    '；卷影存储已用 ': '; shadow storage used ',
    ' / 上限 ': ' / max ',
    '还没有还原点': 'no restore point yet',
    '已按记录里的原值撤销': 'Undone by writing back the recorded original value',
    '正在撤销…': 'Undoing…',
    '正在体检（只读）…': 'Running health check (read-only)…',
    '深度体检中，会弹一次管理员授权…': 'Deep check running; one admin prompt will appear…',
    '正在请求管理员授权…': 'Requesting administrator authorization…',
    '正在采集系统信息…': 'Collecting system information…',
    '正在分析…': 'Analyzing…',
    '正在读取还原点状态，需要一次管理员授权…': 'Reading restore point status; one admin prompt needed…',
    '正在创建还原点，可能要一两分钟…': 'Creating restore point; may take a minute or two…',
    '正在创建系统还原点…': 'Creating system restore point…',
    '正在导出体检报告…': 'Exporting health report…',
    '建议：': 'Tip: ',
    '（无描述）': '(no description)',
    '一键优化': 'One-click tuning',
    '生效中': 'active',
    '共 ': 'Total ',
    ' 条记录 · 生效中 ': ' changes · active ',
    ' · 其中可撤销 ': ' · undoable ',
    ' · 撤销失败 ': ' · undo failed ',
    '按时间倒序撤销 ': 'Undoing ',
    ' 条可撤销的改动，逐条写回记录里的原值。删文件类记录不在其中（物理上无法恢复）。过程中可能弹多次管理员授权。': ' undoable changes newest first, writing each recorded original value back. File-deletion records are excluded (physically unrecoverable). Several admin prompts may appear.',
    '档位本身已应用，撤销请用「记录与撤销」页。': 'the tier itself was applied; use the "Changes & Undo" page to revert.',
    ' · 风险 ': ' · risk ',
    ' · 建议处理 ': ' · advised ',
    ' · 供参考 ': ' · FYI ',
    ' · 正常 ': ' · OK ',
    '已清理 ': 'Cleaned ',
    '失败: ': 'Failed: ',
    '文件: ': 'File: ',
    '例如: ': 'e.g. ',
    '最新 ': 'newest ',
    '备份目录: ': 'Backup dir: ',
    '禁用记录: ': 'Disabled log: ',
    '注册表 ': 'Registry ',
    '启动文件夹(': 'Startup folder (',
    ' 被误判为 ': ' misdetected as ',
    ' 个文件': ' files',
    '线程': 'threads',
    ' 天 ': ' d ',
    ' 小时 ': ' h ',
    ' 分': ' min',
    '项 · 最新': 'items · newest',
    '正在统计 ': 'Measuring ',
    '可用 / ': 'free / ',
    '（目录）': '(dir)',
    '、': ', ',
    '，预计释放 ': ', est. to free ',
    '。执行时会逐项复查安全规则（保护清单、允许范围、拒绝链接），被占用的文件自动跳过。': '. Each item is re-checked against the safety rules (protect list, allowed scope, link refusal) when it runs; in-use files are skipped automatically.',
    // ---------- 组件存储 / 旧驱动包 ----------
    '分析出错: ': 'Analysis error: ',
    '删除出错: ': 'Delete error: ',
    '实际占用 ': 'Actual size ',
    '与系统共享 ': 'Shared with Windows ',
    '（这部分删不掉，属于正常）': ' (not reclaimable, this is normal)',
    '更新备份与已禁用功能 ': 'Update backups and disabled features ',
    '缓存与临时数据 ': 'Cache and temporary data ',
    '可回收包数量 ': 'reclaimable packages ',
    '上次清理：': 'last cleanup: ',
    '清理要占用 CPU 和磁盘十几分钟甚至更久，换回的空间可能很小；不清完全没问题': 'Cleanup burns CPU and disk for many minutes and may reclaim very little; skipping it is perfectly fine',
    '保留 ': 'Keep ',
    '可删 ': 'Removable ',
  };

  // 会被更长中文词包含的短片段一律不放进 FRAG（实测 ' 项' 命中「项目」、'版本 ' 命中「新版本」），
  // 这类改用带上下文的正则处理。
  const RE_RULES = [
    [/^释放 (.+) · 跳过 (\d+) 项 · 耗时 (.+) 秒$/, 'Freed $1 · skipped $2 items · took $3'],
    [/共 (\d+) items?/g, 'Total $1 items'],
    [/共 (\d+) 项/g, 'Total $1 items'],
    [/(\d+(?:\.\d+)?) 项/g, '$1 items'],
    [/版本 (?=[\d.])/g, 'Version '],
    [/（(\d+) 项被占用跳过）/g, '($1 items skipped, in use)'],
    [/仍有 (\d+) 项未能清空/g, 'still $1 items not emptied'],
    [/回收站: 仍有 (\d+) 项/g, 'Recycle Bin: still $1 items'],
    [/仍有 (\d+) 个进程未关闭/g, 'still $1 processes running'],
    [/关闭浏览器 \| 剩余进程 (\d+)/g, 'Close browsers | remaining processes $1'],
    [/只统计 (\d+) 天前的项/g, 'only items older than $1 day(s)'],
    [/残留 ([\d.]+) MB（文件被占用，可关闭相关程序后重试）/g, 'leftover $1 MB (files in use; close the related programs and retry)'],
    [/(\d+) 个文件被占用，已跳过/g, '$1 files in use, skipped'],
    [/正在统计 (\d+)\/(\d+):/g, 'Measuring $1/$2:'],
    [/提权脚本未返回结果（退出码 ([^）]*)）(.*)/g, 'The elevated script returned no result (exit code $1)$2'],
    [/C 盘可用: (.+) → (.+)/g, 'C: free: $1 → $2'],
    [/C盘可用 (.+) → (.+)/g, 'C: free $1 → $2'],
    [/^(\S+) 可用 \/ (\S+)$/g, '$1 free / $2'],
    [/(\d+) 项 · 最新 /g, '$1 items · newest '],
    [/检测到 (.+?) 正在运行，其缓存文件会被占用而跳过。/g, 'Detected $1 running; its cache files are in use and will be skipped.'],
    [/^已整理 (\d+) 个进程 · 工作集 (\d+) MB → (\d+) MB（跳过 (\d+) 个）$/, 'Trimmed $1 processes · working set $2 MB → $3 MB (skipped $4)'],
    // ---------- 组件存储 / 旧驱动包 ----------
    [/^正在清理 ([\d.]+)% · 已用 (\d+) 分 (\d+) 秒$/, 'Cleaning $1% · elapsed $2m $3s'],
    [/^正在清理 … · 已用 (\d+) 分 (\d+) 秒$/, 'Cleaning … · elapsed $1m $2s'],
    [/^DISM 已结束 · 已用 (\d+) 分 (\d+) 秒$/, 'DISM finished · elapsed $1m $2s'],
    [/^组件存储清理完成，用时 (\d+) 秒$/, 'Component store cleanup finished in $1 s'],
    [/^组件存储清理完成，用时 (\d+) 分 (\d+) 秒$/, 'Component store cleanup finished in $1m $2s'],
    // 基线表的记录时间是拼出来的：整句先命中，否则片段词典会把「开机」换成英文让锚点失效
    [/^优化前记录于 (.+?)（当时上次开机 (.+?)）$/, 'Before recorded at $1 (last boot: $2)'],
    [/^优化后记录于 (.+?)（当时上次开机 (.+?)）$/, 'After recorded at $1 (last boot: $2)'],
    [/^([A-Z]) 盘可用$/, '$1: free'],
    [/^DISM 以退出码 (-?\d+) 结束，组件存储可能只清理了一部分$/, 'DISM exited with code $1; the component store may be only partly cleaned'],
    [/^驱动库共 (\d+) 个包，发现 (\d+) 组重复、(\d+) 个旧版本$/, 'Driver store: $1 packages, $2 duplicate groups, $3 outdated versions'],
    [/^已删除 (\d+) 个旧驱动包$/, 'Deleted $1 outdated driver packages'],
    [/^已删除 (\d+) 个旧驱动包，(\d+) 个被系统拒绝：([\s\S]*)$/, 'Deleted $1 outdated driver packages, $2 refused by Windows: $3'],
    [/^删除 (\d+) 个旧驱动包（([\s\S]*)）$/, 'Deleted $1 outdated driver packages ($2)'],
  ];

  // EXACT 里的条目同时充当片段词典：日志行、状态条这类由多段拼出来的长文本，
  // 整段匹配不上时仍能逐段翻译。按长度倒序替换，保证「Chrome 代码缓存」不会被「Chrome 缓存」抢先命中。
  const FRAG_ALL = Object.assign({}, FRAG);
  for (const k of Object.keys(EXACT)) if (FRAG_ALL[k] === undefined) FRAG_ALL[k] = EXACT[k];
  const fragKeys = Object.keys(FRAG_ALL).sort((a, b) => b.length - a.length);

  // 整句锚定的正则必须在片段替换之前跑。「组件存储清理完成，用时 3 分 12 秒」这类，
  // 片段词典会先把「组件存储」「分」换成英文，锚点就永远匹配不上，规则形同死代码。
  const WHOLE = [];
  for (const [re, rep] of RE_RULES) {
    if (re.source.startsWith('^') && re.source.endsWith('$')) {
      WHOLE.push([new RegExp(re.source, re.flags.replace('g', '')), rep]);
    }
  }

  let lang = 'zh';
  let busy = false;
  let observer = null;
  const origText = new WeakMap();
  const origAttr = new WeakMap();
  let origTitle = null;

  function translate(s) {
    if (typeof s !== 'string' || !CJK.test(s)) return s;
    const trimmed = s.trim();
    if (EXACT[trimmed] !== undefined) {
      const i = s.indexOf(trimmed);
      return s.slice(0, i) + EXACT[trimmed] + s.slice(i + trimmed.length);
    }
    for (const [re, rep] of WHOLE) {
      if (!re.test(trimmed)) continue;
      const i = s.indexOf(trimmed);
      return s.slice(0, i) + trimmed.replace(re, rep) + s.slice(i + trimmed.length);
    }
    let out = s;
    // 顺序很重要：先替换最长的字面片段，剩下的带数字/路径的残句才交给正则，
    // 否则正则会先把「发现新版本 99.9.9」改成「发现新Version 99.9.9」，导致整句匹配不上。
    for (const k of fragKeys) if (out.indexOf(k) !== -1) out = out.split(k).join(FRAG_ALL[k]);
    for (const [re, rep] of RE_RULES) out = out.replace(re, rep);
    return out;
  }

  function trText(node) {
    const v = node.nodeValue;
    if (!v || !CJK.test(v)) return;
    const t = translate(v);
    if (t === v) return;
    if (!origText.has(node)) origText.set(node, v);
    node.nodeValue = t;
  }

  function trAttrs(elm) {
    if (!elm || elm.nodeType !== 1) return;
    let saved = null;
    for (const a of ATTRS) {
      const v = elm.getAttribute(a);
      if (!v || !CJK.test(v)) continue;
      const t = translate(v);
      if (t === v) continue;
      if (!saved) saved = origAttr.get(elm) || {};
      if (saved[a] === undefined) saved[a] = v;
      elm.setAttribute(a, t);
    }
    if (saved) origAttr.set(elm, saved);
  }

  function walk(root) {
    if (lang !== 'en' || !root) return;
    if (root.nodeType === 3) { trText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 11) return;
    if (root.nodeType === 1) trAttrs(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, null);
    let n = w.currentNode;
    while (n) {
      if (n.nodeType === 3) trText(n); else trAttrs(n);
      n = w.nextNode();
    }
  }

  function applyTitle() {
    if (origTitle === null) origTitle = document.title;
    document.title = translate(origTitle);
    document.documentElement.setAttribute('lang', lang === 'en' ? 'en' : 'zh-CN');
  }

  function restore() {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, null);
    let n = w.currentNode;
    while (n) {
      if (n.nodeType === 3) {
        const o = origText.get(n);
        if (o !== undefined) n.nodeValue = o;
      } else {
        const o = origAttr.get(n);
        if (o) for (const a of Object.keys(o)) n.setAttribute(a, o[a]);
      }
      n = w.nextNode();
    }
    if (origTitle !== null) document.title = origTitle;
    document.documentElement.setAttribute('lang', 'zh-CN');
  }

  function apply() {
    busy = true;
    try {
      if (lang === 'en') { walk(document.body); applyTitle(); } else { restore(); }
    } finally {
      busy = false;
    }
  }

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver((muts) => {
      if (lang !== 'en' || busy) return;
      busy = true;
      try {
        for (const m of muts) {
          if (m.type === 'characterData') trText(m.target);
          else if (m.type === 'attributes') trAttrs(m.target);
          else for (const added of m.addedNodes) walk(added);
        }
      } finally {
        busy = false;
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS,
    });
  }

  async function setLang(next, api) {
    lang = next === 'en' ? 'en' : 'zh';
    apply();
    if (window.eula) window.eula.render();
    if (window.gpu) window.gpu.renderStatic();
    if (window.power) window.power.render();
    if (window.game) window.game.render();
    if (window.tiers) window.tiers.render();
    if (window.healthView) window.healthView.render();
    if (api && api.settingsSet) { try { await api.settingsSet({ lang: lang }); } catch (e) { /* 存不下也不影响本次显示 */ } }
    return lang;
  }

  async function init(api) {
    let saved = null;
    if (api && api.settingsGet) { try { saved = await api.settingsGet(); } catch (e) { saved = null; } }
    lang = saved && saved.lang === 'en' ? 'en' : 'zh';
    startObserver();
    apply();

    const sel = document.getElementById('langSel');
    if (sel) {
      sel.value = lang;
      sel.addEventListener('change', () => setLang(sel.value, api));
    }
    return lang;
  }

  window.i18n = { init: init, setLang: setLang, apply: apply, translate: translate, get lang() { return lang; } };
})();
