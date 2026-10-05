'use strict';
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { runScript, parseJson } = require('./ps');
const hw = require('./hw');

/** 显卡优化设置表：id 为 NVAPI DRS SettingID；values 为下拉可选值（label 键由渲染层翻译） */
const SETTINGS = [
  { key: 'power', id: '0x1057EB71', default: 5, values: [
    { v: 5, label: 'optimal' },
    { v: 0, label: 'adaptive' },
    { v: 3, label: 'consistent' },
    { v: 1, label: 'max' },
    { v: 4, label: 'min' },
  ] },
  { key: 'lowLatency', id: '0x1083EFFE', values: [
    { v: 2, label: 'ultra' },
    { v: 1, label: 'on' },
    { v: 0, label: 'off' },
  ] },
  { key: 'vsync', id: '0x00A879CF', values: [
    { v: 0x08416747, label: 'off' },
    { v: 0x47814940, label: 'on' },
    { v: 0x60925292, label: 'app' },
    { v: 0x32610244, label: 'half' },
    { v: 0x71271021, label: 'third' },
    { v: 0x13245256, label: 'quarter' },
  ] },
  { key: 'prerender', id: '0x007BA09E', values: [
    { v: 0, label: 'app' },
    { v: 1, label: 'n1' }, { v: 2, label: 'n2' }, { v: 3, label: 'n3' },
    { v: 4, label: 'n4' }, { v: 5, label: 'n5' }, { v: 6, label: 'n6' },
  ] },
  { key: 'textureQuality', id: '0x00CE2691', default: 0, values: [
    { v: 0x14, label: 'highPerf' },
    { v: 0x0a, label: 'perf' },
    { v: 0x00, label: 'quality' },
    { v: 0xfffffff6, label: 'highQuality' },
  ] },
];

function run(args, timeoutMs = 60000) {
  return runScript('nvdrs.ps1', args, timeoutMs).then((r) => {
    const data = parseJson(r.stdout);
    if (data) return data;
    return { ok: false, status: 'bad-output', error: r.stderr || String(r.stdout || '').slice(0, 200) };
  });
}

let metaCache = null;

/** meta: 驱动是否支持各设置项（按 ID 名称解析结果）+ 本机显卡厂商，会话内缓存 */
async function meta() {
  if (metaCache) return metaCache;
  const [r, info] = await Promise.all([
    run(['-Action', 'meta']),
    hw.info().catch(() => null),
  ]);
  const byId = {};
  if (r && r.ok && Array.isArray(r.items)) {
    for (const it of r.items) byId[it.id] = { supported: !!it.ok, name: it.name || null };
  }
  const settings = SETTINGS.map((s) => ({
    ...s,
    supported: !!(byId[s.id] && byId[s.id].supported),
    driverName: byId[s.id] ? byId[s.id].name : null,
  }));
  metaCache = {
    available: !!(r && r.ok),
    settings,
    vendor: info ? info.vendor : null,
    adapters: info ? info.adapters : [],
  };
  return metaCache;
}

async function list() {
  const r = await run(['-Action', 'list'], 120000);
  if (!r || !r.ok) return { ok: false, error: r && (r.error || r.status) };
  return { ok: true, profiles: r.profiles || [] };
}

async function get(profileSpec, name) {
  const spec = guardProfile(profileSpec);
  if (!spec) return { ok: false, error: 'bad-profile' };
  const r = await run(['-Action', 'get', '-Profile', spec, '-ProfileName', String(name || '')]);
  if (!r || !r.ok) return { ok: false, error: r && (r.error || r.status) };
  const byId = {};
  for (const it of r.items || []) byId[it.id] = it;
  const values = {};
  for (const s of SETTINGS) {
    const it = byId[s.id];
    values[s.key] = it && it.present ? { value: it.value, predefined: !!it.predefined } : { value: null, predefined: true };
  }
  return { ok: true, profileName: r.profileName || null, values };
}

function guardProfile(p) {
  const s = String(p);
  if (s === 'global') return s;
  if (/^idx:\d{1,5}$/.test(s)) return s;
  // n:<encodeURIComponent(profileName)> —— 按方案名寻址，不依赖会话内的枚举序号
  if (/^n:[\w!~*'()\-.%]+$/i.test(s) && s.length <= 600) return s;
  return null;
}

/* ---------- 全部 3D 设置项（驱动为准，标签来自随包表） ---------- */

const COMMON_IDS = ['0x1057EB71', '0x00A879CF', '0x007BA09E', '0x00CE2691', '0x1083EFFE', '0x20C1221E', '0x101E61A9', '0x107EFC5B', '0x10D773D2', '0x0064B541', '0x20D690F8', '0x0019BB68'];

function hex8(n) {
  return '0x' + ((Number(n) >>> 0).toString(16).toUpperCase()).padStart(8, '0');
}

function normId(s) {
  const v = parseInt(String(s).replace(/^0x/i, ''), 16);
  return Number.isFinite(v) ? hex8(v) : null;
}

let labelData = null;

function labels() {
  if (labelData) return labelData;
  try {
    labelData = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'gpu3d.json'), 'utf8'));
  } catch (e) {
    labelData = { ver: 0, settings: {}, values: {} };
  }
  return labelData;
}

