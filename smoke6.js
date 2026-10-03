'use strict';
// 冒烟测试：假 isPackaged + 本地 HTTP 更新源，验证 检查 → 发现 → 下载 → 就绪 全链路
// 绝不调用真实安装（不会点「安装并重启」），只测未确认拒绝
const { app, BrowserWindow } = require('electron');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

Object.defineProperty(app, 'isPackaged', { get: () => true });

const VERSION = '99.9.9';
const NAME = `SysOptimizer-Setup-${VERSION}.exe`;
const BLOB = crypto.randomBytes(2 * 1024 * 1024);
const SHA = crypto.createHash('sha512').update(BLOB).digest('base64');
const YML = [
  `version: ${VERSION}`,
  'files:',
  `  - url: ${NAME}`,
  `    sha512: ${SHA}`,
  `    size: ${BLOB.length}`,
  `path: ${NAME}`,
  `sha512: ${SHA}`,
  'releaseNotes: 冒烟测试假更新',
  `releaseDate: '${new Date().toISOString()}'`,
  '',
].join('\n');

let requests = [];
let wroteConfig = false;
let cfgPath = '';
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  requests.push(req.method + ' ' + p + (req.headers.range ? ' [range]' : ''));
  if (p.endsWith('/latest.yml')) {
    res.writeHead(200, { 'content-type': 'text/yaml; charset=utf-8', 'content-length': Buffer.byteLength(YML) });
    res.end(YML);
    return;
  }
  if (p.endsWith('/' + NAME)) {
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': BLOB.length });
    res.end(BLOB);
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

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
  try { server.close(); } catch (e) { /* ignore */ }
  if (wroteConfig && cfgPath) {
    try { fs.unlinkSync(cfgPath); log('已删除临时 app-update.yml'); } catch (e) { log('删除临时配置失败: ' + e.message); }
  }
  // 清理 electron-updater 的下载缓存目录
  const local = process.env.LOCALAPPDATA || '';
  for (const name of ['sys-optimizer-updater', `${app.getName()}-updater`]) {
    if (!local) break;
    const cache = path.join(local, name);
    try { fs.rmSync(cache, { recursive: true, force: true }); log('已清理下载缓存: ' + cache); } catch (e) { log('清理缓存目录失败: ' + e.message); }
  }
  log('---- 请求记录 ----');
  for (const r of requests) log('  ' + r);
  log('---- errors ----');
  log(errors.length ? errors.join('\n') : '(none)');
  setTimeout(() => app.exit(code), 200);
}

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  process.env.SYSOPT_FEED_URL = `http://127.0.0.1:${port}/`;
  log('本地更新源: ' + process.env.SYSOPT_FEED_URL);

  // 真实打包时 electron-builder 会生成 resources/app-update.yml；
  // 这里补一个同样的文件，NsisUpdater 下载阶段需要读它（updaterCacheDirName）
  cfgPath = path.join(process.resourcesPath, 'app-update.yml');
  wroteConfig = !fs.existsSync(cfgPath);
  if (wroteConfig) {
    fs.writeFileSync(cfgPath, `provider: generic\nurl: ${process.env.SYSOPT_FEED_URL}\nupdaterCacheDirName: sys-optimizer-updater\n`, 'utf8');
    log('已写入临时 app-update.yml: ' + cfgPath);
  }

  require('./main.js');

  app.whenReady().then(() => {
    const wait = setInterval(() => {
      const wins = BrowserWindow.getAllWindows();
      if (!wins.length) return;
      clearInterval(wait);
      probe(wins[0]).then(() => finish(0)).catch((e) => {
        errors.push('[probe] ' + (e && e.stack || e));
        finish(1);
      });
    }, 300);
    setTimeout(() => finish(errors.length ? 1 : 0), 120000);
  });
});

