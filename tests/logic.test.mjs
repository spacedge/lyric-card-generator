// 纯逻辑模块的单元测试：color.js / lyrics.js / text.js / ruby.js（以及 render/common.js 里的 rubyFit）
// 运行：node tests/logic.test.mjs（在项目根目录）
// 版权规则：测试里只用 CONTRACT.md 里的原创示例歌词或自编的中性文本。

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  FALLBACK_SEED, hexToRgb, rgbToHex, hexToOklch, toneHex, palette, makeScheme,
  luminance, contrast, ensureContrast, withAlpha, hueDistance,
  toneOf, resolveDark, analyzePixels, analyzeCover, cardPalette,
} from '../src/color.js';
import { stripLrc, parseLyrics } from '../src/lyrics.js';
import { hasKana, hasHan, hasHangul, NO_START, NO_END, wrap, wrapRuby } from '../src/text.js';
import { parseRuby, hasRuby, stripRuby, rubySegments } from '../src/ruby.js';
import { rubyFit } from '../src/render/common.js';

/* ================================================================== */
/* color.js                                                            */
/* ================================================================== */

describe('color: hex / OKLCH conversion', () => {
  it('hexToRgb parses #RRGGBB, #RGB and rejects garbage', () => {
    assert.deepEqual(hexToRgb('#23389C'), [35, 56, 156]);
    assert.deepEqual(hexToRgb('5daee6'), [93, 174, 230]);
    assert.deepEqual(hexToRgb('#fa0'), [255, 170, 0]);
    assert.throws(() => hexToRgb('#12345'), RangeError);
    assert.throws(() => hexToRgb('nope'), RangeError);
  });

  it('rgbToHex is uppercase, rounds and clamps', () => {
    assert.equal(rgbToHex([35, 56, 156]), '#23389C');
    assert.equal(rgbToHex([0, 0, 0]), '#000000');
    assert.equal(rgbToHex([254.6, 0.4, -5]), '#FF0000');
    assert.equal(rgbToHex([300, 255, 171]), '#FFFFAB');
  });

  it('hexToOklch matches known OKLCH values', () => {
    const white = hexToOklch('#FFFFFF');
    assert.ok(Math.abs(white.L - 1) < 1e-4 && white.C < 1e-4);
    const black = hexToOklch('#000000');
    assert.equal(black.L, 0);
    // 纯红：oklch(0.628 0.2577 29.23)
    const red = hexToOklch('#FF0000');
    assert.ok(Math.abs(red.L - 0.628) < 1e-3, `L=${red.L}`);
    assert.ok(Math.abs(red.C - 0.2577) < 1e-3, `C=${red.C}`);
    assert.ok(Math.abs(red.H - 29.23) < 0.05, `H=${red.H}`);
    // H 总在 [0, 360)
    for (const hex of ['#0000FF', '#00FF00', '#FF00FF', '#23389C']) {
      const { H } = hexToOklch(hex);
      assert.ok(H >= 0 && H < 360, `${hex} H=${H}`);
    }
  });

  it('toneHex hits the extremes and is monotonic in tone', () => {
    // T=0 时契约算法允许 1e-4 的越界容差，所以是近黑（如 #000002）而不一定恰好是 #000000
    assert.ok(luminance(toneHex(250, 0.1, 0)) < 1e-3, toneHex(250, 0.1, 0));
    assert.equal(toneHex(250, 0.1, 100), '#FFFFFF');
    assert.equal(toneHex(250, 0, 0), '#000000');
    assert.equal(toneHex(250, 0, 50), toneHex(30, 0, 50));          // 彩度 0 → 与色相无关
    let prev = -1;
    for (let T = 0; T <= 100; T += 10) {
      const y = luminance(toneHex(145, 0.12, T));
      assert.ok(y > prev, `tone ${T} should be lighter than the previous step`);
      prev = y;
    }
  });

  it('toneHex output is always a valid in-gamut #RRGGBB', () => {
    for (const H of [0, 90, 180, 270, 359]) {
      for (const T of [0, 5, 20, 50, 80, 95, 100]) {
        assert.match(toneHex(H, 0.4, T), /^#[0-9A-F]{6}$/);
      }
    }
  });

  it('palette caches and agrees with toneHex', () => {
    const pal = palette(262, 0.09);
    assert.equal(pal(40), toneHex(262, 0.09, 40));
    assert.equal(pal(40), pal(40));
  });
});

describe('color: makeScheme (assertions from CONTRACT.md)', () => {
  it("#23389C tonal", () => {
    const sc = makeScheme('#23389C', 'tonal');
    assert.equal(sc.p(40), '#495C91');
    assert.equal(sc.p(90), '#D7E2FF');
    assert.equal(sc.p(30), '#324377');
    assert.equal(sc.s(90), '#D9E2FB');
    assert.equal(sc.s(10), '#151B2C');
    assert.equal(sc.n(98), '#F7F9FF');
    assert.equal(sc.n(10), '#191B20');
    assert.equal(sc.nv(30), '#424752');
    assert.equal(sc.nv(80), '#C1C6D4');
  });

  it('#23389C content', () => {
    const sc = makeScheme('#23389C', 'content');
    assert.equal(sc.p(40), '#3853B9');
    assert.equal(sc.p(30), '#24399D');
    assert.equal(sc.p(80), '#AFC5FF');
  });

  it('#5DAEE6 tonal', () => {
    const sc = makeScheme('#5DAEE6', 'tonal');
    assert.equal(sc.p(40), '#27648C');
    assert.equal(sc.p(90), '#C8E7FF');
    assert.equal(sc.p(20), '#003451');
  });

  it('#E9BE6A tonal', () => {
    assert.equal(makeScheme('#E9BE6A', 'tonal').p(80), '#E3C282');
  });

  it('returns the documented shape', () => {
    const sc = makeScheme('#23389C');
    assert.deepEqual(Object.keys(sc), ['seedHex', 'seed', 'p', 's', 't', 'n', 'nv', 'light', 'dark']);
    assert.equal(sc.seedHex, '#23389C');
    assert.deepEqual(Object.keys(sc.seed), ['L', 'C', 'H']);
    for (const f of ['p', 's', 't', 'n', 'nv']) assert.equal(typeof sc[f], 'function');
    assert.deepEqual(sc.seed, hexToOklch('#23389C'));
  });

  it('default variant is content; unknown variants fall back to content', () => {
    const a = makeScheme('#23389C');
    const b = makeScheme('#23389C', 'content');
    const c = makeScheme('#23389C', 'no-such-variant');
    assert.deepEqual(a.light, b.light);
    assert.deepEqual(a.dark, b.dark);
    assert.deepEqual(a.light, c.light);
  });

  it('role table: every role uses the contracted palette and tone', () => {
    const sc = makeScheme('#5DAEE6', 'vibrant');
    const table = {
      primary: ['p', 40, 80], onPrimary: ['p', 100, 20], primaryContainer: ['p', 90, 30],
      onPrimaryContainer: ['p', 30, 90],
      secondary: ['s', 40, 80], secondaryContainer: ['s', 90, 30], onSecondaryContainer: ['s', 10, 90],
      tertiary: ['t', 40, 80], tertiaryContainer: ['t', 90, 30], onTertiaryContainer: ['t', 30, 90],
      surface: ['n', 98, 6], surfaceContainerLowest: ['n', 100, 4], surfaceContainerLow: ['n', 96, 10],
      surfaceContainer: ['n', 94, 12], surfaceContainerHigh: ['n', 92, 17],
      surfaceContainerHighest: ['n', 90, 22], onSurface: ['n', 10, 90],
      onSurfaceVariant: ['nv', 30, 80], outline: ['nv', 50, 60], outlineVariant: ['nv', 80, 30],
      inverseSurface: ['n', 20, 90], inverseOnSurface: ['n', 95, 20], inversePrimary: ['p', 80, 40],
    };
    assert.deepEqual(Object.keys(sc.light).sort(), Object.keys(table).sort());
    assert.deepEqual(Object.keys(sc.dark).sort(), Object.keys(table).sort());
    for (const [role, [pal, lightTone, darkTone]] of Object.entries(table)) {
      assert.equal(sc.light[role], sc[pal](lightTone), `light.${role}`);
      assert.equal(sc.dark[role], sc[pal](darkTone), `dark.${role}`);
    }
  });

  it('mono scheme is pure grey', () => {
    const sc = makeScheme('#E9BE6A', 'mono');
    for (const mode of [sc.light, sc.dark]) {
      for (const [role, hex] of Object.entries(mode)) {
        const [r, g, b] = hexToRgb(hex);
        assert.ok(r === g && g === b, `${role} ${hex}`);
      }
    }
  });

  it('near-grey seeds use hue 250 (blue) instead of an arbitrary hue', () => {
    const sc = makeScheme('#808080', 'tonal');
    const [r, , b] = hexToRgb(sc.p(40));
    assert.ok(b > r, `expected a blue tint, got ${sc.p(40)}`);
    const hue = hexToOklch(sc.p(40)).H;
    assert.ok(hueDistance(hue, 250) < 8, `hue ${hue}`);
  });

  it('vibrant is more chromatic than tonal, which is more chromatic than mono', () => {
    const chroma = v => hexToOklch(makeScheme('#5DAEE6', v).p(60)).C;
    assert.ok(chroma('vibrant') > chroma('tonal'));
    assert.ok(chroma('tonal') > chroma('mono'));
    assert.ok(chroma('mono') < 1e-3);
  });

  it('content primary keeps the seed hue; tertiary is rotated from it', () => {
    const sc = makeScheme('#23389C', 'content');
    const seedH = hexToOklch('#23389C').H;
    assert.ok(hueDistance(hexToOklch(sc.p(50)).H, seedH) < 6);
    assert.ok(hueDistance(hexToOklch(sc.t(50)).H, seedH + 40) < 8);
  });
});

describe('color: contrast helpers', () => {
  it('luminance and contrast sanity', () => {
    assert.equal(luminance('#000000'), 0);
    assert.ok(Math.abs(luminance('#FFFFFF') - 1) < 1e-9);
    assert.ok(Math.abs(contrast('#000000', '#FFFFFF') - 21) < 1e-9);
    assert.ok(Math.abs(contrast('#FFFFFF', '#000000') - 21) < 1e-9);
    assert.equal(contrast('#777777', '#777777'), 1);
    // WCAG 公认值：#767676 对白色约 4.54
    assert.ok(Math.abs(contrast('#767676', '#FFFFFF') - 4.54) < 0.01);
  });

  it('ensureContrast reaches the requested ratio walking darker', () => {
    const pal = palette(262, 0.09);
    for (const min of [3, 4.5, 7]) {
      const hex = ensureContrast(pal, 90, '#FFFFFF', min, -1);
      assert.ok(contrast(hex, '#FFFFFF') >= min, `min ${min}: got ${hex}`);
    }
  });

  it('ensureContrast reaches the requested ratio walking lighter', () => {
    const pal = palette(262, 0.09);
    const bg = '#10131A';
    for (const min of [3, 4.5, 7]) {
      const hex = ensureContrast(pal, 10, bg, min, +1);
      assert.ok(contrast(hex, bg) >= min, `min ${min}: got ${hex}`);
    }
  });

  it('ensureContrast stops at the first tone that passes (steps of 2)', () => {
    const pal = palette(262, 0.09);
    const hex = ensureContrast(pal, 90, '#FFFFFF', 4.5, -1);
    let tone = 90;
    while (pal(tone) !== hex) tone -= 2;
    assert.ok(tone < 90, 'should have had to move');
    assert.ok(contrast(pal(tone + 2), '#FFFFFF') < 4.5, 'previous step must not already pass');
  });

  it('ensureContrast returns the start tone when it already passes', () => {
    const pal = palette(262, 0.09);
    assert.equal(ensureContrast(pal, 20, '#FFFFFF', 4.5, -1), pal(20));
  });

  it('ensureContrast gives up at tone 0 / 100 and returns that extreme', () => {
    const pal = palette(262, 0.09);
    assert.equal(ensureContrast(pal, 60, '#000000', 21, -1), pal(0));
    assert.equal(ensureContrast(pal, 80, '#FFFFFF', 21, +1), '#FFFFFF');
    assert.equal(ensureContrast(pal, 91, '#FFFFFF', 21, +1), '#FFFFFF');   // 奇数起点最终也夹到 100
  });

  it('withAlpha builds an rgba() string', () => {
    assert.equal(withAlpha('#FF8000', 0.5), 'rgba(255, 128, 0, 0.5)');
    assert.equal(withAlpha('#23389C', 1), 'rgba(35, 56, 156, 1)');
  });

  it('hueDistance is the shortest angular distance', () => {
    assert.equal(hueDistance(10, 350), 20);
    assert.equal(hueDistance(350, 10), 20);
    assert.equal(hueDistance(0, 180), 180);
    assert.equal(hueDistance(90, 90), 0);
    assert.equal(hueDistance(720, 10), 10);
    assert.equal(hueDistance(30, 100), 70);
  });
});

/* ------------------------------------------------------------------ */
/* toneOf / resolveDark                                                */
/* ------------------------------------------------------------------ */

describe('color: toneOf', () => {
  it('is CIELAB L*: 0 for black, 100 for white, ~50 for #777777', () => {
    assert.equal(toneOf('#000000'), 0);
    assert.ok(Math.abs(toneOf('#FFFFFF') - 100) < 1e-6);
    assert.ok(Math.abs(toneOf('#777777') - 50) < 0.1, `got ${toneOf('#777777')}`);
  });

  it('agrees with toneHex: exactly for greys, within a few points for coloured tones', () => {
    // toneHex 把色调当作 OKLab 亮度的立方根来用，所以彩度越高，实际量到的 L* 偏离越多
    for (const T of [10, 30, 50, 70, 90]) {
      assert.ok(Math.abs(toneOf(toneHex(0, 0, T)) - T) < 0.8, `grey T${T}: got ${toneOf(toneHex(0, 0, T))}`);
    }
    for (const [H, C] of [[250, 0.05], [30, 0.1], [145, 0.12], [330, 0.2]]) {
      for (const T of [30, 50, 70, 90]) {
        const got = toneOf(toneHex(H, C, T));
        assert.ok(Math.abs(got - T) < 4, `H${H} C${C} T${T}: got ${got}`);
      }
    }
  });

  it('is the linear segment below L* 8 (very dark colours)', () => {
    const t = toneOf('#0A090B');
    assert.ok(t > 1 && t < 4, `got ${t}`);
  });
});

describe('color: resolveDark', () => {
  it("'dark' and 'light' ignore the cover", () => {
    assert.equal(resolveDark('dark', 0.95), true);
    assert.equal(resolveDark('light', 0.05), false);
  });

  it("'auto' follows the cover's mean lightness: below 0.5 is dark", () => {
    assert.equal(resolveDark('auto', 0.2), true);
    assert.equal(resolveDark('auto', 0.4999), true);
    assert.equal(resolveDark('auto', 0.5), false);
    assert.equal(resolveDark('auto', 0.9), false);
  });

  it('undefined (and any unknown mode) behaves like auto', () => {
    assert.equal(resolveDark(undefined, 0.2), true);
    assert.equal(resolveDark(undefined, 0.8), false);
    assert.equal(resolveDark('whatever', 0.2), true);
  });
});

/* ------------------------------------------------------------------ */
/* 封面分析：合成像素                                                  */
/* ------------------------------------------------------------------ */

const SIZE = 96;

/** 96×96 的纯色 RGBA 图。 */
function solid(rgb, alpha = 255) {
  const px = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let i = 0; i < px.length; i += 4) px.set([...rgb, alpha], i);
  return px;
}

