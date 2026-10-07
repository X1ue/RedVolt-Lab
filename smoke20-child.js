'use strict';
// smoke20-child：单实例锁的「第二实例」。userData 指到父进程给的同一目录后再 require('./main.js')，
// 于是走的就是生产代码里 requestSingleInstanceLock() 返回 false 的那条路。
// 子进程只汇报三件事：建了几个窗口、有没有收到 will-quit、退出码是多少。
// 同样强制 show:false，万一生产代码回归成「第二个实例也建窗」，也不会在桌面上真弹出窗口。
const Module = require('module');
const origLoad = Module._load;
let bwProxy = null;
Module._load = function (request) {
  const exp = origLoad.apply(this, arguments);
  if (request !== 'electron' || !exp || typeof exp.BrowserWindow !== 'function') return exp;
  if (!bwProxy) {
    const Real = exp.BrowserWindow;
    class Hidden extends Real {
      constructor(o) { super(Object.assign({}, o, { show: false })); }
      show() { this.emit('show'); }
      hide() { this.emit('hide'); }
      focus() {}
      minimize() { this.emit('minimize'); }
    }
    bwProxy = new Proxy(exp, { get: (t, k) => (k === 'BrowserWindow' ? Hidden : Reflect.get(t, k)) });
  }
  return bwProxy;
};

const { app } = require('electron');
const fs = require('fs');

// 退出那一刻同步写 fd 1，异步 console.log 可能在进程终止时被丢掉，父进程就读不到结论了
let created = 0;
let quitSeen = false;
app.on('browser-window-created', () => { created++; });
app.on('will-quit', () => { quitSeen = true; });
process.on('exit', (code) => {
  const line = `CHILD windows=${created} quit=${quitSeen} code=${code}\n`;
  try { fs.writeSync(1, line); } catch (e) { /* 管道已关就算了，父进程还能看退出码 */ }
});

const DEST = process.argv[2];
if (!DEST || !fs.existsSync(DEST)) {
  process.stdout.write('CHILD bad-dest\n');
  app.exit(3);
} else {
  // 必须在 require('./main.js') 之前：锁的键就是 userData 目录
  app.setPath('userData', DEST);
  require('./main.js');
  // 保险丝：若主进程没把自己退掉，20 秒后自杀，父进程据 quit=false 判定「多开没被挡住」
  setTimeout(() => {
    if (!quitSeen) {
      fs.writeSync(1, 'CHILD hung\n');
      app.exit(4);
    }
  }, 20000);
}
