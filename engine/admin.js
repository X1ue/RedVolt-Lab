'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { parseJson } = require('./ps');

let workDir = null;

const BOM = '\uFEFF';

function init(userDataPath) {
  workDir = path.join(userDataPath, 'ipc');
  fs.mkdirSync(workDir, { recursive: true });
  return workDir;
}

function token() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function psSingleQuoted(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

function runFile(scriptPath, args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args],
      { windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: timeoutMs },
      (err, stdout, stderr) => resolve({ err, stdout: stdout || '', stderr: (stderr || '').trim() })
    );
  });
}

function readOut(outPath, stdout) {
  try {
    const data = parseJson(fs.readFileSync(outPath, 'utf8'));
    if (data) return data;
  } catch (e) { /* 落回 stdout */ }
  return parseJson(stdout);
}

function cleanup(files) {
  for (const f of files) {
    try { fs.unlinkSync(f); } catch (e) { /* 忽略 */ }
  }
}

/** 普通权限运行带 payload 的脚本 */
async function runWithPayload(scriptPath, payload, timeoutMs = 120000) {
  if (!workDir) throw new Error('admin.init() 未调用');
  const t = token();
  const inPath = path.join(workDir, `in-${t}.json`);
  const outPath = path.join(workDir, `out-${t}.json`);
  fs.writeFileSync(inPath, JSON.stringify(payload), 'utf8');
  try {
    const r = await runFile(scriptPath, ['-Payload', inPath, '-Out', outPath], timeoutMs);
    const data = readOut(outPath, r.stdout);
    return { ok: !r.err && !!data && data.ok !== false, data, stderr: r.stderr, canceled: false };
  } finally {
    cleanup([inPath, outPath]);
  }
}

/**
 * 以管理员权限运行脚本：会弹一次 UAC。
 * 用户拒绝时返回 { canceled: true }，绝不静默失败。
 */
async function runElevated(scriptPath, payload, timeoutMs = 300000) {
  if (!workDir) throw new Error('admin.init() 未调用');
  const t = token();
  const inPath = path.join(workDir, `in-${t}.json`);
  const outPath = path.join(workDir, `out-${t}.json`);
  const launcher = path.join(workDir, `elevate-${t}.ps1`);

  fs.writeFileSync(inPath, JSON.stringify(payload), 'utf8');
  const lines = [
    '$ErrorActionPreference = \'Stop\'',
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    `$argLine = '-NoProfile -ExecutionPolicy Bypass -File "' + ${psSingleQuoted(scriptPath)} + '" -Payload "' + ${psSingleQuoted(inPath)} + '" -Out "' + ${psSingleQuoted(outPath)} + '"'`,
    'try {',
    "    $p = Start-Process -FilePath 'powershell.exe' -ArgumentList $argLine -Verb RunAs -Wait -PassThru -WindowStyle Hidden",
    "    Write-Output ('EXIT=' + $p.ExitCode)",
    '} catch {',
    "    Write-Output ('ERROR=' + $_.Exception.Message)",
    '}',
  ];
  // 必须带 UTF-8 BOM：脚本里内嵌了 userData 路径（可能含中文），
  // PowerShell 5.1 对无 BOM 文件按 ANSI 读取会把中文路径读成乱码
  fs.writeFileSync(launcher, BOM + lines.join('\r\n'), 'utf8');

  try {
    const r = await runFile(launcher, [], timeoutMs);
    const out = r.stdout;
    if (/ERROR=/.test(out)) {
      const msg = out.split('ERROR=')[1].trim();
      const canceled = /canceled by the user|操作已被用户取消|The operation was canceled/i.test(msg);
      return { ok: false, canceled, data: null, stderr: msg };
    }
    const data = readOut(outPath, '');
    if (!data) {
      const exit = /EXIT=(-?\d+)/.exec(out);
      return {
        ok: false,
        canceled: false,
        data: null,
        stderr: `提权脚本未返回结果（退出码 ${exit ? exit[1] : '未知'}）${r.stderr ? '；' + r.stderr : ''}`,
      };
    }
    return { ok: data.ok !== false, canceled: false, data, stderr: r.stderr };
  } finally {
    cleanup([inPath, outPath, launcher]);
  }
}

module.exports = { init, runWithPayload, runElevated, workDir: () => workDir };
