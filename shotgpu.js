'use strict';
// dev 模式截图：显卡优化页新列表（本机程序 / 英文 / 选中检测到的程序）
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
require('./main.js');

const OUT = path.join(__dirname, '.ref', 'shots');
function finish(code) { setTimeout(() => app.exit(code), 200); }

app.whenReady().then(() => {
  setTimeout(async () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) { console.log('no window'); finish(1); return; }
    const ev = (js) => win.webContents.executeJavaScript(js, true);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const shot = async (file) => {
      if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(OUT, file), img.toPNG());
      console.log('saved', file);
    };
    await wait(2500);
    await ev('document.querySelector(\'.tab[data-tab="gpu"]\').click()');
    await wait(9000);
    await shot('gpu-zh.png');
    const picked = await ev('(() => { const b=[...document.querySelectorAll("#gpuProfiles .gpu-profile")]; const t=b.find(x=>x.title)||b[1]; if(t){t.click(); return t.textContent;} return ""; })()');
    console.log('picked=' + picked);
    await wait(3000);
    await shot('gpu-detail.png');
    await ev('(() => { const s = document.getElementById("setLang"); s.value = "en"; s.dispatchEvent(new Event("change")); })()');
    await wait(1200);
    await shot('gpu-en.png');
    await ev('(() => { const s = document.getElementById("setLang"); s.value = "zh"; s.dispatchEvent(new Event("change")); })()');
    finish(0);
  }, 800);
});
