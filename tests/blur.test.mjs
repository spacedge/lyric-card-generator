// Unit tests for src/render/blur.js: the linear-light Gaussian (blurRGBA) on synthetic pixel buffers,
// plus the canvas wrapper (blurImage / createBlurCache) against a recording canvas stub.
// Run: node tests/blur.test.mjs (from the project root). Synthetic data only, no real covers.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { blurRGBA, blurImage, createBlurCache } from '../src/render/blur.js';

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

/** w × h buffer filled with one RGBA colour. */
function solid(w, h, [r, g, b, a = 255]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) data.set([r, g, b, a], i);
  return data;
}

function setPixel(data, w, x, y, [r, g, b, a = 255]) {
  data.set([r, g, b, a], (y * w + x) * 4);
}

/** The four bytes of pixel (x, y). */
function pixel(data, w, x, y) {
  const i = (y * w + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
}

/** sRGB byte → linear light, exact formula (independent of the module's lookup table). */
function linear(byte) {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Linear light of one channel at pixel (x, y). */
function lin(data, w, x, y, ch = 0) {
  return linear(data[(y * w + x) * 4 + ch]);
}

/** Total linear-light energy of one channel (opaque images). */
function energy(data, ch = 0) {
  let sum = 0;
  for (let i = ch; i < data.length; i += 4) sum += linear(data[i]);
  return sum;
}

function assertNear(actual, expected, tol, label = '') {
  assert.ok(Math.abs(actual - expected) <= tol, `${label} expected ${expected} ± ${tol}, got ${actual}`);
}

/** Black image with a white (255) k × k block whose top-left corner is (x0, y0). */
function blockImage(w, h, x0, y0, k) {
  const data = solid(w, h, [0, 0, 0, 255]);
  for (let y = y0; y < y0 + k; y++) for (let x = x0; x < x0 + k; x++) setPixel(data, w, x, y, [255, 255, 255, 255]);
  return data;
}

/* ------------------------------------------------------------------ */
/* blurRGBA                                                            */
/* ------------------------------------------------------------------ */

describe('blurRGBA: identity cases', () => {
  it('a uniform image is unchanged, bit for bit', () => {
    for (const colour of [[0, 0, 0, 255], [255, 255, 255, 255], [200, 30, 90, 255], [3, 3, 3, 255], [93, 174, 230, 255]]) {
      const src = solid(40, 30, colour);
      assert.deepEqual(blurRGBA(src, 40, 30, 5), src, `colour ${colour}`);
    }
  });

  it('every grey level survives the sRGB → linear → sRGB round trip', () => {
    for (let v = 0; v < 256; v++) {
      const src = solid(8, 8, [v, v, v, 255]);
      assert.deepEqual(blurRGBA(src, 8, 8, 3), src, `grey ${v}`);
    }
  });

  it('a uniform translucent image keeps its colour and alpha', () => {
    for (const a of [1, 40, 128, 254]) {
      const src = solid(20, 20, [200, 60, 30, a]);
      assert.deepEqual(blurRGBA(src, 20, 20, 4), src, `alpha ${a}`);
    }
  });

  it('sigma of 0.25 or less returns an equal but independent copy', () => {
    const src = blockImage(16, 16, 7, 7, 2);
    for (const sigma of [0, 0.25, -3, NaN]) {
      const out = blurRGBA(src, 16, 16, sigma);
      assert.notEqual(out, src);
      assert.notEqual(out.buffer, src.buffer);
      assert.ok(out instanceof Uint8ClampedArray);
      assert.deepEqual(out, src, `sigma ${sigma}`);
    }
  });

  it('never modifies its input and is deterministic', () => {
    const src = blockImage(32, 32, 14, 14, 4);
    const before = new Uint8ClampedArray(src);
    const a = blurRGBA(src, 32, 32, 3);
    assert.deepEqual(src, before);
    assert.deepEqual(blurRGBA(src, 32, 32, 3), a);
  });

  it('rejects a buffer that does not match the stated size', () => {
    assert.throws(() => blurRGBA(new Uint8ClampedArray(10 * 4), 5, 5, 2), RangeError);
  });
});

describe('blurRGBA: Gaussian shape', () => {
  it('spreads a single bright pixel symmetrically around its position', () => {
    const w = 61;
    const src = solid(w, w, [0, 0, 0, 255]);
    setPixel(src, w, 30, 30, [255, 255, 255, 255]);
    const out = blurRGBA(src, w, w, 4);
    const c = 30;
    let prev = Infinity;
    for (let d = 0; d <= 12; d++) {
      const right = out[(c * w + c + d) * 4];
      // mirror image left / up / down and the diagonal agree to the last byte of rounding
      for (const mirror of [out[(c * w + c - d) * 4], out[((c + d) * w + c) * 4], out[((c - d) * w + c) * 4]]) {
        assertNear(mirror, right, 1, `offset ${d}`);
      }
      assert.ok(right <= prev, `monotonic fall-off at offset ${d}`);
      prev = right;
    }
    assert.ok(out[(c * w + c) * 4] > out[(c * w + c + 4) * 4], 'peak is at the impulse');
    assert.ok(out[(c * w + c + 8) * 4] > 0, 'tail reaches two sigma');
    for (let y = 1; y <= 10; y++) for (let x = 1; x <= 10; x++) {
      assertNear(out[((c + y) * w + c + x) * 4], out[((c - y) * w + c - x) * 4], 1, `diagonal ${x},${y}`);
    }
  });

  it('keeps total energy in linear light (within 1 %)', () => {
    const w = 129;
    for (const sigma of [2, 6, 12]) {
      const src = blockImage(w, w, 60, 60, 6);
      const out = blurRGBA(src, w, w, sigma);
      const ratio = energy(out) / energy(src);
      assertNear(ratio, 1, 0.01, `sigma ${sigma}: energy ratio`);
      assertNear(energy(out, 1) / energy(src, 1), 1, 0.01, `sigma ${sigma}: green channel`);
    }
  });

  it('has a spread close to the requested sigma (box approximation, within 8 %)', () => {
    // A k × k block is a known blur kernel itself, variance (k² − 1) / 12, so the output variance is sigma² plus that.
    const k = 5;
    const blockVariance = (k * k - 1) / 12;
    for (const sigma of [3, 6, 12]) {
      const w = Math.ceil(sigma * 14) | 1;
      const mid = (w - k) >> 1;
      const out = blurRGBA(blockImage(w, w, mid, mid, k), w, w, sigma);
      let total = 0;
      let moment = 0;
      const centre = mid + (k - 1) / 2;
      for (let y = 0; y < w; y++) {
        const l = lin(out, w, Math.round(centre), y); // one column through the centre
        total += l;
        moment += l * (y - centre) ** 2;
      }
      assertNear(Math.sqrt(moment / total - blockVariance) / sigma, 1, 0.08, `sigma ${sigma}: measured / requested`);
    }
  });
});

describe('blurRGBA: edges, colour, alpha', () => {
  it('clamps to the edge: a bright border column stays bright instead of fading', () => {
    const w = 40;
    const h = 12;
    const src = solid(w, h, [0, 0, 0, 255]);
    for (let y = 0; y < h; y++) setPixel(src, w, 0, y, [255, 255, 255, 255]);
    const out = blurRGBA(src, w, h, 3);
    // Half the Gaussian window lies on the repeated edge, so at least half the light is white: linear ≥ 0.5, sRGB ≥ 188.
    for (let y = 0; y < h; y++) assert.ok(out[(y * w) * 4] >= 188, `row ${y}: ${out[(y * w) * 4]}`);
    assert.ok(out[(5 * w + 0) * 4] > out[(5 * w + 3) * 4], 'falls off away from the edge');
    // The same on the top edge, and in a corner (both axes clamp).
    const top = solid(h, w, [0, 0, 0, 255]);
    for (let x = 0; x < h; x++) setPixel(top, h, x, 0, [255, 255, 255, 255]);
    const topOut = blurRGBA(top, h, w, 3);
    for (let x = 0; x < h; x++) assert.ok(topOut[x * 4] >= 188, `column ${x}`);
    const corner = solid(w, h, [0, 0, 0, 255]);
    setPixel(corner, w, 0, 0, [255, 255, 255, 255]);
    assert.ok(blurRGBA(corner, w, h, 3)[0] >= 100, 'corner pixel keeps a quarter of its light');
  });

  it('averages a 1 px black / white checker to sRGB ≈ 188 (linear 0.5), not 128', () => {
    const w = 48;
    const src = solid(w, w, [0, 0, 0, 255]);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) if ((x + y) & 1) setPixel(src, w, x, y, [255, 255, 255, 255]);
    const out = blurRGBA(src, w, w, 3);
    for (const [x, y] of [[10, 10], [11, 10], [24, 24], [30, 17]]) {
      for (const ch of [0, 1, 2]) assertNear(pixel(out, w, x, y)[ch], 188, 2, `(${x},${y}) channel ${ch}`);
    }
  });

  it('mixes saturated colours in linear light: red / green checker → yellow-olive 188,188,0, not 128,128,0', () => {
    const w = 40;
    const src = solid(w, w, [0, 0, 0, 255]);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) setPixel(src, w, x, y, (x + y) & 1 ? [255, 0, 0, 255] : [0, 255, 0, 255]);
    const [r, g, b, a] = pixel(blurRGBA(src, w, w, 3), w, 20, 20);
    assertNear(r, 188, 2, 'red');
    assertNear(g, 188, 2, 'green');
    assert.equal(b, 0);
    assert.equal(a, 255);
  });

  it('premultiplies alpha: transparent pixels do not darken or tint the colour next to them', () => {
    const w = 60;
    const h = 8;
    const src = solid(w, h, [0, 0, 0, 0]); // transparent black on the right
    for (let y = 0; y < h; y++) for (let x = 0; x < 30; x++) setPixel(src, w, x, y, [255, 40, 0, 255]);
    const out = blurRGBA(src, w, h, 4);
    let sawPartial = false;
    for (let x = 24; x < 40; x++) {
      const [r, g, b, a] = pixel(out, w, x, 4);
      if (a === 0) continue;
      assertNear(r, 255, 2, `x=${x} red`);
      assertNear(g, 40, 2, `x=${x} green`);
      assertNear(b, 0, 2, `x=${x} blue`);
      if (a > 0 && a < 255) sawPartial = true;
    }
    assert.ok(sawPartial, 'the boundary has partially transparent pixels');
    assert.deepEqual(pixel(out, w, 59, 4), [0, 0, 0, 0], 'far side stays transparent black');
    assert.equal(pixel(out, w, 0, 4)[3], 255, 'opaque side stays opaque (edge clamped)');
  });
});

