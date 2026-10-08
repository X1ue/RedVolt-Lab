'use strict';
// smoke2 探测：系统信息卡片、大文件夹统计（只读）、越权守卫。
// 窗口全程隐藏（不抢前台），userData 指向临时目录，绝不读写真实设置 / 账本 / 清理记录。
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

const DEST = path.join(os.tmpdir(), `rv-probe-smoke-${Date.now()}`);
fs.mkdirSync(DEST, { recursive: true });
// 必须在 require('./main.js') 之前：require 就是起真实主进程，顺序写反了会读写用户真实数据
app.setPath('userData', DEST);

require('./main.js');

const errors = [];
let done = false;
function log(...a) {
  const line = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  // 输出被 head 之类提前截断时 stdout 会 EPIPE，这是管道问题不是测试失败，别弹 Electron 错误框
  try { process.stdout.write(line + '\n'); } catch (e) { if (!e || e.code !== 'EPIPE') throw e; }
}
process.stdout.on('error', (e) => { if (!e || e.code !== 'EPIPE') throw e; });

function finish(code) {
  if (done) return;
  done = true;
  log('---- errors ----');
  log(errors.length ? errors.join('\n') : '(none)');
  log('userDataFiles=' + JSON.stringify(fs.readdirSync(DEST)));
  setTimeout(() => app.exit(code), 200);
}

async function probe(win) {
  win.webContents.on('console-message', (e, level, m) => { if (level >= 2) errors.push('[console] ' + m); });
  win.webContents.on('render-process-gone', (e, d) => errors.push('[render-gone] ' + JSON.stringify(d)));
  const ev = (js) => win.webContents.executeJavaScript(js, true);
  await new Promise((r) => setTimeout(r, 2500));
  log('hiddenWindow=' + hiddenOk);

  // 临时 userData 是全新的，首启免责声明挡在前面，先过掉
  if (await ev('!document.getElementById("eulaModal").classList.contains("hidden")')) {
    await ev('(() => { const c = document.getElementById("eulaAck"); c.checked = true; c.dispatchEvent(new Event("change")); })()');
    await new Promise((r) => setTimeout(r, 200));
    await ev('document.getElementById("eulaEnter").click()');
    await new Promise((r) => setTimeout(r, 600));
  }
  log('eulaPassed=' + (await ev('document.getElementById("eulaModal").classList.contains("hidden")')));

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

// show:false 的窗口不一定出现在 getAllWindows() 里，所以用 browser-window-created 事件抓
let targetWin = null;
app.on('browser-window-created', (e, w) => { if (!targetWin) targetWin = w; });

app.whenReady().then(() => {
  const waitWin = () => {
    if (!targetWin) return setTimeout(waitWin, 200);
    probe(targetWin).then(() => finish(0)).catch((e) => { errors.push('[probe] ' + (e && e.stack ? e.stack : e)); finish(1); });
  };
  waitWin();
});

// 加载期报错时 Electron 不会自己退出，留个硬超时免得白等
setTimeout(() => {
  if (!done && !targetWin) { errors.push('[no-window] 20 秒内没出现窗口，主进程可能加载失败'); finish(1); }
}, 20000);

setTimeout(() => { errors.push('[timeout] 超过 240 秒未完成'); finish(1); }, 240000);
