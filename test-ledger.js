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
  check('同盘提示用无冒号的盘符', /C 盘与 D 盘/.test(rep.findings.filter((x) => x.id === 'same-disk')[0].title), rep.findings.filter((x) => x.id === 'same-disk')[0].title);
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
  check('还原点读不到只作提示，不谎称没有', dIds.includes('restore') && dSev('restore') === 'info' && /读不到/.test(denied.findings.filter((x) => x.id === 'restore')[0].title));
  check('日志读不到时不谎称启动诊断停了', !dIds.includes('boot-diag'));
  check('DISM 被拒说明是权限问题', /权限|740/.test(denied.findings.filter((x) => x.id === 'winsxs')[0].detail));
  const df = denied.findings.filter((x) => x.id === 'deep-failed')[0];
  check('列出没读到的项', !!df && /3 项/.test(df.title), df && df.title);
  check('失败原因翻成人话', df && /权限不够/.test(df.detail) && /日志在本机不存在/.test(df.detail) && !/access-denied|log-absent/.test(df.detail), df && df.detail);

  const noCrash = health.report({ disks: [], deep: { boot: { unexpectedShutdowns: 0, readable: { crash: true } } } });
  check('30 天没异常关机判为 good', (noCrash.findings.filter((x) => x.id === 'crash-boot')[0] || {}).severity === 'good');
  const crashUnread = health.report({ disks: [], deep: { boot: { unexpectedShutdowns: null, readable: { crash: false } } } });
  check('异常关机记录读不到就不报', crashUnread.findings.filter((x) => x.id === 'crash-boot').length === 0);

  const tr = health.report({ disks: [{ letter: 'C:', free: 1 * 1073741824, size: 465 * 1073741824 }], deep: { trim: [{ fs: 'NTFS', disabled: true }] } });
  check('TRIM 被禁判为风险', tr.findings.filter((x) => x.id === 'trim')[0].severity === 'risk');

  const text = health.toText({ quick: false, counts: rep.counts, findings: rep.findings });
  check('导出文本含标题与结论', /RedVolt Lab 体检报告/.test(text) && /结论：/.test(text));
  check('导出文本含每条建议', /建议：/.test(text) && /\[风险\]/.test(text));
  check('导出文本声明只读', /未对系统做任何修改/.test(text));

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