describe('blurRGBA: sizes', () => {
  it('handles non-square images in both orientations; blurring commutes with transposing', () => {
    const w = 37;
    const h = 11;
    const src = solid(w, h, [10, 20, 30, 255]);
    for (let i = 0; i < 40; i++) setPixel(src, w, (i * 7) % w, (i * 5) % h, [255, 200 - i, 5 * i, 255]);
    const transposed = new Uint8ClampedArray(src.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) transposed.set(pixel(src, w, x, y), (x * h + y) * 4);

    const a = blurRGBA(src, w, h, 2.5);
    const b = blurRGBA(transposed, h, w, 2.5);
    assert.equal(a.length, w * h * 4);
    assert.equal(b.length, w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = pixel(a, w, x, y);
      const q = pixel(b, h, y, x);
      for (let ch = 0; ch < 4; ch++) assertNear(p[ch], q[ch], 1, `(${x},${y}) channel ${ch}`);
    }
  });

  it('copes with one-pixel-wide images and a radius larger than the image', () => {
    for (const [w, h] of [[1, 1], [1, 9], [9, 1], [7, 5]]) {
      const src = solid(w, h, [120, 200, 40, 255]);
      assert.deepEqual(blurRGBA(src, w, h, 50), src, `${w}x${h}`);
    }
    // White left column, black elsewhere, blurred far wider than the image: the window sees the repeated white edge on
    // one side and the repeated black edge on the other, so every pixel tends to half the light.
    const src = solid(7, 5, [0, 0, 0, 255]);
    for (let y = 0; y < 5; y++) setPixel(src, 7, 0, y, [255, 255, 255, 255]);
    const out = blurRGBA(src, 7, 5, 200);
    for (const x of [0, 3, 6]) assertNear(lin(out, 7, x, 2), 0.5, 0.03, `column ${x}`);
  });
});

