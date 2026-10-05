'use strict';
// 冒烟测试入口：加载真实 main.js，再驱动窗口执行只读探测
const { app, BrowserWindow } = require('electron');
require('./main.js');

const out = [];
const errors = [];
let done = false;

function log(...a) {
  const line = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  out.push(line);
  process.stdout.write(line + '\n');
}

function finish(code) {
  if (done) return;
  done = true;
  log('---- errors ----');
  log(errors.length ? errors.join('\n') : '(none)');
  setTimeout(() => app.exit(code), 200);
}

async function probe(win) {
  win.webContents.on('console-message', (e, level, message) => {
    if (level >= 2) errors.push('[console] ' + message);
  });
  win.webContents.on('render-process-gone', (e, d) => errors.push('[render-gone] ' + JSON.stringify(d)));
  win.webContents.on('did-fail-load', (e, c, d, u) => errors.push('[fail-load] ' + c + ' ' + d + ' ' + u));

  const ev = (js) => win.webContents.executeJavaScript(js, true);

  await new Promise((r) => setTimeout(r, 2500));

  log('title=' + (await ev('document.title')));
  log('freeSpace=' + (await ev('document.getElementById("freeSpace").textContent')));
  log('diskRows=' + (await ev('document.querySelectorAll("#diskList .row").length')));
  log('systemRows=' + (await ev('document.querySelectorAll("#systemList .row").length')));
  log('status=' + (await ev('document.getElementById("status").textContent')));
  log('checkedDefault=' + JSON.stringify(await ev(
    'JSON.stringify([...document.querySelectorAll("#diskList .row")].map(r=>(r.querySelector(".name").textContent)+(r.querySelector("input").checked?"[x]":"[ ]")))'
  )));

  log('paths=' + JSON.stringify(await ev('window.optimizer.getPaths()')));

  log('scanProbe=' + JSON.stringify(await ev(
    'window.optimizer.scanUser(["tempOld","chromeCache","recycleBin","npmCache","crashDumps","nvidiaDXCache"]).then(r=>r.map(x=>({id:x.id,status:x.status,size:x.size,count:x.count,msg:x.message})))'
  )));

  log('startupProbe=' + JSON.stringify(await ev(
    'window.optimizer.startupList().then(r=>({ok:r.ok,n:(r.items||[]).length,first:(r.items||[])[0]||null,msg:r.message}))'
  )));

  log('sysinfoProbe=' + JSON.stringify(await ev(
    'window.optimizer.sysInfo().then(d=>({keys:Object.keys(d),os:d.osCaption,cpu:d.cpuName,load:d.cpuLoad,disks:(d.disks||[]).length,ram:d.totalRam,localPlatform:(d.local||{}).platform,err:d.error}))'
  )));

  log('logProbe=' + JSON.stringify(await ev(
    'window.optimizer.readLog().then(r=>({isArray:Array.isArray(r),n:r.length,first:r[0]||null}))'
  )));

  // 未确认的清理必须被拒绝（destructive guard 测试）
  log('guardProbe=' + JSON.stringify(await ev(
    'window.optimizer.cleanUser(["tempOld"], false).then(r=>({ok:r.ok,msg:r.message}))'
  )));

  // 标签切换（每步等待 busy 结束，避免 doScan 被 busy 挡掉）
  const waitIdle = async (ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const busy = await ev('!!document.getElementById("diskScan").disabled');
      if (!busy) return true;
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  };

  for (const t of ['startup', 'info', 'log', 'system', 'disk']) {
    await ev(`document.querySelector('button[data-tab="${t}"]').click(); 1`);
    const active = await ev('document.querySelector(".panel.active").id');
    await waitIdle(30000);
    log('tab ' + t + ' -> ' + active);
    if (t === 'startup') {
      log('  startupRows=' + (await ev('document.querySelectorAll("#startupList .row").length')));
      log('  backupPath=' + JSON.stringify(await ev('document.getElementById("backupPath").textContent.slice(0,120)')));
      log('  firstRow=' + JSON.stringify(await ev(
        '(document.querySelector("#startupList .row")||{textContent:"(none)"}).textContent.replace(/\\s+/g," ").trim().slice(0,120)'
      )));
    }
    if (t === 'info') {
      log('  cards=' + JSON.stringify(await ev(
        'JSON.stringify([...document.querySelectorAll("#infoCards .card")].map(c=>c.textContent.replace(/\\s+/g," ").trim().slice(0,60)))'
      )));
      log('  folderRootOptions=' + (await ev('document.getElementById("folderRoot").options.length')));
    }
    if (t === 'log') {
      log('  logPathText=' + JSON.stringify(await ev('document.getElementById("logPath").textContent')));
    }
  }

  // 扫描按钮（真实只读扫描）
  await ev('document.getElementById("diskScan").click(); 1');
  await waitIdle(60000);
  log('afterScanStatus=' + (await ev('document.getElementById("status").textContent')));
  log('afterScanRows=' + JSON.stringify(await ev(
    'JSON.stringify([...document.querySelectorAll("#diskList .row")].map(r=>r.textContent.replace(/\\s+/g," ").trim().slice(0,80)))'
  )));

  // 确认弹窗：应显示真实数字，取消后不执行
  await ev('document.getElementById("diskClean").click(); 1');
  await new Promise((r) => setTimeout(r, 12000));
  log('modalHidden=' + (await ev('document.getElementById("modal").classList.contains("hidden")')));
  log('modalText=' + JSON.stringify(await ev(
    '(document.getElementById("modalTitle").textContent+" | "+document.getElementById("modalDesc").textContent+" | "+document.getElementById("modalList").textContent.replace(/\\s+/g," ").slice(0,200))'
  )));
  await ev('document.getElementById("modalCancel").click(); 1');
  await new Promise((r) => setTimeout(r, 500));
  log('afterCancelHidden=' + (await ev('document.getElementById("modal").classList.contains("hidden")')));
  log('finalStatus=' + (await ev('document.getElementById("status").textContent')));
}

app.whenReady().then(() => {
  const wait = setInterval(() => {
    const wins = BrowserWindow.getAllWindows();
    if (!wins.length) return;
    clearInterval(wait);
    probe(wins[0]).then(() => finish(0)).catch((e) => { errors.push('[probe] ' + (e && e.stack || e)); finish(1); });
  }, 300);
  setTimeout(() => finish(errors.length ? 1 : 0), 280000);
});
