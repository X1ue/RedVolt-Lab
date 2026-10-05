'use strict';
const os = require('os');
const { execFile } = require('child_process');
const { commandExists } = require('./ps');
const hw = require('./hw');
const gload = require('./gload');

// 只读采集实时占用：CPU 取两次采样差值，内存用 os；
// GPU 先走 nvidia-smi（约 50ms），非 N 卡再退回 Windows 自带的 GPU Engine 计数器 + WMI 显卡名。
let prev = null;
let gpuProbe = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sampleCpu() {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    const t = c.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.irq + t.idle;
  }
  return { idle, total };
}

function hasNvidiaSmi() {
  if (!gpuProbe) gpuProbe = commandExists('nvidia-smi');
  return gpuProbe;
}

function readGpu() {
  return new Promise((resolve) => {
    execFile(
      'nvidia-smi',
      ['--query-gpu=utilization.gpu,memory.used,memory.total,name', '--format=csv,noheader,nounits'],
      { windowsHide: true, timeout: 4000 },
      (err, stdout) => {
        if (err) return resolve(null);
        const line = String(stdout || '').trim().split(/\r?\n/)[0] || '';
        const p = line.split(',').map((x) => x.trim());
        if (p.length < 4) return resolve(null);
        const load = Number(p[0]);
        if (!Number.isFinite(load)) return resolve(null);
        resolve({
          name: p.slice(3).join(', '),
          load: Math.max(0, Math.min(100, load)),
          usedMiB: Number(p[1]) || 0,
          totalMiB: Number(p[2]) || 0,
        });
      }
    );
  });
}

async function readGpuNvidia() {
  const g = await readGpu();
  if (!g) return null;
  g.vendor = 'nvidia';
  return g;
}

/** nvidia-smi 不可用（A 卡 / 核显 / N 卡驱动没装 CLI）时的兜底：WMI 给名字，PDH 计数器给占用 */
async function readGpuFallback() {
  const p = await hw.primary();
  const l = await gload.read();
  if (!p && !l) return null;
  return {
    name: p ? p.name : 'GPU',
    vendor: p ? p.vendor : 'other',
    load: l ? l.load : null,
    usedMiB: 0,
    totalMiB: 0,
  };
}

async function get() {
  const a = prev || sampleCpu();
  if (!prev) await sleep(240);
  const b = sampleCpu();
  prev = b;
  const dTotal = b.total - a.total;
  const dIdle = b.idle - a.idle;
  const cpuLoad = dTotal > 0 ? ((dTotal - dIdle) / dTotal) * 100 : 0;

  const totalRam = os.totalmem();
  const freeRam = os.freemem();
  const gpu = (await hasNvidiaSmi()) ? await readGpuNvidia() : null;

  return {
    cpu: { load: Math.max(0, Math.min(100, cpuLoad)), cores: os.cpus().length },
    ram: {
      used: totalRam - freeRam,
      total: totalRam,
      load: totalRam ? ((totalRam - freeRam) / totalRam) * 100 : 0,
    },
    gpu: gpu || (await readGpuFallback()),
  };
}

module.exports = { get };
