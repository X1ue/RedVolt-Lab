'use strict';
// smoke21 冒烟：暗红 / 亮蓝双主题。
// 验四件事：① <html data-theme> 换整套 token 而语义色（安全/警告/危险）绝不跟着换；
// ② 背景闪电调色板与折线取色跟着主题走（canvas 不吃 CSS 变量）；
// ③ 窗口图标 + 托盘图标运行时跟随（exe 内嵌那份换不到，不在本测试范围）；
// ④ 休眠唤醒重建的页面靠 ?theme= 免闪首屏，且 settings.json 的 theme 有白名单校验。
// 窗口全程隐藏（不抢前台），userData 指向临时目录，绝不触碰真实账本 / 注册表 / 电源计划。
// 只走「只读」和「拒绝 / 未确认」路径：不点「开始清理」、不跑 DISM、不删任何文件。
// 三处测试替身（不改生产代码）：
//   1) 60000ms 这一档定时器压到 1500ms —— main.js 里只有休眠闹钟用 60000；
//   2) BrowserWindow 子类的 show/hide/focus/minimize 只转发事件不露脸，并记录 setIcon 调用；
//   3) Tray 子类记下实例与图标路径，测试用 tray.emit('click') 走真实的托盘叫醒路径。
const Module = require('module');
const origLoad = Module._load;
let bwProxy = null;
let hiddenOk = false;
const wins = [];
const iconCalls = []; // { where: 'win_ctor' | 'win_setImage' | 'tray_ctor' | 'tray_setImage', arg }
let trayRef = null;
const realSetTimeout = global.setTimeout;
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
      constructor(o) {
        super(Object.assign({}, o, { show: false }));
        wins.push(this);
        if (o && o.icon) iconCalls.push({ where: 'win_ctor', arg: String(o.icon) });
      }
      show() { this.emit('show'); }
      hide() { this.emit('hide'); }
      focus() {}
      minimize() { this.emit('minimize'); }
      setIcon(p) { iconCalls.push({ where: 'win_setIcon', arg: String(p) }); return super.setIcon(p); }
    }
    class TrackedTray extends RealTray {
      constructor(o) {
        super(o);
        trayRef = this;
        iconCalls.push({ where: 'tray_ctor', arg: String(o) });
      }
    }
    // Electron 44 的 Tray 构造返回的是原生对象的包装，子类里 override setImage 收不到调用
    // （自检过：直接 trayRef.setImage() 也不会走到子类方法）。所以只能改原型来记账。
    if (!RealTray.prototype.__smokeSetImage) {
      const origSetImage = RealTray.prototype.setImage;
      const spy = function (p) {
        iconCalls.push({ where: 'tray_setImage', arg: String(p) });
        return origSetImage.apply(this, arguments);
      };
      spy.__smokeSetImage = true;
      RealTray.prototype.setImage = spy;
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

const DEST = path.join(os.tmpdir(), `rv-theme-smoke-${Date.now()}`);
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
  realSetTimeout(() => app.exit(code), 200);
}

