'use strict';
// smoke22：全盘垃圾搜索入口（删除权限受允许根白名单约束）、各多选列表的全选/清空操作，
// 以及「找到 N · 可清理 K」这套文案在双语层是否被完整翻译。
// 窗口隐藏、userData 使用临时目录；不启动磁盘扫描、不删除文件、不调用提权通道。
const Module = require('module');
const originalLoad = Module._load;
let proxied = null;
Module._load = function (request) {
  const exp = originalLoad.apply(this, arguments);
  if (request !== 'electron' || !exp || typeof exp.BrowserWindow !== 'function') return exp;
  if (!proxied) {
    const Real = exp.BrowserWindow;
    class Hidden extends Real {
      constructor(options) { super(Object.assign({}, options, { show: false })); }
    }
    proxied = new Proxy(exp, { get: (target, key) => key === 'BrowserWindow' ? Hidden : Reflect.get(target, key) });
  }
  return proxied;
};

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const destination = path.join(os.tmpdir(), `rv-smoke22-${Date.now()}`);
fs.mkdirSync(destination, { recursive: true });
app.setPath('userData', destination);
let targetWindow = null;
app.on('browser-window-created', (event, win) => { if (!targetWindow) targetWindow = win; });
require('./main.js');

const failures = [];
const expect = (name, ok, extra) => {
  const line = `${ok ? 'PASS' : 'FAIL'} ${name}${ok || extra === undefined ? '' : ` -> ${JSON.stringify(extra)}`}`;
  try { process.stdout.write(line + '\n'); } catch (_) { /* avoid EPIPE dialogs */ }
  if (!ok) failures.push(name);
};
process.stdout.on('error', (e) => { if (!e || e.code !== 'EPIPE') throw e; });

async function waitForWindow() {
  for (let i = 0; i < 100; i++) {
    const win = targetWindow || BrowserWindow.getAllWindows()[0];
    if (win && win.webContents.getURL()) return win;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('window did not load');
}

async function run() {
  await app.whenReady();
  const win = await waitForWindow();
  win.webContents.on('console-message', (e, level, message) => { if (level >= 2) failures.push(`console: ${message}`); });
  await new Promise((resolve) => setTimeout(resolve, 1600));
  const ev = (js) => win.webContents.executeJavaScript(js, true);
  if (await ev('!document.getElementById("eulaModal").classList.contains("hidden")')) {
    await ev('(() => { const c = document.getElementById("eulaAck"); c.checked = true; c.dispatchEvent(new Event("change")); document.getElementById("eulaEnter").click(); })()');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  expect('window hidden', !win.isVisible());
  expect('full disk search controls present', !!await ev('document.getElementById("fullDiskScan") && document.getElementById("fullDiskClean")'));
  await ev('document.querySelector("[data-tab=disk]").click(); document.getElementById("diskSelectNone").click(); document.getElementById("diskSelectAll").click()');
  const disk = await ev(`(() => {
    const rows = [...document.querySelectorAll('#diskList .row')];
    return {
      total: rows.length,
      allOrdinary: rows.filter(r => !/NVIDIA 着色器缓存/.test(r.textContent)).every(r => r.querySelector('input').checked),
      nvidiaExcluded: rows.filter(r => /NVIDIA 着色器缓存/.test(r.textContent)).every(r => !r.querySelector('input').checked),
    };
  })()`);
  expect('disk select-all selects ordinary cleanup items', disk.allOrdinary && disk.total > 0, disk);
  expect('disk select-all preserves NVIDIA opt-in', disk.nvidiaExcluded, disk);

  await ev('document.querySelector("[data-tab=system]").click(); document.getElementById("sysSelectAll").click()');
  const system = await ev(`(() => {
    const boxes = [...document.querySelectorAll('#systemList input[type=checkbox]')];
    return { count: boxes.length, all: boxes.length > 0 && boxes.every(x => x.checked) };
  })()`);
  expect('system select-all selects listed items', system.all, system);
  await ev('document.getElementById("sysSelectNone").click()');
  expect('system clear-selection clears listed items', await ev('[...document.querySelectorAll("#systemList input[type=checkbox]")].every(x => !x.checked)'));

  const denied = await ev('window.optimizer.cleanFullDisk(["tmp"], false)');
  expect('full disk IPC refuses cleanup without confirmation', denied.ok === false && /未经确认/.test(denied.message), denied);
  expect('full disk scan is not started by page load', await ev('document.getElementById("fullDiskSummary").textContent.includes("尚未扫描")'));
  const gated = await ev(`(() => {
    const s = document.getElementById('fullDiskSummary').textContent;
    return {
      s,
      all: document.getElementById('fullDiskSelectAll').disabled,
      none: document.getElementById('fullDiskSelectNone').disabled,
      clean: document.getElementById('fullDiskClean').disabled,
    };
  })()`);
  expect('full disk idle copy states the allowlist boundary', /允许清理目录/.test(gated.s), gated);
  expect('full disk bulk buttons stay disabled before a scan', gated.all && gated.none && gated.clean, gated);

  const tr = (zh) => ev(`window.i18n.translate(${JSON.stringify(zh)})`);
  const note = await tr('超过 30 天 · 找到 3 个 · 可清理 1 个');
  expect('category note template translates', note === 'Older than 30 days · found 3 files, 1 deletable', note);
  const sum = await tr('扫描完成：C: · 检查 10 个目录 · 找到 5 个 · 可清理 2 个 · 1.2 GB');
  expect('scan summary template translates', sum === 'Scan complete: C: · checked 10 directories · found 5 files · 2 deletable · 1.2 GB', sum);
  const stat = await tr('全盘搜索完成：找到 5 个 · 可清理 2 个');
  expect('status line template translates', stat === 'Full-drive search complete: found 5 files, 2 deletable', stat);
  for (const sentence of [
    '尚未扫描。搜索会读遍所有本地磁盘，但只有位于允许清理目录内的文件才能删除。',
    '只删除位于允许清理目录内、超过 30 天的文件（与各清理项同一条安全边界；受保护目录和数据库日志一律不删）。删除前会再次核对文件类型、时间、大小和路径；文件已变化、被占用或受保护时会跳过。此操作不可撤销。',
    '可清理候选文件超过 50000 个；超出部分已统计但不允许批量清理，请缩小范围后再扫',
  ]) {
    const out = await tr(sentence);
    expect('copy fully translated: ' + sentence.slice(0, 12), !/[\u3400-\u9fff]/.test(out), out);
  }
  const code = failures.length ? 1 : 0;
  try { process.stdout.write(`Result: ${code ? failures.length + ' failures' : 'all passed'}\n`); } catch (_) { /* ignore */ }
  app.exit(code);
}

run().catch((e) => {
  try { process.stdout.write(`ERROR ${e.stack || e}\n`); } catch (_) { /* ignore */ }
  app.exit(1);
});
