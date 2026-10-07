'use strict';
// smoke20 冒烟：单实例锁（防多开）。
// 窗口全程隐藏（不抢前台），userData 指向临时目录，绝不触碰真实账本 / 注册表 / 电源计划。
// 真实第二实例用 child_process 拉起一个真的 electron 进程（smoke20-child.js），指向同一个临时
// userData —— 锁的键就是 userData 目录，这样才是在验生产代码而不是假想。
// 断言三件事：第二实例自己不建窗并退出；第一实例收到 second-instance 并把人叫醒（醒着=露脸，
// 休眠=重建窗口）；第一实例始终只有一份窗口。
// 三处测试替身（不改生产代码）同 smoke19：60000 定时器压到 1500ms、BrowserWindow 强制隐藏、Tray 记账。
const Module = require('module');
const origLoad = Module._load;
let bwProxy = null;
let hiddenOk = false;
const wins = [];
let trayRef = null;
const realSetTimeout = global.setTimeout;
// 只截 60000 一档：main.js 中该值仅出现在 scheduleRendererSleep
global.setTimeout = function (fn, ms, ...rest) {
  return realSetTimeout(fn, ms === 60000 ? 1500 : ms, ...rest);
};
Module._load = function (request) {
  const exp = origLoad.apply(this, arguments);
  if (request !== 'electron' || !exp || typeof exp.BrowserWindow !== 'function') return exp;
  if (!bwProxy) {
    const RealBW = exp.BrowserWindow;
    const RealTray = exp.Tray;
    class Hidden extends RealBW {
      constructor(o) { super(Object.assign({}, o, { show: false })); wins.push(this); }
      show() { this.emit('show'); }
      hide() { this.emit('hide'); }
      focus() {}
      minimize() { this.emit('minimize'); }
    }
    class TrackedTray extends RealTray {
      constructor(...a) { super(...a); trayRef = this; }
    }
    bwProxy = new Proxy(exp, {
      get: (t, k) => (k === 'BrowserWindow' ? Hidden : k === 'Tray' ? TrackedTray : Reflect.get(t, k)),
    });
    hiddenOk = true;
  }
  return bwProxy;
};

const { app } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEST = path.join(os.tmpdir(), `rv-single-smoke-${Date.now()}`);
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
  try { if (trayRef && !trayRef.isDestroyed()) trayRef.destroy(); } catch (e) { /* 收尾失败不影响结论 */ }
  log('---- errors ----');
  log(errors.length ? errors.join('\n') : '(none)');
  setTimeout(() => app.exit(code), 200);
}

