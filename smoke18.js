'use strict';
// 1.3.0 「设置被回弹」冒烟：隐藏窗口，全程不改系统、不写账本、不弹 UAC。
// A 段：没有档位快照时不该出现漂移条目；B 段：伪造快照后走真实只读对比通道；
// C 段：注入一条漂移结论，验按钮 → 确认框层级 → 取消，并验中英切换。绝不点「确认重新应用」。
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
    }
    bwProxy = new Proxy(exp, { get: (t, k) => (k === 'BrowserWindow' ? Hidden : Reflect.get(t, k)) });
  }
  return bwProxy;
};

const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEST = path.join(os.tmpdir(), `rv-drift-${Date.now()}`);
fs.mkdirSync(DEST, { recursive: true });
app.setPath('userData', DEST);
const SNAP = path.join(DEST, 'tier-snapshot.json');

require('./main.js');

const errors = [];
let done = false;
function log(...a) {
  const line = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  try { process.stdout.write(line + '\n'); } catch (e) { if (!e || e.code !== 'EPIPE') throw e; }
}
process.stdout.on('error', (e) => { if (!e || e.code !== 'EPIPE') throw e; });
const problems = [];
const expect = (name, ok, extra) => {
  log((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  -> ' + JSON.stringify(extra)));
  if (!ok) problems.push(name);
};
function finish(code) {
  if (done) return;
  done = true;
  log('---- errors ----');
  log(errors.length ? errors.join('\n') : '(none)');
  log('结果: ' + (code === 0 ? '全部通过' : '有失败项'));
  setTimeout(() => app.exit(code), 200);
}

let targetWin = null;
app.on('browser-window-created', (e, w) => { if (!targetWin) targetWin = w; });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function probe(win) {
  win.webContents.on('console-message', (e, level, message) => { if (level >= 2) errors.push('[console] ' + message); });
  win.webContents.on('render-process-gone', (e, d) => errors.push('[render-gone] ' + JSON.stringify(d)));
  const ev = (js) => win.webContents.executeJavaScript(js, true);
  const findings = () => ev('JSON.stringify((typeof state !== "undefined" && state.health && state.health.findings) ? state.health.findings.filter(x => x.id === "drift").map(x => ({ count: x.params.count, tier: x.action && x.action.tier, game: (x.params.game||[]).map(g=>g.id), gpu: (x.params.gpu||[]).map(g=>g.id) })) : null)')
    .then((s) => JSON.parse(s));
  const actionBtns = () => ev('[...document.querySelectorAll("#healthBody .faction .btn")].map(b => b.textContent)');
  // 点「快速体检」后等真实结果落回界面：先把计数行涂成哨兵值，再看它被重写且忙碌态解除
  async function runQuick() {
    await ev('document.getElementById("healthCounts").textContent = "__pending__"');
    await ev('document.getElementById("healthQuick").click()');
    for (let i = 0; i < 150; i++) {
      await wait(1000);
      const st = JSON.parse(await ev('JSON.stringify([document.getElementById("healthCounts").textContent, (typeof state !== "undefined") && state.busy === true])'));
      if (st[0] !== '__pending__' && st[1] === false) return st[0];
    }
    return null;
  }
  const written = () => ({
    ledger: fs.existsSync(path.join(DEST, 'changes-ledger.json')),
    snap: fs.existsSync(SNAP),
    files: fs.readdirSync(DEST).filter((f) => /ledger|tier-snapshot|game-switch-backup|baseline/i.test(f)),
  });

  await wait(2500);
  if (await ev('!document.getElementById("eulaModal").classList.contains("hidden")')) {
    await ev('(() => { const c = document.getElementById("eulaAck"); c.checked = true; c.dispatchEvent(new Event("change")); })()');
    await wait(200);
    await ev('document.getElementById("eulaEnter").click()');
    await wait(500);
  }
  expect('窗口全程隐藏', !win.isVisible());
  expect('起始没有档位快照', !fs.existsSync(SNAP));

  await ev('document.getElementById("homeHealth").click()');
  await wait(300);

  // ---------- A. 没优化过就不该谈「被改回去」 ----------
  const sumA = await runQuick();
  log('A counts=' + JSON.stringify(sumA));
  const nA = await ev('document.querySelectorAll("#healthBody .finding").length');
  log('A findings=' + nA);
  expect('A 快速体检出结论', !!sumA && nA > 0, { sumA, nA });
  expect('A 没有快照时不报漂移', (await findings()).length === 0);
  expect('A 界面上没有重新应用按钮', (await actionBtns()).length === 0);

  // ---------- B. 伪造档位快照后，走真实只读对比通道 ----------
  const snapBody = JSON.stringify({
    ver: 1, at: Date.now() - 86400000, tier: 'esports',
    power: { guid: null }, game: {}, gpu: {},
  });
  fs.writeFileSync(SNAP, snapBody, 'utf8');
  const sumB = await runQuick();
  log('B counts=' + JSON.stringify(sumB));
  const dB = await findings();
  log('B drift=' + JSON.stringify(dB));
  const btnsB = await actionBtns();
  expect('B 按钮数与漂移条目一致', btnsB.length === dB.length, { btnsB, dB });
  if (dB.length) {
    expect('B 漂移项都带档位与条数', dB[0].tier === 'esports' && dB[0].count === dB[0].game.length + dB[0].gpu.length && dB[0].count > 0, dB[0]);
    expect('B 漂移明细里不含电源计划', !/power/i.test(JSON.stringify(dB[0]).slice(0, 400)), dB[0]);
    log('B 本机被改回的项=' + JSON.stringify(dB[0].game.concat(dB[0].gpu)));
  } else {
    log('B 本机当前已符合三档目标值，无漂移可报');
  }
  expect('B 体检仍是只读：没写账本', !written().ledger, written());
  expect('B 快照原样未动', fs.readFileSync(SNAP, 'utf8') === snapBody);

  // ---------- C. 注入一条漂移结论，验交互层级（绝不点确认） ----------
  const fake = {
    id: 'drift', group: 'system', severity: 'warn',
    titleKey: 'driftTitle', detailKey: 'driftDetail', tipKey: 'driftTip',
    params: {
      count: 2, tier: 'esports',
      game: [{ id: 'hags', kind: 'toggle', mode: 'on', current: 'off', status: 'change' }],
      gpu: [{
        id: '0x1057EB71', value: 1, current: '0x0', status: 'change',
        name: { zh: '电源管理模式', en: 'Power management mode' },
        currentLabel: { zh: '最佳功耗优化', en: 'Optimal power' },
        targetLabel: { zh: '最高性能优先', en: 'Prefer maximum performance' },
      }],
    },
    action: { kind: 'tierReapply', tier: 'esports', at: Date.now() - 86400000 },
  };
  await ev('(() => { const x = ' + JSON.stringify(fake) +
    '; renderHealth({ ok: true, quick: true, counts: { risk: 0, warn: 1, info: 0, good: 0 }, findings: [x] }); return document.querySelectorAll("#healthBody .finding").length; })()');
  await wait(400);
  const btnsC = await actionBtns();
  log('C buttons=' + JSON.stringify(btnsC));
  expect('C 漂移条目带一个重新应用按钮', btnsC.length === 1 && /^重新应用这 2 项$/.test(btnsC[0]), btnsC);
  const detailC = await ev('document.querySelector("#healthBody .fdetail").textContent');
  log('C detail=' + JSON.stringify(detailC));
  expect('C 明细分两组并写出当前值与应有值',
    /系统游戏开关/.test(detailC) && /N 卡 3D 设置/.test(detailC) && /→ 应为/.test(detailC) && /HAGS/.test(detailC), detailC);
  expect('C 明细说明只限本软件写过的项', /只限本软件写过/.test(detailC));

  await ev('document.querySelector("#healthBody .faction .btn").click()');
  await wait(400);
  expect('C 确认框打开了', !(await ev('document.getElementById("modal").classList.contains("hidden")')));
  const rows = await ev('JSON.stringify([...document.querySelectorAll("#modalList .modal-item .n")].map(x => x.textContent))');
  log('C rows=' + rows);
  expect('C 确认框逐条列出将要改的项', JSON.parse(rows).length === 2 && /→ 应为/.test(rows), rows);
  const desc = await ev('document.getElementById("modalDesc").textContent');
  expect('C 确认框说明只改这些项并预告授权', /只修改下面列出的 2 项/.test(desc) && /管理员授权/.test(desc), desc);
  const zc = await ev('[getComputedStyle(document.getElementById("modal")).zIndex, getComputedStyle(document.getElementById("healthModal")).zIndex]');
  log('C zIndex=' + JSON.stringify(zc));
  expect('C 确认框压在体检弹窗之上', Number(zc[0]) > Number(zc[1]), zc);
  const hit = await ev('(() => { const b = document.getElementById("modalOk").getBoundingClientRect(); const e = document.elementFromPoint(b.left + b.width/2, b.top + b.height/2); return !!e && !!e.closest("#modal"); })()');
  expect('C 确认框在最前可点（命中测试）', hit === true, hit);

  await ev('document.getElementById("modalCancel").click()');
  await wait(300);
  expect('C 取消后确认框关闭', (await ev('document.getElementById("modal").classList.contains("hidden")')));
  const wC = written();
  expect('C 取消后什么都没写', !wC.ledger && wC.snap, wC);
  expect('C 取消后按钮还在', (await actionBtns()).length === 1);

  // 切英文：模板借用的分组标题与取值名都要跟着换
  await ev('(() => { const s = document.getElementById("setLang"); s.value = "en"; s.dispatchEvent(new Event("change")); })()');
  await wait(900);
  const btnsEn = await actionBtns();
  log('EN buttons=' + JSON.stringify(btnsEn));
  expect('E 按钮文本转英文', btnsEn.length === 1 && /^Re-apply 2 item\(s\)$/.test(btnsEn[0]), btnsEn);
  const detailEn = await ev('document.querySelector("#healthBody .fdetail").textContent');
  log('E detail=' + JSON.stringify(detailEn));
  const cjkEn = (detailEn.match(/[\u3400-\u9fff]+/g) || []);
  expect('E 明细整段英文无中文', cjkEn.length === 0, cjkEn.slice(0, 6));
  expect('E 明细仍是两项一组一句范围',
    /System gaming switches/.test(detailEn) && /NVIDIA 3D settings/.test(detailEn) && /now Off → should be On/.test(detailEn) && /Scope is limited/.test(detailEn), detailEn);
  await ev('document.querySelector("#healthBody .faction .btn").click()');
  await wait(300);
  const descEn = await ev('document.getElementById("modalDesc").textContent');
  expect('E 确认框文案转英文', /Only the 2 items listed below change/.test(descEn) && !/[\u3400-\u9fff]/.test(descEn), descEn);
  await ev('document.getElementById("modalCancel").click()');
  await wait(200);

  const wF = written();
  log('userData 里的写痕=' + JSON.stringify(wF.files));
  expect('全程只读：没写账本、没写开关备份、快照原样',
    !wF.ledger && !fs.existsSync(path.join(DEST, 'game-switch-backup.json')) && fs.readFileSync(SNAP, 'utf8') === snapBody, wF);
  finish(problems.length === 0 && errors.length === 0 ? 0 : 2);
}

app.whenReady().then(() => {
  const waitWin = () => {
    if (!targetWin) return setTimeout(waitWin, 200);
    probe(targetWin).catch((e) => { errors.push('[probe] ' + (e && e.stack ? e.stack : e)); finish(1); });
  };
  waitWin();
});

setTimeout(() => { if (!done && !targetWin) { errors.push('[no-window]'); finish(1); } }, 20000);
setTimeout(() => { errors.push('[timeout] 超过 300 秒未完成'); finish(1); }, 300000);
