// 生成应用图标。只用 Node 自带模块：zlib 压缩，PNG 区块和 CRC32 手写，4×4 超采样抗锯齿。
// 用法：node tools/make-icons.mjs   （输出到 icons/）
//
// 图案：夜蓝底，右上偏中的米白月亮，月亮下方一条细细的浅蓝地平线，线以下更深的蓝。
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKY = [0x23, 0x38, 0x9c];   // #23389C
const MOON = [0xee, 0xf1, 0xfa];  // #EEF1FA
const BAND = [0x5d, 0xae, 0xe6];  // #5DAEE6
const SEA = [0x1b, 0x2e, 0x86];   // #1B2E86

// 图案参数，都以图标边长为 1
const MOON_CX = 0.64;
const MOON_CY = 0.36;
const MOON_R = 0.13;
const BAND_TOP = 0.72;
const BAND_BOTTOM = 0.735;
const CORNER = 0.22;      // 非 maskable 图标的圆角半径
const SAFE = 0.8;         // maskable 图标：图案缩进到中间 80%
const SS = 4;             // 每个方向的超采样数

const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();

// 图案空间里的颜色（u, v 以图案边长为 1，允许超出 0–1：超出的地方延续天空或海面）
function motifColor(u, v) {
  const dx = u - MOON_CX;
  const dy = v - MOON_CY;
  if (dx * dx + dy * dy <= MOON_R * MOON_R) return MOON;
  if (v >= BAND_BOTTOM) return SEA;
  if (v >= BAND_TOP) return BAND;
  return SKY;
}

function insideRoundedSquare(u, v, r) {
  if (u < 0 || u > 1 || v < 0 || v > 1) return false;
  const dx = Math.max(Math.abs(u - 0.5) - (0.5 - r), 0);
  const dy = Math.max(Math.abs(v - 0.5) - (0.5 - r), 0);
  return dx * dx + dy * dy <= r * r;
}

// radius：圆角（0 = 满铺方形）；motif：图案占画面的比例（1 = 铺满，0.8 = maskable 安全区）
function renderIcon(size, { radius = 0, motif = 1 } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const total = SS * SS;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, hit = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;
          if (radius && !insideRoundedSquare(u, v, radius)) continue;
          const c = motifColor((u - 0.5) / motif + 0.5, (v - 0.5) / motif + 0.5);
          r += c[0]; g += c[1]; b += c[2]; hit++;
        }
      }
      const i = (y * size + x) * 4;
      if (hit) {
        px[i] = Math.round(r / hit);
        px[i + 1] = Math.round(g / hit);
        px[i + 2] = Math.round(b / hit);
        px[i + 3] = Math.round((255 * hit) / total);
      }
    }
  }
  return px;
}

/* ---------- PNG 编码 ---------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // 位深
  ihdr[9] = 6;   // RGBA
  ihdr[10] = 0;  // deflate
  ihdr[11] = 0;  // 过滤方式
  ihdr[12] = 0;  // 不隔行
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // 过滤类型 None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- SVG ---------- */

function makeSvg() {
  const S = 512;
  const n = (v) => +(v * S).toFixed(2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">
  <title>歌词卡片</title>
  <clipPath id="r"><rect width="${S}" height="${S}" rx="${n(CORNER)}"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${S}" height="${S}" fill="${hex(SKY)}"/>
    <circle cx="${n(MOON_CX)}" cy="${n(MOON_CY)}" r="${n(MOON_R)}" fill="${hex(MOON)}"/>
    <rect y="${n(BAND_TOP)}" width="${S}" height="${n(BAND_BOTTOM - BAND_TOP)}" fill="${hex(BAND)}"/>
    <rect y="${n(BAND_BOTTOM)}" width="${S}" height="${S - n(BAND_BOTTOM)}" fill="${hex(SEA)}"/>
  </g>
</svg>
`;
}

/* ---------- 输出 ---------- */

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
mkdirSync(outDir, { recursive: true });

const jobs = [
  ['icon-192.png', 192, { radius: CORNER }],
  ['icon-512.png', 512, { radius: CORNER }],
  ['icon-maskable-512.png', 512, { motif: SAFE }],
  ['apple-touch-icon.png', 180, {}],
];
for (const [name, size, opts] of jobs) {
  const png = encodePng(size, renderIcon(size, opts));
  writeFileSync(join(outDir, name), png);
  console.log(`${name}  ${size}×${size}  ${png.length} bytes`);
}
writeFileSync(join(outDir, 'icon.svg'), makeSvg());
console.log('icon.svg');
