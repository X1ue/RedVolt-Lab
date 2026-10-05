'use strict';
// 游戏开关：只碰白名单里的几个注册表值（HAGS 在 HKLM，需要管理员授权；其余都在 HKCU）。
// 修改前把原值备份到 userData，随时可以一键还原；脚本内部还会独立校验一次白名单。
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const admin = require('./admin');

const SCRIPT = path.join(__dirname, 'ps', 'game.ps1');

/** rid = engine/ps/game.ps1 白名单里的注册表项 id */
const SWITCHES = [
  {
    id: 'hags', kind: 'toggle', admin: true, reboot: true, defaultState: 'on',
    items: [{ rid: 'hags', hive: 'HKLM', on: 2, off: 1 }],
  },
  {
    id: 'gamedvr', kind: 'toggle', defaultState: 'on',
    items: [
      { rid: 'gamedvr_store', hive: 'HKCU', on: 1, off: 0 },
      { rid: 'gamedvr_capture', hive: 'HKCU', on: 1, off: 0 },
    ],
  },
  {
    id: 'gamebar', kind: 'toggle', defaultState: 'on',
    items: [
      { rid: 'gamebar_nexus', hive: 'HKCU', on: 1, off: 0 },
      { rid: 'gamebar_startup', hive: 'HKCU', on: 1, off: 0 },
    ],
  },
  {
    id: 'gamemode', kind: 'toggle', defaultState: 'on',
    items: [{ rid: 'gamemode_auto', hive: 'HKCU', on: 1, off: 0 }],
  },
  {
    id: 'transparency', kind: 'toggle', defaultState: 'on',
    items: [{ rid: 'transparency', hive: 'HKCU', on: 1, off: 0 }],
  },
  {
    id: 'visualfx', kind: 'select', defaultState: 'absent',
    items: [{ rid: 'visualfx', hive: 'HKCU' }],
    options: ['absent', 1, 2, 3],
  },
];

const BY_ID = {};
for (const s of SWITCHES) BY_ID[s.id] = s;
const HIVE_OF = {};
for (const s of SWITCHES) for (const it of s.items) HIVE_OF[it.rid] = it.hive;

function backupFile() {
  return path.join(app.getPath('userData'), 'game-switch-backup.json');
}

function readBackup() {
  try {
    const o = JSON.parse(fs.readFileSync(backupFile(), 'utf8'));
    return o && o.ver === 1 && o.items && typeof o.items === 'object' ? o : null;
  } catch (e) {
    return null;
  }
}

