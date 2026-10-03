'use strict';
const fs = require('fs');
const path = require('path');
const { getTarget, targetPaths, TEMP_AGE_DAYS } = require('./config');
const { runScript, parseJson, commandExists } = require('./ps');

const MAX_EXAMPLES = 3;

function base(t) {
  return {
    id: t.id, name: t.name, group: t.group, level: t.level, note: t.note,
    admin: !!t.admin, kind: t.kind,
    size: 0, count: 0, lastWrite: null, examples: [],
    status: 'missing', message: '',
  };
}

/** 递归统计目录：不跟随链接/junction，读不到的条目计入 locked */
async function walk(dir, opt = {}) {
  const res = { size: 0, count: 0, lastWrite: 0, examples: [], locked: 0 };
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = await fs.promises.readdir(cur, { withFileTypes: true });
    } catch (e) {
      res.locked++;
      continue;
    }
    for (const ent of entries) {
      const full = path.join(cur, ent.name);
      if (ent.isSymbolicLink()) { res.locked++; continue; }
      let st;
      try {
        st = await fs.promises.stat(full);
      } catch (e) {
        res.locked++;
        continue;
      }
      if (st.isDirectory()) { stack.push(full); continue; }
      if (opt.fileFilter && !opt.fileFilter.test(ent.name)) continue;
      res.size += st.size;
      res.count++;
      if (st.mtimeMs > res.lastWrite) res.lastWrite = st.mtimeMs;
      if (res.examples.length < MAX_EXAMPLES) res.examples.push(ent.name);
    }
  }
  return res;
}

async function pathExists(p) {
  try {
    await fs.promises.lstat(p);
    return true;
  } catch (e) {
    return false;
  }
}

async function scanDirLike(t) {
  const out = base(t);
  const dirs = targetPaths(t);
  const missing = [];
  for (const dir of dirs) {
    if (!(await pathExists(dir))) { missing.push(path.basename(dir)); continue; }
    const w = await walk(dir, { fileFilter: t.fileFilter });
    out.size += w.size;
    out.count += w.count;
    if (w.lastWrite > (out.lastWrite || 0)) out.lastWrite = w.lastWrite || null;
    for (const ex of w.examples) {
      if (out.examples.length < MAX_EXAMPLES && !out.examples.includes(ex)) out.examples.push(ex);
    }
  }
  if (out.lastWrite === 0) out.lastWrite = null;
  if (missing.length === dirs.length) {
    out.status = 'missing';
    out.message = '目录不存在';
  } else {
    out.status = 'ok';
    out.message = missing.length ? '部分目录不存在: ' + missing.join('、') : '';
  }
  return out;
}

async function scanTempOld(t) {
  const out = base(t);
  const cutoff = Date.now() - TEMP_AGE_DAYS * 86400000;
  let entries;
  try {
    entries = await fs.promises.readdir(t.path, { withFileTypes: true });
  } catch (e) {
    out.status = 'error';
    out.message = '无法读取 Temp 目录';
    return out;
  }
  for (const ent of entries) {
    const full = path.join(t.path, ent.name);
    let st;
    try {
      st = await fs.promises.stat(full);
    } catch (e) {
      continue;
    }
    if (st.mtimeMs >= cutoff) continue;
    out.count++;
    if (st.isDirectory()) {
      const w = await walk(full);
      out.size += w.size;
    } else {
      out.size += st.size;
    }
    if (st.mtimeMs > (out.lastWrite || 0)) out.lastWrite = st.mtimeMs;
    if (out.examples.length < MAX_EXAMPLES) {
      out.examples.push(st.isDirectory() ? ent.name + '（目录）' : ent.name);
    }
  }
  out.status = 'ok';
  out.message = `只统计 ${TEMP_AGE_DAYS} 天前的项`;
  return out;
}

async function scanRecycle(t) {
  const out = base(t);
  const r = await runScript('recycle.ps1');
  const data = parseJson(r.stdout);
  if (!data) {
    out.status = 'error';
    out.message = '无法读取回收站信息';
    return out;
  }
  out.count = Number(data.count) || 0;
  out.size = Number(data.size) || 0;
  out.status = 'ok';
  return out;
}

async function scanNpm(t) {
  const out = base(t);
  const hasNpm = await commandExists('npm');
  if (!hasNpm) {
    out.status = 'skip';
    out.message = '未检测到 npm';
    return out;
  }
  if (t.path && (await pathExists(t.path))) {
    const w = await walk(t.path);
    out.size = w.size;
    out.count = w.count;
    out.lastWrite = w.lastWrite || null;
    out.examples = w.examples;
    out.status = 'ok';
  } else {
    out.status = 'missing';
    out.message = 'npm 缓存目录不存在';
  }
  return out;
}

async function scanTarget(id) {
  const t = getTarget(id);
  if (!t) return { id, status: 'error', message: '未知的清理项' };
  if (t.admin) {
    const out = base(t);
    out.status = 'needs-admin';
    out.message = '需要管理员权限，点“扫描系统级项目”后查看';
    return out;
  }
  switch (t.kind) {
    case 'tempOld': return scanTempOld(t);
    case 'recycle': return scanRecycle(t);
    case 'npm': return scanNpm(t);
    case 'clearDir':
    case 'removeDirs': return scanDirLike(t);
    default: {
      const out = base(t);
      out.status = 'ok';
      out.message = '执行类操作，无需扫描';
      return out;
    }
  }
}

async function scanTargets(ids) {
  const results = [];
  for (const id of ids) {
    results.push(await scanTarget(id));
  }
  return results;
}

module.exports = { scanTarget, scanTargets, walk, pathExists, base };
