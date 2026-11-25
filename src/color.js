// 颜色工具：OKLCH / 色调（tone）调色板、Material 3 风格的配色方案、封面分析、卡片配色。
// 纯逻辑模块：import 时不访问 DOM；只有 analyzeCover 在被调用时才创建 canvas。

export const FALLBACK_SEED = '#5DAEE6';

/* ------------------------------------------------------------------ */
/* sRGB / OKLab 基础转换                                               */
/* ------------------------------------------------------------------ */

const lin = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const gam = c => c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;

// 8 位通道 → 线性值的查找表（封面分析要处理 9216 个像素）
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
/* 色调与明暗                                                          */
/* ------------------------------------------------------------------ */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * 颜色的色调：CIELAB L*（0–100），与 palette() / toneHex() 的色调同一标尺。
 * 灰色两者完全一致；有彩色时 toneHex 的色调是近似值，量出来的 L* 最多差几个点。
 * @param {string} hex '#RRGGBB'
 * @returns {number}
 */
export function toneOf(hex) {
  const Y = luminance(hex);
  return Y > 0.008856 ? 116 * Math.cbrt(Y) - 16 : 903.3 * Y;
}

/**
 * 卡片用深色还是浅色背景。'dark' → true，'light' → false，
 * 'auto'（以及 undefined 等其它值）→ 跟随封面平均亮度：meanL < 0.5 用深色。
 * @param {'auto'|'light'|'dark'|undefined} mode
 * @param {number} meanL 封面的 OKLab 平均亮度，0–1
 * @returns {boolean}
 */
export function resolveDark(mode, meanL) {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  return meanL < 0.5;
}

/* ------------------------------------------------------------------ */
/* 封面分析：色板、强调色、平均亮度、视觉重心、上下边缘色              */
/* ------------------------------------------------------------------ */

/**
 * @typedef {object} Swatch 封面里的一块真实颜色（聚类中心，不是色相桶的平均）
 * @property {string} hex    '#RRGGBB'
 * @property {number} L      OKLab 亮度 0–1
 * @property {number} C      OKLab 彩度
 * @property {number} H      色相角度 0–360
 * @property {number} share  占有效像素的比例 0–1
 * @property {'base'|'accent'|'vivid'|'neutral'} role
 *   base 面积最大的颜色（可以是黑、白、灰）；accent 最醒目且与 base 明显不同的颜色；
 *   vivid 其它有彩色；neutral 与 base 明显不同的大块无彩色（蓝封面上的奶白人物、白色边框）
 */

/**
 * @typedef {object} CoverAnalysis
 * @property {Swatch[]} swatches 1–6 个，swatches[0] 是 base
 * @property {number} defaultIndex 应用默认选中的色块下标
 * @property {string|null} accent '#RRGGBB'；封面上没有可作强调色的颜色时为 null
 * @property {number} meanL 封面的 OKLab 平均亮度 0–1
 * @property {{x: number, y: number}} focus 视觉重心，各 0–1
 * @property {{top: string, bottom: string}} edges 上、下各 6% 行的平均颜色
 */

const SAMPLE_SIZE = 96;
const OPAQUE_ALPHA = 200;       // alpha 低于它的像素不参与任何统计
const MAX_CLUSTERS = 12;
const SEED_STOP_DIST = 0.03;    // 最远的像素离已有聚类中心不足这个距离就不再增加聚类
const KMEANS_ITERATIONS = 10;
const MERGE_DIST = 0.05;        // 距离小于它的两个聚类合并
const VIVID_CHROMA = 0.04;      // 彩度不低于它算有彩色
const VIVID_SHARE = 0.006;
const ACCENT_MIN_DIST = 0.15;   // 强调色与 base 的最小距离
const SWATCH_MIN_DIST = 0.12;   // 色块之间的最小距离
const MAX_SWATCHES = 6;
const NEUTRAL_SHARE = 0.05;
const NEUTRAL_MIN_DIST = 0.25;  // 无彩色块与 base 的最小距离
const EDGE_FRACTION = 0.06;     // 上下边缘色、视觉重心的边缘降权都用 6%

const labDist2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
const labDist = (p, q) => Math.sqrt(labDist2(p, q));

