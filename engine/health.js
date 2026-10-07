'use strict';
// 只读体检报告：把系统事实翻译成「判定 + 数据」，不改任何设置。
// 深度项（组件存储 / TRIM / 还原点 / 驱动库 / 启动诊断日志）需要管理员，一次 UAC 全部读完。
// 事实采集全部在 PowerShell 脚本里做（ASCII 输出），判定规则集中在这里。
// 这里只输出 ASCII 的文案 key + 已格式化的数据；说成中文还是英文由渲染层的 health-text.js 负责，
// 因为界面语言只有渲染层知道，导出的文本报告也要跟着界面语言走。
const path = require('path');
const { runScript, parseJson } = require('./ps');
const { runElevated } = require('./admin');
const tiers = require('./tiers');

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

// params 给标题模板，dparams 给详情模板，两者合并成一份数据交给渲染层（键名不重叠）
function f(id, group, severity, titleKey, params, detailKey, tipKey, dparams) {
  return {
    id, group, severity, titleKey,
    params: Object.assign({}, params, dparams),
    detailKey: detailKey || '', tipKey: tipKey || '',
  };
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
    const title = { letter: c.letter, free: gb(c.free), size: gb(c.size), pct: p == null ? '—' : p.toFixed(0) + '%' };
    if (p != null && p < 10) out.push(f('disk-crit', 'space', 'risk', 'diskTitle', title, 'diskCritDetail', 'diskCritTip'));
    else if (p != null && p < 20) out.push(f('disk-low', 'space', 'warn', 'diskTitle', title, 'diskLowDetail', 'diskLowTip'));
    else out.push(f('disk-ok', 'space', 'good', 'diskTitle', title, 'diskOkDetail'));
  }

  const phys = q.physical || [];
  if (phys.length) {
    const multi = phys.filter((p) => (p.letters || []).length > 1);
    for (const p of multi) {
      out.push(f('same-disk', 'space', 'info', 'sameDiskTitle', { letters: p.letters, name: p.name }, 'sameDiskDetail', 'sameDiskTip'));
    }
    const ssd = phys.filter((p) => /ssd/i.test(p.media || ''));
    if (ssd.length === phys.length) {
      out.push(f('media-ssd', 'space', 'good', 'ssdAllTitle', null, 'ssdAllDetail', null,
        { kinds: phys.map((p) => p.media + '/' + p.bus) }));
    }
    const bad = phys.filter((p) => p.health && !/healthy|ok/i.test(p.health));
    for (const p of bad) out.push(f('media-health', 'space', 'risk', 'diskHealthTitle', { name: p.name, health: p.health }, 'diskHealthDetail', 'diskHealthTip'));
  }

  const pf = q.pagefiles || [];
  if (pf.length) {
    const total = pf.reduce((s, x) => s + (Number(x.allocatedMB) || 0), 0);
    const onC = pf.filter((x) => /^C:/i.test(x.name || '')).reduce((s, x) => s + (Number(x.allocatedMB) || 0), 0);
    if (total >= 8192) {
      out.push(f('pagefile', 'space', 'info', 'pagefileTitle',
        { total: (total / 1024).toFixed(1) + ' GB', onC: (onC / 1024).toFixed(1) + ' GB' },
        'pagefileDetail', onC >= 8192 ? 'pagefileMoveTip' : 'pagefileKeepTip',
        { usage: pf.map((x) => ({ name: x.name, used: (x.usedMB || 0) + ' MB' })), auto: !!q.pagefileAuto }));
    }
  }

  if (deep && deep.winsxs && deep.winsxs.ok) {
    const w = deep.winsxs;
    const reclaimable = w.reclaimable == null ? '—' : w.reclaimable;
    const lastCleanup = w.lastCleanup || '—';
    if (w.recommended && Number(w.backups) > 512 * 1048576) {
      out.push(f('winsxs', 'space', 'warn', 'winsxsWarnTitle',
        { backups: gb(w.backups), actual: gb(w.actual) },
        'winsxsWarnDetail', 'winsxsWarnTip',
        { reclaimable, lastCleanup, shared: gb(w.shared) }));
    } else {
      out.push(f('winsxs', 'space', 'good', 'winsxsGoodTitle', { actual: gb(w.actual) }, 'winsxsGoodDetail', null,
        { reclaimable, lastCleanup }));
    }
  } else if (deep && deep.winsxs && !deep.winsxs.ok) {
    const na = !!deep.winsxs.needsAdmin;
    out.push(f('winsxs', 'space', 'info',
      na ? 'winsxsNaAdminTitle' : 'winsxsNaFailTitle', null,
      na ? 'winsxsNaAdminDetail' : 'winsxsNaFailDetail', 'winsxsNaTip'));
  }

  if (deep && Array.isArray(deep.leftovers)) {
    const big = deep.leftovers.filter((x) => x.exists && Number(x.bytes) > 100 * 1048576);
    if (big.length) {
      const total = big.reduce((s, x) => s + Number(x.bytes || 0), 0);
      out.push(f('leftovers', 'space', 'info', 'leftoversTitle', { count: big.length, total: mb(total) }, 'leftoversDetail', 'leftoversTip',
        { items: big.map((x) => ({ path: x.path, size: mb(x.bytes) })) }));
    }
  }

  if (deep && deep.driverCount != null) {
    const dupes = deep.driverDuplicates || [];
    const oldCount = dupes.reduce((s, g) => s + (g.old || []).length, 0);
    if (oldCount) {
      out.push(f('drivers', 'space', 'info', 'driversDupTitle', { groups: dupes.length, oldCount }, 'driversDupDetail', 'driversDupTip',
        { items: dupes.slice(0, 6) }));
    } else {
      out.push(f('drivers', 'space', 'good', 'driversOkTitle', { count: deep.driverCount }));
    }
  }

  if (deep && deep.restore) {
    const r = deep.restore;
    if (r.readable === false || r.count == null) {
      out.push(f('restore', 'space', 'info', 'restoreNaTitle', null, 'restoreNaDetail', 'restoreNaTip'));
    } else if (r.disabled) out.push(f('restore', 'space', 'warn', 'restoreOffTitle', null, 'restoreOffDetail', 'restoreOffTip'));
    else if (!r.count) out.push(f('restore', 'space', 'warn', 'restoreNoneTitle', null, 'restoreNoneDetail', 'restoreNoneTip'));
    else {
      const sh = r.shadow;
      out.push(f('restore', 'space', 'good', 'restoreOkTitle',
        { count: r.count, desc: r.last ? r.last.description || '' : '', at: r.last ? String(r.last.at).slice(0, 16).replace('T', ' ') : '' },
        'restoreOkDetail', null,
        sh && sh.max ? { max: gb(sh.max), used: gb(sh.used), room: Math.max(0, Math.floor((sh.max - sh.used) / GB)) } : null));
    }
  }

  if (deep && Array.isArray(deep.failed) && deep.failed.length) {
    // 脚本回传的是稳定的 ASCII 代码（异常文本会随系统语言变），翻成人话在渲染层
    out.push(f('deep-failed', 'system', 'info', 'deepFailedTitle', { count: deep.failed.length }, 'deepFailedDetail', 'deepFailedTip',
      { items: deep.failed.map((x) => ({ section: x.section, error: x.error })) }));
  }

  // ---------- 性能 ----------
  const dps = svc(q, 'DPS');
  // 日志读不到时不能拿 dpsEvents=false 当「确实没有记录」，否则会说出不成立的结论
  const bootReadable = deep && deep.boot && deep.boot.readable ? deep.boot.readable : null;
  const bootEvents = deep && deep.boot ? (bootReadable && !bootReadable.perf ? null : deep.boot.dpsEvents) : null;
  if (dps && /disabled|stopped/i.test(String(dps.startType) + String(dps.status)) && bootEvents === false) {
    out.push(f('boot-diag', 'perf', 'warn', 'bootDiagOffTitle', { status: dps.status, startType: dps.startType }, 'bootDiagOffDetail', 'bootDiagOffTip'));
  } else if (bootEvents) {
    const e100 = ((deep.boot.events || []).filter((x) => x.id === 100))[0];
    if (e100) {
      const bt = (e100.data || []).filter((d) => /boot/i.test(d.n))[0];
      out.push(f('boot-diag', 'perf', 'info',
        bt ? 'bootTimeTitle' : 'bootTimeIncompleteTitle',
        { secs: bt ? (Number(bt.v) / 1000).toFixed(1) + ' s' : '' },
        'bootTimeDetail', 'bootTimeTip',
        {
          at: String(e100.at).slice(0, 19).replace('T', ' '),
          fields: (e100.data || []).map((d) => d.n + '=' + d.v).join(', ').slice(0, 200),
        }));
    }
  }

  if (deep && deep.boot && deep.boot.unexpectedShutdowns > 0) {
    out.push(f('crash-boot', 'perf', 'warn', 'crashTitle', { count: deep.boot.unexpectedShutdowns }, 'crashDetail', 'crashTip'));
  } else if (deep && deep.boot && deep.boot.readable && deep.boot.readable.crash && deep.boot.unexpectedShutdowns === 0) {
    out.push(f('crash-boot', 'perf', 'good', 'crashOkTitle', null, 'crashOkDetail'));
  }

  if (q.os && q.os.uptimeSec != null) {
    const h = q.os.uptimeSec / 3600;
    if (h > 72) out.push(f('uptime', 'perf', 'info', 'uptimeTitle', { hours: h.toFixed(0) + ' h' }, 'uptimeDetail', 'uptimeTip'));
  }

  if (Array.isArray(deep && deep.trim) && deep.trim.length) {
    const off = deep.trim.filter((t) => t.disabled);
    const fs = deep.trim.map((t) => t.fs);
    if (off.length) out.push(f('trim', 'perf', 'risk', 'trimOffTitle', { fs: off.map((t) => t.fs).join(', ') }, 'trimOffDetail', 'trimOffTip'));
    else out.push(f('trim', 'perf', 'good', 'trimOkTitle', { fs: fs.join(', ') }, 'trimOkDetail'));
  }

  if (q.tweaks) {
    const t = q.tweaks;
    if (Number(t.hags) === 2) out.push(f('hags', 'perf', 'good', 'hagsOnTitle', null, 'hagsOnDetail', 'hagsOnTip'));
    else if (Number(t.hags) === 1) out.push(f('hags', 'perf', 'info', 'hagsOffTitle', null, 'hagsOffDetail', 'hagsOffTip'));
    const dvrOff = Number(t.gamedvr) === 0 && Number(t.appCapture) === 0;
    if (dvrOff) out.push(f('gamedvr', 'perf', 'good', 'dvrOffTitle', null, 'dvrOffDetail'));
    else out.push(f('gamedvr', 'perf', 'info', 'dvrOnTitle', { gamedvr: t.gamedvr, appCapture: t.appCapture }, 'dvrOnDetail', 'dvrOnTip'));
  }

  // ---------- 系统 / 安全 ----------
  const wu = svc(q, 'wuauserv');
  if (wu && /disabled/i.test(String(wu.startType))) {
    out.push(f('wu', 'system', 'info', 'wuTitle', null, 'wuDetail', 'wuTip'));
  }
  const dt = svc(q, 'DiagTrack');
  if (dt && /disabled/i.test(String(dt.startType))) out.push(f('telemetry', 'system', 'good', 'telemetryTitle', null, 'telemetryDetail'));

  if (q.defender) {
    if (!q.defender.present) out.push(f('defender', 'system', 'info', 'defAbsentTitle', null, 'defAbsentDetail', 'defAbsentTip'));
    else if (!q.defender.realtime) out.push(f('defender', 'system', 'warn', 'defOffTitle', { antivirus: q.defender.antivirus, tamper: q.defender.tamper }, 'defOffDetail', 'defOffTip'));
    else out.push(f('defender', 'system', 'good', 'defOkTitle', { age: q.defender.signatureAgeHours }, 'defOkDetail'));
  }

  if (q.hibernate) {
    const h = q.hibernate;
    if (!h.hiberfilExists && Number(h.hiberboot) !== 1) {
      out.push(f('fastboot', 'system', 'info', 'fastbootOffTitle', null, 'fastbootOffDetail', 'fastbootOffTip'));
    } else if (h.hiberfilExists && Number(h.hiberboot) === 1) {
      out.push(f('fastboot', 'system', 'info', 'fastbootOnTitle', null, 'fastbootOnDetail', 'fastbootOnTip'));
    }
  }

  // ---------- 设置被回弹 ----------
  // 只查本软件写过的：有档位快照才谈得上「应该是什么样」，没优化过就一条都不报
  if (q.drift && ((q.drift.game || []).length || (q.drift.gpu || []).length)) {
    const d = q.drift;
    const n = (d.game || []).length + (d.gpu || []).length;
    const x = f('drift', 'system', 'warn', 'driftTitle', { count: n, tier: d.tier }, 'driftDetail', 'driftTip',
      { game: d.game || [], gpu: d.gpu || [] });
    x.action = { kind: 'tierReapply', tier: d.tier, at: d.at };
    out.push(x);
  }

  // ---------- 显卡 ----------
  const gpus = q.gpus || [];
  const virt = gpus.filter((g) => g.virtual);
  const real = gpus.filter((g) => !g.virtual);
  if (virt.length) {
    out.push(f('vgpu', 'gpu', 'warn', 'vgpuTitle', { count: virt.length, names: virt.map((g) => g.name).join(', ') }, 'vgpuDetail', 'vgpuTip',
      { pnp: virt.map((g) => g.pnp) }));
  }
  for (const g of real) {
    const age = hoursSince(g.driverDate);
    out.push(f('gpu-driver', 'gpu', 'info', 'gpuDriverTitle', { name: g.name, driver: g.driver || '—' }, 'gpuDriverDetail',
      age != null && age > 24 * 180 ? 'gpuDriverOldTip' : '',
      {
        date: g.driverDate ? String(g.driverDate).slice(0, 10) : '',
        ageMonths: age != null ? Math.round(age / 24 / 30) : null,
        width: g.width, height: g.height, refresh: g.refresh,
      }));
  }

  // ---------- 启动项 ----------
  if (q.startup) {
    const n = (Number(q.startup.hkcRun) || 0) + (Number(q.startup.hklmRun) || 0);
    out.push(f('startup', 'startup', n > 12 ? 'info' : 'good', 'startupTitle',
      { n, user: q.startup.hkcRun, all: q.startup.hklmRun }, 'startupDetail', n > 12 ? 'startupTip' : ''));
  }

  if (q.os) {
    out.push(f('os', 'system', 'info', 'osTitle', { caption: q.os.caption, build: q.os.build }, 'osDetail', '',
      {
        model: `${q.os.manufacturer || ''} ${q.os.model || ''}`.trim(),
        ram: q.os.ramTotal ? gb(q.os.ramTotal) : '',
        free: q.os.ramTotal ? gb(q.os.ramFree) : '',
      }));
  }

  const order = { risk: 0, warn: 1, info: 2, good: 3 };
  out.sort((a, b) => (order[a.severity] - order[b.severity]));
  const counts = { risk: 0, warn: 0, info: 0, good: 0 };
  for (const x of out) counts[x.severity] = (counts[x.severity] || 0) + 1;
  return { ok: true, findings: out, counts, deep: !!deep };
}

