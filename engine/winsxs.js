'use strict';
// 组件存储（WinSxS）顾问。所有判断都以 DISM 自己的报告为准：
// DISM 说该清才建议清，读不到就如实说读不到，绝不自己估一个「大概能省几个 G」。
const fs = require('fs');
const path = require('path');
const admin = require('./admin');
const { parseJson } = require('./ps');

const SCRIPT = path.join(__dirname, 'ps', 'winsxs.ps1');
const POLL_MS = 1200;
const CLEAN_TIMEOUT_MS = 3600000;

function gb(n) {
  if (n == null) return null;
  return (Number(n) / 1073741824).toFixed(2) + ' GB';
}

/** 秒数 → 人话。不满一分钟只报秒，免得几秒就完的事显示成「0 分钟」。纯函数。 */
function spent(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  if (s < 60) return `${Math.max(1, s)} 秒`;
  return `${Math.floor(s / 60)} 分 ${s % 60} 秒`;
}

/** DISM 报告 → 建议。纯函数，方便单测。 */
function advise(d) {
  if (!d || !d.ok) return null;
  const parts = [];
  if (d.actual != null) parts.push(`实际占用 ${gb(d.actual)}`);
  if (d.shared != null) parts.push(`与系统共享 ${gb(d.shared)}（这部分删不掉，属于正常）`);
  if (d.backups != null) parts.push(`更新备份与已禁用功能 ${gb(d.backups)}`);
  if (d.cachetemp != null) parts.push(`缓存与临时数据 ${gb(d.cachetemp)}`);
  if (d.reclaimable != null) parts.push(`可回收包数量 ${d.reclaimable}`);
  if (d.lastCleanup) parts.push(`上次清理：${d.lastCleanup}`);
  const detail = parts.join('；');

  if (d.recommended === true) {
    return { level: 'warn', title: 'DISM 建议清理组件存储', detail };
  }
  if (!d.reclaimable) {
    return { level: 'good', title: '组件存储里没有可回收的东西', detail: detail || 'DISM 报告可回收包数量为 0' };
  }
  return {
    level: 'info',
    title: 'DISM 认为不值得清理',
    detail: `可回收包数量 ${d.reclaimable}。` + (detail ? detail + '。' : '') +
      '清理要占用 CPU 和磁盘十几分钟甚至更久，换回的空间可能很小；不清完全没问题',
  };
}

/** 只读分析，但 DISM 要求管理员权限，所以会弹一次 UAC */
async function analyze() {
  const r = await runOnce({ action: 'analyze' }, 300000);
  if (r.canceled) return r;
  if (!r.data) return { ok: false, canceled: false, message: r.stderr || 'DISM 没有返回结果' };
  const d = r.data.data;
  if (!d || !d.ok) {
    if (d && d.needsAdmin) {
      return {
        ok: false, canceled: false, needsAdmin: true,
        message: 'DISM 拒绝执行（错误 740）。已经提权仍被拒绝，通常是组策略限制或精简系统去掉了组件服务；读不到就不报数字，也不猜',
      };
    }
    return { ok: false, canceled: false, message: 'DISM 的输出无法解析', raw: (d && d.raw) || '' };
  }
  return { ok: true, canceled: false, data: d, advice: advise(d), message: '' };
}

async function runOnce(payload, timeoutMs) {
  const r = await admin.runElevated(SCRIPT, payload, timeoutMs);
  if (r.canceled) {
    return { ok: false, canceled: true, message: '已取消管理员授权，没有对组件存储做任何操作' };
  }
  return { ok: r.ok, canceled: false, data: r.data, stderr: r.stderr };
}

/**
 * 执行清理。mode: 'cleanup' | 'cleanup-resetbase'
 * DISM 的进度只出现在提权进程里，所以让脚本把进度写进文件，这里轮询后转发给界面。
 */
async function cleanup(mode, confirmed, onProgress) {
  if (confirmed !== true) {
    return { ok: false, canceled: false, message: '未经确认，已拒绝清理组件存储' };
  }
  if (mode !== 'cleanup' && mode !== 'cleanup-resetbase') {
    return { ok: false, canceled: false, message: '未知的清理方式' };
  }
  const dir = admin.elevatedWorkDir();
  if (!dir) return { ok: false, canceled: false, message: '工作目录未初始化' };
  const prog = path.join(dir, `winsxs-${Date.now().toString(36)}.json`);

  let last = null;
  const timer = setInterval(() => {
    let p = null;
    try { p = parseJson(fs.readFileSync(prog, 'utf8')); } catch (e) { return; }
    if (!p) return;
    const key = `${p.percent}|${p.seconds}`;
    if (key === last) return;
    last = key;
    if (typeof onProgress === 'function') onProgress(p);
  }, POLL_MS);

  try {
    const r = await runOnce({ action: mode, progress: prog }, CLEAN_TIMEOUT_MS);
    if (r.canceled) return r;
    if (!r.data) return { ok: false, canceled: false, message: r.stderr || 'DISM 没有返回结果' };
    const d = r.data;
    if (d.ok === false) {
      const msg = d.error === 'needs-admin'
        ? 'DISM 拒绝执行（错误 740），组件存储没有任何改动'
        : `DISM 以退出码 ${d.exitCode} 结束，组件存储可能只清理了一部分`;
      return { ok: false, canceled: false, message: msg, tail: d.tail || '', seconds: d.seconds };
    }
    return {
      ok: true, canceled: false,
      message: `组件存储清理完成，用时 ${spent(d.seconds)}`,
      seconds: d.seconds, tail: d.tail || '',
    };
  } finally {
    clearInterval(timer);
    try { fs.unlinkSync(prog); } catch (e) { /* 提权进程留下的文件可能删不掉，忽略 */ }
  }
}

module.exports = { analyze, cleanup, advise, gb, spent, POLL_MS };
