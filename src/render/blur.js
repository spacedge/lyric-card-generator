// Own Gaussian blur for the blurred-cover backgrounds (immersive, depth).
//
// Why not ctx.filter = 'blur()': Safari has no canvas filter, and the browsers that do have one
// blur in gamma-encoded sRGB, so two saturated colours average into a muddy grey. This module
// gives the same pixels on every browser and blurs in linear light instead.
//
// Algorithm: three successive box blurs per axis approximate a Gaussian (the "boxes for Gauss"
// construction). Each box pass is a sliding window, so the cost is O(pixels) whatever the radius.
// Colour is premultiplied by alpha while it is blurred, and the image is extended past its borders by
// repeating the edge pixels, so borders neither darken nor fade out.
//
// `sigma` is the standard deviation in pixels, the same quantity CSS `blur(<length>)` takes.

/** Below this standard deviation the image is returned unchanged. */
const MIN_SIGMA = 0.25;
/** blurImage keeps the working sigma at or above this many pixels; a smooth result survives being scaled up. */
const MIN_WORK_SIGMA = 6;
/** Largest downscale factor blurImage will use (a power of two). */
const MAX_REDUCTION = 8;
/** Resolution of the linear → sRGB table. */
const LUT_SIZE = 4096;
const LUT_MAX = LUT_SIZE - 1;

/** 8-bit sRGB value → linear light, 0..1. */
const SRGB_TO_LINEAR = new Float32Array(256);
/** Linear light quantised to LUT_SIZE steps → 8-bit sRGB (already rounded). */
const LINEAR_TO_SRGB = new Uint8Array(LUT_SIZE);

for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
for (let i = 0; i < LUT_SIZE; i++) {
  const l = i / LUT_MAX;
  const c = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
  LINEAR_TO_SRGB[i] = Math.round(c * 255);
}

/**
 * Radii of three box blurs whose combined variance is closest to sigma² (sizes are odd, so radius = (size − 1) / 2).
 * Standard "boxes for Gauss" construction: n boxes, `m` of the smaller odd width and the rest of the next odd width.
 */
function boxRadii(sigma) {
  const n = 3;
  const ideal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let low = Math.floor(ideal);
  if (low % 2 === 0) low--;
  const m = Math.round((12 * sigma * sigma - n * low * low - 4 * n * low - 3 * n) / (-4 * low - 4));
  const radii = [];
  for (let i = 0; i < n; i++) radii.push(((i < m ? low : low + 2) - 1) / 2);
  return radii;
}

/**
 * One horizontal box pass over interleaved 4-channel float rows; a window that runs past either end repeats the end
 * pixel (blurCore pads the image so that never reaches the visible part). The window sum is carried along the row in
 * double precision, so the float32 buffers do not accumulate drift.
 */
function boxHorizontal(src, dst, w, h, r) {
  const inv = 1 / (2 * r + 1);
  const last = w - 1;
  // Window for x = 0 covers −r..r: r + 1 copies of pixel 0 plus pixels 1..r (those past the end repeat the last pixel).
  const reach = Math.min(r, last);
  const pastEnd = r - reach;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    let s0 = src[row] * (r + 1);
    let s1 = src[row + 1] * (r + 1);
    let s2 = src[row + 2] * (r + 1);
    let s3 = src[row + 3] * (r + 1);
    for (let k = 1; k <= reach; k++) {
      const p = row + k * 4;
      s0 += src[p]; s1 += src[p + 1]; s2 += src[p + 2]; s3 += src[p + 3];
    }
    if (pastEnd > 0) {
      const p = row + last * 4;
      s0 += src[p] * pastEnd; s1 += src[p + 1] * pastEnd; s2 += src[p + 2] * pastEnd; s3 += src[p + 3] * pastEnd;
    }
    for (let x = 0; x < w; x++) {
      const o = row + x * 4;
      dst[o] = s0 * inv; dst[o + 1] = s1 * inv; dst[o + 2] = s2 * inv; dst[o + 3] = s3 * inv;
      const add = row + (x + r + 1 < w ? x + r + 1 : last) * 4;
      const sub = row + (x - r > 0 ? x - r : 0) * 4;
      s0 += src[add] - src[sub];
      s1 += src[add + 1] - src[sub + 1];
      s2 += src[add + 2] - src[sub + 2];
      s3 += src[add + 3] - src[sub + 3];
    }
  }
}

