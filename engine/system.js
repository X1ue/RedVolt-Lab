'use strict';
const path = require('path');
const { getTarget, targetPaths } = require('./config');
const { checkPath } = require('./safety');
const { runElevated } = require('./admin');

const ADMIN_SCRIPT = path.join(__dirname, '..', 'elevated', 'admin.ps1');

function pickSystemTargets(ids) {
  return ids.map((id) => getTarget(id)).filter((t) => t && t.admin);
}

/** 扫描系统级项目：一次 UAC 授权，返回各项体积/数量 */
async function scanSystem(ids) {
  const list = pickSystemTargets(ids);
  if (!list.length) return { ok: true, canceled: false, results: [], message: '' };
  const payload = {
    action: 'scan',
    targets: list.map((t) => ({ id: t.id, kind: t.kind, paths: targetPaths(t) })),
  };
  const r = await runElevated(ADMIN_SCRIPT, payload, 300000);
  if (r.canceled) return { ok: false, canceled: true, results: [], message: '已取消管理员授权，未扫描系统级项目' };
  if (!r.data) return { ok: false, canceled: false, results: [], message: r.stderr || '系统级扫描失败' };
  return { ok: r.data.ok !== false, canceled: false, results: r.data.results || [], message: r.data.message || '' };
}

/**
 * 清理系统级项目：先在 Node 侧按系统白名单复查每个路径，
 * 再交给提权脚本执行（脚本内部还会独立校验一次白名单）。
 */
async function cleanSystem(ids) {
  const list = pickSystemTargets(ids);
  const verified = [];
  const refused = [];
  for (const t of list) {
    const okPaths = [];
    for (const p of targetPaths(t)) {
      const reason = await checkPath(p, { admin: true });
      if (reason === '不存在') continue;
      if (reason) { refused.push({ id: t.id, name: t.name, path: p, reason }); continue; }
      okPaths.push(p);
    }
    if (t.kind === 'flushDns') verified.push({ id: t.id, kind: t.kind, paths: [] });
    else if (okPaths.length) verified.push({ id: t.id, kind: t.kind, paths: okPaths });
  }
  if (!verified.length) {
    return { ok: true, canceled: false, results: [], refused, message: '没有可执行的系统级项目' };
  }
  const r = await runElevated(ADMIN_SCRIPT, { action: 'clean', targets: verified }, 600000);
  if (r.canceled) return { ok: false, canceled: true, results: [], refused, message: '已取消管理员授权，未做任何修改' };
  if (!r.data) return { ok: false, canceled: false, results: [], refused, message: r.stderr || '系统级清理失败' };
  return { ok: r.data.ok !== false, canceled: false, results: r.data.results || [], refused, message: r.data.message || '' };
}

module.exports = { scanSystem, cleanSystem };
