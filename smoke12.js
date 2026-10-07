'use strict';
// 1.2.0 #7 冒烟：点 ✕ / Alt+F4 时用自绘弹窗询问「最小化到后台 / 彻底退出」，
// 勾了「记住我的选择」就不再问，软件设置里能一键恢复重新询问。
// 全程只动界面和临时 userData：不写注册表、不删文件、不弹 UAC、不让窗口真的出现在桌面上。
// 窗口用 show:false 创建；Tray 包一层只记录构造与监听，绝不模拟点击（那会把窗口显示到他桌面上）。
const Module = require('module');
const origLoad = Module._load;
const trays = [];
let bwProxy = null;
let hiddenOk = false;
Module._load = function (request) {
  const exp = origLoad.apply(this, arguments);
  if (request !== 'electron' || !exp || typeof exp.BrowserWindow !== 'function') return exp;
  if (!hiddenOk) {
    const RealBW = exp.BrowserWindow;
    const RealTray = exp.Tray;
    class Hidden extends RealBW {
      constructor(o) { super(Object.assign({}, o, { show: false })); }
    }
    class SpyTray extends RealTray {
      constructor(o) { super(o); trays.push(this); }
    }
    bwProxy = new Proxy(exp, {
      get: (t, k) => (k === 'BrowserWindow' ? Hidden : k === 'Tray' ? SpyTray : Reflect.get(t, k)),
    });
    hiddenOk = true;
  }
  return bwProxy;
};

const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEST = path.join(os.tmpdir(), `rv-close-smoke-${Date.now()}`);
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
  log(code === 0 ? '结果: 全部通过' : '结果: 有失败项');
  app.exit(code);
}

