'use strict';
// 优化前后的数字对比。产品定位是「效果可验证」，所以这里只存读得到的实测值：
// 某项读不到就留 null，界面上如实显示「读不到」，绝不拿估算值凑一张对比表。
const fs = require('fs');
const path = require('path');
const sysinfo = require('./sysinfo');
const admin = require('./admin');
const SCRIPT = path.join(__dirname, 'ps', 'baseline.ps1');
const BENCH_TIMEOUT_MS = 240000;

let storePath = null;

function init(userDataPath) {
  storePath = path.join(userDataPath, 'baseline.json');
}

function read() {
  if (!storePath) return {};
  try {
    const o = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    return o && typeof o === 'object' ? o : {};
  } catch (e) {
    return {};
  }
}

function write(patch) {
  const merged = Object.assign({}, read());
  for (const k of ['before', 'after']) {
    if (patch[k] === null) delete merged[k];
    else if (patch[k] !== undefined) merged[k] = patch[k];
  }
  try { fs.writeFileSync(storePath, JSON.stringify(merged, null, 2), 'utf8'); } catch (e) { /* 存不下不影响本次显示 */ }
  return merged;
}

/** winsat 报告里的 4K 随机读：优先精确名，退一步找同尺寸读项，都找不到就返回 null */
function pickBench(values) {
  const list = Array.isArray(values) ? values : [];
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const exact = list.find((v) => norm(v.name) === 'randomdisk4kread');
  if (exact) return exact;
  return list.find((v) => /4k/.test(norm(v.name)) && /read/.test(norm(v.name))) || null;
}

/** 只读实测：跑内建 winsat，不自己造数。读不到就带原因回来。 */
async function bench(drive) {
  const r = await admin.runElevated(SCRIPT, { action: 'bench', drive: drive || 'C' }, BENCH_TIMEOUT_MS);
  const d = r && r.data ? r.data : null;
  if (!d) {
    return { ok: false, canceled: !!(r && r.canceled), error: (r && r.stderr) || 'winsat 未返回结果', values: [] };
  }
  const hit = pickBench(d.values);
  return {
    ok: d.ok === true && !!hit,
    canceled: false,
    error: d.ok === true && !hit ? 'no-report' : (d.error || 'winsat 未能完成'),
    drive: d.drive || '',
    name: hit ? hit.name : '',
    value: hit ? Number(hit.value) : null,
    units: hit ? String(hit.units || '') : '',
    seconds: Number(d.seconds || 0),
    exitCode: d.exitCode === undefined ? null : Number(d.exitCode),
    file: d.file || '',
    raw: String(d.raw || '').slice(0, 200),
  };
}

/** 拍一张当前状态：内存 + 各盘可用 + 上次开机时间。withBench 时额外跑一次 4K 实测（会弹 UAC）。 */
async function capture(opts) {
  const o = opts || {};
  const info = await sysinfo.get();
  const snap = {
    at: new Date().toISOString(),
    memFree: Number.isFinite(info.local.freeRam) ? info.local.freeRam : null,
    memTotal: Number.isFinite(info.local.totalRam) ? info.local.totalRam : null,
    disks: (info.disks || []).map((d) => ({
      device: String(d.device || ''),
      label: String(d.label || ''),
      total: Number(d.total) || 0,
      free: Number(d.free) || 0,
    })),
    lastBoot: info.lastBoot || null,
    bench: null,
    benchError: null,
  };
  if (o.withBench) {
    const b = await bench(o.drive || 'C');
    if (b.ok) {
      snap.bench = { drive: b.drive, name: b.name, value: b.value, units: b.units, at: snap.at };
    } else {
      snap.benchError = b.canceled ? 'canceled' : (b.error || '读不到');
    }
  }
  return snap;
}

/**
 * 两张快照 → 对比行。纯函数，方便单测。
 * 盘按盘符对齐：只在一边出现的盘也要有行，另一侧留 null，别让改动「看起来消失了」。
 */
function compare(before, after) {
  const rows = [];
  const val = (s, k) => (s && s[k] != null ? Number(s[k]) : null);

  rows.push({
    key: 'memFree',
    kind: 'bytes',
    before: val(before, 'memFree'),
    after: val(after, 'memFree'),
  });

  const devices = [];
  for (const s of [before, after]) {
    for (const d of ((s && s.disks) || [])) if (d.device && devices.indexOf(d.device) < 0) devices.push(d.device);
  }
  devices.sort();
  for (const dev of devices) {
    const pick = (s) => {
      const d = ((s && s.disks) || []).find((x) => x.device === dev);
      return d && Number.isFinite(Number(d.free)) ? Number(d.free) : null;
    };
    rows.push({ key: 'disk:' + dev, kind: 'bytes', before: pick(before), after: pick(after) });
  }

  const b = (s) => (s && s.bench && Number.isFinite(Number(s.bench.value)) ? Number(s.bench.value) : null);
  rows.push({
    key: 'bench',
    kind: 'mbps',
    before: b(before),
    after: b(after),
    units: (after && after.bench && after.bench.units) || (before && before.bench && before.bench.units) || 'MB/s',
    missing: [
      before && before.benchError ? 'before:' + before.benchError : '',
      after && after.benchError ? 'after:' + after.benchError : '',
    ].filter(Boolean).join(','),
  });

  for (const r of rows) {
    r.diff = r.before !== null && r.after !== null ? r.after - r.before : null;
  }
  return rows;
}

function get() {
  const s = read();
  return { before: s.before || null, after: s.after || null };
}

module.exports = { init, get, read, write, capture, bench, compare, pickBench };
