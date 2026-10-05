'use strict';

// 首启免责声明：条款文案在本地按当前语言渲染（不走 DOM i18n，避免长句片段匹配）；
// 同意状态以版本号写入 settings.eula，条款改动后提升 VERSION 即可重新弹窗。
(function () {
  const VERSION = '1.0';

  const TEXT = {
    zh: {
      title: '免责声明及使用协议',
      lead: '「RedVolt Lab」是一款 Windows PC 磁盘清理与系统优化工具。使用本软件即表示您同意以下条款：',
      sections: [
        ['1. 使用风险', '本软件通过用户级与管理员级操作清理缓存、刷新 DNS、管理开机启动项。每次执行前都会先只读扫描并展示预览，经您勾选确认后才运行，被占用的文件自动跳过。但删除类操作始终存在误删风险，重要数据请提前备份。'],
        ['2. 系统兼容性', '本软件仅支持 Windows 10 / 11 x64。部分清理目标依赖特定软件或硬件（如 Chrome/Edge、npm、NVIDIA 显卡），在不存在时会自动跳过；系统级清理需要管理员权限，会弹出 UAC 确认窗口。'],
        ['3. 数据安全', '禁用启动项前，原始注册表值与相关文件会自动备份到本机用户目录，可随时恢复。所有清理均在本机完成，不会上传任何文件内容。'],
        ['4. 隐私声明', '本软件不收集个人信息，无账号体系，不联网传输任何使用数据。仅「检查更新」会访问 GitHub Releases 查询最新版本号，该请求不包含您的身份、路径或文件信息。'],
        ['5. 高风险项说明', 'NVIDIA 显卡缓存等高风险清理目标默认不勾选，仅在您手动勾选并再次确认后才可能执行清理。'],
        ['6. 免责声明', '本软件按「现状」提供，不作任何明示或默示担保。对因使用本软件导致的任何数据丢失、系统异常或其他直接/间接损失，开发者不承担责任。'],
      ],
      ack: '我已阅读并同意上述条款',
      enter: '进入软件',
      decline: '拒绝并退出',
    },
    en: {
      title: 'Disclaimer and Terms of Use',
      lead: 'RedVolt Lab is a disk-cleanup and tuning tool for Windows PCs. By using this software you agree to the following terms:',
      sections: [
        ['1. Usage risk', 'The app performs user-level and administrator-level operations such as cache cleanup, DNS flush and startup-item management. Every run starts with a read-only scan and preview, executes only items you tick and confirm, and skips locked files. Deletion always carries a risk of removing something you wanted, so back up important data first.'],
        ['2. Compatibility', 'Windows 10 / 11 x64 only. Some cleanup targets depend on specific software or hardware (Chrome/Edge, npm, an NVIDIA GPU) and are skipped automatically when absent. System-level cleanup requires administrator rights and triggers a UAC prompt.'],
        ['3. Data safety', 'Before a startup item is disabled, its original registry values and files are backed up to your user profile and can be restored. All cleanup happens locally; no file content is ever uploaded.'],
        ['4. Privacy', 'The app collects no personal information, has no accounts, and never transmits usage data. Only "Check for update" queries GitHub Releases for the latest version number; that request contains no identity, path or file information.'],
        ['5. High-risk items', 'High-risk targets such as the NVIDIA GPU cache are unchecked by default and are only cleaned after you tick them and confirm again.'],
        ['6. Disclaimer', 'The software is provided "as is" without warranties of any kind. The developer is not liable for any data loss, system issues or other direct/indirect damage caused by using it.'],
      ],
      ack: 'I have read and agree to the terms above',
      enter: 'Enter',
      decline: 'Decline and quit',
    },
  };

  let api = null;

  function render() {
    const lang = window.i18n && window.i18n.lang === 'en' ? 'en' : 'zh';
    const t = TEXT[lang];
    document.getElementById('eulaTitle').textContent = t.title;
    document.getElementById('eulaLead').textContent = t.lead;
    const body = document.getElementById('eulaBody');
    body.textContent = '';
    for (const [h, p] of t.sections) {
      const hh = document.createElement('h3');
      hh.textContent = h;
      const pp = document.createElement('p');
      pp.textContent = p;
      body.appendChild(hh);
      body.appendChild(pp);
    }
    document.getElementById('eulaAckText').textContent = t.ack;
    document.getElementById('eulaEnter').textContent = t.enter;
    document.getElementById('eulaDecline').textContent = t.decline;
  }

  async function ensure(o) {
    api = o;
    render();
    const modal = document.getElementById('eulaModal');
    let s = {};
    try { s = (await api.settingsGet()) || {}; } catch (e) { /* 读不到就当作未同意 */ }
    if (s.eula === VERSION) return;
    modal.classList.remove('hidden');
  }

  document.getElementById('eulaAck').addEventListener('change', (e) => {
    document.getElementById('eulaEnter').disabled = !e.target.checked;
  });
  document.getElementById('eulaDecline').addEventListener('click', () => {
    if (api) api.winClose();
  });
  document.getElementById('eulaEnter').addEventListener('click', async () => {
    if (!api) return;
    await api.settingsSet({ eula: VERSION });
    document.getElementById('eulaModal').classList.add('hidden');
  });

  window.eula = { VERSION, render, ensure };
})();
