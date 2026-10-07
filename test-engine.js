'use strict';
// 引擎自测：只在我自己创建的沙盒目录里做删除验证，不碰任何真实数据
const fs = require('fs');
const os = require('os');
const path = require('path');

const safety = require('./engine/safety');
const clean = require('./engine/clean');
const config = require('./engine/config');
const scan = require('./engine/scan');

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

const sandbox = path.join(os.tmpdir(), 'sysopt-selftest');
const outside = path.join(os.tmpdir(), 'sysopt-selftest-outside');

function setup() {
  fs.rmSync(sandbox, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
  fs.mkdirSync(sandbox, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'precious.txt'), 'DO-NOT-DELETE');
  fs.writeFileSync(path.join(sandbox, 'a.tmp'), 'x'.repeat(2048));
  fs.writeFileSync(path.join(sandbox, 'thumbcache_99.db'), 'y'.repeat(1024));
  fs.mkdirSync(path.join(sandbox, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(sandbox, 'sub', 'b.tmp'), 'z'.repeat(512));
  fs.symlinkSync(outside, path.join(sandbox, 'link-to-outside'), 'junction');
}

(async () => {
  console.log('== 1. 安全门 checkPath ==');
  setup();
  check('沙盒目录（TEMP 内）允许', (await safety.checkPath(sandbox)) === null, await safety.checkPath(sandbox));
  check('不存在的路径被拒', (await safety.checkPath(path.join(sandbox, 'nope'))) === '不存在');
  check('系统目录被拒（越界）', (await safety.checkPath('C:\\Windows\\System32')) === '不在允许的清理范围内');
  check('junction 被拒', /重解析点/.test(String(await safety.checkPath(path.join(sandbox, 'link-to-outside')))));
  check('边界前缀不误判', safety.startsWithBoundary('C:\\Users\\demo\\AppData\\Local2\\x', 'C:\\Users\\demo\\AppData\\Local') === false);
  config.protectList.push(sandbox);
  check('保护清单生效', (await safety.checkPath(sandbox)) === '在保护清单中');
  config.protectList.pop();
  check('移出保护清单后恢复', (await safety.checkPath(sandbox)) === null);

  console.log('== 2. fileFilter 只删匹配项 ==');
  setup();
  let st = await clean.clearDirContents(sandbox, { fileFilter: /^thumbcache_.*\.db$/i });
  check('thumbcache 已删', !fs.existsSync(path.join(sandbox, 'thumbcache_99.db')));
  check('a.tmp 保留（不匹配过滤器）', fs.existsSync(path.join(sandbox, 'a.tmp')));
  check('目录本身保留', fs.existsSync(sandbox));
  check('junction 目标文件未被动', fs.readFileSync(path.join(outside, 'precious.txt'), 'utf8') === 'DO-NOT-DELETE');
  check('统计 freed>0', st.freed > 0, st);

  console.log('== 3. 无过滤器全清 ==');
  st = await clean.clearDirContents(sandbox);
  check('a.tmp 已删', !fs.existsSync(path.join(sandbox, 'a.tmp')));
  check('子目录已删', !fs.existsSync(path.join(sandbox, 'sub')));
  check('junction 本身已删', !fs.existsSync(path.join(sandbox, 'link-to-outside')));
  check('junction 目标仍完好', fs.readFileSync(path.join(outside, 'precious.txt'), 'utf8') === 'DO-NOT-DELETE');
  check('目录本身保留', fs.existsSync(sandbox));

  console.log('== 4. cleanTarget 对不存在目标是安全 no-op ==');
  const r = await clean.cleanTarget('updaterResidue');
  check('返回 status 非 done 或无删除', ['done', 'skipped'].includes(r.status), r);
  check('沙盒未被波及', fs.existsSync(path.join(outside, 'precious.txt')));

  console.log('== 5. 扫描只读性 ==');
  setup();
  const before = fs.readdirSync(sandbox).length;
  const sres = await scan.scanTarget('tempOld');
  check('scanTarget 返回结构', sres && sres.id === 'tempOld' && typeof sres.size === 'number', sres);
  check('扫描未删除沙盒内容', fs.readdirSync(sandbox).length === before);
  const sysres = await scan.scanTarget('windowsUpdateCache');
  check('系统级目标需管理员（不直接读）', sysres.status === 'needs-admin', sysres);

  console.log('== 6. winsxs.spent 时长文案 ==');
  const winsxs = require('./engine/winsxs');
  check('42 秒只报秒', winsxs.spent(42) === '42 秒', winsxs.spent(42));
  check('0.4 秒不显示成 0', winsxs.spent(0.4) === '1 秒', winsxs.spent(0.4));
  check('缺字段按 1 秒处理', winsxs.spent(undefined) === '1 秒', winsxs.spent(undefined));
  check('59 秒仍是秒', winsxs.spent(59.4) === '59 秒', winsxs.spent(59.4));
  check('60 秒进分', winsxs.spent(60) === '1 分 0 秒', winsxs.spent(60));
  check('192 秒 = 3 分 12 秒', winsxs.spent(192) === '3 分 12 秒', winsxs.spent(192));
  check('不满一分钟不四舍五入成整分钟', winsxs.spent(90) === '1 分 30 秒', winsxs.spent(90));

  console.log('== 7. 性能基线：对比行与 winsat 报告取数 ==');
  const baseline = require('./engine/baseline');
  const GB = 1073741824;
  const snap = (o) => ({
    memFree: o.mem,
    disks: (o.disks || []).map((d) => ({ device: d[0], label: '', free: d[1], total: 10 * GB })),
    lastBoot: null,
    bench: o.bench ? { value: o.bench, units: 'MB/s' } : null,
    benchError: o.err || null,
  });
  const rows = baseline.compare(
    snap({ mem: 4 * GB, disks: [['C:', 10 * GB]], bench: 20 }),
    snap({ mem: 6 * GB, disks: [['C:', 8 * GB], ['D:', 1 * GB]], bench: 30 })
  );
  const row = (k) => rows.find((r) => r.key === k);
  check('三行齐全：内存 / C 盘 / 4K', rows.length === 4 && !!row('memFree') && !!row('disk:C:') && !!row('bench'), rows.map((r) => r.key));
  check('空闲内存 +2 GB', row('memFree').diff === 2 * GB, row('memFree'));
  check('C 盘可用 -2 GB', row('disk:C:').diff === -2 * GB, row('disk:C:'));
  check('4K 随机读 +10 MB/s', row('bench').diff === 10 && row('bench').units === 'MB/s', row('bench'));
  check('新出现的盘位另一侧留 null，不当成 0', row('disk:D:').before === null && row('disk:D:').diff === null, row('disk:D:'));
  const noBench = baseline.compare(snap({ mem: 1, err: 'needs-admin' }), snap({ mem: 2 })).find((r) => r.key === 'bench');
  check('缺基准值时 bench 行标出读不到的原因', noBench.missing === 'before:needs-admin', noBench);
  check('两侧都缺时 diff 是 null 而不是 NaN', noBench.diff === null, noBench);
  check('baseline 为空也出得来行', baseline.compare(null, null).length === 2 && baseline.compare(null, null).every((r) => r.diff === null));
  check('认得 winsat 的 RandomDisk4kRead', baseline.pickBench([
    { name: 'SequentialDisk64kRead', value: 500, units: 'MB/s' },
    { name: 'RandomDisk4kRead', value: 37.5, units: 'MB/s' },
  ]).value === 37.5);
  check('名称带连字符也能归一化命中', baseline.pickBench([{ name: 'random-disk-4k-read', value: 12, units: 'MB/s' }]).value === 12);
  check('只有写测试时不误返回读值', baseline.pickBench([{ name: 'RandomDisk4kWrite', value: 9, units: 'MB/s' }]) === null);
  check('空报告返回 null', baseline.pickBench([]) === null && baseline.pickBench(undefined) === null);

  console.log('== 8. HAGS：改了还没重启的判定 ==');
  const game = require('./engine/game');
  const T0 = 1700000000000;
  check('改动晚于开机 = 还没生效', game.pendingRebootAt(T0 + 60000, T0) === true);
  check('改动早于开机 = 已经生效', game.pendingRebootAt(T0 - 60000, T0) === false);
  check('改动正好等于开机不算 pending', game.pendingRebootAt(T0, T0) === false);
  check('没有时间戳就不猜', game.pendingRebootAt(0, T0) === false && game.pendingRebootAt(NaN, T0) === false);
  check('开机时间算不出来就不猜', game.pendingRebootAt(T0 + 1, NaN) === false);
  check('最近一次改动取 changes', game.lastChangedAt({ changes: { hags: T0 + 5 }, items: { hags: { at: T0 } } }, 'hags') === T0 + 5);
  check('老备份没有 changes 时退回首次备份时间', game.lastChangedAt({ items: { hags: { at: T0 } } }, 'hags') === T0);
  check('没改过的开关返回 0（不会误报 pending）', game.lastChangedAt(null, 'hags') === 0 && game.lastChangedAt({ items: {} }, 'hags') === 0);
  check('bootAt 落在合理范围', Math.abs((Date.now() - game.bootAt()) - os.uptime() * 1000) < 5000);
  check('白名单里只有 hags 需要重启', game.SWITCHES.filter((s) => s.reboot).map((s) => s.id).join(',') === 'hags');

  fs.rmSync(sandbox, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('ERROR ' + (e && e.stack || e)); process.exit(2); });
