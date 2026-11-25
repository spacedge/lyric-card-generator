// 纯逻辑模块的单元测试：color.js / lyrics.js / text.js
// 运行：node tests/logic.test.mjs（在项目根目录）
// 版权规则：测试里只用 CONTRACT.md 里的原创示例歌词或自编的中性文本。

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  FALLBACK_SEED, hexToRgb, rgbToHex, hexToOklch, toneHex, palette, makeScheme,
  seedsFromPixels, extractSeeds, luminance, contrast, ensureContrast, withAlpha, hueDistance,
} from '../src/color.js';
import { stripLrc, parseLyrics } from '../src/lyrics.js';
import { hasKana, hasHan, hasHangul, NO_START, NO_END, wrap } from '../src/text.js';

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
/* 取色：合成像素                                                      */
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

describe('color: seedsFromPixels', () => {
  const BLUE = [35, 56, 156];       // #23389C
  const CREAM = [244, 241, 232];    // 浅色、几乎无彩
  const YELLOW = [240, 190, 40];

  it('blue image with a cream patch and a small yellow patch', () => {
    const px = solid(BLUE);
    paint(px, 0, 0, 20, 20, CREAM);          // 400 px ≈ 4.3%
    paint(px, 70, 70, 84, 84, YELLOW);       // 196 px ≈ 2.1%
    const { seeds, light } = seedsFromPixels(px);

    const blueHue = hexToOklch('#23389C').H;
    const yellowHue = hexToOklch(rgbToHex(YELLOW)).H;
    assert.ok(seeds.length >= 2 && seeds.length <= 4, `seeds ${seeds}`);
    assert.ok(hueDistance(hexToOklch(seeds[0]).H, blueHue) < 10, `first seed ${seeds[0]} should be blue`);
    assert.ok(
      seeds.some(s => hueDistance(hexToOklch(s).H, yellowHue) < 20),
      `expected a yellow seed in ${seeds}`,
    );
    assert.notEqual(light, null);
    assert.ok(hexToOklch(light).L > 0.86, `light ink ${light}`);
    assert.ok(hexToOklch(light).C < 0.08);
  });

  it('light ink is the average of the light pixels', () => {
    const px = solid(BLUE);
    paint(px, 0, 0, 20, 10, [250, 250, 250]);
    paint(px, 0, 10, 20, 20, [240, 240, 240]);
    assert.equal(seedsFromPixels(px).light, '#F5F5F5');
  });

  it('light ink needs at least 2% of the pixels', () => {
    const px = solid(BLUE);
    paint(px, 0, 0, 13, 13, CREAM);          // 169 px ≈ 1.8%
    assert.equal(seedsFromPixels(px).light, null);
    paint(px, 0, 0, 14, 14, CREAM);          // 196 px ≈ 2.1%
    assert.notEqual(seedsFromPixels(px).light, null);
  });

  it('an all-grey image falls back', () => {
    const { seeds, light } = seedsFromPixels(solid([128, 128, 128]));
    assert.deepEqual(seeds, [FALLBACK_SEED]);
    assert.equal(light, null);
  });

  it('an all-white image falls back but has a light ink', () => {
    const { seeds, light } = seedsFromPixels(solid([255, 255, 255]));
    assert.deepEqual(seeds, [FALLBACK_SEED]);
    assert.equal(light, '#FFFFFF');
  });

  it('very dark and very bright saturated pixels are ignored (L outside 0.12–0.97)', () => {
    assert.deepEqual(seedsFromPixels(solid([6, 6, 20])).seeds, [FALLBACK_SEED]);
  });

  it('transparent pixels are skipped; a fully transparent image falls back', () => {
    assert.deepEqual(seedsFromPixels(solid(BLUE, 0)), { seeds: [FALLBACK_SEED], light: null });
    // 一半透明（画了别的颜色）、一半蓝：透明部分不能影响结果
    const px = solid([255, 0, 0], 0);
    paint(px, 0, 0, 96, 48, BLUE);
    const { seeds } = seedsFromPixels(px);
    assert.equal(seeds.length, 1);
    assert.ok(hueDistance(hexToOklch(seeds[0]).H, hexToOklch('#23389C').H) < 10);
  });

  it('a nearly opaque pixel (alpha 199) is skipped, 200 is counted', () => {
    assert.deepEqual(seedsFromPixels(solid(BLUE, 199)).seeds, [FALLBACK_SEED]);
    assert.notDeepEqual(seedsFromPixels(solid(BLUE, 200)).seeds, [FALLBACK_SEED]);
  });

  it('returns at most 4 seeds, at least 30° apart, strongest first', () => {
    const px = solid([200, 40, 40]);                 // 红：大块
    paint(px, 0, 0, 96, 24, [40, 160, 60]);          // 绿
    paint(px, 0, 24, 96, 40, [40, 90, 200]);         // 蓝
    paint(px, 0, 40, 96, 50, [230, 190, 30]);        // 黄
    paint(px, 0, 50, 96, 58, [170, 50, 190]);        // 紫
    paint(px, 0, 58, 96, 64, [30, 180, 190]);        // 青
    const { seeds } = seedsFromPixels(px);
    assert.equal(seeds.length, 4);
    for (let i = 0; i < seeds.length; i++) {
      for (let j = i + 1; j < seeds.length; j++) {
        const d = hueDistance(hexToOklch(seeds[i]).H, hexToOklch(seeds[j]).H);
        assert.ok(d >= 30 - 1e-6, `${seeds[i]} vs ${seeds[j]} = ${d}`);
      }
    }
    // 红色占的面积最大，应排第一
    assert.ok(hueDistance(hexToOklch(seeds[0]).H, hexToOklch('#C82828').H) < 12, seeds[0]);
  });

  it('a tiny speck (< 0.5% of the pixels) is not a seed', () => {
    const px = solid(BLUE);
    paint(px, 0, 0, 6, 6, YELLOW);                   // 36 px ≈ 0.4%
    const { seeds } = seedsFromPixels(px);
    assert.equal(seeds.length, 1);
  });

  it('seed hex is uppercase #RRGGBB', () => {
    for (const s of seedsFromPixels(solid(BLUE)).seeds) assert.match(s, /^#[0-9A-F]{6}$/);
  });
});

describe('color: extractSeeds without a canvas', () => {
  it('falls back instead of throwing when the source is unusable', () => {
    assert.deepEqual(extractSeeds({}), { seeds: [FALLBACK_SEED], light: null });
    assert.deepEqual(extractSeeds({ width: 100, height: 100 }), { seeds: [FALLBACK_SEED], light: null });
    assert.deepEqual(extractSeeds(null), { seeds: [FALLBACK_SEED], light: null });
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
