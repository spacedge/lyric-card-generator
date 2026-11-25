// The four card templates. Each layout(ctx, env, p, draw) returns the card's content height
// in design pixels; with draw = false it only measures. Numbers follow the design boards
// (half of the 1080 export size).
import { palette, withAlpha, ensureContrast, hueDistance, hexToOklch, contrast } from '../color.js';
import { hasKana } from '../text.js';
import {
  W, MONO, familyFor, setFont, wrapIn, drawLines, drawSpaced, rr, drawCoverFit, drawCoverCard,
  progressFraction, drawWave, drawQR, verticalHeight, drawVertical, drawGrain,
} from './common.js';

const PLACEHOLDER = '歌词会出现在这里';
const QR_LABEL = '长按识别二维码收听';

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

/** A colour from the cover far enough in hue from the seed (e.g. the moon's yellow on a blue cover). */
function secondSeed(env) {
  const base = env.sch.seed;
  for (const hex of env.assets.seeds || []) {
    const o = hexToOklch(hex);
    if (o.C >= 0.05 && hueDistance(o.H, base.H) >= 60) return o;
  }
  return null;
}

// ---------- 紧凑（方案 A 改良） ----------

function compactColors(env) {
  const st = env.st, s = env.sch.seed;
  const H = s.C < 0.015 ? 250 : s.H;
  const C = st.variant === 'mono' ? 0
    : st.variant === 'tonal' ? Math.min(s.C, 0.09)
    : st.variant === 'vibrant' ? Math.min(Math.max(s.C * 1.5, 0.12), 0.25)
    : s.C;
  const two = st.variant === 'mono' ? null : secondSeed(env);
  if (st.dark.compact) {
    const bg = palette(H, Math.min(C * 0.34, 0.048))(10);
    const container = palette(H, Math.min(C * 0.44, 0.068))(19);
    const on = palette(H, Math.min(C * 0.08, 0.013))(96);
    const onVar = ensureContrast(palette(H, Math.min(C * 0.26, 0.048)), 74, bg, 5.8, 1);
    const accPal = two ? palette(two.H, Math.min(Math.max(two.C, 0.06), 0.12))
      : palette((H + 175) % 360, st.variant === 'mono' ? 0 : Math.min(Math.max(C * 0.35, 0.055), 0.09));
    const accent = ensureContrast(accPal, 88, bg, 8, 1);
    return { bg, container, on, onVar, accent, track: withAlpha(on, 0.16), shadow: 'rgba(3, 10, 26, 0.55)' };
  }
  const bg = palette(H, Math.min(C * 0.22, 0.032))(94);
  const container = palette(H, Math.min(C * 0.30, 0.045))(89);
  const on = ensureContrast(palette(H, Math.min(C * 0.32, 0.055)), 22, bg, 10.5, -1);
  const onVar = ensureContrast(palette(H, Math.min(C * 0.28, 0.052)), 45, bg, 5.2, -1);
  const accent = ensureContrast(palette(H, st.variant === 'mono' ? 0 : Math.min(Math.max(C * 0.75, 0.09), 0.16)), 40, bg, 5, -1);
  return { bg, container, on, onVar, accent, track: withAlpha(on, 0.14), shadow: withAlpha(on, 0.28) };
}

