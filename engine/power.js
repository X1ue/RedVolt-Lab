'use strict';
// 电源计划：只调用系统自带 powercfg。读 = /list + /getactivescheme；写 = /setactive（必要时先 /duplicatescheme 建模板）。
// 三档目标用微软固定 GUID 定位；GUID 不在列表里时按名称兜底（AtlasOS 等改版系统会把方案改名/重建）。
// applyGuid() 另外支持切到本机任意方案：用户自建的、改版系统自带的都行，只认 powercfg /list 里真实存在的 GUID。
const { runCommand } = require('./ps');

const GUID_RE = /GUID:\s*([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\s*(?:\(([^)]*)\))?\s*(\*)?/;

const TARGETS = {
  balanced: {
    guid: '381b4222-f694-41f0-9685-ff5bb260df2e',
    names: ['平衡', 'balanced', '标准'],
  },
  high: {
    guid: '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c',
    names: ['高性能', 'high performance'],
  },
  ultimate: {
    guid: 'e9a42b02-d5df-448d-aa00-03f14749eb61',
    names: ['卓越性能', 'ultimate performance', 'ultimate'],
  },
};

const CMD_PREFIX = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ';

function norm(s) {
  return String(s || '').toLowerCase().replace(/[\s_-]+/g, '');
}

async function list() {
  const r = await runCommand(CMD_PREFIX + 'powercfg /list', 30000);
  if (r.err) return { ok: false, message: 'powercfg /list 失败：' + (r.stderr || r.err.message || ''), schemes: [] };
  const schemes = [];
  for (const line of String(r.stdout).split(/\r?\n/)) {
    const m = GUID_RE.exec(line);
    if (!m) continue;
    schemes.push({ guid: m[1].toLowerCase(), name: (m[2] || '').trim(), active: m[3] === '*' });
  }
  if (!schemes.length) return { ok: false, message: 'powercfg /list 没有返回任何方案', schemes: [] };
  let active = schemes.find((s) => s.active) || null;
  if (!active) {
    const a = await runCommand(CMD_PREFIX + 'powercfg /getactivescheme', 30000);
    const m = a.ok ? GUID_RE.exec(a.stdout) : null;
    if (m) active = schemes.find((s) => s.guid === m[1].toLowerCase()) || null;
  }
  return { ok: true, schemes, active };
}

function findByTarget(schemes, key) {
  const t = TARGETS[key];
  if (!t) return null;
  const byGuid = schemes.find((s) => s.guid === t.guid);
  if (byGuid) return { scheme: byGuid, how: 'guid' };
  const byName = schemes.find((s) => t.names.some((n) => norm(s.name) === norm(n)));
  if (byName) return { scheme: byName, how: 'name' };
  return null;
}

/** 三档在本机的可用性：已有（GUID/同名）或可创建（系统库里还有模板） */
async function status() {
  const l = await list();
  if (!l.ok) return l;
  const targets = {};
  for (const key of Object.keys(TARGETS)) {
    const found = findByTarget(l.schemes, key);
    if (found) {
      targets[key] = { present: true, how: found.how, guid: found.scheme.guid, name: found.scheme.name };
      continue;
    }
    const q = await runCommand(CMD_PREFIX + 'powercfg /query ' + TARGETS[key].guid, 30000);
    targets[key] = { present: false, how: null, guid: null, name: '', creatable: !!q.ok };
  }
  return { ok: true, schemes: l.schemes, active: l.active, targets };
}

async function create(key) {
  const t = TARGETS[key];
  const r = await runCommand(CMD_PREFIX + 'powercfg /duplicatescheme ' + t.guid, 30000);
  if (r.err) return { ok: false, message: '创建方案模板失败（系统可能已移除该模板）：' + (r.stderr || '').slice(0, 200) };
  const m = GUID_RE.exec(r.stdout);
  return { ok: true, guid: m ? m[1].toLowerCase() : t.guid };
}

/** 真正下发 setactive；调用前必须已确认目标就在本机列表里 */
async function activate(guid, schemes, cur) {
  const s = await runCommand(CMD_PREFIX + 'powercfg /setactive ' + guid, 30000);
  if (s.err) return { ok: false, message: '切换失败：' + (s.stderr || s.err.message || '').slice(0, 200), schemes, active: cur };
  const after = await list();
  const now = after.ok ? after.active : null;
  const ok = !!now && now.guid === guid;
  return {
    ok,
    schemes: after.ok ? after.schemes : schemes,
    active: now || cur,
    before: cur,
    target: (after.ok ? after.schemes : schemes).find((x) => x.guid === guid) || null,
    message: ok ? '' : '命令已执行但活动计划未变化，可能需要管理员权限',
  };
}

/** key: balanced | high | ultimate；confirmed 必须由 IPC 层传入 true */
async function apply(key, confirmed) {
  if (confirmed !== true) return { ok: false, message: '未经确认，已拒绝修改' };
  if (!TARGETS[key]) return { ok: false, message: '未知的电源档位：' + key };
  const before = await status();
  if (!before.ok) return before;
  const cur = before.active;
  let found = findByTarget(before.schemes, key);
  let createdGuid = null;
  if (!found) {
    if (!before.targets[key].creatable) {
      return { ok: false, message: '本机系统库里没有该方案模板（改版系统常移除），无法创建', schemes: before.schemes, active: cur };
    }
    const c = await create(key);
    if (!c.ok) return { ok: false, message: c.message, schemes: before.schemes, active: cur };
    createdGuid = c.guid;
    const again = await list();
    if (!again.ok) return again;
    const made = again.schemes.find((s) => s.guid === createdGuid) || findByTarget(again.schemes, key);
    found = made && made.scheme ? made : made ? { scheme: made, how: 'created' } : null;
    if (!found) return { ok: false, message: '方案已创建但未能在列表中找到', schemes: again.schemes, active: again.active };
  }
  if (cur && cur.guid === found.scheme.guid) {
    return { ok: true, unchanged: true, schemes: before.schemes, active: cur, target: found.scheme };
  }
  const r = await activate(found.scheme.guid, before.schemes, cur);
  if (createdGuid) r.created = createdGuid;
  return r;
}

/** 切换到本机已有的任意方案（用户自建 / 改版系统自带，如 AtlasOS）；GUID 必须出现在 powercfg /list 里 */
async function applyGuid(guid, confirmed) {
  if (confirmed !== true) return { ok: false, message: '未经确认，已拒绝修改' };
  const g = String(guid || '').trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(g)) {
    return { ok: false, message: '无效的方案 GUID：' + String(guid || '') };
  }
  const before = await list();
  if (!before.ok) return before;
  const scheme = before.schemes.find((s) => s.guid === g);
  if (!scheme) return { ok: false, message: '本机方案列表里没有该计划（可能已被删除）', schemes: before.schemes, active: before.active };
  if (before.active && before.active.guid === g) {
    return { ok: true, unchanged: true, schemes: before.schemes, active: before.active, target: scheme };
  }
  return await activate(g, before.schemes, before.active);
}

module.exports = { list, status, apply, applyGuid, TARGETS };
