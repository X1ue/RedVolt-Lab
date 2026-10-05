'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// 渲染层只能改白名单里的键，值也逐个校验，避免把任意内容写进 userData
const ALLOWED = {
  lang: (v) => (v === 'zh' || v === 'en' ? v : null),
  fx: (v) => (typeof v === 'boolean' ? v : null),
  autoUpdate: (v) => (typeof v === 'boolean' ? v : null),
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

module.exports = { get, set };
