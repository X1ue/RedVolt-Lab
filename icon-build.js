'use strict';
// 由黑底发光图生成透明多尺寸 .ico：alpha 取像素亮度（加色发光图的反预乘），小尺寸用 BGRA 位图、256 用 PNG
// --blue：不重画美术，只把已成品图标（build/icon.png）的暖色像素做色相平移，产出 icon-blue.ico
//         和 renderer/icon-blue.png（亮蓝主题用）。这条路径直接沿用源图自己的 alpha。
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const SRC = process.argv[2];
const OUT_DIR = process.argv[3] || path.join(__dirname, 'build');
if (!SRC) { console.error('usage: node icon-build.js <src.png> [outDir] [--solid] [--blue]'); process.exit(1); }

const src = PNG.sync.read(fs.readFileSync(SRC));
const BLUE = process.argv.includes('--blue');

// 1) 黑底发光图转目标底：
//    透明模式：a = max(r,g,b)，颜色反预乘
//    --solid  ：不透明黑底 squircle 正方形（超椭圆圆角，微信/iOS 式平滑过渡），4x4 超采样抗锯齿
const SOLID = process.argv.includes('--solid');
const RADIUS_RATIO = 0.28;
const SQ_EXPONENT = 4.5; // 超椭圆指数：越大越方，4~5 接近 squircle 观感
function roundRectCoverage(px, py, size, r) {
  let hits = 0;
  const step = 0.25; // 每像素 4x4 子采样
  const half = size / 2;
  for (let sy = 0; sy < 4; sy++) {
    for (let sx = 0; sx < 4; sx++) {
      const x = px + (sx + 0.5) * step;
      const y = py + (sy + 0.5) * step;
      const u = Math.abs((x - half) / half);
      const v = Math.abs((y - half) / half);
      if (Math.pow(u, SQ_EXPONENT) + Math.pow(v, SQ_EXPONENT) <= 1) hits++;
    }
  }
  return hits / 16;
}
/** 只动色相：暖色（红/橙/黄，含品红边缘）转到蓝系，白热核心、灰阶高光和暗底一律不碰。 */
function shiftWarmToBlue(buf) {
  const SHIFT = 214;                 // #ff3b3b 约 0° → #3d8bff 约 217°
  for (let i = 0; i < buf.length; i += 4) {
    const r = buf[i], g = buf[i + 1], b = buf[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (!d) continue;                // 灰阶 / 纯白纯黑
    const l = (max + min) / 510;
    const s = d / (255 - Math.abs(max + min - 255));
    if (s < 0.12) continue;
    let h;
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    h = (h + 360) % 360;
    if (h > 70 && h < 300) continue; // 已经是冷色
    const rgb = hslToRgb((h + SHIFT) % 360, s, l);
    buf[i] = rgb[0]; buf[i + 1] = rgb[1]; buf[i + 2] = rgb[2];
  }
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

const W = src.width;
const H = src.height;
const rgba = Buffer.alloc(W * H * 4);
if (BLUE) {
  src.data.copy(rgba);
  shiftWarmToBlue(rgba);
} else {
  for (let i = 0; i < W * H; i++) {
    const r0 = src.data[i * 4];
    const g = src.data[i * 4 + 1];
    const b = src.data[i * 4 + 2];
    const a = Math.max(r0, g, b);
    if (SOLID) {
      const x = i % W;
      const y = (i / W) | 0;
      const v = a < 8 ? 0 : 1;
      rgba[i * 4] = r0 * v;
      rgba[i * 4 + 1] = g * v;
      rgba[i * 4 + 2] = b * v;
      rgba[i * 4 + 3] = Math.round(roundRectCoverage(x, y, W, W * RADIUS_RATIO) * 255);
      continue;
    }
    if (a === 0) { rgba[i * 4 + 3] = 0; continue; }
    rgba[i * 4] = Math.min(255, Math.round((r0 * 255) / a));
    rgba[i * 4 + 1] = Math.min(255, Math.round((g * 255) / a));
    rgba[i * 4 + 2] = Math.min(255, Math.round((b * 255) / a));
    rgba[i * 4 + 3] = a;
  }
}

// 2) 面积平均缩放
function resize(size) {
  const out = Buffer.alloc(size * size * 4);
  const scale = W / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor(x * scale);
      const x1 = Math.max(x0 + 1, Math.ceil((x + 1) * scale));
      const y0 = Math.floor(y * scale);
      const y1 = Math.max(y0 + 1, Math.ceil((y + 1) * scale));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const j = (sy * W + sx) * 4;
          const pa = rgba[j + 3];
          // 预乘累加，避免透明黑边
          r += (rgba[j] * pa) / 255;
          g += (rgba[j + 1] * pa) / 255;
          b += (rgba[j + 2] * pa) / 255;
          a += pa;
          n++;
        }
      }
      const o = (y * size + x) * 4;
      const aa = a / n;
      out[o + 3] = Math.round(aa);
      if (aa > 0) {
        out[o] = Math.min(255, Math.round((r / n) * 255 / aa));
        out[o + 1] = Math.min(255, Math.round((g / n) * 255 / aa));
        out[o + 2] = Math.min(255, Math.round((b / n) * 255 / aa));
      }
    }
  }
  return out;
}