/** 封面解析失败时的分析结果：只有一个 FALLBACK_SEED 色块。每次返回新对象。 */
function fallbackAnalysis() {
  const { L, C, H } = hexToOklch(FALLBACK_SEED);
  return {
    swatches: [{ hex: FALLBACK_SEED, L, C, H, share: 1, role: 'base' }],
    defaultIndex: 0,
    accent: null,
    meanL: 0.5,
    focus: { x: 0.5, y: 0.5 },
    edges: { top: FALLBACK_SEED, bottom: FALLBACK_SEED },
  };
}

/**
 * OKLab 空间里的 k-means。用最远点选种子，所以面积很小但颜色很不同的东西
 * （黑底上的金色头盔）也会有自己的聚类。返回按面积从大到小排列的聚类。
 * @param {number[][]} labs 有效像素的 [L, a, b]
 * @returns {{lab: number[], share: number}[]}
 */
function clusterColours(labs) {
  const mean = [0, 1, 2].map(k => labs.reduce((sum, p) => sum + p[k], 0) / labs.length);
  let centres = [mean];
  const nearest = labs.map(p => labDist2(p, mean));
  while (centres.length < MAX_CLUSTERS) {
    let far = 0;
    for (let i = 1; i < labs.length; i++) if (nearest[i] > nearest[far]) far = i;
    if (nearest[far] < SEED_STOP_DIST ** 2) break;
    centres.push(labs[far].slice());
    for (let i = 0; i < labs.length; i++) nearest[i] = Math.min(nearest[i], labDist2(labs[i], labs[far]));
  }

  const assign = new Int16Array(labs.length);
  for (let iter = 0; iter < KMEANS_ITERATIONS; iter++) {
    const sums = centres.map(() => [0, 0, 0, 0]);
    labs.forEach((p, i) => {
      let best = 0, bestD = Infinity;
      centres.forEach((c, j) => {
        const d = labDist2(p, c);
        if (d < bestD) { bestD = d; best = j; }
      });
      assign[i] = best;
      const s = sums[best];
      s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
    });
    centres = centres.map((c, j) => {
      const [l, a, b, n] = sums[j];
      return n ? [l / n, a / n, b / n] : c;
    });
  }

  const clusters = centres.map(lab => ({ lab, n: 0 }));
  for (const j of assign) clusters[j].n++;
  const alive = clusters.filter(c => c.n > 0);

  // 合并过近的聚类（按面积加权），每合并一次从头再找
  for (let pair = findCloseClusters(alive); pair; pair = findCloseClusters(alive)) {
    const [i, j] = pair;
    const a = alive[i], b = alive[j], n = a.n + b.n;
    a.lab = a.lab.map((v, k) => (v * a.n + b.lab[k] * b.n) / n);
    a.n = n;
    alive.splice(j, 1);
  }
  return alive
    .map(c => ({ lab: c.lab, share: c.n / labs.length }))
    .sort((p, q) => q.share - p.share);
}

/** 第一对距离小于 MERGE_DIST 的聚类下标 [i, j]，没有则 null。 */
function findCloseClusters(clusters) {
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      if (labDist(clusters[i].lab, clusters[j].lab) < MERGE_DIST) return [i, j];
    }
  }
  return null;
}

/**
 * 视觉重心：每个像素的权重 = 2×与 7×7 邻域平均亮度之差（局部对比）
 * + 与整张图平均 a/b 的距离（颜色与众不同）+ 0.6×与整张图平均亮度之差；
 * 离边框 6% 以内的像素权重 ×0.3。只取权重最高的 10% 做加权平均。
 * @param {(number[]|null)[]} labs 按像素顺序，透明像素为 null
 * @returns {{x: number, y: number}} 各 0–1；整张图没有任何起伏时返回正中
 */
