'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { getTarget, targetPaths, TEMP_AGE_DAYS } = require('./config');
const { checkPath, isProtected } = require('./safety');
const { runCommand, parseJson } = require('./ps');
const { walk } = require('./scan');

const RESIDUAL_WARN_BYTES = 1 * 1024 * 1024;

function newStats() {
  return { deleted: 0, locked: 0, freed: 0, blocked: 0 };
}

function merge(into, from) {
  into.deleted += from.deleted;
  into.locked += from.locked;
  into.freed += from.freed;
  into.blocked += (from.blocked || 0);
}

/** 清空目录内容并保留目录本身；不跟随链接；被占用的逐项跳过 */
async function clearDirContents(dir, opt = {}) {
  const stats = newStats();
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (e) {
    stats.locked++;
    return stats;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    // 保护清单里的项（凭据、UWP 数据等）逐个复查，绝不递归进去删
    if (isProtected(full)) { stats.blocked++; continue; }
    if (ent.isSymbolicLink()) {
      try { await fs.promises.unlink(full); stats.deleted++; } catch (e) { stats.locked++; }
      continue;
    }
    if (ent.isDirectory()) {
      merge(stats, await clearDirContents(full, opt));
      try { await fs.promises.rmdir(full); } catch (e) { /* 非空或被占用，保留 */ }
      continue;
    }
    if (opt.fileFilter && !opt.fileFilter.test(ent.name)) continue;
    let size = 0;
    try { size = (await fs.promises.stat(full)).size; } catch (e) { continue; }
    try {
      await fs.promises.unlink(full);
      stats.deleted++;
      stats.freed += size;
    } catch (e) {
      stats.locked++;
    }
  }
  return stats;
}

/** 只删超过 N 天的 Temp 顶层项 */
async function cleanTempOld(t) {
  const stats = newStats();
  const cutoff = Date.now() - TEMP_AGE_DAYS * 86400000;
  let entries;
  try {
    entries = await fs.promises.readdir(t.path, { withFileTypes: true });
  } catch (e) {
    return { stats, error: '无法读取 Temp 目录' };
  }
  for (const ent of entries) {
    const full = path.join(t.path, ent.name);
    if (isProtected(full)) { stats.blocked++; continue; }
    let st;
    try { st = await fs.promises.stat(full); } catch (e) { continue; }
    if (st.mtimeMs >= cutoff) continue;
    if (ent.isSymbolicLink()) {
      try { await fs.promises.unlink(full); stats.deleted++; } catch (e) { stats.locked++; }
      continue;
    }
    if (ent.isDirectory()) {
      merge(stats, await clearDirContents(full));
      try { await fs.promises.rmdir(full); } catch (e) { stats.locked++; }
      continue;
    }
    try {
      await fs.promises.unlink(full);
      stats.deleted++;
      stats.freed += st.size;
    } catch (e) {
      stats.locked++;
    }
  }
  return { stats };
}

async function cleanRecycleBin() {
  await runCommand('Clear-RecycleBin -Force -ErrorAction SilentlyContinue');
  const r = await runCommand(
    '[Console]::OutputEncoding=[Text.Encoding]::UTF8; try { $s=New-Object -ComObject Shell.Application; @($s.Namespace(10).Items()).Count } catch { -1 }'
  );
  const left = parseInt(String(r.stdout).trim(), 10);
  const stats = newStats();
  if (Number.isFinite(left) && left === 0) stats.deleted = 1;
  else if (Number.isFinite(left) && left > 0) stats.locked = left;
  return { stats, left: Number.isFinite(left) ? left : null };
}

function cleanNpmCache() {
  return new Promise((resolve) => {
    execFile('npm.cmd', ['cache', 'clean', '--force'], { windowsHide: true, timeout: 180000 }, (err) => {
      const stats = newStats();
      if (err) resolve({ stats, error: 'npm cache clean 执行失败' });
      else { stats.deleted = 1; resolve({ stats }); }
    });
  });
}

/**
 * 清理单个目标。执行前对每个路径重新做安全检查，任何一项不通过就整项跳过。
 */