/* ------------------------------------------------------------------ */
/* blurImage / createBlurCache against a recording canvas stub         */
/* ------------------------------------------------------------------ */

/** Minimal 2D-canvas stand-in that records what blurImage does to it. */
function installCanvasStub({ withDocument, pixels = (w, h) => solid(w, h, [90, 120, 200, 255]) }) {
  const created = [];
  class StubImageData {
    constructor(data, width, height) { this.data = data; this.width = width; this.height = height; }
  }
  class StubCanvas {
    constructor(w, h) {
      this.width = w;
      this.height = h;
      this.calls = [];
      this.ctx = {
        imageSmoothingEnabled: false,
        imageSmoothingQuality: 'low',
        drawImage: (...args) => this.calls.push(['drawImage', ...args]),
        getImageData: (x, y, gw, gh) => {
          this.calls.push(['getImageData', gw, gh]);
          return new StubImageData(pixels(gw, gh), gw, gh);
        },
        putImageData: (image) => { this.put = image; this.calls.push(['putImageData', image.width, image.height]); },
      };
      created.push(this);
    }
    getContext(kind, options) { this.calls.push(['getContext', kind, options]); return this.ctx; }
  }
  globalThis.ImageData = StubImageData;
  if (withDocument) {
    globalThis.document = { createElement: (tag) => { assert.equal(tag, 'canvas'); return new StubCanvas(0, 0); } };
    delete globalThis.OffscreenCanvas;
  } else {
    delete globalThis.document;
    globalThis.OffscreenCanvas = StubCanvas;
  }
  return created;
}