function visualFocus(labs, size, meanL) {
  const opaque = labs.filter(Boolean);
  const meanA = opaque.reduce((sum, p) => sum + p[1], 0) / opaque.length;
  const meanB = opaque.reduce((sum, p) => sum + p[2], 0) / opaque.length;

  const weights = new Float64Array(labs.length);
  for (let i = 0; i < labs.length; i++) {
    const lab = labs[i];
    if (!lab) continue;
    const x = i % size, y = (i - x) / size;
    let sum = 0, count = 0;
    for (let yy = Math.max(0, y - 3); yy <= Math.min(size - 1, y + 3); yy++) {
      for (let xx = Math.max(0, x - 3); xx <= Math.min(size - 1, x + 3); xx++) {
        const near = labs[yy * size + xx];
        if (near) { sum += near[0]; count++; }
      }
    }
    const fx = (x + 0.5) / size, fy = (y + 0.5) / size;
    const border = Math.min(fx, 1 - fx, fy, 1 - fy) < EDGE_FRACTION ? 0.3 : 1;
    weights[i] = border * (
      2 * Math.abs(lab[0] - sum / count)
      + Math.hypot(lab[1] - meanA, lab[2] - meanB)
      + 0.6 * Math.abs(lab[0] - meanL)
    );
  }

  const sorted = weights.filter((_, i) => labs[i]).sort().reverse();
  const cut = sorted[Math.floor(sorted.length * 0.1)];
  let wx = 0, wy = 0, total = 0;
  for (let i = 0; i < labs.length; i++) {
    if (!labs[i] || weights[i] < cut) continue;
    wx += weights[i] * ((i % size) + 0.5) / size;
    wy += weights[i] * (Math.floor(i / size) + 0.5) / size;
    total += weights[i];
  }
  return total > 1e-9 ? { x: wx / total, y: wy / total } : { x: 0.5, y: 0.5 };
}

/** 若干行（半开区间 [row0, row1)）里有效像素的平均 sRGB；一个有效像素都没有时返回 fallbackHex。 */
function meanRowsHex(rgba, size, row0, row1, fallbackHex) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = row0 * size; i < row1 * size; i++) {
    if (rgba[i * 4 + 3] < OPAQUE_ALPHA) continue;
    r += rgba[i * 4]; g += rgba[i * 4 + 1]; b += rgba[i * 4 + 2]; n++;
  }
  return n ? rgbToHex([r / n, g / n, b / n]) : fallbackHex;
}

/**
 * 纯像素分析（确定性：同样的像素永远得到同样的结果）。
 * 把封面聚成几块真实的颜色，选出 base（面积最大）、accent（最醒目且与 base 明显不同）
 * 和最多 6 个供选择的色块，再算平均亮度、视觉重心和上下边缘色。
 * alpha < 200 的像素不参与任何统计；没有任何有效像素时返回 fallback 分析。
 *
 * defaultIndex 为 1 的条件：base 是无彩色，且不是「底」（L < 0.25 或 > 0.92 且占 ≥ 25%
 * 的纯黑 / 纯白底），有彩色合计占 ≥ 20%，并且有第二个色块；否则为 0。
 * @param {Uint8ClampedArray|Uint8Array} rgba size×size 的 RGBA 字节
 * @param {number} size 边长（像素）
 * @returns {CoverAnalysis}
 */