// 3) ICO 编码
function bmpEntry(buf, size) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // 高度翻倍（XOR + AND mask）
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) { // 自底向上 + BGRA
    for (let x = 0; x < size; x++) {
      const s = (y * size + x) * 4;
      const d = ((size - 1 - y) * size + x) * 4;
      xor[d] = buf[s + 2];
      xor[d + 1] = buf[s + 1];
      xor[d + 2] = buf[s];
      xor[d + 3] = buf[s + 3];
    }
  }
  const maskRow = Math.ceil(size / 8);
  const maskPad = (4 - (maskRow % 4)) % 4;
  const and = Buffer.alloc((maskRow + maskPad) * size); // 全 0（依赖 32 位 alpha）
  return Buffer.concat([header, xor, and]);
}

function pngEntry(buf, size) {
  const png = new PNG({ width: size, height: size });
  buf.copy(png.data);
  return PNG.sync.write(png);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const sizes = [16, 24, 32, 48, 64, 128];
const entries = [];
for (const s of sizes) entries.push({ size: s, data: bmpEntry(resize(s), s) });
entries.push({ size: 256, data: pngEntry(resize(256), 256) });

let offset = 6 + entries.length * 16;
const dir = [];
const bodies = [];
for (const e of entries) {
  const d = Buffer.alloc(16);
  d[0] = e.size >= 256 ? 0 : e.size;
  d[1] = e.size >= 256 ? 0 : e.size;
  d.writeUInt16LE(1, 4);
  d.writeUInt16LE(32, 6);
  d.writeUInt32LE(e.data.length, 8);
  d.writeUInt32LE(offset, 12);
  dir.push(d);
  bodies.push(e.data);
  offset += e.data.length;
}
const head = Buffer.alloc(6);
head.writeUInt16LE(0, 0);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(entries.length, 4);
const ico = Buffer.concat([head, ...dir, ...bodies]);
const stem = BLUE ? 'icon-blue' : 'icon';
const outPath = path.join(OUT_DIR, stem + '.ico');
const pngPath = path.join(OUT_DIR, stem + '.png');
fs.writeFileSync(outPath, ico);
fs.writeFileSync(pngPath, pngEntry(resize(256), 256));
// 界面左上角 logo 读的是 renderer 下那份，和 icon.png 的落点保持一致
if (BLUE) fs.copyFileSync(pngPath, path.join(__dirname, 'renderer', 'icon-blue.png'));
console.log('written', outPath, ico.length, 'bytes;', entries.map((e) => e.size).join('/'));