const problems = [];
const expect = (name, ok, extra) => { log((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  -> ' + JSON.stringify(extra))); if (!ok) problems.push(name); };

const liveWin = () => wins.filter((w) => !w.isDestroyed()).pop() || null;

// 测试自己再挂一个监听器数 second-instance：main.js 的处理器在先，两个监听器都会触发
let secondInstanceHits = 0;
app.on('second-instance', () => { secondInstanceHits++; });

/** 拉起一个真的第二实例，返回它的结论。绝不 pipe，只收集 stdout。 */
function spawnChild() {
  return new Promise((resolve) => {
    const env = Object.assign({}, process.env);
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(process.execPath, ['smoke20-child.js', DEST], { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    const t0 = Date.now();
    const timer = realSetTimeout(() => {
      try { child.kill(); } catch (e) { /* 已经退了 */ }
      resolve({ timeout: true, elapsed: Date.now() - t0, text: buf });
    }, 25000);
    child.stdout.on('data', (d) => { buf += String(d); });
    child.stderr.on('data', (d) => { buf += String(d); });
    child.on('error', (e) => { errors.push('[spawn] ' + e.message); clearTimeout(timer); resolve({ error: e.message, elapsed: Date.now() - t0, text: buf }); });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      const m = buf.match(/CHILD windows=(\d+) quit=(\w+) code=(\S+)/);
      resolve({
        elapsed: Date.now() - t0,
        code,
        signal,
        hung: /CHILD hung/.test(buf),
        windows: m ? Number(m[1]) : null,
        quit: m ? m[2] === 'true' : null,
        text: buf.split(/\r?\n/).filter((l) => l.startsWith('CHILD')).join(' | '),
      });
    });
  });
}

async function probe(win) {
  win.webContents.on('console-message', (e, level, message) => { if (level >= 2) errors.push('[console] ' + message); });
  win.webContents.on('render-process-gone', (e, d) => errors.push('[render-gone] ' + JSON.stringify(d)));
  win.webContents.on('did-fail-load', (e, c, d, u) => errors.push('[fail-load] ' + c + ' ' + d + ' ' + u));

  const ev = (js) => win.webContents.executeJavaScript(js, true);
  const wait = (ms) => new Promise((r) => realSetTimeout(r, ms));
  const waitTab = async (w, want, ms) => {
    const t0 = Date.now();
    for (;;) {
      let v = '';
      try {
        v = await w.webContents.executeJavaScript('document.querySelector(".tab.active") ? document.querySelector(".tab.active").dataset.tab : ""', true);
      } catch (e) { return false; }
      if (v === want) return true;
      if (Date.now() - t0 > ms) return false;
      await wait(200);
    }
  };

  await wait(2500);
  log('hiddenWindow=' + hiddenOk + ' userData=' + DEST);

  // 首启免责声明挡在前面，先过掉
  if (await ev('!document.getElementById("eulaModal").classList.contains("hidden")')) {
    await ev('(() => { const c = document.getElementById("eulaAck"); c.checked = true; c.dispatchEvent(new Event("change")); })()');
    await wait(200);
    await ev('document.getElementById("eulaEnter").click()');
    await wait(600);
  }
  expect('eulaPassed', await ev('document.getElementById("eulaModal").classList.contains("hidden")'));

  // ---------- 1. 基线：只有一个窗口，锁是主实例拿到的 ----------
  expect('bootOneWindow', wins.length === 1, { wins: wins.length });
  expect('bootHasWindow', liveWin() !== null);

  // ---------- 2. 醒着的时候多开：第二实例自灭，第一实例露脸但不新建窗口 ----------
  let shown = 0;
  const awakeWin = liveWin();
  awakeWin.on('show', () => { shown++; });
  const hitsBeforeAwake = secondInstanceHits;
  const c1 = await spawnChild();
  log('child1=' + JSON.stringify(c1));
  expect('child1SelfExit', !c1.timeout && !c1.error && !c1.hung, c1);
  expect('child1NoWindow', c1.windows === 0, c1);
  const wokeAwake = await (async () => {
    const t0 = Date.now();
    for (;;) {
      if (secondInstanceHits > hitsBeforeAwake) return true;
      if (Date.now() - t0 > 10000) return false;
      await wait(200);
    }
  })();
  expect('awakeSecondInstanceSeen', wokeAwake, { hits: secondInstanceHits });
  await wait(600);
  expect('awakeNoExtraWindow', wins.length === 1, { wins: wins.length });
  expect('awakeReveal', shown >= 1, { shown });

  // ---------- 3. 切到日志页，藏起来等休眠（测试里 1.5 秒） ----------
  await ev('document.querySelector(\'.tab[data-tab="log"]\').click()');
  expect('tabIsLog', await waitTab(win, 'log', 8000));
  await ev('window.optimizer.winHide()');
  const slept = await (async () => {
    const t0 = Date.now();
    for (;;) {
      if (liveWin() === null) return true;
      if (Date.now() - t0 > 8000) return false;
      await wait(200);
    }
  })();
  expect('asleepBeforeWake', slept, { live: liveWin() !== null });

  // ---------- 4. 休眠时多开：第二实例照样自灭，第一实例重建窗口并回原标签页 ----------
  const winsBeforeWake = wins.length;
  const hitsBeforeWake = secondInstanceHits;
  const c2 = await spawnChild();
  log('child2=' + JSON.stringify(c2));
  expect('child2SelfExit', !c2.timeout && !c2.error && !c2.hung, c2);
  expect('child2NoWindow', c2.windows === 0, c2);
  const wokeAsleep = await (async () => {
    const t0 = Date.now();
    for (;;) {
      if (secondInstanceHits > hitsBeforeWake) return true;
      if (Date.now() - t0 > 10000) return false;
      await wait(200);
    }
  })();
  expect('asleepSecondInstanceSeen', wokeAsleep, { hits: secondInstanceHits });
  const woken = liveWin();
  expect('wakeRecreatedWindow', woken != null, { woken: woken !== null });
  expect('onlyOneExtraWindow', wins.length === winsBeforeWake + 1, { before: winsBeforeWake, after: wins.length });
  if (woken) {
    woken.webContents.on('console-message', (e, level, message) => { if (level >= 2) errors.push('[console-wake] ' + message); });
    woken.webContents.on('render-process-gone', (e, d) => errors.push('[render-gone-wake] ' + JSON.stringify(d)));
    woken.webContents.on('did-fail-load', (e, c, d, u) => errors.push('[fail-load-wake] ' + c + ' ' + d + ' ' + u));
    const ew = (js) => woken.webContents.executeJavaScript(js, true);
    expect('wakeMarkerSeen', await ew('new URLSearchParams(location.search).get("wake") === "1"').catch(() => false));
    expect('wakeRestoredTab', await waitTab(woken, 'log', 15000));
    expect('wakeNoInitError', !/初始化失败/.test(await ew('document.getElementById("status").textContent').catch(() => '')));
  }

  // ---------- 5. 唤醒后锁还在：再来一次多开，窗口数不再增长 ----------
  const winsBeforeThird = wins.length;
  const c3 = await spawnChild();
  log('child3=' + JSON.stringify(c3));
  expect('child3SelfExit', !c3.timeout && !c3.error && !c3.hung, c3);
  expect('child3NoWindow', c3.windows === 0, c3);
  await wait(1500);
  expect('thirdNoExtraWindow', wins.length === winsBeforeThird, { before: winsBeforeThird, after: wins.length });

  log('secondInstanceHits=' + secondInstanceHits + ' totalWindows=' + wins.length);
  log('userDataFiles=' + JSON.stringify(fs.readdirSync(DEST)));

  if (problems.length) log('problems=' + JSON.stringify(problems));
  finish(problems.length === 0 && errors.length === 0 ? 0 : 2);
}

// show:false 的窗口不会出现在 getAllWindows() 里，所以用 browser-window-created 事件抓
let targetWin = null;
app.on('browser-window-created', (e, w) => { if (!targetWin) targetWin = w; });

app.whenReady().then(() => {
  const waitWin = () => {
    if (!targetWin) return realSetTimeout(waitWin, 200);
    probe(targetWin).catch((e) => { errors.push('[probe] ' + (e && e.stack ? e.stack : e)); finish(1); });
  };
  waitWin();
});

// 加载期报错时 Electron 不会自己退出，留个硬超时免得白等
realSetTimeout(() => {
  if (!done && !targetWin) { errors.push('[no-window] 20 秒内没出现窗口，主进程可能加载失败'); finish(1); }
}, 20000);

realSetTimeout(() => { errors.push('[timeout] 超过 300 秒未完成'); finish(1); }, 300000);
