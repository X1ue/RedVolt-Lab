'use strict';
// 1.2.0 「看不见就停工」冒烟：窗口收起/最小化时，首页采样和背景动画必须真的停下来。
// 不点任何写操作、不写注册表、不弹 UAC；窗口全程 show:false（只给渲染进程发事件，不去真显示）。
const Module = require('module');
const origLoad = Module._load;
let bwProxy = null;
Module._load = function (request) {
  const exp = origLoad.apply(this, arguments);
  if (request !== 'electron' || !exp || typeof exp.BrowserWindow !== 'function') return exp;
  if (!bwProxy) {
    const Real = exp.BrowserWindow;
    // 每个模块 require('electron') 都必须拿到同一个代理，否则后 require 的那份仍会真的弹窗
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

const DEST = path.join(os.tmpdir(), `rv-active-smoke-${Date.now()}`);
fs.mkdirSync(DEST, { recursive: true });
app.setPath('userData', DEST);

// 在产品代码之外数采样次数：主进程拿的是同一个模块对象，换掉 get 就能观察「有没有还在轮询」
const metrics = require('./engine/metrics');
let metricsCalls = 0;
const realGet = metrics.get;
metrics.get = function () {
  metricsCalls++;
  return realGet.apply(this, arguments);
};

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
  metrics.get = realGet;
  log('---- errors ----');
  log(errors.length ? errors.join('\n') : '(none)');
  log(code === 0 ? '结果: 全部通过' : '结果: 有失败项');
  setTimeout(() => app.exit(code), 200);
}

let targetWin = null;
const showCalls = [];
app.on('browser-window-created', (e, w) => {
  if (targetWin) return;
  targetWin = w;
  // 谁把窗口显示出来了就记栈：这个冒烟全程不允许出现可见窗口
  const realShow = w.show.bind(w);
  w.show = function (...args) {
    showCalls.push(new Error('show').stack);
    return realShow(...args);
  };
});

async function probe(win) {
  win.webContents.on('console-message', (e, level, message) => { if (level >= 2) errors.push('[console] ' + message); });
  win.webContents.on('render-process-gone', (e, d) => errors.push('[render-gone] ' + JSON.stringify(d)));
  const ev = (js) => win.webContents.executeJavaScript(js, true);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const send = (on) => win.webContents.send('win:active', on);

  await wait(2500);
  log('hiddenAtStart=' + !win.isVisible());
  if (await ev('!document.getElementById("eulaModal").classList.contains("hidden")')) {
    await ev('(() => { const c = document.getElementById("eulaAck"); c.checked = true; c.dispatchEvent(new Event("change")); })()');
    await wait(200);
    await ev('document.getElementById("eulaEnter").click()');
    await wait(600);
  }

  // 数逐帧次数：不依赖 fx 的内部变量，也证明动画循环确实停摆
  await ev('(() => { window.__raf = 0; const o = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (f) => { window.__raf++; return o(f); }; })()');

  const fxEnabled = () => ev('!!(window.bgFx && window.bgFx.enabled)');
  // 动效要等设置读出来才启动，等它就绪再测，否则会把「还没启动」当成「停了」
  let fxReady = false;
  for (let i = 0; i < 20 && !fxReady; i++) {
    fxReady = await fxEnabled();
    if (!fxReady) await wait(300);
  }

  const state = async () => ({
    metrics: metricsCalls,
    raf: await ev('window.__raf'),
    fxOn: await ev('!!(window.bgFx && window.bgFx.enabled)'),
    home: await ev('document.querySelector(".tab.active").dataset.tab'),
  });

  // ---------- 1. 主进程的窗口事件接线 ----------
  expect('窗口监听了 hide', win.listenerCount('hide') >= 1);
  expect('窗口监听了 minimize', win.listenerCount('minimize') >= 1);
  expect('窗口监听了 show', win.listenerCount('show') >= 1);
  expect('窗口监听了 restore', win.listenerCount('restore') >= 1);

  // ---------- 2. 首页前台：采样和动画都在跑 ----------
  const a = await state();
  await wait(3500);
  const b = await state();
  log(`前台3.5秒 | metrics+${b.metrics - a.metrics} raf+${b.raf - a.raf}`);
  expect('在首页时确实在采样', b.metrics - a.metrics >= 1, b.metrics - a.metrics);
  // 隐藏窗口里 Chromium 自己会把动画降到约 1 帧/秒，这里只要求「还在推进」
  expect('在首页时动画持续推进', b.raf - a.raf >= 2, b.raf - a.raf);
  expect('动效按设置是开启的', fxReady === true, fxReady);

  // ---------- 3. 收进后台：两样都得停 ----------
  send(false);
  await wait(600);
  const c = await state();
  await wait(3500);
  const d = await state();
  log(`收起3.5秒 | metrics+${d.metrics - c.metrics} raf+${d.raf - c.raf}`);
  expect('窗口看不见时不再采样', d.metrics === c.metrics, d.metrics - c.metrics);
  expect('窗口看不见时不再逐帧', d.raf === c.raf, d.raf - c.raf);

  // ---------- 4. 回到前台：原样恢复，且不会多开一套定时器 ----------
  send(true);
  await wait(400);
  const e1 = await state();
  await wait(3500);
  const e2 = await state();
  log(`回前台3.5秒 | metrics+${e2.metrics - e1.metrics} raf+${e2.raf - e1.raf}`);
  expect('回前台后恢复采样', e2.metrics > e1.metrics, e2.metrics - e1.metrics);
  expect('回前台后恢复动画', e2.raf > e1.raf, e2.raf - e1.raf);
  // 采样间隔 2 秒：3.5 秒里若跑了 3 次以上，说明重复起了多个定时器
  expect('回前台没有把定时器叠成好几份', e2.metrics - e1.metrics <= 3, e2.metrics - e1.metrics);
  await wait(3500);
  const e3 = await state();
  expect('反复前后台不会累积采样频率', e3.metrics - e2.metrics <= 3, e3.metrics - e2.metrics);

  // ---------- 5. 停在别的页时，回前台不该把首页的采样拉起来 ----------
  await ev('document.querySelector(\'.tab[data-tab="disk"]\').click()');
  await wait(800);
  send(false);
  await wait(300);
  send(true);
  await wait(500);
  const f1 = await state();
  await wait(3000);
  const f2 = await state();
  log(`磁盘页3秒 | metrics+${f2.metrics - f1.metrics}`);
  expect('离开首页后不再采样', f2.metrics === f1.metrics, f2.metrics - f1.metrics);
  expect('当前页确实不是首页', f2.home === 'disk', f2.home);

  // ---------- 6. 回到首页应恢复 ----------
  await ev('document.querySelector(\'.tab[data-tab="home"]\').click()');
  await wait(300);
  const g1 = await state();
  await wait(3000);
  const g2 = await state();
  expect('回首页恢复采样', g2.metrics > g1.metrics, g2.metrics - g1.metrics);

  // ---------- 7. 全程没碰真实数据 ----------
  expect('窗口全程隐藏', win.isVisible() === false, {
    showCalls: showCalls.length,
    stack: showCalls[0] ? String(showCalls[0]).split('\n').slice(0, 5).join(' | ') : null,
  });
  expect('没有产生任何变更账本', !fs.existsSync(path.join(DEST, 'changes-ledger.json')));
  expect('没有写游戏开关备份', !fs.existsSync(path.join(DEST, 'game-switch-backup.json')));

  if (problems.length) log('problems=' + JSON.stringify(problems));
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