function removeCanvasStub() {
  delete globalThis.document;
  delete globalThis.OffscreenCanvas;
  delete globalThis.ImageData;
}

describe('blurImage (canvas stub)', () => {
  afterEach(removeCanvasStub);

  it('sigma 0 is a plain object-fit: cover draw (portrait source, vertical focus)', () => {
    const created = installCanvasStub({ withDocument: true });
    const source = { width: 200, height: 400 };
    const out = blurImage(source, 100, 100, 0, { fy: 0.25 });
    assert.equal(created.length, 1);
    assert.equal(out, created[0]);
    assert.deepEqual([out.width, out.height], [100, 100]);
    const draw = out.calls.find((c) => c[0] === 'drawImage');
    // scale 0.5 → the crop is 200 × 200 of the 200 × 400 source; fy 0.25 of the 200 px overflow = 50
    assert.deepEqual(draw.slice(1), [source, 0, 50, 200, 200, 0, 0, 100, 100]);
    assert.ok(!out.calls.some((c) => c[0] === 'getImageData'), 'no blur for sigma 0');
  });

  it('centres a landscape source horizontally and defaults fy to the middle', () => {
    const created = installCanvasStub({ withDocument: true });
    const source = { naturalWidth: 400, naturalHeight: 200, width: 123, height: 45 };
    blurImage(source, 100, 100, 0);
    const draw = created[0].calls.find((c) => c[0] === 'drawImage');
    assert.deepEqual(draw.slice(1), [source, 100, 0, 200, 200, 0, 0, 100, 100]);
  });

  it('blurs a large sigma at reduced size and scales the result back up smoothly', () => {
    const created = installCanvasStub({ withDocument: true });
    const source = { width: 600, height: 600 };
    const out = blurImage(source, 1080, 1080, 28);
    assert.deepEqual([out.width, out.height], [1080, 1080]);
    // The cover is drawn once at output size and read back; blurCore averages 4 × 4 blocks in linear light (sigma 28 → ¼ size, working sigma 7).
    const grab = created.find((c) => c.calls.some((call) => call[0] === 'getImageData'));
    assert.deepEqual([grab.width, grab.height], [1080, 1080]);
    assert.deepEqual(grab.calls.find((c) => c[0] === 'getImageData').slice(1), [1080, 1080]);
    assert.equal(grab.calls.find((c) => c[0] === 'getContext')[2].willReadFrequently, true);
    assert.deepEqual(grab.calls.find((c) => c[0] === 'drawImage').slice(1), [source, 0, 0, 600, 600, 0, 0, 1080, 1080]);
    // The blurred ¼-size result is scaled up with high-quality smoothing.
    const small = created.find((c) => c.calls.some((call) => call[0] === 'putImageData'));
    assert.deepEqual([small.width, small.height], [270, 270]);
    assert.deepEqual(small.calls.find((c) => c[0] === 'putImageData').slice(1), [270, 270]);
    assert.deepEqual(out.calls.find((c) => c[0] === 'drawImage').slice(1), [small, 0, 0, 270, 270, 0, 0, 1080, 1080]);
    assert.equal(out.ctx.imageSmoothingQuality, 'high');
    assert.equal(out.ctx.imageSmoothingEnabled, true);
  });

  it('keeps the working sigma at 6 px or more by picking a power-of-two reduction', () => {
    const cases = [[5, 1], [6, 1], [11, 1], [12, 2], [14, 2], [24, 4], [28, 4], [47, 4], [48, 8], [400, 8]];
    for (const [sigma, factor] of cases) {
      const created = installCanvasStub({ withDocument: true });
      blurImage({ width: 256, height: 256 }, 256, 256, sigma);
      const small = created.find((c) => c.calls.some((call) => call[0] === 'putImageData'));
      assert.equal(small.width, 256 / factor, `sigma ${sigma}`);
      if (sigma >= 6) assert.ok(sigma / factor >= 6, `sigma ${sigma} works at ${sigma / factor}`);
    }
  });

  it('downscales in linear light: a 1 px checker averages to sRGB 188, not the 128 a gamma-space downscale gives', () => {
    const checker = (w, h) => {
      const data = solid(w, h, [0, 0, 0, 255]);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x + y) & 1) setPixel(data, w, x, y, [255, 255, 255, 255]);
      return data;
    };
    const created = installCanvasStub({ withDocument: true, pixels: checker });
    blurImage({ width: 256, height: 256 }, 256, 256, 28); // ¼ size: every working pixel averages a 4 × 4 block of the checker
    const small = created.find((c) => c.put);
    assert.deepEqual([small.put.width, small.put.height], [64, 64]);
    for (const [x, y] of [[32, 32], [10, 50], [60, 5]]) assertNear(pixel(small.put.data, 64, x, y)[0], 188, 2, `(${x},${y})`);
  });

  it('falls back to OffscreenCanvas when there is no document', () => {
    const created = installCanvasStub({ withDocument: false });
    const out = blurImage({ width: 64, height: 64 }, 32, 32, 8);
    assert.equal(typeof document, 'undefined');
    assert.equal(out.constructor.name, 'StubCanvas');
    assert.ok(created.includes(out));
    assert.deepEqual([out.width, out.height], [32, 32]);
  });

  it('draws nothing from a source with no size instead of throwing', () => {
    const created = installCanvasStub({ withDocument: true });
    const out = blurImage({ width: 0, height: 0 }, 50, 50, 0);
    assert.deepEqual([out.width, out.height], [50, 50]);
    assert.ok(!created[0].calls.some((c) => c[0] === 'drawImage'));
  });
});

