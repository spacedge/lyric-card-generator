// The five card templates. Each layout(ctx, env, p, draw) returns the card's content height
// in design pixels; with draw = false it only measures. Numbers follow the design boards
// (half of the 1080 export size). Colours come from env.pal (cardPalette in color.js), so
// every style and light/dark setting changes the card the same way in every template.
import { withAlpha, hexToOklch } from '../color.js';
import { hasKana } from '../text.js';
import {
  W, MONO, familyFor, setFont, wrapIn, drawLines, drawSpaced, rr, drawCoverFit, drawCoverCard,
  progressFraction, drawWave, drawQR, verticalHeight, drawVertical,
} from './common.js';
import { createBlurCache, blurImage } from './blur.js';

const PLACEHOLDER = '歌词会出现在这里';
const QR_LABEL = '长按识别二维码收听';

// Gaussian sigma in design px for the photo templates' blur levels.
export const BLUR_SIGMA = { light: 6, mid: 14, heavy: 24 };
// Preview and thumbnail layers are cached (dragging the 景深 crop or editing text never re-blurs);
// export-sized layers are large (a 2160-wide square is ~19 MB), so exports blur once and drop them.
const blurCache = createBlurCache(6);
function blurred(env, src, w, h, sigma) {
  return env.purpose === 'export' ? blurImage(src, w, h, sigma) : blurCache.get(src, w, h, sigma);
}

// ---------- shared pieces ----------

function measureGroup(ctx, env, g, maxW, spec) {
  const famO = familyFor(env.fp, g.o);
  setFont(ctx, spec.oW, spec.oSize, famO);
  const ol = wrapIn(ctx, g.o, maxW);
  let tl = [], famT = '';
  if (env.st.showTrans && g.t) {
    famT = hasKana(g.t) ? env.fp.jp : env.fp.zh;
    setFont(ctx, spec.tW, spec.tSize, famT);
    tl = wrapIn(ctx, g.t, maxW);
  }
  const h = ol.length * spec.oLh + (tl.length ? spec.gap + tl.length * spec.tLh : 0);
  return { idx: g.idx, ol, tl, famO, famT, h, spec };
}

function drawGroup(ctx, m, x, y, col, align) {
  const s = m.spec;
  setFont(ctx, s.oW, s.oSize, m.famO);
  ctx.fillStyle = col.o;
  drawLines(ctx, m.ol, x, y, s.oLh, align, true);
  if (m.tl.length) {
    setFont(ctx, s.tW, s.tSize, m.famT);
    ctx.fillStyle = col.t;
    drawLines(ctx, m.tl, x, y + m.ol.length * s.oLh + s.gap, s.tLh, align, true);
  }
}

function stackHeight(ms, gap, extra = () => 0) {
  return ms.reduce((sum, m, i) => sum + m.h + extra(m) + (i ? gap : 0), 0);
}

function pushHit(env, idx, x, y, w, h, gap) {
  env.hits.push({ index: idx, x, y: y - gap / 2, w, h: h + gap });
}

function placeholder(ctx, env, x, y, align, color, draw) {
  if (!draw) return;
  setFont(ctx, env.fp.w.regular, 15, env.fp.zh);
  ctx.fillStyle = color;
  drawLines(ctx, [PLACEHOLDER], x, y, 22, align, true);
}

function ellipsize(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  const chars = Array.from(text);
  while (chars.length && ctx.measureText(chars.join('') + '…').width > maxW) chars.pop();
  return chars.join('') + '…';
}

/** Title + artist block; returns the new y. */
function titleBlock(ctx, env, o) {
  const t = (env.st.title || '').trim(), a = (env.st.artist || '').trim();
  let y = o.y;
  if (t) {
    setFont(ctx, o.tW, o.tSize, familyFor(env.fp, t));
    const ls = wrapIn(ctx, t, o.maxW).slice(0, o.maxLines || 3);
    if (o.draw) ctx.fillStyle = o.tColor;
    y += drawLines(ctx, ls, o.x, y, o.tLh, o.align, o.draw);
  }
  if (a) {
    if (t) y += o.gap;
    setFont(ctx, o.aW, o.aSize, familyFor(env.fp, a));
    const ls = wrapIn(ctx, a, o.maxW).slice(0, o.maxLines || 3);
    if (o.draw) ctx.fillStyle = o.aColor;
    y += drawLines(ctx, ls, o.x, y, o.aLh, o.align, o.draw);
  }
  return y;
}

