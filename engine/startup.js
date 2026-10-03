'use strict';
const fs = require('fs');
const path = require('path');
const { runScript, parseJson } = require('./ps');
const { runWithPayload, runElevated } = require('./admin');

const MODIFY_SCRIPT = path.join(__dirname, 'ps', 'startup-modify.ps1');

let backupDir = null;
let storePath = null;

function init(userDataPath) {
  backupDir = path.join(userDataPath, 'startup-backup');
  storePath = path.join(userDataPath, 'startup-disabled.json');
  fs.mkdirSync(backupDir, { recursive: true });
  return { backupDir, storePath };
}

function itemId(it) {
  return [it.source, it.hive, it.name].join('|');
}

function loadDisabled() {
  try {
    const obj = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    return obj && typeof obj === 'object' ? obj : {};
  } catch (e) {
    return {};
  }
}

function saveDisabled(map) {
  fs.writeFileSync(storePath, JSON.stringify(map, null, 2), 'utf8');
}

/** 列出启动项：注册表 + 启动文件夹，并合并本地禁用记录 */
async function list() {
  const r = await runScript('startup-list.ps1');
  const data = parseJson(r.stdout);
  const raw = data && data.items ? (Array.isArray(data.items) ? data.items : [data.items]) : [];
  const disabled = loadDisabled();
  const map = new Map();
  for (const it of raw) {
    const id = itemId(it);
    map.set(id, { ...it, id, enabled: !disabled[id] });
  }
  // 已禁用的项不在注册表/文件夹里了，从备份记录补回列表
  for (const id of Object.keys(disabled)) {
    if (!map.has(id)) map.set(id, { ...disabled[id], id, enabled: false });
  }
  return { items: [...map.values()], backupDir, storePath, error: r.ok ? '' : (r.stderr || '读取失败') };
}

/**
 * 启用/禁用启动项。禁用前先把原值写入备份文件，注册表值删除、启动文件移动到备份目录。
 * HKLM 项需要管理员权限，会弹一次 UAC；用户拒绝则不做任何修改。
 */
async function setEnabled(id, enabled) {
  const { items } = await list();
  const it = items.find((x) => x.id === id);
  if (!it) return { ok: false, message: '找不到该启动项' };
  if (!!it.enabled === !!enabled) return { ok: true, message: '状态没有变化' };

  const disabled = loadDisabled();
  const payload = {
    action: enabled ? 'enable' : 'disable',
    backupDir,
    item: {
      source: it.source, hive: it.hive, keyPath: it.keyPath, name: it.name, command: it.command,
      backupFile: disabled[id] ? disabled[id].backupFile || '' : '',
    },
  };

  const needsAdmin = !!it.needsAdmin;
  const r = needsAdmin
    ? await runElevated(MODIFY_SCRIPT, payload, 300000)
    : await runWithPayload(MODIFY_SCRIPT, payload, 60000);

  if (r.canceled) return { ok: false, canceled: true, message: '已取消管理员授权，未做任何修改' };
  if (!r.data || r.data.ok === false) {
    return { ok: false, message: (r.data && r.data.message) || r.stderr || '操作失败' };
  }

  if (enabled) {
    delete disabled[id];
  } else {
    disabled[id] = {
      source: it.source, hive: it.hive, keyPath: it.keyPath, name: it.name, command: it.command,
      needsAdmin, disabledAt: new Date().toISOString(), backupFile: r.data.backupFile || '',
    };
  }
  saveDisabled(disabled);
  return {
    ok: true,
    message: enabled ? '已恢复该启动项' : '已禁用，原值已备份',
    backupFile: r.data.backupFile || '',
  };
}

module.exports = { init, list, setEnabled, info: () => ({ backupDir, storePath }) };
