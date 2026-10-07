'use strict';
// 变更账本：每次改动落一条结构化记录（谁改的、什么时候、改了什么、原值是什么、能不能撤销）。
// 撤销靠记录里的原值精确回写，不依赖系统还原点（改版系统常常把还原点组件精简掉）。
// 删文件类操作物理上无法撤销，账本如实标注，不假装可恢复。
const fs = require('fs');
const path = require('path');

const FILE = 'changes-ledger.json';
const MAX_ENTRIES = 500;

let filePath = null;
let deps = {};
let appendLog = () => {};

function init(userDataPath, d) {
  filePath = path.join(userDataPath, FILE);
  deps = d || {};
  appendLog = (d && d.appendLog) || appendLog;
  return filePath;
}

function uid() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function read() {
  try {
    const o = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return o && o.ver === 1 && Array.isArray(o.entries) ? o : { ver: 1, entries: [] };
  } catch (e) {
    return { ver: 1, entries: [] };
  }
}

function write(state) {
  try {
    if (state.entries.length > MAX_ENTRIES) state.entries = state.entries.slice(-MAX_ENTRIES);
    fs.writeFileSync(filePath, JSON.stringify(state), 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 记一条变更。undo 为 null 表示不可撤销，此时必须给出 undoHint 说明原因。
 * undo.type 取值：tier | game | power | gpu | gpuProfile | startup
 */
function record(entry) {
  if (!filePath || !entry) return null;
  const e = {
    id: uid(),
    at: Date.now(),
    source: String(entry.source || '其他'),
    label: String(entry.label || ''),
    undo: entry.undo && typeof entry.undo === 'object' ? entry.undo : null,
    undoHint: String(entry.undoHint || (entry.undo ? '按记录的原值回写' : '该操作无法撤销')),
    status: 'applied',
    undoneAt: null,
    error: null,
  };
  const st = read();
  st.entries.push(e);
  write(st);
  return e;
}

function list(limit = 200) {
  const st = read();
  return st.entries.slice(-Math.max(1, limit)).reverse();
}

function get(id) {
  return read().entries.filter((e) => e.id === id)[0] || null;
}

function setStatus(id, status, error) {
  const st = read();
  const e = st.entries.filter((x) => x.id === id)[0];
  if (!e) return false;
  e.status = status;
  e.error = error || null;
  if (status === 'undone') e.undoneAt = Date.now();
  return write(st);
}

/** 撤销类型 → 具体回写动作。全部走各模块已有的写通道，账本不自己碰注册表。 */
async function perform(entry) {
  const u = entry.undo;
  if (!u || !u.type) return { ok: false, message: entry.undoHint || '该操作无法撤销' };
  switch (u.type) {
    case 'tier':
      if (!deps.tiers) return { ok: false, message: '一键优化模块未就绪' };
      return deps.tiers.restore(true);
    case 'game':
      if (!deps.game) return { ok: false, message: '游戏开关模块未就绪' };
      return deps.game.restoreIds(u.ids || [], true);
    case 'power':
      if (!deps.power || !u.guid) return { ok: false, message: '缺少原电源计划 GUID，无法撤销' };
      return deps.power.applyGuid(u.guid, true);
    case 'gpu':
      if (!deps.gpu) return { ok: false, message: '显卡模块未就绪' };
      return deps.gpu.setMany(u.profile || 'global', u.name || '', (u.items || []).map((i) => ({ id: i.id, value: i.value })));
    case 'gpuProfile':
      if (!deps.gpu || !u.name) return { ok: false, message: '缺少方案名，无法撤销' };
      return deps.gpu.delProfile(u.profile || '', u.name);
    case 'startup':
      if (!deps.startup || !u.id) return { ok: false, message: '缺少启动项 ID，无法撤销' };
      return deps.startup.setEnabled(u.id, !!u.enabled);
    default:
      return { ok: false, message: '未知的撤销类型：' + u.type };
  }
}

/** 撤销一条。confirmed 必须由 IPC 层显式传 true。 */
async function undo(id, confirmed) {
  if (confirmed !== true) return { ok: false, message: '未经确认，已拒绝撤销' };
  const entry = get(id);
  if (!entry) return { ok: false, message: '找不到该记录' };
  if (entry.status === 'undone') return { ok: false, message: '这条已经撤销过了' };
  if (!entry.undo) return { ok: false, message: entry.undoHint || '该操作无法撤销' };
  const r = await perform(entry);
  const ok = !!(r && r.ok);
  setStatus(id, ok ? 'undone' : 'failed', ok ? null : String((r && (r.message || r.error)) || '撤销失败'));
  appendLog(`撤销变更 | ${entry.source} | ${entry.label} | ${ok ? '成功' : '失败: ' + ((r && (r.message || r.error)) || '')}`);
  return { ok, message: ok ? '' : String((r && (r.message || r.error)) || '撤销失败'), entry: get(id) };
}

/** 全部撤销：从最新往回，只处理还能撤销的记录 */
async function undoAll(confirmed) {
  if (confirmed !== true) return { ok: false, message: '未经确认，已拒绝撤销' };
  const todo = list(MAX_ENTRIES).filter((e) => e.status === 'applied' && e.undo);
  if (!todo.length) return { ok: false, message: '没有可撤销的变更' };
  const done = [];
  const failed = [];
  for (const e of todo) {
    const r = await undo(e.id, true);
    if (r.ok) done.push(e.label);
    else failed.push(`${e.label}: ${r.message}`);
  }
  return { ok: !failed.length, undone: done.length, total: todo.length, failed };
}

function stats() {
  const st = read();
  const applied = st.entries.filter((e) => e.status === 'applied');
  return {
    total: st.entries.length,
    applied: applied.length,
    undoable: applied.filter((e) => !!e.undo).length,
    undone: st.entries.filter((e) => e.status === 'undone').length,
    failed: st.entries.filter((e) => e.status === 'failed').length,
  };
}

module.exports = { init, record, list, get, undo, undoAll, stats, setStatus, getPath: () => filePath };