/**
 * One vertical box pass. Works on whole rows (one running sum per column) so memory is read sequentially.
 */
function boxVertical(src, dst, w, h, r) {
  const stride = w * 4;
  const inv = 1 / (2 * r + 1);
  const last = h - 1;
  const acc = new Float64Array(stride);
  const reach = Math.min(r, last);
  const pastEnd = r - reach;
  for (let i = 0; i < stride; i++) acc[i] = src[i] * (r + 1);
  for (let k = 1; k <= reach; k++) {
    const p = k * stride;
    for (let i = 0; i < stride; i++) acc[i] += src[p + i];
  }
  if (pastEnd > 0) {
    const p = last * stride;
    for (let i = 0; i < stride; i++) acc[i] += src[p + i] * pastEnd;
  }
  for (let y = 0; y < h; y++) {
    const o = y * stride;
    const add = (y + r + 1 < h ? y + r + 1 : last) * stride;
    const sub = (y - r > 0 ? y - r : 0) * stride;
    for (let i = 0; i < stride; i++) {
      dst[o + i] = acc[i] * inv;
      acc[i] += src[add + i] - src[sub + i];
    }
  }
}

/**
 * Linear-light float image for the box passes: premultiplied, padded by `pad` pixels on every side with the border pixels
 * repeated. The source is (width·k) × (height·k) sRGB bytes; each k × k block is averaged (in linear light) into one pixel,
 * so k > 1 is a gamma-correct downscale.
 */
function loadLinear(data, width, height, k, pad) {
  const stride = (width + 2 * pad) * 4;
  const buf = new Float32Array(stride * (height + 2 * pad));
  const srcStride = width * k * 4;
  const norm = 1 / (k * k);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let dy = 0; dy < k; dy++) {
        let i = (y * k + dy) * srcStride + x * k * 4;
        for (let dx = 0; dx < k; dx++, i += 4) {
          const alpha = data[i + 3];
          if (alpha === 255) { // opaque, the usual case: no premultiplying needed
            r += SRGB_TO_LINEAR[data[i]];
            g += SRGB_TO_LINEAR[data[i + 1]];
            b += SRGB_TO_LINEAR[data[i + 2]];
            a += 1;
          } else if (alpha > 0) { // alpha 0 contributes nothing
            const weight = alpha / 255;
            r += SRGB_TO_LINEAR[data[i]] * weight;
            g += SRGB_TO_LINEAR[data[i + 1]] * weight;
            b += SRGB_TO_LINEAR[data[i + 2]] * weight;
            a += weight;
          }
        }
      }
      const o = (y + pad) * stride + (x + pad) * 4;
      buf[o] = r * norm; buf[o + 1] = g * norm; buf[o + 2] = b * norm; buf[o + 3] = a * norm;
    }
  }
  // Repeat the border pixels: left and right of every row first, then the rows above and below.
  for (let y = pad; y < pad + height; y++) {
    const row = y * stride;
    for (let x = 0; x < pad; x++) {
      for (let c = 0; c < 4; c++) {
        buf[row + x * 4 + c] = buf[row + pad * 4 + c];
        buf[row + (pad + width + x) * 4 + c] = buf[row + (pad + width - 1) * 4 + c];
      }
    }
  }
  for (let y = 0; y < pad; y++) {
    buf.copyWithin(y * stride, pad * stride, (pad + 1) * stride);
    buf.copyWithin((pad + height + y) * stride, (pad + height - 1) * stride, (pad + height) * stride);
  }
  return buf;
}

/**
 * The shared pipeline: sRGB bytes → linear light (optionally downscaled k×) → three box passes per axis → sRGB bytes.
 * @param data  (width·k) × (height·k) RGBA bytes
 * @returns width × height RGBA bytes
 */
