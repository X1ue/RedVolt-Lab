'use strict';
// 1.3.0 「卖点落到界面」冒烟：首页承诺行 + 设置弹窗「本软件的承诺」清单
// 只读：不点任何写操作、不碰真实账本；窗口全程 show:false。
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

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEST = path.join(os.tmpdir(), `rv-promise-smoke-${Date.now()}`);
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

async function shot(win, name) {
  try {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(DEST, name), img.toPNG());
    log('shot ' + name);
  } catch (e) { errors.push('[shot] ' + (e && e.message)); }
}

async function probe(win) {
  win.webContents.on('console-message', (e, level, message) => { if (level >= 2) errors.push('[console] ' + message); });
  win.webContents.on('render-process-gone', (e, d) => errors.push('[render-gone] ' + JSON.stringify(d)));
  win.webContents.on('did-fail-load', (e, c, d, u) => errors.push('[fail-load] ' + c + ' ' + d + ' ' + u));

  const ev = (js) => win.webContents.executeJavaScript(js, true);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  await wait(2500);
  // 未同意免责声明时先把弹窗走掉（只点应用内已有入口，落进临时 userData）
  if (await ev('!document.getElementById("eulaModal").classList.contains("hidden")')) {
    await ev('(() => { const c = document.getElementById("eulaAck"); c.checked = true; c.dispatchEvent(new Event("change")); })()');
    await wait(200);
    await ev('document.getElementById("eulaEnter").click()');
    await wait(500);
  }
  expect('窗口全程隐藏', !win.isVisible());

  log('heroZh=' + (await ev('JSON.stringify((document.querySelector(".hero-promise")||{}).textContent)')));
  expect('首页有承诺行', await ev('!!document.querySelector(".hero-promise")'));
  expect('承诺行在 hero 副标题下', await ev('!!document.querySelector(".hero-sub + .hero-promise")'));
  expect('承诺行可见（有高度）', (await ev('document.querySelector(".hero-promise").getBoundingClientRect().height')) > 0);
  await shot(win, 'home-zh.png');

  await ev('document.getElementById("openSettings").click()');
  await wait(400);
  log('promiseRowsZh=' + (await ev('document.querySelectorAll("#settingsModal .set-promise li").length')));
  expect('设置里有承诺清单', await ev('!!document.querySelector("#settingsModal .set-promise")'));
  expect('承诺清单 6 条', (await ev('document.querySelectorAll("#settingsModal .set-promise li").length')) === 6);
  expect('清单在「当前版本」之前', await ev('!!document.querySelector("#settingsModal .set-promise + .set-row")'));
  log('promiseHeadZh=' + (await ev('JSON.stringify(document.querySelector("#settingsModal .set-promise h3").textContent)')));
  expect('设置弹窗已打开', !(await ev('document.getElementById("settingsModal").classList.contains("hidden")')));
  log('settingsBox=' + (await ev('JSON.stringify((() => { const b = document.querySelector("#settingsModal .modal-box"); return {w: Math.round(b.getBoundingClientRect().width), scrollH: b.scrollHeight, clientH: b.clientHeight, scrolls: b.scrollHeight > b.clientHeight + 2}; })())')));
  expect('承诺块有实际高度', (await ev('Math.round(document.querySelector("#settingsModal .set-promise").getBoundingClientRect().height)')) > 40);
  await shot(win, 'settings-zh.png');

  // 切英文：两块新文案必须整段命中 EXACT，不留中文
  await ev('(() => { const s = document.getElementById("langSel"); s.value = "en"; s.dispatchEvent(new Event("change")); })()');
  await wait(800);
  log('lang=' + (await ev('window.i18n.lang')));
  const enHero = await ev('document.querySelector(".hero-promise").textContent');
  log('heroEn=' + JSON.stringify(enHero));
  expect('承诺行翻成英文', !/[\u3400-\u9fff]/.test(enHero) && /No autostart/.test(enHero));
  const enRows = await ev('JSON.stringify([...document.querySelectorAll("#settingsModal .set-promise li")].map(x => x.textContent))');
  log('promiseRowsEn=' + enRows);
  expect('承诺清单全翻完', !/[\u3400-\u9fff]/.test(enRows));
  expect('清单仍是 6 条', JSON.parse(enRows).length === 6);
  log('promiseHeadEn=' + (await ev('JSON.stringify(document.querySelector("#settingsModal .set-promise h3").textContent)')));
  expect('标题翻成英文', (await ev('document.querySelector("#settingsModal .set-promise h3").textContent')) === 'What this app promises');
  await shot(win, 'settings-en.png');

  // 切回中文，验证还原（字典是双向记原值的，不能改坏）
  await ev('(() => { const s = document.getElementById("langSel"); s.value = "zh"; s.dispatchEvent(new Event("change")); })()');
  await wait(800);
  log('heroBack=' + (await ev('JSON.stringify(document.querySelector(".hero-promise").textContent)')));
  expect('切回中文还原', (await ev('document.querySelector(".hero-promise").textContent')) === '无自启 · 无遥测 · 无广告 ｜ 每一步都能撤销 ｜ 效果能量化');
  // 隐藏窗口的帧会滞后两三秒，最后再等一会儿截图，才能看到当前状态
  await wait(3000);
  await shot(win, 'settings-zh2.png');

  finish(problems.length ? 2 : 0);
}

let targetWin = null;
app.on('browser-window-created', (e, w) => { if (!targetWin) targetWin = w; });

app.whenReady().then(() => {
  const waitWin = () => {
    if (!targetWin) return setTimeout(waitWin, 200);
    probe(targetWin).catch((e) => { errors.push('[probe] ' + (e && e.stack ? e.stack : e)); finish(1); });
  };
  waitWin();
});

setTimeout(() => { if (!done && !targetWin) { errors.push('[no-window]'); finish(1); } }, 20000);

setTimeout(() => { errors.push('[timeout] 超过 120 秒未完成'); finish(1); }, 120000);