/** 把矩形 [x0,x1)×[y0,y1) 涂成指定颜色。 */
function paint(px, x0, y0, x1, y1, rgb, alpha = 255) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) px.set([...rgb, alpha], (y * SIZE + x) * 4);
  }
  return px;
}

/** 两个 '#RRGGBB' 在 OKLab 里的欧氏距离。 */
function labDistance(hexA, hexB) {
  const lab = hex => {
    const { L, C, H } = hexToOklch(hex);
    return [L, C * Math.cos(H * Math.PI / 180), C * Math.sin(H * Math.PI / 180)];
  };
  const [a, b] = [lab(hexA), lab(hexB)];
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

const BLACK = [0, 0, 0];
const WHITE = [255, 255, 255];
const GREY = [128, 128, 128];
const GOLD = [212, 175, 55];
const BLUE = [35, 56, 156];          // #23389C
const CREAM = [244, 241, 232];
const RED = [200, 40, 40];

const FALLBACK = {
  swatches: [{ hex: FALLBACK_SEED, ...hexToOklch(FALLBACK_SEED), share: 1, role: 'base' }],
  defaultIndex: 0,
  accent: null,
  meanL: 0.5,
  focus: { x: 0.5, y: 0.5 },
  edges: { top: FALLBACK_SEED, bottom: FALLBACK_SEED },
};

describe('color: analyzePixels', () => {
  it('returns the documented shape', () => {
    const a = analyzePixels(paint(solid(BLACK), 40, 40, 54, 54, GOLD), SIZE);
    assert.deepEqual(Object.keys(a), ['swatches', 'defaultIndex', 'accent', 'meanL', 'focus', 'edges']);
    assert.deepEqual(Object.keys(a.swatches[0]), ['hex', 'L', 'C', 'H', 'share', 'role']);
    assert.deepEqual(Object.keys(a.focus), ['x', 'y']);
    assert.deepEqual(Object.keys(a.edges), ['top', 'bottom']);
    for (const s of a.swatches) {
      assert.match(s.hex, /^#[0-9A-F]{6}$/);
      assert.ok(['base', 'accent', 'vivid', 'neutral'].includes(s.role), s.role);
    }
    assert.equal(a.swatches[0].role, 'base');
  });

  it('is deterministic', () => {
    const px = paint(paint(solid(BLUE), 0, 0, 20, 20, CREAM), 70, 70, 84, 84, GOLD);
    assert.deepEqual(analyzePixels(px, SIZE), analyzePixels(px.slice(), SIZE));
  });

  it('mostly black with a ~2% gold patch: base black, accent gold', () => {
    const px = paint(solid(BLACK), 40, 40, 54, 54, GOLD);        // 196 px ≈ 2.1%
    const a = analyzePixels(px, SIZE);
    assert.equal(a.swatches[0].hex, '#000000');
    assert.ok(a.swatches[0].share > 0.97, `base share ${a.swatches[0].share}`);
    assert.equal(a.accent, rgbToHex(GOLD));
    assert.equal(a.swatches[1].hex, a.accent);
    assert.equal(a.swatches[1].role, 'accent');
    assert.equal(a.defaultIndex, 0, 'a black ground stays the default');
  });

  it('white ground with a blue figure: base white, blue present, defaultIndex 0', () => {
    const px = paint(solid(WHITE), 30, 20, 60, 60, BLUE);          // 1200 px ≈ 13%
    const a = analyzePixels(px, SIZE);
    assert.equal(a.swatches[0].hex, '#FFFFFF');
    const blue = a.swatches.find(s => hueDistance(s.H, hexToOklch('#23389C').H) < 10 && s.C > 0.1);
    assert.ok(blue, `no blue swatch in ${a.swatches.map(s => s.hex)}`);
    assert.equal(blue.role, 'accent');
    assert.equal(a.accent, blue.hex);
    assert.equal(a.defaultIndex, 0, 'a white ground stays the default');
  });

  it('all mid-grey: one grey base, no accent, centred focus', () => {
    const a = analyzePixels(solid(GREY), SIZE);
    assert.equal(a.swatches.length, 1);
    assert.equal(a.swatches[0].hex, '#808080');
    assert.equal(a.swatches[0].share, 1);
    assert.ok(a.swatches[0].C < 1e-3);
    assert.equal(a.accent, null);
    assert.equal(a.defaultIndex, 0);
    assert.deepEqual(a.focus, { x: 0.5, y: 0.5 });
    assert.ok(Math.abs(a.meanL - hexToOklch('#808080').L) < 1e-6);
  });

  it('deep blue with a 9% cream area: cream is a neutral swatch', () => {
    const px = paint(solid(BLUE), 10, 10, 39, 39, CREAM);          // 841 px ≈ 9.1%
    const a = analyzePixels(px, SIZE);
    assert.equal(a.swatches[0].hex, '#23389C');
    const neutral = a.swatches.find(s => s.role === 'neutral');
    assert.ok(neutral, `swatches ${JSON.stringify(a.swatches.map(s => [s.hex, s.role]))}`);
    assert.equal(neutral.hex, rgbToHex(CREAM));
    assert.ok(Math.abs(neutral.share - 841 / 9216) < 1e-9);
    assert.equal(a.accent, null, 'cream is not colourful enough to be an accent');
  });

  it('a neutral area needs 5% of the pixels', () => {
    const px = paint(solid(BLUE), 10, 10, 30, 30, CREAM);          // 400 px ≈ 4.3%
    assert.ok(!analyzePixels(px, SIZE).swatches.some(s => s.role === 'neutral'));
  });

  it('a bright saturated patch on the left third of a dull image pulls the focus left', () => {
    const dull = [125, 120, 115];
    const left = analyzePixels(paint(solid(dull), 8, 30, 28, 60, [255, 40, 40]), SIZE);
    assert.ok(left.focus.x < 0.4, `focus.x ${left.focus.x}`);
    assert.ok(left.focus.y > 0.3 && left.focus.y < 0.7, `focus.y ${left.focus.y}`);
    const right = analyzePixels(paint(solid(dull), 68, 30, 88, 60, [255, 40, 40]), SIZE);
    assert.ok(right.focus.x > 0.6, `focus.x ${right.focus.x}`);
  });

  it('focus stays inside the image', () => {
    const a = analyzePixels(paint(solid(BLACK), 0, 0, 12, 12, WHITE), SIZE);
    for (const v of [a.focus.x, a.focus.y]) assert.ok(v >= 0 && v <= 1, `focus ${JSON.stringify(a.focus)}`);
  });

  it('edges are the mean colour of the top and bottom 6% of rows (6 of 96)', () => {
    const top = [200, 40, 60], bottom = [20, 60, 160];
    const px = paint(solid(GREY), 0, 0, SIZE, 6, top);
    paint(px, 0, SIZE - 6, SIZE, SIZE, bottom);
    const a = analyzePixels(px, SIZE);
    assert.equal(a.edges.top, rgbToHex(top));
    assert.equal(a.edges.bottom, rgbToHex(bottom));
  });

  it('edges of a two-tone image are its two colours', () => {
    const px = paint(paint(solid(WHITE), 0, 0, SIZE, 48, [10, 80, 90]), 0, 48, SIZE, SIZE, [240, 200, 120]);
    const a = analyzePixels(px, SIZE);
    assert.equal(a.edges.top, '#0A505A');
    assert.equal(a.edges.bottom, '#F0C878');
  });

  it('edges average the rows when they are not uniform', () => {
    const px = paint(paint(solid(GREY), 0, 0, 48, 6, [100, 100, 100]), 48, 0, SIZE, 6, [200, 200, 200]);
    assert.equal(analyzePixels(px, SIZE).edges.top, '#969696');
  });

  it('meanL is the mean OKLab lightness', () => {
    assert.ok(analyzePixels(solid(BLACK), SIZE).meanL < 1e-6);
    assert.ok(Math.abs(analyzePixels(solid(WHITE), SIZE).meanL - 1) < 1e-4);
    const half = paint(solid(BLACK), 0, 0, SIZE, 48, WHITE);
    assert.ok(Math.abs(analyzePixels(half, SIZE).meanL - 0.5) < 1e-3);
  });

  it('swatch shares are fractions of the opaque pixels, largest first', () => {
    const px = paint(paint(solid(BLUE), 0, 0, SIZE, 20, RED), 0, 20, SIZE, 30, GOLD);
    const a = analyzePixels(px, SIZE);
    assert.equal(a.swatches[0].hex, '#23389C');
    assert.ok(Math.abs(a.swatches[0].share - 66 / 96) < 1e-9);
    assert.ok(a.swatches.reduce((sum, s) => sum + s.share, 0) <= 1 + 1e-9);
    assert.deepEqual(a.swatches.map(s => s.role), ['base', 'accent', 'vivid']);
    assert.equal(a.swatches[1].hex, rgbToHex(RED));
    assert.ok(Math.abs(a.swatches[1].share - 20 / 96) < 1e-9);
  });

  it('the accent is the vivid colour with the best sqrt(share) × chroma', () => {
    // 红的面积和彩度都比金色大，所以红是强调色，金色是普通的 vivid
    const px = paint(paint(solid(GREY), 0, 0, SIZE, 20, RED), 0, 20, SIZE, 24, GOLD);
    const a = analyzePixels(px, SIZE);
    assert.equal(a.accent, rgbToHex(RED));
    assert.deepEqual(a.swatches.map(s => s.role), ['base', 'accent', 'vivid']);
    assert.equal(a.swatches[2].hex, rgbToHex(GOLD));
  });

  it('no accent when every other colour is close to the base (OKLab distance < 0.15)', () => {
    const nearBlue = [50, 80, 170];
    assert.ok(labDistance(rgbToHex(BLUE), rgbToHex(nearBlue)) < 0.15);
    const a = analyzePixels(paint(solid(BLUE), 0, 0, SIZE, 40, nearBlue), SIZE);
    assert.equal(a.accent, null);
    assert.ok(a.swatches.every(s => s.role !== 'accent'));
  });

  it('a tiny speck (< 0.6% of the pixels) is neither a swatch nor an accent', () => {
    const speck = paint(solid(BLUE), 0, 0, 6, 6, GOLD);            // 36 px ≈ 0.4%
    const a = analyzePixels(speck, SIZE);
    assert.equal(a.swatches.length, 1);
    assert.equal(a.accent, null);
    const patch = paint(solid(BLUE), 0, 0, 8, 8, GOLD);            // 64 px ≈ 0.7%
    assert.equal(analyzePixels(patch, SIZE).accent, rgbToHex(GOLD));
  });

  it('keeps at most 6 swatches, all at least 0.12 apart', () => {
    const hues = [[220, 40, 40], [230, 150, 30], [220, 210, 40], [40, 170, 60], [40, 180, 190], [40, 90, 220], [170, 50, 190], [240, 100, 170]];
    const px = solid(GREY);
    hues.forEach((rgb, i) => paint(px, 0, i * 8, SIZE, i * 8 + 8, rgb));
    const a = analyzePixels(px, SIZE);
    assert.equal(a.swatches.length, 6);
    for (let i = 0; i < a.swatches.length; i++) {
      for (let j = i + 1; j < a.swatches.length; j++) {
        const d = labDistance(a.swatches[i].hex, a.swatches[j].hex);
        assert.ok(d >= 0.11, `${a.swatches[i].hex} vs ${a.swatches[j].hex} = ${d}`);
      }
    }
  });

  describe('defaultIndex', () => {
    it('is 1 when the base is a mid grey and colour covers at least 20%', () => {
      const a = analyzePixels(paint(solid(GREY), 0, 0, SIZE, 29, RED), SIZE);      // 30% red
      assert.equal(a.defaultIndex, 1);
      assert.equal(a.swatches[a.defaultIndex].hex, rgbToHex(RED));
    });

    it('stays 0 when colour covers less than 20%', () => {
      assert.equal(analyzePixels(paint(solid(GREY), 0, 0, SIZE, 9, RED), SIZE).defaultIndex, 0);   // 9%
    });

    it('stays 0 on a black or white ground, however colourful the rest is', () => {
      assert.equal(analyzePixels(paint(solid(BLACK), 0, 0, SIZE, 29, RED), SIZE).defaultIndex, 0);
      assert.equal(analyzePixels(paint(solid(WHITE), 0, 0, SIZE, 29, BLUE), SIZE).defaultIndex, 0);
    });

    it('stays 0 when the base itself is colourful', () => {
      assert.equal(analyzePixels(paint(solid(BLUE), 0, 0, SIZE, 29, GOLD), SIZE).defaultIndex, 0);
    });
  });

  describe('transparency', () => {
    it('a fully transparent image falls back', () => {
      assert.deepEqual(analyzePixels(solid(BLUE, 0), SIZE), FALLBACK);
    });

    it('transparent pixels are skipped, whatever colour they carry', () => {
      const px = paint(solid([255, 0, 0], 0), 0, 0, SIZE, 48, BLUE);
      const a = analyzePixels(px, SIZE);
      assert.equal(a.swatches.length, 1);
      assert.equal(a.swatches[0].hex, '#23389C');
      assert.equal(a.swatches[0].share, 1);
      assert.equal(a.edges.top, '#23389C');
      assert.equal(a.edges.bottom, '#23389C', 'the bottom rows are all transparent: falls back to the base colour');
    });

    it('alpha 199 is skipped, alpha 200 is counted', () => {
      assert.deepEqual(analyzePixels(solid(BLUE, 199), SIZE), FALLBACK);
      assert.equal(analyzePixels(solid(BLUE, 200), SIZE).swatches[0].hex, '#23389C');
    });
  });

  it('works on a Uint8Array and on other square sizes', () => {
    const size = 32;
    const px = new Uint8Array(size * size * 4);
    for (let i = 0; i < px.length; i += 4) px.set([...BLACK, 255], i);
    for (let y = 10; y < 16; y++) for (let x = 10; x < 16; x++) px.set([...GOLD, 255], (y * size + x) * 4);
    const a = analyzePixels(px, size);
    assert.equal(a.swatches[0].hex, '#000000');
    assert.equal(a.accent, rgbToHex(GOLD));
  });
});

/* ------------------------------------------------------------------ */
/* analyzeCover：用假的 canvas 检查裁切；没有 DOM 时不抛错             */
/* ------------------------------------------------------------------ */

/** 在 globalThis.document 上装一个假 canvas，跑 fn，再还原。fn 收到 drawImage 的调用记录。 */
function withFakeCanvas(getImageData, fn) {
  const calls = [];
  const ctx = { drawImage: (...args) => calls.push(args), getImageData };
  const had = 'document' in globalThis;
  const before = globalThis.document;
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
  try {
    return fn(calls);
  } finally {
    if (had) globalThis.document = before; else delete globalThis.document;
  }
}

describe('color: analyzeCover', () => {
  const pixels = paint(solid(BLACK), 40, 40, 54, 54, GOLD);
  const fromPixels = () => ({ data: pixels });

  it('crops a landscape source to its centre square and samples it at 96×96', () => {
    const source = { width: 200, height: 100 };               // canvas / ImageBitmap / OffscreenCanvas 都只有 width / height
    withFakeCanvas(fromPixels, calls => {
      const a = analyzeCover(source);
      assert.deepEqual(calls, [[source, 50, 0, 100, 100, 0, 0, 96, 96]]);
      assert.deepEqual(a, analyzePixels(pixels, 96));
      assert.equal(a.accent, rgbToHex(GOLD));
    });
  });

  it('crops a portrait source to its centre square, using naturalWidth / naturalHeight of an <img>', () => {
    const img = { naturalWidth: 120, naturalHeight: 300, width: 40, height: 100 };   // 显示尺寸与原图不同
    withFakeCanvas(fromPixels, calls => {
      analyzeCover(img);
      assert.deepEqual(calls, [[img, 0, 90, 120, 120, 0, 0, 96, 96]]);
    });
  });

  it('a square source is drawn whole', () => {
    const source = { width: 600, height: 600 };
    withFakeCanvas(fromPixels, calls => {
      analyzeCover(source);
      assert.deepEqual(calls[0].slice(1), [0, 0, 600, 600, 0, 0, 96, 96]);
    });
  });

  it('a tainted canvas (getImageData throws) falls back instead of throwing', () => {
    const throwing = () => { throw new DOMException('tainted', 'SecurityError'); };
    withFakeCanvas(throwing, () => {
      assert.deepEqual(analyzeCover({ width: 100, height: 100 }), FALLBACK);
    });
  });

  it('an unusable source falls back instead of throwing', () => {
    withFakeCanvas(fromPixels, () => {
      assert.deepEqual(analyzeCover({}), FALLBACK);
      assert.deepEqual(analyzeCover({ width: 0, height: 0 }), FALLBACK);       // 图片还没加载完
      assert.deepEqual(analyzeCover({ naturalWidth: 0, naturalHeight: 0, width: 0, height: 0 }), FALLBACK);
      assert.deepEqual(analyzeCover(null), FALLBACK);
      assert.deepEqual(analyzeCover(undefined), FALLBACK);
    });
  });

  it('without a DOM or OffscreenCanvas it falls back', () => {
    assert.equal(typeof document, 'undefined');
    assert.deepEqual(analyzeCover({ width: 100, height: 100 }), FALLBACK);
  });

  it('every fallback is a fresh object', () => {
    const a = analyzeCover(null);
    a.swatches[0].hex = '#000000';
    a.focus.x = 0;
    assert.equal(analyzeCover(null).swatches[0].hex, FALLBACK_SEED);
    assert.equal(analyzeCover(null).focus.x, 0.5);
  });
});

/* ------------------------------------------------------------------ */
/* cardPalette                                                         */
/* ------------------------------------------------------------------ */

const SEEDS = {
  'deep blue': '#0A2E86',
  'pale pink': '#FBACAC',
  'near black': '#0A090B',
  'mid grey': '#939393',
  'neon': '#FF05E2',
  'mid sea blue': '#5B96BA',
};
const CHROMATIC = ['deep blue', 'pale pink', 'neon', 'mid sea blue'];
const STYLES = ['content', 'tonal', 'vibrant', 'mono'];
// 'auto' 要用封面平均亮度决定明暗：深、浅封面各测一次
const MODES = [['auto', 0.3], ['auto', 0.7], ['light', 0.5], ['dark', 0.5]];

/** 黑或白能对 bg 达到的最大对比度。 */
const bestContrast = bg => Math.max(contrast(bg, '#000000'), contrast(bg, '#FFFFFF'));

/**
 * `on`（正文色）的对比度目标：黑或白能到 7 就要 7；亮度约 0.10–0.30 的中间调背景黑白都够不到 7，
 * 这时取能达到的最大值减 0.05。任何情况都不低于 4.5。
 */
function onTarget(bg) {
  const best = bestContrast(bg);
  return Math.max(4.5, best >= 7 ? 7 : best - 0.05);
}

function assertReadable(fg, bg, need, label) {
  assert.ok(contrast(fg, bg) >= need, `${label}: ${fg} on ${bg} = ${contrast(fg, bg).toFixed(2)}, need ${need.toFixed(2)}`);
}

/** 彩色种子网格：色相每 30° × 5 个色调 × 3 档彩度，加几个命名种子，只留彩度 ≥ 0.04 的。 */
const GRID_SEEDS = (() => {
  const seeds = new Set(['#0A2E86', '#FBACAC', '#FF05E2', '#5B96BA', '#E9BE6A']);
  for (let H = 0; H < 360; H += 30) {
    for (const T of [25, 40, 55, 70, 85]) {
      for (const C of [0.06, 0.12, 0.2]) seeds.add(toneHex(H, C, T));
    }
  }
  return [...seeds].filter(hex => hexToOklch(hex).C >= 0.04);
})();

// palette() 的色调对有彩色只是近似（见 toneOf 的测试），按 toneOf 量出来的值最多偏几个点
const TONE_SLACK = 4;

/** OKLab ΔE × 100。 */
function deltaE(hexA, hexB) {
  return labDistance(hexA, hexB) * 100;
}

describe('color: cardPalette', () => {
  it('returns the documented shape', () => {
    const p = cardPalette({ seed: '#5B96BA', accent: '#E9BE6A', style: 'tonal', mode: 'light', meanL: 0.6 });
    assert.deepEqual(Object.keys(p), ['bg', 'container', 'on', 'onVar', 'accent', 'isDark', 'track', 'shadow']);
    for (const k of ['bg', 'container', 'on', 'onVar', 'accent']) assert.match(p[k], /^#[0-9A-F]{6}$/, k);
    assert.equal(typeof p.isDark, 'boolean');
    assert.match(p.track, /^rgba\(\d+, \d+, \d+, 0\.16\)$/);
    assert.match(p.shadow, /^rgba\(\d+, \d+, \d+, 0\.25\)$/);
  });

  it('text, secondary text and accent are readable on every seed × style × mode', () => {
    let sevenRequired = 0;
    const seeds = [...Object.values(SEEDS), ...GRID_SEEDS];
    for (const seed of seeds) {
      for (const style of STYLES) {
        for (const [mode, meanL] of MODES) {
          for (const accent of seed === SEEDS['mid sea blue'] ? [null, '#E9BE6A', '#2A6FDB'] : [null]) {
            const p = cardPalette({ seed, accent, style, mode, meanL });
            const label = `${seed} ${style} ${mode} meanL ${meanL} accent ${accent}`;
            const need = onTarget(p.bg);
            if (need === 7) sevenRequired++;
            assertReadable(p.on, p.bg, need, `on, ${label}`);
            assertReadable(p.onVar, p.bg, 4.5, `onVar, ${label}`);
            assertReadable(p.accent, p.bg, 4.5, `accent, ${label}`);
          }
        }
      }
    }
    assert.ok(sevenRequired > 500, `only ${sevenRequired} combinations required a full 7:1`);
  });

  it('tonal and mono backgrounds always leave room for 7:1 text', () => {
    for (const seed of Object.values(SEEDS)) {
      for (const [mode, meanL] of MODES) {
        for (const style of ['tonal', 'mono']) {
          const p = cardPalette({ seed, style, mode, meanL });
          assert.ok(contrast(p.on, p.bg) >= 7, `${seed} ${style} ${mode}: ${contrast(p.on, p.bg)}`);
          assert.ok(contrast(p.onVar, p.bg) >= 4.5 && contrast(p.accent, p.bg) >= 4.5);
        }
      }
    }
  });

  it('isDark follows the background, container sits one step further from it, track and shadow derive from on', () => {
    for (const seed of Object.values(SEEDS)) {
      for (const style of STYLES) {
        for (const [mode, meanL] of MODES) {
          const p = cardPalette({ seed, style, mode, meanL });
          assert.equal(p.isDark, contrast(p.bg, '#FFFFFF') >= contrast(p.bg, '#000000'));
          const step = toneOf(p.container) - toneOf(p.bg);
          if (p.isDark) assert.ok(step > 2, `${seed} ${style} ${mode}: container ${p.container} on ${p.bg}`);
          else assert.ok(step < -2, `${seed} ${style} ${mode}: container ${p.container} on ${p.bg}`);
          assert.equal(p.track, withAlpha(p.on, 0.16));
          assert.equal(p.shadow, p.isDark ? 'rgba(0, 0, 0, 0.5)' : withAlpha(p.on, 0.25));
        }
      }
    }
  });

  describe('content 忠实', () => {
    it("auto keeps the cover's own colour at any tone: mid tones survive", () => {
      for (const meanL of [0.2, 0.8]) {
        assert.equal(cardPalette({ seed: '#5B96BA', style: 'content', mode: 'auto', meanL }).bg, '#5B96BA');
      }
      for (const seed of ['#0A2E86', '#FBACAC', '#0A090B', '#939393', '#5B96BA']) {
        assert.equal(cardPalette({ seed, style: 'content', mode: 'auto', meanL: 0.3 }).bg, seed);
      }
    });

    it('is the default style, and an unknown style behaves like it', () => {
      const args = { seed: '#5B96BA', accent: '#E9BE6A', mode: 'auto', meanL: 0.3 };
      assert.deepEqual(cardPalette({ ...args, style: 'nope' }), cardPalette({ ...args, style: 'content' }));
      assert.deepEqual(cardPalette(args), cardPalette({ ...args, style: 'content' }));
    });

    it('a forced mode keeps a seed whose tone already fits (dark ≤ 32, light ≥ 72)', () => {
      assert.equal(cardPalette({ seed: '#0A2E86', mode: 'dark' }).bg, '#0A2E86');
      assert.equal(cardPalette({ seed: '#FBACAC', mode: 'light' }).bg, '#FBACAC');
      assert.equal(cardPalette({ seed: '#0A090B', mode: 'dark' }).bg, '#0A090B');
    });

    it('the keep / move boundary sits at tone 32 (dark) and 72 (light)', () => {
      const dark = hex => cardPalette({ seed: hex, mode: 'dark' }).bg;
      const light = hex => cardPalette({ seed: hex, mode: 'light' }).bg;
      const keepDark = toneHex(250, 0.05, 31), moveDark = toneHex(250, 0.05, 36);
      assert.ok(toneOf(keepDark) <= 32 && toneOf(moveDark) > 32);
      assert.equal(dark(keepDark), keepDark);
      assert.notEqual(dark(moveDark), moveDark);
      const keepLight = toneHex(250, 0.05, 74), moveLight = toneHex(250, 0.05, 68);
      assert.ok(toneOf(keepLight) >= 72 && toneOf(moveLight) < 72);
      assert.equal(light(keepLight), keepLight);
      assert.notEqual(light(moveLight), moveLight);
    });

    it('a forced mode moves a seed whose tone does not fit to tone 26 (dark) / 76 (light), same hue', () => {
      const seed = '#5B96BA';
      const dark = cardPalette({ seed, mode: 'dark' }).bg;
      const light = cardPalette({ seed, mode: 'light' }).bg;
      assert.ok(Math.abs(toneOf(dark) - 26) < TONE_SLACK, `dark ${dark} tone ${toneOf(dark)}`);
      assert.ok(Math.abs(toneOf(light) - 76) < TONE_SLACK, `light ${light} tone ${toneOf(light)}`);
      for (const bg of [dark, light]) assert.ok(hueDistance(hexToOklch(bg).H, hexToOklch(seed).H) < 8);

      assert.ok(Math.abs(toneOf(cardPalette({ seed: '#0A2E86', mode: 'light' }).bg) - 76) < TONE_SLACK);
      assert.ok(Math.abs(toneOf(cardPalette({ seed: '#FBACAC', mode: 'dark' }).bg) - 26) < TONE_SLACK);
    });

    it('a neon seed is softened to chroma ≤ 0.2 at the same tone', () => {
      const seed = '#FF05E2';
      assert.ok(hexToOklch(seed).C > 0.22);
      for (const [mode, meanL] of MODES) {
        const { bg } = cardPalette({ seed, style: 'content', mode, meanL });
        assert.ok(hexToOklch(bg).C <= 0.205, `${mode}: chroma ${hexToOklch(bg).C}`);
      }
      const auto = cardPalette({ seed, style: 'content', mode: 'auto', meanL: 0.3 }).bg;
      assert.ok(Math.abs(toneOf(auto) - toneOf(seed)) < TONE_SLACK, `tone ${toneOf(auto)} vs ${toneOf(seed)}`);
      assert.ok(hueDistance(hexToOklch(auto).H, hexToOklch(seed).H) < 8);
    });

    it('a seed at chroma 0.22 or below is not softened', () => {
      const seed = '#D11E6A';
      assert.ok(hexToOklch(seed).C <= 0.22 && hexToOklch(seed).C > 0.2, `chroma ${hexToOklch(seed).C}`);
      assert.equal(cardPalette({ seed, style: 'content', mode: 'auto' }).bg, seed);
    });
  });

  describe('tonal 柔和', () => {
    const tonalChroma = hex => Math.min(Math.max(hexToOklch(hex).C * 0.45, 0.02), 0.05);

    it('is the seed hue at low chroma (≤ 0.05) and a soft tone: 14–36 in dark, 74–92 in light', () => {
      for (const name of CHROMATIC) {
        const seed = SEEDS[name];
        const light = cardPalette({ seed, style: 'tonal', mode: 'light' }).bg;
        const dark = cardPalette({ seed, style: 'tonal', mode: 'dark' }).bg;
        assert.ok(toneOf(light) >= 74 - TONE_SLACK && toneOf(light) <= 92 + TONE_SLACK, `${name}: ${light} tone ${toneOf(light)}`);
        assert.ok(toneOf(dark) >= 14 - TONE_SLACK && toneOf(dark) <= 36 + TONE_SLACK, `${name}: ${dark} tone ${toneOf(dark)}`);
        for (const bg of [light, dark]) assert.ok(hexToOklch(bg).C <= 0.055, `${name}: ${bg} chroma ${hexToOklch(bg).C}`);
        assert.ok(hueDistance(hexToOklch(dark).H, hexToOklch(seed).H) < 12, `${name}: hue`);
      }
    });

    it('takes the first tone in the order 18, 22, 14, 26 (dark) / 88, 84, 92, 80 (light) that clears 8 from content and mono', () => {
      // 深蓝：忠实在 23，单色在 8，18 已经够远
      const blue = hexToOklch('#0A2E86');
      assert.equal(cardPalette({ seed: '#0A2E86', style: 'tonal', mode: 'dark' }).bg, toneHex(blue.H, 0.05, 18));
      // 强制浅色：深蓝的忠实被挪到 76，单色在 98，88 夹在中间够远
      assert.equal(cardPalette({ seed: '#0A2E86', style: 'tonal', mode: 'light' }).bg, toneHex(blue.H, 0.05, 88));
    });

    it('moves on to later tones when the first is too close, and still clears 8 from content and mono', () => {
      // 忠实在 25 附近：18 离它不够远
      const seed = '#09453D';
      const first = toneHex(hexToOklch(seed).H, tonalChroma(seed), 18);
      const mono = cardPalette({ seed, style: 'mono', mode: 'dark' }).bg;
      assert.ok(deltaE(first, seed) < 8 || deltaE(first, mono) < 8, 'test seed should reject tone 18');
      const tonal = cardPalette({ seed, style: 'tonal', mode: 'dark' }).bg;
      assert.notEqual(tonal, first);
      assert.ok(deltaE(tonal, seed) >= 8, `content ${deltaE(tonal, seed)}`);
      assert.ok(deltaE(tonal, mono) >= 8, `mono ${deltaE(tonal, mono)}`);
    });

    it('auto picks light or dark from meanL', () => {
      assert.equal(cardPalette({ seed: '#5B96BA', style: 'tonal', mode: 'auto', meanL: 0.2 }).isDark, true);
      assert.equal(cardPalette({ seed: '#5B96BA', style: 'tonal', mode: 'auto', meanL: 0.8 }).isDark, false);
    });
  });

  describe('vibrant 鲜明', () => {
    it('on a grey seed with no accent gives pure black / white, whichever stands apart from the other styles', () => {
      // A mid grey in dark mode gets black; in light mode white would sit on mono (tone 98), so it gets black too.
      assert.equal(cardPalette({ seed: '#939393', accent: null, style: 'vibrant', mode: 'dark' }).bg, '#000000');
      assert.equal(cardPalette({ seed: '#939393', accent: null, style: 'vibrant', mode: 'light' }).bg, '#000000');
      // A near-black cover in dark mode keeps black: OKLab already puts #0A090B ~14 ΔE from #000000.
      // A white cover in light mode (and on auto) gets black.
      assert.equal(cardPalette({ seed: '#FFFFFF', accent: null, style: 'vibrant', mode: 'light' }).bg, '#000000');
      assert.equal(cardPalette({ seed: '#F4F2EE', accent: null, style: 'vibrant', mode: 'auto', meanL: 0.97 }).bg, '#000000');
      for (const seed of ['#939393', '#0A090B', '#FFFFFF', '#F4F2EE', '#5A5A5A']) {
        for (const [mode, meanL] of [['light', 0.5], ['dark', 0.5], ['auto', 0.2], ['auto', 0.9]]) {
          const pal = (style) => cardPalette({ seed, accent: null, style, mode, meanL }).bg;
          const v = pal('vibrant');
          assert.ok(['#000000', '#FFFFFF'].includes(v), `${seed} ${mode}: ${v}`);
          for (const other of ['content', 'tonal', 'mono']) {
            assert.ok(deltaE(v, pal(other)) >= 8, `${seed} ${mode}/${meanL}: vibrant ${v} vs ${other} ${pal(other)} ΔE ${deltaE(v, pal(other)).toFixed(1)}`);
          }
        }
      }
    });

    it("on a grey seed with an accent takes the accent's hue at high chroma", () => {
      const gold = '#E9BE6A';
      for (const mode of ['light', 'dark']) {
        const { bg } = cardPalette({ seed: '#939393', accent: gold, style: 'vibrant', mode });
        assert.ok(hexToOklch(bg).C > 0.1, `${mode}: ${bg} chroma ${hexToOklch(bg).C}`);
        assert.ok(hueDistance(hexToOklch(bg).H, hexToOklch(gold).H) < 12, `${mode}: ${bg}`);
      }
    });

    it('a chromatic seed ignores the accent', () => {
      const a = cardPalette({ seed: '#0A2E86', accent: null, style: 'vibrant', mode: 'dark' }).bg;
      const b = cardPalette({ seed: '#0A2E86', accent: '#E9BE6A', style: 'vibrant', mode: 'dark' }).bg;
      assert.equal(a, b);
    });

    it('is a mid-tone colour at nearly the hue\'s peak chroma; dark mode is no lighter than light mode', () => {
      for (const name of CHROMATIC) {
        const seed = SEEDS[name];
        const dark = cardPalette({ seed, style: 'vibrant', mode: 'dark' }).bg;
        const light = cardPalette({ seed, style: 'vibrant', mode: 'light' }).bg;
        for (const bg of [dark, light]) {
          assert.ok(toneOf(bg) >= 24 && toneOf(bg) <= 78, `${name}: ${bg} tone ${toneOf(bg)}`);
          assert.ok(hexToOklch(bg).C > 0.12, `${name}: ${bg} chroma ${hexToOklch(bg).C}`);
        }
        assert.ok(toneOf(dark) <= toneOf(light), `${name}: dark ${dark} vs light ${light}`);
      }
    });
  });

  describe('vibrant separation', () => {
    it("moves away from content's tone when its peak-chroma tone collides, without touching content or mono", () => {
      // 青色：强制浅色时忠实被挪到色调 76，鲜明的起点也在 76 附近
      const seed = '#00C0D8';
      const content = cardPalette({ seed, style: 'content', mode: 'light' }).bg;
      const vibrant = cardPalette({ seed, style: 'vibrant', mode: 'light' }).bg;
      const mono = cardPalette({ seed, style: 'mono', mode: 'light' }).bg;
      assert.equal(content, toneHex(hexToOklch(seed).H, hexToOklch(seed).C, 76));
      assert.equal(mono, toneHex(0, 0, 98));
      assert.ok(deltaE(vibrant, content) >= 8, `content ${deltaE(vibrant, content)}`);
      assert.ok(toneOf(vibrant) < toneOf(content), `vibrant ${vibrant} should be darker than content ${content}`);
      assert.ok(hexToOklch(vibrant).C > 0.1, `still colourful: ${vibrant}`);
    });

    it('a grey seed with an accent also keeps its vibrant background apart from the others', () => {
      for (const seed of ['#6E6E6E', '#808080', '#939393', '#C8C8C8', '#3A3A3A']) {
        for (const accent of ['#E9BE6A', '#2A6FDB', '#C82828', '#2FA39A']) {
          for (const [mode, meanL] of MODES) {
            const bgs = STYLES.map(style => cardPalette({ seed, accent, style, mode, meanL }).bg);
            for (let i = 0; i < bgs.length; i++) {
              for (let j = i + 1; j < bgs.length; j++) {
                if (STYLES[i] === 'content' || STYLES[j] === 'content') continue;      // 灰色种子的忠实本来就是灰，不在这里要求
                assert.ok(deltaE(bgs[i], bgs[j]) >= 8, `${seed} ${accent} ${mode} ${meanL}: ${STYLES[i]}/${STYLES[j]} ${deltaE(bgs[i], bgs[j]).toFixed(1)}`);
              }
            }
          }
        }
      }
    });
  });

  describe('mono 单色', () => {
    it('is pure grey, tone 98 (light) / 8 (dark), and never moves, whatever the seed', () => {
      for (const seed of Object.values(SEEDS)) {
        const light = cardPalette({ seed, style: 'mono', mode: 'light' }).bg;
        const dark = cardPalette({ seed, style: 'mono', mode: 'dark' }).bg;
        for (const bg of [light, dark]) {
          const [r, g, b] = hexToRgb(bg);
          assert.ok(r === g && g === b, `${seed}: ${bg}`);
        }
        assert.equal(light, toneHex(0, 0, 98));
        assert.equal(dark, toneHex(0, 0, 8));
        assert.ok(Math.abs(toneOf(light) - 98) < 1);
        assert.ok(Math.abs(toneOf(dark) - 8) < 1);
      }
    });

    it('keeps the cover accent as the only colour', () => {
      const gold = '#E9BE6A';
      const p = cardPalette({ seed: '#0A2E86', accent: gold, style: 'mono', mode: 'dark' });
      assert.ok(hexToOklch(p.accent).C > 0.05, `accent ${p.accent}`);
      assert.ok(hueDistance(hexToOklch(p.accent).H, hexToOklch(gold).H) < 12, `accent ${p.accent}`);
      for (const k of ['bg', 'container', 'on', 'onVar']) assert.ok(hexToOklch(p[k]).C < 0.03, `${k} ${p[k]}`);
    });
  });

  describe('accent colour', () => {
    it('keeps the cover accent when its hue differs from the background hue', () => {
      const gold = '#E9BE6A';
      for (const style of STYLES) {
        const p = cardPalette({ seed: '#0A2E86', accent: gold, style, mode: 'dark' });
        assert.ok(hueDistance(hexToOklch(p.accent).H, hexToOklch(gold).H) < 15, `${style}: ${p.accent}`);
      }
    });

    it('swaps an accent that is too close to a colourful background hue for the complement', () => {
      const p = cardPalette({ seed: '#0A2E86', accent: '#2A6FDB', style: 'content', mode: 'dark' });
      const bgHue = hexToOklch(p.bg).H;
      assert.ok(hueDistance(hexToOklch(p.accent).H, bgHue) > 120, `accent ${p.accent} on ${p.bg}`);
    });

    it('with no accent, uses the complement of a colourful background and a neutral tone on grey', () => {
      const blue = cardPalette({ seed: '#0A2E86', accent: null, style: 'content', mode: 'dark' });
      assert.ok(hueDistance(hexToOklch(blue.accent).H, hexToOklch(blue.bg).H) > 120);
      const grey = cardPalette({ seed: '#939393', accent: null, style: 'mono', mode: 'dark' });
      assert.ok(hexToOklch(grey.accent).C > 0.02, `accent ${grey.accent}`);
    });
  });

  describe('style separation', () => {
    const PAIRS = STYLES.flatMap((a, i) => STYLES.slice(i + 1).map(b => [a, b]));
    const bgsOf = (seed, mode, meanL) => Object.fromEntries(
      STYLES.map(style => [style, cardPalette({ seed, accent: null, style, mode, meanL }).bg]),
    );
    const chromaOf = hex => hexToOklch(hex).C;

    it('every pair of the four styles differs by ΔE ≥ 8 for every chromatic seed in every mode', () => {
      const min = Object.fromEntries(PAIRS.map(([a, b]) => [`${a}/${b}`, { d: Infinity, where: '-' }]));
      const failures = [];
      for (const seed of GRID_SEEDS) {
        for (const [mode, meanL] of MODES) {
          const b = bgsOf(seed, mode, meanL);
          for (const [x, y] of PAIRS) {
            const pair = `${x}/${y}`;
            const d = deltaE(b[x], b[y]);
            const where = `${seed} ${mode}${mode === 'auto' ? ' ' + meanL : ''}`;
            if (d < min[pair].d) min[pair] = { d, where };
            if (d < 8) failures.push({ pair, d, where });
          }
        }
      }

      const total = GRID_SEEDS.length * MODES.length * PAIRS.length;
      console.log([
        `style separation: ${GRID_SEEDS.length} chromatic seeds × ${MODES.length} modes (auto counted for meanL 0.3 and 0.7) × ${PAIRS.length} pairs = ${total} cases, ${failures.length} below 8`,
        '  minimum ΔE per pair (worst case)',
        ...PAIRS.map(([a, b]) => `  ${`${a}/${b}`.padEnd(16)} ${min[`${a}/${b}`].d.toFixed(1).padStart(5)} (${min[`${a}/${b}`].where})`),
      ].join('\n'));

      const report = PAIRS.map(([a, b]) => failures.filter(f => f.pair === `${a}/${b}`))
        .filter(list => list.length)
        .map(list => {
          const worst = list.reduce((m, c) => (c.d < m.d ? c : m));
          return `${worst.pair}: ${list.length} below 8, worst ${worst.d.toFixed(1)} (${worst.where})`;
        });
      assert.equal(failures.length, 0, report.join('; '));
    });

    it('achromatic seeds: vibrant is ≥ 8 from tonal; on a mid grey content is ≥ 8 from vibrant', () => {
      const greys = ['#000000', '#0A090B', '#3A3A3A', '#6E6E6E', '#808080', '#939393', '#C8C8C8', '#FFFFFF'];
      let midGreys = 0;
      for (const seed of greys) {
        assert.ok(chromaOf(seed) < 0.04, seed);
        const mid = toneOf(seed) >= 35 && toneOf(seed) <= 65;
        if (mid) midGreys++;
        for (const [mode, meanL] of MODES) {
          const b = bgsOf(seed, mode, meanL);
          assert.ok(deltaE(b.vibrant, b.tonal) >= 8, `${seed} ${mode} ${meanL}: vibrant/tonal ${deltaE(b.vibrant, b.tonal).toFixed(1)}`);
          if (mid) assert.ok(deltaE(b.content, b.vibrant) >= 8, `${seed} ${mode} ${meanL}: content/vibrant ${deltaE(b.content, b.vibrant).toFixed(1)}`);
        }
      }
      assert.equal(midGreys, 3);
    });
  });
});

/* ================================================================== */
/* lyrics.js                                                           */
/* ================================================================== */

describe('lyrics: stripLrc', () => {
  it('removes every timestamp form', () => {
    assert.equal(stripLrc('[00:12.34]hello'), 'hello');
    assert.equal(stripLrc('[00:12.345]hello'), 'hello');
    assert.equal(stripLrc('[01:02:03]hello'), 'hello');
    assert.equal(stripLrc('[00:12] hello'), 'hello');
    assert.equal(stripLrc('[123:45.67]hello'), 'hello');
    assert.equal(stripLrc('[00:01.00][00:02.50]hello'), 'hello');
    assert.equal(stripLrc('[00:01.00]hello [00:02.00]world'), 'hello world');
    assert.equal(stripLrc('[00:01.00]<00:01.00>hel<00:01.40>lo'), 'hello');
  });

  it('removes metadata tags', () => {
    assert.equal(stripLrc('[ti:Song]'), '');
    assert.equal(stripLrc('[ar:Someone]'), '');
    assert.equal(stripLrc('[al:Album]'), '');
    assert.equal(stripLrc('[by:me]'), '');
    assert.equal(stripLrc('[offset:+500]'), '');
    assert.equal(stripLrc('[ti:八月のホーム]'), '');
  });

  it('keeps ordinary brackets and plain text', () => {
    assert.equal(stripLrc('[Chorus] hello'), '[Chorus] hello');
    assert.equal(stripLrc('今日も晴れてるよ'), '今日も晴れてるよ');
    assert.equal(stripLrc('a [1] b'), 'a [1] b');
    assert.equal(stripLrc(''), '');
  });
});

describe('lyrics: parseLyrics', () => {
  it('empty input returns [] in every mode', () => {
    for (const mode of ['bilingual', 'blocks', 'single']) {
      assert.deepEqual(parseLyrics('', mode), []);
      assert.deepEqual(parseLyrics('  \n\n \t \n', mode), []);
      assert.deepEqual(parseLyrics(null, mode), []);
      assert.deepEqual(parseLyrics(undefined, mode), []);
      assert.deepEqual(parseLyrics('[ti:x]\n[00:01.00]\n', mode), []);
    }
  });

  it('bilingual (default): pairs of lines, blank lines ignored, odd line has an empty translation', () => {
    const raw = [
      '誰もいないホームに 夏の光が落ちてた',
      '空无一人的站台上，落着夏天的光',
      '',
      '時計の針だけが 少し先を歩いてく',
      '只有时钟的指针，先一步走远了',
      '',
      '',
      '今日も晴れてるよ 君のいない町でも',
    ].join('\n');
    const expected = [
      { o: '誰もいないホームに 夏の光が落ちてた', t: '空无一人的站台上，落着夏天的光' },
      { o: '時計の針だけが 少し先を歩いてく', t: '只有时钟的指针，先一步走远了' },
      { o: '今日も晴れてるよ 君のいない町でも', t: '' },
    ];
    assert.deepEqual(parseLyrics(raw), expected);
    assert.deepEqual(parseLyrics(raw, 'bilingual'), expected);
  });

  it('bilingual: the full CONTRACT sample gives 6 groups', () => {
    const raw = [
      '誰もいないホームに 夏の光が落ちてた', '空无一人的站台上，落着夏天的光',
      '時計の針だけが 少し先を歩いてく', '只有时钟的指针，先一步走远了',
      '今日も晴れてるよ 君のいない町でも', '今天也是晴天哦，在没有你的小镇也是',
      '白いシャツが 風の形を覚えてる', '白衬衫还记得风的形状',
      '次の電車は来ないと 知っていたのに', '明明知道下一班电车不会来',
      'ここでまだ 空の青さを数えてる', '我还在这里，数着天空有多蓝',
    ].join('\n');
    const groups = parseLyrics(raw, 'bilingual');
    assert.equal(groups.length, 6);
    assert.equal(groups[5].o, 'ここでまだ 空の青さを数えてる');
    assert.equal(groups[5].t, '我还在这里，数着天空有多蓝');
  });

  it('single: one group per non-empty line, no translation', () => {
    assert.deepEqual(parseLyrics('a\n\nb\r\nc\n\n\n', 'single'), [
      { o: 'a', t: '' }, { o: 'b', t: '' }, { o: 'c', t: '' },
    ]);
  });

  it('blocks: 1 / 2 / 3 / 4 line blocks', () => {
    const raw = [
      'one',                       // 1 行 → 只有原文
      '',
      'two-o', 'two-t',            // 2 行 → 原文 + 译文
      '',
      'three-o', 'three-t1', 'three-t2',               // 奇数行 → 第一行原文，其余译文
      '',
      'four-o1', 'four-o2', 'four-t1', 'four-t2',      // 偶数行 → 前一半原文，后一半译文
    ].join('\n');
    assert.deepEqual(parseLyrics(raw, 'blocks'), [
      { o: 'one', t: '' },
      { o: 'two-o', t: 'two-t' },
      { o: 'three-o', t: 'three-t1\nthree-t2' },
      { o: 'four-o1\nfour-o2', t: 'four-t1\nfour-t2' },
    ]);
  });

  it('blocks: 5 and 6 lines follow the same odd / even rule', () => {
    assert.deepEqual(parseLyrics('a\nb\nc\nd\ne', 'blocks'), [{ o: 'a', t: 'b\nc\nd\ne' }]);
    assert.deepEqual(parseLyrics('a\nb\nc\nd\ne\nf', 'blocks'), [{ o: 'a\nb\nc', t: 'd\ne\nf' }]);
  });

  it('blocks: several blank lines, leading / trailing blank lines and whitespace-only separators', () => {
    const raw = '\n\n  a  \n b \n \t \n\n\n c \n\n';
    assert.deepEqual(parseLyrics(raw, 'blocks'), [{ o: 'a', t: 'b' }, { o: 'c', t: '' }]);
  });

  it('blocks: a trailing odd line inside the last block', () => {
    assert.deepEqual(parseLyrics('x\ny\n\nz\nw\nv', 'blocks'), [
      { o: 'x', t: 'y' },
      { o: 'z', t: 'w\nv' },
    ]);
  });

  it('strips LRC timestamps and metadata in every mode', () => {
    const lrc = [
      '[ti:Song]',
      '[ar:Someone]',
      '[by:me]',
      '[00:12.34]first line',
      '[00:15.00]第一行',
      '[01:02:03]second line',
      '[00:20]第二行',
    ].join('\n');
    assert.deepEqual(parseLyrics(lrc, 'single').map(g => g.o), ['first line', '第一行', 'second line', '第二行']);
    assert.deepEqual(parseLyrics(lrc, 'bilingual'), [
      { o: 'first line', t: '第一行' },
      { o: 'second line', t: '第二行' },
    ]);
    assert.deepEqual(parseLyrics(lrc, 'blocks'), [
      { o: 'first line\n第一行', t: 'second line\n第二行' },
    ]);
  });

  it('a tag-only line is dropped; it does not act as a blank separator', () => {
    assert.deepEqual(parseLyrics('a\n[00:10.00]\nb', 'blocks'), [{ o: 'a', t: 'b' }]);
    assert.deepEqual(parseLyrics('a\n\n[ti:x]\n\nb', 'blocks'), [{ o: 'a', t: '' }, { o: 'b', t: '' }]);
  });

  it('folds runs of whitespace into one half-width space and trims', () => {
    assert.deepEqual(parseLyrics('  hello \t  world  \n　第一　行　', 'single'), [
      { o: 'hello world', t: '' },
      { o: '第一 行', t: '' },
    ]);
  });

  it('handles CRLF / CR line endings and a BOM', () => {
    assert.deepEqual(parseLyrics('﻿a\r\nb\rc', 'single').map(g => g.o), ['a', 'b', 'c']);
  });

  it('an unknown mode behaves like bilingual', () => {
    assert.deepEqual(parseLyrics('a\nb\nc', 'whatever'), [{ o: 'a', t: 'b' }, { o: 'c', t: '' }]);
  });
});

/* ================================================================== */
/* text.js                                                             */
/* ================================================================== */

describe('text: script detection', () => {
  it('hasKana', () => {
    assert.ok(hasKana('ここでまだ'));
    assert.ok(hasKana('ホーム'));
    assert.ok(hasKana('abc ー'));
    assert.ok(hasKana('ｱｲｳ'));
    assert.ok(!hasKana('空无一人的站台'));
    assert.ok(!hasKana('hello'));
    assert.ok(!hasKana('안녕'));
    assert.ok(!hasKana(''));
  });

  it('hasHan', () => {
    assert.ok(hasHan('夏の光'));
    assert.ok(hasHan('空无一人'));
    assert.ok(hasHan('𠮷'));                  // 增补平面汉字
    assert.ok(!hasHan('ここでまだ'));
    assert.ok(!hasHan('hello 안녕'));
  });

  it('hasHangul', () => {
    assert.ok(hasHangul('안녕하세요'));
    assert.ok(hasHangul('mixed 한글'));
    assert.ok(!hasHangul('夏の光'));
    assert.ok(!hasHangul('hello'));
  });
});

describe('text: kinsoku sets', () => {
  it('NO_START has every required character', () => {
    const required = '、。，．,.!?！？：；:;・ー…‥」』）)】》〉”’]}ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ';
    for (const ch of required) assert.ok(NO_START.has(ch), `NO_START should have ${ch} (U+${ch.codePointAt(0).toString(16)})`);
  });

  it('NO_END has every required character', () => {
    for (const ch of '「『（(【《〈“‘[{') assert.ok(NO_END.has(ch), `NO_END should have ${ch}`);
  });

  it('ordinary characters are in neither set', () => {
    for (const ch of 'あ夏A1 ') {
      assert.ok(!NO_START.has(ch) && !NO_END.has(ch), ch);
    }
  });

  it('the two sets are disjoint', () => {
    for (const ch of NO_START) assert.ok(!NO_END.has(ch), ch);
  });
});

// 固定宽度：每个字符 1，ASCII 字符 0.55
const measure = s => Array.from(s).reduce((w, ch) => w + (ch.charCodeAt(0) < 128 ? 0.55 : 1), 0);
const startsBad = line => NO_START.has(Array.from(line)[0]);
const endsBad = line => NO_END.has(Array.from(line).at(-1));

describe('text: wrap', () => {
  it('empty input gives no lines', () => {
    assert.deepEqual(wrap(measure, '', 10), []);
    assert.deepEqual(wrap(measure, '   ', 10), []);
    assert.deepEqual(wrap(measure, null, 10), []);
  });

  it('short text stays on one line; text exactly as wide as maxWidth fits', () => {
    assert.deepEqual(wrap(measure, 'あいう', 10), ['あいう']);
    assert.deepEqual(wrap(measure, 'あいうえお', 5), ['あいうえお']);
    assert.deepEqual(wrap(measure, 'abcdefghi', 5), ['abcdefghi']);       // 9 × 0.55 = 4.95
  });

  it('plain CJK is cut greedily at maxWidth', () => {
    assert.deepEqual(wrap(measure, 'あいうえおかきくけこ', 5), ['あいうえお', 'かきくけこ']);
    assert.deepEqual(wrap(measure, 'あいうえおかきくけこさしす', 5), ['あいうえお', 'かきくけこ', 'さしす']);
  });

  it('\\n is a hard break; each paragraph wraps on its own', () => {
    assert.deepEqual(wrap(measure, 'abc\ndef', 100), ['abc', 'def']);
    assert.deepEqual(wrap(measure, 'abc\r\ndef', 100), ['abc', 'def']);
    assert.deepEqual(wrap(measure, 'あいうえおかきくけこさしす\nさしすせそ', 5), [
      'あいうえお', 'かきくけこ', 'さしす', 'さしすせそ',
    ]);
    assert.deepEqual(wrap(measure, 'a\n\nb', 100), ['a', 'b']);            // 空段落不产生行
  });

  it('a short last paragraph is not an orphan: it is a paragraph of its own', () => {
    assert.deepEqual(wrap(measure, 'あいうえおかきくけこさし\nさし', 100), ['あいうえおかきくけこさし', 'さし']);
  });

  it('trims leading and trailing spaces on every line', () => {
    assert.deepEqual(wrap(measure, '  hello world  ', 100), ['hello world']);
    assert.deepEqual(wrap(measure, '　あい　', 100), ['あい']);
    for (const line of wrap(measure, 'the quick brown fox jumps over the lazy dog', 4)) {
      assert.equal(line, line.trim());
    }
  });

  it('Latin words are never split when they fit on a line', () => {
    const text = 'the quick brown fox jumps';
    assert.deepEqual(wrap(measure, text, 5), ['the quick', 'brown fox', 'jumps']);
    const narrow = wrap(measure, text, 4);                                  // 每行最多 7 个 ASCII 字符
    assert.deepEqual(narrow.join(' ').split(' '), text.split(' '));         // 没有任何词被拆开
    for (const line of narrow) assert.ok(measure(line) <= 4 + 1e-9, line);
  });

  it('apostrophes, hyphens and digits stay inside a word', () => {
    assert.deepEqual(wrap(measure, "don't well-known 2024", 6), ["don't", 'well-known', '2024']);
  });

  it('Latin word glued to CJK breaks between them, not inside the word', () => {
    const lines = wrap(measure, 'あいうloveえお', 4.5);
    assert.ok(lines.some(l => l.includes('love')), lines.join('|'));
    assert.equal(lines.join(''), 'あいうloveえお');
  });

  it('an over-long Latin word is split by characters', () => {
    const word = 'abcdefghijklmnopqrstuvwxyz';
    assert.deepEqual(wrap(measure, word, 5), ['abcdefghi', 'jklmnopqr', 'stuvwxyz']);
    // 前面还有别的内容：先收尾当前行，再从新行开始拆
    assert.deepEqual(wrap(measure, `hi ${word}`, 5), ['hi', 'abcdefghi', 'jklmnopqr', 'stuvwxyz']);
  });

  it('phrase-aware break: break at the last space when it is past 40% of the line', () => {
    // 贪心会排成「誰もいないホームに 夏の光が」/「落ちてた」，按词组则在空格处断
    assert.deepEqual(
      wrap(measure, '誰もいないホームに 夏の光が落ちてた', 14),
      ['誰もいないホームに', '夏の光が落ちてた'],
    );
    assert.deepEqual(
      wrap(measure, '今日も晴れてるよ 君のいない町でも', 12),
      ['今日も晴れてるよ', '君のいない町でも'],
    );
  });

  it('a space in the first 40% of the line is ignored and the line is cut greedily', () => {
    assert.deepEqual(
      wrap(measure, 'あい うえおかきくけこさしすせそ', 12),
      ['あい うえおかきくけこさ', 'しすせそ'],
    );
  });

  it('a full-width space also counts as a phrase break', () => {
    assert.deepEqual(
      wrap(measure, '誰もいないホームに　夏の光が落ちてた', 14),
      ['誰もいないホームに', '夏の光が落ちてた'],
    );
  });

  it('push-out: a line never starts with 、 or 。', () => {
    // 「あいうえお」排满后「。」放不下：把「お」一起带到下一行
    assert.deepEqual(
      wrap(measure, 'あいうえお。かきくけこさしす', 5),
      ['あいうえ', 'お。かきく', 'けこさしす'],
    );
    assert.deepEqual(
      wrap(measure, 'あいうえお、かきくけこさしす', 5),
      ['あいうえ', 'お、かきく', 'けこさしす'],
    );
  });

  it('push-out chains when the carried character is itself a no-start character', () => {
    // 「あいう…」：排满后又是「。」：「…」和「う」都不能留在行首，一起带下去
    const lines = wrap(measure, 'あいう…。かきくけこさしす', 4);
    assert.deepEqual(lines, ['あい', 'う…。か', 'きくけこ', 'さしす']);
    for (const line of lines) assert.ok(!startsBad(line), line);
  });

  it('push-out also covers small kana and the prolonged sound mark', () => {
    for (const mark of ['ゃ', 'っ', 'ー', '！', '」']) {
      const lines = wrap(measure, `あいうえお${mark}かきくけこさしす`, 5);
      for (const line of lines) assert.ok(!startsBad(line), `${mark}: ${lines.join('|')}`);
      assert.equal(lines.join(''), `あいうえお${mark}かきくけこさしす`);
    }
  });

  it('NO_END: an opening bracket at the end of a line moves to the next line', () => {
    assert.deepEqual(
      wrap(measure, 'あいうえ「かきくけこさしす', 5),
      ['あいうえ', '「かきくけ', 'こさしす'],
    );
    const lines = wrap(measure, 'あいう（「かきくけこさしす', 5);
    for (const line of lines) assert.ok(!endsBad(line), line);
    assert.equal(lines.join(''), 'あいう（「かきくけこさしす');
  });

  it('no line ever starts with a NO_START or ends with a NO_END character (fuzz over widths)', () => {
    const text = 'あいう、えお。かきくけこ！さしすせそ」たちつてと『なにぬねの』はひふへほ…まみむめも（ゃゅ）';
    for (let width = 4; width <= 12; width++) {
      const lines = wrap(measure, text, width);
      assert.equal(lines.join(''), text, `width ${width}: no characters lost`);
      for (const line of lines) {
        assert.ok(!startsBad(line), `width ${width}: "${line}" starts badly`);
        assert.ok(!endsBad(line), `width ${width}: "${line}" ends badly`);
        assert.ok(measure(line) <= width + 1e-9 || Array.from(line).length <= 2, `width ${width}: "${line}" too wide`);
      }
    }
  });

  it('orphan fix: a 12-char CJK string at maxWidth 11 does not end with a single character', () => {
    const lines = wrap(measure, 'あいうえおかきくけこさし', 11);
    assert.equal(lines.length, 2);                                   // 行数不变
    assert.ok(Array.from(lines.at(-1)).length >= 3, lines.join('|'));
    assert.deepEqual(lines, ['あいうえおか', 'きくけこさし']);       // 二分到的最小宽度是 6
  });

  it('orphan fix: a 2-character last line is also repaired, line count stays the same', () => {
    const lines = wrap(measure, 'あいうえおかきくけこさしす', 11);    // 11 + 2
    assert.equal(lines.length, 2);
    assert.ok(Array.from(lines.at(-1)).length >= 3, lines.join('|'));
    assert.equal(lines.join(''), 'あいうえおかきくけこさしす');
    for (const line of lines) assert.ok(measure(line) <= 11);
  });

  it('orphan fix: not applied when the last line already has 3+ characters', () => {
    assert.deepEqual(
      wrap(measure, 'あいうえおかきくけこさしす', 10),
      ['あいうえおかきくけこ', 'さしす'],
    );
  });

  it('orphan fix: never changes a single-line result', () => {
    assert.deepEqual(wrap(measure, 'あい', 11), ['あい']);
    assert.deepEqual(wrap(measure, 'あ', 11), ['あ']);
  });

  it('orphan fix keeps the line count and never makes a line wider than maxWidth', () => {
    const text = 'あいうえおかきくけこさしすせそたちつてとなにぬねの';       // 25 字
    for (let width = 4; width <= 20; width++) {
      const lines = wrap(measure, text, width);
      assert.equal(lines.join(''), text);
      for (const line of lines) assert.ok(measure(line) <= width + 1e-9, `width ${width}: ${line}`);
      // 行数和不做防孤字时一样（整数宽度下最小宽度可能就是 maxWidth 本身，那时孤字无法消除）
      assert.equal(lines.length, Math.ceil(25 / width), `width ${width}: ${lines.join('|')}`);
    }
    // 能修的时候一定修好：贪心是 12 + 12 + 1，最小宽度 9 → 三行都至少 3 个字
    const fixed = wrap(measure, text, 12);
    assert.equal(fixed.length, 3);
    assert.ok(Array.from(fixed.at(-1)).length >= 3, fixed.join('|'));
  });

  it('degenerate widths terminate and keep every character', () => {
    assert.equal(wrap(measure, 'あいう', 0.5).join(''), 'あいう');
    assert.equal(wrap(measure, 'abc def', 0.1).join(''), 'abcdef');
    assert.deepEqual(wrap(measure, 'あいう', 1), ['あ', 'い', 'う']);
    assert.deepEqual(wrap(measure, 'あいう', Infinity), ['あいう']);
  });

  it('surrogate pairs and combining marks are not torn apart', () => {
    const lines = wrap(measure, '𠮷𠮷𠮷𠮷', 2);
    assert.deepEqual(lines, ['𠮷𠮷', '𠮷𠮷']);
    const withMark = wrap(measure, 'がきくけこ', 2);                // か + 濁点（組み合わせ）
    assert.ok(withMark[0].startsWith('が'), withMark.join('|'));
  });

  it('push-out carries a whole Latin word, not half of it', () => {
    // 「the quick」排满后「,」放不下：整个词「quick」带着逗号下去
    assert.deepEqual(wrap(measure, 'the quick, brown fox', 5), ['the', 'quick,', 'brown fox']);
  });

  it('push-out falls back to a single character when the line is one long word', () => {
    // 整行只有一个词，没有整词可带：按契约把最后一个字符带下去，逗号不会出现在行首
    assert.deepEqual(wrap(measure, 'abcdefghi, jk', 5), ['abcdefgh', 'i, jk']);
  });
});

/* ================================================================== */
/* ruby.js + wrapRuby（振假名）                                         */
/* ================================================================== */

describe('ruby: parseRuby', () => {
  it('text without markup is one plain segment; empty input gives none', () => {
    assert.deepEqual(parseRuby('夏の光が落ちてた'), [{ t: '夏の光が落ちてた' }]);
    assert.deepEqual(parseRuby(''), []);
    assert.deepEqual(parseRuby(null), []);
  });

  it('explicit ｜ or | marks the base, and the ruby can be anything', () => {
    assert.deepEqual(parseRuby('｜明日《あした》も'), [{ b: '明日', r: 'あした' }, { t: 'も' }]);
    assert.deepEqual(parseRuby('君の|名前《なまえ》'), [{ t: '君の' }, { b: '名前', r: 'なまえ' }]);
    assert.deepEqual(parseRuby('｜本気《マジ》で'), [{ b: '本気', r: 'マジ' }, { t: 'で' }]);
    assert.deepEqual(parseRuby('｜ホーム《platform》'), [{ b: 'ホーム', r: 'platform' }]);
  });

  it('without ｜ the whole kanji run before 《かな》 is the base', () => {
    assert.deepEqual(parseRuby('夏の東京《とうきょう》'), [{ t: '夏の' }, { b: '東京', r: 'とうきょう' }]);
    assert.deepEqual(parseRuby('大東京《だいとうきょう》'), [{ b: '大東京', r: 'だいとうきょう' }]);
    assert.deepEqual(parseRuby('時々《ときどき》'), [{ b: '時々', r: 'ときどき' }]);
    assert.deepEqual(parseRuby('君《きみ》と僕《ぼく》'), [{ b: '君', r: 'きみ' }, { t: 'と' }, { b: '僕', r: 'ぼく' }]);
  });

  it('curly-brace form {base|ruby}', () => {
    assert.deepEqual(parseRuby('{八月|はちがつ}の風'), [{ b: '八月', r: 'はちがつ' }, { t: 'の風' }]);
  });

  it('Chinese title marks are left alone', () => {
    for (const s of ['喜欢《晴天》这首歌', '《晴天》', '我在《夜に駆ける》里', 'ひらがな《かな》']) {
      assert.deepEqual(parseRuby(s), [{ t: s }], s);
      assert.equal(hasRuby(s), false, s);
    }
  });

  it('｜《 writes a literal 《', () => {
    assert.deepEqual(parseRuby('｜《本》'), [{ t: '《本》' }]);
    assert.equal(hasRuby('｜《本》'), false);
  });

  it('blank ruby or base is plain text; markup never crosses a line break', () => {
    assert.deepEqual(parseRuby('｜今日《 》'), [{ t: '今日' }]);
    assert.deepEqual(parseRuby('東京\n《とうきょう》'), [{ t: '東京\n《とうきょう》' }]);
    assert.deepEqual(parseRuby('｜東京《 とうきょう 》'), [{ b: '東京', r: 'とうきょう' }]);
  });

  it('stripRuby keeps the base; rubySegments folds ruby away when hidden', () => {
    const s = '誰《だれ》もいない｜明日《あした》';
    assert.equal(stripRuby(s), '誰もいない明日');
    assert.equal(hasRuby(s), true);
    assert.deepEqual(rubySegments(s, false), [{ t: '誰もいない明日' }]);
    assert.deepEqual(rubySegments(s, true), parseRuby(s));
    assert.deepEqual(rubySegments('', false), []);
  });
});

describe('text: wrapRuby', () => {
  const groupW = g => Math.max(Array.from(g.b).length, Array.from(g.r).length * 0.5);
  const plain = lines => lines.map(l => l.map(s => s.t ?? s.b).join(''));

  it('without ruby it gives exactly what wrap() gives', () => {
    for (const [text, w] of [['あいうえおかきくけこさしす', 5], ['the quick, brown fox', 5], ['誰もいないホームに 夏の光が落ちてた', 14], ['a\n\nb', 100], ['', 5]]) {
      const lines = wrapRuby(measure, parseRuby(text), w, groupW);
      assert.deepEqual(plain(lines), wrap(measure, text, w), text);
      for (const l of lines) for (const s of l) assert.equal(s.r, undefined);
    }
  });

  it('a ruby group is never split and moves to the next line whole', () => {
    // あいう + 東京(2) = 5 fits; あいうえ + 東京 = 6 does not, so 東京 goes down whole
    const segs = parseRuby('あいうえ東京《とうきょう》です');
    const lines = wrapRuby(measure, segs, 5, groupW);
    assert.deepEqual(plain(lines), ['あいうえ', '東京です']);
    assert.deepEqual(lines[1][0], { b: '東京', r: 'とうきょう' });
  });

  it('the group takes the wider of base and ruby', () => {
    // 光《ひかり》 is 1.5 wide: あいう + 1.5 = 4.5 fits in 4.5, not in 4
    const segs = parseRuby('あいう光《ひかり》');
    assert.equal(wrapRuby(measure, segs, 4.5, groupW).length, 1);
    assert.deepEqual(plain(wrapRuby(measure, segs, 4, groupW)), ['あい', 'う光']);   // 防孤字 keeps two chars below
  });

  it('rubyWidth sees its neighbours: "" at a line edge, null beside another group', () => {
    const seen = [];
    const spy = (g, before, after) => { seen.push([g.b, before, after]); return groupW(g); };
    wrapRuby(measure, parseRuby('光《ひかり》光《ひかり》が'), 100, spy);
    const final = seen.slice(-2);
    assert.deepEqual(final, [['光', '', null], ['光', null, 'が']]);
  });

  it('line-start rules still apply after a group', () => {
    const lines = wrapRuby(measure, parseRuby('あいう東京《とうきょう》。かきく'), 5, groupW);
    for (const l of plain(lines)) assert.ok(!startsBad(l), plain(lines).join('|'));
  });

  it('private-use characters already in the text cannot pose as groups', () => {
    const segs = [{ t: 'あ\u{F0000}い' }, { b: '東京', r: 'とうきょう' }];
    const lines = wrapRuby(measure, segs, 100, groupW);
    assert.deepEqual(plain(lines), ['あい東京']);
    assert.equal(lines[0].filter(s => s.r !== undefined).length, 1);
  });
});

describe('render: rubyFit', () => {
  const g = (bw, rw) => ({ b: 'x', r: 'y', bw, rw, cap: 10 });

  it('ruby no wider than its base takes the base width', () => {
    assert.deepEqual(rubyFit(g(40, 30), 'あ', 'い'), { w: 40, oL: 0 });
  });

  it('wider ruby reaches over kana and punctuation, up to one ruby character a side', () => {
    assert.deepEqual(rubyFit(g(20, 30), 'の', 'が'), { w: 20, oL: 5 });
    assert.deepEqual(rubyFit(g(20, 60), '、', 'を'), { w: 40, oL: 10 });     // capped at 10 a side
    assert.deepEqual(rubyFit(g(20, 30), ' ', 'ー'), { w: 20, oL: 5 });
  });

  it('never over kanji, Latin, another group or past the line edge', () => {
    assert.deepEqual(rubyFit(g(20, 30), '夏', 'a'), { w: 30, oL: 0 });
    assert.deepEqual(rubyFit(g(20, 30), '', null), { w: 30, oL: 0 });
    assert.deepEqual(rubyFit(g(20, 30), 'の', ''), { w: 25, oL: 5 });
  });
});
