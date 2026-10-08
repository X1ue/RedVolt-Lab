'use strict';
// test.19 冒烟：开发缓存白名单 + 系统残留项目 + WinSxS 卡片 + 旧驱动包卡片。
// 窗口全程隐藏（不抢前台），userData 指向临时目录，绝不触碰真实账本 / 注册表 / 电源计划。
// 只走「只读」和「拒绝 / 未确认」路径：不跑 DISM（会弹 UAC）、不删任何驱动包、不删任何文件。
// 唯一真实执行的系统调用是 pnputil /enum-drivers —— 它只读驱动库，不需要管理员权限。
// 隐藏窗口：electron 的导出属性不可重定义，所以在 Module._load 上包一层 Proxy，
// 让 main.js 拿到的 BrowserWindow 构造时强制 show:false。main.js 里没有任何 show() 调用，
// 所以整个冒烟过程不会浮到前台，也不会抢焦点。
const Module = require('module');
const origLoad = Module._load;
let bwProxy = null;
let hiddenOk = false;
Module._load = function (request) {
  const exp = origLoad.apply(this, arguments);
  if (request !== 'electron' || !exp || typeof exp.BrowserWindow !== 'function') return exp;
  if (!bwProxy) {
    const Real = exp.BrowserWindow;
    class Hidden extends Real {
      constructor(o) { super(Object.assign({}, o, { show: false })); }
    }
    bwProxy = new Proxy(exp, { get: (t, k) => (k === 'BrowserWindow' ? Hidden : Reflect.get(t, k)) });
    hiddenOk = true;
  }
  return bwProxy;
};

const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEST = path.join(os.tmpdir(), `rv-clean-smoke-${Date.now()}`);
fs.mkdirSync(DEST, { recursive: true });
app.setPath('userData', DEST);

require('./main.js');

const out = [];
const errors = [];
let done = false;

function log(...a) {
  const line = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  out.push(line);
  // 输出被 head 之类提前截断时 stdout 会 EPIPE，这是管道问题不是测试失败，别弹 Electron 错误框
  try { process.stdout.write(line + '\n'); } catch (e) { if (!e || e.code !== 'EPIPE') throw e; }
}
process.stdout.on('error', (e) => { if (!e || e.code !== 'EPIPE') throw e; });
function finish(code) {
  if (done) return;
  done = true;
  log('---- errors ----');
  log(errors.length ? errors.join('\n') : '(none)');
  setTimeout(() => app.exit(code), 200);
}