function writeBackup(b) {
  try {
    fs.writeFileSync(backupFile(), JSON.stringify(b), 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

async function run(action, extra, elevated, timeoutMs) {
  const payload = Object.assign({ action }, extra || {});
  const r = elevated
    ? await admin.runElevated(SCRIPT, payload, timeoutMs || 180000)
    : await admin.runWithPayload(SCRIPT, payload, timeoutMs || 60000);
  if (r.canceled) return { ok: false, canceled: true, message: '已取消管理员授权，未做任何修改' };
  if (!r.data) return { ok: false, message: r.stderr || '注册表读写失败' };
  return r.data;
}

/** 读回白名单里全部注册表值（只读，不弹 UAC） */
async function readRaw() {
  const d = await run('read');
  if (!d || d.ok === false && !Array.isArray(d.values)) return { ok: false, message: (d && d.message) || '读取失败' };
  const map = {};
  for (const v of d.values || []) map[v.id] = { exists: !!v.exists, value: v.value == null ? null : Number(v.value), keyExists: !!v.keyExists };
  return { ok: true, admin: !!d.admin, values: map };
}

function derive(sw, raw) {
  if (sw.kind === 'select') {
    const r = raw[sw.items[0].rid] || {};
    return r.exists && r.value != null ? r.value : 'absent';
  }
  let on = true;
  let off = true;
  for (const it of sw.items) {
    const r = raw[it.rid] || {};
    const v = r.exists && r.value != null ? r.value : (sw.defaultState === 'on' ? it.on : it.off);
    if (v !== it.on) on = false;
    if (v !== it.off) off = false;
  }
  return on ? 'on' : off ? 'off' : 'mixed';
}

function opsFor(sw, mode) {
  if (sw.kind === 'select') {
    if (mode === 'default') return sw.items.map((it) => ({ id: it.rid, op: 'del' }));
    const n = Number(mode);
    if (!Number.isInteger(n) || sw.options.indexOf(n) < 0) return null;
    return sw.items.map((it) => ({ id: it.rid, op: 'set', value: n }));
  }
  if (mode !== 'on' && mode !== 'off' && mode !== 'default') return null;
  return sw.items.map((it) => (mode === 'default'
    ? { id: it.rid, op: 'del' }
    : { id: it.rid, op: 'set', value: mode === 'on' ? it.on : it.off }));
}

/** 目标状态是否已经满足（避免无谓写入 / 无谓 UAC） */
function already(sw, mode, raw) {
  const cur = derive(sw, raw);
  if (sw.kind === 'select') {
    return mode === 'default' ? cur === 'absent' : String(cur) === String(Number(mode));
  }
  if (mode === 'default') return sw.items.every((it) => !(raw[it.rid] || {}).exists);
  return cur === mode;
}

function needsAdmin(sw) {
  return !!sw.admin || sw.items.some((it) => it.hive === 'HKLM');
}

/** 把原值记进备份（同一开关只记第一次，保证「还原」回到最初状态） */
function backupSwitches(raw, ids) {
  const b = readBackup() || { ver: 1, items: {} };
  let changed = false;
  for (const id of ids) {
    const sw = BY_ID[id];
    if (!sw || b.items[id]) continue;
    b.items[id] = {
      at: Date.now(),
      values: sw.items.map((it) => {
        const r = raw[it.rid] || {};
        return { rid: it.rid, exists: !!r.exists, value: r.value == null ? null : r.value };
      }),
    };
    changed = true;
  }
  if (!changed) return b;
  writeBackup(b);
  return b;
}

async function applyOps(ops) {
  if (!Array.isArray(ops) || !ops.length) return { ok: true, results: [], unchanged: true };
  const bad = ops.filter((o) => !o || !HIVE_OF[o.id]);
  if (bad.length) return { ok: false, message: '含未登记的注册表项，已拒绝写入' };
  const elevated = ops.some((o) => HIVE_OF[o.id] === 'HKLM');
  const d = await run('write', { ops }, elevated);
  if (!d || d.ok === false && !d.results) return { ok: false, canceled: !!d.canceled, message: (d && d.message) || '写入失败' };
  const results = d.results || [];
  const failed = results.filter((r) => !r.ok);
  return {
    ok: !failed.length,
    canceled: !!d.canceled,
    results,
    message: failed.length ? failed.map((f) => f.id + ': ' + (f.error || '失败')).join('；') : '',
  };
}

/** 改一个开关：mode = on / off / default（select 型可传数值） */
async function apply(id, mode, confirmed) {
  if (confirmed !== true) return { ok: false, message: '未经确认，已拒绝修改' };
  const sw = BY_ID[id];
  if (!sw) return { ok: false, message: '未知开关：' + String(id || '') };
  const ops = opsFor(sw, mode);
  if (!ops) return { ok: false, message: '无效的目标状态：' + String(mode || '') };
  const r = await readRaw();
  if (!r.ok) return { ok: false, message: r.message };
  if (already(sw, mode, r.values)) return { ok: true, unchanged: true, state: derive(sw, r.values) };
  backupSwitches(r.values, [id]);
  const w = await applyOps(ops);
  if (w.canceled) return w;
  const after = await readRaw();
  return {
    ok: w.ok,
    message: w.message,
    state: after.ok ? derive(sw, after.values) : null,
    backup: !!readBackup(),
  };
}

async function restoreAll(confirmed) {
  if (confirmed !== true) return { ok: false, message: '未经确认，已拒绝修改' };
  const b = readBackup();
  if (!b || !Object.keys(b.items).length) return { ok: false, message: '还没有备份，无需还原' };
  const ops = [];
  for (const id of Object.keys(b.items)) {
    for (const v of b.items[id].values || []) {
      if (!HIVE_OF[v.rid]) continue;
      ops.push(v.exists ? { id: v.rid, op: 'set', value: v.value } : { id: v.rid, op: 'del' });
    }
  }
  const w = await applyOps(ops);
  if (w.canceled) return w;
  return { ok: w.ok, message: w.message, restored: Object.keys(b.items).length };
}

/** 当前状态总览（页面渲染用） */
async function status() {
  const r = await readRaw();
  if (!r.ok) return r;
  const b = readBackup();
  return {
    ok: true,
    admin: r.admin,
    switches: SWITCHES.map((sw) => ({
      id: sw.id,
      kind: sw.kind,
      admin: needsAdmin(sw),
      reboot: !!sw.reboot,
      options: sw.options || null,
      state: derive(sw, r.values),
      raw: sw.items.map((it) => ({ rid: it.rid, exists: !!(r.values[it.rid] || {}).exists, value: (r.values[it.rid] || {}).value })),
      backedUp: !!(b && b.items[sw.id]),
    })),
    backup: !!(b && Object.keys(b.items).length),
    backupCount: b ? Object.keys(b.items).length : 0,
  };
}

module.exports = { SWITCHES, status, apply, restoreAll, readRaw, derive, opsFor, already, applyOps, backupSwitches, needsAdmin };