const problems = [];
const expect = (name, ok, extra) => {
  log((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  -> ' + JSON.stringify(extra)));
  if (!ok) problems.push(name);
};
const CJK = /[\u3400-\u9fff]/;

let targetWin = null;
let closedSeen = false;
let hideCalls = 0;

app.on('browser-window-created', (e, w) => {
  if (targetWin) return;
  targetWin = w;
  w.on('closed', () => { closedSeen = true; });
});

async function probe(win) {
  win.webContents.on('console-message', (e, level, message) => { if (level >= 2) errors.push('[console] ' + message); });
  win.webContents.on('render-process-gone', (e, d) => errors.push('[render-gone] ' + JSON.stringify(d)));
  win.webContents.on('did-fail-load', (e, c, d, u) => errors.push('[fail-load] ' + c + ' ' + d + ' ' + u));

  const realHide = win.hide.bind(win);
  win.hide = (...a) => { hideCalls++; return realHide(...a); };

  const ev = (js) => win.webContents.executeJavaScript(js, true);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const shown = () => ev('!document.getElementById("closeModal").classList.contains("hidden")');
  const click = (id) => ev(`document.getElementById(${JSON.stringify(id)}).click()`);
  const remember = (v) => ev(`(() => { document.getElementById("closeRemember").checked = ${v ? 'true' : 'false'}; })()`);

  await wait(2500);
  log('hiddenWindow=' + hiddenOk);

  if (await ev('!document.getElementById("eulaModal").classList.contains("hidden")')) {
    await ev('(() => { const c = document.getElementById("eulaAck"); c.checked = true; c.dispatchEvent(new Event("change")); })()');
    await wait(200);
    await click('eulaEnter');
    await wait(600);
  }

  // ---------- 1. 弹窗是独立一套，没借用清理确认那个 modal ----------
  const ids = await ev(`[ 'closeModal','closeRemember','closeHide','closeQuit','closeCancel','setCloseBehavior','setCloseReset' ].map(id => {
    const e = document.getElementById(id);
    return { id, ok: !!e, inClose: !!(e && e.closest('#closeModal')), inSettings: !!(e && e.closest('#settingsModal')) };
  })`);
  const I = {};
  for (const x of ids) I[x.id] = x;
  log('ids=' + JSON.stringify(ids));
  expect('关闭弹窗与 4 个控件都在', ['closeModal', 'closeRemember', 'closeHide', 'closeQuit', 'closeCancel'].every((k) => I[k].ok && I[k].inClose));
  expect('软件设置里那一行属于设置弹窗', I.setCloseBehavior.ok && I.setCloseBehavior.inSettings && !I.setCloseBehavior.inClose);
  expect('弹窗初始是隐藏的', (await shown()) === false);
  expect('清理确认弹窗是另一个元素', (await ev('document.getElementById("modal") !== document.getElementById("closeModal")')) === true);

  // ---------- 2. 默认每次询问 ----------
  win.close();
  await wait(400);
  expect('点 ✕ 没真的关窗口', win.isDestroyed() === false && closedSeen === false);
  expect('弹窗出现了', (await shown()) === true);
  expect('没顺手把窗口藏起来', hideCalls === 0, hideCalls);
  expect('「记住我的选择」默认没勾', (await ev('document.getElementById("closeRemember").checked')) === false);
  await click('closeCancel');
  await wait(200);
  expect('取消后弹窗收起，窗口照旧', (await shown()) === false && win.isDestroyed() === false);

  // ---------- 3. 勾了记住 → 最小化到后台，下次不再问 ----------
  await remember(true);
  await click('closeHide');
  await wait(400);
  expect('窗口被藏进后台而不是关掉', hideCalls === 1 && win.isDestroyed() === false && win.isVisible() === false, { hideCalls, destroyed: win.isDestroyed() });
  expect('托盘图标建好了', trays.length === 1, trays.length);
  expect('托盘注册了左键与右键处理', trays.length === 1 && trays[0].listenerCount('click') === 1 && trays[0].listenerCount('right-click') === 1,
    trays.length ? { click: trays[0].listenerCount('click'), right: trays[0].listenerCount('right-click') } : null);
  const s1 = await ev('window.optimizer.settingsGet()');
  log('settings1=' + JSON.stringify(s1));
  expect('设置里记住了 hide', s1.closeBehavior === 'hide' && s1.closeRemember === true, s1);

  win.close();
  await wait(400);
  expect('这次没再问，直接进后台', (await shown()) === false && hideCalls === 2 && win.isDestroyed() === false, { hideCalls });

  // ---------- 4. 白名单挡任意值 ----------
  const s2 = await ev('window.optimizer.settingsSet({ closeBehavior: "del *", closeRemember: "yes" })');
  log('settings2=' + JSON.stringify(s2));
  expect('非法值没被写进设置', s2.closeBehavior === 'hide' && s2.closeRemember === true, s2);

  // ---------- 5. 软件设置里恢复「重新询问」 ----------
  await click('openSettings');
  await wait(300);
  const row1 = await ev(`({ text: document.getElementById("setCloseBehavior").textContent,
    resetShown: !document.getElementById("setCloseReset").classList.contains("hidden") })`);
  log('row1=' + JSON.stringify(row1));
  expect('设置里显示已记住的选择', row1.text === '最小化到后台' && row1.resetShown === true, row1);
  await click('setCloseReset');
  await wait(300);
  const row2 = await ev(`({ text: document.getElementById("setCloseBehavior").textContent,
    resetShown: !document.getElementById("setCloseReset").classList.contains("hidden") })`);
  log('row2=' + JSON.stringify(row2));
  expect('重置后回到每次询问', row2.text === '每次询问' && row2.resetShown === false, row2);
  await click('settingsClose');
  await wait(200);

  win.close();
  await wait(400);
  expect('重置后确实又开始询问', (await shown()) === true);
  await click('closeCancel');
  await wait(200);

  // ---------- 6. 英文界面 ----------
  await ev('window.i18n.setLang("en", window.optimizer)');
  await wait(900);
  win.close();
  await wait(400);
  const enText = await ev('document.getElementById("closeModal").textContent');
  log('enModal=' + enText.replace(/\s+/g, ' ').slice(0, 200));
  expect('英文下弹窗整段没有中文', !CJK.test(enText), enText.replace(/\s+/g, ' ').slice(0, 80));
  expect('英文下按钮文案齐了', /Minimize to background/.test(enText) && /Quit completely/.test(enText) && /Remember my choice/.test(enText));
  await click('closeCancel');
  await wait(200);

  // 状态文字是 JS 动态写的，靠 MutationObserver 兜翻译，单独验一次
  await ev('window.optimizer.settingsSet({ closeBehavior: "hide", closeRemember: true })');
  await click('openSettings');
  await wait(400);
  const enRow = await ev('document.getElementById("setCloseBehavior").textContent');
  log('enRow=' + enRow);
  expect('动态写入的状态文字也翻成英文', enRow === 'Minimize to background', enRow);
  await click('settingsClose');
  await ev('window.i18n.setLang("zh", window.optimizer)');
  await wait(600);

  // ---------- 7. 最后验「彻底退出」：这一步会结束进程，结果在 will-quit 里报 ----------
  await ev('window.optimizer.settingsSet({ closeBehavior: "quit", closeRemember: true })');
  app.on('will-quit', () => {
    expect('记住 quit 后 win.close() 真的退出', closedSeen === true && win.isDestroyed() === true, { closedSeen });
    expect('退出时销毁托盘图标', trays.length === 1 && trays[0].isDestroyed() === true, trays.length ? trays[0].isDestroyed() : null);
    expect('设置只落在临时 userData', fs.existsSync(path.join(DEST, 'settings.json')));
    if (problems.length) log('problems=' + JSON.stringify(problems));
    finish(problems.length === 0 && errors.length === 0 ? 0 : 2);
  });
  win.close();
}

app.whenReady().then(() => {
  const waitWin = () => {
    if (!targetWin) return setTimeout(waitWin, 200);
    probe(targetWin).catch((e) => { errors.push('[probe] ' + (e && e.stack ? e.stack : e)); finish(1); });
  };
  waitWin();
});

setTimeout(() => {
  if (!done && !targetWin) { errors.push('[no-window] 20 秒内没出现窗口，主进程可能加载失败'); finish(1); }
}, 20000);

setTimeout(() => { errors.push('[timeout] 超过 180 秒未完成（多半是退出流程没走到 will-quit）'); finish(1); }, 180000);