const compact = {
  coverMax: 80, coverMin: 0, center: true,
  layout(ctx, env, p, draw) {
    const st = env.st, ex = st.extras, fs = p.fs, w = env.fp.w;
    const c = compactColors(env);
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

// ---------- C 经典改良 ----------

function classicColors(env) {
  const st = env.st, sch = env.sch;
  // Mono keeps the seed's lightness but drops its hue (for grey OKLab L = cbrt(Y), so tone = 116L - 16).
  const bg = st.variant === 'mono'
    ? palette(0, 0)(Math.max(0, Math.min(100, Math.round(116 * sch.seed.L - 16))))
    : (st.seed || sch.seedHex);
  const darkBg = contrast(bg, '#FFFFFF') >= contrast(bg, '#111111');
  const dir = darkBg ? 1 : -1;
  const ink = ensureContrast(sch.n, darkBg ? 95 : 10, bg, 7, dir);
  const ink2 = ensureContrast(sch.p, darkBg ? 80 : 30, bg, 4.5, dir);
  // Accent: another colour from the cover, else the seed's complement (a pale warm tone on blue).
  const two = st.variant === 'mono' ? null : secondSeed(env);
  const s = sch.seed;
  const accPal = two ? palette(two.H, Math.max(two.C, 0.06))
    : palette(((s.C < 0.015 ? 250 : s.H) + 175) % 360, st.variant === 'mono' ? 0 : Math.min(Math.max(s.C * 0.35, 0.055), 0.09));
  const accent = ensureContrast(accPal, darkBg ? 87 : 35, bg, 4.5, dir);
  return { bg, ink, ink2, accent, qrFg: sch.n(10), qrBg: sch.n(98) };
}

const classic = {
  coverMax: 540, coverMin: 240, center: false,
  layout(ctx, env, p, draw) {
    const st = env.st, fs = p.fs, w = env.fp.w;
    const c = classicColors(env);
    const align = st.align === 'center' ? 'center' : 'left';
    const ch = p.cover;
    if (draw) {
      ctx.fillStyle = c.bg;
      ctx.fillRect(0, 0, W, env.canvasH);
      drawCoverFit(ctx, env.cover.source, 0, 0, W, ch, 0.3);
      const g = ctx.createLinearGradient(0, ch - 132, 0, ch);
      g.addColorStop(0, withAlpha(c.bg, 0));
      g.addColorStop(1, c.bg);
      ctx.fillStyle = g;
      ctx.fillRect(0, ch - 132, W, 133);
    }
    const hasMeta = (st.title || '').trim() || (st.artist || '').trim();
    let y = hasMeta ? ch - 36 : ch;
    y = titleBlock(ctx, env, {
      x: align === 'center' ? W / 2 : 36, y, maxW: 468, align, draw,
      tSize: 28 * fs, tLh: 36 * fs, tW: w.medium, tColor: c.ink,
      aSize: 15 * fs, aLh: 22 * fs, aW: w.regular, aColor: c.ink2, gap: 4,
    });
    y += 40;

    const spec = { oSize: 21 * fs, oLh: 31 * fs, oW: w.medium, tSize: 14.5 * fs, tLh: 22 * fs, tW: w.regular, gap: 6 * fs };
    const lx = align === 'center' ? W / 2 : 36;
    const ms = p.groups.map((g) => measureGroup(ctx, env, g, 468, spec));
    const gap = 32 * fs;
    if (!ms.length) { placeholder(ctx, env, lx, y, align, c.ink2, draw); y += 22; }
    ms.forEach((m, i) => {
      if (i) y += gap;
      const on = env.focus.has(m.idx);
      if (draw) drawGroup(ctx, m, lx, y, on ? { o: c.accent, t: c.accent } : { o: c.ink, t: c.ink2 }, align);
      pushHit(env, m.idx, 24, y, 492, m.h, gap);
      y += m.h;
    });

    y = footer(ctx, env, {
      x: 36, right: 504, y, gapTop: 52, qrSize: 64, draw,
      c: { text: c.ink, sub: c.ink2, date: c.ink2, qrFg: c.qrFg, qrBg: c.qrBg },
    });
    return y + 64;
  },
};

// ---------- D 沉浸 ----------

function immersiveColors(env) {
  const st = env.st, sch = env.sch;
  if (st.dark.immersive) {
    return {
      base: sch.p(10), scrim: withAlpha(sch.p(10), st.scrim), grad: withAlpha(sch.p(10), 0.55),
      ink: '#FFFFFF', ink2: 'rgba(255, 255, 255, 0.78)', sub: sch.p(87), time: 'rgba(255, 255, 255, 0.72)',
      wave: '#FFFFFF', track: 'rgba(255, 255, 255, 0.28)',
    };
  }
  return {
    base: sch.p(98), scrim: withAlpha(sch.p(98), Math.min(0.92, st.scrim + 0.25)), grad: withAlpha(sch.p(98), 0.6),
    ink: sch.n(10), ink2: sch.nv(30), sub: sch.p(40), time: sch.nv(30),
    wave: sch.p(40), track: withAlpha(sch.n(10), 0.2),
  };
}

const immersive = {
  coverMax: 0, coverMin: 0, center: false,
  layout(ctx, env, p, draw) {
    const st = env.st, ex = st.extras, fs = p.fs, w = env.fp.w;
    const align = st.align === 'center' ? 'center' : 'left';
    const spec = { oSize: 28 * fs, oLh: 38 * fs, oW: w.bold, tSize: 16 * fs, tLh: 24 * fs, tW: w.regular, gap: 6 * fs };
    const gap = 28 * fs;
    const ms = p.groups.map((g) => measureGroup(ctx, env, g, 476, spec));
    const lyrH = ms.length ? stackHeight(ms, gap) : 22;
    const showProg = env.sup.progress && ex.progress;
    const bottom = showProg ? 32 + 42 : 0;
    const natural = 32 + 64 + 32 + lyrH + bottom + 32;
    if (!draw) return natural;

    const H = env.canvasH;
    const c = immersiveColors(env);
    ctx.fillStyle = c.base;
    ctx.fillRect(0, 0, W, H);
    const side = Math.max(W, H) * 1.25;
    ctx.drawImage(env.cover.blurred, (W - side) / 2, (H - side) / 2, side, side);
    ctx.fillStyle = c.scrim;
    ctx.fillRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, H * 0.62, 0, H);
    g.addColorStop(0, withAlpha(c.base, 0));
    g.addColorStop(1, c.grad);
    ctx.fillStyle = g;
    ctx.fillRect(0, H * 0.62, W, H * 0.38 + 1);
    drawGrain(ctx, W, H, env.k, 0.1);

    // Top row: thumbnail, title, artist, optional date.
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
      ctx.fillStyle = c.ink;
      ctx.fillText(ellipsize(ctx, t, tMax), tx, a ? 52 : 64);
    }
    if (a) {
      setFont(ctx, w.regular, 13, familyFor(env.fp, a));
      ctx.fillStyle = c.sub;
      ctx.fillText(ellipsize(ctx, a, tMax), tx, t ? 75 : 64);
    }
    if (showDate) {
      setFont(ctx, 400, 11, MONO);
      ctx.fillStyle = c.time;
      drawSpaced(ctx, ex.dateText.trim(), W - 32, 64, 0.6, 'right');
    }

    // Lyrics centred in the space between the top row and the bottom.
    const regionTop = 128, regionBot = H - 32 - bottom;
    let ly = regionTop + Math.max(0, (regionBot - regionTop - lyrH) / 2);
    const lx = align === 'center' ? W / 2 : 32;
    if (!ms.length) placeholder(ctx, env, lx, ly, align, c.ink2, true);
    ms.forEach((m, i) => {
      if (i) ly += gap;
      const on = env.focus.has(m.idx);
      ctx.globalAlpha = env.hasFocus && !on ? 0.4 : 1;
      drawGroup(ctx, m, lx, ly, { o: c.ink, t: c.ink2 }, align);
      ctx.globalAlpha = 1;
      pushHit(env, m.idx, 24, ly, 492, m.h, gap);
      ly += m.h;
    });

    if (showProg) {
      const py = H - 32 - 42;
      drawWave(ctx, 32, py + 10, 476, progressFraction(ex), { active: c.wave, track: c.track }, 4, 3, 30);
      timesRow(ctx, env, 32, W - 32, py + 34, c.time);
    }
    return natural;
  },
};

// ---------- E 留白 ----------

function quietColors(env) {
  const st = env.st, sch = env.sch;
  const two = st.variant === 'mono' ? null : secondSeed(env);
  if (st.dark.quiet) {
    const bg = sch.p(20);
    return {
      bg, ink: sch.p(95), ink2: ensureContrast(sch.p, 80, bg, 4.5, 1),
      dot: two ? palette(two.H, Math.max(two.C, 0.06))(80) : sch.t(80), track: withAlpha(sch.p(95), 0.2),
    };
  }
  const bg = sch.p(90);
  return {
    bg, ink: sch.p(20), ink2: ensureContrast(sch.p, 40, bg, 4.5, -1),
    dot: two ? palette(two.H, Math.max(two.C, 0.06))(72) : sch.t(70), track: withAlpha(sch.p(20), 0.18),
  };
}

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

    const c = quietColors(env);
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

export const TEMPLATES = { compact, classic, immersive, quiet };
