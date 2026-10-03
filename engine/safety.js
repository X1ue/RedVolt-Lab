'use strict';
const fs = require('fs');
const path = require('path');
const { allowedRoots, protectList, systemAllowed } = require('./config');

function norm(p) {
  return path.resolve(String(p)).replace(/[\\/]+$/, '');
}

// 前缀匹配带路径边界，避免 "C:\a\bc" 被误判为 "C:\a\b" 的子路径
function startsWithBoundary(child, parent) {
  const c = norm(child).toLowerCase();
  const p = norm(parent).toLowerCase();
  return c === p || c.startsWith(p + path.sep);
}

function isProtected(p) {
  return protectList.some((pre) => startsWithBoundary(p, pre));
}

async function isReparsePoint(p) {
  try {
    const st = await fs.promises.lstat(p);
    return st.isSymbolicLink();
  } catch (e) {
    return false;
  }
}

function isLockedCode(err) {
  return !!err && ['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY', 'EEXIST'].includes(err.code);
}

/**
 * 删除前安全检查。返回 null 表示通过，否则返回拒绝原因。
 * admin=true 时按系统级白名单校验，否则按用户态允许根目录校验。
 */
async function checkPath(p, { admin = false } = {}) {
  if (!p) return '路径为空';
  try {
    await fs.promises.lstat(p);
  } catch (e) {
    return '不存在';
  }
  if (isProtected(p)) return '在保护清单中';
  if (await isReparsePoint(p)) return '是链接/重解析点，已拒绝';
  const list = admin ? systemAllowed : allowedRoots;
  const label = admin ? '不在系统级白名单内' : '不在允许的清理范围内';
  if (!list.some((r) => startsWithBoundary(p, r))) return label;
  return null;
}

module.exports = {
  norm, startsWithBoundary, isProtected, isReparsePoint, isLockedCode, checkPath,
};
