'use strict';
// 第三轮：走通真实清理管线（选用空目录 crashDumps，不删除任何真实数据）
const { app, BrowserWindow } = require('electron');
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

  log('scanBefore=' + JSON.stringify(await ev(
    'window.optimizer.scanUser(["crashDumps"]).then(r=>r.map(x=>({id:x.id,status:x.status,size:x.size,count:x.count})))'
  )));
  log('cleanRun=' + JSON.stringify(await ev('window.optimizer.cleanUser(["crashDumps"], true)')));
  log('scanAfter=' + JSON.stringify(await ev(
    'window.optimizer.scanUser(["crashDumps"]).then(r=>r.map(x=>({id:x.id,status:x.status,size:x.size,count:x.count})))'
  )));
  log('logTail=' + JSON.stringify(await ev('window.optimizer.readLog().then(r=>r.slice(0,3))')));
  log('freeSpace=' + JSON.stringify(await ev('window.optimizer.diskFree()')));
}

app.whenReady().then(() => {
  const wait = setInterval(() => {
    const wins = BrowserWindow.getAllWindows();
    if (!wins.length) return;
    clearInterval(wait);
    probe(wins[0]).then(() => finish(0)).catch((e) => { errors.push('[probe] ' + (e && e.stack || e)); finish(1); });
  }, 300);
  setTimeout(() => finish(1), 90000);
});
