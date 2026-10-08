'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// 渲染层只能改白名单里的键，值也逐个校验，避免把任意内容写进 userData
const ALLOWED = {
  lang: (v) => (v === 'zh' || v === 'en' ? v : null),
  // 界面主题：暗红（dark，默认）/ 亮蓝（blue）
  theme: (v) => (v === 'dark' || v === 'blue' ? v : null),
  fx: (v) => (typeof v === 'boolean' ? v : null),
  autoUpdate: (v) => (typeof v === 'boolean' ? v : null),
  // 改档位/开关前是否先建系统还原点（24 小时内已有则复用）
  autoRestorePoint: (v) => (typeof v === 'boolean' ? v : null),
  // 点 ✕（或 Alt+F4）时怎么处理；没这个键就每次询问
  closeBehavior: (v) => (v === 'hide' || v === 'quit' ? v : null),
  // 弹窗里勾了「记住我的选择」才为 true，软件设置里可重置成重新询问
  closeRemember: (v) => (typeof v === 'boolean' ? v : null),
  // 已同意的免责声明版本号；条款更新后版本号提升即可重新弹窗
  eula: (v) => (typeof v === 'string' && /^\d{1,3}\.\d{1,3}$/.test(v) ? v : null),
};

function file() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function read() {
  try {
    const o = JSON.parse(fs.readFileSync(file(), 'utf8'));
    return o && typeof o === 'object' ? o : {};
  } catch (e) {
    return {};
  }
}

function get() {
  return read();
}

function set(patch) {
  const merged = read();
  for (const k of Object.keys(patch || {})) {
    const validate = ALLOWED[k];
    if (!validate) continue;
    const v = validate(patch[k]);
    if (v === null) continue;
    merged[k] = v;
  }
  try {
    fs.writeFileSync(file(), JSON.stringify(merged, null, 2), 'utf8');
  } catch (e) {
    return merged;
  }
  return merged;
}

function unset(keys) {
  const merged = read();
  for (const k of (Array.isArray(keys) ? keys : [])) delete merged[k];
  try {
    fs.writeFileSync(file(), JSON.stringify(merged, null, 2), 'utf8');
  } catch (e) {
    return merged;
  }
  return merged;
}

module.exports = { get, set, unset };
