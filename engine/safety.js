'use strict';
const fs = require('fs');
const path = require('path');
const { allowedRoots, protectList, protectExceptions, systemAllowed } = require('./config');

function norm(p) {
  return path.resolve(String(p)).replace(/[\\/]+$/, '');
}

// 前缀匹配带路径边界，避免 "C:\a\bc" 被误判为 "C:\a\b" 的子路径
function startsWithBoundary(child, parent) {
  const c = norm(child).toLowerCase();
  const p = norm(parent).toLowerCase();
  return c === p || c.startsWith(p + path.sep);
}

// 命中保护前缀即拒绝，但保护清单里显式列出的缓存子目录（浏览器 Cache 等）仍然放行
function isProtected(p) {
  if (!protectList.some((pre) => startsWithBoundary(p, pre))) return false;
  return !protectExceptions.some((ex) => startsWithBoundary(p, ex));
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
    // 系统目录普通权限连元数据都读不到（EPERM）。这不是「不存在」，
    // 如实放行给提权侧，由提权脚本再查一次存在性和白名单；谎报不存在会让项目永远清不掉。
    const code = e && e.code;
    if (code !== 'EPERM' && code !== 'EACCES') return '不存在';
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
