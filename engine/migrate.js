'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

// userData 目录跟着 productName 走：1.0.1 及更早是「系统优化助手」，改名后变成「RedVolt Lab」。
// 不迁移的话，升级后语言设置、EULA 同意状态、清理记录、还原快照都会凭空消失。
const OLD_APP_NAMES = ['系统优化助手', 'sys-optimizer'];

const FILES = [
  'settings.json',
  'startup-disabled.json',
  '清理记录.log',
  'gpu-3d-catalog.json',
  'gpu-programs.json',
  'gpu-icons.json',
  'game-switch-backup.json',
  'tier-snapshot.json',
];
const DIRS = ['startup-backup'];
const MARKER = 'migrated-from-legacy.json';

function appDataDir() {
  return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
}

function copyMissing(from, to) {
  if (!fs.existsSync(from) || fs.existsSync(to)) return false;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  return true;
}

function copyDirMissing(from, to) {
  if (!fs.existsSync(from)) return [];
  const got = [];
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    if (copyMissing(path.join(from, name), path.join(to, name))) got.push(name);
  }
  if (!fs.readdirSync(to).length) fs.rmSync(to, { recursive: true, force: true });
  return got;
}

/** 只在旧目录存在时执行一次，绝不覆盖新目录里已有的文件，也不删除旧目录。 */
function run() {
  const dest = app.getPath('userData');
  const result = { from: null, files: [], dirs: [] };
  try {
    if (fs.existsSync(path.join(dest, MARKER))) return result;
    const src = OLD_APP_NAMES
      .map((n) => path.join(appDataDir(), n))
      .find((d) => fs.existsSync(d) && path.resolve(d) !== path.resolve(dest));
    if (!src) return result;
    result.from = src;
    for (const f of FILES) {
      if (copyMissing(path.join(src, f), path.join(dest, f))) result.files.push(f);
    }
    for (const d of DIRS) {
      const got = copyDirMissing(path.join(src, d), path.join(dest, d));
      if (got.length) result.dirs.push(`${d}/(${got.length})`);
    }
    fs.writeFileSync(
      path.join(dest, MARKER),
      JSON.stringify({ from: src, at: new Date().toISOString(), moved: [...result.files, ...result.dirs] }, null, 2),
      'utf8'
    );
  } catch (e) {
    result.error = String((e && e.message) || e).slice(0, 200);
  }
  return result;
}

module.exports = { run };
