'use strict';
// 1.3.0 体检报告双语文案冒烟：真机跑一次「快速体检」（只读、不弹 UAC），
// 断言英文界面下没有中文残留、没有漏翻的模板 key，切回中文能重新渲染。
const Module = require('module');
const origLoad = Module._load;
let bwProxy = null;
Module._load = function (request) {
  const exp = origLoad.apply(this, arguments);
  if (request !== 'electron' || !exp || typeof exp.BrowserWindow !== 'function') return exp;
  if (!bwProxy) {
    const Real = exp.BrowserWindow;
    class Hidden extends Real {
      constructor(o) { super(Object.assign({}, o, { show: false })); }
    }
    bwProxy = new Proxy(exp, { get: (t, k) => (k === 'BrowserWindow' ? Hidden : Reflect.get(t, k)) });
  }
  return bwProxy;
};

const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEST = path.join(os.tmpdir(), `rv-health-i18n-${Date.now()}`);
fs.mkdirSync(DEST, { recursive: true });
app.setPath('userData', DEST);

require('./main.js');

const errors = [];
let done = false;
function log(...a) {
  const line = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  try { process.stdout.write(line + '\n'); } catch (e) { if (!e || e.code !== 'EPIPE') throw e; }
}
process.stdout.on('error', (e) => { if (!e || e.code !== 'EPIPE') throw e; });
const problems = [];
const expect = (name, ok, extra) => {
  log((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  -> ' + JSON.stringify(extra)));
  if (!ok) problems.push(name);
};
function finish(code) {
  if (done) return;
  done = true;
  log('---- errors ----');
  log(errors.length ? errors.join('\n') : '(none)');
  log('结果: ' + (code === 0 ? '全部通过' : '有失败项'));
  setTimeout(() => app.exit(code), 200);
}

let targetWin = null;
app.on('browser-window-created', (e, w) => { if (!targetWin) targetWin = w; });

async function probe(win) {
  win.webContents.on('console-message', (e, level, message) => { if (level >= 2) errors.push('[console] ' + message); });
  win.webContents.on('render-process-gone', (e, d) => errors.push('[render-gone] ' + JSON.stringify(d)));
  const ev = (js) => win.webContents.executeJavaScript(js, true);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  await wait(2500);
  if (await ev('!document.getElementById("eulaModal").classList.contains("hidden")')) {
    await ev('(() => { const c = document.getElementById("eulaAck"); c.checked = true; c.dispatchEvent(new Event("change")); })()');
    await wait(200);
    await ev('document.getElementById("eulaEnter").click()');
    await wait(500);
  }
  expect('窗口全程隐藏', !win.isVisible());

  // 先切英文，再体检：渲染时必须按当前语言出模板
  await ev('(() => { const s = document.getElementById("langSel"); s.value = "en"; s.dispatchEvent(new Event("change")); })()');
  await wait(600);
  await ev('document.getElementById("homeHealth").click()');
  await wait(300);
  await ev('document.getElementById("healthQuick").click()');
  for (let i = 0; i < 60; i++) {
    await wait(1000);
    if ((await ev('document.querySelectorAll("#healthBody .finding").length')) > 0) break;
  }
  const n = await ev('document.querySelectorAll("#healthBody .finding").length');
  log('findings=' + n);
  expect('体检有结论', n > 0);
  log('countsEn=' + (await ev('JSON.stringify(document.getElementById("healthCounts").textContent)')));
  expect('计数行是英文', !/[\u3400-\u9fff]/.test(await ev('document.getElementById("healthCounts").textContent')));

  const body = await ev('document.getElementById("healthBody").textContent');
  const cjk = (body.match(/[\u3400-\u9fff]+/g) || []);
  log('bodyCJK=' + JSON.stringify(cjk.slice(0, 12)));
  expect('英文界面下正文没有中文', cjk.length === 0, cjk.slice(0, 8));
  const leaked = body.match(/[a-z][A-Za-z]*(Title|Detail|Tip)[A-Za-z]*/g) || [];
  log('leakedKeys=' + JSON.stringify(leaked.slice(0, 10)));
  expect('没有漏翻的模板 key', leaked.length === 0, leaked.slice(0, 6));
  const groups = await ev('JSON.stringify([...document.querySelectorAll("#healthBody .fgroup")].map(x => x.textContent))');
  log('groupsEn=' + groups);
  expect('分组标签已本地化', !/[\u3400-\u9fff]/.test(groups), groups);
  const sevs = await ev('JSON.stringify([...document.querySelectorAll("#healthBody .fsev")].map(x => x.textContent))');
  log('sevEn=' + sevs);
  expect('严重度标签已本地化', !/[\u3400-\u9fff]/.test(sevs), sevs);
  const tips = await ev('JSON.stringify([...document.querySelectorAll("#healthBody .ftip")].map(x => x.textContent.slice(0,60)))');
  log('tipsEn=' + tips);
  expect('建议行前缀是英文', !/[\u3400-\u9fff]/.test(tips), tips);
  log('sampleEn=' + (await ev('JSON.stringify([...document.querySelectorAll("#healthBody .finding")].slice(0,3).map(x => x.textContent.slice(0,150)))')));

  // 切回中文：同一份结论要重新渲染成中文
  await ev('(() => { const s = document.getElementById("langSel"); s.value = "zh"; s.dispatchEvent(new Event("change")); })()');
  await wait(900);
  const bodyZh = await ev('document.getElementById("healthBody").textContent');
  log('sampleZh=' + JSON.stringify(bodyZh.slice(0, 160)));
  expect('切回中文重新渲染', /[\u3400-\u9fff]/.test(bodyZh) && /空间|性能|系统|显卡|启动/.test(bodyZh));
  expect('条目数不变', (await ev('document.querySelectorAll("#healthBody .finding").length')) === n);

  expect('没有产生变更账本', !fs.existsSync(path.join(DEST, 'changes-ledger.json')));
  finish(problems.length === 0 && errors.length === 0 ? 0 : 2);
}

app.whenReady().then(() => {
  const waitWin = () => {
    if (!targetWin) return setTimeout(waitWin, 200);
    probe(targetWin).catch((e) => { errors.push('[probe] ' + (e && e.stack ? e.stack : e)); finish(1); });
  };
  waitWin();
});

setTimeout(() => { if (!done && !targetWin) { errors.push('[no-window]'); finish(1); } }, 20000);
setTimeout(() => { errors.push('[timeout] 超过 180 秒未完成'); finish(1); }, 180000);
