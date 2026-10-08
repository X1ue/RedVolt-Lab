'use strict';
// 1.1.0 UI 修动冒烟：自绘下拉框、英文标签列宽、更新页文案、首页档位标题字号对调。
// 全程只动界面：不写注册表、不删文件、不弹 UAC。userData 指向临时目录。
// 隐藏窗口：electron 的导出属性不可重定义，所以在 Module._load 上包一层 Proxy，
// 让 main.js 拿到的 BrowserWindow 构造时强制 show:false。
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

const DEST = path.join(os.tmpdir(), `rv-ui-smoke-${Date.now()}`);
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
  // 语言下拉框住在设置弹窗里，顶栏那格换成了主题选择器。包装节点是 select 的前一个兄弟，
  // CSS 表达不了「往前找」，所以统一用这两个表达式定位按钮与当前文字。
  const LB = 'document.getElementById("setLang").previousElementSibling.querySelector(".dd-btn")';
  const LCUR = 'document.getElementById("setLang").previousElementSibling.querySelector(".dd-cur")';

  await wait(2500);
  log('hiddenWindow=' + hiddenOk);

  if (await ev('!document.getElementById("eulaModal").classList.contains("hidden")')) {
    await ev('(() => { const c = document.getElementById("eulaAck"); c.checked = true; c.dispatchEvent(new Event("change")); })()');
    await wait(200);
    await ev('document.getElementById("eulaEnter").click()');
    await wait(600);
  }
  expect('eulaPassed', await ev('document.getElementById("eulaModal").classList.contains("hidden")'));

  // ---------- 1. 静态 select 全部被升级成自绘下拉框 ----------
  const up = await ev(`JSON.stringify(['themeSel','folderRoot','setLang'].map(id => {
    const s = document.getElementById(id);
    const dd = s && s.previousElementSibling;
    return { id, hasSel: !!s, wrapped: !!(dd && dd.classList.contains('dd')),
      src: !!(s && s.classList.contains('dd-src')),
      variant: dd ? dd.className : '',
      hidden: s ? getComputedStyle(s).display : '',
      btnLabel: dd && dd.querySelector('.dd-cur') ? dd.querySelector('.dd-cur').textContent : null,
      optLabel: s && s.selectedIndex >= 0 ? (s.options[s.selectedIndex].textContent || '').trim() : '' };
  }))`);
  log('upgrades=' + up);
  const U = JSON.parse(up);
  expect('三个静态下拉框都在', U.every((x) => x.hasSel));
  expect('三个都包上了 .dd', U.every((x) => x.wrapped), U);
  expect('原生 select 被隐藏（只当数据源）', U.every((x) => x.src && x.hidden === 'none'), U);
  expect('按钮文字跟着选中项走', U.every((x) => x.btnLabel === x.optLabel), U);
  expect('顶栏主题下拉套用 theme 变体', /(^|\s)dd--theme(\s|$)/.test(U[0].variant), U[0].variant);
  expect('顶栏语言下拉已经从 DOM 消失', (await ev('!document.getElementById("langSel")')) === true);

  // ---------- 2. 鼠标点开语言下拉（在设置弹窗里）→ 选中 → 真的换语言 ----------
  expect('弹层初始不存在', (await ev('document.querySelectorAll(".dd-list").length')) === 0);
  await ev('document.getElementById("openSettings").click()');
  // openSettings 的监听是 initSettings 末尾才装的，弹窗能开 = 初始化真的跑完了
  let modalUp = false;
  for (let i = 0; i < 30 && !modalUp; i++) {
    await wait(200);
    modalUp = await ev('!document.getElementById("settingsModal").classList.contains("hidden")');
    if (!modalUp) await ev('document.getElementById("openSettings").click()');
  }
  expect('设置弹窗已打开（语言下拉在里面）', modalUp);
  await ev(LB + '.click()');
  await wait(300);
  const pop = await ev(`JSON.stringify((() => {
    const l = document.querySelector('.dd-list');
    if (!l) return { none: true };
    const cs = getComputedStyle(l);
    const items = [...l.querySelectorAll('.dd-item')];
    return { parent: l.parentElement.tagName, pos: cs.position, z: cs.zIndex, bg: cs.backgroundColor,
      n: items.length, texts: items.map(i => i.querySelector('.dd-label').textContent),
      on: items.map(i => i.classList.contains('on')),
      ticks: items.map(i => getComputedStyle(i.querySelector('.dd-tick')).visibility),
      top: Math.round(l.getBoundingClientRect().top), left: Math.round(l.getBoundingClientRect().left) };
  })())`);
  log('popup=' + pop);
  const P = JSON.parse(pop);
  expect('弹层挂到 body 上（不被面板裁切）', P.parent === 'BODY', P.parent);
  expect('弹层是 fixed 定位', P.pos === 'fixed' && P.z === '120', { pos: P.pos, z: P.z });
  expect('弹层是深色底', /rgba?\(20, 16, 15/.test(P.bg), P.bg);
  expect('两个选项都渲染出来', P.n === 2 && P.texts.join('/') === '中文/English', P.texts);
  expect('当前项打勾且只有它有勾', P.on.join(',') === 'true,false' && P.ticks.join(',') === 'visible,hidden', P);
  expect('弹层出现在按钮下方', P.top > 0 && P.left >= 0, { top: P.top, left: P.left });

  await ev('(() => { const it = [...document.querySelectorAll(".dd-item")].find(i => /English/.test(i.textContent)); it.click(); })()');
  await wait(1200);
  expect('选完弹层自动关闭', (await ev('document.querySelectorAll(".dd-list").length')) === 0);
  expect('setLang 变成 en', (await ev('document.getElementById("setLang").value')) === 'en');
  expect('按钮文字同步成 English', (await ev(LCUR + '.textContent')) === 'English');
  expect('界面真的切成英文了', (await ev('document.querySelector(".tab[data-tab=\\"home\\"]").textContent')).indexOf('Home') >= 0);
  await ev('document.getElementById("settingsClose").click()');
  await wait(250);

  // ---------- 3. 英文下 Memory 标签不再被进度条压住 ----------
  const overlap = await ev(`JSON.stringify([...document.querySelectorAll('.mon-row')].map(r => {
    const k = r.querySelector('.mk'), b = r.querySelector('.mon-bar');
    const kr = k.getBoundingClientRect(), br = b.getBoundingClientRect();
    return { label: k.textContent, basis: getComputedStyle(k).flexBasis,
      right: Math.round(kr.right), barLeft: Math.round(br.left), clear: kr.right <= br.left + 0.5,
      w: Math.round(kr.width) };
  }))`);
  log('monRows=' + overlap);
  const M = JSON.parse(overlap);
  expect('三行标签都存在', M.length === 3, M);
  expect('英文下标签列宽到 56px', M.every((x) => parseInt(x.basis, 10) >= 50), M.map((x) => x.basis));
  expect('Memory 没被进度条压住', M.every((x) => x.clear), M);
  expect('三行进度条仍然对齐', new Set(M.map((x) => x.barLeft)).size === 1, M.map((x) => x.barLeft));
  const memRow = M.find((x) => /Memory/.test(x.label));
  expect('Memory 这一行确实被测到', !!memRow, M);

  // ---------- 4. 更新页文案：不再提 GitHub Releases ----------
  await ev('document.querySelector(\'.tab[data-tab="update"]\').click()');
  await wait(500);
  const hint = await ev('document.querySelector("#tab-update .hint").textContent');
  log('updateHint=' + hint.slice(0, 90));
  expect('更新页说明里不再出现 GitHub Releases', !/GitHub Releases/.test(hint), hint.slice(0, 60));
  expect('说明仍然保留了 Setup/便携版那段', /Setup/.test(hint) && hint.length > 60, hint.length);
  expect('中文原文里也没有残留', !/托管在/.test(hint));
  const hintEn = await ev('document.querySelector("#tab-update .hint").textContent');
  expect('英文态下这句已翻译（无中文残留）', !/[\u3400-\u9fff]/.test(hintEn), hintEn.slice(0, 60));

  // ---------- 5. 首页档位标题字号对调，其它页不受影响 ----------
  const sizes = await ev(`JSON.stringify((() => {
    const g = (sel) => { const e = document.querySelector(sel); if (!e) return null;
      const cs = getComputedStyle(e); return { fs: cs.fontSize, fw: cs.fontWeight, color: cs.color }; };
    return { homeLabel: g('#tab-home .power-cur-label'), homeVal: g('#tab-home .power-current strong'),
      powerLabel: g('#tab-power .power-cur-label'), gameLabel: g('#tab-game .power-cur-label'),
      homeText: (document.querySelector('#tab-home .power-cur-label')||{}).textContent };
  })())`);
  log('sizes=' + sizes);
  const S = JSON.parse(sizes);
  expect('首页标签变成 15px 主标题', S.homeLabel && S.homeLabel.fs === '15px' && Number(S.homeLabel.fw) >= 600, S.homeLabel);
  expect('首页状态值退成 12px 小字', S.homeVal && S.homeVal.fs === '12px' && Number(S.homeVal.fw) < 500, S.homeVal);
  expect('标签文字仍是「一键优化模式」', /One-click tuning mode|一键优化模式/.test(S.homeText), S.homeText);
  expect('电源页标签没被带偏（仍 12px）', S.powerLabel && S.powerLabel.fs === '12px', S.powerLabel);
  expect('游戏页标签没被带偏（仍 12px）', S.gameLabel && S.gameLabel.fs === '12px', S.gameLabel);

  // ---------- 6. 动态生成的下拉框（游戏开关页）也被升级 ----------
  await ev('document.querySelector(\'.tab[data-tab="game"]\').click()');
  let dyn = null;
  for (let i = 0; i < 20; i++) {
    await wait(500);
    dyn = await ev(`JSON.stringify((() => {
      const s = document.querySelector('#tab-game select');
      if (!s) return { none: true, html: document.getElementById('tab-game').textContent.slice(0, 60) };
      const dd = s.previousElementSibling;
      return { cls: s.className, wrapped: !!(dd && dd.classList.contains('dd')),
        variant: dd ? dd.className : '', label: dd ? dd.querySelector('.dd-cur').textContent : '',
        opts: [...s.options].map(o => o.textContent.trim()) };
    })())`);
    if (!JSON.parse(dyn).none) break;
  }
  log('gameSelect=' + dyn);
  const G = JSON.parse(dyn);
  expect('游戏开关页的下拉框出现了', !G.none, G);
  if (!G.none) {
    expect('动态下拉框也被自动升级', G.wrapped === true, G);
    expect('套用了 game 变体样式', /dd--game/.test(G.variant), G.variant);
    expect('按钮显示当前取值', typeof G.label === 'string' && G.opts.indexOf(G.label) >= 0, G);
    // 只验证能开能关，不改任何开关（改值会写注册表）
    await ev('(() => { const b = document.querySelector("#tab-game .dd-btn"); b.click(); })()');
    await wait(300);
    expect('动态下拉框能展开', (await ev('!!document.querySelector(".dd-list")')) === true);
    const before = await ev('document.querySelector("#tab-game select").value');
    await ev('(() => { const l = document.querySelector(".dd-list"); const first = [...l.querySelectorAll(".dd-item")].find(i => i.querySelector(".dd-label").textContent === document.querySelector("#tab-game .dd-cur").textContent); first.click(); })()');
    await wait(400);
    expect('点当前项不会改值（等价于取消）', (await ev('document.querySelector("#tab-game select").value')) === before, { before, after: await ev('document.querySelector("#tab-game select").value') });
    expect('选完弹层关掉', (await ev('!!document.querySelector(".dd-list")')) === false);
  }

  // ---------- 7. 键盘操作与 Esc ----------
  await ev('document.getElementById("openSettings").click()');
  await wait(300);
  await ev(LB + '.focus()');
  await ev('(() => { const b = ' + LB + '; b.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); })()');
  await wait(300);
  expect('ArrowDown 能展开', (await ev('!!document.querySelector(".dd-list")')) === true);
  await ev('(() => { const b = ' + LB + '; b.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); })()');
  await wait(300);
  expect('Esc 能关闭', (await ev('!!document.querySelector(".dd-list")')) === false);

  // ---------- 8. 代码里赋值 select.value 时按钮要跟着变 ----------
  await ev('(() => { const s = document.getElementById("setLang"); s.value = "zh"; s.dispatchEvent(new Event("change")); })()');
  await wait(1200);
  expect('程序化赋值后按钮文字同步', (await ev(LCUR + '.textContent')) === '中文');
  expect('切回中文正常', (await ev('document.querySelector(\'.tab[data-tab="home"]\').textContent')).indexOf('首页') >= 0);
  await ev(LB + '.click()');
  await wait(250);
  const zhOn = await ev('JSON.stringify([...document.querySelectorAll(".dd-item")].map(i => i.classList.contains("on")))');
  expect('中文态下勾回到第一个选项', zhOn === '[true,false]', zhOn);
  await ev('document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))');
  await wait(250);
  expect('点外面也能关闭', (await ev('!!document.querySelector(".dd-list")')) === false);

  // ---------- 9. 没碰真实数据 ----------
  const lp = await ev('window.optimizer.getPaths()');
  const ledgerFile = path.join(DEST, 'changes-ledger.json');
  expect('账本落在临时目录', path.dirname(lp.ledgerPath) === DEST, lp.ledgerPath);
  expect('账本没被写过（全程只动界面）', !fs.existsSync(ledgerFile) || fs.readFileSync(ledgerFile, 'utf8').trim() === '[]');
  expect('设置只落在临时 userData', fs.existsSync(path.join(DEST, 'settings.json')));
  expect('语言设置确实是 zh', (await ev('window.optimizer.settingsGet().then(s => s.lang)')) === 'zh');
  expect('窗口全程保持隐藏没抢前台', hiddenOk === true && win.isVisible() === false, { hiddenOk, visible: win.isVisible() });

  if (problems.length) log('problems=' + JSON.stringify(problems));
  finish(problems.length === 0 && errors.length === 0 ? 0 : 2);
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

setTimeout(() => {
  if (!done && !targetWin) { errors.push('[no-window] 20 秒内没出现窗口，主进程可能加载失败'); finish(1); }
}, 20000);

setTimeout(() => { errors.push('[timeout] 超过 240 秒未完成'); finish(1); }, 240000);