function catalogFile() {
  return path.join(app.getPath('userData'), 'gpu-3d-catalog.json');
}

async function driverKey() {
  try {
    const p = await hw.primary();
    return p ? p.vendor + '|' + p.driver : 'none';
  } catch (e) {
    return 'unknown';
  }
}

function shapeItem(it) {
  const id = normId(it.id);
  if (!id) return null;
  const L = labels();
  const name = String(it.name || '');
  const lab = (L.settings || {})[id] || null;
  const vmap = (L.values || {})[id] || {};
  const opts = (it.opts || []).map((c) => {
    const code = normId(c);
    return code ? { code, label: vmap[code] || null } : null;
  }).filter(Boolean);
  const def = normId(it.def);
  // 「能选才算能改」：驱动枚举出的取值里至少要有两个带核对过的名称，否则这一项不进入可写列表
  const labeled = opts.filter((o) => o.label).length;
  return {
    id,
    name: name || id,
    label: lab ? { zh: lab.zh, en: lab.en } : null,
    def,
    opts,
    editable: labeled >= 2,
    common: COMMON_IDS.indexOf(id) >= 0,
  };
}

/** 驱动暴露的全部设置项 + 每项的合法取值；按驱动版本缓存，换驱动自动失效 */
async function catalog(force) {
  const key = (await driverKey()) + '|L' + labels().ver;
  if (!force) {
    try {
      const o = JSON.parse(fs.readFileSync(catalogFile(), 'utf8'));
      if (o && o.ver === 1 && o.key === key && Array.isArray(o.items)) {
        return { ok: true, items: o.items.map(shapeItem).filter(Boolean), cached: true };
      }
    } catch (e) { /* 没有缓存就重新读驱动 */ }
  }
  const r = await run(['-Action', 'settings'], 180000);
  if (!r || !r.ok) return { ok: false, error: r && (r.error || r.status) };
  const raw = (r.items || []).filter((it) => normId(it.id));
  const items = raw.map(shapeItem).filter(Boolean);
  try {
    fs.writeFileSync(catalogFile(), JSON.stringify({ ver: 1, key, savedAt: Date.now(), items: raw }), 'utf8');
  } catch (e) {
    // 缓存只是加速，写失败不影响本次结果
  }
  return { ok: true, items };
}

/** 一次批量读取某方案下所有设置项的当前覆盖值（未覆盖的项 value 为 null） */
async function getAll(profileSpec, name) {
  const spec = guardProfile(profileSpec);
  if (!spec) return { ok: false, error: 'bad-profile' };
  const c = await catalog();
  if (!c.ok) return { ok: false, error: c.error };
  const ids = c.items.map((x) => x.id);
  if (!ids.length) return { ok: true, profileName: null, values: {} };
  const r = await run(['-Action', 'get', '-Profile', spec, '-ProfileName', String(name || ''), '-Ids', ids.join(',')], 120000);
  if (!r || !r.ok) return { ok: false, error: r && (r.error || r.status) };
  const byId = {};
  for (const it of r.items || []) {
    const id = normId(it.id);
    if (id) byId[id] = it;
  }
  const values = {};
  for (const id of ids) {
    const it = byId[id];
    values[id] = it && it.present ? { value: hex8(it.value), predefined: !!it.predefined } : { value: null, predefined: true };
  }
  return { ok: true, profileName: r.profileName || null, values };
}

async function set(profileSpec, name, idHex, value) {
  const spec = guardProfile(profileSpec);
  if (!spec) return { ok: false, error: 'bad-profile' };
  if (!/^0x[0-9A-Fa-f]{8}$/.test(String(idHex))) return { ok: false, error: 'bad-id' };
  const v = Number(value);
  if (!Number.isInteger(v) || v < 0 || v > 0xffffffff) return { ok: false, error: 'bad-value' };
  // 脚本侧按 16 进制解析 -Value，这里必须传 0x 形式，否则大取值会被写错
  const r = await run(['-Action', 'set', '-Profile', spec, '-ProfileName', String(name || ''), '-Id', String(idHex), '-Value', '0x' + (v >>> 0).toString(16)]);
  if (!r || !r.ok) return { ok: false, error: r && (r.error || r.status) };
  return { ok: true };
}

