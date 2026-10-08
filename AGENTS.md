# AGENTS.md — RedVolt Lab（Electron 系统优化工具）

所有命令在仓库根目录（本文件所在目录）、Windows git-bash 下执行。

## 常用命令

- 开发运行：`npm start`
- 打包（不带镜像变量会在 winCodeSign 下载上卡满 600 秒超时）：
  `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run dist`
  同一时间只能有一个 electron-builder 写 `dist/`，禁止并行起两个构建。
- 纯逻辑单测（改 `engine/` 后必跑，全部 PASS 才算过）：`node test-engine.js`、`node test-ledger.js`、`node test-clean.js`
- 冒烟（隐藏窗口驱动真实界面，不抢用户前台，只测开发环境、绝不对他桌面安装的正式应用合成点击）：
  `npx electron smoke16.js > smoke16.log 2>&1`
  绝不把冒烟 stdout 管道给 head/tail（EPIPE 会在用户桌面弹 Electron 错误框）。新增功能批次要按现有最大编号 +1 补一个 smokeN.js。
- 交付到桌面（复制 Setup + 便携版 + latest.yml，逐字节 sha512 校验，只删严格更旧的旧版产物）：
  `node deliver.js`（`--dry` 只预演不写盘）。打包交付后必须回读交付目录核对文件名与版本号，再报完成。

## 硬性规则（用户明确拍板，违反即错误）

- 每个清理/启动项 IPC handler 必须 `confirmed === true` 才执行；流程永远是 扫描预览 → 用户确认 → 执行，绝不添加无条件删除路径。
- NVIDIA 显卡缓存只能作为单独 opt-in 选项，绝不进默认清理。
- `smoke*.js` 与 `test-*.js` 永不删除（回归网）。可清理的只有 `dist/` 旧版本产物、`*.log`、`shot-*.png` 这类可再生产物。
- 永远不要添加 `app.disableHardwareAcceleration()` 或相关提案（用户 2026-10-08 永久否决，连方案都不要再提）。
- 上传 GitHub（release、git push）必须用户当次明确开口才做；便携版 exe 永不上传，Release 只传 `RedVolt-Lab-Setup-<版本>.exe` + `latest.yml`，且先传 yml 再传 exe。
- 隐私：commit message 保持中性（版本号式）；用户的 Windows 账号名、邮箱、本机绝对路径不得出现在任何提交文件、commit message 或界面文本里。
- 除本文件外，不要再往仓库添加 .md 文档（用户习惯：仓库只放代码）。

## 打包与版本约束

- `asar` 必须保持 `false`：engine 以真实 `__dirname` 路径 spawn PowerShell 脚本，打进 asar 全断。
- 版本主线已定死按 1.2.x 递增（当前 1.2.1，下一个 1.2.2），不要恢复 test.N 后缀，也不要往 1.4.x 走。
- `.bat` 必须 GBK + CRLF、无 BOM；运行时生成的临时 `.ps1`（如提权 launcher）必须带 UTF-8 BOM，否则 PowerShell 5.1 按 ANSI 读、中文路径全坏。

## 已知环境事实（别当 bug）

- 用户这台机器 DISM 即使提权也返回 740，WinSxS 卡片走「读不到」分支是正常现象。
- 应用版本号只读 `package.json` 的 `version`；`package-lock.json` 顶层的 `1.0.0` 是陈旧残留，不要去修。
- `deliver.js` 只删「比当前版本严格更旧」的交付产物；降级发版后桌面会留下更高版本号的文件，那些在用户个人目录里，删除必须逐文件征得同意。
