'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { isProtected, startsWithBoundary } = require('./safety');
const { allowedRoots } = require('./config');

const AGE_DAYS = 30;
const MAX_CANDIDATES = 50000;
const EXAMPLES_PER_KIND = 4;
// LevelDB / 各类嵌入式库的预写日志就叫 NNNNNN.log（ESENT 用 16 位十六进制同名），是当前生效的数据库本体；
// 它的 mtime 只在被写入时才更新，「30 天没动」恰恰是低频但活着的特征，按年龄判垃圾对它反向。
const LIVE_DB_LOG = /^[\da-f]+\.log$/i;

const KINDS = {
  tmp: { label: '临时文件（.tmp / .temp）', extensions: new Set(['.tmp', '.temp']) },
  log: { label: '日志文件（.log）', extensions: new Set(['.log']) },
  dmp: { label: '崩溃转储（.dmp）', extensions: new Set(['.dmp']) },
};
const SKIP_DIRS = new Set([
  '$recycle.bin', 'system volume information', 'windowsapps', 'winsxs',
  'system32', 'syswow64', 'driverstore', 'catroot', 'catroot2',
]);

let candidates = new Map();
let currentRoots = [];
let truncatedKinds = new Set();

function categoryFor(file) {
  const ext = path.extname(file).toLowerCase();
  for (const [kind, spec] of Object.entries(KINDS)) if (spec.extensions.has(ext)) return kind;
  return null;
}

// 只有「目录名自证是日志/临时区」的 .log 才允许删：LOCALAPPDATA 里同样有应用把 .log 当业务记录存，
// 按扩展名＋年龄一刀切会连别人的账本一起删掉。.tmp / .dmp 的扩展名本身就是临时件与转储，不再加这条。
const JUNK_DIR = /^(logs?|tmp|temp|crashdumps|minidumps?)$/i;

function logInJunkDir(file, root) {
  if (JUNK_DIR.test(path.basename(root))) return true;
  const rel = path.relative(root, file);
  if (path.isAbsolute(rel)) return false;
  const dir = path.dirname(rel);
  return dir !== '.' && dir.split(path.sep).some((seg) => JUNK_DIR.test(seg));
}

// 全盘搜索结果只是报告；要真删必须落回全仓一致的允许根白名单（engine/config.js 的 allowedRoots），
// 也就是和普通清理项同一条安全边界，绝不因为「扫得到」就「删得掉」。
function isDeletable(file) {
  const kind = categoryFor(file);
  if (!kind) return false;
  if (isProtected(file)) return false;
  const root = allowedRoots.find((r) => startsWithBoundary(file, r));
  if (!root) return false;
  if (kind !== 'log') return true;
  return !LIVE_DB_LOG.test(path.basename(file)) && logInJunkDir(file, root);
}

function blankSummary() {
  return Object.fromEntries(Object.entries(KINDS).map(([id, spec]) => [id, {
    id, name: spec.label, count: 0, size: 0, deletableCount: 0, deletableSize: 0,
    examples: [], truncated: false,
  }]));
}

function snapshotId(file, st) {
  return crypto.createHash('sha256')
    .update(`${path.resolve(file).toLowerCase()}\0${st.dev}\0${st.ino}\0${st.size}\0${st.mtimeMs}`)
    .digest('hex');
}

function isWithinRoot(file, root) {
  const rel = path.relative(path.resolve(root), path.resolve(file));
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

async function scanRoots(roots, onProgress) {
  const cutoff = Date.now() - AGE_DAYS * 86400000;
  const summary = blankSummary();
  const next = new Map();
  const nextTruncated = new Set();
  const stack = [];
  const normalizedRoots = [];
  for (const root of Array.isArray(roots) ? roots : []) {
    const absolute = path.resolve(String(root));
    try {
      const st = await fs.promises.lstat(absolute);
      if (st.isDirectory() && !st.isSymbolicLink()) {
        normalizedRoots.push(absolute);
        stack.push(absolute);
      }
    } catch (_) { /* unavailable drives are skipped */ }
  }
  currentRoots = normalizedRoots;
  let visited = 0;
  let locked = 0;

  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); }
    catch (_) { locked++; continue; }
    visited++;

    for (const ent of entries) {
      if (ent.isSymbolicLink()) { locked++; continue; }
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name.toLowerCase())) stack.push(full);
        continue;
      }
      const kind = categoryFor(ent.name);
      if (!kind) continue;
      let st;
      try { st = await fs.promises.lstat(full); } catch (_) { locked++; continue; }
      if (!st.isFile() || st.isSymbolicLink() || st.nlink > 1 || st.mtimeMs >= cutoff || isProtected(full)) continue;

      const row = summary[kind];
      row.count++;
      row.size += st.size;
      if (!isDeletable(full)) continue;
      row.deletableCount++;
      row.deletableSize += st.size;
      if (row.examples.length < EXAMPLES_PER_KIND) row.examples.push(full);
      if (next.size < MAX_CANDIDATES) {
        const id = snapshotId(full, st);
        next.set(id, {
          id, kind, path: full, root: normalizedRoots.find((r) => isWithinRoot(full, r)),
          size: st.size, mtimeMs: st.mtimeMs, dev: st.dev, ino: st.ino,
        });
      } else {
        row.truncated = true;
        nextTruncated.add(kind);
      }
    }
    if (visited % 200 === 0 && typeof onProgress === 'function') {
      onProgress({ phase: 'scan', visited, matched: Object.values(summary).reduce((n, x) => n + x.count, 0) });
    }
  }

  candidates = next;
  truncatedKinds = nextTruncated;
  const rows = Object.values(summary);
  return {
    ok: true, ageDays: AGE_DAYS, roots: normalizedRoots,
    visitedDirs: visited, lockedDirs: locked,
    totalCount: rows.reduce((n, x) => n + x.count, 0),
    totalSize: rows.reduce((n, x) => n + x.size, 0),
    totalDeletable: rows.reduce((n, x) => n + x.deletableCount, 0),
    totalDeletableSize: rows.reduce((n, x) => n + x.deletableSize, 0),
    categories: rows,
    message: rows.some((x) => x.truncated)
      ? `可清理候选文件超过 ${MAX_CANDIDATES} 个；超出部分已统计但不允许批量清理，请缩小范围后再扫`
      : '',
  };
}