async function probe(win) {
  win.webContents.on('console-message', (e, level, message) => {
    if (level >= 2) errors.push('[console] ' + message);
  });
  const ev = (js) => win.webContents.executeJavaScript(js, true);
  const txt = async (id) => ev(`document.getElementById(${JSON.stringify(id)}).textContent`);
  const vis = async (id) => ev(`!document.getElementById(${JSON.stringify(id)}).classList.contains("hidden")`);

  await new Promise((r) => setTimeout(r, 2500));
  await ev(`document.querySelector('#tabs button[data-tab="update"]').click(); 1`);
  await new Promise((r) => setTimeout(r, 300));
  log('panel=' + (await ev('document.querySelector(".panel.active").id')));
  log('初始状态: ' + JSON.stringify(await txt('updateState')));
  log('初始卡片=' + JSON.stringify(await ev(
    'JSON.stringify([...document.querySelectorAll("#updateCards .card")].map(c=>c.textContent.replace(/\\s+/g," ").trim()))'
  )));

  // 未打包环境下的 get 状态（主进程真实返回）
  log('updateGet=' + JSON.stringify(await ev('window.optimizer.updateGet()')));

  // 1) 检查更新
  await ev('document.getElementById("updateCheck").click(); 1');
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if ((await txt('updateState')).indexOf('发现新版本') >= 0) break;
  }
  log('检查后=' + JSON.stringify(await txt('updateState')));
  log('最新版本卡片=' + JSON.stringify(await ev(
    '([...document.querySelectorAll("#updateCards .card")].map(c=>c.textContent.replace(/\\s+/g," ").trim()).join(" | "))'
  )));
  log('下载按钮可见=' + (await vis('updateDownload')) + ' 安装按钮可见=' + (await vis('updateInstall')));
  log('更新标签红点=' + (await vis('updateDot')));
  log('说明区=' + JSON.stringify(await txt('updateNotes')));

  // 2) 未确认安装必须被拒绝
  log('guard=' + JSON.stringify(await ev(
    'window.optimizer.updateInstall(false).then(r=>({ok:r.ok,msg:r.message}))'
  )));
  log('未下载就安装=' + JSON.stringify(await ev(
    'window.optimizer.updateInstall(true).then(r=>({ok:r.ok,msg:r.message}))'
  )));

  // 3) 下载更新（走确认弹窗）
  await ev('document.getElementById("updateDownload").click(); 1');
  await new Promise((r) => setTimeout(r, 800));
  log('弹窗=' + JSON.stringify(await ev(
    '(document.getElementById("modalTitle").textContent+" || "+document.getElementById("modalDesc").textContent.slice(0,60)+" || "+document.getElementById("modalOk").textContent)'
  )));
  await ev('document.getElementById("modalOk").click(); 1');
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if ((await txt('updateState')).indexOf('已下载完成') >= 0) break;
  }
  log('下载后=' + JSON.stringify(await txt('updateState')));
  log('进度条可见=' + (await vis('updateBar')) + ' 安装按钮可见=' + (await vis('updateInstall')) + ' 下载按钮可见=' + (await vis('updateDownload')));

  // 校验真正落盘的更新包与假包字节一致
  const local = process.env.LOCALAPPDATA || '';
  for (const name of ['sys-optimizer-updater', `${app.getName()}-updater`]) {
    const pending = path.join(local, name, 'pending');
    if (!fs.existsSync(pending)) continue;
    for (const f of fs.readdirSync(pending)) {
      const buf = fs.readFileSync(path.join(pending, f));
      log('落盘=' + f + ' 大小=' + buf.length + '/' + BLOB.length +
        ' sha512一致=' + (crypto.createHash('sha512').update(buf).digest('base64') === SHA));
    }
  }

  // 4) 校验落盘文件与假包一致
  const st = await ev('window.optimizer.updateGet()');
  log('主进程状态=' + JSON.stringify({ blocked: st.blocked, cur: st.currentVersion, dl: st.downloaded, v: st.update && st.update.version, files: st.update && st.update.files, feed: st.feedUrl }));

  log('日志尾部=' + JSON.stringify(await ev(
    'window.optimizer.readLog().then(a=>a.filter(l=>l.indexOf("自动更新")>=0))'
  )));
}