async function reset(profileSpec, name, idHex) {
  const spec = guardProfile(profileSpec);
  if (!spec) return { ok: false, error: 'bad-profile' };
  if (!/^0x[0-9A-Fa-f]{8}$/.test(String(idHex))) return { ok: false, error: 'bad-id' };
  const r = await run(['-Action', 'reset', '-Profile', spec, '-ProfileName', String(name || ''), '-Id', String(idHex)]);
  if (!r || !r.ok) return { ok: false, error: r && (r.error || r.status) };
  return { ok: true };
}

/**
 * 批量写入：一次 NVAPI 会话 + 一次保存（一键优化模式要改十几项，逐项调用太慢）。
 * pairs = [{ id, value }]，value 为 null/undefined 表示该项恢复默认。
 */
async function setMany(profileSpec, name, pairs) {
  const spec = guardProfile(profileSpec);
  if (!spec) return { ok: false, error: 'bad-profile' };
  const list = [];
  for (const p of Array.isArray(pairs) ? pairs : []) {
    if (!p || !/^0x[0-9A-Fa-f]{8}$/.test(String(p.id))) continue;
    if (p.value == null) { list.push(p.id + '=-'); continue; }
    const v = Number(p.value);
    if (!Number.isInteger(v) || v < 0 || v > 0xffffffff) continue;
    list.push(p.id + '=0x' + (v >>> 0).toString(16));
  }
  if (!list.length) return { ok: true, items: [] };
  const r = await run(['-Action', 'setMany', '-Profile', spec, '-ProfileName', String(name || ''), '-Pairs', list.join('|')], 180000);
  if (!r || !r.ok) return { ok: false, error: r && (r.error || r.status) };
  return { ok: true, items: r.items || [] };
}

const CACHE_TTL_MS = 6 * 3600 * 1000;

function cacheFile() {
  return path.join(app.getPath('userData'), 'gpu-programs.json');
}

function readCache() {
  try {
    const o = JSON.parse(fs.readFileSync(cacheFile(), 'utf8'));
    return o && o.ver === 2 && Array.isArray(o.items) ? o : null;
  } catch (e) {
    return null;
  }
}

function writeCache(items, stats) {
  try {
    fs.writeFileSync(cacheFile(), JSON.stringify({ ver: 2, savedAt: Date.now(), items, stats: stats || null }), 'utf8');
  } catch (e) {
    // 缓存只是加速，写失败不影响本次结果
  }
}

function baseName(p) {
  const s = String(p || '');
  const leaf = s.split(/[\\/]/).pop() || s;
  return leaf.replace(/\.exe$/i, '');
}