function timesRow(ctx, env, x, right, y, color) {
  const ex = env.st.extras;
  setFont(ctx, 400, 12, MONO);
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(ex.cur || '', x, y);
  ctx.textAlign = 'right';
  ctx.fillText(ex.dur || '', right, y);
}

/** Optional QR code and date stamp at the bottom of the long templates. */
function footer(ctx, env, o) {
  const ex = env.st.extras;
  const showQr = env.sup.qr && ex.qr && (ex.link || '').trim();
  const showDate = env.sup.date && ex.date && (ex.dateText || '').trim();
  if (!showQr && !showDate) return o.y;
  const y = o.y + o.gapTop;
  const rowH = showQr ? o.qrSize : 16;
  if (o.draw) {
    if (showQr) {
      const ok = drawQR(ctx, ex.link.trim(), o.x, y, o.qrSize, o.c.qrFg, o.c.qrBg);
      if (ok) {
        const src = (ex.source || '').trim();
        const tx = o.x + o.qrSize + 16;
        const maxW = o.right - tx - (showDate ? 120 : 0);
        setFont(ctx, env.fp.w.regular, 14, env.fp.zh);
        ctx.fillStyle = o.c.text;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(ellipsize(ctx, QR_LABEL, maxW), tx, y + rowH / 2 - (src ? 10 : 0));
        if (src) {
          setFont(ctx, env.fp.w.regular, 12, familyFor(env.fp, src));
          ctx.fillStyle = o.c.sub;
          ctx.fillText(ellipsize(ctx, src, maxW), tx, y + rowH / 2 + 11);
        }
      }
    }
    if (showDate) {
      setFont(ctx, 400, 11, MONO);
      ctx.fillStyle = o.c.date;
      drawSpaced(ctx, ex.dateText.trim(), o.right, y + rowH / 2, 0.6, 'right');
    }
  }
  return y + rowH;
}

/** OKLab distance between two hex colours (0 = identical, ~0.1 = clearly different). */
function okDistance(a, b) {
  const p = hexToOklch(a), q = hexToOklch(b);
  const ar = p.H * Math.PI / 180, br = q.H * Math.PI / 180;
  return Math.hypot(p.L - q.L, p.C * Math.cos(ar) - q.C * Math.cos(br), p.C * Math.sin(ar) - q.C * Math.sin(br));
}

// ---------- 紧凑 ----------

