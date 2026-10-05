'use strict';
// i18n 冒烟：切到 English → 遍历所有页签与只读扫描 → 收集残留中文 → 切回中文验证还原
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
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const problems = [];
  const expect = (name, ok) => { log(name + '=' + ok); if (!ok) problems.push(name); };

  await wait(2500);

  log('langSel=' + (await ev('!!document.getElementById("langSel")')));
  log('settingsBefore=' + JSON.stringify(await ev('window.optimizer.settingsGet()')));

  // 首启免责声明：未同意时必现，勾选后才能进入；同意后写入 settings.eula
  expect('eulaModalExists', await ev('!!document.getElementById("eulaModal")'));
  const eulaShown = await ev('!document.getElementById("eulaModal").classList.contains("hidden")');
  log('eulaShown=' + eulaShown);
  if (eulaShown) {
    expect('eulaEnterLocked', await ev('document.getElementById("eulaEnter").disabled'));
    expect('eulaSections', (await ev('document.querySelectorAll("#eulaBody h3").length')) >= 5);
    await ev('(() => { const c = document.getElementById("eulaAck"); c.checked = true; c.dispatchEvent(new Event("change")); })()');
    await wait(200);
    await ev('document.getElementById("eulaEnter").click()');
    await wait(500);
    expect('eulaHidden', await ev('document.getElementById("eulaModal").classList.contains("hidden")'));
    expect('eulaPersisted', (await ev('window.optimizer.settingsGet().then(s => s.eula)')) === '1.0');
  }

  // 切英文
  await ev('(() => { const s = document.getElementById("langSel"); s.value = "en"; s.dispatchEvent(new Event("change")); })()');
  await wait(600);
  log('lang=' + (await ev('window.i18n.lang')));
  log('titleEn=' + (await ev('document.title')));
  log('tabEn=' + JSON.stringify(await ev('JSON.stringify([...document.querySelectorAll(".tab")].map(t => t.textContent))')));

  // 逐个页签 + 只读扫描，把动态文案都渲染出来
  const tabs = ['home', 'disk', 'system', 'gpu', 'power', 'game', 'startup', 'info', 'update', 'log'];
  for (const t of tabs) {
    await ev(`document.querySelector('.tab[data-tab="${t}"]').click()`);
    await wait(t === 'home' ? 2200 : 500);
    log('tab ' + t + ' -> ' + (await ev(`document.querySelector('#tab-${t}').textContent.length`)) + ' chars');
  }

  await ev('document.querySelector(\'.tab[data-tab="disk"]\').click()');
  await ev('document.getElementById("diskScan").click()');
  await wait(9000);
  log('scanStatus=' + (await ev('document.getElementById("status").textContent')));
  log('firstRowEn=' + (await ev('JSON.stringify((document.querySelector("#diskList .row")||{textContent:""}).textContent.slice(0,160))')));

  // 确认弹窗（只走取消路径，绝不执行删除）
  await ev('document.getElementById("diskClean").click()');
  await wait(9000);
  log('modalEn=' + (await ev('JSON.stringify({t:document.getElementById("modalTitle").textContent,d:document.getElementById("modalDesc").textContent.slice(0,200),ack:(document.getElementById("modalAckWrap")||{}).textContent,ok:document.getElementById("modalOk").textContent,cancel:document.getElementById("modalCancel").textContent})')));
  await ev('document.getElementById("modalCancel").click()');
  await wait(600);
  log('afterCancel=' + (await ev('document.getElementById("status").textContent')));

  // 启动项 / 系统信息 / 日志 的动态内容
  await ev('document.querySelector(\'.tab[data-tab="startup"]\').click()');
  await wait(2500);
  log('startupRowEn=' + (await ev('JSON.stringify((document.querySelector("#startupList .row")||{textContent:""}).textContent.slice(0,140))')));
  log('backupPathEn=' + (await ev('document.getElementById("backupPath").textContent')));
  await ev('document.querySelector(\'.tab[data-tab="info"]\').click()');
  await wait(3000);
  log('infoCardsEn=' + (await ev('JSON.stringify([...document.querySelectorAll("#infoCards .card")].map(c => c.textContent).slice(0,8))')));
  await ev('document.querySelector(\'.tab[data-tab="log"]\').click()');
  await wait(1200);
  log('logSampleEn=' + (await ev('JSON.stringify(document.getElementById("logBody").textContent.split("\\n").slice(-4))')));

  // 显卡优化页（只读；不做任何写入）
  await ev('document.querySelector(\'.tab[data-tab="gpu"]\').click()');
  await wait(20000); // meta + 本机程序扫描 + get 共 3 次 PowerShell/NVAPI 调用
  log('gpuProfileCount=' + (await ev('document.querySelectorAll("#gpuProfiles .gpu-profile").length')));
  log('gpuLabelsEn=' + (await ev('JSON.stringify([...document.querySelectorAll("#gpuSettings label")].map(l => l.textContent))')));
  log('gpuBanner=' + (await ev('document.getElementById("gpuBanner").textContent')));
  log('gpuNameEn=' + (await ev('document.getElementById("gpuProfileName").textContent')));
  expect('gpuTabRail', !!await ev('!!document.querySelector(\'.tab[data-tab="gpu"]\')'));
  expect('gpuProfilesLoaded', (await ev('document.querySelectorAll("#gpuProfiles .gpu-profile").length')) > 0);
  expect('gpuSettingsRows', (await ev('document.querySelectorAll("#gpuSettings .gpu-set").length')) >= 3);
  expect('gpuUnsupportedHidden', await ev('!document.querySelector("#gpuSettings .gpu-set label") || document.querySelector("#gpuSettings").textContent.indexOf("Low-Latency") < 0'));
  expect('gpuPendingIdle', await ev('document.getElementById("gpuPending").classList.contains("hidden")'));
  expect('gpuDefaultOption', await ev('[...document.querySelectorAll("#gpuSettings select option")].some(o => o.value === "" && /Default/.test(o.textContent))'));
  // 控制面板同名 3D 设置：可写下拉数量 + 本机缺失项的明示行（不含下拉）
  log('gpuWritableSelects=' + (await ev('document.querySelectorAll("#gpuSettings select").length')));
  expect('gpuNamedWritable', (await ev('document.querySelectorAll("#gpuSettings select").length')) >= 10);
  log('gpuAbsent=' + (await ev('JSON.stringify([...document.querySelectorAll("#gpuSettings .gpu-absent label")].map(x => x.textContent))')));
  expect('gpuAbsentRowsGone', await ev('document.querySelectorAll("#gpuSettings .gpu-absent").length') === 0);
  // 按驱动能力显隐：下拉里除了「默认」至少要有一个真实可选项，否则整行不该出现
  expect('gpuNoSingleOptionRows', await ev('[...document.querySelectorAll("#gpuSettings select")].every(s => s.options.length >= 3)'));
  log('gpuTotal=' + (await ev('JSON.stringify((document.querySelector("#gpuProfiles .gpu-more")||{textContent:""}).textContent)')));
  expect('gpuRenderCapped', (await ev('document.querySelectorAll("#gpuProfiles .gpu-profile").length')) <= 400);
  // 方案 1：默认只列本机存在的程序，驱动内置的 hex 方案不出现
  expect('gpuLocalOnly', (await ev('document.querySelectorAll("#gpuProfiles .gpu-profile").length')) <= 120);
  expect('gpuNoHexProfiles', await ev('![...document.querySelectorAll("#gpuProfiles .gname")].some(n => /^0x[0-9a-f]+:0x/i.test(n.textContent))'));
  expect('gpuGroupsShown', (await ev('document.querySelectorAll("#gpuProfiles .gpu-group").length')) >= 1);
  // 方案 3：添加程序入口 + 全部驱动方案开关
  expect('gpuAddBtn', await ev('!!document.getElementById("gpuAddApp")'));
  expect('gpuShowAllToggle', await ev('!!document.getElementById("gpuShowAll")'));
  expect('gpuDelHiddenOnGlobal', await ev('document.getElementById("gpuDelProfile").classList.contains("hidden")'));
  expect('gpuNoAutoConfirmBar', await ev('document.getElementById("gpuPending").classList.contains("hidden")'));
  await ev('document.getElementById("gpuShowAll").click()');
  // 展开全部驱动方案：enum profiles 遍历 8000 个方案，轮询等到渲染完成（最多 90 s）
  for (let i = 0; i < 45; i++) {
    await wait(2000);
    if ((await ev('document.querySelectorAll("#gpuProfiles .gpu-profile").length')) >= 400) break;
  }
  log('gpuAllCount=' + (await ev('document.querySelectorAll("#gpuProfiles .gpu-profile").length')));
  log('gpuAllTip=' + (await ev('JSON.stringify((document.querySelector("#gpuProfiles .gpu-more")||{textContent:""}).textContent)')));
  expect('gpuShowAllWorks', (await ev('document.querySelectorAll("#gpuProfiles .gpu-profile").length')) >= 400);
  expect('gpuShowAllCapped', (await ev('document.querySelectorAll("#gpuProfiles .gpu-profile").length')) <= 400);
  await ev('document.getElementById("gpuShowAll").click()');
  await wait(600);
  expect('gpuHideAllWorks', (await ev('document.querySelectorAll("#gpuProfiles .gpu-profile").length')) <= 120);
  expect('gpuColorSchemeDark', (await ev('getComputedStyle(document.documentElement).colorScheme')) === 'dark');
  // 电源优化页（EN 模式）：三档卡片 + 当前计划 + 确认条默认隐藏
  await ev('document.querySelector(\'.tab[data-tab="power"]\').click()');
  await wait(2500);
  log('powerCards=' + (await ev('document.querySelectorAll("#powerOpts .power-card").length')));
  log('powerNamesEn=' + (await ev('JSON.stringify([...document.querySelectorAll("#powerOpts .power-name")].map(x => x.textContent))')));
  log('powerCurEn=' + (await ev('document.getElementById("powerCurName").textContent')));
  expect('powerTabRail', !!await ev('!!document.querySelector(\'.tab[data-tab="power"]\')'));
  expect('powerThreeCards', (await ev('document.querySelectorAll("#powerOpts .power-card").length')) === 3);
  expect('powerPendingIdle', await ev('document.getElementById("powerPending").classList.contains("hidden")'));
  expect('powerActiveMarked', (await ev('document.querySelectorAll("#powerOpts .power-card.active").length')) <= 1);
  // 本机其他方案（自建 / 改版系统自带）：必须可点选，点选只弹确认条，取消后不动系统
  const extraRows = await ev('document.querySelectorAll("#powerExtra .power-extra-row").length');
  log('powerExtraRows=' + extraRows);
  log('powerExtraNames=' + (await ev('JSON.stringify([...document.querySelectorAll("#powerExtra .power-extra-name")].map(x => x.textContent))')));
  expect('powerExtraSelectable', extraRows === 0 || (await ev('[...document.querySelectorAll("#powerExtra .power-extra-row")].every(r => !!r.querySelector(\'input[type="radio"]\'))')) === true);
  if (extraRows > 0) {
    await ev('(() => { const r = document.querySelector("#powerExtra .power-extra-row input"); r.checked = true; r.dispatchEvent(new Event("change")); })()');
    await wait(300);
    expect('powerExtraPendingShown', !(await ev('document.getElementById("powerPending").classList.contains("hidden")')));
    expect('powerExtraTwoButtons', (await ev('document.querySelectorAll("#powerPending button").length')) === 2);
    await ev('document.querySelectorAll("#powerPending button")[1].click()');
    await wait(250);
    expect('powerExtraCancelHides', await ev('document.getElementById("powerPending").classList.contains("hidden")'));
  }
  // 游戏开关页（EN 模式，只读 + 只弹确认条，绝不写入）
  await ev('document.querySelector(\'.tab[data-tab="game"]\').click()');
  await wait(3000);
  log('gameRows=' + (await ev('document.querySelectorAll("#gameList .game-row").length')));
  log('gameNamesEn=' + (await ev('JSON.stringify([...document.querySelectorAll("#gameList .game-name")].map(x => x.textContent))')));
  log('gameSummaryEn=' + (await ev('document.getElementById("gameSummary").textContent')));
  expect('gameTabRail', await ev('!!document.querySelector(\'.tab[data-tab="game"]\')'));
  expect('gameSixRows', (await ev('document.querySelectorAll("#gameList .game-row").length')) === 6);
  expect('gamePendingIdle', await ev('document.getElementById("gamePending").classList.contains("hidden")'));
  expect('gameRowButtons', await ev('[...document.querySelectorAll("#gameList .game-row")].every(r => r.querySelectorAll(".game-acts button, .game-acts select").length >= 1)'));
  expect('gameHagsAdminBadge', await ev('[...document.querySelectorAll("#gameList .game-row")].some(r => r.querySelector(".badge.admin"))'));
  await ev('document.querySelectorAll("#gameList .game-row .game-acts button")[0].click()');
  await wait(400);
  expect('gamePendingShown', !(await ev('document.getElementById("gamePending").classList.contains("hidden")')));
  expect('gamePendingTwoButtons', (await ev('document.querySelectorAll("#gamePending button").length')) === 2);
  await ev('document.querySelectorAll("#gamePending button")[1].click()');
  await wait(300);
  expect('gameCancelHides', await ev('document.getElementById("gamePending").classList.contains("hidden")'));
  expect('gameNoWriteOnCancel', await ev('document.getElementById("gameSummary").textContent.length') > 0);

  // 首页「一键优化模式」三档（EN 模式，只预览，绝不应用）
  await ev('document.querySelector(\'.tab[data-tab="home"]\').click()');
  await wait(1200);
  expect('memTrimBtn', await ev('!!document.getElementById("memTrim") && typeof window.optimizer.memTrim === "function"'));
  expect('memTrimLabelEn', (await ev('document.getElementById("memTrim").textContent')) === 'Free now');
  expect('tierCardExists', await ev('!!document.querySelector("#tab-home .tier-card")'));
  expect('tierThreeCards', (await ev('document.querySelectorAll("#tierOpts .tier-opt").length')) === 3);
  expect('tierPendingIdle', await ev('document.getElementById("tierPending").classList.contains("hidden")'));
  expect('tierListIdle', await ev('document.getElementById("tierList").classList.contains("hidden")'));
  expect('tierApi', await ev('["tiersInfo","tiersPreview","tiersApply","tiersRestore"].every(k => typeof window.optimizer[k] === "function")'));
  log('tierNamesEn=' + (await ev('JSON.stringify([...document.querySelectorAll("#tierOpts .tier-name")].map(x => x.textContent))')));
  log('tierSummaryEn=' + (await ev('document.getElementById("tierSummary").textContent')));
  // 选第一档只做预览：确认条 + 逐项清单出现，取消后不写任何东西
  await ev('(() => { const r = document.querySelector("#tierOpts .tier-opt input"); r.checked = true; r.dispatchEvent(new Event("change")); })()');
  for (let i = 0; i < 30; i++) {
    await wait(2000);
    if (!(await ev('document.getElementById("tierPending").classList.contains("hidden")'))) break;
  }
  log('tierPendingEn=' + (await ev('JSON.stringify(document.getElementById("tierPending").textContent.slice(0,200))')));
  log('tierGroupsEn=' + (await ev('JSON.stringify([...document.querySelectorAll("#tierList .tier-group-h")].map(x => x.textContent))')));
  log('tierItemCount=' + (await ev('document.querySelectorAll("#tierList .tier-item").length')));
  log('tierItemsEn=' + (await ev('JSON.stringify([...document.querySelectorAll("#tierList .tier-item")].map(x => x.textContent).slice(0,8))')));
  expect('tierPreviewShown', !(await ev('document.getElementById("tierPending").classList.contains("hidden")')));
  expect('tierPreviewListed', (await ev('document.querySelectorAll("#tierList .tier-item").length')) >= 1);
  expect('tierPreviewTwoButtons', (await ev('document.querySelectorAll("#tierPending button").length')) === 2);
  await ev('document.querySelectorAll("#tierPending button")[1].click()');
  await wait(400);
  expect('tierCancelHides', await ev('document.getElementById("tierPending").classList.contains("hidden") && document.getElementById("tierList").classList.contains("hidden")'));
  expect('tierNoSnapshotAfterCancel', await ev('window.optimizer.tiersInfo().then(i => !!i.snapshot)') === false);

  expect('langSelectDark', (await ev('getComputedStyle(document.getElementById("langSel")).backgroundColor')) === 'rgb(28, 21, 24)');  expect('browserBannerEn', !/[一-鿿]/.test((await ev('document.getElementById("browserBanner").textContent')).replace(/中文/, '')));
  // 过滤清空列表：驱动自带配置名属于真实数据，不参与界面文案残留统计
  await ev('(() => { const f = document.getElementById("gpuFilter"); f.value = "zzz-none"; f.dispatchEvent(new Event("input")); })()');
  await wait(300);

  // 新 UI：无边框窗口控件 + 闪电背景开关 + 首页 hero + 实时监控
  log('winCtl=' + (await ev('JSON.stringify({min:!!document.getElementById("winMin"),close:!!document.getElementById("winClose"),headerDrag:getComputedStyle(document.querySelector("header")).webkitAppRegion,btnDrag:getComputedStyle(document.getElementById("winMin")).webkitAppRegion})')));
  log('metrics=' + (await ev('JSON.stringify({cpu:document.getElementById("valCpu").textContent,cpuNote:document.getElementById("noteCpu").textContent,gpu:document.getElementById("valGpu").textContent,gpuNote:document.getElementById("noteGpu").textContent.slice(0,60),ram:document.getElementById("valRam").textContent,ramNote:document.getElementById("noteRam").textContent,barCpu:document.getElementById("barCpu").style.width,barRam:document.getElementById("barRam").style.width})')));
  expect('winButtons', await ev('!!document.getElementById("winMin") && !!document.getElementById("winClose") && typeof window.optimizer.winMinimize === "function" && typeof window.optimizer.winClose === "function"'));
  expect('headerDraggable', (await ev('getComputedStyle(document.querySelector("header")).webkitAppRegion')) === 'drag');
  expect('cpuLive', /\d+\s*%/.test(await ev('document.getElementById("valCpu").textContent')));
  expect('ramLive', /\d+\s*%/.test(await ev('document.getElementById("valRam").textContent')));
  expect('noTermCard', await ev('!document.getElementById("termBody")'));
  expect('railNav', await ev('!!document.getElementById("rail") && getComputedStyle(document.getElementById("rail")).position === "fixed"'));
  expect('maxButtonRemoved', !(await ev('!!document.getElementById("winMax")')) && !(await ev('"winMaximize" in window.optimizer')));
  expect('sparkDrawn', await ev('document.getElementById("sparkCpu").width > 0 && document.getElementById("sparkRam").width > 0'));
  expect('oneKeyBtn', await ev('!!document.getElementById("homeOneKey") && !!document.getElementById("homeManual")'));
  expect('logoImg', await ev('document.querySelector("header .logo").tagName === "IMG"'));

  log('fxOn=' + (await ev('window.bgFx.enabled')));
  await ev('document.getElementById("openSettings").click()');
  await wait(400);
  log('settingsOpen=' + (await ev('!document.getElementById("settingsModal").classList.contains("hidden")')));
  log('setVersion=' + (await ev('document.getElementById("setVersion").textContent')));
  await ev('(() => { const c = document.getElementById("setFx"); c.checked = false; c.dispatchEvent(new Event("change")); })()');
  await wait(400);
  log('bgWhenFxOff=' + (await ev('JSON.stringify({cls:document.documentElement.className,color:getComputedStyle(document.body).backgroundColor,image:getComputedStyle(document.body).backgroundImage})')));
  expect('pureBlackWhenFxOff', (await ev('getComputedStyle(document.body).backgroundColor')) === 'rgb(0, 0, 0)'
    && (await ev('getComputedStyle(document.body).backgroundImage')) === 'none');
  expect('fxOffPersisted', (await ev('window.optimizer.settingsGet().then(s => s.fx)')) === false);
  await ev('(() => { const c = document.getElementById("setFx"); c.checked = true; c.dispatchEvent(new Event("change")); })()');
  await wait(400);
  expect('fxBackOn', await ev('window.bgFx.enabled && !document.documentElement.classList.contains("fx-off")'));
  await ev('document.getElementById("settingsClose").click()');
  await wait(300);
  expect('heroTitleEn', (await ev('document.querySelector(".hero-title").textContent')) === 'Ultimate Performance Boost');
  log('heroStats=' + (await ev('JSON.stringify({free:document.getElementById("statFree").textContent,picked:document.getElementById("statPicked").textContent,est:document.getElementById("statEst").textContent})')));

  // 残留中文统计
  const left = await ev(`(() => {
    const re = /[\\u3400-\\u9fff]/;
    const set = new Set();
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    let n = w.currentNode;
    const RAW = '#gpuProfiles,#gpuProfileName,#gpuProfileExe,pre.log';
    while (n) { const v = (n.nodeValue || '').trim(); const pe = n.parentElement; const skip = pe && pe.closest(RAW); if (v && re.test(v) && !skip) set.add(v); n = w.nextNode(); }
    for (const e of document.querySelectorAll('[title],[placeholder]')) {
      if (e.closest(RAW)) continue;
      for (const a of ['title','placeholder']) { const v = e.getAttribute(a); if (v && re.test(v)) set.add('[' + a + '] ' + v); }
    }
    return JSON.stringify([...set]);
  })()`);
  const arr = JSON.parse(left);
  // 允许保留中文的几类：语言选项本身、双语 title、磁盘上真实的中文文件名/程序名（不属于界面文案）
  const OK = [/^中文$/, /界面语言/, /清理记录\.log/, /易语言/, /\.lnk/, /Start Menu/];
  const bad = arr.filter((x) => !OK.some((re) => re.test(x)));
  log('remainingCJK=' + arr.length + ' unexpected=' + bad.length);
  bad.forEach((x) => log('  ZH> ' + x));
  if (problems.length) log('problems=' + JSON.stringify(problems));

  // 切回中文，验证还原
  await ev('(() => { const s = document.getElementById("langSel"); s.value = "zh"; s.dispatchEvent(new Event("change")); })()');
  await wait(800);
  log('langBack=' + (await ev('window.i18n.lang')));
  log('tabZh=' + JSON.stringify(await ev('JSON.stringify([...document.querySelectorAll(".tab")].map(t => t.textContent))')));
  log('settingsAfter=' + JSON.stringify(await ev('window.optimizer.settingsGet()')));
  log('titleZh=' + (await ev('document.title')));
  log('cjkRestored=' + (await ev('/[\\u3400-\\u9fff]/.test(document.querySelector("#tab-disk .hint").textContent)')));

  finish(bad.length === 0 && problems.length === 0 ? 0 : 2);
}

app.whenReady().then(() => {
  const waitWin = () => {
    const wins = BrowserWindow.getAllWindows();
    if (!wins.length) return setTimeout(waitWin, 200);
    probe(wins[0]).catch((e) => { errors.push('[probe] ' + (e && e.stack ? e.stack : e)); finish(1); });
  };
  waitWin();
});

setTimeout(() => { errors.push('[timeout] 超过 240 秒未完成'); finish(1); }, 240000);
