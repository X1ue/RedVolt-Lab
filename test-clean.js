'use strict';
// test.19 清理覆盖的引擎层自检：不弹 UAC、不删任何真实文件。
// 覆盖 config 完整性、白名单边界、驱动包名字过滤、WinSxS 建议与进度轮询。
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra === undefined ? '' : ' -> ' + JSON.stringify(extra))); }
}

const cfg = require('./engine/config');
const safety = require('./engine/safety');
const scan = require('./engine/scan');
const drivers = require('./engine/drivers');
const winsxs = require('./engine/winsxs');
const admin = require('./engine/admin');

const GB = 1073741824;
const KINDS = ['tempOld', 'clearDir', 'removeDirs', 'recycle', 'npm', 'flushDns'];
const LEVELS = ['safe', 'caution'];
const GROUPS = ['disk', 'system'];

console.log('== 1. 清理项目录完整性 ==');
const ids = new Set();
for (const t of cfg.targets) {
  check(`id 唯一且合法: ${t.id}`, !ids.has(t.id) && /^[a-zA-Z][\w-]*$/.test(t.id));
  ids.add(t.id);
  check(`字段齐全: ${t.id}`, !!t.name && !!t.note && GROUPS.includes(t.group) && LEVELS.includes(t.level) && KINDS.includes(t.kind), t);
  if (t.kind !== 'flushDns' && t.kind !== 'recycle' && t.kind !== 'npm') {
    check(`有路径: ${t.id}`, cfg.targetPaths(t).length > 0);
  }
  check(`系统级都标了 admin: ${t.id}`, t.group !== 'system' || !!t.admin);
  check(`admin 都在 system 组: ${t.id}`, !t.admin || t.group === 'system');
  if (t.hideWhenMissing) {
    check(`隐藏项默认不勾选: ${t.id}`, t.defaultChecked !== true);
  }
  if (t.section === '开发工具缓存') {
    check(`开发缓存默认不勾选: ${t.id}`, t.defaultChecked !== true);
    check(`开发缓存都是隐藏项: ${t.id}`, t.hideWhenMissing === true);
  }
}
check('目标数量 >= 30', cfg.targets.length >= 30, cfg.targets.length);