/** 驱动里存的是正斜杠路径（d:/qq/qq.exe），落盘校验前统一成反斜杠 */
function fileExists(p) {
  const s = String(p || '');
  if (!s || s.length > 512 || /[\r\n]/.test(s)) return false;
  try {
    return fs.existsSync(s.replace(/\//g, path.sep));
  } catch (e) {
    return false;
  }
}

function iconCacheFile() {
  return path.join(app.getPath('userData'), 'gpu-icons.json');
}

function readIconCache() {
  try {
    const o = JSON.parse(fs.readFileSync(iconCacheFile(), 'utf8'));
    return o && o.map && typeof o.map === 'object' ? o.map : {};
  } catch (e) {
    return {};
  }
}

/** 程序图标：随包 PowerShell 用 ExtractIconEx 取 32x32 PNG，按 exe 路径 + 修改时间缓存在 userData */
async function icons(paths) {
  const list = [];
  for (const raw of Array.isArray(paths) ? paths : []) {
    const p = String(raw || '');
    if (p && p.length <= 512 && !/[\r\n|]/.test(p) && !list.includes(p)) list.push(p);
    if (list.length >= 200) break;
  }
  const cache = readIconCache();
  const map = {};
  const need = [];
  for (const p of list) {
    const key = p.toLowerCase();
    let stamp = 0;
    try {
      const st = fs.statSync(p.replace(/\//g, path.sep));
      stamp = Math.round(st.mtimeMs) + ':' + st.size;
    } catch (e) {
      map[key] = null;
      continue;
    }
    const hit = cache[key];
    if (hit && hit.stamp === stamp) map[key] = hit.png || null;
    else need.push(p);
  }
  if (need.length) {
    const r = await run(['-Action', 'icons', '-Paths', need.join('|')], 120000);
    if (!r || !r.ok) return { ok: false, error: r && (r.error || r.status), icons: map };
    for (const it of r.icons || []) {
      const key = String(it.path || '').toLowerCase();
      const png = it.png || null;
      let stamp = 'gone';
      try {
        const st = fs.statSync(key.replace(/\//g, path.sep));
        stamp = Math.round(st.mtimeMs) + ':' + st.size;
      } catch (e) { /* 文件已不存在 */ }
      cache[key] = { stamp, png };
      map[key] = png;
    }
    try {
      const keys = Object.keys(cache);
      if (keys.length > 600) for (const k of keys.slice(0, keys.length - 600)) delete cache[k];
      fs.writeFileSync(iconCacheFile(), JSON.stringify({ map: cache }), 'utf8');
    } catch (e) {
      // 图标缓存写不下不影响功能，下次重新提取
    }
  }
  return { ok: true, icons: map };
}

function normalizeHits(hits) {
  const out = [];
  const seen = new Set();
  for (const h of hits || []) {
    if (!h || typeof h.name !== 'string' || !h.name) continue;
    if (seen.has(h.name)) continue;
    seen.add(h.name);
    const first = (h.matched || [])[0] || {};
    const appEntry = first.app || h.name;
    const exe = String(first.exe || first.app || h.name);
    out.push({
      name: h.name,
      spec: 'n:' + encodeURIComponent(h.name),
      index: Number.isFinite(h.index) ? h.index : null,
      isPredefined: !!h.isPredefined,
      numSettings: Number(h.numSettings) || 0,
      appEntry: String(appEntry),
      exe,
      exists: fileExists(exe),
      label: h.isPredefined ? h.name : baseName(appEntry) || h.name,
    });
  }
  const rank = (x) => (x.isPredefined ? 2 : x.exists ? 1 : 3);
  out.sort((a, b) => rank(a) - rank(b) || String(a.label).localeCompare(String(b.label)));
  return out;
}

/**
 * 本机确实装了的驱动方案（全局方案由渲染层固定显示）。
 * 首轮扫描磁盘 + 遍历 8000 个内置方案约 3 秒，结果缓存 6 小时。
 */
async function installed(force) {
  if (!force) {
    const c = readCache();
    if (c && Date.now() - Number(c.savedAt || 0) < CACHE_TTL_MS) {
      return { ok: true, items: c.items, cached: true, savedAt: Number(c.savedAt || 0) };
    }
  }
  const r = await run(['-Action', 'installed'], 180000);
  if (!r || !r.ok) {
    const c = readCache();
    if (c) return { ok: true, items: c.items, cached: true, stale: true, savedAt: Number(c.savedAt || 0) };
    return { ok: false, error: r && (r.error || r.status) };
  }
  const items = normalizeHits(r.hits);
  const stats = { walked: r.walked, indexSize: r.indexSize, dirsVisited: r.dirsVisited };
  writeCache(items, stats);
  return { ok: true, items, cached: false, savedAt: Date.now(), stats };
}

/** 为选中的 exe 建立/复用个人驱动方案（写入驱动配置库，仅在用户确认后调用） */
async function addApp(exePath) {
  const p = String(exePath || '');
  if (!p || p.length > 512 || /[\r\n]/.test(p) || !/\.exe$/i.test(p)) return { ok: false, error: 'bad-path' };
  const r = await run(['-Action', 'addApp', '-ExePath', p], 120000);
  if (!r || !r.ok) return { ok: false, error: r && (r.error || r.status) };
  const name = String(r.profileName || p.toLowerCase());
  const item = {
    name,
    spec: 'n:' + encodeURIComponent(name),
    index: null,
    isPredefined: false,
    numSettings: 0,
    appEntry: p,
    exe: p,
    label: baseName(p) || name,
  };
  const c = readCache();
  const items = (c && c.items ? c.items : []).filter((x) => x && x.name !== name);
  items.unshift(item);
  items.sort((a, b) => (a.isPredefined === b.isPredefined ? String(a.label).localeCompare(String(b.label)) : a.isPredefined ? 1 : -1));
  writeCache(items, c && c.stats);
  return { ok: true, item, existed: !!r.existed };
}

/** 删除用户自建方案（驱动内置方案由脚本层拒绝），同样只走确认后的调用 */
async function delProfile(profileSpec, name) {
  const spec = guardProfile(profileSpec);
  if (!spec || spec === 'global') return { ok: false, error: 'bad-profile' };
  const r = await run(['-Action', 'delProfile', '-Profile', spec, '-ProfileName', String(name || '')]);
  if (!r || !r.ok) return { ok: false, error: r && (r.error || r.status) };
  const c = readCache() || {};
  const drop = String(name || r.profileName || '');
  writeCache((c.items || []).filter((x) => x && x.name !== drop), c.stats);
  return { ok: true };
}

module.exports = { SETTINGS, meta, list, get, getAll, catalog, set, setMany, reset, installed, addApp, delProfile, icons, labelTable: labels };