async function cleanTarget(id) {
  const t = getTarget(id);
  if (!t) return { id, status: 'error', message: '未知的清理项' };
  if (t.admin) return { id, status: 'skipped', message: '系统级项目需走管理员通道' };

  const result = {
    id, name: t.name, status: 'done', message: '',
    deleted: 0, locked: 0, freed: 0, residual: 0, blocked: 0, warnings: [],
  };

  if (t.kind === 'recycle') {
    const { stats, left } = await cleanRecycleBin();
    result.deleted = stats.deleted;
    result.locked = stats.locked;
    if (left > 0) {
      result.message = `仍有 ${left} 项未能清空`;
      result.warnings.push(`回收站: 仍有 ${left} 项`);
    }
    return result;
  }

  if (t.kind === 'npm') {
    const { stats, error } = await cleanNpmCache();
    if (error) { result.status = 'error'; result.message = error; return result; }
    result.deleted = stats.deleted;
    result.message = '已执行 npm cache clean';
    return result;
  }

  if (t.kind === 'flushDns') {
    const r = await runCommand('ipconfig /flushdns');
    result.status = r.ok ? 'done' : 'error';
    result.message = r.ok ? '已刷新 DNS 缓存' : '刷新失败';
    return result;
  }

  const dirs = targetPaths(t);
  if (!dirs.length) { result.status = 'error'; result.message = '该清理项没有配置路径'; return result; }

  // 删除前逐项复查
  const allowed = [];
  for (const dir of dirs) {
    const reason = await checkPath(dir, { admin: !!t.admin });
    if (reason) {
      if (reason === '不存在') continue;
      result.warnings.push(`${path.basename(dir)}: ${reason}`);
      continue;
    }
    allowed.push(dir);
  }
  if (!allowed.length) {
    result.status = 'skipped';
    result.message = result.warnings.length ? result.warnings.join('；') : '目标不存在，无需清理';
    return result;
  }

  const stats = newStats();
  for (const dir of allowed) {
    if (t.kind === 'tempOld') {
      const r = await cleanTempOld(t);
      if (r.error) result.warnings.push(r.error);
      merge(stats, r.stats);
      break;
    }
    if (t.kind === 'removeDirs') {
      merge(stats, await clearDirContents(dir));
      try { await fs.promises.rmdir(dir); stats.deleted++; } catch (e) { stats.locked++; }
      continue;
    }
    merge(stats, await clearDirContents(dir, { fileFilter: t.fileFilter }));
  }

  result.deleted = stats.deleted;
  result.locked = stats.locked;
  result.freed = stats.freed;
  result.blocked = stats.blocked;

  // 清理后复查残留
  let residual = 0;
  for (const dir of allowed) {
    if (t.kind === 'removeDirs') {
      try { await fs.promises.lstat(dir); residual += 1; } catch (e) { /* 已删除 */ }
      continue;
    }
    const w = await walk(dir, { fileFilter: t.fileFilter });
    residual += w.size;
  }
  result.residual = residual;
  if (t.kind === 'removeDirs') {
    if (residual > 0) result.warnings.push('部分目录未能删除（可能被占用）');
  } else if (residual > RESIDUAL_WARN_BYTES) {
    result.warnings.push(`残留 ${(residual / 1048576).toFixed(1)} MB（文件被占用，可关闭相关程序后重试）`);
  }
  if (stats.locked > 0 && !result.warnings.length) {
    result.message = `${stats.locked} 个文件被占用，已跳过`;
  }
  return result;
}

async function cleanTargets(ids, onProgress) {
  const results = [];
  for (const id of ids) {
    if (typeof onProgress === 'function') onProgress({ id, phase: 'start' });
    let r;
    try {
      r = await cleanTarget(id);
    } catch (e) {
      r = { id, status: 'error', message: String((e && e.message) || e) };
    }
    results.push(r);
    if (typeof onProgress === 'function') onProgress({ id, phase: 'done', result: r });
  }
  return results;
}

module.exports = { cleanTarget, cleanTargets, clearDirContents, RESIDUAL_WARN_BYTES };
