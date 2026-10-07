'use strict';
// 1.2.0 性能基线冒烟：记「优化前」→ 改文件模拟差值 → 看对比与颜色 → 记「优化后」→ 清除 → 英文无残渣。
// 全程只读系统、只写临时 userData；4K 实测勾选框绝不勾（那会弹 UAC）。窗口保持隐藏。
const Module = require('module');
const origLoad = Module._load;
let bwProxy = null;
let hiddenOk = false;
Module._load = function (request) {
  const exp = origLoad.apply(this, arguments);
  if (request !== 'electron' || !exp || typeof exp.BrowserWindow !== 'function') return exp;
  if (!hiddenOk) {
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

const DEST = path.join(os.tmpdir(), `rv-base-smoke-${Date.now()}`);
fs.mkdirSync(DEST, { recursive: true });
app.setPath('userData', DEST);
const BASE_FILE = path.join(DEST, 'baseline.json');

require('./main.js');

const errors = [];
let done = false;
function log(...a) {
  const line = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  try { process.stdout.write(line + '\n'); } catch (e) { if (!e || e.code !== 'EPIPE') throw e; }
}
process.stdout.on('error', (e) => { if (!e || e.code !== 'EPIPE') throw e; });
function finish(code) {
  if (done) return;
  done = true;
  log('---- errors ----');
  log(errors.length ? errors.join('\n') : '(none)');
  log(code === 0 ? '结果: 全部通过' : '结果: 有失败项');
  setTimeout(() => app.exit(code), 200);
}
const problems = [];
const expect = (name, ok, extra) => {
  log((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  -> ' + JSON.stringify(extra)));
  if (!ok) problems.push(name);
};
const CJK = /[\u3400-\u9fff]/;

let targetWin = null;
app.on('browser-window-created', (e, w) => { if (!targetWin) targetWin = w; });

async function probe(win) {
  win.webContents.on('console-message', (e, level, message) => { if (level >= 2) errors.push('[console] ' + message); });
  win.webContents.on('render-process-gone', (e, d) => errors.push('[render-gone] ' + JSON.stringify(d)));
  const ev = (js) => win.webContents.executeJavaScript(js, true);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const click = (id) => ev(`document.getElementById(${JSON.stringify(id)}).click()`);

  await wait(2500);
  log('hiddenWindow=' + hiddenOk);
  if (await ev('!document.getElementById("eulaModal").classList.contains("hidden")')) {
    await ev('(() => { const c = document.getElementById("eulaAck"); c.checked = true; c.dispatchEvent(new Event("change")); })()');
    await wait(200);
    await click('eulaEnter');
    await wait(600);
  }

  // 进系统信息页（会触发一次采集）
  await ev('document.querySelector(\'.tab[data-tab="info"]\').click()');
  await wait(2500);

  const view = () => ev(`(() => {
    const rows = [...document.querySelectorAll('#baselineBody .bl-row')].map(r => [...r.children].map(c => ({
      text: c.textContent, cls: c.className, })));
    return {
      rows,
      busy: document.getElementById('baseRefresh').disabled,
      empty: !!document.querySelector('#baselineBody .bl-empty'),
      meta: [...document.querySelectorAll('#baselineBody .bl-meta span')].map(s => s.textContent),
      benchChecked: document.getElementById('baseBench').checked,
      file: null,
    };
  })()`);

  // 采集要走 PowerShell，快慢不定；每次动作后等到刷新结束再看，别用固定 sleep 赌时间
  async function waitView(pred) {
    let last = null;
    for (let i = 0; i < 40; i++) {
      last = await view();
      if (!last.busy && pred(last)) return last;
      await wait(500);
    }
    return last;
  }

  // ---------- 1. 空基线：只有实时列，优化前是占位 ----------
  let v = await waitView((x) => x.rows.length >= 4);
  log('emptyView=' + JSON.stringify(v.rows));
  expect('表头四列齐了', v.rows.length && v.rows[0].map((c) => c.text).join('|') === '指标|优化前（未记录）|现在|变化', v.rows[0]);
  expect('有内存/磁盘/4K 三类行', v.rows.length >= 4, v.rows.length);
  const memRow = v.rows.find((r) => r[0].text === '空闲内存');
  expect('空闲内存优化前是占位符', memRow && memRow[1].text === '—', memRow);
  expect('实时列有具体数字', memRow && /GB/.test(memRow[2].text), memRow);
  const benchRow = v.rows.find((r) => r[0].text === '磁盘 4K 随机读');
  expect('没记录的 4K 侧写「未记录」，实时侧写「未测」', benchRow && benchRow[1].text === '未记录' && benchRow[2].text === '未测', benchRow);
  expect('没基线时给一句怎么做', v.empty === true);
  expect('4K 实测勾选框默认不勾（不擅自弹 UAC）', v.benchChecked === false);
  expect('元信息说明两侧都未记录', v.meta.join(' ').indexOf('优化前：未记录') >= 0, v.meta);

  // ---------- 2. 记一次「优化前」：文件落在临时 userData ----------
  await click('baseBefore');
  for (let i = 0; i < 40 && !fs.existsSync(BASE_FILE); i++) await wait(500);
  expect('baseline.json 写在临时 userData', fs.existsSync(BASE_FILE));
  const stored = JSON.parse(fs.readFileSync(BASE_FILE, 'utf8'));
  expect('只记了 before，没有 after', !!stored.before && !stored.after, Object.keys(stored));
  expect('快照里有内存和盘符', Number.isFinite(stored.before.memFree) && stored.before.disks.length >= 1, stored.before && stored.before.disks);
  expect('没勾 4K 就不该跑 winsat', stored.before.bench === null && stored.before.benchError === null, stored.before);
  v = await waitView((x) => x.rows[0] && x.rows[0][1].text === '优化前');
  const memRow2 = v.rows.find((r) => r[0].text === '空闲内存');
  expect('记完后优化前列有值了', memRow2 && /GB/.test(memRow2[1].text), memRow2);
  expect('数值没变时不硬凑差值', memRow2 && (/^(持平|[+−]\d)/.test(memRow2[3].text) || memRow2[3].text === '') && !/NaN/.test(memRow2[3].text), memRow2);
  expect('表头第二列去掉「未记录」', v.rows[0][1].text === '优化前', v.rows[0]);

  // ---------- 3. 用磁盘文件模拟一次真实差异，验证差值与配色 ----------
  const GB = 1073741824;
  const fake = {
    before: {
      at: '2026-10-01T02:00:00.000Z',
      memFree: 2 * GB,
      memTotal: 16 * GB,
      disks: [{ device: 'C:', label: '', total: 150 * GB, free: 1 * GB }, { device: 'X:', label: '', total: 10 * GB, free: 5 * GB }],
      lastBoot: '2026-09-30T01:00:00.000Z',
      bench: { drive: 'C:', name: 'RandomDisk4kRead', value: 12.5, units: 'MB/s', at: '2026-10-01T02:00:00.000Z' },
      benchError: null,
    },
  };
  fs.writeFileSync(BASE_FILE, JSON.stringify(fake, null, 2), 'utf8');
  await click('baseRefresh');
  v = await waitView((x) => x.rows.some((r) => r[0].text === 'X 盘可用'));
  log('diffView=' + JSON.stringify(v.rows));
  const mem3 = v.rows.find((r) => r[0].text === '空闲内存');
  expect('内存差值显示为正向增量', mem3 && /^\+\d/.test(mem3[3].text) && /up/.test(mem3[3].cls), mem3);
  const cRow = v.rows.find((r) => r[0].text === 'C 盘可用');
  expect('C 盘可用被认成同一盘位并算出差值', cRow && /up/.test(cRow[3].cls), cRow);
  const xRow = v.rows.find((r) => r[0].text === 'X 盘可用');
  expect('只在基线里出现的盘位仍列出，差值留空', xRow && xRow[1].text.indexOf('GB') >= 0 && xRow[3].text === '', xRow);
  const b3 = v.rows.find((r) => r[0].text === '磁盘 4K 随机读');
  expect('基线里测过 4K 就直接用那个值', b3 && b3[1].text === '12.5 MB/s', b3);
  expect('4K 行有基线值时实时列说「未测」', b3 && b3[2].text === '未测', b3);

  // ---------- 4. 读不到的原因要说清楚 ----------
  const failed = JSON.parse(JSON.stringify(fake));
  failed.before.bench = null;
  failed.before.benchError = 'needs-admin';
  failed.before.benchRaw = 'exit 740';
  fs.writeFileSync(BASE_FILE, JSON.stringify(failed, null, 2), 'utf8');
  await click('baseRefresh');
  v = await waitView((x) => {
    const r = x.rows.find((y) => y[0].text === '磁盘 4K 随机读');
    return r && r[1].text.indexOf('读不到') === 0;
  });
  const b4 = v.rows.find((r) => r[0].text === '磁盘 4K 随机读');
  log('benchFail=' + JSON.stringify(b4));
  expect('winsat 被拒时写明原因而不是留空', b4 && b4[1].text === '读不到（系统拒绝以管理员运行 winsat）', b4);

  // ---------- 5. 记「优化后」：两列都定住，差值来自两次记录 ----------
  fs.writeFileSync(BASE_FILE, JSON.stringify({ before: fake.before }, null, 2), 'utf8');
  await click('baseAfter');
  for (let i = 0; i < 40; i++) {
    const s = (() => { try { return JSON.parse(fs.readFileSync(BASE_FILE, 'utf8')); } catch (e) { return null; } })();
    if (s && s.after) break;
    await wait(500);
  }
  const stored2 = JSON.parse(fs.readFileSync(BASE_FILE, 'utf8'));
  expect('after 也存进了文件', !!stored2.after && !!stored2.before);
  v = await waitView((x) => x.rows[0] && x.rows[0][2].text === '优化后');
  expect('表头第三列改成「优化后」', v.rows[0][2].text === '优化后', v.rows[0]);
  expect('元信息带上两次记录时间', v.meta.length === 2 && /优化前记录于/.test(v.meta[0]) && /优化后记录于/.test(v.meta[1]), v.meta);
  const b5 = v.rows.find((r) => r[0].text === '磁盘 4K 随机读');
  expect('基线有 4K、优化后没测 → 差值留空而不是负数', b5 && b5[2].text === '未测' && b5[3].text === '', b5);

  // ---------- 6. 英文界面：整块没有中文残渣 ----------
  await ev('window.i18n.setLang("en", window.optimizer)');
  await wait(900);
  await click('baseRefresh');
  for (let i = 0; i < 40; i++) {
    const txt = await ev('document.getElementById("baselineBody").textContent');
    if (!CJK.test(txt) && /Metric/.test(txt)) break;
    await wait(500);
  }
  const en = await ev('document.getElementById("baselineBody").textContent');
  log('enBlock=' + en.replace(/\s+/g, ' ').slice(0, 400));
  expect('英文下基线区无中文残留', !CJK.test(en), en.replace(/\s+/g, ' ').slice(0, 90));
  expect('表头与行名已翻译', /Metric/.test(en) && /Free memory/.test(en) && /Disk 4K random read/.test(en), en.slice(0, 80));
  expect('记录时间这类拼句也翻了', /recorded at/.test(en) && /last boot/.test(en), en.replace(/\s+/g, ' ').slice(0, 120));
  const enHint = await ev('document.querySelector("#tab-info .baseline .hint").textContent');
  expect('页面说明也翻了', !CJK.test(enHint), enHint.slice(0, 80));
  await ev('window.i18n.setLang("zh", window.optimizer)');
  await wait(700);

  // ---------- 7. 清除：走确认弹窗，确认后两份都删 ----------
  await click('baseClear');
  await wait(400);
  expect('清除前有确认弹窗', (await ev('!document.getElementById("modal").classList.contains("hidden")')) === true);
  await click('modalOk');
  for (let i = 0; i < 40; i++) {
    const s = JSON.parse(fs.readFileSync(BASE_FILE, 'utf8'));
    if (!s.before && !s.after) break;
    await wait(500);
  }
  const stored3 = JSON.parse(fs.readFileSync(BASE_FILE, 'utf8'));
  expect('清除后两份都没了', !stored3.before && !stored3.after, stored3);
  v = await waitView((x) => x.empty === true && x.rows[0][1].text === '优化前（未记录）');
  expect('界面回到未记录状态', v.empty === true && v.rows[0][1].text === '优化前（未记录）', v.rows[0]);

  // ---------- 8. 没碰系统 ----------
  expect('窗口全程隐藏', win.isVisible() === false);
  expect('4K 实测从没被触发（没有 winsat 报告文件产生）', stored3.before === undefined);

  if (problems.length) log('problems=' + JSON.stringify(problems));
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
