'use strict';
// 一键优化模式：三档预设，把电源计划 + 系统游戏开关 + N 卡全局 3D 设置一次改到位。
// 只改档位里列出的项，其余一律不动；执行前把原值整份快照到 userData，可随时「还原到优化前」。
// N 卡项按本机驱动能力过滤：驱动没列出该设置项或没列出该取值的，跳过并在确认清单里说明。
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const power = require('./power');
const game = require('./game');
const gpu = require('./gpu');

const ORDER = ['balanced', 'quality', 'esports'];

const TIERS = {
  balanced: {
    power: 'ultimate',
    game: { gamedvr: 'off', gamemode: 'on' },
    gpu: [
      { id: '0x1057EB71', value: 0x1 },          // 电源管理模式 = 最高性能优先
      { id: '0x20C1221E', value: 0x1 },          // 线程优化 = 开
      { id: '0x00A879CF', value: 0x08416747 },   // 垂直同步 = 关
      { id: '0x00CE2691', value: 0x0 },          // 纹理过滤 - 质量 = 质量
    ],
  },
  quality: {
    power: 'ultimate',
    game: { hags: 'on', gamedvr: 'off', transparency: 'on', visualfx: 1 },
    gpu: [
      { id: '0x107EFC5B', value: 0x1 },          // 抗锯齿 - 模式 = 由应用程序控制
      { id: '0x10D773D2', value: 0x100000 },     // 抗锯齿 - 设置 = 由应用程序控制
      { id: '0x101E61A9', value: 0x100000 },     // 各向异性过滤 = 应用程序控制的
      { id: '0x00CE2691', value: 0xfffffff6 },   // 纹理过滤 - 质量 = 高质量
      { id: '0x20D690F8', value: 0x2 },          // 现行方法 = 自动
      { id: '0x20C1221E', value: 0x1 },          // 线程优化 = 开
      { id: '0x1057EB71', value: 0x1 },          // 电源管理模式 = 最高性能优先
      { id: '0x00A879CF', value: 0x08416747 },   // 垂直同步 = 关
    ],
  },
  esports: {
    power: 'ultimate',
    game: { hags: 'on', gamedvr: 'off', gamebar: 'off', gamemode: 'off', transparency: 'off', visualfx: 2 },
    gpu: [
      { id: '0x1057EB71', value: 0x1 },          // 电源管理模式 = 最高性能优先
      { id: '0x20D690F8', value: 0x0 },          // 现行方法 = 优先本机
      { id: '0x20C1221E', value: 0x1 },          // 线程优化 = 开
      { id: '0x00CE2691', value: 0x14 },         // 纹理过滤 - 质量 = 高性能
      { id: '0x101E61A9', value: 0x1 },          // 各向异性过滤 = 关
      { id: '0x107EFC5B', value: 0x3 },          // 抗锯齿 - 模式 = 关
      { id: '0x10D773D2', value: 0x0 },          // 抗锯齿 - 设置 = 无
      { id: '0x0064B541', value: 0x1 },          // 首选刷新率 = 最高可用
      { id: '0x007BA09E', value: 0x1 },          // 最大预渲染帧数 = 1
      { id: '0x00A879CF', value: 0x08416747 },   // 垂直同步 = 关
      { id: '0x1083EFFE', value: 0x2 },          // 低延迟模式 = 超高
      { id: '0x1074C972', value: 0x0 },          // 抗锯齿 - FXAA = 关
      { id: '0x107D639D', value: 0x1 },          // 抗锯齿 - 灰度校正 = 开
      { id: '0x002ECAF2', value: 0x0 },          // 纹理过滤 - 三线性优化 = 开
      { id: '0x00E73211', value: 0x0 },          // 纹理过滤 - 各向异性采样优化 = 开
      { id: '0x0019BB68', value: 0x1 },          // 纹理过滤 - 负 LOD 偏移 = 锁定
    ],
  },
};

function hex8(n) {
  return ((Number(n) >>> 0).toString(16).toUpperCase()).padStart(8, '0');
}

function normId(s) {
  const v = parseInt(String(s).replace(/^0x/i, ''), 16);
  return Number.isFinite(v) ? '0x' + hex8(v) : null;
}

function snapFile() {
  return path.join(app.getPath('userData'), 'tier-snapshot.json');
}

function readSnap() {
  try {
    const o = JSON.parse(fs.readFileSync(snapFile(), 'utf8'));
    return o && o.ver === 1 ? o : null;
  } catch (e) {
    return null;
  }
}

function writeSnap(s) {
  try { fs.writeFileSync(snapFile(), JSON.stringify(s), 'utf8'); return true; } catch (e) { return false; }
}

function clearSnap() {
  try { fs.unlinkSync(snapFile()); } catch (e) { /* 本来就没有 */ }
}

function nameLabel(id) {
  const L = gpu.labelTable();
  const s = (L.settings || {})[id];
  return s ? { zh: s.zh, en: s.en } : null;
}

