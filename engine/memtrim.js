'use strict';
// 内存一键释放：只调用 EmptyWorkingSet 把后台进程的工作集交还给系统，绝不结束任何进程。
// 关键系统进程、本程序自身、以及当前前台全屏窗口（正在玩的游戏）都会被跳过。
const { runScript, parseJson } = require('./ps');

async function trim() {
  const r = await runScript('memtrim.ps1', ['-SelfPid', String(process.pid)], 180000);
  const d = parseJson(r.stdout);
  if (!d) return { ok: false, message: String(r.stderr || '内存释放脚本没有返回结果').slice(0, 200) };
  const mb = (n) => Math.max(0, Number(n || 0)) / 1048576;
  return {
    ok: d.ok !== false,
    trimmed: Number(d.trimmed) || 0,
    failed: Number(d.failed) || 0,
    skipped: Number(d.skipped) || 0,
    foregroundPid: Number(d.foregroundPid) || 0,
    beforeMB: mb(d.beforeBytes),
    afterMB: mb(d.afterBytes),
    freedMB: mb(d.freedBytes),
    freePhysMB: mb(d.freePhysBytes),
    totalPhysMB: mb(d.totalPhysBytes),
  };
}

module.exports = { trim };
