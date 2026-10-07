'use strict';
// 只读体检报告：把系统事实翻译成「问题 + 严重度 + 建议」，不改任何设置。
// 深度项（组件存储 / TRIM / 还原点 / 驱动库 / 启动诊断日志）需要管理员，一次 UAC 全部读完。
// 事实采集全部在 PowerShell 脚本里做（ASCII 输出），中文措辞与判定规则集中在这里，便于测试。
const path = require('path');
const { runScript, parseJson } = require('./ps');
const { runElevated } = require('./admin');

const USER_SCRIPT = path.join(__dirname, 'ps', 'health-user.ps1');
const ADMIN_SCRIPT = path.join(__dirname, 'ps', 'health-admin.ps1');

const GB = 1073741824;

function gb(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n)) return '—';
  return (n / GB).toFixed(n >= 10 * GB ? 1 : 2) + ' GB';
}

function mb(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n)) return '—';
  return (n / 1048576).toFixed(n >= 1024 ? 0 : 1) + ' MB';
}

function pct(free, size) {
  const f = Number(free); const s = Number(size);
  if (!Number.isFinite(f) || !Number.isFinite(s) || !s) return null;
  return (f / s) * 100;
}

function svc(facts, name) {
  const s = (facts.services || []).filter((x) => x.name === name)[0];
  return s || null;
}

function hoursSince(iso) {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? (Date.now() - t) / 3600000 : null;
}

function f(id, group, severity, title, detail, tip) {
  return { id, group, severity, title, detail: detail || '', tip: tip || '' };
}

/**
 * 纯函数：事实 → 结论。深度事实缺失时自动降级，只报能确定的部分。
 * severity: good 正常 / info 供参考 / warn 建议处理 / risk 有风险
 */