export function analyzePixels(rgba, size) {
  const labs = Array.from({ length: size * size }, (_, i) => (
    rgba[i * 4 + 3] >= OPAQUE_ALPHA ? rgbToOklab(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]) : null
  ));
  const opaque = labs.filter(Boolean);
  if (opaque.length === 0) return fallbackAnalysis();

  const clusters = clusterColours(opaque).map(({ lab, share }) => ({
    lab, share, hex: linearToHex(oklabToLinear(...lab)),
    L: lab[0], C: Math.hypot(lab[1], lab[2]), H: toDeg(Math.atan2(lab[2], lab[1])),
  }));
  const base = clusters[0];
  const score = c => Math.sqrt(c.share) * c.C * 100;
  const vivid = clusters
    .filter(c => c.C >= VIVID_CHROMA && c.share >= VIVID_SHARE)
    .sort((p, q) => score(q) - score(p));
  const accent = vivid.find(c => labDist(c.lab, base.lab) >= ACCENT_MIN_DIST) ?? null;

  const picked = [{ cluster: base, role: 'base' }];
  const add = (cluster, role) => {
    if (picked.length < MAX_SWATCHES && picked.every(p => labDist(p.cluster.lab, cluster.lab) >= SWATCH_MIN_DIST)) {
      picked.push({ cluster, role });
    }
  };
  for (const c of vivid) add(c, c === accent ? 'accent' : 'vivid');
  for (const c of clusters) {
    if (c.C < VIVID_CHROMA && c.share >= NEUTRAL_SHARE && labDist(c.lab, base.lab) >= NEUTRAL_MIN_DIST) add(c, 'neutral');
  }
  const swatches = picked.map(({ cluster: c, role }) => ({ hex: c.hex, L: c.L, C: c.C, H: c.H, share: c.share, role }));

  const vividShare = vivid.reduce((sum, c) => sum + c.share, 0);
  const isGround = (base.L < 0.25 || base.L > 0.92) && base.share >= 0.25;
  const defaultIndex = base.C < VIVID_CHROMA && !isGround && vividShare >= 0.2 && swatches.length > 1 ? 1 : 0;

  const meanL = opaque.reduce((sum, p) => sum + p[0], 0) / opaque.length;
  const edgeRows = Math.max(1, Math.round(size * EDGE_FRACTION));
  return {
    swatches,
    defaultIndex,
    accent: accent ? accent.hex : null,
    meanL,
    focus: visualFocus(labs, size, meanL),
    edges: {
      top: meanRowsHex(rgba, size, 0, edgeRows, base.hex),
      bottom: meanRowsHex(rgba, size, size - edgeRows, size, base.hex),
    },
  };
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
 * 分析封面。source 可以是 HTMLImageElement / HTMLCanvasElement / ImageBitmap / OffscreenCanvas 等
 * CanvasImageSource：先按 object-fit: cover 居中裁成正方形，画到 96×96，再交给 analyzePixels。
 * 画布不可用、图片未加载、尺寸为 0 或 getImageData 抛错（如跨域污染）时不抛错，返回 fallback 分析
 * （一个 FALLBACK_SEED 色块，accent null，meanL 0.5，重心居中，上下边缘色都是 FALLBACK_SEED）。
 * @param {CanvasImageSource} source
 * @returns {CoverAnalysis}
 */
export function analyzeCover(source) {
  try {
    const [sw, sh] = sourceSize(source);
    if (!(sw > 0 && sh > 0)) throw new Error('source has no size');
    const ctx = makeSampleCanvas().getContext('2d', { willReadFrequently: true });
    const side = Math.min(sw, sh);             // 目标是正方形：cover 居中裁切就是取中间的正方形
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, (sw - side) / 2, (sh - side) / 2, side, side, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    return analyzePixels(ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data, SAMPLE_SIZE);
  } catch {
    return fallbackAnalysis();
  }
}

/* ------------------------------------------------------------------ */
/* 卡片配色                                                            */
/* ------------------------------------------------------------------ */

/** 鲜明：这个色相彩度最高的色调（黄偏亮、蓝偏暗），再朝要求的明暗方向挪，只要彩度还有峰值的 85%。 */
function vibrantBackground(src, dark) {
  const pal = palette(src.H, 0.4);
  const chromaAt = tone => hexToOklch(pal(tone)).C;
  let peakTone = 50, peakChroma = 0;
  for (let t = 26; t <= 76; t += 2) {
    const c = chromaAt(t);
    if (c > peakChroma) { peakChroma = c; peakTone = t; }
  }
  const step = dark ? -2 : 2;
  let tone = peakTone;
  while (tone + step >= 26 && tone + step <= 76 && chromaAt(tone + step) >= peakChroma * 0.85) tone += step;
  return pal(tone);
}

/** 四种风格的背景色，见 cardPalette。forced：用户固定了浅色 / 深色（不是跟随封面）。 */
function cardBackground({ seed, accent, style, dark, forced }) {
  const s = hexToOklch(seed);
  const T0 = toneOf(seed);
  const seedAdj = s.C > 0.22 ? palette(s.H, 0.2)(T0) : seed;       // 荧光色压到彩度 0.2，色调不变

  switch (style) {
    case 'tonal':
      return palette(s.H, clamp(s.C * 0.45, 0.02, 0.05))(dark ? 16 : 88);
    case 'vibrant': {
      const src = s.C < VIVID_CHROMA && accent ? hexToOklch(accent) : s;
      if (src.C < VIVID_CHROMA) return dark ? '#000000' : '#FFFFFF';   // 封面没有任何有彩色：纯黑 / 纯白
      return vibrantBackground(src, dark);
    }
    case 'mono':
      return palette(0, 0)(dark ? 8 : 97);
    default:                                                         // 'content'
      if (!forced || (dark ? T0 <= 32 : T0 >= 72)) return seedAdj;
      return palette(s.H, Math.min(s.C, 0.2))(dark ? 26 : 76);
  }
}

