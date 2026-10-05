'use strict';
const { runCommand, parseJson } = require('./ps');

/**
 * 显卡枚举（只读）：Win32_VideoController 给出每台显示适配器的名称与厂商。
 * nvidia-smi 只服务 NVIDIA，AMD / Intel 机器必须靠这里识别，否则界面会显示成「没有显卡」。
 */

const CMD =
  'Get-CimInstance -ClassName Win32_VideoController | ' +
  'Select-Object -Property Name,AdapterCompatibility,DriverVersion,CurrentRefreshRate,' +
  'CurrentHorizontalResolution,CurrentVerticalResolution,PNPDeviceID | ' +
  'ConvertTo-Json -Compress';

function vendorOf(a) {
  const s = String(a.AdapterCompatibility || '') + ' ' + String(a.PNPDeviceID || '') + ' ' + String(a.Name || '');
  const t = s.toLowerCase();
  if (t.includes('nvidia') || t.includes('geforce') || /ven_10de/.test(t)) return 'nvidia';
  if (t.includes('advanced micro') || t.includes('amd') || t.includes('radeon') || t.includes('ryzen') || /ven_1002/.test(t)) return 'amd';
  if (t.includes('intel') || t.includes('arc') || /ven_8086/.test(t)) return 'intel';
  if (t.includes('microsoft') || t.includes('basic render')) return 'basic';
  return 'other';
}

let cached = null;
let cachedAt = 0;
let inflight = null;

function probe() {
  return runCommand(CMD, 20000).then((r) => {
    const raw = r && r.stdout ? parseJson(r.stdout) : null;
    const list = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
    return list
      .filter((a) => a && a.Name)
      .map((a) => ({
        name: String(a.Name),
        vendor: vendorOf(a),
        driver: String(a.DriverVersion || ''),
        refresh: Number(a.CurrentRefreshRate) || 0,
        width: Number(a.CurrentHorizontalResolution) || 0,
        height: Number(a.CurrentVerticalResolution) || 0,
      }));
  });
}

async function adapters() {
  // 枚举失败（PowerShell 偶发抽风）时不永久缓存空结果，过一分钟再试
  if (cached && cached.length) return cached;
  if (cached && Date.now() - cachedAt < 60000) return cached;
  if (!inflight) {
    inflight = probe().then(
      (list) => {
        inflight = null;
        cached = list;
        cachedAt = Date.now();
        return list;
      },
      () => {
        inflight = null;
        cached = [];
        cachedAt = Date.now();
        return [];
      }
    );
  }
  return inflight;
}

/** 主显卡：优先独显（厂商为 nvidia/amd），否则取第一台 */
async function primary() {
  const list = await adapters();
  if (!list.length) return null;
  return list.find((a) => a.vendor === 'nvidia' || a.vendor === 'amd') || list[0];
}

async function info() {
  const list = await adapters();
  const p = await primary();
  return { adapters: list, primary: p, vendor: p ? p.vendor : null };
}

module.exports = { adapters, primary, info };