function report(facts) {
  const out = [];
  const q = facts || {};
  const deep = q.deep || null;

  // ---------- 空间 ----------
  const c = (q.disks || []).filter((d) => d.letter === 'C:')[0] || (q.disks || [])[0];
  if (c) {
    const p = pct(c.free, c.size);
    const title = `${c.letter} 可用 ${gb(c.free)}（共 ${gb(c.size)}，剩 ${p == null ? '—' : p.toFixed(0) + '%'}）`;
    if (p != null && p < 10) out.push(f('disk-crit', '空间', 'risk', title, '剩余空间低于 10%，Windows 更新、页面文件扩展和程序缓存都可能失败。', '先跑一次磁盘清理，再看下面的「可回收空间」条目'));
    else if (p != null && p < 20) out.push(f('disk-low', '空间', 'warn', title, '剩余空间偏紧，系统盘建议长期保留 15% 以上。', '看下面的组件存储 / 页面文件 / 更新残留条目'));
    else out.push(f('disk-ok', '空间', 'good', title, '系统盘空间充足。'));
  }

  const phys = q.physical || [];
  if (phys.length) {
    const multi = phys.filter((p) => (p.letters || []).length > 1);
    for (const p of multi) {
      out.push(f('same-disk', '空间', 'info',
        `${(p.letters || []).join(' 盘与 ')} 盘在同一块物理盘上（${p.name}）`,
        '它们是同一块硬盘上的两个分区，清理其中一个不会给另一个腾出空间；总容量也是共享的。',
        '要腾 C 盘就清 C 盘上的东西，别指望清 D 盘'));
    }
    const ssd = phys.filter((p) => /ssd/i.test(p.media || ''));
    if (ssd.length === phys.length) out.push(f('media-ssd', '空间', 'good', '全部物理盘都是 SSD', `介质类型：${phys.map((p) => p.media + '/' + p.bus).join('，')}；不需要也不应该做传统碎片整理。`));
    const bad = phys.filter((p) => p.health && !/healthy|ok/i.test(p.health));
    for (const p of bad) out.push(f('media-health', '空间', 'risk', `硬盘健康状态异常：${p.name} = ${p.health}`, '存储子系统报告的不是 Healthy，可能有坏块或寿命问题。', '尽快备份重要数据，并用厂商工具（如 CrystalDiskInfo）复查 SMART'));
  }

  const pf = q.pagefiles || [];
  if (pf.length) {
    const total = pf.reduce((s, x) => s + (Number(x.allocatedMB) || 0), 0);
    const onC = pf.filter((x) => /^C:/i.test(x.name || '')).reduce((s, x) => s + (Number(x.allocatedMB) || 0), 0);
    if (total >= 8192) {
      out.push(f('pagefile', '空间', 'info',
        `页面文件共 ${(total / 1024).toFixed(1)} GB（C 盘占 ${(onC / 1024).toFixed(1)} GB）`,
        `实际使用 ${pf.map((x) => x.name + ' ' + (x.usedMB || 0) + ' MB').join('；')}。${q.pagefileAuto ? '当前是「系统自动管理」。' : '当前是手动指定大小。'}页面文件是内存不够时的溢出空间，直接关掉可能导致程序崩溃。`,
        onC >= 8192 ? 'C 盘吃紧时可以把页面文件整体挪到其它盘，或把 C 盘的初始值调小（不要设为 0）' : '空间够的话不建议动它'));
    }
  }

  if (deep && deep.winsxs && deep.winsxs.ok) {
    const w = deep.winsxs;
    if (w.recommended && Number(w.backups) > 512 * 1048576) {
      out.push(f('winsxs', '空间', 'warn',
        `组件存储可回收约 ${gb(w.backups)}（WinSxS 实际 ${gb(w.actual)}）`,
        `DISM 判定「建议清理」，可回收包 ${w.reclaimable == null ? '—' : w.reclaimable} 个；上次清理 ${w.lastCleanup || '未知'}。与 Windows 共享的 ${gb(w.shared)} 是硬链接，本来就不额外占空间。`,
        '到「系统级清理」里跑组件存储清理；勾选 /ResetBase 会多回收一些，但之后已装的更新将无法卸载'));
    } else {
      out.push(f('winsxs', '空间', 'good',
        `组件存储 ${gb(w.actual)}，暂不需要清理`,
        `可回收包 ${w.reclaimable == null ? '—' : w.reclaimable} 个，DISM 判定「不建议清理」；上次清理 ${w.lastCleanup || '未知'}。`));
    }
  } else if (deep && deep.winsxs && !deep.winsxs.ok) {
    const na = !!deep.winsxs.needsAdmin;
    out.push(f('winsxs', '空间', 'info',
      na ? '组件存储没读到：DISM 拒绝执行' : '组件存储分析失败',
      na
        ? 'DISM 返回错误 740（需要管理员权限），即使本次已提权仍被拒绝，通常是被组策略或精简系统挡掉了。读不到就不报数字，绝不猜。'
        : 'DISM 没有返回可解析的结果，可能是组件存储损坏或 DISM 被精简。',
      '可在管理员命令行手动跑 dism /online /cleanup-image /scanhealth 看具体报错'));
  }

  if (deep && Array.isArray(deep.leftovers)) {
    const big = deep.leftovers.filter((x) => x.exists && Number(x.bytes) > 100 * 1048576);
    if (big.length) {
      const total = big.reduce((s, x) => s + Number(x.bytes || 0), 0);
      out.push(f('leftovers', '空间', 'info',
        `系统自身还有 ${big.length} 处可回收，合计 ${mb(total)}`,
        big.map((x) => `${x.path} = ${mb(x.bytes)}`).join('\n'),
        '这些都能在「系统级清理」里清；Windows.old 和 $WINDOWS.~BT 是大版本升级残留，确认新系统稳定后可删'));
    }
  }

  if (deep && deep.driverCount != null) {
    const dupes = deep.driverDuplicates || [];
    const oldCount = dupes.reduce((s, g) => s + (g.old || []).length, 0);
    if (oldCount) {
      out.push(f('drivers', '空间', 'info',
        `驱动库里有 ${dupes.length} 组重复驱动，共 ${oldCount} 个旧版本`,
        dupes.slice(0, 6).map((g) => `${g.orig}：保留 ${g.keep}（${g.keepVersion || '?'} ${g.keepDate || ''}），旧版 ${g.old.join('、')}`).join('\n'),
        '旧版本驱动包可以在「系统级清理」里勾选删除；删错了设备会回退到系统自带驱动，一般不会变砖'));
    } else {
      out.push(f('drivers', '空间', 'good', `第三方驱动 ${deep.driverCount} 个，没有发现重复的旧版本`, ''));
    }
  }

  if (deep && deep.restore) {
    const r = deep.restore;
    if (r.readable === false || r.count == null) {
      out.push(f('restore', '空间', 'info', '还原点状态读不到',
        '系统没有把还原点列表交给本次体检（权限不足或还原点组件被精简），所以这里不下结论，也不代表你没有还原点。',
        '在「记录与撤销」页点「还原点状态」，单独授权一次就能看到真实情况'));
    } else if (r.disabled) out.push(f('restore', '空间', 'warn', '系统保护已关闭', '当前没有任何还原点可用，出问题只能靠本软件的变更账本回滚。', '在「系统属性 → 系统保护」里为 C 盘启用，并给卷影存储分配 5% 左右'));
    else if (!r.count) out.push(f('restore', '空间', 'warn', '系统保护开着，但一个还原点都没有', '可能是刚启用，也可能是精简系统移除了创建组件。', '在「记录与撤销」页点「立即创建还原点」试一次，失败原因会如实显示'));
    else {
      const sh = r.shadow;
      out.push(f('restore', '空间', 'good',
        `有 ${r.count} 个还原点，最近一个：${r.last ? (r.last.description || '（无描述）') + ' @ ' + String(r.last.at).slice(0, 16).replace('T', ' ') : '未知'}`,
        sh && sh.max ? `卷影存储上限 ${gb(sh.max)}，已用 ${gb(sh.used)}；按每个还原点约 1 GB 算，大概还能存 ${Math.max(0, Math.floor((sh.max - sh.used) / GB))} 个。` : ''));
    }
  }

  if (deep && Array.isArray(deep.failed) && deep.failed.length) {
    const NAME = {
      admin: '管理员身份', winsxs: '组件存储（DISM）', trim: 'TRIM 状态', restore: '还原点',
      'restore-points': '还原点列表', 'restore-config': '系统保护配置', 'shadow-storage': '卷影存储用量',
      leftovers: '系统残留体积', drivers: '第三方驱动库', boot: '启动诊断日志',
      'boot-perf': '启动诊断日志', 'boot-kernel': '内核启动记录', 'boot-crash': '异常关机记录',
    };
    // 脚本回传的是稳定的 ASCII 代码（异常文本会随系统语言变），在这里翻成人话
    const REASON = {
      'access-denied': '权限不够，读不到',
      'log-absent': '这个日志在本机不存在（可能被精简，或相关服务没启用）',
      'no-events': '没有匹配的记录',
      'vssadmin-no-numbers': 'vssadmin 没给出可用数字（通常是权限不够）',
      'fsutil-no-output': 'fsutil 没有输出',
      'pnputil-no-packages': 'pnputil 没列出驱动包',
    };
    out.push(f('deep-failed', '系统', 'info',
      `深度体检有 ${deep.failed.length} 项没读到`,
      deep.failed.map((x) => `${NAME[x.section] || x.section}：${REASON[x.error] || x.error || '未知原因'}`).join('\n'),
      '读不到就不下结论，也不猜，其余各项照常给出；多数情况是权限或日志被精简，不影响本软件其它功能'));
  }

  // ---------- 性能 ----------
  const dps = svc(q, 'DPS');
  // 日志读不到时不能拿 dpsEvents=false 当「确实没有记录」，否则会说出不成立的结论
  const bootReadable = deep && deep.boot && deep.boot.readable ? deep.boot.readable : null;
  const bootEvents = deep && deep.boot ? (bootReadable && !bootReadable.perf ? null : deep.boot.dpsEvents) : null;
  if (dps && /disabled|stopped/i.test(String(dps.startType) + String(dps.status)) && bootEvents === false) {
    out.push(f('boot-diag', '性能', 'warn',
      '系统自带的启动诊断已停止记录',
      `诊断策略服务（DPS）当前是 ${dps.status}/${dps.startType}，所以拿不到官方的「开机耗时 / 哪个程序拖慢了启动」数据，事件日志里只剩历史记录。`,
      '想要精确的开机耗时分析，需要把 DPS 服务改回「自动」并重启一次；本软件不擅自改服务状态'));
  } else if (bootEvents) {
    const e100 = ((deep.boot.events || []).filter((x) => x.id === 100))[0];
    if (e100) {
      const bt = (e100.data || []).filter((d) => /boot/i.test(d.n))[0];
      out.push(f('boot-diag', '性能', 'info',
        `最近一次开机耗时 ${bt ? (Number(bt.v) / 1000).toFixed(1) + ' 秒' : '（数据不完整）'}`,
        `事件时间 ${String(e100.at).slice(0, 19).replace('T', ' ')}；字段：${(e100.data || []).map((d) => d.n + '=' + d.v).join(', ').slice(0, 200)}`,
        '启动诊断日志（Diagnostics-Performance）由 DPS 服务写入，可在「系统信息」里看历史趋势'));
    }
  }

  if (deep && deep.boot && deep.boot.unexpectedShutdowns > 0) {
    out.push(f('crash-boot', '性能', 'warn',
      `最近 30 天有 ${deep.boot.unexpectedShutdowns} 次异常关机`,
      '系统日志 Event 6008：上一次关机不是正常流程（断电、死机、强制重启）。频繁出现通常指向电源、驱动或超频不稳。',
      '配合「显卡优化」里的驱动版本和事件查看器里的 WHEA 错误一起排查'));
  } else if (deep && deep.boot && deep.boot.readable && deep.boot.readable.crash && deep.boot.unexpectedShutdowns === 0) {
    out.push(f('crash-boot', '性能', 'good', '最近 30 天没有异常关机记录',
      '系统日志里查不到 Event 6008，说明这段时间的关机和重启都走完了正常流程。'));
  }

  if (q.os && q.os.uptimeSec != null) {
    const h = q.os.uptimeSec / 3600;
    if (h > 72) out.push(f('uptime', '性能', 'info', `已连续开机 ${h.toFixed(0)} 小时`, '长时间不重启会积累内存碎片、句柄泄漏和驱动状态残留，很多「越用越卡」重启就好。', '方便时重启一次；注意快速启动开启时「关机」并不等于完整重启'));
  }

  if (Array.isArray(deep && deep.trim) && deep.trim.length) {
    const off = deep.trim.filter((t) => t.disabled);
    if (off.length) out.push(f('trim', '性能', 'risk', `TRIM 被禁用（${off.map((t) => t.fs).join('、')}）`, 'SSD 收不到 TRIM 就无法回收已删除的块，长期写入会明显掉速并缩短寿命。', '管理员命令行执行 fsutil behavior set DisableDeleteNotify 0'));
    else out.push(f('trim', '性能', 'good', `TRIM 正常启用（${deep.trim.map((t) => t.fs).join('、')}）`, 'SSD 可以正常回收已删除的数据块。'));
  }

  if (q.tweaks) {
    const t = q.tweaks;
    if (Number(t.hags) === 2) out.push(f('hags', '性能', 'good', '硬件加速 GPU 计划（HAGS）已开启', 'HwSchMode=2，由显卡直接管理显存调度，多数游戏下延迟更低。', '若遇到个别游戏掉帧或录屏异常，可在「游戏开关」里关掉后重启对比'));
    else if (Number(t.hags) === 1) out.push(f('hags', '性能', 'info', '硬件加速 GPU 计划（HAGS）已关闭', 'HwSchMode=1，由系统管理显存调度。', '在「游戏开关」里可以打开，改完需要重启电脑才生效'));
    const dvrOff = Number(t.gamedvr) === 0 && Number(t.appCapture) === 0;
    if (dvrOff) out.push(f('gamedvr', '性能', 'good', 'Game DVR / 后台录制已关闭', '不会在游戏时偷偷占用 GPU 编码器和磁盘。'));
    else out.push(f('gamedvr', '性能', 'info', 'Game DVR / 后台录制处于开启状态', `GameDVR_Enabled=${t.gamedvr}，AppCaptureEnabled=${t.appCapture}。后台录制会持续占用 GPU 编码器。`, '在「游戏开关」里可以一键关掉'));
  }

  // ---------- 系统 / 安全 ----------
  const wu = svc(q, 'wuauserv');
  if (wu && /disabled/i.test(String(wu.startType))) {
    out.push(f('wu', '系统', 'info', 'Windows Update 服务已停用', '系统不会自动下载安装更新，更新缓存也就不会自己堆积。代价是安全补丁需要手动处理。', '改版系统（AtlasOS 等）常这样做；想收补丁就把服务改回手动并手动检查更新'));
  }
  const dt = svc(q, 'DiagTrack');
  if (dt && /disabled/i.test(String(dt.startType))) out.push(f('telemetry', '系统', 'good', '遥测服务（DiagTrack）已禁用', '不会向微软上报使用数据。'));

  if (q.defender) {
    if (!q.defender.present) out.push(f('defender', '系统', 'info', '本机没有 Windows Defender', '读不到 Defender 状态，说明精简系统已把它移除。系统级实时病毒防护目前是空的，安全性由你自己的使用习惯承担。', '如果需要防护，装一个第三方杀软比重新塞回 Defender 更省事'));
    else if (!q.defender.realtime) out.push(f('defender', '系统', 'warn', 'Defender 实时保护已关闭', `AntivirusEnabled=${q.defender.antivirus}，TamperProtection=${q.defender.tamper}。`, '非刻意为之的话建议打开；刻意关闭的（精简系统/性能考虑）可以忽略这条'));
    else out.push(f('defender', '系统', 'good', 'Defender 实时保护正常', q.defender.signatureAgeHours != null ? `病毒库龄 ${q.defender.signatureAgeHours} 小时。` : ''));
  }

  if (q.hibernate) {
    const h = q.hibernate;
    if (!h.hiberfilExists && Number(h.hiberboot) !== 1) {
      out.push(f('fastboot', '系统', 'info', '快速启动已关闭（休眠未启用）', '没有 hiberfil.sys，所以「快速启动」不可用，每次开机都是完整冷启动。开机稍慢，但驱动状态干净、不容易积累怪问题。', '想省 C 盘空间就别开休眠；想开机更快可以 powercfg /h on，代价是多占约等于内存大小的空间'));
    } else if (h.hiberfilExists && Number(h.hiberboot) === 1) {
      out.push(f('fastboot', '系统', 'info', '快速启动已开启', '「关机」实际是写入休眠文件再恢复，驱动和内核状态不会重置。遇到奇怪问题时请用「重启」而不是「关机再开」。', '追求稳定可以关掉快速启动'));
    }
  }

  // ---------- 显卡 ----------
  const gpus = q.gpus || [];
  const virt = gpus.filter((g) => g.virtual);
  const real = gpus.filter((g) => !g.virtual);
  if (virt.length) {
    out.push(f('vgpu', '显卡', 'warn',
      `检测到 ${virt.length} 个虚拟显示适配器：${virt.map((g) => g.name).join('、')}`,
      `它们的设备路径是 ${virt.map((g) => g.pnp).join('，')}，不是真实硬件。远程桌面类软件（Todesk / 向日葵 / Parsec）装的虚拟显卡会干扰显卡枚举，导致占用统计和驱动设置找错对象。`,
      '本软件会自动优先选真实显卡；如果监控数据明显不对，可以在设备管理器里禁用这个虚拟适配器，或退出远程软件后重新读取'));
  }
  for (const g of real) {
    const age = hoursSince(g.driverDate);
    out.push(f('gpu-driver', '显卡', 'info',
      `${g.name} 驱动 ${g.driver || '未知'}`,
      `驱动日期 ${g.driverDate ? String(g.driverDate).slice(0, 10) : '未知'}${age != null ? `（约 ${Math.round(age / 24 / 30)} 个月前）` : ''}；当前输出 ${g.width}×${g.height}@${g.refresh}Hz。`,
      age != null && age > 24 * 180 ? '驱动超过半年，新游戏可能有优化；用官方工具（NVIDIA App / AMD Adrenalin）更新，不要用来路不明的驱动管家' : ''));
  }

  // ---------- 启动项 ----------
  if (q.startup) {
    const n = (Number(q.startup.hkcRun) || 0) + (Number(q.startup.hklmRun) || 0);
    out.push(f('startup', '启动', n > 12 ? 'info' : 'good',
      `注册表开机自启 ${n} 项（当前用户 ${q.startup.hkcRun}，所有用户 ${q.startup.hklmRun}）`,
      '这里只统计注册表 Run 键，启动文件夹和计划任务里的自启不算在内。',
      n > 12 ? '到「启动项」页逐项确认，禁用前会自动备份原值' : ''));
  }

  if (q.os) {
    out.push(f('os', '系统', 'info',
      `${q.os.caption}（Build ${q.os.build}）`,
      `${q.os.manufacturer || ''} ${q.os.model || ''}`.trim() + (q.os.ramTotal ? `；内存 ${gb(q.os.ramTotal)}，当前空闲 ${gb(q.os.ramFree)}` : ''),
      ''));
  }

  const order = { risk: 0, warn: 1, info: 2, good: 3 };
  out.sort((a, b) => (order[a.severity] - order[b.severity]));
  const counts = { risk: 0, warn: 0, info: 0, good: 0 };
  for (const x of out) counts[x.severity] = (counts[x.severity] || 0) + 1;
  return { ok: true, findings: out, counts, deep: !!deep };
}

