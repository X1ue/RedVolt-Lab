'use strict';
// 第二轮探测：系统信息卡片、大文件夹统计（只读）、越权守卫
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
  win.webContents.on('console-message', (e, level, m) => { if (level >= 2) errors.push('[console] ' + m); });
  win.webContents.on('render-process-gone', (e, d) => errors.push('[render-gone] ' + JSON.stringify(d)));
  const ev = (js) => win.webContents.executeJavaScript(js, true);
  await new Promise((r) => setTimeout(r, 2500));

  // 系统信息卡片
  await ev(`document.querySelector('button[data-tab="info"]').click(); 1`);
  await new Promise((r) => setTimeout(r, 15000));
  log('cards=' + JSON.stringify(await ev(
    'JSON.stringify([...document.querySelectorAll("#infoCards .card")].map(c=>c.textContent.replace(/\\s+/g," ").trim()))'
  )));

  // 大文件夹统计（只读）
  const tempRoot = JSON.stringify(process.env.TEMP);
  log('folderRootSet=' + JSON.stringify(await ev(
    `(function(){const s=document.getElementById('folderRoot'); s.value=${tempRoot}; document.getElementById('folderScan').click(); return s.value;})()`
  )));
  await new Promise((r) => setTimeout(r, 45000));
  log('folderRows=' + JSON.stringify(await ev(
    'JSON.stringify([...document.querySelectorAll("#folderList .row")].slice(0,5).map(r=>r.textContent.replace(/\\s+/g," ").trim().slice(0,70)))'
  )));
  log('folderStatus=' + (await ev('document.getElementById("status").textContent')));

  // 守卫：未确认的启动项修改必须被拒绝
  log('startupGuard=' + JSON.stringify(await ev(
    'window.optimizer.startupList().then(r=>r.items[0].id).then(id=>window.optimizer.startupSet(id,false,false))'
  )));
  log('startupStillEnabled=' + JSON.stringify(await ev(
    'window.optimizer.startupList().then(r=>({n:r.items.length,enabled:r.items.filter(i=>i.enabled).length}))'
  )));

  // 守卫：非法 ID / 越界路径
  log('bogusIds=' + JSON.stringify(await ev('window.optimizer.cleanUser(["../../Windows/System32","notAnId"], true)')));
  log('bogusRoot=' + JSON.stringify(await ev('window.optimizer.topFolders("C:\\\\Windows\\\\System32", 5)')));
  log('openPathGuard=' + JSON.stringify(await ev('window.optimizer.openPath("C:\\\\Windows")')));

  // 日志页
  await ev(`document.querySelector('button[data-tab="log"]').click(); 1`);
  await new Promise((r) => setTimeout(r, 2000));
  log('logLines=' + (await ev('document.getElementById("logBody").textContent.split("\\n").length')));
  log('logHead=' + JSON.stringify(await ev('document.getElementById("logBody").textContent.slice(0,160)')));
}

app.whenReady().then(() => {
  const wait = setInterval(() => {
    const wins = BrowserWindow.getAllWindows();
    if (!wins.length) return;
    clearInterval(wait);
    probe(wins[0]).then(() => finish(0)).catch((e) => { errors.push('[probe] ' + (e && e.stack || e)); finish(1); });
  }, 300);
  setTimeout(() => finish(1), 200000);
});
