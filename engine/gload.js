'use strict';
const { spawn } = require('child_process');

/**
 * AMD / Intel 显卡没有厂商 CLI 可查占用，改用 Windows 自带的 GPU Engine 性能计数器
 * （与任务管理器「3D」占用同源，普通用户权限即可读）。typeperf 常驻 1 秒一次推流，
 * 空闲时自动退出，避免每次轮询都拉起进程。
 */

const COUNTER = '\\GPU Engine(*engtype_3D*)\\Utilization Percentage';
const IDLE_MS = 15000;
const FRESH_MS = 6000;

let child = null;
let cols = null;
let latest = null;
let buf = '';
let idleTimer = null;

function adapterKey(headerCell) {
  const m = /luid_0x[0-9A-Fa-f]+_0x([0-9A-Fa-f]+)_phys_(\d+)/i.exec(headerCell);
  return m ? m[1] + ':' + m[2] : headerCell;
}

function handle(line) {
  if (line.charCodeAt(0) !== 34) return;
  const cells = line.split('","').map((s) => s.replace(/^"|"$/g, ''));
  if (/PDH-CSV/i.test(cells[0])) {
    cols = cells.slice(1).map(adapterKey);
    return;
  }
  if (!cols) return;
  const sums = new Map();
  for (let i = 0; i < cols.length && i + 1 < cells.length; i++) {
    const v = Number(cells[i + 1]);
    if (!Number.isFinite(v) || v <= 0) continue;
    sums.set(cols[i], (sums.get(cols[i]) || 0) + v);
  }
  let load = 0;
  for (const v of sums.values()) {
    if (v > load) load = v;
  }
  latest = { load: Math.max(0, Math.min(100, load)), at: Date.now() };
}

function feed(chunk) {
  buf += chunk.toString('latin1');
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    handle(buf.slice(0, i).replace(/\r$/, ''));
    buf = buf.slice(i + 1);
  }
  if (buf.length > 4000000) buf = '';
}

function stop() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  cols = null;
  latest = null;
  buf = '';
  const c = child;
  child = null;
  if (c) {
    c.stdout.removeAllListeners('data');
    c.on('error', () => {});
    c.kill();
  }
}

function start() {
  if (child) return;
  try {
    child = spawn('typeperf', [COUNTER, '-si', '1'], { windowsHide: true });
  } catch (e) {
    child = null;
    return;
  }
  const c = child;
  c.stdout.on('data', feed);
  c.stderr.resume();
  c.on('error', () => {
    if (child === c) child = null;
  });
  c.on('close', () => {
    if (child === c) {
      child = null;
      cols = null;
      latest = null;
    }
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 返回 { load } 或 null（首个采样约 1~2 秒，超时后先返回 null，下次轮询即有值） */
async function read() {
  start();
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(stop, IDLE_MS);
  if (idleTimer.unref) idleTimer.unref();
  for (let i = 0; i < 20 && !latest; i++) {
    if (!child) return null;
    await sleep(150);
  }
  if (!latest || Date.now() - latest.at > FRESH_MS) return null;
  return { load: latest.load };
}

module.exports = { read, stop };