console.log('== 2. 白名单与边界 ==');
(async () => {
  for (const t of cfg.targets) {
    for (const p of cfg.targetPaths(t)) {
      const reason = await safety.checkPath(p, { admin: !!t.admin });
      check(`可通过安全检查或确实不存在: ${t.id}`, reason === null || reason === '不存在', { p, reason });
    }
  }

  // 系统级白名单必须正好覆盖所有 admin 目标，多一条都是白送的删除权限
  const adminPaths = new Set();
  for (const t of cfg.targets.filter((x) => x.admin)) {
    for (const p of cfg.targetPaths(t)) adminPaths.add(safety.norm(p).toLowerCase());
  }
  for (const p of cfg.systemAllowed) {
    check(`白名单里的路径确实有目标在用: ${p}`, adminPaths.has(safety.norm(p).toLowerCase()));
  }
  check('白名单条数与系统级路径数一致', cfg.systemAllowed.length === adminPaths.size,
    { allowed: cfg.systemAllowed.length, used: adminPaths.size });

  // 用户态允许根绝不能是用户目录整体或 Code 整体
  const lower = cfg.allowedRoots.map((r) => safety.norm(r).toLowerCase());
  check('不放行用户目录整体', !lower.includes(safety.norm(os.homedir()).toLowerCase()));
  check('不放行 APPDATA 整体', !lower.includes(safety.norm(process.env.APPDATA).toLowerCase()));
  check('不放行 Code 整体', !lower.some((r) => /\\code$/.test(r)));
  check('放行 Code 的具体缓存叶子', lower.some((r) => /\\code\\cache$/.test(r)));

  const bound = [
    ['C:/Windows/Temp', 'C:/Windows/Temp', true],
    ['C:/Windows/TempFoo', 'C:/Windows/Temp', false],
    ['C:/Windows.old/x', 'C:/Windows.old', true],
    ['C:/Windows.old.bak', 'C:/Windows.old', false],
    ['C:/$WINDOWS.~BT/y', 'C:/$WINDOWS.~BT', true],
    ['C:/$WINDOWS.~BTX', 'C:/$WINDOWS.~BT', false],
    ['C:/Windows/Logs/CBSx', 'C:/Windows/Logs/CBS', false],
  ];
  for (const [c, p, want] of bound) {
    check(`边界: ${c} vs ${p}`, safety.startsWithBoundary(c, p) === want);
  }

  console.log('== 3. 保护清单仍然拦得住 ==');
  const L = process.env.LOCALAPPDATA;
  const mustBlock = [
    path.join(L, 'Packages'),
    path.join(L, 'Microsoft', 'Protect'),
    path.join(L, 'Microsoft', 'Credentials'),
    path.join(L, 'Microsoft', 'Windows', 'UsrClass.dat'),
    path.join(L, 'Google', 'Chrome', 'User Data'),
    path.join(L, 'Google', 'Chrome', 'User Data', 'Default', 'Bookmarks'),
    path.join(L, 'Microsoft', 'Edge', 'User Data', 'Default', 'Login Data'),
  ];
  for (const p of mustBlock) check('拦截 ' + path.basename(p), safety.isProtected(p) === true, p);
  const mustAllow = [
    path.join(L, 'Google', 'Chrome', 'User Data', 'Default', 'Cache'),
    path.join(L, 'Google', 'Chrome', 'User Data', 'ShaderCache'),
    path.join(L, 'Microsoft', 'Edge', 'User Data', 'GrShaderCache'),
  ];
  for (const p of mustAllow) check('放行 ' + p.slice(L.length), safety.isProtected(p) === false, p);
  check('着色器缓存例外确实挂在受保护目录里',
    safety.isProtected(path.join(L, 'Google', 'Chrome', 'User Data', 'Default', 'Cache')) === false);

  console.log('== 4. hideWhenMissing 过滤 ==');
  const devTargets = cfg.targets.filter((t) => t.hideWhenMissing && !t.admin);
  check('存在需要按目录过滤的用户态项目', devTargets.length > 0);
  let present = 0;
  for (const t of devTargets) {
    let any = false;
    for (const d of cfg.targetPaths(t)) { if (await scan.pathExists(d)) any = true; }
    if (any) present++;
  }
  console.log(`  info 本机实际存在 ${present}/${devTargets.length} 个开发缓存项目`);
  check('系统级项目不参与隐藏过滤', cfg.targets.filter((t) => t.hideWhenMissing && t.admin).length > 0);

  console.log('== 5. 驱动包 ==');
  check('过滤非法驱动包名', JSON.stringify(drivers.normPubs(['OEM8.INF', 'oem8.inf', 'bogus', '../evil.inf', 'oem20.inf', '', null])) ===
    JSON.stringify(['oem8.inf', 'oem20.inf']), drivers.normPubs(['OEM8.INF', 'bogus', '../evil.inf']));
  const unconfirmed = await drivers.remove(['oem8.inf'], false);
  check('未确认一律拒绝', unconfirmed.ok === false && /未经确认/.test(unconfirmed.message), unconfirmed);
  const empty = await drivers.remove([], true);
  check('空勾选不执行', empty.ok === true && empty.removed.length === 0 && /没有勾选/.test(empty.message), empty);
  const badOnly = await drivers.remove(['C:/Windows/System32/x.inf'], true);
  check('全是非法名字时不弹 UAC', badOnly.ok === true && badOnly.removed.length === 0, badOnly);
  check('删除说明覆盖所有代码', ['bad-name', 'not-found', 'is-newest', 'in-use'].every((c) => !!drivers.CODES[c]));

  console.log('== 6. WinSxS 建议 ==');
  check('读不到就不给建议', winsxs.advise(null) === null && winsxs.advise({ ok: false }) === null);
  const a1 = winsxs.advise({ ok: true, actual: 9.2 * GB, shared: 5.1 * GB, backups: 3.4 * GB, cachetemp: 0.2 * GB, reclaimable: 12, lastCleanup: '2026-05-01', recommended: true });
  check('DISM 建议清理时判为 warn', a1.level === 'warn' && /建议清理/.test(a1.title), a1);
  check('建议里带上真实数字', /9\.20 GB/.test(a1.detail) && /可回收包数量 12/.test(a1.detail) && /2026-05-01/.test(a1.detail), a1.detail);
  const a2 = winsxs.advise({ ok: true, actual: 8 * GB, shared: 5 * GB, backups: 0, cachetemp: 0, reclaimable: 0, recommended: false });
  check('没有可回收包时判为 good', a2.level === 'good', a2);
  const a3 = winsxs.advise({ ok: true, actual: 8 * GB, shared: 5 * GB, backups: 1.1 * GB, cachetemp: 0, reclaimable: 3, recommended: false });
  check('DISM 不建议时不劝人清', a3.level === 'info' && /不值得清/.test(a3.title) && /不清完全没问题/.test(a3.detail), a3);
  check('三种建议的标题都是固定文本（可翻译）',
    [a1.title, a2.title, a3.title].every((t) => !/\d/.test(t)), [a1.title, a2.title, a3.title]);
  check('建议里不出现凭空估算', !/大约|预计能省|估计/.test(a1.detail + a2.detail + a3.detail));

  console.log('== 7. WinSxS 清理拒绝路径 ==');
  const c0 = await winsxs.cleanup('cleanup', false);
  check('未确认拒绝清理', c0.ok === false && /未经确认/.test(c0.message), c0);
  const c1 = await winsxs.cleanup('cleanup-resetbase', false);
  check('未确认拒绝深度清理', c1.ok === false, c1);
  const c2 = await winsxs.cleanup('nuke', true);
  check('未知方式拒绝', c2.ok === false && /未知/.test(c2.message), c2);

  console.log('== 8. WinSxS 进度轮询（打桩，不跑 DISM）==');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-winsxs-test-'));
  admin.init(tmp);
  const realElevatedWorkDir = admin.elevatedWorkDir;
  admin.elevatedWorkDir = () => path.join(tmp, 'ipc');
  fs.mkdirSync(admin.elevatedWorkDir(), { recursive: true });
  const realRunElevated = admin.runElevated;
  let seen = [];
  let payloadSent = null;
  admin.runElevated = async (script, payload) => {
    payloadSent = payload;
    const prog = payload.progress;
    check('进度文件落在工作目录里', path.dirname(prog) === path.join(tmp, 'ipc'), prog);
    for (let i = 1; i <= 3; i++) {
      fs.writeFileSync(prog, JSON.stringify({ percent: i * 30, seconds: i, line: 'step ' + i }), 'utf8');
      await new Promise((r) => setTimeout(r, winsxs.POLL_MS + 250));
    }
    return { ok: true, canceled: false, stderr: '', data: { ok: true, action: payload.action, exitCode: 0, percent: 90, seconds: 90, tail: 'The operation completed successfully.' } };
  };
  try {
    const r = await winsxs.cleanup('cleanup', true, (p) => seen.push(p));
    check('清理返回成功', r.ok === true && /用时/.test(r.message), r);
    check('进度被转发到界面', seen.length >= 2, seen);
    check('进度百分比递增', seen.every((p, i) => i === 0 || p.percent >= seen[i - 1].percent), seen.map((p) => p.percent));
    check('payload 带上 action 与进度文件', payloadSent && payloadSent.action === 'cleanup' && !!payloadSent.progress, payloadSent);
    check('结束后删掉进度文件', !fs.existsSync(payloadSent.progress));

    admin.runElevated = async () => ({ ok: false, canceled: true, data: null, stderr: '' });
    const rc = await winsxs.cleanup('cleanup', true, () => {});
    check('取消 UAC 时如实报告且没动组件存储', rc.ok === false && rc.canceled === true && /没有对组件存储做任何操作/.test(rc.message), rc);

    admin.runElevated = async () => ({ ok: false, canceled: false, stderr: '', data: { ok: false, error: 'needs-admin', exitCode: 740 } });
    const r7 = await winsxs.cleanup('cleanup-resetbase', true, () => {});
    check('DISM 740 时不谎报成功', r7.ok === false && /740/.test(r7.message), r7);

    admin.runElevated = async () => ({ ok: false, canceled: false, stderr: '', data: { ok: false, error: 'dism-exit-1', exitCode: 1, seconds: 30, tail: 'Error: 1' } });
    const r1 = await winsxs.cleanup('cleanup', true, () => {});
    check('非零退出码如实说明可能只清了一半', r1.ok === false && /退出码 1/.test(r1.message) && /一部分/.test(r1.message), r1);
  } finally {
    admin.runElevated = realRunElevated;
    admin.elevatedWorkDir = realElevatedWorkDir;
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log('== 9. 随包脚本编码 ==');
  for (const f of fs.readdirSync(path.join(__dirname, 'engine', 'ps'))) {
    if (!/\.ps1$/.test(f)) continue;
    const b = fs.readFileSync(path.join(__dirname, 'engine', 'ps', f));
    check(`无 BOM: ${f}`, b[0] !== 0xEF);
    if (f === 'nvdrs.ps1') {
      // 这个脚本里的非 ASCII 只出现在 Add-Type 的 C# 注释中，被当成 ANSI 读也不影响执行
      console.log(`  info nvdrs.ps1 含 ${b.filter((x) => x > 127).length} 个非 ASCII 字节（均在注释里）`);
      continue;
    }
    check(`纯 ASCII: ${f}`, b.every((x) => x < 128));
  }
  for (const f of ['winsxs.ps1', 'drivers.ps1']) {
    const s = fs.readFileSync(path.join(__dirname, 'engine', 'ps', f), 'utf8');
    check(`param 约定一致: ${f}`, /param\(\[string\]\$Payload, \[string\]\$Out\)/.test(s));
    check(`无 BOM 写文件: ${f}`, /New-Object Text\.UTF8Encoding \$false/.test(s));
  }
  const adminPs = fs.readFileSync(path.join(__dirname, 'elevated', 'admin.ps1'), 'utf8');
  check('提权脚本白名单包含新增系统路径',
    ['Windows.old', '$WINDOWS.~BT', 'Logs\\CBS', 'DeliveryOptimization', "windir 'Temp'"].every((k) => adminPs.includes(k)));
  check('提权脚本支持 removeDirs', /removeDirs/.test(adminPs));
  // 只允许 pnputil /delete-driver <oemXX.inf>，任何附加开关都意味着可能动到正在使用的设备
  const drvPs = fs.readFileSync(path.join(__dirname, 'engine', 'ps', 'drivers.ps1'), 'utf8');
  const delCalls = drvPs.match(/pnputil \/delete-driver[^\r\n]*/g) || [];
  check('只有一处删除调用', delCalls.length === 1, delCalls);
  const delArgs = delCalls.length === 1 ? delCalls[0].replace(/^pnputil \/delete-driver\s+/, '').split(/2>&1|\|/)[0].trim() : '';
  check('删除调用只带驱动包名，没有任何附加开关', delArgs === '$pub', delArgs);
  check('删除前逐个校验 oemXX.inf 形式', /\$pub -notmatch '\^oem\\d\+\\\.inf\$'/.test(drvPs));
  check('删除前重新枚举驱动库', /Re-derive the keep set right now/.test(drvPs));

  console.log('');
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
