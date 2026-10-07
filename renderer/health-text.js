'use strict';
// 体检报告的双语文案模板：主进程只给「判定结果 + 数据」，这里负责说成人话。
// 之所以放在渲染层，是因为界面语言只有这里知道；同一条模板也供导出的纯文本报告使用。
// UMD：浏览器里挂 window.healthText，node 测试里 require 同一份，避免两边文案漂移。
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.healthText = mod;
})(typeof window !== 'undefined' ? window : this, function () {
  const GROUP = {
    space: { zh: '空间', en: 'Space' },
    perf: { zh: '性能', en: 'Performance' },
    system: { zh: '系统', en: 'System' },
    gpu: { zh: '显卡', en: 'GPU' },
    startup: { zh: '启动', en: 'Startup' },
  };

  const SEV = {
    risk: { zh: '风险', en: 'Risk' },
    warn: { zh: '建议处理', en: 'Action advised' },
    info: { zh: '供参考', en: 'Info' },
    good: { zh: '正常', en: 'OK' },
  };

  // 深度体检里「没读到」的分区与原因：脚本回传稳定 ASCII 代码，这里翻成人话
  const SECTION = {
    admin: { zh: '管理员身份', en: 'Administrator rights' },
    winsxs: { zh: '组件存储（DISM）', en: 'Component store (DISM)' },
    trim: { zh: 'TRIM 状态', en: 'TRIM state' },
    restore: { zh: '还原点', en: 'Restore points' },
    'restore-points': { zh: '还原点列表', en: 'Restore point list' },
    'restore-config': { zh: '系统保护配置', en: 'System protection config' },
    'shadow-storage': { zh: '卷影存储用量', en: 'Shadow storage usage' },
    leftovers: { zh: '系统残留体积', en: 'System leftovers' },
    drivers: { zh: '第三方驱动库', en: 'Driver store' },
    boot: { zh: '启动诊断日志', en: 'Boot diagnostics log' },
    'boot-perf': { zh: '启动诊断日志', en: 'Boot diagnostics log' },
    'boot-kernel': { zh: '内核启动记录', en: 'Kernel boot records' },
    'boot-crash': { zh: '异常关机记录', en: 'Unexpected shutdown records' },
  };

  const REASON = {
    'access-denied': { zh: '权限不够，读不到', en: 'not readable without more rights' },
    'log-absent': { zh: '这个日志在本机不存在（可能被精简，或相关服务没启用）', en: 'this log does not exist on this machine (removed by a trimmed build, or the related service is off)' },
    'no-events': { zh: '没有匹配的记录', en: 'no matching records' },
    'vssadmin-no-numbers': { zh: 'vssadmin 没给出可用数字（通常是权限不够）', en: 'vssadmin returned no usable numbers (usually a rights issue)' },
    'fsutil-no-output': { zh: 'fsutil 没有输出', en: 'fsutil produced no output' },
    'pnputil-no-packages': { zh: 'pnputil 没列出驱动包', en: 'pnputil listed no driver packages' },
  };

  const join = (a, sep) => (a || []).join(sep);

  // 档位名、开关项名、N 卡取值名分别由 tiers.js / game.js 自己维护。
  // 体检里要展示它们时直接借它们的文本函数，避免同一份中文在两处各写一遍、改一处漏一处。
  // node 单测里没有 window，所以一律带回退：借不到就显示原始 id。
  function tiersApi() { return (typeof window !== 'undefined' && window.tiers) || null; }
  function tierName(key) {
    const ti = tiersApi();
    return ti && ti.tierName ? ti.tierName(key) : String(key || '');
  }
  function tierGroup(kind, L) {
    const ti = tiersApi();
    return ti && ti.groupText ? ti.groupText(kind) : (kind === 'game' ? 'game' : 'gpu');
  }
  // 一行「当前 → 应为」：开关项走 gameText，N 卡项走 gpuValueText（两者都按界面当前语言取词）
  function driftRow(name, cur, to, L) {
    return L === 'zh' ? `${name}：当前 ${cur} → 应为 ${to}` : `${name}: now ${cur} → should be ${to}`;
  }
  function driftRows(p, L) {
    const ti = tiersApi();
    const out = [];
    for (const g of p.game || []) {
      const w = ti && ti.gameText ? ti.gameText(g) : { name: g.id, cur: String(g.current), to: String(g.mode) };
      out.push({ kind: 'game', text: driftRow(w.name, w.cur, w.to, L) });
    }
    for (const it of p.gpu || []) {
      const name = (it.name || {})[L] || (it.name || {}).zh || it.id;
      const cur = ti && ti.gpuValueText ? ti.gpuValueText(it, 'current') : String(it.current);
      const to = ti && ti.gpuValueText ? ti.gpuValueText(it, 'target') : String(it.value);
      out.push({ kind: 'gpu', text: driftRow(name, cur, to, L) });
    }
    return out;
  }
  /** 漂移明细：按「系统游戏开关 / N 卡 3D 设置」分两段列清单，末尾说明检测范围 */
  function driftBody(p, L) {
    const rows = driftRows(p, L);
    const lines = [];
    for (const kind of ['game', 'gpu']) {
      const sec = rows.filter((r) => r.kind === kind);
      if (!sec.length) continue;
      lines.push(tierGroup(kind, L));
      for (const r of sec) lines.push('  ' + r.text);
    }
    lines.push(L === 'zh'
      ? '范围只限本软件写过的设置；电源计划和启动项不在这里判（它们各有自己的入口）。'
      : 'Scope is limited to settings this app wrote; the power plan and startup items are not judged here (each has its own entry).');
    return lines.join('\n');
  }

  // 模板值可以是字符串（{name} 占位）或函数（需要条件分支时用）
  const T = {
    // ---------- 空间 ----------
    diskTitle: {
      zh: '{letter} 可用 {free}（共 {size}，剩 {pct}）',
      en: '{letter} has {free} free (of {size}, {pct} left)',
    },
    diskCritDetail: { zh: '剩余空间低于 10%，Windows 更新、页面文件扩展和程序缓存都可能失败。', en: 'Less than 10% free: Windows Update, page-file growth and app caches can all fail.' },
    diskCritTip: { zh: '先跑一次磁盘清理，再看下面的「可回收空间」条目', en: 'Run a disk cleanup first, then read the reclaimable-space items below' },
    diskLowDetail: { zh: '剩余空间偏紧，系统盘建议长期保留 15% 以上。', en: 'Free space is getting tight; a system drive should keep above 15% long term.' },
    diskLowTip: { zh: '看下面的组件存储 / 页面文件 / 更新残留条目', en: 'See the component-store / page-file / update-leftover items below' },
    diskOkDetail: { zh: '系统盘空间充足。', en: 'The system drive has plenty of space.' },

    sameDiskTitle: {
      zh: (p) => join(p.letters, ' 盘与 ') + ' 盘在同一块物理盘上（' + p.name + '）',
      en: (p) => join(p.letters, ' and ') + ' are partitions on the same physical disk (' + p.name + ')',
    },
    sameDiskDetail: { zh: '它们是同一块硬盘上的两个分区，清理其中一个不会给另一个腾出空间；总容量也是共享的。', en: 'They are two partitions on one disk: cleaning one frees no space for the other, and the total capacity is shared.' },
    sameDiskTip: { zh: '要腾 C 盘就清 C 盘上的东西，别指望清 D 盘', en: 'To free up C:, clean what lives on C: — cleaning D: will not help' },

    ssdAllTitle: { zh: '全部物理盘都是 SSD', en: 'Every physical disk is an SSD' },
    ssdAllDetail: {
      zh: (p) => '介质类型：' + join(p.kinds, '，') + '；不需要也不应该做传统碎片整理。',
      en: (p) => 'Media types: ' + join(p.kinds, ', ') + '; classic defragmentation is neither needed nor advisable.',
    },

    diskHealthTitle: { zh: '硬盘健康状态异常：{name} = {health}', en: 'Disk health is not normal: {name} = {health}' },
    diskHealthDetail: { zh: '存储子系统报告的不是 Healthy，可能有坏块或寿命问题。', en: 'The storage subsystem reports something other than Healthy — possible bad blocks or end-of-life wear.' },
    diskHealthTip: { zh: '尽快备份重要数据，并用厂商工具（如 CrystalDiskInfo）复查 SMART', en: 'Back up important data now and re-check SMART with a vendor tool (e.g. CrystalDiskInfo)' },

    pagefileTitle: { zh: '页面文件共 {total}（C 盘占 {onC}）', en: 'Page files total {total} ({onC} on C:)' },
    pagefileDetail: {
      zh: (p) => '实际使用 ' + join(p.usage, '；') + '。' + (p.auto ? '当前是「系统自动管理」。' : '当前是手动指定大小。') + '页面文件是内存不够时的溢出空间，直接关掉可能导致程序崩溃。',
      en: (p) => 'Actually in use: ' + join(p.usage, '; ') + '. ' + (p.auto ? 'Currently system-managed.' : 'Currently a manually set size.') + ' The page file is overflow space for RAM; switching it off outright can crash programs.',
    },
    pagefileMoveTip: { zh: 'C 盘吃紧时可以把页面文件整体挪到其它盘，或把 C 盘的初始值调小（不要设为 0）', en: 'If C: is tight, move the page file wholesale to another drive, or lower its initial size on C: (never to 0)' },
    pagefileKeepTip: { zh: '空间够的话不建议动它', en: 'If space is not the problem, leave it alone' },

    winsxsWarnTitle: { zh: '组件存储可回收约 {backups}（WinSxS 实际 {actual}）', en: 'About {backups} reclaimable in the component store (WinSxS currently {actual})' },
    winsxsWarnDetail: { zh: 'DISM 判定「建议清理」，可回收包 {reclaimable} 个；上次清理 {lastCleanup}。与 Windows 共享的 {shared} 是硬链接，本来就不额外占空间。', en: 'DISM says "cleanup recommended", {reclaimable} reclaimable packages; last cleanup {lastCleanup}. The {shared} shared with Windows is hard-linked and costs no extra space.' },
    winsxsWarnTip: { zh: '到「系统级清理」里跑组件存储清理；勾选 /ResetBase 会多回收一些，但之后已装的更新将无法卸载', en: 'Run the component-store cleanup under "System-level cleanup"; ticking /ResetBase reclaims a bit more but installed updates can then no longer be uninstalled' },
    winsxsGoodTitle: { zh: '组件存储 {actual}，暂不需要清理', en: 'Component store is {actual}; no cleanup needed right now' },
    winsxsGoodDetail: { zh: '可回收包 {reclaimable} 个，DISM 判定「不建议清理」；上次清理 {lastCleanup}。', en: '{reclaimable} reclaimable packages; DISM says cleanup is not recommended; last cleanup {lastCleanup}.' },
    winsxsNaAdminTitle: { zh: '组件存储没读到：DISM 拒绝执行', en: 'Component store unreadable: DISM refused' },
    winsxsNaFailTitle: { zh: '组件存储分析失败', en: 'Component-store analysis failed' },
    winsxsNaAdminDetail: { zh: 'DISM 返回错误 740（需要管理员权限），即使本次已提权仍被拒绝，通常是被组策略或精简系统挡掉了。读不到就不报数字，绝不猜。', en: 'DISM returned error 740 (administrator rights required) and was refused even though this run was elevated — usually group policy or a trimmed build blocks it. If it cannot be read, no number is reported and nothing is guessed.' },
    winsxsNaFailDetail: { zh: 'DISM 没有返回可解析的结果，可能是组件存储损坏或 DISM 被精简。', en: 'DISM returned nothing parseable — the component store may be damaged, or DISM itself was trimmed away.' },
    winsxsNaTip: { zh: '可在管理员命令行手动跑 dism /online /cleanup-image /scanhealth 看具体报错', en: 'Run "dism /online /cleanup-image /scanhealth" in an elevated command prompt to see the exact error' },

    leftoversTitle: { zh: '系统自身还有 {count} 处可回收，合计 {total}', en: '{count} more spots the system itself can reclaim, {total} in total' },
    leftoversDetail: { zh: (p) => join((p.items || []).map((i) => `${i.path} = ${i.size}`), '\n'), en: (p) => join((p.items || []).map((i) => `${i.path} = ${i.size}`), '\n') },
    leftoversTip: { zh: '这些都能在「系统级清理」里清；Windows.old 和 $WINDOWS.~BT 是大版本升级残留，确认新系统稳定后可删', en: 'All of these are cleanable under "System-level cleanup"; Windows.old and $WINDOWS.~BT are major-upgrade leftovers, safe to delete once the new system proves stable' },

    driversDupTitle: { zh: '驱动库里有 {groups} 组重复驱动，共 {oldCount} 个旧版本', en: '{groups} duplicate driver groups in the store, {oldCount} old versions' },
    driversDupDetail: {
      zh: (p) => join((p.items || []).map((g) => `${g.orig}：保留 ${g.keep}（${g.keepVersion || '?'} ${g.keepDate || ''}），旧版 ${join(g.old, '、')}`), '\n'),
      en: (p) => join((p.items || []).map((g) => `${g.orig}: keeping ${g.keep} (${g.keepVersion || '?'} ${g.keepDate || ''}), old: ${join(g.old, ', ')}`), '\n'),
    },
    driversDupTip: { zh: '旧版本驱动包可以在「系统级清理」里勾选删除；删错了设备会回退到系统自带驱动，一般不会变砖', en: 'Old driver packages can be ticked for removal under "System-level cleanup"; if you remove one by mistake the device falls back to the inbox driver — it does not brick anything' },
    driversOkTitle: { zh: '第三方驱动 {count} 个，没有发现重复的旧版本', en: '{count} third-party drivers, no duplicate old versions found' },

    restoreNaTitle: { zh: '还原点状态读不到', en: 'Restore-point state unreadable' },
    restoreNaDetail: { zh: '系统没有把还原点列表交给本次体检（权限不足或还原点组件被精简），所以这里不下结论，也不代表你没有还原点。', en: 'The system did not hand the restore-point list to this check (missing rights, or the component was trimmed away), so no conclusion is drawn here — it does not mean you have none.' },
    restoreNaTip: { zh: '在「记录与撤销」页点「还原点状态」，单独授权一次就能看到真实情况', en: 'Click "Restore point status" on the "Changes & Undo" page and authorise once to see the real state' },
    restoreOffTitle: { zh: '系统保护已关闭', en: 'System protection is off' },
    restoreOffDetail: { zh: '当前没有任何还原点可用，出问题只能靠本软件的变更账本回滚。', en: 'No restore point is available, so a problem can only be rolled back through the change ledger of this app.' },
    restoreOffTip: { zh: '在「系统属性 → 系统保护」里为 C 盘启用，并给卷影存储分配 5% 左右', en: 'Enable it for C: under "System Properties → System Protection" and give shadow storage about 5%' },
    restoreNoneTitle: { zh: '系统保护开着，但一个还原点都没有', en: 'System protection is on but there is no restore point' },
    restoreNoneDetail: { zh: '可能是刚启用，也可能是精简系统移除了创建组件。', en: 'Either it was just enabled, or a trimmed build removed the creation component.' },
    restoreNoneTip: { zh: '在「记录与撤销」页点「立即创建还原点」试一次，失败原因会如实显示', en: 'Try "Create restore point now" on the "Changes & Undo" page; the failure reason is shown as-is' },
    restoreOkTitle: {
      zh: (p) => `有 ${p.count} 个还原点，最近一个：${p.at ? (p.desc || '（无描述）') + ' @ ' + p.at : '未知'}`,
      en: (p) => `${p.count} restore point(s), latest: ${p.at ? (p.desc || '(no description)') + ' @ ' + p.at : 'unknown'}`,
    },
    restoreOkDetail: {
      zh: (p) => (p.max ? `卷影存储上限 ${p.max}，已用 ${p.used}；按每个还原点约 1 GB 算，大概还能存 ${p.room} 个。` : ''),
      en: (p) => (p.max ? `Shadow storage cap ${p.max}, used ${p.used}; at roughly 1 GB per point that leaves room for about ${p.room} more.` : ''),
    },

    deepFailedTitle: { zh: '深度体检有 {count} 项没读到', en: '{count} items could not be read in the deep check' },
    deepFailedDetail: {
      zh: (p) => join((p.items || []).map((x) => `${(SECTION[x.section] || {}).zh || x.section}：${(REASON[x.error] || {}).zh || (x.error || '未知原因')}`), '\n'),
      en: (p) => join((p.items || []).map((x) => `${(SECTION[x.section] || {}).en || x.section}: ${(REASON[x.error] || {}).en || (x.error || 'no reason given')}`), '\n'),
    },
    deepFailedTip: { zh: '读不到就不下结论，也不猜，其余各项照常给出；多数情况是权限或日志被精简，不影响本软件其它功能', en: 'Where nothing can be read, no conclusion is drawn and nothing is guessed; every other item is still reported. Usually it is rights or a trimmed log, and it does not affect the rest of this app' },

    // ---------- 性能 ----------
    bootDiagOffTitle: { zh: '系统自带的启动诊断已停止记录', en: 'The built-in boot diagnostics stopped recording' },
    bootDiagOffDetail: { zh: '诊断策略服务（DPS）当前是 {status}/{startType}，所以拿不到官方的「开机耗时 / 哪个程序拖慢了启动」数据，事件日志里只剩历史记录。', en: 'The Diagnostic Policy Service (DPS) is {status}/{startType}, so the official "boot duration / which program slowed startup" data is unavailable; only historical entries remain in the event log.' },
    bootDiagOffTip: { zh: '想要精确的开机耗时分析，需要把 DPS 服务改回「自动」并重启一次；本软件不擅自改服务状态', en: 'For precise boot timing you would have to set DPS back to "Automatic" and reboot once; this app never changes a service state on its own' },
    bootTimeTitle: { zh: '最近一次开机耗时 {secs}', en: 'Last boot took {secs}' },
    bootTimeIncompleteTitle: { zh: '最近一次开机耗时（数据不完整）', en: 'Last boot duration (data incomplete)' },
    bootTimeDetail: { zh: '事件时间 {at}；字段：{fields}', en: 'Event time {at}; fields: {fields}' },
    bootTimeTip: { zh: '启动诊断日志（Diagnostics-Performance）由 DPS 服务写入，可在「系统信息」里看历史趋势', en: 'The Diagnostics-Performance log is written by DPS; historical trend is on the "System info" page' },
    crashTitle: { zh: '最近 30 天有 {count} 次异常关机', en: '{count} unexpected shutdowns in the last 30 days' },
    crashDetail: { zh: '系统日志 Event 6008：上一次关机不是正常流程（断电、死机、强制重启）。频繁出现通常指向电源、驱动或超频不稳。', en: 'System log Event 6008: the previous shutdown was not a normal flow (power loss, hang, forced restart). Repeated occurrences usually point at the PSU, a driver, or unstable overclocking.' },
    crashTip: { zh: '配合「显卡优化」里的驱动版本和事件查看器里的 WHEA 错误一起排查', en: 'Cross-check the driver version under "GPU tuning" and WHEA errors in Event Viewer' },
    crashOkTitle: { zh: '最近 30 天没有异常关机记录', en: 'No unexpected shutdowns in the last 30 days' },
    crashOkDetail: { zh: '系统日志里查不到 Event 6008，说明这段时间的关机和重启都走完了正常流程。', en: 'No Event 6008 in the system log, so every shutdown and restart in that window completed the normal flow.' },
    uptimeTitle: { zh: '已连续开机 {hours}', en: 'Up continuously for {hours}' },
    uptimeDetail: { zh: '长时间不重启会积累内存碎片、句柄泄漏和驱动状态残留，很多「越用越卡」重启就好。', en: 'Going long without a reboot accumulates memory fragmentation, handle leaks and stale driver state; a lot of "it got slower over time" is fixed by one reboot.' },
    uptimeTip: { zh: '方便时重启一次；注意快速启动开启时「关机」并不等于完整重启', en: 'Reboot when convenient; note that with Fast Startup "Shut down" is not a full reboot' },
    trimOffTitle: { zh: 'TRIM 被禁用（{fs}）', en: 'TRIM is disabled ({fs})' },
    trimOffDetail: { zh: 'SSD 收不到 TRIM 就无法回收已删除的块，长期写入会明显掉速并缩短寿命。', en: 'Without TRIM an SSD cannot reclaim deleted blocks; sustained writes slow down noticeably and life shortens.' },
    trimOffTip: { zh: '管理员命令行执行 fsutil behavior set DisableDeleteNotify 0', en: 'Run "fsutil behavior set DisableDeleteNotify 0" in an elevated command prompt' },
    trimOkTitle: { zh: 'TRIM 正常启用（{fs}）', en: 'TRIM is enabled ({fs})' },
    trimOkDetail: { zh: 'SSD 可以正常回收已删除的数据块。', en: 'The SSD can reclaim deleted data blocks normally.' },

    hagsOnTitle: { zh: '硬件加速 GPU 计划（HAGS）已开启', en: 'Hardware-Accelerated GPU Scheduling (HAGS) is on' },
    hagsOnDetail: { zh: 'HwSchMode=2，由显卡直接管理显存调度，多数游戏下延迟更低。', en: 'HwSchMode=2: the GPU schedules its own memory, which lowers latency in most games.' },
    hagsOnTip: { zh: '若遇到个别游戏掉帧或录屏异常，可在「游戏开关」里关掉后重启对比', en: 'If a particular game drops frames or recording misbehaves, switch it off under "Game toggles" and compare after a reboot' },
    hagsOffTitle: { zh: '硬件加速 GPU 计划（HAGS）已关闭', en: 'Hardware-Accelerated GPU Scheduling (HAGS) is off' },
    hagsOffDetail: { zh: 'HwSchMode=1，由系统管理显存调度。', en: 'HwSchMode=1: Windows schedules GPU memory.' },
    hagsOffTip: { zh: '在「游戏开关」里可以打开，改完需要重启电脑才生效', en: '"Game toggles" can turn it on; a reboot is needed before it takes effect' },
    dvrOffTitle: { zh: 'Game DVR / 后台录制已关闭', en: 'Game DVR / background recording is off' },
    dvrOffDetail: { zh: '不会在游戏时偷偷占用 GPU 编码器和磁盘。', en: 'Nothing quietly takes the GPU encoder and the disk while you play.' },
    dvrOnTitle: { zh: 'Game DVR / 后台录制处于开启状态', en: 'Game DVR / background recording is on' },
    dvrOnDetail: { zh: 'GameDVR_Enabled={gamedvr}，AppCaptureEnabled={appCapture}。后台录制会持续占用 GPU 编码器。', en: 'GameDVR_Enabled={gamedvr}, AppCaptureEnabled={appCapture}. Background recording keeps holding the GPU encoder.' },
    dvrOnTip: { zh: '在「游戏开关」里可以一键关掉', en: '"Game toggles" turns it off in one click' },

    // ---------- 系统 / 安全 ----------
    wuTitle: { zh: 'Windows Update 服务已停用', en: 'The Windows Update service is disabled' },
    wuDetail: { zh: '系统不会自动下载安装更新，更新缓存也就不会自己堆积。代价是安全补丁需要手动处理。', en: 'The system will not download or install updates on its own, so the update cache does not pile up either. The price is that security patches become a manual chore.' },
    wuTip: { zh: '改版系统（AtlasOS 等）常这样做；想收补丁就把服务改回手动并手动检查更新', en: 'Custom builds (AtlasOS and similar) commonly do this; to receive patches, set the service back to manual and check yourself' },
    telemetryTitle: { zh: '遥测服务（DiagTrack）已禁用', en: 'The telemetry service (DiagTrack) is disabled' },
    telemetryDetail: { zh: '不会向微软上报使用数据。', en: 'Usage data is not reported to Microsoft.' },
    defAbsentTitle: { zh: '本机没有 Windows Defender', en: 'This machine has no Windows Defender' },
    defAbsentDetail: { zh: '读不到 Defender 状态，说明精简系统已把它移除。系统级实时病毒防护目前是空的，安全性由你自己的使用习惯承担。', en: 'Defender state is unreadable, i.e. the trimmed build removed it. There is currently no system-level real-time antivirus; safety rests on your own habits.' },
    defAbsentTip: { zh: '如果需要防护，装一个第三方杀软比重新塞回 Defender 更省事', en: 'If you want protection, installing a third-party AV is less trouble than forcing Defender back in' },
    defOffTitle: { zh: 'Defender 实时保护已关闭', en: 'Defender real-time protection is off' },
    defOffDetail: { zh: 'AntivirusEnabled={antivirus}，TamperProtection={tamper}。', en: 'AntivirusEnabled={antivirus}, TamperProtection={tamper}.' },
    defOffTip: { zh: '非刻意为之的话建议打开；刻意关闭的（精简系统/性能考虑）可以忽略这条', en: 'Turn it back on unless you did it deliberately; if it was intentional (trimmed build / performance), ignore this item' },
    defOkTitle: { zh: 'Defender 实时保护正常', en: 'Defender real-time protection is healthy' },
    defOkDetail: { zh: (p) => (p.age == null ? '' : '病毒库龄 ' + p.age + ' 小时。'), en: (p) => (p.age == null ? '' : 'Signature age ' + p.age + ' hours.') },
    fastbootOffTitle: { zh: '快速启动已关闭（休眠未启用）', en: 'Fast Startup is off (hibernation disabled)' },
    fastbootOffDetail: { zh: '没有 hiberfil.sys，所以「快速启动」不可用，每次开机都是完整冷启动。开机稍慢，但驱动状态干净、不容易积累怪问题。', en: 'There is no hiberfil.sys, so Fast Startup cannot apply and every boot is a full cold boot. Slightly slower, but driver state stays clean and odd problems do not accumulate.' },
    fastbootOffTip: { zh: '想省 C 盘空间就别开休眠；想开机更快可以 powercfg /h on，代价是多占约等于内存大小的空间', en: 'To save space on C: leave hibernation off; for faster boots use "powercfg /h on", at the cost of roughly RAM-sized disk' },
    fastbootOnTitle: { zh: '快速启动已开启', en: 'Fast Startup is on' },
    fastbootOnDetail: { zh: '「关机」实际是写入休眠文件再恢复，驱动和内核状态不会重置。遇到奇怪问题时请用「重启」而不是「关机再开」。', en: '"Shut down" actually writes a hibernation file and resumes, so driver and kernel state are never reset. When something is odd, use "Restart" rather than shut down and power back on.' },
    fastbootOnTip: { zh: '追求稳定可以关掉快速启动', en: 'For maximum stability, turn Fast Startup off' },

    // ---------- 设置被回弹 ----------
    driftTitle: {
      zh: (p) => `上次的优化有 ${p.count} 项被改了回去（${tierName(p.tier)}）`,
      en: (p) => `${p.count} item(s) from your last tune-up were changed back (${tierName(p.tier)})`,
    },
    driftDetail: { zh: (p) => driftBody(p, 'zh'), en: (p) => driftBody(p, 'en') },
    driftTip: {
      zh: '点下面的「重新应用」一次改回来：只改清单里列出的这些项，其它一律不动，改前的值照样记进「记录与撤销」',
      en: 'Use the Re-apply button below to put them back in one go: only the items on this list change, everything else is left alone, and the previous values still go into "Changes & Undo"',
    },

    // ---------- 显卡 ----------
    vgpuTitle: { zh: '检测到 {count} 个虚拟显示适配器：{names}', en: '{count} virtual display adapter(s) detected: {names}' },
    vgpuDetail: {
      zh: (p) => '它们的设备路径是 ' + join(p.pnp, '，') + '，不是真实硬件。远程桌面类软件（Todesk / 向日葵 / Parsec）装的虚拟显卡会干扰显卡枚举，导致占用统计和驱动设置找错对象。',
      en: (p) => 'Their device paths are ' + join(p.pnp, ', ') + ' — not real hardware. Virtual GPUs installed by remote-desktop software (Todesk / Sunlogin / Parsec) pollute GPU enumeration, so usage stats and driver settings can end up aimed at the wrong device.',
    },
    vgpuTip: { zh: '本软件会自动优先选真实显卡；如果监控数据明显不对，可以在设备管理器里禁用这个虚拟适配器，或退出远程软件后重新读取', en: 'This app prefers real GPUs automatically; if the monitoring numbers look wrong, disable the virtual adapter in Device Manager, or quit the remote tool and read again' },
    gpuDriverTitle: { zh: '{name} 驱动 {driver}', en: '{name} driver {driver}' },
    gpuDriverDetail: {
      zh: (p) => '驱动日期 ' + (p.date || '未知') + (p.ageMonths != null ? `（约 ${p.ageMonths} 个月前）` : '') + `；当前输出 ${p.width}×${p.height}@${p.refresh}Hz。`,
      en: (p) => 'Driver date ' + (p.date || 'unknown') + (p.ageMonths != null ? ` (about ${p.ageMonths} months ago)` : '') + `; current output ${p.width}×${p.height}@${p.refresh}Hz.`,
    },
    gpuDriverOldTip: { zh: '驱动超过半年，新游戏可能有优化；用官方工具（NVIDIA App / AMD Adrenalin）更新，不要用来路不明的驱动管家', en: 'The driver is over six months old; newer ones often help in new games. Update with the official tool (NVIDIA App / AMD Adrenalin), never with a mystery "driver updater"' },

    // ---------- 启动项 / 系统 ----------
    startupTitle: { zh: '注册表开机自启 {n} 项（当前用户 {user}，所有用户 {all}）', en: '{n} registry autostart entries (current user {user}, all users {all})' },
    startupDetail: { zh: '这里只统计注册表 Run 键，启动文件夹和计划任务里的自启不算在内。', en: 'Only registry Run keys are counted here; the Startup folder and scheduled tasks are not included.' },
    startupTip: { zh: '到「启动项」页逐项确认，禁用前会自动备份原值', en: 'Confirm them one by one on the "Startup" page; original values are backed up before disabling' },
    osTitle: { zh: '{caption}（Build {build}）', en: '{caption} (Build {build})' },
    osDetail: {
      zh: (p) => (p.model || '') + (p.ram ? `；内存 ${p.ram}，当前空闲 ${p.free}` : ''),
      en: (p) => (p.model || '') + (p.ram ? `; memory ${p.ram}, ${p.free} free right now` : ''),
    },
  };

  function tv(v, p, lang) {
    if (v == null) return '';
    if (typeof v === 'function') return v(p || {}, lang);
    return String(v).replace(/\{(\w+)\}/g, (m, k) => (p && p[k] != null ? String(p[k]) : ''));
  }

  /** 单条 finding → 可显示文本。找不到模板就把 key 原样返回，测试和肉眼都能立刻发现漏了什么。 */
  function fmt(x, lang) {
    const L = lang === 'en' ? 'en' : 'zh';
    const get = (k) => (T[k] ? tv(T[k][L], x.params, L) : k);
    return {
      title: get(x.titleKey),
      detail: x.detailKey ? get(x.detailKey) : '',
      tip: x.tipKey ? get(x.tipKey) : '',
      group: (GROUP[x.group] || {})[L] || x.group || '',
      sev: (SEV[x.severity] || {})[L] || x.severity || '',
    };
  }

  function label(table, key, lang) {
    const L = lang === 'en' ? 'en' : 'zh';
    return (table[key] || {})[L] || key;
  }

  // 体检流程自身的提示（进度、取消、失败）也走这里，主进程只发 key
  const MSG = {
    collectFail: { zh: '体检数据采集失败', en: 'Failed to read the system facts' },
    elevate: { zh: '正在请求管理员授权…', en: 'Requesting administrator rights…' },
    analyze: { zh: '正在分析…', en: 'Analysing…' },
    deepCanceled: { zh: '已取消管理员授权，只显示普通权限能读到的部分', en: 'Authorisation cancelled — showing only what standard rights can read' },
    deepFail: { zh: '深度体检失败，只显示普通权限能读到的部分', en: 'The deep check failed — showing only what standard rights can read' },
    noResult: { zh: '还没有体检结果，请先跑一次体检', en: 'No health result yet — run a check first' },
    tipPrefix: { zh: '建议：', en: 'Advice: ' },
    driftReapply: (p, L) => (L === 'zh' ? `重新应用这 ${p.count} 项` : `Re-apply ${p.count} item(s)`),
    driftConfirmTitle: { zh: '把这些设置改回优化时的状态？', en: 'Put these settings back to the tuned state?' },
    driftConfirmDesc: {
      zh: (p) => `只修改下面列出的 ${p.count} 项，其它一律不动。含系统级开关时会弹一次管理员授权，个别项要重启才生效。`,
      en: (p) => `Only the ${p.count} items listed below change, everything else is left alone. System-level items trigger one administrator prompt, and a few only take effect after a reboot.`,
    },
    driftConfirmOk: { zh: '确认重新应用', en: 'Confirm re-apply' },
    reapplyStart: { zh: '正在重新应用…', en: 'Re-applying…' },
    reapplyDone: (p, L) => (L === 'zh' ? `已重新应用 ${p.count} 项，正在重新体检` : `Re-applied ${p.count} item(s), re-running the check`),
    reapplyUnchanged: { zh: '这些项又已经是对的状态了，没有改动', en: 'Those items were already correct again — nothing changed' },
    reapplyFail: { zh: '重新应用失败', en: 'Re-apply failed' },
  };

  /** 流程与按钮文本：值可以是 {zh,en}、纯字符串，也可以是接收 (params, lang) 的函数 */
  function msg(k, lang, p) {
    const L = lang === 'en' ? 'en' : 'zh';
    const v = MSG[k];
    if (v == null) return k;
    if (typeof v === 'function') return v(p || {}, L);
    if (typeof v === 'string') return v;
    return tv(v[L], p, L);
  }

  /** 体检弹窗顶部那行计数：模式 + 各严重度条数 */
  function summaryLine(res, lang) {
    const zh = (lang === 'en' ? false : true);
    const c = (res && res.counts) || {};
    const n = (k) => c[k] || 0;
    return zh
      ? `${res.quick ? '快速' : '深度'} · 风险 ${n('risk')} · 建议处理 ${n('warn')} · 供参考 ${n('info')} · 正常 ${n('good')}`
      : `${res.quick ? 'Quick' : 'Deep'} · ${n('risk')} risk · ${n('warn')} action advised · ${n('info')} info · ${n('good')} ok`;
  }

  /** 导出用的纯文本报告：和界面用同一套模板，切哪种语言就导出哪种语言 */
  function toText(res, lang) {
    const L = lang === 'en' ? 'en' : 'zh';
    const zh = L === 'zh';
    const lines = [];
    lines.push('RedVolt Lab ' + (zh ? '体检报告' : 'health report'));
    lines.push((zh ? '生成时间：' : 'Generated: ') + new Date().toLocaleString(zh ? 'zh-CN' : 'en-US'));
    lines.push((zh ? '模式：' : 'Mode: ') + (res.quick ? (zh ? '快速（普通权限）' : 'Quick (standard rights)') : (zh ? '深度（含管理员项）' : 'Deep (includes admin items)')));
    const c = res.counts || {};
    lines.push(zh
      ? `结论：风险 ${c.risk || 0} 项，建议处理 ${c.warn || 0} 项，供参考 ${c.info || 0} 项，正常 ${c.good || 0} 项`
      : `Summary: ${c.risk || 0} risk, ${c.warn || 0} action advised, ${c.info || 0} info, ${c.good || 0} ok`);
    lines.push('');
    const mark = { risk: zh ? '[风险]' : '[RISK]', warn: zh ? '[建议]' : '[WARN]', info: zh ? '[参考]' : '[INFO]', good: zh ? '[正常]' : '[OK]' };
    for (const x of res.findings || []) {
      const t = fmt(x, L);
      lines.push(`${mark[x.severity] || ''}【${t.group}】${t.title}`);
      if (t.detail) lines.push('    ' + String(t.detail).split('\n').join('\n    '));
      if (t.tip) lines.push('    ' + (zh ? '建议：' : 'Advice: ') + t.tip);
    }
    lines.push('');
    lines.push(zh ? '本报告为只读体检，未对系统做任何修改。' : 'This report is read-only; nothing on the system was modified.');
    return lines.join('\r\n');
  }

  return {
    GROUP: GROUP,
    SEV: SEV,
    MSG: MSG,
    TEMPLATES: T,
    fmt: fmt,
    msg: msg,
    groupLabel: (k, lang) => label(GROUP, k, lang),
    sevLabel: (k, lang) => label(SEV, k, lang),
    summaryLine: summaryLine,
    toText: toText,
    driftRows: driftRows,
  };
});