const compact = {
  coverMax: 80, coverMin: 0, center: true,
  layout(ctx, env, p, draw) {
    const st = env.st, ex = st.extras, fs = p.fs, w = env.fp.w;
    const c = env.pal;
    const align = st.align === 'center' ? 'center' : 'left';
    const off = p.off || 0;
    const padX = 40, innerW = 460;
    if (draw) { ctx.fillStyle = c.bg; ctx.fillRect(0, 0, W, env.canvasH); }

    // Header: small cover beside the title, on a tonal container.
    let y = 48 + off;
    const cov = 80, hp = 16, hg = 18;
    const metaX = padX + hp + cov + hg, metaW = innerW - hp * 2 - cov - hg;
    const metaOpts = {
      x: metaX, maxW: metaW, align: 'left', maxLines: 2,
      tSize: 24 * fs, tLh: 32 * fs, tW: w.medium, tColor: c.on,
      aSize: 16 * fs, aLh: 24 * fs, aW: w.regular, aColor: c.onVar, gap: 4,
    };
    const metaH = titleBlock(ctx, env, { ...metaOpts, y: 0, draw: false });
    const headH = Math.max(cov, metaH) + hp * 2;
    if (draw) {
      ctx.fillStyle = c.container;
      rr(ctx, padX, y, innerW, headH, 24); ctx.fill();
      drawCoverCard(ctx, env.cover.source, padX + hp, y + (headH - cov) / 2, cov, 16, { color: c.shadow, blur: 20, y: 8, fill: c.container }, env.k);
      titleBlock(ctx, env, { ...metaOpts, y: y + (headH - metaH) / 2, draw: true });
    }
    y += headH + 40;

    // Lyrics: focused groups turn accent and bold, the rest step back.
    const base = { oSize: 23 * fs, oLh: 34 * fs, oW: w.medium, tSize: 16 * fs, tLh: 25 * fs, tW: w.regular, gap: 6 * fs };
    const bold = { ...base, oW: w.bold };
    const lx = align === 'center' ? W / 2 : padX + 4, maxW = innerW - 8;
    const ms = p.groups.map((g) => measureGroup(ctx, env, g, maxW, env.focus.has(g.idx) ? bold : base));
    const gap = 28 * fs;
    if (!ms.length) { placeholder(ctx, env, lx, y, align, c.onVar, draw); y += 22; }
    ms.forEach((m, i) => {
      if (i) y += gap;
      const on = env.focus.has(m.idx);
      if (draw) {
        const col = !env.hasFocus ? { o: c.on, t: c.onVar }
          : on ? { o: c.accent, t: c.onVar }
          : { o: withAlpha(c.on, 0.5), t: withAlpha(c.onVar, 0.5) };
        drawGroup(ctx, m, lx, y, col, align);
      }
      pushHit(env, m.idx, padX, y, innerW, m.h, gap);
      y += m.h;
    });

    if (env.sup.progress && ex.progress) {
      y += 36;
      if (draw) {
        drawWave(ctx, padX, y + 10, innerW, progressFraction(ex), { active: c.accent, track: c.track }, 4, 3, 26);
        timesRow(ctx, env, padX, padX + innerW, y + 32, c.onVar);
      }
      y += 42;
    }

    y = footer(ctx, env, {
      x: padX, right: padX + innerW, y, gapTop: 36, qrSize: 72, draw,
      c: { text: c.on, sub: c.onVar, date: c.onVar, qrFg: '#111111', qrBg: '#FFFFFF' },
    });
    return y + 56 - off;
  },
};

// ---------- 经典 ----------

const classic = {
  coverMax: 540, coverMin: 240, center: false,
  layout(ctx, env, p, draw) {
    const st = env.st, fs = p.fs, w = env.fp.w;
    const c = env.pal;
    const align = st.align === 'center' ? 'center' : 'left';
    const ch = p.cover;
    // Fade the cover into the background only when its bottom edge is close to the background;
    // a long fade between unrelated colours reads as a smudge, so it shortens and then disappears.
    const edgeGap = okDistance(env.analysis.edges.bottom, c.bg);
    const fade = edgeGap <= 0.1 ? 132 : edgeGap <= 0.22 ? 56 : 0;
    if (draw) {
      ctx.fillStyle = c.bg;
      ctx.fillRect(0, 0, W, env.canvasH);
      drawCoverFit(ctx, env.cover.source, 0, 0, W, ch, 0.3);
      if (fade) {
        const g = ctx.createLinearGradient(0, ch - fade, 0, ch);
        g.addColorStop(0, withAlpha(c.bg, 0));
        g.addColorStop(1, c.bg);
        ctx.fillStyle = g;
        ctx.fillRect(0, ch - fade, W, fade + 1);
      }
    }
    const hasMeta = (st.title || '').trim() || (st.artist || '').trim();
    // With the long fade the title sits on the faded edge of the cover, as in the design;
    // otherwise it starts below the cover.
    let y = !hasMeta ? ch : fade === 132 ? ch - 36 : ch + 28;
    y = titleBlock(ctx, env, {
      x: align === 'center' ? W / 2 : 36, y, maxW: 468, align, draw,
      tSize: 28 * fs, tLh: 36 * fs, tW: w.medium, tColor: c.on,
      aSize: 15 * fs, aLh: 22 * fs, aW: w.regular, aColor: c.onVar, gap: 4,
    });
    y += 40;

    const spec = { oSize: 21 * fs, oLh: 31 * fs, oW: w.medium, tSize: 14.5 * fs, tLh: 22 * fs, tW: w.regular, gap: 6 * fs };
    const lx = align === 'center' ? W / 2 : 36;
    const ms = p.groups.map((g) => measureGroup(ctx, env, g, 468, spec));
    const gap = 32 * fs;
    if (!ms.length) { placeholder(ctx, env, lx, y, align, c.onVar, draw); y += 22; }
    ms.forEach((m, i) => {
      if (i) y += gap;
      const on = env.focus.has(m.idx);
      if (draw) drawGroup(ctx, m, lx, y, on ? { o: c.accent, t: c.accent } : { o: c.on, t: c.onVar }, align);
      pushHit(env, m.idx, 24, y, 492, m.h, gap);
      y += m.h;
    });

    y = footer(ctx, env, {
      x: 36, right: 504, y, gapTop: 52, qrSize: 64, draw,
      c: { text: c.on, sub: c.onVar, date: c.onVar, qrFg: '#111111', qrBg: '#FFFFFF' },
    });
    return y + 64;
  },
};