/**
 * 设置被回弹：把档位快照里记下的目标值和当前值对一遍。
 * 只报本软件写过的游戏开关与 N 卡 3D 设置；电源计划不报（切方案是用户自己的日常动作），
 * 启动项不报（那一块本来就有独立的备份/回滚入口）。全程只读。
 */
async function driftFacts() {
  let info = null;
  try { info = tiers.info(); } catch (e) { return null; }
  if (!info || !info.snapshot || !info.snapshotTier) return null;
  let p = null;
  try { p = await tiers.preview(info.snapshotTier); } catch (e) { return null; }
  if (!p || !p.ok) return null;
  const game = (p.game || []).filter((g) => g.status === 'change');
  const gpu = (p.gpu || []).filter((g) => g.status === 'change');
  if (!game.length && !gpu.length) return null;
  return { tier: info.snapshotTier, at: info.snapshotAt, game, gpu };
}

/** 快速体检：只用普通权限，几秒出结果，不弹 UAC */
async function quick() {
  const r = await runScript('health-user.ps1', [], 120000);
  const data = parseJson(r.stdout);
  if (!data) return { ok: false, message: r.stderr || '', messageKey: 'collectFail' };
  data.drift = await driftFacts();
  const rep = report(data);
  return { ok: true, quick: true, facts: data, ...rep };
}

/** 深度体检：先读普通权限的事实，再一次 UAC 读完需要管理员的部分 */
async function deep(onProgress) {
  const base = await quick();
  if (!base.ok) return base;
  if (typeof onProgress === 'function') onProgress({ phase: 'elevate' });
  const r = await runElevated(ADMIN_SCRIPT, { action: 'scan' }, 600000);
  if (r.canceled) return { ...base, messageKey: 'deepCanceled' };
  if (!r.data) return { ...base, message: r.stderr || '', messageKey: 'deepFail' };
  if (typeof onProgress === 'function') onProgress({ phase: 'analyze' });
  const facts = { ...base.facts, deep: r.data };
  const rep = report(facts);
  return { ok: true, quick: false, facts, ...rep, messageKey: r.data.ok === false ? 'deepFail' : '', message: r.data.ok === false ? (r.data.error || '') : '' };
}

module.exports = { quick, deep, report, gb, mb };
