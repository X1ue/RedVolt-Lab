'use strict';
// test.18 冒烟：记录与撤销页 + 只读体检弹窗 + 还原点状态 + 新增设置项。
// 窗口全程隐藏（不抢前台），userData 指向临时目录，绝不触碰真实账本 / 注册表 / 电源计划。
// 只走「读取」和「拒绝 / 取消」路径：不建还原点、不跑深度体检（会弹 UAC）、不撤销真实改动。
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

const DEST = path.join(os.tmpdir(), `rv-ledger-smoke-${Date.now()}`);
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
  const missing = await ev(`JSON.stringify(["ledgerList","ledgerUndo","ledgerUndoAll","healthQuick","healthDeep","healthExport","restorePointStatus","restorePointCreate","onHealthProgress","onRestorePointState"].filter(k => typeof window.optimizer[k] !== "function"))`);
  log('missingApi=' + missing);
  expect('新增 IPC 全部暴露', JSON.parse(missing).length === 0);
  const p = await ev('window.optimizer.getPaths()');
  expect('paths 含账本路径', !!p.ledgerPath && p.ledgerPath.endsWith('changes-ledger.json'), p.ledgerPath);
  expect('账本落在临时目录', String(p.ledgerPath).startsWith(DEST), p.ledgerPath);

  // ---------- 2. 记录与撤销页结构 ----------
  await ev('document.querySelector(\'.tab[data-tab="log"]\').click()');
  await wait(800);
  log('railLabel=' + (await ev('document.querySelector(\'.tab[data-tab="log"]\').textContent')));
  expect('侧栏改名为记录与撤销', (await ev('document.querySelector(\'.tab[data-tab="log"]\').textContent')).indexOf('记录与撤销') >= 0);
  for (const id of ['ledgerRefresh', 'ledgerUndoAll', 'rpCreate', 'rpStatus', 'ledgerStats', 'rpState', 'ledgerList', 'logRefresh', 'logOpen', 'logPath', 'logBody']) {
    expect('存在 #' + id, await ev(`!!document.getElementById("${id}")`));
  }
  log('ledgerEmpty=' + (await ev('document.getElementById("ledgerList").textContent')));
  expect('空账本有提示文案', (await ev('document.getElementById("ledgerList").textContent')).length > 0);
  expect('日志区仍在', (await ev('document.getElementById("logBody").textContent.length')) >= 0);

  // ---------- 3. 未经确认一律拒绝 ----------
  expect('未确认撤销被拒', (await ev('window.optimizer.ledgerUndo("whatever").then(r => r.ok === false && /未经确认/.test(r.message))')) === true);
  expect('未确认全部撤销被拒', (await ev('window.optimizer.ledgerUndoAll().then(r => r.ok === false && /未经确认/.test(r.message))')) === true);
  expect('不存在的记录被拒', (await ev('window.optimizer.ledgerUndo("no-such-id", true).then(r => r.ok === false && /找不到/.test(r.message))')) === true);

  // ---------- 4. 注入假记录，验证渲染与撤销失败标注（不碰系统） ----------
  // 注意：这里不能再 ledger.init()，否则会清掉 main.js 注入的真实依赖
  const ledger = require('./engine/ledger');
  expect('账本已由主进程初始化', String(ledger.getPath()).startsWith(DEST), ledger.getPath());
  const e1 = ledger.record({ source: '冒烟测试', label: '不可撤销的删除', undo: null, undoHint: '删除的文件无法恢复' });
  const e2 = ledger.record({ source: '冒烟测试', label: '撤销类型未知', undo: { type: 'no-such-type' } });
  ledger.record({ source: '冒烟测试', label: '可撤销的开关', undo: { type: 'game', ids: ['hags'] } });
  expect('记录带唯一 ID', e1.id !== e2.id && !!e1.id);
  await ev('document.getElementById("ledgerRefresh").click()');
  await wait(900);
  log('ledgerStats=' + (await ev('document.getElementById("ledgerStats").textContent')));
  log('ledgerRows=' + JSON.stringify(await ev('JSON.stringify([...document.querySelectorAll("#ledgerList .lrow")].map(r => ({ t: r.querySelector(".ltitle").textContent, src: r.querySelector(".lsrc").textContent, hint: r.querySelector(".lhint").textContent, acts: [...r.querySelectorAll(".lacts > *")].map(b => b.textContent) })))')));
  expect('三条记录都渲染', (await ev('document.querySelectorAll("#ledgerList .lrow").length')) === 3);
  expect('最新在最上面', /可撤销的开关/.test(await ev('document.querySelector("#ledgerList .lrow .ltitle").textContent')));
  expect('来源单独成列', (await ev('document.querySelector("#ledgerList .lrow .lsrc").textContent')) === '冒烟测试');
  const actsMap = await ev('JSON.stringify([...document.querySelectorAll("#ledgerList .lrow")].map(r => r.querySelector(".ltitle").textContent.replace(r.querySelector(".lsrc").textContent,"") + " => " + [...r.querySelectorAll(".lacts > *")].map(b => b.textContent).join("/")))');
  log('actsMap=' + actsMap);
  expect('不可撤销的显示「无法撤销」而非按钮', /不可撤销的删除 => 无法撤销/.test(actsMap), actsMap);
  expect('可撤销的显示撤销按钮', /可撤销的开关 => 撤销/.test(actsMap), actsMap);
  expect('不可撤销的写明原因', /删除的文件无法恢复/.test(await ev('document.getElementById("ledgerList").textContent')));
  const statsText = await ev('document.getElementById("ledgerStats").textContent');
  expect('统计条含总数', /共 3 条/.test(statsText), statsText);
  expect('统计条含可撤销数', /可撤销 2/.test(statsText), statsText);

  // 撤销「类型未知」这条：确认弹窗 → 确定 → 应标为失败，且不调用任何系统写接口
  await ev('(() => { const row = [...document.querySelectorAll("#ledgerList .lrow")].find(r => /撤销类型未知/.test(r.querySelector(".ltitle").textContent)); row.querySelector("button").click(); })()');
  await wait(500);
  expect('撤销前弹确认框', await ev('!document.getElementById("modal").classList.contains("hidden")'));
  log('undoModal=' + JSON.stringify(await ev('JSON.stringify({t:document.getElementById("modalTitle").textContent,d:document.getElementById("modalDesc").textContent.slice(0,120),ok:document.getElementById("modalOk").textContent,ackHidden:document.getElementById("modalAckWrap").classList.contains("hidden")})')));
  expect('单条撤销不需要勾选确认', await ev('document.getElementById("modalAckWrap").classList.contains("hidden")'));
  expect('确认按钮文案是确认撤销', (await ev('document.getElementById("modalOk").textContent')) === '确认撤销');
  await ev('document.getElementById("modalOk").click()');
  await wait(1500);
  log('afterUndo=' + JSON.stringify(await ev('JSON.stringify([...document.querySelectorAll("#ledgerList .lrow")].map(r => ({ cls: r.className, t: r.querySelector(".ltitle").textContent, err: (r.querySelector(".lerr")||{}).textContent, acts: [...r.querySelectorAll(".lacts > *")].map(b => b.textContent) })))')));
  expect('失败的记录被标为 failed', (await ev('document.querySelectorAll("#ledgerList .lrow.failed").length')) === 1);
  expect('失败原因写进界面', /未知的撤销类型/.test(await ev('document.getElementById("ledgerList").textContent')));
  expect('失败后留着重试按钮', /重试/.test(await ev('JSON.stringify([...document.querySelectorAll("#ledgerList .lrow.failed .lacts > *")].map(b => b.textContent))')));
  expect('状态栏报撤销失败', /撤销失败/.test(await ev('document.getElementById("status").textContent')));
  expect('失败计入统计', /撤销失败 1/.test(await ev('document.getElementById("ledgerStats").textContent')));
  expect('系统没有被动过（假类型不触发任何写操作）', (await ev('window.optimizer.ledgerList(50).then(r => r.stats.undone)')) === 0);

  // 全部撤销：只验证确认框能取消，取消后不动记录
  await ev('document.getElementById("ledgerUndoAll").click()');
  await wait(600);
  expect('全部撤销弹确认框', await ev('!document.getElementById("modal").classList.contains("hidden")'));
  log('undoAllModal=' + JSON.stringify(await ev('JSON.stringify({t:document.getElementById("modalTitle").textContent,d:document.getElementById("modalDesc").textContent.slice(0,200),ack:document.getElementById("modalAckWrap").textContent,okDisabled:document.getElementById("modalOk").disabled,items:document.querySelectorAll("#modalList > *").length})')));
  expect('全部撤销必须勾选确认', await ev('!document.getElementById("modalAckWrap").classList.contains("hidden") && document.getElementById("modalOk").disabled')) === true;
  expect('列出了将要撤销的条目', (await ev('document.querySelectorAll("#modalList > *").length')) >= 1);
  await ev('(() => { const a = document.getElementById("modalAck"); a.checked = true; a.dispatchEvent(new Event("change")); })()');
  await wait(300);
  expect('勾选后确认按钮可用', await ev('!document.getElementById("modalOk").disabled')) === true;
  await ev('document.getElementById("modalCancel").click()');
  await wait(500);
  expect('取消后没有撤销任何东西', (await ev('window.optimizer.ledgerList(50).then(r => r.stats.undone)')) === 0);

  // ---------- 5. 还原点：只验证入口存在，不点击（点击会弹 UAC，留给真人试用） ----------
  expect('存在还原点按钮', await ev('!!document.getElementById("rpCreate") && !!document.getElementById("rpStatus")'));
  expect('默认关闭自动还原点', (await ev('window.optimizer.settingsGet().then(s => s.autoRestorePoint === true)')) === false);
  expect('状态行初始为空', (await ev('document.getElementById("rpState").textContent')) === '');
  expect('availability 是纯函数', typeof require('./engine/restorepoint').availability === 'function');

  // ---------- 6. 只读体检弹窗 ----------
  expect('首页有只读体检入口', await ev('!!document.getElementById("homeHealth")'));
  await ev('document.querySelector(\'.tab[data-tab="home"]\').click()');
  await wait(600);
  await ev('document.getElementById("homeHealth").click()');
  await wait(600);
  expect('体检弹窗打开', await ev('!document.getElementById("healthModal").classList.contains("hidden")'));
  for (const id of ['healthQuick', 'healthDeep', 'healthExport', 'healthCounts', 'healthBody', 'healthClose']) {
    expect('存在 #' + id, await ev(`!!document.getElementById("${id}")`));
  }
  log('healthIdle=' + (await ev('document.getElementById("healthBody").textContent')).slice(0, 80));
  expect('体检前显示待运行提示', (await ev('document.getElementById("healthBody").textContent')).length > 0);

  await ev('document.getElementById("healthQuick").click()');
  for (let i = 0; i < 60; i++) { await wait(1000); if ((await ev('document.querySelectorAll("#healthBody .finding").length')) > 0) break; }
  const findings = await ev('JSON.stringify([...document.querySelectorAll("#healthBody .finding")].map(f => ({ sev: f.className, g: (f.querySelector(".fgroup")||{}).textContent, t: f.querySelector(".ftitle").textContent })))');
  log('healthCounts=' + (await ev('document.getElementById("healthCounts").textContent')));
  log('healthFindings=' + findings);
  const arr = JSON.parse(findings);
  expect('快速体检出了结论', arr.length >= 5, arr.length);
  expect('每条都有严重级别样式', arr.every((x) => /risk|warn|info|good/.test(x.sev)), arr.map((x) => x.sev));
  expect('每条都有分组与标题', arr.every((x) => x.g && x.t));
  const counts = await ev('document.getElementById("healthCounts").textContent');
  const nums = (counts.match(/\d+/g) || []).map(Number);
  expect('计数条标注为快速体检', /快速/.test(counts), counts);
  expect('计数条四项相加等于结论数', nums.reduce((a, b) => a + b, 0) === arr.length, { counts, nums, n: arr.length });
  expect('导出按钮体检后才出现', await ev('!document.getElementById("healthExport").classList.contains("hidden")'));
  log('healthDetailSample=' + JSON.stringify(await ev('JSON.stringify([...document.querySelectorAll("#healthBody .finding")].slice(0,2).map(f => ({ t: f.querySelector(".ftitle").textContent, d: (f.querySelector(".fdetail")||{}).textContent, tip: (f.querySelector(".ftip")||{}).textContent })))')));
  expect('风险类排在最前', arr.every((x, i) => x.sev !== 'risk' || arr.slice(0, i).every((y) => y.sev === 'risk')));
  expect('同盘事实被报出来', /同一块物理盘/.test(await ev('document.getElementById("healthBody").textContent')));
  expect('体检结论可选中复制', (await ev('getComputedStyle(document.querySelector("#healthBody .fdetail") || document.body).userSelect')) !== 'none');
  await ev('document.getElementById("healthClose").click()');
  await wait(400);
  expect('体检弹窗可关闭', await ev('document.getElementById("healthModal").classList.contains("hidden")'));
  expect('体检不写账本', (await ev('window.optimizer.ledgerList(50).then(r => r.stats.total)')) === 3);

  // ---------- 7. 新设置项：一键优化前先建还原点 ----------
  await ev('document.getElementById("openSettings").click()');
  await wait(400);
  expect('存在 #setRestorePoint', await ev('!!document.getElementById("setRestorePoint")'));
  const before = await ev('window.optimizer.settingsGet().then(s => s.autoRestorePoint)');
  log('autoRestorePointBefore=' + before);
  await ev('(() => { const c = document.getElementById("setRestorePoint"); c.checked = true; c.dispatchEvent(new Event("change")); })()');
  await wait(500);
  expect('打开后写入设置', (await ev('window.optimizer.settingsGet().then(s => s.autoRestorePoint)')) === true);
  await ev(`(() => { const c = document.getElementById("setRestorePoint"); c.checked = ${before === true}; c.dispatchEvent(new Event("change")); })()`);
  await wait(400);
  expect('设置已还原', (await ev('window.optimizer.settingsGet().then(s => s.autoRestorePoint)')) === (before === true));
  await ev('document.getElementById("settingsClose").click()');
  await wait(300);

  // ---------- 8. 英文界面：新增静态文案必须全部翻译 ----------
  await ev('(() => { const s = document.getElementById("langSel"); s.value = "en"; s.dispatchEvent(new Event("change")); })()');
  await wait(800);
  await ev('document.querySelector(\'.tab[data-tab="log"]\').click()');
  await wait(900);
  const leftStatic = await ev(`(() => {
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
    const lg = document.getElementById('tab-log').cloneNode(true);
    for (const id of ['ledgerList','logBody','logPath','rpState']) { const e = lg.querySelector('#' + id); if (e) e.textContent = ''; }
    collect(lg);
    const hm = document.getElementById('healthModal').cloneNode(true);
    const hb = hm.querySelector('#healthBody'); if (hb) hb.textContent = '';
    collect(hm);
    return JSON.stringify([...set]);
  })()`);
  const zhStatic = JSON.parse(leftStatic);
  log('remainingCJK_static=' + JSON.stringify(zhStatic));
  expect('英文下新增静态文案无残留中文', zhStatic.length === 0);
  // 体检结论是运行时按真实数据拼出来的，先只统计规模，不作为通过条件
  await ev('document.getElementById("homeHealth").click()');
  await wait(400);
  await ev('document.getElementById("healthQuick").click()');
  for (let i = 0; i < 60; i++) { await wait(1000); if ((await ev('document.querySelectorAll("#healthBody .finding").length')) > 0) break; }
  const leftDyn = await ev(`(() => {
    const re = /[\\u3400-\\u9fff]/;
    const set = new Set();
    const w = document.createTreeWalker(document.getElementById('healthBody'), NodeFilter.SHOW_TEXT, null);
    let n = w.currentNode;
    while (n) { const v = (n.nodeValue || '').trim(); if (v && re.test(v)) set.add(v); n = w.nextNode(); }
    return JSON.stringify([...set]);
  })()`);
  const zhDyn = JSON.parse(leftDyn);
  log('remainingCJK_health=' + zhDyn.length + ' 条未翻译（体检结论按真实数据动态拼接）');
  zhDyn.slice(0, 6).forEach((x) => log('  ZH> ' + x.slice(0, 70)));
  await ev('document.getElementById("healthClose").click()');
  await wait(300);
  await ev('(() => { const s = document.getElementById("langSel"); s.value = "zh"; s.dispatchEvent(new Event("change")); })()');
  await wait(600);
  expect('切回中文正常', (await ev('document.querySelector(\'.tab[data-tab="log"]\').textContent')).indexOf('记录与撤销') >= 0);

  // ---------- 9. 真实数据没被动过 ----------
  const files = fs.readdirSync(DEST);
  log('userDataFiles=' + JSON.stringify(files));
  expect('临时目录之外没写账本', files.includes('changes-ledger.json'));
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