// ---------- photo templates: shared pieces ----------

/** Neutral (never tinted) text colours for text that sits on a photo. */
function photoInk(dark) {
  return dark
    ? { ink: '#FFFFFF', ink2: 'rgba(255, 255, 255, 0.8)', sub: 'rgba(255, 255, 255, 0.78)', time: 'rgba(255, 255, 255, 0.72)', wave: '#FFFFFF', track: 'rgba(255, 255, 255, 0.3)', tone: '0, 0, 0' }
    : { ink: '#15171C', ink2: 'rgba(21, 23, 28, 0.78)', sub: 'rgba(21, 23, 28, 0.72)', time: 'rgba(21, 23, 28, 0.7)', wave: '#15171C', track: 'rgba(21, 23, 28, 0.25)', tone: '255, 255, 255' };
}

/** Gradients only where text sits: a band at the top for the title row, and one under the lyrics. */
function textShades(ctx, H, lyricsTop, ink, dark) {
  const t = ink.tone;
  const top = ctx.createLinearGradient(0, 0, 0, 120);
  top.addColorStop(0, `rgba(${t}, ${dark ? 0.45 : 0.55})`);
  top.addColorStop(1, `rgba(${t}, 0)`);
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, W, 120);
  const from = Math.max(0, lyricsTop - 90);
  const bot = ctx.createLinearGradient(0, from, 0, H);
  bot.addColorStop(0, `rgba(${t}, 0)`);
  bot.addColorStop(0.3, `rgba(${t}, ${dark ? 0.42 : 0.55})`);
  bot.addColorStop(1, `rgba(${t}, ${dark ? 0.64 : 0.78})`);
  ctx.fillStyle = bot;
  ctx.fillRect(0, from, W, H - from);
}

/** Thumbnail, title, artist and optional date along the top of a photo card. */
function photoHeader(ctx, env, ink) {
  const st = env.st, ex = st.extras, w = env.fp.w;
  drawCoverCard(ctx, env.cover.source, 32, 32, 64, 14, null, env.k);
  const showDate = env.sup.date && ex.date && (ex.dateText || '').trim();
  let dateW = 0;
  if (showDate) {
    setFont(ctx, 400, 11, MONO);
    dateW = ctx.measureText(ex.dateText.trim()).width + ex.dateText.trim().length * 0.6 + 16;
  }
  const tx = 110, tMax = W - tx - 32 - dateW;
  const t = (st.title || '').trim(), a = (st.artist || '').trim();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  if (t) {
    setFont(ctx, w.medium, 17, familyFor(env.fp, t));
    ctx.fillStyle = ink.ink;
    ctx.fillText(ellipsize(ctx, t, tMax), tx, a ? 52 : 64);
  }
  if (a) {
    setFont(ctx, w.regular, 13, familyFor(env.fp, a));
    ctx.fillStyle = ink.sub;
    ctx.fillText(ellipsize(ctx, a, tMax), tx, t ? 75 : 64);
  }
  if (showDate) {
    setFont(ctx, 400, 11, MONO);
    ctx.fillStyle = ink.time;
    drawSpaced(ctx, ex.dateText.trim(), W - 32, 64, 0.6, 'right');
  }
}