/** 快速体检：只用普通权限，几秒出结果，不弹 UAC */
async function quick() {
  const r = await runScript('health-user.ps1', [], 120000);
  const data = parseJson(r.stdout);
  if (!data) return { ok: false, message: r.stderr || '体检数据采集失败' };
  const rep = report(data);
  return { ok: true, quick: true, facts: data, ...rep };
}

/** 深度体检：先读普通权限的事实，再一次 UAC 读完需要管理员的部分 */
async function deep(onProgress) {
  const base = await quick();
  if (!base.ok) return base;
  if (typeof onProgress === 'function') onProgress({ phase: 'elevate', message: '正在请求管理员授权…' });
  const r = await runElevated(ADMIN_SCRIPT, { action: 'scan' }, 600000);
  if (r.canceled) return { ...base, message: '已取消管理员授权，只显示普通权限能读到的部分' };
  if (!r.data) return { ...base, message: r.stderr || '深度体检失败，只显示普通权限能读到的部分' };
  if (typeof onProgress === 'function') onProgress({ phase: 'analyze', message: '正在分析…' });
  const facts = { ...base.facts, deep: r.data };
  const rep = report(facts);
  return { ok: true, quick: false, facts, ...rep, message: r.data.ok === false ? (r.data.error || '') : '' };
}

/** 导出成纯文本报告（用户可保存/发给别人） */
function toText(res) {
  const lines = [];
  lines.push('RedVolt Lab 体检报告');
  lines.push('生成时间：' + new Date().toLocaleString('zh-CN'));
  lines.push('模式：' + (res.quick ? '快速（普通权限）' : '深度（含管理员项）'));
  lines.push(`结论：风险 ${res.counts.risk} 项，建议处理 ${res.counts.warn} 项，供参考 ${res.counts.info} 项，正常 ${res.counts.good} 项`);
  lines.push('');
  const mark = { risk: '[风险]', warn: '[建议]', info: '[参考]', good: '[正常]' };
  for (const x of res.findings) {
    lines.push(`${mark[x.severity] || ''}【${x.group}】${x.title}`);
    if (x.detail) lines.push('    ' + String(x.detail).split('\n').join('\n    '));
    if (x.tip) lines.push('    建议：' + x.tip);
  }
  lines.push('');
  lines.push('本报告为只读体检，未对系统做任何修改。');
  return lines.join('\r\n');
}

module.exports = { quick, deep, report, toText, gb, mb };
