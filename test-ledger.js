'use strict';
// test.18 自测：保护清单例外、账本记录与撤销、体检报告纯函数。
// 只在临时沙盒里建文件，不碰任何真实数据，也不调用任何 PowerShell / 注册表。
const fs = require('fs');
const os = require('os');
const path = require('path');

const config = require('./engine/config');
const safety = require('./engine/safety');
const clean = require('./engine/clean');
const ledger = require('./engine/ledger');
const health = require('./engine/health');
const HT = require('./renderer/health-text');

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

const sandbox = path.join(os.tmpdir(), 'rvledger-selftest');
const L = config.paths.LOCALAPPDATA;
const CHROME_UD = path.join(L, 'Google', 'Chrome', 'User Data');
const EDGE_UD = path.join(L, 'Microsoft', 'Edge', 'User Data');

(async () => {
  console.log('== 1. 保护清单与例外 ==');
  check('UWP 数据目录受保护', safety.isProtected(path.join(L, 'Packages', 'Some.App', 'LocalState')));
  check('DPAPI 主密钥受保护', safety.isProtected(path.join(L, 'Microsoft', 'Protect', 'S-1-5-21', 'x')));
  check('凭据目录受保护', safety.isProtected(path.join(L, 'Microsoft', 'Credentials', 'a.dat')));
  check('用户注册表配置单元受保护', safety.isProtected(path.join(L, 'Microsoft', 'Windows', 'UsrClass.dat')));
  check('Chrome User Data 根受保护', safety.isProtected(path.join(CHROME_UD, 'Default', 'History')));
  check('Chrome 书签受保护', safety.isProtected(path.join(CHROME_UD, 'Default', 'Bookmarks')));
  check('Edge User Data 根受保护', safety.isProtected(path.join(EDGE_UD, 'Default', 'Login Data')));
  check('例外：Chrome Cache 仍可清理', safety.isProtected(path.join(CHROME_UD, 'Default', 'Cache', 'data_0')) === false);
  check('例外：Chrome Code Cache 仍可清理', safety.isProtected(path.join(CHROME_UD, 'Default', 'Code Cache', 'js')) === false);
  check('例外：Chrome File System 仍可清理', safety.isProtected(path.join(CHROME_UD, 'Default', 'File System', '000')) === false);
  check('例外：Edge Cache 仍可清理', safety.isProtected(path.join(EDGE_UD, 'Default', 'Cache', 'x')) === false);
  check('普通缓存目录不受影响', safety.isProtected(path.join(L, 'npm-cache')) === false);
  check('NVIDIA 缓存仍是用户主动选项', safety.isProtected(path.join(L, 'NVIDIA', 'DXCache')) === false);
  check('系统级白名单没被保护清单误伤',
    config.systemAllowed.every((p) => !safety.isProtected(p)));
  check('现有清理目标一个都没被保护清单挡住',
    config.targets.filter((t) => !t.admin).every((t) => config.targetPaths(t).every((p) => !safety.isProtected(p))),
    config.targets.filter((t) => !t.admin).map((t) => t.id).filter((id) => config.targetPaths(config.getTarget(id)).some((p) => safety.isProtected(p))));

  console.log('== 2. 递归删除时逐项复查保护清单 ==');
  fs.rmSync(sandbox, { recursive: true, force: true });
  fs.mkdirSync(path.join(sandbox, 'plain'), { recursive: true });
  fs.writeFileSync(path.join(sandbox, 'plain', 'a.tmp'), 'x'.repeat(100));
  fs.mkdirSync(path.join(sandbox, 'vault'), { recursive: true });
  fs.writeFileSync(path.join(sandbox, 'vault', 'secret.dat'), 'DO-NOT-DELETE');
  config.protectList.push(path.join(sandbox, 'vault'));
  const st = await clean.clearDirContents(sandbox);
  config.protectList.pop();
  check('受保护子目录整个保住', fs.existsSync(path.join(sandbox, 'vault', 'secret.dat')));
  check('受保护项内容未被改动', fs.readFileSync(path.join(sandbox, 'vault', 'secret.dat'), 'utf8') === 'DO-NOT-DELETE');
  check('未受保护的内容照常删除', !fs.existsSync(path.join(sandbox, 'plain')));
  check('统计里如实标出 blocked', st.blocked === 1, st);
  fs.rmSync(sandbox, { recursive: true, force: true });

  console.log('== 3. 变更账本 ==');
  const ud = path.join(os.tmpdir(), 'rvledger-ud');
  fs.rmSync(ud, { recursive: true, force: true });
  fs.mkdirSync(ud, { recursive: true });
  const calls = [];
  ledger.init(ud, {
    tiers: { restore: async (c) => { calls.push('tiers.restore:' + c); return { ok: true }; } },
    game: { restoreIds: async (ids, c) => { calls.push('game.restoreIds:' + ids.join('/') + ':' + c); return { ok: true }; } },
    power: { applyGuid: async (g, c) => { calls.push('power.applyGuid:' + g + ':' + c); return { ok: true }; } },
    gpu: {
      setMany: async (p, n, items) => { calls.push('gpu.setMany:' + p + ':' + n + ':' + items.map((i) => i.id + '=' + i.value).join(',')); return { ok: true }; },
      delProfile: async (p, n) => { calls.push('gpu.delProfile:' + p + ':' + n); return { ok: true }; },
    },
    startup: { setEnabled: async (id, en) => { calls.push('startup.setEnabled:' + id + ':' + en); return { ok: true }; } },
    appendLog: (s) => calls.push('log:' + s),
  });

  check('账本文件落在 userData', ledger.getPath() === path.join(ud, 'changes-ledger.json'));
  const e1 = ledger.record({ source: '一键优化', label: '应用「三档 · 电竞模式」', undo: { type: 'tier' } });
  const e2 = ledger.record({ source: '游戏开关', label: 'HAGS → 开启', undo: { type: 'game', ids: ['hags'] } });
  const e3 = ledger.record({ source: '电源优化', label: '电源计划 → 卓越性能', undo: { type: 'power', guid: 'e9a42b02-d5df-448d-aa66-ad3f9c1a3f1e' } });
  const e4 = ledger.record({ source: '显卡优化', label: '垂直同步 → 关', undo: { type: 'gpu', profile: 'global', name: '', items: [{ id: '0x00A879CF', value: 1 }] } });
  const e5 = ledger.record({ source: '启动项', label: '禁用「Steam」', undo: { type: 'startup', id: 'reg|HKCU|Steam', enabled: true } });
  const e6 = ledger.record({ source: '磁盘清理', label: '回收站（释放 1.2 GB）', undo: null, undoHint: '删除的文件无法恢复' });
  check('每条都有唯一 id', new Set([e1, e2, e3, e4, e5, e6].map((x) => x.id)).size === 6);
  check('不可撤销项必须带说明', e6.undo === null && e6.undoHint === '删除的文件无法恢复');
  check('默认说明兜底', ledger.record({ source: 'x', label: 'y', undo: null }).undoHint === '该操作无法撤销');

  const list = ledger.list(200);
  check('列表按时间倒序', list[0].label.indexOf('y') === 0 && list[1].id === e6.id, list.slice(0, 2).map((x) => x.label));
  const s0 = ledger.stats();
  check('统计数字对得上', s0.total === 7 && s0.applied === 7 && s0.undoable === 5 && s0.undone === 0, s0);

  check('未确认时拒绝撤销', (await ledger.undo(e1.id, false)).ok === false);
  check('找不到记录时报错', (await ledger.undo('nope', true)).message === '找不到该记录');
  check('不可撤销项拒绝并给原因', (await ledger.undo(e6.id, true)).message === '删除的文件无法恢复');

  const r1 = await ledger.undo(e1.id, true);
  check('撤销一键优化走 tiers.restore', r1.ok && calls.includes('tiers.restore:true'), calls);
  check('撤销后状态变 undone', ledger.get(e1.id).status === 'undone');
  check('撤销写进日志', calls.some((c) => /^log:撤销变更 \| 一键优化/.test(c)), calls);
  check('重复撤销被拒', (await ledger.undo(e1.id, true)).message === '这条已经撤销过了');

  await ledger.undo(e2.id, true);
  check('撤销游戏开关带上 ids', calls.includes('game.restoreIds:hags:true'), calls);
  await ledger.undo(e3.id, true);
  check('撤销电源计划带回原 GUID', calls.includes('power.applyGuid:e9a42b02-d5df-448d-aa66-ad3f9c1a3f1e:true'), calls);
  await ledger.undo(e4.id, true);
  check('撤销 N 卡设置写回原值', calls.includes('gpu.setMany:global::0x00A879CF=1'), calls);
  await ledger.undo(e5.id, true);
  check('撤销启动项恢复原启用状态', calls.includes('startup.setEnabled:reg|HKCU|Steam:true'), calls);

  const s1 = ledger.stats();
  check('撤销后统计更新', s1.applied === 2 && s1.undone === 5 && s1.undoable === 0, s1);
  const ra = await ledger.undoAll(true);
  check('没有可撤销项时如实返回', ra.ok === false && ra.message === '没有可撤销的变更', ra);

  // 撤销失败要被标出来，不能悄悄当成成功
  ledger.init(ud, { appendLog: () => {} });
  const bad = ledger.record({ source: '电源优化', label: '坏记录', undo: { type: 'power' } });
  const rb = await ledger.undo(bad.id, true);
  check('缺少原值时撤销失败并说明原因', rb.ok === false && /GUID/.test(rb.message), rb);
  check('失败状态被记录', ledger.get(bad.id).status === 'failed' && ledger.get(bad.id).error);
  const unknown = ledger.record({ source: 'x', label: '未知类型', undo: { type: 'wat' } });
  check('未知撤销类型被拒', (await ledger.undo(unknown.id, true)).ok === false);

  // 上限裁剪：只留最近 500 条
  ledger.init(ud, { appendLog: () => {} });
  fs.writeFileSync(path.join(ud, 'changes-ledger.json'), JSON.stringify({ ver: 1, entries: [] }), 'utf8');
  for (let i = 0; i < 520; i++) ledger.record({ source: 't', label: 'n' + i, undo: null });
  const s2 = ledger.stats();
  check('账本条数不超过 500', s2.total === 500, s2);
  check('裁掉的是最旧的', ledger.list(500)[0].label === 'n519' && ledger.list(500)[499].label === 'n20');

  console.log('== 4. 体检报告（纯函数） ==');
  const facts = {
    os: { caption: 'Microsoft Windows 11 Pro', build: '26200', uptimeSec: 90 * 3600, ramTotal: 16 * 1073741824, ramFree: 4 * 1073741824, manufacturer: 'ASUS', model: 'TUF' },
    disks: [{ letter: 'C:', free: 12 * 1073741824, size: 465 * 1073741824 }],
    physical: [{ name: 'NVMe SSD', media: 'SSD', bus: 'NVMe', health: 'Healthy', diskNum: 0, letters: ['C', 'D'] }],
    pagefiles: [{ name: 'C:\\pagefile.sys', allocatedMB: 16384, usedMB: 512 }, { name: 'D:\\pagefile.sys', allocatedMB: 24576, usedMB: 0 }],
    hibernate: { hiberfilExists: false, hiberboot: 0 },
    tweaks: { hags: 2, gamedvr: 0, appCapture: 0 },
    startup: { hkcRun: 3, hklmRun: 2 },
    services: [{ name: 'DPS', status: 'Stopped', startType: 'Disabled' }, { name: 'DiagTrack', status: 'Stopped', startType: 'Disabled' }],
    defender: { present: false },
    gpus: [
      { name: 'NVIDIA GeForce RTX 5060 Ti', virtual: false, driver: '32.0.15.6692', driverDate: '2026-08-01T00:00:00', width: 1920, height: 1080, refresh: 200 },
      { name: 'Todesk Virtual Display', virtual: true, pnp: 'ROOT\\DISPLAY\\0000' },
    ],
    deep: {
      winsxs: { ok: true, actual: 9.8 * 1073741824, shared: 7.1 * 1073741824, backups: 2.62 * 1073741824, reclaimable: 41, recommended: true, lastCleanup: '2026-05-02' },
      trim: [{ fs: 'NTFS', disabled: false }],
      leftovers: [{ path: 'C:\\Windows\\SoftwareDistribution\\Download', exists: true, bytes: 0 }, { path: 'C:\\Windows\\Logs\\CBS', exists: true, bytes: 11 * 1048576 }],
      driverCount: 40,
      driverDuplicates: [{ orig: 'amd3dvcache.inf', keep: 'oem21.inf', keepVersion: '1.0.0.11', keepDate: '2026-07-01', old: ['oem5.inf'] }],
      restore: { disabled: false, count: 1, last: { seq: 47, description: 'RedVolt Lab', at: '2026-10-04T09:00:00' }, shadow: { used: 1.02 * 1073741824, allocated: 1.34 * 1073741824, max: 4.13 * 1073741824 } },
      boot: { dpsEvents: false, unexpectedShutdowns: 2 },
    },
  };
  const rep = health.report(facts);
  const ids = rep.findings.map((x) => x.id);
  check('返回结构完整', rep.ok === true && rep.deep === true && Array.isArray(rep.findings));
  check('计数与条目一致', rep.counts.risk + rep.counts.warn + rep.counts.info + rep.counts.good === rep.findings.length, rep.counts);
  check('C 盘剩 2.5% 判为风险', ids.includes('disk-crit') && rep.findings.filter((x) => x.id === 'disk-crit')[0].severity === 'risk');
  check('C/D 同盘给出提示', ids.includes('same-disk'));
  const sd = rep.findings.filter((x) => x.id === 'same-disk')[0];
  check('同盘提示用无冒号的盘符', JSON.stringify(sd.params.letters) === '["C","D"]' && /C 盘与 D 盘/.test(HT.fmt(sd, 'zh').title), sd.params.letters);
  // Get-PhysicalDisk 没有 DeviceNumber 属性，用错就会静默丢掉盘符映射（同盘提示再也出不来）
  check('体检脚本按 DeviceId 匹配分区', /DeviceId/.test(fs.readFileSync(path.join(__dirname, 'engine', 'ps', 'health-user.ps1'), 'utf8')));
  check('页面文件 40 GB 给出提示', ids.includes('pagefile'));
  check('组件存储建议清理判为 warn', ids.includes('winsxs') && rep.findings.filter((x) => x.id === 'winsxs')[0].severity === 'warn');
  check('小于 100 MB 的残留不报', !ids.includes('leftovers'));
  check('重复驱动被列出', ids.includes('drivers'));
  check('还原点正常判为 good', rep.findings.filter((x) => x.id === 'restore')[0].severity === 'good');
  check('DPS 停了如实说明拿不到官方开机耗时', ids.includes('boot-diag'));
  check('异常关机被标出', ids.includes('crash-boot'));
  check('TRIM 正常', rep.findings.filter((x) => x.id === 'trim')[0].severity === 'good');
  check('HAGS 已开启', rep.findings.filter((x) => x.id === 'hags')[0].severity === 'good');
  check('没有 Defender 只作提示，不当告警', rep.findings.filter((x) => x.id === 'defender')[0].severity === 'info');
  const repDef = health.report({ disks: [], defender: { present: true, realtime: false, antivirus: false, tamper: false, signatureAgeHours: 0 } });
  check('Defender 在但实时保护关了判为 warn', repDef.findings.filter((x) => x.id === 'defender')[0].severity === 'warn');
  check('虚拟显卡被识别', ids.includes('vgpu'));
  check('风险类排在最前', rep.findings[0].severity === 'risk', rep.findings[0].severity);

  const rep2 = health.report({ disks: [{ letter: 'C:', free: 300 * 1073741824, size: 465 * 1073741824 }] });
  check('空间充足判为 good', rep2.findings.filter((x) => x.id === 'disk-ok').length === 1);
  check('事实缺失时不崩', health.report({}).ok === true && health.report(null).ok === true);
  check('没有深度事实时标记 deep=false', health.report({ disks: [] }).deep === false);

  // 深度扫描读不到时必须如实说「读不到」，绝不能把「没权限」讲成「你没有还原点 / 没有异常关机」
  const denied = health.report({
    disks: [],
    services: [{ name: 'DPS', status: 'Stopped', startType: 'Disabled' }],
    deep: {
      restore: { readable: false, count: null, last: null, disabled: null, shadow: null },
      winsxs: { ok: false, needsAdmin: true },
      boot: { dpsEvents: false, unexpectedShutdowns: null, readable: { perf: false, kernel: true, crash: false } },
      failed: [{ section: 'restore-points', error: 'access-denied' }, { section: 'boot-perf', error: 'access-denied' }, { section: 'boot-kernel', error: 'log-absent' }],
    },
  });
  const dIds = denied.findings.map((x) => x.id);
  const dSev = (id) => (denied.findings.filter((x) => x.id === id)[0] || {}).severity;
  const byId = (r, id) => r.findings.filter((x) => x.id === id)[0];
  check('还原点读不到只作提示，不谎称没有', dIds.includes('restore') && dSev('restore') === 'info' && HT.fmt(byId(denied, 'restore'), 'zh').title.indexOf('读不到') >= 0);
  check('日志读不到时不谎称启动诊断停了', !dIds.includes('boot-diag'));
  check('DISM 被拒说明是权限问题', /权限|740/.test(HT.fmt(byId(denied, 'winsxs'), 'zh').detail));
  const df = denied.findings.filter((x) => x.id === 'deep-failed')[0];
  const dfText = HT.fmt(df, 'zh');
  check('列出没读到的项', !!df && /3 项/.test(dfText.title), dfText.title);
  check('失败原因翻成人话', /权限不够/.test(dfText.detail) && /日志在本机不存在/.test(dfText.detail) && !/access-denied|log-absent/.test(dfText.detail), dfText.detail);

  const noCrash = health.report({ disks: [], deep: { boot: { unexpectedShutdowns: 0, readable: { crash: true } } } });
  check('30 天没异常关机判为 good', (noCrash.findings.filter((x) => x.id === 'crash-boot')[0] || {}).severity === 'good');
  const crashUnread = health.report({ disks: [], deep: { boot: { unexpectedShutdowns: null, readable: { crash: false } } } });
  check('异常关机记录读不到就不报', crashUnread.findings.filter((x) => x.id === 'crash-boot').length === 0);

  const tr = health.report({ disks: [{ letter: 'C:', free: 1 * 1073741824, size: 465 * 1073741824 }], deep: { trim: [{ fs: 'NTFS', disabled: true }] } });
  check('TRIM 被禁判为风险', tr.findings.filter((x) => x.id === 'trim')[0].severity === 'risk');

  // ---------- 设置被回弹 ----------
  // 事实由 quick() 从档位快照对比出来；这里用伪造事实验判定与文案，不碰真实系统和驱动
  const driftFacts = {
    disks: [],
    drift: {
      tier: 'esports',
      at: 1760000000000,
      game: [{ id: 'hags', kind: 'toggle', mode: 'on', current: 'off', status: 'change' }],
      gpu: [{ id: '0x1057EB71', value: 1, name: { zh: '电源管理模式', en: 'Power management mode' }, current: '0x0', currentLabel: { zh: '平衡', en: 'Optimal power' }, targetLabel: { zh: '最高性能优先', en: 'Prefer maximum performance' }, status: 'change' }],
    },
  };
  const drep = health.report(driftFacts);
  const dx = (drep.findings.filter((x) => x.id === 'drift')[0] || {});
  check('被改回时出一条建议处理', dx.severity === 'warn' && dx.group === 'system', dx);
  check('条数等于开关项加 N 卡项', dx.params && dx.params.count === 2, dx.params && dx.params.count);
  check('带上档位与重新应用动作', dx.action && dx.action.kind === 'tierReapply' && dx.action.tier === 'esports', dx.action);
  check('没优化过或没漂移就一条都不报',
    health.report({ disks: [] }).findings.filter((x) => x.id === 'drift').length === 0 &&
    health.report({ disks: [], drift: null }).findings.filter((x) => x.id === 'drift').length === 0);

  const hs = fs.readFileSync(path.join(__dirname, 'engine', 'health.js'), 'utf8');
  const driftSrc = (hs.match(/async function driftFacts\(\)[\s\S]*?\n}\n/) || [''])[0];
  check('漂移检测取到档位目标值', /tiers\.preview\(info\.snapshotTier\)/.test(driftSrc) && /status === 'change'/.test(driftSrc), driftSrc.slice(0, 60));
  check('电源计划与启动项不参与漂移判定', !!driftSrc && !/p\.power/.test(driftSrc) && !/startup/i.test(driftSrc));

  // 文案借用 tiers/game 模块自己的取名函数：借用逻辑用假 window 验，真实界面里它们必然存在
  global.window = {
    tiers: {
      tierName: () => '三档 · 电竞模式',
      groupText: (k) => (k === 'game' ? '系统游戏开关' : 'N 卡 3D 设置（全局方案）'),
      gameText: () => ({ name: '硬件加速 GPU 计划（HAGS）', cur: '关闭', to: '开启' }),
      gpuValueText: (it, which) => (which === 'target' ? '最高性能优先' : '平衡'),
    },
  };
  const dz = HT.fmt(dx, 'zh');
  check('标题说明被改回的项数和档位', /2 项/.test(dz.title) && /三档 · 电竞模式/.test(dz.title), dz.title);
  check('分组列出每一项的当前值与应有值',
    /系统游戏开关\n  硬件加速 GPU 计划（HAGS）：当前 关闭 → 应为 开启/.test(dz.detail) &&
    /N 卡 3D 设置（全局方案）\n  电源管理模式：当前 平衡 → 应为 最高性能优先/.test(dz.detail), dz.detail);
  check('说清检测范围只限本软件写过的项', /只限本软件写过/.test(dz.detail));
  check('按钮与确认框文案齐了',
    HT.msg('driftReapply', 'zh', { count: 2 }) === '重新应用这 2 项' &&
    /只修改下面列出的 2 项/.test(HT.msg('driftConfirmDesc', 'zh', { count: 2 })) &&
    !!HT.msg('driftConfirmTitle', 'zh') && HT.msg('driftConfirmOk', 'zh') === '确认重新应用', HT.msg('driftReapply', 'zh', { count: 2 }));
  global.window = {
    tiers: {
      tierName: () => 'Tier 3 · Esports',
      groupText: (k) => (k === 'game' ? 'System gaming switches' : 'NVIDIA 3D settings (global profile)'),
      gameText: () => ({ name: 'Hardware-accelerated GPU scheduling (HAGS)', cur: 'Off', to: 'On' }),
      gpuValueText: (it, which) => (which === 'target' ? 'Prefer maximum performance' : 'Balanced'),
    },
  };
  const de = HT.fmt(dx, 'en');
  check('英文同样分组并说范围',
    /2 item\(s\)/.test(de.title) && /System gaming switches\n  Hardware-accelerated GPU scheduling \(HAGS\): now Off → should be On/.test(de.detail) &&
    /NVIDIA 3D settings \(global profile\)\n  Power management mode: now Balanced → should be Prefer maximum performance/.test(de.detail) &&
    /Scope is limited to settings this app wrote/.test(de.detail), de.detail);
  check('英文按钮与确认框', HT.msg('driftReapply', 'en', { count: 2 }) === 'Re-apply 2 item(s)' && /Only the 2 items listed below change/.test(HT.msg('driftConfirmDesc', 'en', { count: 2 })));
  check('借不到模块文本时退回原始 id 与十六进制值而不是崩', (function () {
    delete global.window;
    const s = HT.fmt(dx, 'zh');
    return /hags：当前 off → 应为 on/.test(s.detail) && /电源管理模式：当前 0x0 → 应为 1/.test(s.detail) && !!s.title;
  })());

  const missingTpl = [];
  for (const x of rep.findings.concat(denied.findings)) {
    for (const k of [x.titleKey, x.detailKey, x.tipKey]) if (k && !HT.TEMPLATES[k]) missingTpl.push(x.id + ' -> ' + k);
  }
  check('每条结论都有双语模板', missingTpl.length === 0, missingTpl);

  // 分支覆盖不到的文案也要有模板：直接扫源码里出现的 key，漏一条就红
  const hsrc = fs.readFileSync(path.join(__dirname, 'engine', 'health.js'), 'utf8');
  const used = new Set([...hsrc.matchAll(/'([a-z][A-Za-z]*(?:Title|Detail|Tip))'/g)].map((m) => m[1]));
  const undef = [...used].filter((k) => !HT.TEMPLATES[k]);
  check('health.js 引用的每个文案 key 都有模板', undef.length === 0, undef);
  const usedMsg = new Set([...hsrc.matchAll(/messageKey: '(\w+)'/g)].map((m) => m[1]));
  check('流程提示的 key 也都有模板', [...usedMsg].every((k) => !!HT.MSG[k]), [...usedMsg].filter((k) => !HT.MSG[k]));
  const dead = Object.keys(HT.TEMPLATES).filter((k) => !used.has(k));
  check('没有没人用的文案模板', dead.length === 0, dead);

  const text = HT.toText({ quick: false, counts: rep.counts, findings: rep.findings }, 'zh');
  check('导出文本含标题与结论', /RedVolt Lab 体检报告/.test(text) && /结论：/.test(text));
  check('导出文本含每条建议', /建议：/.test(text) && /\[风险\]/.test(text));
  check('导出文本声明只读', /未对系统做任何修改/.test(text));
  const textEn = HT.toText({ quick: false, counts: rep.counts, findings: rep.findings }, 'en');
  check('导出文本能整份出英文', !/[\u3400-\u9fff]/.test(textEn) && /health report/i.test(textEn), textEn.slice(0, 200));

  // 重新应用只能改清单里列出的项：电源计划必须在整条链路上被跳过
  const tsrc = fs.readFileSync(path.join(__dirname, 'engine', 'tiers.js'), 'utf8');
  const msrc = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  const rsrc = fs.readFileSync(path.join(__dirname, 'renderer', 'app.js'), 'utf8');
  const psrc = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
  check('档位执行支持只改开关与 N 卡', /if \(!o\.skipPower && p\.power/.test(tsrc) && /async function apply\(key, confirmed, opts\)/.test(tsrc), tsrc.match(/if \(!o\.skipPower[^\n]*/));
  check('没得改时直接报 unchanged 不做空写入', /const pending =/.test(tsrc) && /if \(!pending\) return \{ ok: true, unchanged: true/.test(tsrc));
  check('主进程只接受 skipPower 一个开关', /tiers\.apply\(k, true, opts && opts\.skipPower === true \? \{ skipPower: true \} : null\)/.test(msrc), (msrc.match(/tiers\.apply\(k, true[^\n]*/) || [])[0]);
  check('渲染层重新应用带上 skipPower', /api\.tiersApply\(\(x\.action \|\| \{\}\)\.tier, true, \{ skipPower: true \}\)/.test(rsrc), (rsrc.match(/api\.tiersApply\([^\n]*/) || [])[0]);
  check('preload 把 opts 透传过去', /tiersApply: \(key, confirmed, opts\) => invoke\('tiers:apply', key, confirmed, opts\)/.test(psrc));
  check('确认文案承诺只改列出的项', /其它一律不动/.test(fs.readFileSync(path.join(__dirname, 'renderer', 'health-text.js'), 'utf8')));

  // 纯函数部分，不会调用 PowerShell，也不会弹 UAC

  console.log('== 5. 还原点可用性判定 ==');
  const rp = require('./engine/restorepoint');
  check('读不到状态时如实说不可用', rp.availability(null).available === false && /读取失败/.test(rp.availability(null).reason));
  check('没提权时说清需要授权', /管理员/.test(rp.availability({ admin: false }).reason));
  check('命令被精简时说清原因', /Checkpoint-Computer/.test(rp.availability({ admin: true, cmdlet: false }).reason));
  check('系统保护关闭时给出操作路径', /系统保护/.test(rp.availability({ admin: true, cmdlet: true, disabled: true }).reason));
  check('VSS 被精简时如实说明', /卷影复制/.test(rp.availability({ admin: true, cmdlet: true, disabled: false, services: { VSS: 'absent' } }).reason));
  const okAv = rp.availability({ admin: true, cmdlet: true, disabled: false, services: { VSS: 'Running' } });
  check('一切正常时判为可用', okAv.available === true && okAv.reason === '', okAv);
  check('复用窗口是 24 小时', rp.REUSE_WINDOW_MS === 24 * 3600 * 1000);

  fs.rmSync(ud, { recursive: true, force: true });
  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('ERROR ' + ((e && e.stack) || e)); process.exit(2); });