/** Lyrics for the photo templates: bottom-aligned; focus is marked by brightness only. */
function photoLyrics(ctx, env, p, H, draw) {
  const st = env.st, ex = st.extras, fs = p.fs, w = env.fp.w;
  const spec = { oSize: 28 * fs, oLh: 38 * fs, oW: w.bold, tSize: 16 * fs, tLh: 24 * fs, tW: w.regular, gap: 6 * fs };
  const gap = 28 * fs;
  const ms = p.groups.map((g) => measureGroup(ctx, env, g, 476, spec));
  const lyrH = ms.length ? stackHeight(ms, gap) : 22;
  const showProg = env.sup.progress && ex.progress;
  const bottom = showProg ? 32 + 42 : 0;
  const natural = 32 + 64 + 32 + lyrH + bottom + 32;
  const top = Math.max(128, (H || natural) - 32 - bottom - lyrH);
  return {
    natural, top, showProg,
    draw(ink) {
      const align = st.align === 'center' ? 'center' : 'left';
      const lx = align === 'center' ? W / 2 : 32;
      let ly = top;
      if (!ms.length) placeholder(ctx, env, lx, ly, align, ink.ink2, true);
      ms.forEach((m, i) => {
        if (i) ly += gap;
        const on = env.focus.has(m.idx);
        ctx.globalAlpha = env.hasFocus && !on ? 0.4 : 1;
        drawGroup(ctx, m, lx, ly, { o: ink.ink, t: ink.ink2 }, align);
        ctx.globalAlpha = 1;
        pushHit(env, m.idx, 24, ly, 492, m.h, gap);
        ly += m.h;
      });
      if (showProg) {
        const py = H - 32 - 42;
        drawWave(ctx, 32, py + 10, 476, progressFraction(ex), { active: ink.wave, track: ink.track }, 4, 3, 30);
        timesRow(ctx, env, 32, W - 32, py + 34, ink.time);
      }
    },
  };
}

/** A design-px rectangle as device px for the blur cache. */
const dev = (env, v) => Math.max(1, Math.round(v * env.k));

/** Offscreen card-sized canvas (device px) with the same transform as the card. */
function cardLayer(env, H) {
  const c = document.createElement('canvas');
  c.width = dev(env, W);
  c.height = dev(env, H);
  const g = c.getContext('2d');
  g.setTransform(env.k, 0, 0, env.k, 0, 0);
  return { c, g };
}

/** Keep a vertical band of a layer: stops are [position 0..1, alpha]. */
function maskVertical(layer, H, stops) {
  const g = layer.g;
  g.globalCompositeOperation = 'destination-in';
  const m = g.createLinearGradient(0, 0, 0, H);
  for (const [pos, a] of stops) m.addColorStop(pos, `rgba(0, 0, 0, ${a})`);
  g.fillStyle = m;
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'source-over';
}

// ---------- 沉浸：完整封面 · 轻模糊 ----------

const immersive = {
  coverMax: 0, coverMin: 0, center: false,
  layout(ctx, env, p, draw) {
    const H = env.H || 960;
    const lyr = photoLyrics(ctx, env, p, H, draw);
    if (!draw) return lyr.natural;

    const dark = env.darkMode;
    const ink = photoInk(dark);
    const src = env.cover.source;
    const sigma = BLUR_SIGMA[env.st.blur.immersive] ?? BLUR_SIGMA.mid;
    // Far layer: the cover heavily blurred, filling the whole frame (fills the bands above and below).
    const side = Math.max(W, H);
    const far = blurred(env, src, dev(env, side), dev(env, side), 48 * env.k);
    ctx.drawImage(far, (W - side) / 2, (H - side) / 2, side, side);
    // Near layer: the whole square cover, lightly blurred, fading into the far layer at top and bottom.
    const near = blurred(env, src, dev(env, W), dev(env, W), sigma * env.k);
    const y0 = H > W ? Math.round((H - W) / 2) : 0;
    if (H > W) {
      const layer = cardLayer(env, H);
      layer.g.drawImage(near, 0, y0, W, W);
      const fade = Math.min(120, (H - W) / 2 + 60);
      maskVertical(layer, H, [[0, 0], [(y0) / H, 0], [(y0 + fade) / H, 1], [(y0 + W - fade) / H, 1], [(y0 + W) / H, 0], [1, 0]]);
      ctx.drawImage(layer.c, 0, 0, W, H);
    } else {
      ctx.drawImage(near, 0, 0, W, W);
    }
    ctx.fillStyle = `rgba(${ink.tone}, ${dark ? 0.18 : 0.22})`;
    ctx.fillRect(0, 0, W, H);
    textShades(ctx, H, lyr.top, ink, dark);
    photoHeader(ctx, env, ink);
    lyr.draw(ink);
    return lyr.natural;
  },
};

