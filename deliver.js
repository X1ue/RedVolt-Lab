// 交付：把 dist 里的 Setup + 便携版 + latest.yml 复制到桌面目录，逐字节校验 sha512。
// 不用 git-bash cp（实测会把 96MB 的 exe 复制成多 772KB 且内容不同的文件）。
//
// 上传 GitHub Releases 检查清单（更新源 = .../releases/latest/download/）：
//   1. Setup exe + latest.yml 必须同一批次上传，只传 exe 不更新 yml 会让客户端去找旧文件名或校验失败。
//   2. releases/latest 只认「最新的正式版」，draft 和 prerelease 都不算 —— 带 -test.N 的版本传成
//      prerelease，已安装的客户端点「检查更新」永远显示已是最新。正式发版前把 version 改回干净号，
//      或临时用 SYSOPT_FEED_URL 指到具体 tag 的 download 地址联调。
//   3. 便携版只给手动下载，客户端会自己拒绝自更新（见 updater.blockedReason）。
//   4. *.blockmap 可不传：客户端已 disableDifferentialDownload。
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ARGS = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const DRY = process.argv.includes('--dry');
const SRC = ARGS[0] || path.join(__dirname, 'dist');
const DST = ARGS[1] || path.join(os.homedir(), 'Desktop', 'RedVolt Lab');

const yml = fs.readFileSync(path.join(SRC, 'latest.yml'), 'utf8');
const version = yml.match(/version:\s*(\S+)/)[1];
const setupSha = yml.match(/sha512:\s*(\S+)/)[1];
const setup = `RedVolt-Lab-Setup-${version}.exe`;
const portable = `RedVolt-Lab-${version}.exe`;
if (/-/.test(version)) {
  console.log(`WARN 版本号 ${version} 是预发布：以 prerelease/draft 上传时 releases/latest 不会返回它，老客户端看不到更新`);
}

const sha512 = (b) => crypto.createHash('sha512').update(b).digest('base64');

// 交付目录里的旧产物识别：只认本应用的文件名，且只删「比当前版本更旧」的，新版号绝不误删。
const ARTIFACT = /^(\._cache_)?(RedVolt[- _]Lab|SysOptimizer|系统优化助手)/i;
const fileVersion = (f) => {
  const m = f.match(/[- ](\d+\.\d+\.\d+(?:-(?:test|alpha|beta|rc)\.\d+)?)\.(?:exe(?:\.blockmap)?|blockmap)$/i);
  return m ? m[1] : null;
};
const vkey = (v) => {
  const m = String(v).match(/^(\d+)\.(\d+)\.(\d+)(?:-(?:\w+)\.(\d+))?$/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ? 0 : 1, m[4] ? Number(m[4]) : 0];
};
const isOlder = (a, b) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
};
const staleFiles = (dir, cur) => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => {
    if (!ARTIFACT.test(f)) return false;
    const v = fileVersion(f);
    const key = v && vkey(v);
    return !!key && !!cur && isOlder(key, cur);
  });
};

function put(name) {
  const from = path.join(SRC, name);
  const to = path.join(DST, name);
  const buf = fs.readFileSync(from);
  fs.writeFileSync(to, buf);
  const back = fs.readFileSync(to);
  let ok = back.length === buf.length && sha512(back) === sha512(buf);
  if (name === setup) ok = ok && sha512(buf) === setupSha; // latest.yml 只登记 Setup
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${back.length} sha512=${ok}`);
  return ok;
}

// --dry：只打印将要复制和将要删除的内容，不碰任何文件
if (DRY) {
  const cur = vkey(version);
  const missing = [setup, portable].filter((n) => !fs.existsSync(path.join(SRC, n)));
  const stale = staleFiles(DST, cur);
  console.log(`DRY RUN 版本 ${version}`);
  console.log(`源 ${SRC}：${missing.length ? '缺少 ' + missing.join(', ') : 'Setup + 便携版齐全'}`);
  console.log(`目标 ${DST}`);
  for (const f of stale) console.log('  将删除', f);
  if (!stale.length) console.log('  无旧版本需要删除');
  process.exit(missing.length ? 1 : 0);
}

if (!fs.existsSync(DST)) fs.mkdirSync(DST, { recursive: true });
const ok = put(setup) && put(portable);
fs.writeFileSync(path.join(DST, 'latest.yml'), fs.readFileSync(path.join(SRC, 'latest.yml')));
for (const f of staleFiles(DST, vkey(version))) {
  try {
    fs.unlinkSync(path.join(DST, f));
    console.log('removed', f);
  } catch (e) {
    console.log('kept (locked, 正在运行?)', f);
  }
}
console.log('desktop:', fs.readdirSync(DST).join(' | '));
process.exit(ok ? 0 : 1);