function getFixedDrives() {
  const command = "[IO.DriveInfo]::GetDrives() | Where-Object { $_.DriveType -eq 'Fixed' -and $_.IsReady } | ForEach-Object { $_.RootDirectory.FullName } | ConvertTo-Json -Compress";
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command],
      { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
        if (err) { resolve([]); return; }
        try {
          const parsed = JSON.parse(String(stdout || '[]').trim() || '[]');
          resolve((Array.isArray(parsed) ? parsed : [parsed]).filter((x) => typeof x === 'string' && /^[A-Za-z]:\\$/.test(x)));
        } catch (_) { resolve([]); }
      });
  });
}

async function scanAll(onProgress) {
  reset();
  const roots = await getFixedDrives();
  if (!roots.length) return { ok: false, message: '没有找到可扫描的本地固定磁盘' };
  return scanRoots(roots, onProgress);
}

function reset() {
  candidates = new Map();
  currentRoots = [];
  truncatedKinds = new Set();
}

async function clean(categories, confirmed) {
  if (confirmed !== true) return { ok: false, message: '未经确认，已拒绝执行', results: [] };
  const selected = [...new Set((Array.isArray(categories) ? categories : []).filter((x) => Object.hasOwn(KINDS, x)))];
  if (!selected.length) return { ok: false, message: '没有选择要清理的文件类别', results: [] };
  const results = selected.map((kind) => ({
    id: kind, name: KINDS[kind].label,
    count: [...candidates.values()].filter((c) => c.kind === kind).length,
    deleted: 0, freed: 0, locked: 0,
  }));
  const byKind = new Map(results.map((r) => [r.id, r]));
  if (selected.some((kind) => truncatedKinds.has(kind))) {
    return { ok: false, message: '所选类别超过安全候选上限，已拒绝批量清理', results };
  }

  const cutoff = Date.now() - AGE_DAYS * 86400000;
  for (const candidate of candidates.values()) {
    if (!byKind.has(candidate.kind)) continue;
    const result = byKind.get(candidate.kind);
    if (!candidate.root || !currentRoots.some((r) => r.toLowerCase() === candidate.root.toLowerCase()) || !isWithinRoot(candidate.path, candidate.root)) {
      result.locked++;
      continue;
    }
    try {
      const rootStat = await fs.promises.lstat(candidate.root);
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('changed root');
      let parent = path.dirname(candidate.path);
      while (isWithinRoot(parent, candidate.root)) {
        const pst = await fs.promises.lstat(parent);
        if (!pst.isDirectory() || pst.isSymbolicLink()) throw new Error('changed path');
        parent = path.dirname(parent);
      }
      const st = await fs.promises.lstat(candidate.path);
      if (!st.isFile() || st.isSymbolicLink() || st.nlink > 1 || st.size !== candidate.size || st.mtimeMs !== candidate.mtimeMs || st.dev !== candidate.dev || st.ino !== candidate.ino || st.mtimeMs >= cutoff || categoryFor(candidate.path) !== candidate.kind || !isDeletable(candidate.path)) {
        result.locked++;
        continue;
      }
      await fs.promises.unlink(candidate.path);
      result.deleted++;
      result.freed += st.size;
      candidates.delete(candidate.id);
    } catch (_) { result.locked++; }
  }
  return { ok: true, results };
}

module.exports = { AGE_DAYS, MAX_CANDIDATES, KINDS, isDeletable, scanAll, scanRoots, clean, reset };