describe('createBlurCache (canvas stub)', () => {
  afterEach(removeCanvasStub);

  it('returns the same canvas for the same source and arguments, a new one when anything differs', () => {
    const created = installCanvasStub({ withDocument: true });
    const cache = createBlurCache();
    const a = { width: 100, height: 100 };
    const b = { width: 100, height: 100 }; // equal content, different object
    const first = cache.get(a, 64, 64, 14);
    const made = created.length;
    assert.equal(cache.get(a, 64, 64, 14), first);
    assert.equal(cache.get(a, 64, 64, 14, {}), first, 'a missing fy means 0.5');
    assert.equal(cache.get(a, 64, 64, 14, { fy: 0.5 }), first);
    assert.equal(created.length, made, 'no canvas is made on a hit');
    for (const other of [cache.get(b, 64, 64, 14), cache.get(a, 64, 32, 14), cache.get(a, 64, 64, 6), cache.get(a, 64, 64, 14, { fy: 0.2 })]) {
      assert.notEqual(other, first);
    }
  });

  it('evicts the least recently used entry beyond the limit', () => {
    installCanvasStub({ withDocument: true });
    const cache = createBlurCache(2);
    const src = { width: 50, height: 50 };
    const a = cache.get(src, 40, 40, 10);
    const b = cache.get(src, 40, 40, 11);
    assert.equal(cache.get(src, 40, 40, 10), a, 'touching a makes b the oldest');
    cache.get(src, 40, 40, 12); // evicts b
    assert.equal(cache.get(src, 40, 40, 10), a, 'a survived');
    assert.notEqual(cache.get(src, 40, 40, 11), b, 'b was evicted and is blurred again');
  });

  it('defaults to a limit of 12', () => {
    const created = installCanvasStub({ withDocument: true });
    const cache = createBlurCache();
    const src = { width: 20, height: 20 };
    const first = cache.get(src, 10, 10, 0);
    for (let i = 1; i <= 11; i++) cache.get(src, 10, 10, 0, { fy: i / 25 });
    assert.equal(cache.get(src, 10, 10, 0), first, '12 entries fit');
    cache.get(src, 10, 10, 0, { fy: 0.99 }); // 13th entry evicts the oldest, fy 0.04, since `first` was just touched
    const made = created.length;
    cache.get(src, 10, 10, 0);
    assert.equal(created.length, made, 'first is still cached');
    cache.get(src, 10, 10, 0, { fy: 0.04 });
    assert.equal(created.length, made + 1, 'fy 0.04 was evicted');
  });
});
