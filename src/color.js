// 颜色工具：OKLCH / 色调（tone）调色板、Material 3 风格的配色方案、封面取色。
// 纯逻辑模块：import 时不访问 DOM；只有 extractSeeds 在被调用时才创建 canvas。

export const FALLBACK_SEED = '#5DAEE6';

/* ------------------------------------------------------------------ */
/* sRGB / OKLab 基础转换                                               */
/* ------------------------------------------------------------------ */

const lin = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const gam = c => c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;

// 8 位通道 → 线性值的查找表（取色要处理 9216 个像素）
const LIN_TABLE = Array.from({ length: 256 }, (_, i) => lin(i / 255));

const toDeg = rad => ((rad * 180 / Math.PI) % 360 + 360) % 360;

/** '#RRGGBB'（也接受 '#RGB' 和不带 # 的写法）→ [r, g, b]，0–255。非法输入抛 RangeError。 */
export function hexToRgb(hex) {
  let h = String(hex).trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.replace(/./g, '$&$&');
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new RangeError(`Invalid hex colour: ${hex}`);
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** [r, g, b]（0–255，可为小数/越界）→ '#RRGGBB'（大写）。 */
export function rgbToHex(rgb) {
  return '#' + rgb
    .map(v => Math.min(255, Math.max(0, Math.round(v))).toString(16).padStart(2, '0'))
    .join('').toUpperCase();
}

/** 0–255 的 sRGB 通道 → OKLab [L, a, b]（Björn Ottosson 矩阵）。 */
function rgbToOklab(r, g, b) {
  const lr = LIN_TABLE[r], lg = LIN_TABLE[g], lb = LIN_TABLE[b];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

/** OKLab → 线性 sRGB（不裁剪，可能越界）。 */
function oklabToLinear(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

/** OKLCH（H 为角度）→ 线性 sRGB。 */
function okToLinear(L, C, H) {
  const rad = H * Math.PI / 180;
  return oklabToLinear(L, C * Math.cos(rad), C * Math.sin(rad));
}

/** 线性 sRGB → '#RRGGBB'：先裁剪到 0–1，再做 gamma 编码。 */
function linearToHex(rgb) {
  return '#' + rgb
    .map(v => Math.round(gam(Math.min(1, Math.max(0, v))) * 255).toString(16).padStart(2, '0'))
    .join('').toUpperCase();
}

/** '#RRGGBB' → { L, C, H }：OKLab 亮度 0–1，彩度，色相角度 0–360。 */
export function hexToOklch(hex) {
  const [L, a, b] = rgbToOklab(...hexToRgb(hex));
  return { L, C: Math.hypot(a, b), H: toDeg(Math.atan2(b, a)) };
}

/* ------------------------------------------------------------------ */
/* 色调（tone）调色板                                                  */
/* ------------------------------------------------------------------ */

// 色调 T（0–100）= CIELAB L*：先换成亮度 Y，再取立方根得到 OKLab 的 L
const Yof = T => T > 8 ? ((T + 16) / 116) ** 3 : T / 903.3;

/**
 * 在色相 H、最大彩度 C 内，取色调为 T 的 sRGB 颜色。
 * 对彩度做 30 步二分，找出该亮度下仍在 sRGB 色域内的最大彩度。
 */
export function toneHex(H, C, T) {
  const L = Math.cbrt(Yof(T));
  let lo = 0, hi = C;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    const rgb = okToLinear(L, mid, H);
    if (rgb.every(v => v >= -1e-4 && v <= 1 + 1e-4)) lo = mid; else hi = mid;
  }
  return linearToHex(okToLinear(L, lo, H));
}

/** 固定 H、C 的调色板：返回 (T) => hex，每个色调只算一次。 */
export function palette(H, C) {
  const cache = new Map();
  return T => {
    let hex = cache.get(T);
    if (hex === undefined) {
      hex = toneHex(H, C, T);
      cache.set(T, hex);
    }
    return hex;
  };
}

/* ------------------------------------------------------------------ */
/* 配色方案                                                            */
/* ------------------------------------------------------------------ */

// 每种风格：p/s/t/n/nv 各调色板的最大彩度，tHue 是第三色（tertiary）的色相偏移
const VARIANTS = {
  tonal: () => ({ p: 0.09, s: 0.035, t: 0.055, tHue: 60, n: 0.010, nv: 0.020 }),
  content: seed => {
    const n = Math.min(seed.C / 10, 0.02);
    return { p: seed.C, s: 0.035, t: seed.C * 0.55, tHue: 40, n, nv: n + 0.01 };
  },
  vibrant: () => ({ p: 0.40, s: 0.06, t: 0.08, tHue: 50, n: 0.018, nv: 0.026 }),
  mono: () => ({ p: 0, s: 0, t: 0, tHue: 0, n: 0, nv: 0 }),
};

// [角色, 调色板, 浅色模式色调, 深色模式色调]
const ROLES = [
  ['primary', 'p', 40, 80], ['onPrimary', 'p', 100, 20],
  ['primaryContainer', 'p', 90, 30], ['onPrimaryContainer', 'p', 30, 90],
  ['secondary', 's', 40, 80], ['secondaryContainer', 's', 90, 30], ['onSecondaryContainer', 's', 10, 90],
  ['tertiary', 't', 40, 80], ['tertiaryContainer', 't', 90, 30], ['onTertiaryContainer', 't', 30, 90],
  ['surface', 'n', 98, 6], ['surfaceContainerLowest', 'n', 100, 4], ['surfaceContainerLow', 'n', 96, 10],
  ['surfaceContainer', 'n', 94, 12], ['surfaceContainerHigh', 'n', 92, 17],
  ['surfaceContainerHighest', 'n', 90, 22], ['onSurface', 'n', 10, 90],
  ['onSurfaceVariant', 'nv', 30, 80], ['outline', 'nv', 50, 60], ['outlineVariant', 'nv', 80, 30],
  ['inverseSurface', 'n', 20, 90], ['inverseOnSurface', 'n', 95, 20], ['inversePrimary', 'p', 80, 40],
];

/**
 * 由种子色生成浅色/深色两套角色色。
 * 返回 { seedHex, seed:{L,C,H}, p, s, t, n, nv, light, dark }，p/s/t/n/nv 是 palette()。
 * 未知的 variant 按 'content' 处理。
 */
export function makeScheme(seedHex, variant = 'content') {
  const seed = hexToOklch(seedHex);
  const H = seed.C < 0.015 ? 250 : seed.H;           // 几乎无彩的种子色：色相固定为蓝
  const v = (VARIANTS[variant] ?? VARIANTS.content)(seed);
  const pals = {
    p: palette(H, v.p),
    s: palette(H, v.s),
    t: palette(H + v.tHue, v.t),
    n: palette(H, v.n),
    nv: palette(H, v.nv),
  };
  const light = {}, dark = {};
  for (const [role, key, lightTone, darkTone] of ROLES) {
    light[role] = pals[key](lightTone);
    dark[role] = pals[key](darkTone);
  }
  return { seedHex, seed, ...pals, light, dark };
}

/* ------------------------------------------------------------------ */
/* 对比度                                                              */
/* ------------------------------------------------------------------ */

/** WCAG 相对亮度 0–1。 */
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * LIN_TABLE[r] + 0.7152 * LIN_TABLE[g] + 0.0722 * LIN_TABLE[b];
}

/** WCAG 对比度 1–21。 */
export function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * 从 tone 起沿 dir（+1 变亮 / -1 变暗）每次走 2 个色调，
 * 直到 pal(tone) 对 bgHex 的对比度 ≥ min，或色调走到 0/100。返回那个颜色的 hex。
 */
export function ensureContrast(pal, tone, bgHex, min, dir) {
  const step = dir < 0 ? -2 : 2;
  let t = Math.min(100, Math.max(0, tone));
  let hex = pal(t);
  while (contrast(hex, bgHex) < min && t > 0 && t < 100) {
    t = Math.min(100, Math.max(0, t + step));
    hex = pal(t);
  }
  return hex;
}

/** '#RRGGBB' + 透明度 → 'rgba(r, g, b, a)'。 */
export function withAlpha(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** 两个色相角（度）的最短距离，0–180。 */
export function hueDistance(h1, h2) {
  const d = Math.abs(h1 - h2) % 360;
  return d > 180 ? 360 - d : d;
}

/* ------------------------------------------------------------------ */
/* 封面取色                                                            */
/* ------------------------------------------------------------------ */

const SAMPLE_SIZE = 96;
const HUE_BUCKETS = 36;          // 每桶 10°

/**
 * 纯像素分析：rgba 是 RGBA 字节数组（Uint8ClampedArray / Uint8Array）。
 * 返回 { seeds: hex[1..4], light: hex|null }。
 *
 * - 总像素 = alpha ≥ 200 的像素数（透明像素不参与任何统计）。
 * - 浅色墨水：OKLab L > 0.86 且 C < 0.08 的像素占比 ≥ 2% 时，取它们 sRGB 的平均色。
 * - 种子：C ≥ 0.035 且 0.12 ≤ L ≤ 0.97 的像素按色相分桶；桶得分 =
 *   prop×70 + (ch−48)×(ch<48 ? 0.1 : 0.3)，prop 为本桶加左右邻桶的占比，ch = 平均彩度×330。
 *   本桶占比 ≥ 0.5% 且 prop ≥ 1% 才有资格；按得分取色相互距 ≥ 30° 的最多 4 个。
 */
export function seedsFromPixels(rgba) {
  const buckets = Array.from({ length: HUE_BUCKETS }, () => ({ n: 0, L: 0, a: 0, b: 0, C: 0 }));
  let total = 0, lightN = 0, lightR = 0, lightG = 0, lightB = 0;

  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 200) continue;
    total++;
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    const [L, a, bb] = rgbToOklab(r, g, b);
    const C = Math.hypot(a, bb);

    if (L > 0.86 && C < 0.08) {
      lightN++; lightR += r; lightG += g; lightB += b;
    }
    if (C >= 0.035 && L >= 0.12 && L <= 0.97) {
      const bucket = buckets[Math.floor(toDeg(Math.atan2(bb, a)) / 10) % HUE_BUCKETS];
      bucket.n++; bucket.L += L; bucket.a += a; bucket.b += bb; bucket.C += C;
    }
  }
  if (total === 0) return { seeds: [FALLBACK_SEED], light: null };

  const light = lightN / total >= 0.02
    ? rgbToHex([lightR / lightN, lightG / lightN, lightB / lightN])
    : null;

  const candidates = [];
  buckets.forEach((bk, i) => {
    if (bk.n / total < 0.005) return;
    const prop = (bk.n + buckets[(i + HUE_BUCKETS - 1) % HUE_BUCKETS].n + buckets[(i + 1) % HUE_BUCKETS].n) / total;
    if (prop < 0.01) return;
    const ch = bk.C / bk.n * 330;
    const L = bk.L / bk.n, a = bk.a / bk.n, b = bk.b / bk.n;
    candidates.push({
      score: prop * 70 + (ch - 48) * (ch < 48 ? 0.1 : 0.3),
      hue: toDeg(Math.atan2(b, a)),
      hex: linearToHex(oklabToLinear(L, a, b)),
    });
  });
  candidates.sort((x, y) => y.score - x.score);

  const picked = [];
  for (const c of candidates) {
    if (picked.length === 4) break;
    if (picked.every(p => hueDistance(p.hue, c.hue) >= 30)) picked.push(c);
  }
  return { seeds: picked.length ? picked.map(p => p.hex) : [FALLBACK_SEED], light };
}