const problems = [];
const expect = (name, ok, extra) => { log((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  -> ' + JSON.stringify(extra))); if (!ok) problems.push(name); };

async function probe(win) {
  win.webContents.on('console-message', (e, level, message) => { if (level >= 2) errors.push('[console] ' + message); });
  win.webContents.on('render-process-gone', (e, d) => errors.push('[render-gone] ' + JSON.stringify(d)));
  win.webContents.on('did-fail-load', (e, c, d, u) => errors.push('[fail-load] ' + c + ' ' + d + ' ' + u));

  const ev = (js) => win.webContents.executeJavaScript(js, true);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  await wait(2500);
  log('hiddenWindow=' + hiddenOk);

  // 首启免责声明挡在前面，先过掉
  if (await ev('!document.getElementById("eulaModal").classList.contains("hidden")')) {
    await ev('(() => { const c = document.getElementById("eulaAck"); c.checked = true; c.dispatchEvent(new Event("change")); })()');
    await wait(200);
    await ev('document.getElementById("eulaEnter").click()');
    await wait(500);
  }
  expect('eulaPassed', await ev('document.getElementById("eulaModal").classList.contains("hidden")'));

  // ---------- 1. preload 暴露的新接口 ----------
  const missing = await ev(`JSON.stringify(["driversList","driversRemove","winsxsAnalyze","winsxsCleanup","onWinsxsProgress","ledgerList","settingsGet"].filter(k => typeof window.optimizer[k] !== "function"))`);
  log('missingApi=' + missing);
  expect('新增 IPC 全部暴露', JSON.parse(missing).length === 0);
  const p = await ev('window.optimizer.getPaths()');
  expect('账本落在临时目录', String(p.ledgerPath).startsWith(DEST), p.ledgerPath);

  // ---------- 2. 项目清单：开发缓存与系统残留 ----------
  const tlist = await ev('window.optimizer.listTargets()');
  expect('项目清单能读出来', Array.isArray(tlist) && tlist.length > 0, tlist && tlist.length);
  const byId = new Map(tlist.map((t) => [t.id, t]));

  // hideWhenMissing 的用户态项目：列出来的一定真的存在
  const config = require('./engine/config');
  const safety = require('./engine/safety');
  const devIds = config.targets.filter((t) => t.section === '开发工具缓存').map((t) => t.id);
  log('devIdsAll=' + devIds.length + ' devIdsShown=' + devIds.filter((id) => byId.has(id)).length);
  expect('开发缓存项目本机存在才显示', devIds.filter((id) => byId.has(id)).length >= 1 && devIds.length >= 10, { shown: devIds.filter((id) => byId.has(id)).length, all: devIds.length });

  // hideWhenMissing 的承诺是「本机没有就不显示」，所以列出来的这类项目必须真的存在。
  // 其余项目（更新器残留、NVIDIA GLCache 等）本来就该显示，扫完如实报「目标不存在」。
  let absent = null;
  let pathChecked = 0;
  for (const t of tlist) {
    const full = config.getTarget(t.id);
    if (!full || !full.hideWhenMissing || full.admin) continue;
    const paths = config.targetPaths(full);
    if (!paths.length) continue;
    pathChecked++;
    let any = false;
    for (const q of paths) { if (fs.existsSync(q)) { any = true; break; } }
    if (!any) { absent = { id: t.id, paths }; break; }
  }
  log('hideWhenMissingShown=' + pathChecked);
  expect('hideWhenMissing 的项目列出来就一定存在', absent === null, absent);
  expect('确实检查过一批真实路径', pathChecked >= 3, pathChecked);

  const shownDev = devIds.filter((id) => byId.has(id)).map((id) => byId.get(id));
  expect('开发缓存都带分组标签', shownDev.every((t) => t.section === '开发工具缓存'), shownDev.map((t) => t.section));
  expect('开发缓存默认不勾选', shownDev.every((t) => t.defaultChecked === false));
  expect('开发缓存都不隐藏系统级', shownDev.every((t) => !t.admin));

  const sysNew = ['windowsTemp', 'cbsLogs', 'deliveryOpt', 'windowsOld', 'windowsBt'];
  log('sysNewShown=' + JSON.stringify(sysNew.filter((id) => byId.has(id))));
  expect('系统残留项目全部出现在清单里（交给提权侧如实报告）', sysNew.every((id) => byId.has(id)), sysNew.filter((id) => !byId.has(id)));
  expect('系统残留项目默认不勾选', sysNew.filter((id) => byId.has(id)).every((id) => byId.get(id).defaultChecked === false));
  expect('系统残留项目都需要管理员', sysNew.filter((id) => byId.has(id)).every((id) => byId.get(id).admin === true));
  expect('windowsOld / windowsBt 是整目录删除', byId.get('windowsOld').kind === 'removeDirs' && byId.get('windowsBt').kind === 'removeDirs');
  expect('windowsOld / windowsBt 标为 caution', byId.get('windowsOld').level === 'caution' && byId.get('windowsBt').level === 'caution');

  const ids = tlist.map((t) => t.id);
  expect('项目 ID 不重复', new Set(ids).size === ids.length);

  // ---------- 3. 磁盘清理页渲染 ----------
  await ev('document.querySelector(\'.tab[data-tab="disk"]\').click()');
  await wait(1200);
  const secLabels = await ev('JSON.stringify([...document.querySelectorAll("#diskList .secLabel")].map(e => e.textContent))');
  log('secLabels=' + secLabels);
  expect('磁盘页出现分组标签', JSON.parse(secLabels).indexOf('开发工具缓存') >= 0, secLabels);
  const rowIds = await ev('JSON.stringify([...document.querySelectorAll("#diskList .row")].map(r => r.querySelector(".name").textContent))');
  const shownNames = JSON.parse(rowIds);
  log('diskRows=' + shownNames.length);
  const diskCount = ids.filter((id) => byId.get(id).group === 'disk').length;
  expect('渲染出来的项目数和清单一致', shownNames.length === diskCount, { shown: shownNames.length, list: diskCount });
  expect('开发缓存项目确实渲染出来了', shownDev.every((t) => shownNames.indexOf(t.name) >= 0), shownDev.map((t) => t.name));
  expect('默认勾选的不含开发缓存', shownDev.every((t) => !t.defaultChecked));
  await ev('document.getElementById("diskSelectSafe").click()');
  await wait(500);
  const checkedNames = await ev('JSON.stringify([...document.querySelectorAll("#diskList .row.checked .name")].map(e => e.textContent))');
  log('afterSelectSafe=' + checkedNames);
  const cn = JSON.parse(checkedNames);
  expect('「只勾选安全项」勾上了东西', cn.length > 0, cn);
  expect('「只勾选安全项」不会勾上开发缓存', shownDev.every((t) => cn.indexOf(t.name) < 0), cn);
  await ev('document.getElementById("diskSelectNone").click()');
  await wait(400);
  expect('清空勾选后一个都不剩', (await ev('document.querySelectorAll("#diskList .row.checked").length')) === 0);

  // ---------- 4. 系统页两张新卡片 ----------
  await ev('document.querySelector(\'.tab[data-tab="system"]\').click()');
  await wait(800);
  expect('卡片都在系统页里', (await ev('document.querySelectorAll("#tab-system .syscard").length')) >= 2);
  for (const id of ['wsAnalyze', 'wsClean', 'wsResetBase', 'wsBody', 'wsProgress', 'drvScan', 'drvClean', 'drvBody']) {
    expect('存在 #' + id, await ev(`!!document.getElementById("${id}")`));
  }
  expect('分析前清理按钮禁用', (await ev('document.getElementById("wsClean").disabled && document.getElementById("wsResetBase").disabled')) === true);
  expect('没勾选时删除按钮禁用', (await ev('document.getElementById("drvClean").disabled')) === true);
  expect('进度条初始隐藏', await ev('document.getElementById("wsProgress").classList.contains("hidden")'));
  log('wsBodyIdle=' + (await ev('document.getElementById("wsBody").textContent')).slice(0, 60));
  log('drvBodyIdle=' + (await ev('document.getElementById("drvBody").textContent')).slice(0, 60));
  expect('两张卡片都写了「还没做过什么」', (await ev('document.getElementById("wsBody").textContent')).length > 10 && (await ev('document.getElementById("drvBody").textContent')).length > 10);
  expect('WinSxS 卡片说明里提到 DISM 建议才允许清理', /DISM/.test(await ev('document.getElementById("tab-system").textContent')));
  expect('驱动卡片说明里提到不加 /force', /force/.test(await ev('document.getElementById("tab-system").textContent')));

  // ---------- 5. 真跑一次只读驱动扫描（pnputil /enum-drivers 不需要管理员） ----------
  const t0 = Date.now();
  await ev('document.getElementById("drvScan").click()');
  let drv = null;
  for (let i = 0; i < 40; i++) {
    await wait(1000);
    const rows = await ev('document.querySelectorAll("#drvBody .drv-row").length');
    if (rows > 0 || /没有发现重复|失败|出错/.test(await ev('document.getElementById("drvBody").textContent'))) break;
  }
  drv = await ev(`JSON.stringify({
    rows: document.querySelectorAll('#drvBody .drv-row').length,
    text: document.getElementById('drvBody').textContent.slice(0, 200),
    keeps: [...document.querySelectorAll('#drvBody .drv-keep')].map(e => e.textContent),
    olds: [...document.querySelectorAll('#drvBody .drv-sub:not(.drv-keep)')].map(e => e.textContent),
    boxes: document.querySelectorAll('#drvBody input[type=checkbox]').length,
    status: document.getElementById('status').textContent
  })`);
  const D = JSON.parse(drv);
  log('drvScanMs=' + (Date.now() - t0) + ' rows=' + D.rows);
  log('drvStatus=' + D.status);
  log('drvKeepSample=' + JSON.stringify(D.keeps.slice(0, 3)));
  log('drvOldSample=' + JSON.stringify(D.olds.filter((x) => /^可删/.test(x)).slice(0, 3)));
  expect('驱动扫描出了结果', D.rows > 0 || /没有发现重复/.test(D.text), D.text);
  if (D.rows > 0) {
    expect('每组都有复选框', D.boxes === D.rows, { boxes: D.boxes, rows: D.rows });
    expect('每组都写明保留哪个', D.keeps.length === D.rows && D.keeps.every((x) => /^保留 oem\d+\.inf/.test(x)), D.keeps.slice(0, 3));
    expect('保留行用半角括号（便于翻译）', D.keeps.every((x) => x.indexOf('（') < 0), D.keeps.slice(0, 2));
    expect('可删行都标了 inf 名', D.olds.filter((x) => /^可删/.test(x)).every((x) => /oem\d+\.inf/.test(x)));
    expect('状态栏报了总数与重复组数', /驱动库共 \d+ 个包，发现 \d+ 组重复、\d+ 个旧版本/.test(D.status), D.status);
    // 勾一个，删除按钮应该亮起来；但不点删除（会弹 UAC 且真的删东西）
    await ev('(() => { const c = document.querySelector("#drvBody input[type=checkbox]"); c.checked = true; c.dispatchEvent(new Event("change")); })()');
    await wait(400);
    expect('勾选后删除按钮可用', (await ev('document.getElementById("drvClean").disabled')) === false);
    await ev('(() => { const c = document.querySelector("#drvBody input[type=checkbox]"); c.checked = false; c.dispatchEvent(new Event("change")); })()');
    await wait(400);
    expect('取消勾选后删除按钮重新禁用', (await ev('document.getElementById("drvClean").disabled')) === true);
  }

  // ---------- 6. 未经确认 / 非法参数一律在提权之前被拒绝 ----------
  expect('未确认删驱动被拒', (await ev('window.optimizer.driversRemove(["oem1.inf"], false).then(r => r.ok === false && /未经确认/.test(r.message))')) === true);
  expect('非法驱动包名被过滤后直接返回', (await ev('window.optimizer.driversRemove(["bogus", "../../evil.inf"], true).then(r => r.ok === true && r.removed.length === 0 && /没有勾选/.test(r.message))')) === true);
  expect('空数组删驱动直接返回', (await ev('window.optimizer.driversRemove([], true).then(r => r.removed.length === 0)')) === true);
  expect('未确认清理组件存储被拒', (await ev('window.optimizer.winsxsCleanup("cleanup", false).then(r => r.ok === false && /未经确认/.test(r.message))')) === true);
  expect('未确认深度清理被拒', (await ev('window.optimizer.winsxsCleanup("cleanup-resetbase", false).then(r => r.ok === false && /未经确认/.test(r.message))')) === true);
  expect('未知清理方式被拒', (await ev('window.optimizer.winsxsCleanup("bogus", true).then(r => r.ok === false && /未知/.test(r.message))')) === true);
  expect('拒绝路径没有写账本', (await ev('window.optimizer.ledgerList(50).then(r => r.stats.total)')) === 0);
  expect('拒绝路径没有留下进度文件', fs.readdirSync(path.join(DEST, 'ipc')).filter((f) => /^winsxs-/.test(f)).length === 0);

  // ---------- 7. 白名单没被放宽 ----------
  const allowed = config.allowedRoots;
  log('allowedRoots=' + allowed.length);
  expect('允许根里没有整份用户目录', allowed.indexOf(os.homedir()) < 0);
  expect('允许根里没有整份 Code 目录', allowed.every((r) => !/\\Code$/.test(r)));
  const sysAllowed = config.systemAllowed;
  expect('系统白名单覆盖新加的路径', sysAllowed.some((r) => /Windows\.old$/.test(r)) && sysAllowed.some((r) => /WINDOWS\.~BT$/.test(r)) && sysAllowed.some((r) => /DeliveryOptimization\\Cache$/.test(r)));
  const baddies = [
    path.join(process.env.SystemDrive || 'C:', 'Windows', 'System32'),
    path.join(process.env.SystemDrive || 'C:', 'Windows', 'System32', 'config'),
    path.join(process.env.SystemDrive || 'C:', 'Windows', 'WinSxS'),
    path.join(process.env.SystemDrive || 'C:', 'Users'),
    path.join(process.env.windir || 'C:\\Windows'),
  ];
  for (const b of baddies) {
    const r = await safety.checkPath(b, { admin: true });
    expect('提权侧仍拒绝 ' + path.basename(b), typeof r === 'string' && r.length > 0, r);
  }
  const okOne = await safety.checkPath(path.join(process.env.windir || 'C:\\Windows', 'SoftwareDistribution', 'Download'), { admin: true });
  expect('更新下载目录仍放行（EPERM 不再被误判为不存在）', okOne === null || okOne === undefined || okOne === '', okOne);

  // ---------- 8. 英文界面：新增静态文案必须全部翻译 ----------
  await ev('(() => { const s = document.getElementById("setLang"); s.value = "en"; s.dispatchEvent(new Event("change")); })()');
  await wait(900);
  await ev('document.querySelector(\'.tab[data-tab="system"]\').click()');
  await wait(600);
  const leftSys = await ev(`(() => {
    const re = /[\\u3400-\\u9fff]/;
    const set = new Set();
    const collect = (root) => {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      let n = w.currentNode;
      while (n) { const v = (n.nodeValue || '').trim(); if (v && re.test(v)) set.add(v); n = w.nextNode(); }
      for (const e of root.querySelectorAll('[title],[placeholder]')) {
        for (const a of ['title','placeholder']) { const v = e.getAttribute(a); if (v && re.test(v)) set.add('[' + a + '] ' + v); }
      }
    };
    const sys = document.getElementById('tab-system').cloneNode(true);
    // 驱动扫描结果是运行时按真实数据拼的，只统计规模，不作为通过条件
    const db = sys.querySelector('#drvBody'); if (db) db.textContent = '';
    collect(sys);
    return JSON.stringify([...set]);
  })()`);
  const zhSys = JSON.parse(leftSys);
  log('remainingCJK_system=' + JSON.stringify(zhSys));
  expect('英文下系统页静态文案无残留中文', zhSys.length === 0, zhSys);

  await ev('document.querySelector(\'.tab[data-tab="disk"]\').click()');
  await wait(800);
  const leftDisk = await ev(`(() => {
    const re = /[\\u3400-\\u9fff]/;
    const set = new Set();
    const dl = document.getElementById('diskList').cloneNode(true);
    const w = document.createTreeWalker(dl, NodeFilter.SHOW_TEXT, null);
    let n = w.currentNode;
    while (n) { const v = (n.nodeValue || '').trim(); if (v && re.test(v)) set.add(v); n = w.nextNode(); }
    for (const e of dl.querySelectorAll('[title],[placeholder]')) {
      for (const a of ['title','placeholder']) { const v = e.getAttribute(a); if (v && re.test(v)) set.add('[' + a + '] ' + v); }
    }
    return JSON.stringify([...set]);
  })()`);
  const zhDisk = JSON.parse(leftDisk);
  log('remainingCJK_disk=' + zhDisk.length);
  zhDisk.slice(0, 10).forEach((x) => log('  ZH> ' + x.slice(0, 70)));
  expect('英文下磁盘页无残留中文', zhDisk.length === 0, zhDisk.slice(0, 10));

  // 驱动扫描的动态行：规模统计，不作为通过条件
  await ev('document.querySelector(\'.tab[data-tab="system"]\').click()');
  await wait(500);
  const leftDrv = await ev(`(() => {
    const re = /[\\u3400-\\u9fff]/;
    const set = new Set();
    const w = document.createTreeWalker(document.getElementById('drvBody'), NodeFilter.SHOW_TEXT, null);
    let n = w.currentNode;
    while (n) { const v = (n.nodeValue || '').trim(); if (v && re.test(v)) set.add(v); n = w.nextNode(); }
    return JSON.stringify([...set]);
  })()`);
  const zhDrv = JSON.parse(leftDrv);
  log('remainingCJK_driverRows=' + zhDrv.length + ' 条未翻译（按真实驱动数据动态拼接）');
  zhDrv.slice(0, 5).forEach((x) => log('  ZH> ' + x.slice(0, 70)));

  await ev('(() => { const s = document.getElementById("setLang"); s.value = "zh"; s.dispatchEvent(new Event("change")); })()');
  await wait(700);
  expect('切回中文正常', (await ev('document.getElementById("tab-system").textContent')).indexOf('组件存储 WinSxS') >= 0);
  expect('切回中文后侧栏也恢复', (await ev('document.querySelector(\'.tab[data-tab="system"]\').textContent')).indexOf('系统级清理') >= 0);

  // ---------- 9. 真实数据没被动过 ----------
  // 账本只在真的有改动时才落盘；这里要确认的是它「只会落在临时目录里」
  expect('账本路径在临时目录内', path.dirname(p.ledgerPath) === DEST, p.ledgerPath);
  expect('账本没有被写过（全程只读）', !fs.existsSync(p.ledgerPath) || fs.readFileSync(p.ledgerPath, 'utf8').trim() === '[]', fs.existsSync(p.ledgerPath) ? fs.readFileSync(p.ledgerPath, 'utf8').slice(0, 80) : '(未创建)');
  log('userDataFiles=' + JSON.stringify(fs.readdirSync(DEST)));
  expect('临时目录里生成了 userData 文件', fs.readdirSync(DEST).length > 0);
  expect('账本仍然是空的', (await ev('window.optimizer.ledgerList(50).then(r => r.stats.total)')) === 0);
  expect('窗口全程保持隐藏没抢前台', hiddenOk === true && win.isVisible() === false, { hiddenOk, visible: win.isVisible() });

  if (problems.length) log('problems=' + JSON.stringify(problems));
  finish(problems.length === 0 && errors.length === 0 ? 0 : 2);
}

// show:false 的窗口不会出现在 getAllWindows() 里，所以用 browser-window-created 事件抓
let targetWin = null;
app.on('browser-window-created', (e, w) => { if (!targetWin) targetWin = w; });

app.whenReady().then(() => {
  const waitWin = () => {
    if (!targetWin) return setTimeout(waitWin, 200);
    probe(targetWin).catch((e) => { errors.push('[probe] ' + (e && e.stack ? e.stack : e)); finish(1); });
  };
  waitWin();
});

// 加载期报错时 Electron 不会自己退出，留个硬超时免得白等
setTimeout(() => {
  if (!done && !targetWin) { errors.push('[no-window] 20 秒内没出现窗口，主进程可能加载失败'); finish(1); }
}, 20000);

setTimeout(() => { errors.push('[timeout] 超过 240 秒未完成'); finish(1); }, 240000);
