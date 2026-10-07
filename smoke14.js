'use strict';
// 1.2.0 HAGS「改了还没重启」冒烟：只往临时 userData 塞一条假的改动时间，读真实注册表状态。
// 全程不点「应用」、不写注册表、不弹 UAC；窗口保持隐藏。
const Module = require('module');
const origLoad = Module._load;
let bwProxy = null;
let hiddenOk = false;
Module._load = function (request) {
  const exp = origLoad.apply(this, arguments);
  if (request !== 'electron' || !exp || typeof exp.BrowserWindow !== 'function') return exp;
  if (!hiddenOk) {
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

const DEST = path.join(os.tmpdir(), `rv-hags-smoke-${Date.now()}`);
fs.mkdirSync(DEST, { recursive: true });
app.setPath('userData', DEST);
const BACKUP_FILE = path.join(DEST, 'game-switch-backup.json');

require('./main.js');

const errors = [];
let done = false;
function log(...a) {
  const line = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  try { process.stdout.write(line + '\n'); } catch (e) { if (!e || e.code !== 'EPIPE') throw e; }
}
process.stdout.on('error', (e) => { if (!e || e.code !== 'EPIPE') throw e; });
function finish(code) {
  if (done) return;
  done = true;
  log('---- errors ----');
  log(errors.length ? errors.join('\n') : '(none)');
  log(code === 0 ? '结果: 全部通过' : '结果: 有失败项');
  setTimeout(() => app.exit(code), 200);
}
const problems = [];
const expect = (name, ok, extra) => {
  log((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  -> ' + JSON.stringify(extra)));
  if (!ok) problems.push(name);
};
const CJK = /[\u3400-\u9fff]/;

let targetWin = null;
app.on('browser-window-created', (e, w) => { if (!targetWin) targetWin = w; });

// 一条假的备份记录：原值 + 刚刚的改动时间戳 = 「写完还没重启」
function stampBackup(atMs) {
  fs.writeFileSync(BACKUP_FILE, JSON.stringify({
    ver: 1,
    items: { hags: { at: atMs, values: [{ rid: 'hags', exists: true, value: 1 }] } },
    changes: { hags: atMs },
  }, null, 2), 'utf8');
}

async function probe(win) {
  win.webContents.on('console-message', (e, level, message) => { if (level >= 2) errors.push('[console] ' + message); });
  win.webContents.on('render-process-gone', (e, d) => errors.push('[render-gone] ' + JSON.stringify(d)));
  const ev = (js) => win.webContents.executeJavaScript(js, true);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  await wait(2500);
  log('hiddenWindow=' + hiddenOk);
  if (await ev('!document.getElementById("eulaModal").classList.contains("hidden")')) {
    await ev('(() => { const c = document.getElementById("eulaAck"); c.checked = true; c.dispatchEvent(new Event("change")); })()');
    await wait(200);
    await ev('document.getElementById("eulaEnter").click()');
    await wait(600);
  }

  const rowDump = () => ev(`(() => {
    const rows = [...document.querySelectorAll('#gameList .game-row')];
    // 按位置取第一行（白名单里 hags 排第一），免得中英文切换后靠名字匹配失效
    const first = rows[0];
    return {
      all: rows.map(r => r.textContent.replace(/\\s+/g, ' ').trim()),
      hags: first ? [...first.querySelectorAll('.badge')].map(b => ({ text: b.textContent, cls: b.className })) : null,
      firstName: first ? (first.querySelector('.game-name') || {}).textContent : null,
    };
  })()`);

  const PEND = /重启后才生效|takes effect after a reboot/;
  const hasPend = (d) => !!(d.hags || []).some((b) => PEND.test(b.text));
  const noPend = (d) => d.hags && !hasPend(d);

  async function openGame(pred) {
    await ev('document.querySelector(\'.tab[data-tab="game"]\').click()');
    for (let i = 0; i < 30; i++) {
      const d = await rowDump();
      if (d.hags && (!pred || pred(d))) return d;
      await wait(500);
    }
    return await rowDump();
  }

  async function reloadGame(pred) {
    await ev('document.getElementById("gameReload").click()');
    for (let i = 0; i < 30; i++) {
      const d = await rowDump();
      if (d.hags && (!pred || pred(d))) return d;
      await wait(500);
    }
    return await rowDump();
  }

  // ---------- 1. 改动时间刚刚 = 本次开机之后 → 该有「还没重启」标记 ----------
  stampBackup(Date.now() - 3000);
  let d = await openGame(hasPend);
  log('hagsRow=' + JSON.stringify(d.all));
  expect('读到了真实的 HAGS 状态', d.hags && d.hags.length >= 1, d.hags);
  expect('状态徽章是已开启/已关闭之一', d.hags && d.hags.some((b) => /已开启|已关闭/.test(b.text)), d.hags);
  expect('改过了 → 出现「改过了，重启后才生效」', d.hags && d.hags.some((b) => b.text === '改过了，重启后才生效'), d.hags);
  expect('同时保留「已备份原值」', d.hags && d.hags.some((b) => b.text === '已备份原值'), d.hags);

  // ---------- 2. 改动时间在开机之前 → 不该再提示没重启 ----------
  stampBackup(Date.now() - (os.uptime() + 600) * 1000);
  await wait(300);
  d = await reloadGame(noPend);
  expect('重启过了就不再标「改过了」', noPend(d), d.hags);

  // ---------- 3. 从没被本软件改过 → 完全没有这条提示 ----------
  fs.rmSync(BACKUP_FILE, { force: true });
  await wait(300);
  d = await reloadGame(noPend);
  expect('没改动记录时不瞎猜状态', noPend(d), d.hags);
  expect('其它开关不会被标 pending', !d.all.some((t) => /Game DVR|Xbox 游戏栏|游戏模式|窗口透明|视觉效果/.test(t) && /改过了/.test(t)), d.all);

  // ---------- 4. 英文界面 ----------
  await ev('window.i18n.setLang("en", window.optimizer)');
  stampBackup(Date.now() - 3000);
  await wait(400);
  d = await reloadGame(hasPend);
  const enRow = await ev('(() => { const r=[...document.querySelectorAll("#gameList .game-row")].find(x=>/HAGS/.test(x.textContent)); return r ? r.textContent.replace(/\\s+/g," ").trim() : ""; })()');
  log('enRow=' + enRow);
  expect('英文下有 takes effect after a reboot', /takes effect after a reboot/i.test(enRow), enRow.slice(0, 120));
  expect('英文行里没有中文残渣', !CJK.test(enRow), enRow.slice(0, 120));
  await ev('window.i18n.setLang("zh", window.optimizer)');
  await wait(500);

  // ---------- 5. 什么都没写 ----------
  expect('窗口全程隐藏', win.isVisible() === false);
  expect('没有产生任何变更账本', !fs.existsSync(path.join(DEST, 'changes-ledger.json')));

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
setTimeout(() => { errors.push('[timeout] 超过 200 秒未完成'); finish(1); }, 200000);