function makeSampleCanvas() {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SAMPLE_SIZE;
    return canvas;
  }
  return new OffscreenCanvas(SAMPLE_SIZE, SAMPLE_SIZE);
}

/** 图片源的像素尺寸：<img> 用 naturalWidth，<video> 用 videoWidth，其余（canvas / ImageBitmap）用 width。 */
function sourceSize(source) {
  return [
    source.naturalWidth || source.videoWidth || source.width,
    source.naturalHeight || source.videoHeight || source.height,
  ];
}

/**
 * 从封面取种子色。source 可以是 HTMLImageElement / HTMLCanvasElement / ImageBitmap 等 CanvasImageSource。
 * 先把封面按 object-fit: cover 居中裁成正方形，画到 96×96 再交给 seedsFromPixels。
 * 画布不可用、图片未加载或 getImageData 抛错（如跨域污染）时返回 { seeds: [FALLBACK_SEED], light: null }。
 */
export function extractSeeds(source) {
  try {
    const [sw, sh] = sourceSize(source);
    if (!(sw > 0 && sh > 0)) throw new Error('source has no size');
    const ctx = makeSampleCanvas().getContext('2d', { willReadFrequently: true });
    const side = Math.min(sw, sh);             // 目标是正方形：cover 居中裁切就是取中间的正方形
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, (sw - side) / 2, (sh - side) / 2, side, side, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    return seedsFromPixels(ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data);
  } catch {
    return { seeds: [FALLBACK_SEED], light: null };
  }
}
