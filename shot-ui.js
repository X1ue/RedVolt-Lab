'use strict';
// 临时截图脚本（不发布）：隐藏窗口打开下拉框弹层，capturePage 存 PNG 给人眼看效果。
const Module = require('module');
const origLoad = Module._load;
let bwProxy = null;
Module._load = function (request) {
  const exp = origLoad.apply(this, arguments);
  if (request !== 'electron' || !exp || typeof exp.BrowserWindow !== 'function') return exp;
  if (!bwProxy) {
    const Real = exp.BrowserWindow;
    class Hidden extends Real { constructor(o) { super(Object.assign({}, o, { show: false })); } }
    bwProxy = new Proxy(exp, { get: (t, k) => (k === 'BrowserWindow' ? Hidden : Reflect.get(t, k)) });
  }
  return bwProxy;
};

const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEST = path.join(os.tmpdir(), `rv-shot-${Date.now()}`);
fs.mkdirSync(DEST, { recursive: true });
app.setPath('userData', DEST);
require('./main.js');

const SHOTS = path.join(os.tmpdir(), 'rv-ui-shots');
fs.mkdirSync(SHOTS, { recursive: true });

let win = null;
app.on('browser-window-created', (e, w) => { if (!win) win = w; });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const raf3 = 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))))';

async function shot(name, js) {
  if (js) { await win.webContents.executeJavaScript(js, true); await wait(450); }
  const st = await win.webContents.executeJavaScript(`JSON.stringify((() => {
    const l = document.querySelector('.dd-list');
    if (!l) return { list: null, bodyKids: document.body.children.length };
    const cs = getComputedStyle(l);
    const r = l.getBoundingClientRect();
    return { n: l.children.length, pos: cs.position, z: cs.zIndex, vis: cs.visibility, disp: cs.display,
      op: cs.opacity, bg: cs.backgroundColor, w: Math.round(r.width), h: Math.round(r.height),
      x: Math.round(r.x), y: Math.round(r.y), inBody: l.parentElement === document.body,
      vw: innerWidth, vh: innerHeight };
  })())`, true);
  console.log('STATE ' + name + ' = ' + st);
  // 隐藏窗口不产新帧，capturePage 会拿到上一帧；先逼出几帧再截
  for (let i = 0; i < 3; i++) {
    await win.webContents.executeJavaScript(raf3, true);
    await wait(120);
    await win.webContents.capturePage();
  }
  const img = await win.webContents.capturePage();
  const f = path.join(SHOTS, name + '.png');
  fs.writeFileSync(f, img.toPNG());
  console.log('SHOT ' + f);
}

app.whenReady().then(async () => {
  while (!win) await wait(200);
  await wait(3000);
  const ev = (js) => win.webContents.executeJavaScript(js, true);
  if (await ev('!document.getElementById("eulaModal").classList.contains("hidden")')) {
    await ev('(() => { const c = document.getElementById("eulaAck"); c.checked = true; c.dispatchEvent(new Event("change")); })()');
    await wait(200);
    await ev('document.getElementById("eulaEnter").click()');
    await wait(600);
  }
  await shot('01-home-closed');
  await shot('02-lang-open', 'document.querySelector(".dd--lang .dd-btn").click()');
  await shot('03-lang-closed', 'dropdown.close()');
  await ev('document.querySelector(\'.tab[data-tab="game"]\').click()');
  await wait(2500);
  await shot('04-game-open', 'document.querySelector("#tab-game .dd-btn").click()');
  await ev('dropdown.close()');
  await ev('(() => { const s = document.getElementById("langSel"); s.value = "en"; s.dispatchEvent(new Event("change")); })()');
  await wait(1500);
  await ev('document.querySelector(\'.tab[data-tab="home"]\').click()');
  await wait(1200);
  await shot('05-home-en');
  await ev('document.querySelector(\'.tab[data-tab="game"]\').click()');
  await wait(2000);
  await shot('06-game-en-open', 'document.querySelector("#tab-game .dd-btn").click()');
  await ev('dropdown.close()');
  await ev('(() => { const s = document.getElementById("langSel"); s.value = "zh"; s.dispatchEvent(new Event("change")); })()');
  await wait(1200);
  await ev('document.querySelector(\'.tab[data-tab="update"]\').click()');
  await wait(600);
  await shot('07-update-zh');
  await ev('document.querySelector(\'.tab[data-tab="info"]\').click()');
  await wait(1500);
  await shot('08-info-open', 'document.getElementById("folderRoot").previousElementSibling.querySelector(".dd-btn").click()');
  app.exit(0);
});

setTimeout(() => { console.log('timeout'); app.exit(1); }, 120000);