const problems = [];
const expect = (name, ok, extra) => { log((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  -> ' + JSON.stringify(extra))); if (!ok) problems.push(name); };

const settingsFile = () => path.join(DEST, 'settings.json');
const readSettings = () => {
  try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch (e) { return null; }
};
const baseName = (p) => path.basename(String(p).split(/[?#]/)[0]);
const iconHits = (where, name) => iconCalls.filter((c) => c.where === where && baseName(c.arg) === name).length;

async function probe(win) {
  const attach = (w, tag) => {
    w.webContents.on('console-message', (e, level, message) => { if (level >= 2) errors.push('[console' + tag + '] ' + message); });
    w.webContents.on('render-process-gone', (e, d) => errors.push('[render-gone' + tag + '] ' + JSON.stringify(d)));
    w.webContents.on('did-fail-load', (e, c, d, u) => errors.push('[fail-load' + tag + '] ' + c + ' ' + d + ' ' + u));
  };
  attach(win, '');

  const wait = (ms) => new Promise((r) => realSetTimeout(r, ms));

  // 一次把渲染层要看的东西全取回来，省得每条断言跑一轮 IPC
  const SNAP = `(() => {
    const cs = getComputedStyle(document.documentElement);
    const v = (k) => cs.getPropertyValue(k).trim();
    const logo = document.querySelector('.logo');
    const sel = document.getElementById('themeSel');
    return {
      dataset: document.documentElement.dataset.theme || '(unset)',
      accent: v('--accent'), accentRgb: v('--accent-rgb'), bg: v('--bg'), panel: v('--panel'),
      line: v('--line'), text: v('--text'), safe: v('--safe'), caution: v('--caution'), danger: v('--danger'),
      sparkRgb: v('--spark-rgb'), titleMid: v('--title-mid'),
      logoSrc: logo ? logo.getAttribute('src') : null,
      fxTheme: window.bgFx ? window.bgFx.theme : null,
      sel: sel ? { value: sel.value, opts: [...sel.options].map((o) => o.value + '=' + o.textContent) } : null,
      hasLangSel: !!document.getElementById('langSel'),
      hasSetTheme: !!document.getElementById('setTheme'),
      setLangExists: !!document.getElementById('setLang'),
      selTitle: sel ? sel.getAttribute('title') : null,
      status: (document.getElementById('status') || {}).textContent || '',
      modalOpen: !document.getElementById('settingsModal').classList.contains('hidden'),
    };
  })()`;
  const snap = (w) => w.webContents.executeJavaScript(SNAP, true);

  await wait(2500);
  log('hiddenWindow=' + hiddenOk);

  // 首启免责声明挡在前面，先过掉
  const ev0 = (js) => win.webContents.executeJavaScript(js, true);
  if (await ev0('!document.getElementById("eulaModal").classList.contains("hidden")')) {
    await ev0('(() => { const c = document.getElementById("eulaAck"); c.checked = true; c.dispatchEvent(new Event("change")); })()');
    await wait(200);
    await ev0('document.getElementById("eulaEnter").click()');
    await wait(600);
  }
  expect('eulaPassed', await ev0('document.getElementById("eulaModal").classList.contains("hidden")'));

  // ---------- 1. 默认暗红：token 化重构没改动一个渲染值 ----------
  let s = await snap(win);
  expect('defaultNoDataTheme', s.dataset === '(unset)', s.dataset);
  expect('defaultAccent', s.accent === '#ff3b3b', s.accent);
  expect('defaultAccentRgb', s.accentRgb.replace(/\s+/g, ' ') === '255, 59, 59', s.accentRgb);
  expect('defaultBg', s.bg === '#0a0a0d', s.bg);
  expect('defaultPanel', s.panel.replace(/\s+/g, ' ') === 'rgba(22, 15, 17, 0.9)', s.panel);
  expect('defaultLine', s.line === '#3a2126', s.line);
  expect('defaultText', s.text === '#f0ecee', s.text);
  expect('defaultFxPalette', s.fxTheme === 'dark', s.fxTheme);
  expect('defaultLogo', s.logoSrc === 'icon.png', s.logoSrc);
  expect('defaultSparkRgb', s.sparkRgb.replace(/\s+/g, ' ') === '255, 92, 72', s.sparkRgb);
  expect('settingsJsonHasNoThemeYet', (() => { const j = readSettings(); return !j || j.theme === undefined; })(), readSettings());
  // 首屏不闪的机制：主题走 URL 参数，没配置也要显式带 dark
  expect('bootUrlCarriesTheme', /[?&]theme=dark/.test(win.webContents.getURL()), win.webContents.getURL());
  expect('bootWindowIconIsDefault', iconHits('win_ctor', 'icon.ico') >= 1, iconCalls.filter((c) => c.where === 'win_ctor'));

  // ---------- 2. 顶栏「界面主题：暗红 / 亮蓝」，语言只留在设置弹窗 ----------
  const place = await ev0(`(() => {
    const t = document.getElementById('themeSel'), l = document.getElementById('langSel'), s = document.getElementById('setTheme');
    return {
      themeInHeader: !!t && !!t.closest('header'),
      themeClass: t ? t.className : null,
      langSelGone: !l, setThemeGone: !s,
      setLangInModal: !!document.getElementById('setLang') && !!document.getElementById('setLang').closest('#settingsModal'),
    };
  })()`);
  expect('themeSelLivesInHeader', place.themeInHeader, place);
  expect('themeSelKeepsHeaderStyleHook', /(^|\s)theme-sel(\s|$)/.test(place.themeClass || ''), place);
  expect('headerLangSelRemoved', place.langSelGone, place);
  expect('modalSetThemeRemoved', place.setThemeGone, place);
  expect('langStillInSettings', place.setLangInModal, place);

  await ev0('document.getElementById("openSettings").click()');
  await wait(300);
  s = await snap(win);
  expect('settingsModalOpen', s.modalOpen);
  expect('themeOptionsZh', JSON.stringify(s.sel && s.sel.opts) === JSON.stringify(['dark=暗红', 'blue=亮蓝']), s.sel && s.sel.opts);
  expect('themeSelectEchoesCurrent', s.sel && s.sel.value === 'dark', s.sel);

  // ---------- 3. 切亮蓝：整套 token 换冷色，语义色一个都不动 ----------
  const ev = (js) => win.webContents.executeJavaScript(js, true);
  await ev('(() => { const x = document.getElementById("themeSel"); x.value = "blue"; x.dispatchEvent(new Event("change")); })()');
  await wait(800);
  s = await snap(win);
  expect('blueDataTheme', s.dataset === 'blue', s.dataset);
  expect('blueAccent', s.accent === '#3d8bff', s.accent);
  expect('blueAccentRgb', s.accentRgb.replace(/\s+/g, ' ') === '61, 139, 255', s.accentRgb);
  expect('blueBg', s.bg === '#060a12', s.bg);
  expect('bluePanel', s.panel.replace(/\s+/g, ' ') === 'rgba(12, 22, 38, 0.9)', s.panel);
  expect('blueLine', s.line === '#1e3a5f', s.line);
  expect('blueText', s.text === '#eaf2fb', s.text);
  expect('blueTitleMid', s.titleMid === '#7cc4ff', s.titleMid);
  expect('safeUntouchedByTheme', s.safe === '#4cc07c', s.safe);
  expect('cautionUntouchedByTheme', s.caution === '#e0a33e', s.caution);
  expect('dangerUntouchedByTheme', s.danger === '#ff5c5c', s.danger);
  expect('blueSparkRgb', s.sparkRgb.replace(/\s+/g, ' ') === '120, 196, 255', s.sparkRgb);
  expect('blueFxPalette', s.fxTheme === 'blue', s.fxTheme);
  expect('blueLogo', s.logoSrc === 'icon-blue.png', s.logoSrc);
  expect('themePersistedBlue', readSettings() && readSettings().theme === 'blue', readSettings());
  expect('statusFeedbackZh', s.status.indexOf('已切换到亮蓝主题') >= 0, s.status);
  expect('winIconFollowsTheme', iconHits('win_setIcon', 'icon-blue.ico') >= 1, iconCalls.filter((c) => c.where === 'win_setIcon'));

  // 闪电芯色必须是白热：画布只认 JS 调色板（不吃 CSS 变量），而那份调色板封在 fx.js 的闭包里，
  // 运行时取不到，所以用源码断言钉住「蓝主题芯 = 255,255,255」这条设计约束。
  const fxSrc = fs.readFileSync(path.join(__dirname, 'renderer', 'fx.js'), 'utf8');
  const bluePal = (fxSrc.match(/blue:\s*\{[\s\S]*?\}/) || [''])[0];
  expect('fxBlueCoreWhiteHot', /core:\s*'255,255,255'/.test(bluePal), bluePal);
  expect('fxBlueGlowIsCool', /glow:\s*'40,120,255'/.test(bluePal), bluePal);
  expect('fxStillExposesSetTheme', (await ev('typeof (window.bgFx && window.bgFx.setTheme)')) === 'function');

  // ---------- 4. theme 白名单：非法值既不落盘也不改界面 ----------
  const before = JSON.stringify(readSettings());
  await ev('window.optimizer.settingsSet({ theme: "garbage" })');
  await wait(400);
  expect('invalidThemeRejectedOnDisk', JSON.stringify(readSettings()) === before, readSettings());
  expect('invalidThemeKeepsUi', (await snap(win)).dataset === 'blue');
  await ev('window.optimizer.settingsSet({ theme: true, lang: "de" })');
  await wait(300);
  expect('junkTypedThemeRejected', JSON.stringify(readSettings()) === before, readSettings());

  // ---------- 5. 收进后台 → 休眠 → 托盘唤醒：重建页面带 theme=blue ----------
  await ev('window.optimizer.winHide()');
  const slept = await (async () => {
    const t0 = Date.now();
    for (;;) {
      if (win.isDestroyed()) return true;
      if (Date.now() - t0 > 8000) return false;
      await wait(200);
    }
  })();
  expect('rendererSlept', slept);
  expect('trayBuiltWithBlueIcon', iconHits('tray_ctor', 'icon-blue.ico') >= 1, iconCalls.filter((c) => c.where === 'tray_ctor'));

  if (trayRef) trayRef.emit('click');
  const woken = await (async () => {
    const t0 = Date.now();
    for (;;) {
      const w = liveWin();
      if (w) return w;
      if (Date.now() - t0 > 12000) return null;
      await wait(200);
    }
  })();
  expect('wakeCreatedWindow', woken != null && !woken.isDestroyed());
  if (woken) {
    attach(woken, '-wake');
    const ew = (js) => woken.webContents.executeJavaScript(js, true);
    // 唤醒时 <html data-theme> 在 DOM 就绪那一刻就该是 blue（此时 init 里的异步 settingsGet 还没回来）。
    // 窗口在 tray emit 里同步构造，dom-ready 监听器来得及挂上 —— 这条就是「免闪首屏」的时序证据。
    const readyTheme = () => woken.webContents.executeJavaScript(`[
      document.documentElement.dataset.theme || '(unset)',
      window.bgFx ? window.bgFx.theme : '-',
      document.querySelector('.logo') ? document.querySelector('.logo').getAttribute('src') : '-',
    ].join('|')`, true);
    let themeAtDomReady = '(未捕获)';
    if (woken.webContents.isLoading()) {
      themeAtDomReady = await new Promise((resolve) => {
        let settled = false;
        const fin = (v) => { if (!settled) { settled = true; resolve(v); } };
        woken.webContents.once('dom-ready', () => readyTheme().then(fin, () => fin('read-err')));
        realSetTimeout(() => fin('timeout'), 10000);
      });
    } else {
      themeAtDomReady = await readyTheme().catch(() => 'read-err');
    }
    expect('wakeThemeBeforeAsyncInit', themeAtDomReady === 'blue|blue|icon-blue.png', themeAtDomReady);

    const url = woken.webContents.getURL();
    expect('wakeUrlCarriesTheme', /[?&]theme=blue/.test(url), url);
    expect('wakeUrlStillCarriesWake', /[?&]wake=1/.test(url), url);
    expect('wakeWindowIconBlue', iconHits('win_ctor', 'icon-blue.ico') >= 1, iconCalls.filter((c) => c.where === 'win_ctor'));
    s = await snap(woken);
    expect('wakeNoFlashBlue', s.dataset === 'blue', s.dataset);
    // 重建页面的顶栏下拉必须由 bootstrap 那次 applyTheme 同步好，不等 initSettings 的异步 IPC
    expect('wakeHeaderSelShowsBlue', s.sel && s.sel.value === 'blue', s.sel);
    expect('wakeFxBlue', s.fxTheme === 'blue', s.fxTheme);
    expect('wakeLogoBlue', s.logoSrc === 'icon-blue.png', s.logoSrc);
    expect('wakeNoInitError', s.status.indexOf('初始化失败') < 0, s.status);
    // 免闪的机制是「同步应用 query」，不是等 initSettings 的异步 IPC 回来。
    // 静态顺序断言钉住它：bootstrap 必须出现在 init() 被调用之前（同一个脚本任务内，paint 还没发生）。
    const src = fs.readFileSync(path.join(__dirname, 'renderer', 'app.js'), 'utf8');
    const bootAt = src.indexOf(`get('theme') === 'blue'`);
    const callAt = src.indexOf('init().catch(');
    expect('themeBootstrapRunsBeforeInit', bootAt > -1 && callAt > -1 && bootAt < callAt, { bootAt, callAt });

    // ---------- 6. 托盘活着时切回暗红：图标实时跟随，UI 可逆 ----------
    // openSettings 的点击监听是 initSettings 末尾才装的：弹窗能打开 = 异步初始化真的走完了，
    // 拿它当就绪闸门，比睡固定时长可靠（唤醒重建的首屏 IPC 一串，快慢不稳）。
    await ew('document.getElementById("openSettings").click()');
    const settingsReady = await (async () => {
      const t0 = Date.now();
      for (;;) {
        try {
          if (await ew('!document.getElementById("settingsModal").classList.contains("hidden")')) return true;
        } catch (e) { return false; }
        if (Date.now() - t0 > 15000) return false;
        await wait(250);
        await ew('document.getElementById("openSettings").click()');
      }
    })();
    expect('wakeSettingsWired', settingsReady);
    await ew('(() => { const x = document.getElementById("themeSel"); x.value = "dark"; x.dispatchEvent(new Event("change")); })()');
    await wait(900);
    s = await snap(woken);
    expect('revertDataThemeCleared', s.dataset === '(unset)', s.dataset);
    expect('revertAccent', s.accent === '#ff3b3b', s.accent);
    expect('revertFx', s.fxTheme === 'dark', s.fxTheme);
    expect('revertLogo', s.logoSrc === 'icon.png', s.logoSrc);
    expect('themePersistedDark', readSettings() && readSettings().theme === 'dark', readSettings());
    expect('trayIconFollowsLive', iconHits('tray_setImage', 'icon.ico') >= 1, iconCalls.filter((c) => c.where === 'tray_setImage'));
    expect('semanticColorsStableAcrossRevert', s.safe === '#4cc07c' && s.caution === '#e0a33e' && s.danger === '#ff5c5c', { safe: s.safe, caution: s.caution, danger: s.danger });

    // ---------- 7. 双语：顶栏主题下拉的选项跟着换语言 ----------
    await ew('(() => { const x = document.getElementById("setLang"); x.value = "en"; x.dispatchEvent(new Event("change")); })()');
    await wait(1200);
    const en = await ew(`(() => {
      const x = document.getElementById('themeSel');
      return { opts: [...x.options].map((o) => o.textContent), value: x.value, title: x.getAttribute('title') };
    })()`);
    expect('enOptions', JSON.stringify(en.opts) === JSON.stringify(['Dark red', 'Bright blue']), en.opts);
    expect('enKeepsSelection', en.value === 'dark', en);
    expect('themeTitleStaysBilingual', en.title === '界面主题 / UI theme', en.title);
    await ew('(() => { const x = document.getElementById("setLang"); x.value = "zh"; x.dispatchEvent(new Event("change")); })()');
    await wait(1200);
  }
  log('iconCalls=' + JSON.stringify(iconCalls.map((c) => c.where + ':' + baseName(c.arg))));

  if (problems.length) log('problems=' + JSON.stringify(problems));
  log('userDataFiles=' + JSON.stringify(fs.readdirSync(DEST)));
  finish(problems.length === 0 && errors.length === 0 ? 0 : 2);
}

const liveWin = () => wins.filter((w) => !w.isDestroyed()).pop() || null;

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