function blurCore(data, width, height, sigma, k) {
  // Padding of the three radii lets every output pixel see the exact edge-repeated extension of the image: clamping
  // again inside each pass would pull the border colour toward the interior. It is capped at the larger image side so an
  // enormous sigma cannot allocate an enormous buffer; the cap only matters for a sigma far larger than the image.
  const radii = boxRadii(sigma);
  const pad = Math.min(radii[0] + radii[1] + radii[2], Math.max(width, height));
  const pw = width + 2 * pad;
  const ph = height + 2 * pad;

  let cur = loadLinear(data, width, height, k, pad);
  let tmp = new Float32Array(cur.length);

  // Three box passes per axis; a radius of 0 is the identity, so it is skipped.
  for (const r of radii) {
    if (r > 0) { boxHorizontal(cur, tmp, pw, ph, r); [cur, tmp] = [tmp, cur]; }
  }
  for (const r of radii) {
    if (r > 0) { boxVertical(cur, tmp, pw, ph, r); [cur, tmp] = [tmp, cur]; }
  }

  // Crop the padding off, un-premultiply, linear → sRGB through the table, round to bytes.
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = ((y + pad) * pw + x + pad) * 4;
      const alpha = cur[i + 3];
      const a8 = alpha * 255;
      if (a8 < 0.5) continue; // rounds to fully transparent; the buffer is already zeroed
      const scale = LUT_MAX / alpha; // un-premultiply and map 0..1 onto the table in one multiply
      const r = (cur[i] * scale + 0.5) | 0;
      const g = (cur[i + 1] * scale + 0.5) | 0;
      const b = (cur[i + 2] * scale + 0.5) | 0;
      const o = (y * width + x) * 4;
      out[o] = LINEAR_TO_SRGB[r < LUT_MAX ? r : LUT_MAX];
      out[o + 1] = LINEAR_TO_SRGB[g < LUT_MAX ? g : LUT_MAX];
      out[o + 2] = LINEAR_TO_SRGB[b < LUT_MAX ? b : LUT_MAX];
      out[o + 3] = a8; // Uint8ClampedArray rounds and clamps
    }
  }
  return out;
}

/**
 * Gaussian blur of an RGBA pixel buffer, computed in linear light, with the image extended past its borders by
 * repeating the edge pixels. Because box widths are whole odd numbers, sigma is honoured to about 6 % from sigma 3 up,
 * roughly to 20 % around sigma 1, and sigmas below about 0.7 leave the pixels unchanged.
 * @param {Uint8ClampedArray} data  width × height × 4 sRGB bytes, straight (non-premultiplied) alpha, as from getImageData
 * @param {number} sigma  standard deviation in pixels; 0.25 or less returns an unchanged copy
 * @returns {Uint8ClampedArray} a new buffer of the same size
 */
export function blurRGBA(data, width, height, sigma) {
  const len = width * height * 4;
  if (data.length !== len) throw new RangeError(`blurRGBA: expected ${len} bytes for ${width}x${height}, got ${data.length}`);
  if (!(sigma > MIN_SIGMA)) return new Uint8ClampedArray(data);
  return blurCore(data, width, height, sigma, 1);
}

/** A canvas through the DOM when there is one, an OffscreenCanvas otherwise (workers). */
function makeCanvas(w, h) {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    return canvas;
  }
  return new OffscreenCanvas(w, h);
}

/** Pixel size of a canvas image source (images report their intrinsic size, not the layout size). */
function sourceSize(source) {
  return [source.naturalWidth || source.width || 0, source.naturalHeight || source.height || 0];
}

/** object-fit: cover into a w × h context; fy 0 keeps the top, 0.5 the middle, 1 the bottom when the crop is vertical. */
function drawCover(ctx, source, w, h, fy) {
  const [sw, sh] = sourceSize(source);
  if (!sw || !sh) return;
  const s = Math.max(w / sw, h / sh);
  const cw = w / s;
  const ch = h / s;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, (sw - cw) / 2, (sh - ch) * fy, cw, ch, 0, 0, w, h);
}