// ---------- 景深：铺满取景 · 上清下柔 ----------

/** Crop offset (design px) so that the chosen point of the cover sits in the middle of the card. */
export function depthCrop(state, analysis, H) {
  const S = Math.round(H * 1.04);
  const fx = state.depthX ?? analysis.focus.x ?? 0.5;
  const x0 = Math.min(0, Math.max(W - S, Math.round(W / 2 - fx * S)));
  return { S, x0, y0: Math.round((H - S) / 2), range: S - W };
}

const DEPTH_FAR = { light: 18, mid: 30, heavy: 44 };

const depth = {
  coverMax: 0, coverMin: 0, center: false,
  layout(ctx, env, p, draw) {
    const H = env.H || 960;
    const lyr = photoLyrics(ctx, env, p, H, draw);
    if (!draw) return lyr.natural;

    const dark = env.darkMode;
    const ink = photoInk(dark);
    const src = env.cover.source;
    const { S, x0, y0 } = depthCrop(env.st, env.analysis, H);
    const farSigma = DEPTH_FAR[env.st.blur.depth] ?? DEPTH_FAR.mid;
    const sizes = dev(env, S);
    const far = blurred(env, src, sizes, sizes, farSigma * env.k);
    const mid = blurred(env, src, sizes, sizes, farSigma / 3 * env.k);
    // Bottom: far blur everywhere; middle band: lighter blur; top: the sharp cover.
    ctx.drawImage(far, x0, y0, S, S);
    const midLayer = cardLayer(env, H);
    midLayer.g.drawImage(mid, x0, y0, S, S);
    maskVertical(midLayer, H, [[0, 1], [0.55, 1], [0.78, 0], [1, 0]]);
    ctx.drawImage(midLayer.c, 0, 0, W, H);
    const nearLayer = cardLayer(env, H);
    drawCoverFit(nearLayer.g, src, x0, y0, S, S);
    maskVertical(nearLayer, H, [[0, 1], [0.32, 1], [0.55, 0], [1, 0]]);
    ctx.drawImage(nearLayer.c, 0, 0, W, H);
    ctx.fillStyle = `rgba(${ink.tone}, ${dark ? 0.1 : 0.14})`;
    ctx.fillRect(0, 0, W, H);
    textShades(ctx, H, lyr.top, ink, dark);
    photoHeader(ctx, env, ink);
    lyr.draw(ink);
    return lyr.natural;
  },
};

// ---------- 留白 ----------

