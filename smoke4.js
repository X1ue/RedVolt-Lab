'use strict';
// 第四轮：实测系统级扫描提权链路（userData 用中文目录复现打包环境）
const path = require('path');
const os = require('os');
const { app, BrowserWindow } = require('electron');

app.setPath('userData', path.join(os.tmpdir(), '系统优化助手-冒烟'));
require('./main.js');

const errors = [];
let done = false;
function log(...a) {
  process.stdout.write(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ') + '\n');
}
function finish(code) {
  if (done) return;
  done = true;
  log('---- errors ----');
  log(errors.length ? errors.join('\n') : '(none)');
  setTimeout(() => app.exit(code), 200);
}

async function probe(win) {
  win.webContents.on('console-message', (e, l, m) => { if (l >= 2) errors.push('[console] ' + m); });
  const ev = (js) => win.webContents.executeJavaScript(js, true);
  await new Promise((r) => setTimeout(r, 2500));
  log('userData=' + JSON.stringify(await ev('window.optimizer.getPaths().then(p=>p.userData)')));

  await ev(`document.querySelector('button[data-tab="system"]').click(); 1`);
  await new Promise((r) => setTimeout(r, 500));
  log('clicking sysScan —— 等待 UAC 授权……');
  await ev('document.getElementById("sysScan").click(); 1');

  const t0 = Date.now();
  let status = '';
  while (Date.now() - t0 < 120000) {
    status = await ev('document.getElementById("status").textContent');
    if (/扫描完成|失败|取消|出错/.test(status)) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  log('status=' + status);
  log('systemRows=' + JSON.stringify(await ev(
    'JSON.stringify([...document.querySelectorAll("#systemList .row")].map(r=>r.textContent.replace(/\\s+/g," ").trim().slice(0,90)))'
  )));
  log('logTail=' + JSON.stringify(await ev('window.optimizer.readLog().then(r=>r.slice(0,2))')));
}

app.whenReady().then(() => {
  const wait = setInterval(() => {
    const wins = BrowserWindow.getAllWindows();
    if (!wins.length) return;
    clearInterval(wait);
    probe(wins[0]).then(() => finish(0)).catch((e) => { errors.push('[probe] ' + (e && e.stack || e)); finish(1); });
  }, 300);
  setTimeout(() => finish(1), 180000);
});