/**
 * @typedef {object} CardPalette 所有模板共用的一套卡片颜色
 * @property {string} bg        背景
 * @property {string} container 比背景略深（浅色）/ 略亮（深色）的容器色
 * @property {string} on        正文色，对 bg 对比度 ≥ 7；中间调背景黑白都够不到 7 时，取黑 / 白能达到的最大值
 * @property {string} onVar     次要文字色，对 bg 对比度 ≥ 4.5
 * @property {string} accent    强调色，对 bg 对比度 ≥ 4.5
 * @property {boolean} isDark   背景是否深色（按对比度判断，与 mode 无关）
 * @property {string} track     进度条轨道等：on 的 16% 透明度，'rgba(...)'
 * @property {string} shadow    阴影：深色 'rgba(0, 0, 0, 0.5)'，浅色 on 的 25% 透明度
 */

/**
 * 由种子色算出一张卡片的全部颜色。风格直接决定背景：
 * - content 忠实：封面自己的颜色（荧光色压到彩度 0.2）。mode 为 'auto' 时不改色调；
 *   固定浅色 / 深色时，种子色色调不合适（浅色 < 72、深色 > 32）就换成同色相的 76 / 26 色调。
 * - tonal 柔和：同色相、低彩度（0.02–0.05）、很浅（88）或很深（16）。
 * - vibrant 鲜明：最鲜艳的色相满彩度；种子色是无彩色时用 accent 的色相，都没有则纯黑 / 纯白。
 * - mono 单色：纯灰（97 / 8）；accent 仍是卡片上唯一的颜色。
 * 文字色、容器色、强调色都由背景推出，并保证对比度。
 * @param {object} args
 * @param {string} args.seed '#RRGGBB'，当前选中的色块或自定义颜色
 * @param {string|null} [args.accent] 封面强调色
 * @param {'content'|'tonal'|'vibrant'|'mono'} [args.style] 未知值按 'content'
 * @param {'auto'|'light'|'dark'} [args.mode] 'auto' 用 meanL 决定明暗
 * @param {number} [args.meanL] 封面平均亮度，mode 为 'auto' 时用
 * @returns {CardPalette}
 */
export function cardPalette({ seed, accent = null, style = 'content', mode = 'auto', meanL = 0.5 }) {
  const dark = resolveDark(mode, meanL);
  const bg = cardBackground({ seed, accent, style, dark, forced: mode === 'light' || mode === 'dark' });

  const b = hexToOklch(bg);
  const isDark = contrast(bg, '#FFFFFF') >= contrast(bg, '#000000');   // 用纯黑比：#111 会让 L* 50 附近的背景选白字，白字达不到 4.5
  const dir = isDark ? 1 : -1;
  const on = ensureContrast(palette(b.H, Math.min(b.C * 0.25, 0.025)), isDark ? 97 : 12, bg, 7, dir);
  const onVar = ensureContrast(palette(b.H, Math.min(Math.max(b.C * 0.5, 0.02), 0.08)), isDark ? 80 : 35, bg, 4.5, dir);
  const container = palette(b.H, b.C * 0.9)(clamp(toneOf(bg) + (isDark ? 8 : -6), 4, 98));

  // 强调色：用封面的 accent；它和背景色相太近（背景有彩色时）或没有 accent，就换成背景的补色方向
  let a = accent ? hexToOklch(accent) : null;
  if (!a || (b.C >= VIVID_CHROMA && hueDistance(a.H, b.H) < 40)) {
    a = { H: (b.H + 175) % 360, C: clamp(b.C * 0.6, 0.06, 0.12) };
  }
  const accentHex = ensureContrast(palette(a.H, Math.max(a.C, 0.06)), isDark ? 86 : 38, bg, 4.5, dir);

  return {
    bg, container, on, onVar, accent: accentHex, isDark,
    track: withAlpha(on, 0.16),
    shadow: isDark ? 'rgba(0, 0, 0, 0.5)' : withAlpha(on, 0.25),
  };
}