const quiet = {
  coverMax: 244, coverMin: 128, center: false,
  layout(ctx, env, p, draw) {
    const st = env.st, ex = st.extras, fs = p.fs, w = env.fp.w;
    const fixedH = env.H;
    const baseH = fixedH || 960;
    const align = st.align === 'center' ? 'center' : 'left';
    const topY = baseH <= 600 ? 52 : baseH <= 720 ? 74 : 96;
    const minGap = baseH <= 600 ? 32 : 52;
    const cs = fixedH ? Math.min(p.cover, Math.round(fixedH * 0.3)) : p.cover;

    const spec = { oSize: 20 * fs, oLh: 30 * fs, oW: w.medium, tSize: 13.5 * fs, tLh: 20.5 * fs, tW: w.regular, gap: 5 * fs };
    const boldSpec = { ...spec, oW: w.bold };
    const gap = 22 * fs;
    const ms = p.groups.map((g) => measureGroup(ctx, env, g, 460, env.focus.has(g.idx) ? boldSpec : spec));
    const lyrH = ms.length ? stackHeight(ms, gap) : 22;

    const showProg = env.sup.progress && ex.progress;
    const showNote = env.sup.note && ex.note && (ex.noteText || '').trim();
    const progBlockH = showProg ? 40 + 32 : 0;
    const bottomPad = showNote ? 76 : (baseH <= 600 ? 44 : 68);
    const minTop = topY + cs + minGap;

    // Keep generous serene whitespace when lyrics are short; rise smoothly as more lines are added.
    const idealTop = baseH - bottomPad - progBlockH - lyrH;
    const sparseCap = Math.round(baseH * 0.63);
    const lyTop = Math.max(minTop, Math.min(idealTop, sparseCap));

    const contentEnd = lyTop + lyrH + progBlockH + bottomPad;
    const need = fixedH ? contentEnd : Math.max(960, contentEnd);
    if (!draw) return need;

    const P = env.pal;
    const c = { bg: P.bg, ink: P.on, ink2: P.onVar, dot: P.accent, track: withAlpha(P.on, 0.18) };
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, W, env.canvasH);

    if (env.sup.date && ex.date && (ex.dateText || '').trim()) {
      setFont(ctx, 400, 11, MONO);
      ctx.fillStyle = c.ink2;
      drawSpaced(ctx, ex.dateText.trim(), W - 40, Math.max(30, topY / 2), 1.3, 'right');
    }

    drawCoverCard(ctx, env.cover.source, 40, topY, cs, 6, null, env.k);

    // Vertical title and artist on the right edge, shrunk if they would reach the lyrics.
    const maxV = Math.max(96, lyTop - 36 - topY);
    const t = (st.title || '').trim(), a = (st.artist || '').trim();
    if (t) {
      const fam = familyFor(env.fp, t);
      let size = 22 * fs;
      setFont(ctx, w.medium, size, fam);
      const h0 = verticalHeight(ctx, t, size, 0.32);
      if (h0 > maxV) { size = Math.max(12, size * maxV / h0); setFont(ctx, w.medium, size, fam); }
      ctx.fillStyle = c.ink;
      drawVertical(ctx, t, W - 44 - 14, topY, size, 0.32);
    }
    if (a) {
      const fam = familyFor(env.fp, a);
      let size = 12 * fs;
      setFont(ctx, w.regular, size, fam);
      const h0 = verticalHeight(ctx, a, size, 0.28);
      if (h0 > maxV) { size = Math.max(9, size * maxV / h0); setFont(ctx, w.regular, size, fam); }
      ctx.fillStyle = c.ink2;
      drawVertical(ctx, a, W - 44 - (t ? 28 + 14 + 8 : 8), topY, size, 0.28);
    }

    let ly = lyTop;
    const lx = align === 'center' ? W / 2 : 40;
    if (!ms.length) placeholder(ctx, env, lx, ly, align, c.ink2, true);
    ms.forEach((m, i) => {
      if (i) ly += gap;
      const on = env.focus.has(m.idx);
      const col = !env.hasFocus || on
        ? { o: c.ink, t: c.ink2 }
        : { o: withAlpha(c.ink, 0.44), t: withAlpha(c.ink2, 0.48) };
      drawGroup(ctx, m, lx, ly, col, align);
      pushHit(env, m.idx, 24, ly, 492, m.h, gap);
      ly += m.h;
    });

    if (showProg) {
      const py = ly + 40;
      const frac = progressFraction(ex);
      ctx.fillStyle = c.track;
      ctx.fillRect(40, py + 3.25, 460, 1.5);
      ctx.fillStyle = c.ink;
      ctx.fillRect(40, py + 3.25, 460 * frac, 1.5);
      ctx.fillStyle = c.dot;
      ctx.beginPath(); ctx.arc(40 + 460 * frac, py + 4, 4, 0, Math.PI * 2); ctx.fill();
      setFont(ctx, 400, 11, MONO);
      ctx.fillStyle = c.ink2;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${ex.cur || ''} / ${ex.dur || ''}`, 40, py + 24);
    }

    if (showNote) {
      const n = ex.noteText.trim();
      setFont(ctx, w.regular, 11, familyFor(env.fp, n));
      ctx.fillStyle = c.ink2;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(ellipsize(ctx, n, 460), 40, env.canvasH - 36);
    }
    return need;
  },
};

export const TEMPLATES = { compact, classic, immersive, quiet, depth };
