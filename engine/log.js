'use strict';
const fs = require('fs');
const path = require('path');

let logPath = null;

function init(userDataPath) {
  logPath = path.join(userDataPath, '清理记录.log');
  return logPath;
}

function ts(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function append(text) {
  if (!logPath) return;
  try {
    fs.appendFileSync(logPath, `[${ts()}] ${text}\r\n`, 'utf8');
  } catch (e) { /* 日志失败不影响主流程 */ }
}

function readTail(maxLines = 200) {
  try {
    const lines = fs.readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean);
    return lines.slice(-maxLines).reverse();
  } catch (e) {
    return [];
  }
}

module.exports = { init, append, readTail, getPath: () => logPath };