function valueLabel(id, value) {
  const L = gpu.labelTable();
  const m = (L.values || {})[id] || {};
  const v = m['0x' + hex8(value)];
  return v ? { zh: v.zh, en: v.en } : null;
}

/** 只读预览：每一项都算出「当前值 → 目标值」，驱动不支持的标成 skip */
async function preview(key) {
  const T = TIERS[key];
  if (!T) return { ok: false, message: '未知档位：' + String(key || '') };

  const [pw, cat, cur, gr] = await Promise.all([
    power.status().catch((e) => ({ ok: false, message: String(e && e.message || e) })),
    gpu.catalog().catch((e) => ({ ok: false, error: String(e && e.message || e) })),
    gpu.getAll('global', '').catch((e) => ({ ok: false, error: String(e && e.message || e) })),
    game.readRaw().catch((e) => ({ ok: false, message: String(e && e.message || e) })),
  ]);

  const out = { ok: true, tier: key, power: null, game: [], gpu: [], changes: 0, skips: 0, errors: [] };

  if (pw && pw.ok) {
    const target = pw.targets[T.power] || {};
    const activeGuid = pw.active ? pw.active.guid : null;
    const targetGuid = target.guid || null;
    const status = !target.present && !target.creatable ? 'unavailable'
      : activeGuid && targetGuid && activeGuid === targetGuid ? 'same' : 'change';
    out.power = {
      key: T.power,
      currentGuid: activeGuid,
      currentName: pw.active ? pw.active.name : null,
      targetName: target.name || null,
      status,
    };
    if (status === 'change') out.changes++;
    if (status === 'unavailable') out.skips++;
  } else {
    out.power = { key: T.power, status: 'unknown' };
    out.errors.push('power: ' + ((pw && pw.message) || '读取失败'));
  }

  if (gr && gr.ok) {
    for (const id of Object.keys(T.game)) {
      const sw = game.SWITCHES.filter((s) => s.id === id)[0];
      if (!sw) continue;
      const mode = T.game[id];
      const current = game.derive(sw, gr.values);
      const same = game.already(sw, mode, gr.values);
      out.game.push({ id, kind: sw.kind, mode, current, admin: game.needsAdmin(sw), reboot: !!sw.reboot, status: same ? 'same' : 'change' });
      if (!same) out.changes++;
    }
  } else {
    out.errors.push('game: ' + ((gr && gr.message) || '读取失败'));
  }

  if (cat && cat.ok && cur && cur.ok) {
    const byId = {};
    for (const it of cat.items) byId[it.id] = it;
    for (const item of T.gpu) {
      const id = normId(item.id);
      const set = byId[id];
      const raw = (cur.values || {})[id] || {};
      const curVal = raw.value == null ? null : normId(raw.value);
      const base = {
        id,
        value: item.value,
        name: nameLabel(id) || { zh: set ? set.name : id, en: set ? set.name : id },
        targetLabel: valueLabel(id, item.value),
        current: curVal,
        currentLabel: curVal == null ? null : valueLabel(id, curVal),
      };
      if (!set) {
        out.gpu.push(Object.assign(base, { status: 'skip', reason: 'no-setting' }));
        out.skips++;
        continue;
      }
      const codes = (set.opts || []).map((o) => o.code);
      if (codes.indexOf('0x' + hex8(item.value)) < 0) {
        // 取值没被驱动列出，但如果当前值已经等于目标，就不算失败
        if (curVal === '0x' + hex8(item.value)) {
          out.gpu.push(Object.assign(base, { status: 'same' }));
          continue;
        }
        out.gpu.push(Object.assign(base, { status: 'skip', reason: 'no-value' }));
        out.skips++;
        continue;
      }
      const same = curVal === '0x' + hex8(item.value);
      out.gpu.push(Object.assign(base, { status: same ? 'same' : 'change' }));
      if (!same) out.changes++;
    }
  } else {
    out.errors.push('gpu: ' + ((cat && cat.error) || (cur && cur.error) || '读取失败'));
  }

  const snap = readSnap();
  out.snapshot = !!snap;
  out.snapshotAt = snap ? snap.at : null;
  return out;
}

/**
 * 执行一档：先存快照（只在第一次存，保证「还原」回到最初状态），再依次改电源 / 系统开关 / N 卡。
 * opts.skipPower 用于体检里的「重新应用被改回的项」：那里只列了开关和 N 卡，
 * 电源计划不在检测范围，就绝不能被顺手改掉。
 */
