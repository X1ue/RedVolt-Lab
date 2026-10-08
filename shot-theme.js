'use strict';
// 临时截图脚本（不发布）：暗红 / 亮蓝两套主题各出一批 PNG 给人眼看配色。
// 隐藏窗口默认被 Chromium 当「被遮挡」而停掉 rAF，背景闪电就不动了 —— 加三个命令行开关保住动画帧，
// 再用 canvas 亮度探一下有没有正好劈在截图里。截图一律落在系统临时目录，不进仓库。
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

app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

const DEST = path.join(os.tmpdir(), `rv-theme-shot-${Date.now()}`);
fs.mkdirSync(DEST, { recursive: true });
app.setPath('userData', DEST);
require('./main.js');

const SHOTS = path.join(os.tmpdir(), 'rv-ui-shots');
fs.mkdirSync(SHOTS, { recursive: true });

let win = null;
app.on('browser-window-created', (e, w) => { if (!win) win = w; });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const raf3 = 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))))';

// 画布上此刻有多少「亮」：闪电是白热芯 + 彩色辉光，alpha 加权求和即可判断有没有劈中
const BRIGHT = `(() => {
  const c = document.getElementById('bgFx');
  if (!c || !c.getContext) return -1;
  const g = c.getContext('2d');
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let sum = 0, hit = 0;
  for (let i = 3; i < d.length; i += 40) { sum += d[i]; if (d[i] > 40) hit++; }
  return Math.round(sum / (d.length / 40)) + '|' + hit;
})()`;

async function shot(name, js) {
  if (js) { await win.webContents.executeJavaScript(js, true); await wait(500); }
  let best = -1;
  for (let i = 0; i < 3; i++) {
    await win.webContents.executeJavaScript(raf3, true);
    await wait(120);
    await win.webContents.capturePage();
  }
  const bright = await win.webContents.executeJavaScript(BRIGHT, true);
  const img = await win.webContents.capturePage();
  const f = path.join(SHOTS, name + '.png');
  fs.writeFileSync(f, img.toPNG());
  best = 1;
  console.log('SHOT ' + f + ' fx=' + bright);
  return best;
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
  const setTheme = (t) => ev(`(() => { const x = document.getElementById('setTheme'); x.value = '${t}'; x.dispatchEvent(new Event('change')); })()`);
  await ev('window.bgFx && window.bgFx.setEnabled(true)');

  // ---------- 暗红 ----------
  await shot('t01-dark-home');
  await ev('document.getElementById("openSettings").click()');
  await shot('t02-dark-settings');
  await ev('document.getElementById("settingsClose").click()');
  await ev('document.querySelector(\'.tab[data-tab="disk"]\').click()');
  await wait(1200);
  await ev('document.getElementById("diskSelectSafe").click()');
  await shot('t03-dark-disk');

  // ---------- 亮蓝 ----------
  await setTheme('blue');
  await ev('document.querySelector(\'.tab[data-tab="home"]\').click()');
  await wait(2500);
  await shot('t04-blue-home');
  await ev('document.getElementById("openSettings").click()');
  await shot('t05-blue-settings');
  await ev('document.getElementById("settingsClose").click()');
  await ev('document.querySelector(\'.tab[data-tab="disk"]\').click()');
  await wait(1200);
  await ev('document.getElementById("diskSelectSafe").click()');
  await shot('t06-blue-disk');

  // 连拍找一道正好在画面里的闪电
  for (let i = 0; i < 3; i++) {
    const b = await ev(BRIGHT);
    await shot('t07-blue-bolt-' + i + '_' + String(b).replace('|', '_'));
    await wait(700);
  }

  await setTheme('dark');
  await ev('document.querySelector(\'.tab[data-tab="home"]\').click()');
  await wait(1000);
  await shot('t08-back-dark');
  console.log('SETTINGS_JSON=' + JSON.stringify(fs.readFileSync(path.join(DEST, 'settings.json'), 'utf8')));
  await ev('window.bgFx && window.bgFx.setPaused && window.bgFx.setPaused(true)');
  app.exit(0);
});

setTimeout(() => { console.log('TIMEOUT'); app.exit(1); }, 180000);
