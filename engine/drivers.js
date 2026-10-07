'use strict';
// 第三方驱动库：只处理「同一个 inf 存在多份、且有更新版本」的旧包。
// 删除只用 pnputil /delete-driver（不带 /force、不带 /uninstall），
// 任何仍被设备依赖的包都会被 pnputil 自己拒绝，我们不越过这道保护。
const path = require('path');
const { runWithPayload, runElevated } = require('./admin');

const SCRIPT = path.join(__dirname, 'ps', 'drivers.ps1');
const PUB_RE = /^oem\d+\.inf$/i;

// 脚本回传稳定的 ASCII 代码，中文说明统一在这里给
const CODES = {
  'bad-name': '名字不是 oemXX.inf 形式，已拒绝',
  'not-found': '驱动库里已经没有这个包（可能被其它操作删掉了）',
  'is-newest': '它是同一驱动的最新一份，删掉设备就没驱动可用了，已拒绝',
  'in-use': '仍有设备在用这个驱动包，pnputil 拒绝删除',
  'pnputil-no-packages': 'pnputil 没有列出任何驱动包（精简系统或权限问题）',
  'unknown-action': '未知的操作类型',
};

function reason(code, fallback) {
  return CODES[code] || fallback || code || '未知原因';
}

/** 只读扫描：不需要管理员权限，不会弹 UAC */
async function list() {
  const r = await runWithPayload(SCRIPT, { action: 'list' }, 120000);
  if (!r.data) {
    return { ok: false, canceled: false, total: 0, groups: [], oldCount: 0, message: r.stderr || '读取驱动库失败' };
  }
  if (r.data.ok === false) {
    return { ok: false, canceled: false, total: 0, groups: [], oldCount: 0, message: reason(r.data.error, '读取驱动库失败') };
  }
  return {
    ok: true, canceled: false,
    total: Number(r.data.total) || 0,
    groups: Array.isArray(r.data.groups) ? r.data.groups : [],
    oldCount: Number(r.data.oldCount) || 0,
    message: '',
  };
}

function normPubs(pubs) {
  const out = [];
  for (const p of (Array.isArray(pubs) ? pubs : [])) {
    const s = String(p || '').trim();
    if (!PUB_RE.test(s)) continue;
    const lower = s.toLowerCase();
    if (!out.includes(lower)) out.push(lower);
  }
  return out;
}

/**
 * 删除勾选的旧驱动包。需要一次管理员授权。
 * 提权脚本会当场重新枚举驱动库，UI 上的快照过期也不会误删最新的那一份。
 */
async function remove(pubs, confirmed) {
  if (confirmed !== true) return { ok: false, canceled: false, removed: [], skipped: [], message: '未经确认，已拒绝删除驱动包' };
  const list2 = normPubs(pubs);
  if (!list2.length) return { ok: true, canceled: false, removed: [], skipped: [], message: '没有勾选要删除的驱动包' };

  const r = await runElevated(SCRIPT, { action: 'delete', pubs: list2 }, 300000);
  if (r.canceled) return { ok: false, canceled: true, removed: [], skipped: [], message: '已取消管理员授权，没有删除任何驱动包' };
  if (!r.data) return { ok: false, canceled: false, removed: [], skipped: [], message: r.stderr || '删除驱动包失败' };
  if (r.data.ok === false && !Array.isArray(r.data.results)) {
    return { ok: false, canceled: false, removed: [], skipped: [], message: reason(r.data.error, '删除驱动包失败') };
  }

  const removed = [];
  const skipped = [];
  for (const it of (Array.isArray(r.data.results) ? r.data.results : [])) {
    if (it && it.deleted) removed.push(String(it.pub));
    else skipped.push({ pub: String((it && it.pub) || ''), reason: reason(it && it.code, (it && it.detail) || '') });
  }
  const parts = [`删除 ${removed.length} 个旧驱动包`];
  if (skipped.length) parts.push(`${skipped.length} 个被拒绝`);
  return { ok: true, canceled: false, removed, skipped, message: parts.join('，') };
}

module.exports = { list, remove, normPubs, PUB_RE, CODES, reason };