async function apply(key, confirmed, opts) {
  const o = opts || {};
  if (confirmed !== true) return { ok: false, message: '未经确认，已拒绝修改' };
  const T = TIERS[key];
  if (!T) return { ok: false, message: '未知档位：' + String(key || '') };
  const p = await preview(key);
  if (!p.ok) return p;
  const pending = (o.skipPower || !p.power ? 0 : (p.power.status === 'change' ? 1 : 0))
    + (p.game || []).filter((g) => g.status === 'change').length
    + (p.gpu || []).filter((g) => g.status === 'change').length;
  if (!pending) return { ok: true, unchanged: true, preview: p };

  if (!readSnap()) {
    const gr = await game.readRaw().catch(() => ({ ok: false }));
    const cur = await gpu.getAll('global', '').catch(() => ({ ok: false }));
    const snap = {
      ver: 1,
      at: Date.now(),
      tier: key,
      power: { guid: p.power && p.power.currentGuid ? p.power.currentGuid : null },
      game: {},
      gpu: {},
    };
    if (gr && gr.ok) {
      for (const id of Object.keys(T.game)) {
        const sw = game.SWITCHES.filter((s) => s.id === id)[0];
        if (!sw) continue;
        snap.game[id] = sw.items.map((it) => {
          const r = gr.values[it.rid] || {};
          return { rid: it.rid, exists: !!r.exists, value: r.value == null ? null : r.value };
        });
      }
      game.backupSwitches(gr.values, Object.keys(T.game));
    }
    if (cur && cur.ok) {
      for (const item of p.gpu) {
        if (item.status !== 'change') continue;
        snap.gpu[item.id] = { value: item.current };
      }
    }
    writeSnap(snap);
  }

  const result = { ok: true, tier: key, power: null, game: null, gpu: null, errors: [] };

  if (!o.skipPower && p.power && p.power.status === 'change') {
    const r = await power.apply(T.power, true);
    result.power = { ok: !!r.ok, unchanged: !!r.unchanged, message: r.message || '' };
    if (!r.ok) result.errors.push('power: ' + r.message);
  }

  const gameItems = p.game.filter((g) => g.status === 'change');
  if (gameItems.length) {
    const ops = [];
    for (const g of gameItems) {
      const sw = game.SWITCHES.filter((s) => s.id === g.id)[0];
      for (const o of game.opsFor(sw, g.mode) || []) ops.push(o);
    }
    const r = await game.applyOps(ops);
    result.game = { ok: !!r.ok, canceled: !!r.canceled, message: r.message || '', count: gameItems.length };
    if (r.canceled) result.errors.push('game: 已取消管理员授权');
    else if (!r.ok) result.errors.push('game: ' + r.message);
  }

  const pairs = p.gpu.filter((g) => g.status === 'change').map((g) => ({ id: g.id, value: g.value }));
  if (pairs.length) {
    const r = await gpu.setMany('global', '', pairs);
    const failed = (r.items || []).filter((x) => !x.ok);
    result.gpu = {
      ok: !!r.ok && !failed.length,
      count: pairs.length,
      failed: failed.map((x) => x.id + '(' + x.status + ')'),
      message: r.error || '',
    };
    if (!result.gpu.ok) result.errors.push('gpu: ' + (failed.map((x) => x.id + ' 状态 ' + x.status).join('；') || r.error));
  }

  result.ok = !result.errors.length;
  result.preview = await preview(key).catch(() => null);
  return result;
}

/** 还原到优化前：按快照逐项回写，N 卡原来没覆盖的项恢复驱动默认 */
async function restore(confirmed) {
  if (confirmed !== true) return { ok: false, message: '未经确认，已拒绝修改' };
  const snap = readSnap();
  if (!snap) return { ok: false, message: '还没有优化前的快照，无需还原' };
  const errors = [];

  const pairs = Object.keys(snap.gpu || {}).map((id) => ({
    id,
    value: snap.gpu[id] && snap.gpu[id].value != null ? parseInt(String(snap.gpu[id].value).replace(/^0x/i, ''), 16) : null,
  }));
  if (pairs.length) {
    const r = await gpu.setMany('global', '', pairs);
    const failed = (r.items || []).filter((x) => !x.ok);
    if (!r.ok || failed.length) errors.push('N 卡设置：' + (failed.map((x) => x.id + ' 状态 ' + x.status).join('；') || r.error));
  }

  const ops = [];
  for (const id of Object.keys(snap.game || {})) {
    for (const v of snap.game[id] || []) ops.push(v.exists ? { id: v.rid, op: 'set', value: v.value } : { id: v.rid, op: 'del' });
  }
  if (ops.length) {
    const r = await game.applyOps(ops);
    if (r.canceled) errors.push('系统开关：已取消管理员授权');
    else if (!r.ok) errors.push('系统开关：' + r.message);
  }

  if (snap.power && snap.power.guid) {
    const r = await power.applyGuid(snap.power.guid, true);
    if (!r.ok) errors.push('电源计划：' + r.message);
  }

  if (errors.length) return { ok: false, message: errors.join('；'), partial: true };
  clearSnap();
  return { ok: true, restored: { gpu: pairs.length, game: Object.keys(snap.game || {}).length, power: !!(snap.power && snap.power.guid) } };
}

function info() {
  const snap = readSnap();
  return { ok: true, order: ORDER, snapshot: !!snap, snapshotAt: snap ? snap.at : null, snapshotTier: snap ? snap.tier : null };
}

module.exports = { ORDER, TIERS, preview, apply, restore, info };
