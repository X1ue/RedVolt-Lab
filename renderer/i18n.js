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
    '更新文件托管在 GitHub Releases，软件只读取公开下载地址，不需要任何账号或密钥。只有「Setup 安装版」支持自动更新，便携版不能自我更新。发现新版本后需要你分别点击「下载更新」和「安装并重启」，软件不会静默覆盖文件，也不会不打招呼就重启。': 'Update files are hosted on GitHub Releases; the app only reads the public download URL and needs no account or key. Only the Setup-installed build supports auto-update; the portable exe cannot self-update. When a new version is found you click "Download update" and then "Install and restart" yourself — the app never overwrites files silently or restarts without asking.',
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
    '专业版': 'Pro',
    '家庭版': 'Home',
    '企业版': 'Enterprise',
    '教育版': 'Education',
    '⚙ 软件设置': '⚙ Settings',
    '软件设置': 'Settings',
    '关闭设置': 'Close',
    '界面语言': 'UI language',
    '背景闪电动效': 'Background lightning effect',
    '启动时自动检查更新': 'Check for updates on startup',
    '极致的性能强化': 'Ultimate Performance Boost',
    '实时掌握 CPU / GPU / 内存占用。清理一律先只读扫描预览，逐项复查安全规则，你确认后才执行删除。': 'Watch CPU / GPU / memory in real time. Cleanup always begins with a read-only scan preview, re-checks every safety rule per item, and deletes only after you confirm.',
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
  };

  // 带 ${} 插值的串，运行到界面时数字/路径已经替换进去了，只能按片段或正则处理
  const FRAG = {
    '扫描出错: ': 'Scan error: ',
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
  ];

  // EXACT 里的条目同时充当片段词典：日志行、状态条这类由多段拼出来的长文本，
  // 整段匹配不上时仍能逐段翻译。按长度倒序替换，保证「Chrome 代码缓存」不会被「Chrome 缓存」抢先命中。
  const FRAG_ALL = Object.assign({}, FRAG);
  for (const k of Object.keys(EXACT)) if (FRAG_ALL[k] === undefined) FRAG_ALL[k] = EXACT[k];
  const fragKeys = Object.keys(FRAG_ALL).sort((a, b) => b.length - a.length);

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
