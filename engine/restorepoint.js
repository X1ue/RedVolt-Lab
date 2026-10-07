'use strict';
// 系统还原点：一键优化前的「兜底」。撤销主要靠变更账本（精确到单个值），
// 还原点只是加强项——改版系统常把还原点组件精简掉，所以这里任何一步失败都如实返回原因，
// 绝不静默失败，也不把「没建成」说成「已保护」。
const path = require('path');
const admin = require('./admin');

const SCRIPT = path.join(__dirname, 'ps', 'restorepoint.ps1');

// Checkpoint-Computer 默认 24 小时内只允许创建一个还原点，间隔内的请求直接复用已有的
const REUSE_WINDOW_MS = 24 * 3600 * 1000;

let cache = null;

function run(payload, timeoutMs) {
  return admin.runElevated(SCRIPT, payload, timeoutMs || 300000);
}

function toBytes(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function norm(d) {
  if (!d) return null;
  const shadow = d.shadow || null;
  return {
    admin: !!d.admin,
    cmdlet: !!d.cmdlet,
    disabled: !!d.disabled,
    count: Number(d.count) || 0,
    last: d.last ? { seq: d.last.seq, description: d.last.description, at: d.last.at } : null,
    shadow: shadow ? { used: toBytes(shadow.used), allocated: toBytes(shadow.allocated), max: toBytes(shadow.max) } : null,
    services: d.services || {},
  };
}

/** 还原点在本机到底能不能用；不可用时给出人话原因 */
function availability(s) {
  if (!s) return { available: false, reason: '读取失败' };
  if (!s.admin) return { available: false, reason: '需要管理员授权后才能读取还原点状态' };
  if (!s.cmdlet) return { available: false, reason: '本机 PowerShell 没有 Checkpoint-Computer 命令（系统还原组件被精简）' };
  if (s.disabled) return { available: false, reason: '系统保护已关闭，请先在「系统属性 → 系统保护」里为 C 盘启用' };
  if (s.services && s.services.VSS === 'absent') return { available: false, reason: '卷影复制服务（VSS）不存在，系统还原组件被精简' };
  return { available: true, reason: '' };
}

/** 读当前还原点状态（需要一次 UAC；结果缓存 60 秒，避免反复弹窗） */
async function status(force) {
  if (!force && cache && Date.now() - cache.at < 60000) return cache.data;
  const r = await run({ action: 'status' }, 120000);
  if (r.canceled) return { ok: false, canceled: true, message: '已取消管理员授权，未读取还原点状态' };
  if (!r.data) return { ok: false, message: r.stderr || '读取还原点状态失败' };
  const s = norm(r.data);
  const av = availability(s);
  const out = { ok: r.data.ok !== false, ...s, available: av.available, reason: av.reason || (r.data.error || '') };
  cache = { at: Date.now(), data: out };
  return out;
}

function lastAge(s) {
  if (!s || !s.last || !s.last.at) return null;
  const t = Date.parse(s.last.at);
  return Number.isFinite(t) ? Date.now() - t : null;
}

/**
 * 优化前确保有一个还原点。
 * 返回 { ok, created | reused | skipped, reason }；skipped 表示本机做不到或 24 小时内已有，
 * 调用方必须把 reason 原样告诉用户。
 */
async function ensureBefore(description, opts) {
  const force = !!(opts && opts.force);
  const st = await status(force);
  if (st.canceled) return { ok: false, skipped: true, reason: st.message };
  if (!st.available) return { ok: false, skipped: true, reason: st.reason };
  const age = lastAge(st);
  if (!force && age != null && age < REUSE_WINDOW_MS) {
    return {
      ok: true,
      reused: true,
      skipped: false,
      at: st.last.at,
      reason: `${Math.round(age / 3600000)} 小时前已有还原点（${st.last.description || '系统还原点'}），Windows 限制 24 小时内只能建一个，本次复用`,
    };
  }
  const r = await run({ action: 'create', description: description || 'RedVolt Lab 优化前还原点' }, 420000);
  cache = null;
  if (r.canceled) return { ok: false, skipped: true, reason: '已取消管理员授权，未创建还原点' };
  if (!r.data) return { ok: false, skipped: true, reason: r.stderr || '创建还原点失败' };
  if (r.data.ok === false) {
    const code = r.data.code || 'error';
    const map = {
      interval: 'Windows 限制 24 小时内只能创建一个还原点，请稍后再试',
      disabled: '系统保护已关闭，请先在「系统属性 → 系统保护」里为 C 盘启用',
      'no-space': '卷影副本存储空间不足，请在「系统保护」里调大 C 盘的最大使用量',
      'needs-admin': '需要管理员授权',
      'no-new-point': '命令执行完但没出现新还原点（系统还原组件可能被精简）',
    };
    return { ok: false, skipped: true, code, reason: map[code] || String(r.data.error || '创建还原点失败') };
  }
  const after = norm(r.data);
  return {
    ok: true,
    created: true,
    skipped: false,
    count: after.count,
    elapsedMs: r.data.elapsedMs || null,
    shadow: after.shadow,
    reason: `已创建还原点（耗时 ${Math.round((r.data.elapsedMs || 0) / 1000)} 秒）`,
  };
}

module.exports = { status, ensureBefore, availability, REUSE_WINDOW_MS };
