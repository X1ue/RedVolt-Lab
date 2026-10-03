'use strict';
const os = require('os');
const fs = require('fs');
const path = require('path');
const { runScript, parseJson } = require('./ps');
const { walk } = require('./scan');

/** 只读采集系统信息，不做任何修改 */
async function get() {
  const r = await runScript('sysinfo.ps1');
  const data = parseJson(r.stdout) || {};
  if (!Array.isArray(data.disks)) data.disks = data.disks ? [data.disks] : [];
  data.local = {
    hostname: os.hostname(),
    user: (os.userInfo() || {}).username || '',
    release: os.release(),
    platform: os.platform(),
    arch: os.arch(),
    uptimeSec: Math.round(os.uptime()),
    totalRam: os.totalmem(),
    freeRam: os.freemem(),
    cpuModels: [...new Set(os.cpus().map((c) => String(c.model).trim()))],
    cpuThreads: os.cpus().length,
    homedir: os.homedir(),
  };
  data.error = r.ok ? '' : (r.stderr || '系统信息读取失败');
  return data;
}

/** 只读统计：某目录下各一级子目录占用排行（不删除、不修改任何内容） */
async function topFolders(root, limit = 12, onProgress) {
  const target = root || os.homedir();
  let entries;
  try {
    entries = await fs.promises.readdir(target, { withFileTypes: true });
  } catch (e) {
    return { root: target, items: [], error: '无法读取该目录' };
  }
  const dirs = entries.filter((e) => e.isDirectory() && !e.isSymbolicLink());
  const items = [];
  let done = 0;
  for (const d of dirs) {
    done++;
    if (onProgress) onProgress({ done, total: dirs.length, name: d.name });
    const full = path.join(target, d.name);
    const w = await walk(full);
    items.push({ name: d.name, path: full, size: w.size, count: w.count });
  }
  items.sort((a, b) => b.size - a.size);
  return { root: target, items: items.slice(0, limit), totalScanned: dirs.length, error: '' };
}

module.exports = { get, topFolders };
