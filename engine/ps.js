'use strict';
const path = require('path');
const { execFile } = require('child_process');

const PS_DIR = path.join(__dirname, 'ps');

/** 运行随包 PowerShell 脚本（ASCII 脚本，中文由 JS 侧处理，避免编码问题） */
function runScript(name, args = [], timeoutMs = 120000) {
  const script = path.join(PS_DIR, name);
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args],
      { windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: timeoutMs },
      (err, stdout, stderr) => resolve({ ok: !err, stdout: stdout || '', stderr: (stderr || '').trim(), err })
    );
  });
}

/** 运行单行 PowerShell 命令 */
function runCommand(command, timeoutMs = 120000) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: timeoutMs },
      (err, stdout, stderr) => resolve({ ok: !err, stdout: stdout || '', stderr: (stderr || '').trim(), err })
    );
  });
}

/** 解析 PowerShell 输出的 JSON（容忍 BOM 与前后空白） */
function parseJson(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/^\uFEFF/, '').trim();
  if (!cleaned) return null;
  const start = cleaned.search(/[[{]/);
  if (start < 0) return null;
  try {
    return JSON.parse(cleaned.slice(start));
  } catch (e) {
    return null;
  }
}

function commandExists(cmd) {
  return new Promise((resolve) => {
    execFile('where.exe', [cmd], { windowsHide: true }, (err, stdout) => resolve(!err && !!String(stdout).trim()));
  });
}

module.exports = { PS_DIR, runScript, runCommand, parseJson, commandExists };
