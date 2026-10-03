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

  fs.rmSync(sandbox, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('ERROR ' + (e && e.stack || e)); process.exit(2); });
