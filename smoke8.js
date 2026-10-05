'use strict';
// 冒烟测试：真读旧「系统优化助手」userData，迁移到临时目录，验证只拷缺失项、幂等、不碰源目录。
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEST = path.join(os.tmpdir(), `migrate-smoke-${Date.now()}`);
fs.mkdirSync(DEST, { recursive: true });
app.setPath('userData', DEST);

const OLD = path.join(process.env.APPDATA, '系统优化助手');
if (!fs.existsSync(OLD)) {
  console.log('SKIP 源目录不存在:', OLD);
  app.quit();
  process.exit(0);
}
const before = fs.readdirSync(OLD).length;

const migrate = require('./engine/migrate');
const m1 = migrate.run();
const m2 = migrate.run(); // 第二次应被 marker 拦住，不再拷

const copied = [...m1.files, ...m1.dirs];
const destFiles = fs.readdirSync(DEST);
const srcAfter = fs.readdirSync(OLD).length;

const checks = [
  ['首次识别到旧目录', m1.from === OLD],
  ['拷到了内容', copied.length > 0],
  ['settings.json 已迁移', destFiles.includes('settings.json')],
  ['重复调用不再拷', m2.from === null && m2.files.length === 0],
  ['marker 已写入', destFiles.includes('migrated-from-legacy.json')],
  ['源目录未被改动', srcAfter === before],
  ['无异常', !m1.error],
];
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
console.log('copied:', copied.join(', ') || '(none)');
if (m1.error) console.log('error:', m1.error);
fs.rmSync(path.join(DEST, 'migrated-from-legacy.json')); // 去掉 marker，再验「已有文件不被覆盖」
fs.writeFileSync(path.join(DEST, 'settings.json'), '{"lang":"en"}');
const m3 = migrate.run();
const noOverwrite = fs.readFileSync(path.join(DEST, 'settings.json'), 'utf8') === '{"lang":"en"}' && m3.files.length === 0;
console.log(`${noOverwrite ? 'PASS' : 'FAIL'} 已有文件不被覆盖`);

process.exitCode = checks.concat([['覆盖保护', noOverwrite]]).every((c) => c[1]) ? 0 : 1;
app.quit();
