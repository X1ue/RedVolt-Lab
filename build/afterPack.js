'use strict';

const fs = require('fs');
const path = require('path');

// dxcompiler/dxil 只服务 WebGPU 与 ANGLE 计算着色器，本软件界面是纯 HTML/CSS，用不到。
// vk_swiftshader（软件渲染兜底）与 d3dcompiler_47（老显卡 ANGLE 路径）刻意保留：
// 这工具常被用在显卡驱动异常的机器上，砍掉兜底可能连窗口都画不出来。
const DROP = ['dxcompiler.dll', 'dxil.dll'];

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  let saved = 0;
  for (const name of DROP) {
    const p = path.join(context.appOutDir, name);
    try {
      saved += fs.statSync(p).size;
      fs.unlinkSync(p);
    } catch (e) {
      // 不存在就跳过（Electron 版本变动时文件名可能不同）
    }
  }
  if (saved) console.log(`  • trimmed ${(saved / 1048576).toFixed(1)} MB of unused GPU shader compilers`);
};
