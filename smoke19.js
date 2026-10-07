'use strict';
// smoke19 冒烟：托盘休眠（藏起来满 60 秒销毁渲染进程）+ 唤醒重建。
// 窗口全程隐藏（不抢前台），userData 指向临时目录，绝不触碰真实账本 / 注册表 / 电源计划。
// 三处测试替身（不改生产代码）：
//   1) 把 60000ms 这一档定时器压到 1500ms —— main.js 里只有休眠闹钟用 60000，其余延时原样透传；
//   2) BrowserWindow 子类的 show/hide/focus/minimize 只转发事件不露脸，让主进程监听器照常跑；
//   3) Tray 子类把实例记下来，测试用 tray.emit('click') 走真实的托盘叫醒路径。
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
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEST = path.join(os.tmpdir(), `rv-sleep-smoke-${Date.now()}`);
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
const memKB = () => app.getAppMetrics().reduce((s, m) => s + (m.memory ? m.memory.workingSetSize : 0), 0);

async function probe(win) {
  win.webContents.on('console-message', (e, level, message) => { if (level >= 2) errors.push('[console] ' + message); });
  win.webContents.on('render-process-gone', (e, d) => errors.push('[render-gone] ' + JSON.stringify(d)));
  win.webContents.on('did-fail-load', (e, c, d, u) => errors.push('[fail-load] ' + c + ' ' + d + ' ' + u));

  const ev = (js) => win.webContents.executeJavaScript(js, true);
  const wait = (ms) => new Promise((r) => realSetTimeout(r, ms));
  // 当前停在哪个标签页；唤醒重建的标签页恢复是 init 末尾的异步动作，只能轮询等，不能赌固定时长
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
  log('hiddenWindow=' + hiddenOk);

  // 首启免责声明挡在前面，先过掉
  if (await ev('!document.getElementById("eulaModal").classList.contains("hidden")')) {
    await ev('(() => { const c = document.getElementById("eulaAck"); c.checked = true; c.dispatchEvent(new Event("change")); })()');
    await wait(200);
    await ev('document.getElementById("eulaEnter").click()');
    await wait(600);
  }
  expect('eulaPassed', await ev('document.getElementById("eulaModal").classList.contains("hidden")'));

  // ---------- 1. 基线：页面活着、首页已经采样过一轮 ----------
  const aliveBefore = liveWin() !== null;
  const pidBefore = win.webContents.getOSProcessId();
  const memBefore = memKB();
  expect('bootAlive', aliveBefore, { aliveBefore, pidBefore });
  expect('bootSampled', /\d/.test(await ev('document.getElementById("valCpu").textContent')), await ev('document.getElementById("valCpu").textContent'));
  log('memKB_before=' + memBefore + ' rendererPid=' + pidBefore);

  const asleepGone = () => app.getAppMetrics().every((m) => m.pid !== pidBefore);

  // ---------- 2. 切到日志页（不碰任何写操作），为回原页做准备 ----------
  await ev('document.querySelector(\'.tab[data-tab="log"]\').click()');
  expect('tabIsLog', await waitTab(win, 'log', 8000));

  // ---------- 3. winHide → 隐藏满 60 秒（测试里 1.5 秒）后渲染进程被拆掉 ----------
  await ev('window.optimizer.winHide()');
  const slept = await (async () => {
    const t0 = Date.now();
    for (;;) {
      if (!asleepGone()) { await wait(200); if (Date.now() - t0 > 8000) return false; continue; }
      return liveWin() === null;
    }
  })();
  const memAfter = memKB();
  expect('rendererDestroyedAfterSleep', slept, { slept, liveWin: liveWin() !== null });
  expect('rendererPidGone', asleepGone(), app.getAppMetrics().map((m) => m.pid + ':' + m.type));
  expect('memoryDropped', memAfter < memBefore * 0.9, { memBefore, memAfter });
  expect('trayExists', trayRef != null && !trayRef.isDestroyed());

  // ---------- 4. 托盘点回来：窗口重建 + 回到原标签页 ----------
  trayRef.emit('click');
  const woken = liveWin();
  expect('wakeCreatedWindow', woken != null && !woken.isDestroyed());
  if (woken) {
    woken.webContents.on('console-message', (e, level, message) => { if (level >= 2) errors.push('[console-wake] ' + message); });
    woken.webContents.on('render-process-gone', (e, d) => errors.push('[render-gone-wake] ' + JSON.stringify(d)));
    woken.webContents.on('did-fail-load', (e, c, d, u) => errors.push('[fail-load-wake] ' + c + ' ' + d + ' ' + u));
    const ew = (js) => woken.webContents.executeJavaScript(js, true);
    expect('wakeMarkerSeen', await ew('new URLSearchParams(location.search).get("wake") === "1"').catch(() => false));
    // 标签页恢复在 init 末尾，异步；轮询等它自己停稳，别拿首帧的 .tab.active 当结论
    expect('wakeRestoredTab', await waitTab(woken, 'log', 15000));
    expect('wakeNoInitError', !/初始化失败/.test(await ew('document.getElementById("status").textContent').catch(() => '')));

    // ---------- 5. 唤醒后回首页：露脸 → win:active → 重新起监控（这条就是竞态修复的验收） ----------
    await ew('document.querySelector(\'.tab[data-tab="home"]\').click()');
    expect('backToHome', await waitTab(woken, 'home', 8000));
    await ew('window.optimizer.winHide()');
    const slept2 = await (async () => {
      const t0 = Date.now();
      for (;;) {
        if (woken.isDestroyed()) return true;
        if (Date.now() - t0 > 8000) return false;
        await wait(200);
      }
    })();
    expect('secondSleep', slept2);
    trayRef.emit('click');
    const woken2 = liveWin();
    expect('secondWakeCreated', woken2 != null);
    if (woken2) {
      woken2.webContents.on('console-message', (e, level, message) => { if (level >= 2) errors.push('[console-wake2] ' + message); });
      woken2.webContents.on('render-process-gone', (e, d) => errors.push('[render-gone-wake2] ' + JSON.stringify(d)));
      woken2.webContents.on('did-fail-load', (e, c, d, u) => errors.push('[fail-load-wake2] ' + c + ' ' + d + ' ' + u));
      const e2 = (js) => woken2.webContents.executeJavaScript(js, true);
      const sampled = await (async () => {
        const t0 = Date.now();
        for (;;) {
          try { if (/\d/.test(await e2('document.getElementById("valCpu").textContent'))) return true; } catch (e) { return false; }
          if (Date.now() - t0 > 8000) return false;
          await wait(250);
        }
      })();
      expect('metricsResumeOnWake', sampled, await e2('document.getElementById("valCpu").textContent').catch(() => 'gone'));
      expect('secondWakeHomeTab', await waitTab(woken2, 'home', 15000));

      // ---------- 6. 忙的时候不拆页面（扫描结果不会被没收） ----------
      await e2('window.optimizer.winBusy(true)');
      await e2('window.optimizer.winHide()');
      await wait(4000);
      expect('busyBlocksSleep', !woken2.isDestroyed());
      await e2('window.optimizer.winBusy(false)');
      const slept3 = await (async () => {
        const t0 = Date.now();
        for (;;) {
          if (woken2.isDestroyed()) return true;
          if (Date.now() - t0 > 6000) return false;
          await wait(200);
        }
      })();
      expect('sleepsAfterBusyCleared', slept3);

      // ---------- 7. 最小化不排休眠闹钟（随时要点回来，拆了反而慢） ----------
      trayRef.emit('click');
      const woken3 = liveWin();
      expect('thirdWakeCreated', woken3 != null);
      if (woken3) {
        woken3.webContents.on('console-message', (e, level, message) => { if (level >= 2) errors.push('[console-wake3] ' + message); });
        const e3 = (js) => woken3.webContents.executeJavaScript(js, true);
        await e3('window.optimizer.winMinimize()');
        await wait(4500);
        expect('minimizeNeverSleeps', !woken3.isDestroyed());
        await e3('window.optimizer.winHide()');
        const slept4 = await (async () => {
          const t0 = Date.now();
          for (;;) {
            if (woken3.isDestroyed()) return true;
            if (Date.now() - t0 > 6000) return false;
            await wait(200);
          }
        })();
        expect('hideAgainSleepsAfterMinimize', slept4);
      }
    }
  }
  log('memKB_end=' + memKB());

  if (problems.length) log('problems=' + JSON.stringify(problems));
  log('userDataFiles=' + JSON.stringify(fs.readdirSync(DEST)));
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

realSetTimeout(() => { errors.push('[timeout] 超过 240 秒未完成'); finish(1); }, 240000);