/**
 * How far to shrink before blurring: a power of two that leaves the working sigma at MIN_WORK_SIGMA or more.
 * Blurring a ¼-size copy with sigma/4 and scaling it back up looks the same as blurring at full size, at 1/16 of the work.
 */
function reductionFor(sigma) {
  let f = 1;
  while (f < MAX_REDUCTION && sigma / (f * 2) >= MIN_WORK_SIGMA) f *= 2;
  return f;
}

/**
 * Draws `source` object-fit: cover into an outW × outH canvas and blurs it.
 * @param {CanvasImageSource} source
 * @param {number} outW  output width in device pixels
 * @param {number} outH  output height in device pixels
 * @param {number} sigma  standard deviation in device pixels; 0.25 or less is a plain draw
 * @param {{ fy?: number }} [opts]  fy: vertical focus 0..1 for the cover crop (0 top, 0.5 centre, 1 bottom), default 0.5
 * @returns {HTMLCanvasElement} an OffscreenCanvas where there is no document
 */
export function blurImage(source, outW, outH, sigma, opts = {}) {
  const width = Math.max(1, Math.round(outW));
  const height = Math.max(1, Math.round(outH));
  const fy = Number.isFinite(opts.fy) ? Math.min(1, Math.max(0, opts.fy)) : 0.5;
  const out = makeCanvas(width, height);
  const outCtx = out.getContext('2d');

  if (!(sigma > MIN_SIGMA)) {
    drawCover(outCtx, source, width, height, fy);
    return out;
  }

  // Blur at reduced size, then scale back up with smooth interpolation. The browser draws the cover once at output
  // size (f × f pixels per working pixel); blurCore averages those blocks in linear light, because the browser's own
  // downscale averages gamma-encoded values and would turn fine detail (text, halftone, noise) too dark and muddy.
  const f = reductionFor(sigma);
  const ww = Math.max(1, Math.round(width / f));
  const wh = Math.max(1, Math.round(height / f));
  const grab = makeCanvas(ww * f, wh * f);
  const grabCtx = grab.getContext('2d', { willReadFrequently: true });
  drawCover(grabCtx, source, ww * f, wh * f, fy);
  const pixels = grabCtx.getImageData(0, 0, ww * f, wh * f);
  const small = makeCanvas(ww, wh);
  const blurred = blurCore(pixels.data, ww, wh, (sigma * ww) / width, f);
  small.getContext('2d').putImageData(new ImageData(blurred, ww, wh), 0, 0);

  outCtx.imageSmoothingEnabled = true;
  outCtx.imageSmoothingQuality = 'high';
  outCtx.drawImage(small, 0, 0, ww, wh, 0, 0, width, height);
  return out;
}

/**
 * Memoises blurImage by source object identity and arguments, least recently used first out.
 * Returned canvases are shared between callers: draw from them, never draw onto them.
 * A source that is a canvas must not be redrawn after it has been blurred, or the cache serves the old blur.
 * @param {number} [limit=12]  most results kept
 * @returns {{ get(source: CanvasImageSource, outW: number, outH: number, sigma: number, opts?: { fy?: number }): HTMLCanvasElement }}
 */
export function createBlurCache(limit = 12) {
  const bySource = new WeakMap(); // source → Map(key → entry)
  const recent = new Set();       // entries, oldest first

  return {
    get(source, outW, outH, sigma, opts = {}) {
      const key = `${outW}x${outH}|${sigma}|${opts.fy ?? 0.5}`;
      let entries = bySource.get(source);
      if (!entries) bySource.set(source, (entries = new Map()));
      let entry = entries.get(key);
      if (entry) {
        recent.delete(entry);
      } else {
        entry = { source, key, canvas: blurImage(source, outW, outH, sigma, opts) };
        entries.set(key, entry);
      }
      recent.add(entry);
      if (recent.size > limit) {
        const oldest = recent.values().next().value;
        recent.delete(oldest);
        bySource.get(oldest.source).delete(oldest.key);
      }
      return entry.canvas;
    },
  };
}
