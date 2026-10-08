'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { parseJson } = require('./ps');

let workDir = null;
const elevatedDir = path.join('C:\\ProgramData', 'RedVolt Lab', 'ipc');

function init(userDataPath) {
  workDir = path.join(userDataPath, 'ipc');
  fs.mkdirSync(workDir, { recursive: true });
  return workDir;
}

function token() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function secureToken() {
  return crypto.randomBytes(16).toString('hex');
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
  const t = secureToken();
  const outPath = path.join(elevatedDir, `out-${t}.json`);
  const payloadJson = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  if (payloadJson.length > 9000) {
    return { ok: false, canceled: false, data: null, stderr: '提权参数过大，已拒绝执行' };
  }

  // 参数直接编码进进程命令行，不落入用户可写的 userData 临时文件。
  // 路径必须带双引号：Start-Process 把 -ArgumentList 这个字符串原样交给进程，
  // 而安装目录（RedVolt Lab）和开发目录（RedVolt Code）都含空格，裸路径会被切成两段、提权脚本根本不执行。
  const outerScript = [
    '$ErrorActionPreference = \'Stop\'',
    `$argLine = '-NoProfile -ExecutionPolicy Bypass -File "' + ${psSingleQuoted(scriptPath)} + '" -Payload "' + ${psSingleQuoted(payloadJson)} + '" -Out "' + ${psSingleQuoted(outPath)} + '"'`,
    'try {',
    "  $p = Start-Process -FilePath 'powershell.exe' -ArgumentList $argLine -Verb RunAs -Wait -PassThru -WindowStyle Hidden",
    "  Write-Output ('EXIT=' + $p.ExitCode)",
    '} catch {',
    "  Write-Output ('ERROR=' + $_.Exception.Message)",
    '}',
  ].join('\r\n');
  const outerEncoded = Buffer.from(outerScript, 'utf16le').toString('base64');

  try {
    const r = await new Promise((resolve) => {
      execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', outerEncoded],
        { windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: timeoutMs },
        (err, stdout, stderr) => resolve({ err, stdout: stdout || '', stderr: (stderr || '').trim() }));
    });
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
    cleanup([outPath]);
  }
}

module.exports = { init, runWithPayload, runElevated, workDir: () => workDir, elevatedWorkDir: () => elevatedDir };
