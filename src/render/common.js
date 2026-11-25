// Drawing helpers shared by every template. All coordinates are design pixels on a
// 540-wide card; the caller has already applied the device scale with setTransform.
import { hasKana, hasHan, hasHangul, wrap } from '../text.js';

export const W = 540;

const KR = '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR"';
const SANS_JP = `"Noto Sans JP", "Yu Gothic UI", "Yu Gothic", YuGothic, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans CJK JP", Meiryo, ${KR}, sans-serif`;
const SANS_ZH = `"Noto Sans SC", "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Source Han Sans SC", ${KR}, sans-serif`;
const SERIF_JP = `"Noto Serif JP", "Yu Mincho", YuMincho, "Hiragino Mincho ProN", "Noto Serif CJK JP", ${KR}, serif`;
const SERIF_ZH = `"Noto Serif SC", "Songti SC", SimSun, "Noto Serif CJK SC", ${KR}, serif`;
export const MONO = '"Roboto Mono", Consolas, "SF Mono", Menlo, monospace';

// web: Google-Fonts families (with the weights the stylesheet provides) that fontsToLoad() asks for.
export const FONTS = {
  sans: { jp: SANS_JP, zh: SANS_ZH, w: { regular: 400, medium: 500, bold: 700 },
    web: [['Noto Sans JP', [400, 500, 700]], ['Noto Sans SC', [400, 500, 700]]] },
  serif: { jp: SERIF_JP, zh: SERIF_ZH, w: { regular: 400, medium: 600, bold: 600 },
    web: [['Noto Serif JP', [400, 600]], ['Noto Serif SC', [400, 600]]] },
  round: { jp: `"Zen Maru Gothic", "Hiragino Maru Gothic ProN", ${SANS_JP}`, zh: SANS_ZH, w: { regular: 400, medium: 500, bold: 700 },
    web: [['Zen Maru Gothic', [400, 500, 700]], ['Noto Sans SC', [400, 500, 700]]] },
  hand: { jp: `"Klee One", "UD Digi Kyokasho NK-R", "UD デジタル 教科書体 NK-R", ${SERIF_JP}`,
    zh: `"LXGW WenKai", "LXGW WenKai Screen", KaiTi, STKaiti, "Kaiti SC", ${SERIF_ZH}`, w: { regular: 400, medium: 600, bold: 600 },
    web: [['Klee One', [400, 600]]] },
  custom: { jp: `"LCUserFont", ${SANS_JP}`, zh: `"LCUserFont", ${SANS_ZH}`, w: { regular: 400, medium: 500, bold: 700 }, web: [] },
};

export function preset(state) {
  return FONTS[state.font] || FONTS.sans;
}

/** Japanese stack for text with kana or plain Latin, Chinese stack for Han/Hangul-only text. */
export function familyFor(fp, text) {
  if (hasKana(text)) return fp.jp;
  if (hasHan(text) || hasHangul(text)) return fp.zh;
  return fp.jp;
}

export function setFont(ctx, weight, size, family) {
  ctx.font = `${weight} ${size}px ${family}`;
}

export function wrapIn(ctx, text, maxW) {
  return wrap((s) => ctx.measureText(s).width, text, maxW);
}

/** Lines are drawn centred in their line box; returns the block height. */
export function drawLines(ctx, lines, x, y, lh, align, draw) {
  if (draw) {
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    lines.forEach((l, i) => ctx.fillText(l, x, y + i * lh + lh / 2));
  }
  return lines.length * lh;
}

const HAS_LETTER_SPACING = typeof CanvasRenderingContext2D !== 'undefined' && 'letterSpacing' in CanvasRenderingContext2D.prototype;

/** Text with tracking (used for the small mono stamps). align: left | right. */
export function drawSpaced(ctx, text, x, y, spacing, align) {
  ctx.textBaseline = 'middle';
  if (HAS_LETTER_SPACING) {
    ctx.letterSpacing = `${spacing}px`;
    ctx.textAlign = align;
    // letterSpacing adds trailing space after the last glyph; shift right-aligned text back.
    ctx.fillText(text, align === 'right' ? x + spacing : x, y);
    ctx.letterSpacing = '0px';
    return;
  }
  ctx.textAlign = 'left';
  const chars = Array.from(text);
  const width = chars.reduce((s, c) => s + ctx.measureText(c).width, 0) + spacing * (chars.length - 1);
  let cx = align === 'right' ? x - width : x;
  for (const c of chars) {
    ctx.fillText(c, cx, y);
    cx += ctx.measureText(c).width + spacing;
  }
}

export function rr(ctx, x, y, w, h, r) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

/** object-fit: cover. fy picks which part survives a vertical crop (0 = top, 0.5 = centre). */
export function drawCoverFit(ctx, src, dx, dy, dw, dh, fy = 0.5) {
  const sw = src.width, sh = src.height;
  if (!sw || !sh) return;
  const s = Math.max(dw / sw, dh / sh);
  const cw = dw / s, ch = dh / s;
  ctx.drawImage(src, (sw - cw) / 2, (sh - ch) * fy, cw, ch, dx, dy, dw, dh);
}

/** Rounded cover with a soft shadow. k = device scale, because canvas shadows ignore the transform. */
export function drawCoverCard(ctx, src, x, y, size, radius, shadow, k, h = size) {
  if (shadow) {
    ctx.save();
    ctx.shadowColor = shadow.color;
    ctx.shadowBlur = shadow.blur * k;
    ctx.shadowOffsetY = shadow.y * k;
    rr(ctx, x, y, size, h, radius);
    ctx.fillStyle = shadow.fill || '#000';
    ctx.fill();
    ctx.restore();
  }
  ctx.save();
  rr(ctx, x, y, size, h, radius);
  ctx.clip();
  drawCoverFit(ctx, src, x, y, size, h);
  ctx.restore();
}

export function parseTime(s) {
  const m = String(s || '').trim().match(/^(\d{1,3})(?::(\d{1,2}))?$/);
  if (!m) return NaN;
  return m[2] === undefined ? Number(m[1]) : Number(m[1]) * 60 + Number(m[2]);
}

export function progressFraction(extras) {
  const cur = parseTime(extras.cur), dur = parseTime(extras.dur);
  if (!(dur > 0) || !(cur >= 0)) return 0.45;
  return Math.max(0, Math.min(1, cur / dur));
}

/** MD3 Expressive wavy progress: wave up to the playhead, flat track after it, stop dot at the end. */
export function drawWave(ctx, x, y, w, frac, colors, stroke = 5, amp = 3.5, wl = 30) {
  const end = x + w * frac;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = stroke;
  const x0 = x + stroke / 2;
  const waveEnd = Math.max(x0, end - stroke);
  if (waveEnd > x0) {
    ctx.beginPath();
    ctx.moveTo(x0, y);
    for (let px = x0; px <= waveEnd; px += 0.75) ctx.lineTo(px, y - Math.sin(((px - x) / wl) * Math.PI * 2) * amp);
    ctx.strokeStyle = colors.active;
    ctx.stroke();
  }
  const ts = Math.max(x0, end + stroke * 1.6), te = x + w - stroke * 2.4;
  if (te > ts) {
    ctx.beginPath();
    ctx.moveTo(ts, y);
    ctx.lineTo(te, y);
    ctx.strokeStyle = colors.track;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(x + w - stroke / 2, y, stroke / 2, 0, Math.PI * 2);
  ctx.fillStyle = colors.active;
  ctx.fill();
}

/** QR code on a light rounded tile with a two-module quiet zone. Returns false if the text can't be encoded. */
export function drawQR(ctx, text, x, y, size, fg, bg) {
  const lib = globalThis.qrcode;
  if (!lib || !text) return false;
  let q;
  try {
    if (lib.stringToBytesFuncs && lib.stringToBytesFuncs['UTF-8']) lib.stringToBytes = lib.stringToBytesFuncs['UTF-8'];
    q = lib(0, 'M');
    q.addData(text, 'Byte');
    q.make();
  } catch {
    return false;
  }
  const n = q.getModuleCount();
  const m = size / (n + 4);
  ctx.fillStyle = bg;
  rr(ctx, x, y, size, size, size * 0.14);
  ctx.fill();
  ctx.fillStyle = fg;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (q.isDark(r, c)) ctx.fillRect(x + (c + 2) * m, y + (r + 2) * m, m + 0.05, m + 0.05);
    }
  }
  return true;
}

// Vertical Japanese text (留白 template). Brackets, long-vowel marks and Latin rotate 90°;
// 、。 move to the upper right of their cell.
const ROTATE = /[ー〜～…‥—―\-－–()（）「」『』【】〈〉《》\[\]［］{}｛｝<>＜＞=＝~]/;
const CORNER = /[、。，．,.]/;
export function verticalHeight(ctx, text, size, spacingEm) {
  let h = 0;
  for (const ch of text) {
    if (ch === ' ' || ch === '　') { h += size * 0.5; continue; }
    const latin = /[A-Za-z0-9]/.test(ch);
    h += (latin ? ctx.measureText(ch).width : size) + size * spacingEm;
  }
  return Math.max(0, h - size * spacingEm);
}
export function drawVertical(ctx, text, cx, y, size, spacingEm) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let yy = y;
  for (const ch of text) {
    if (ch === ' ' || ch === '　') { yy += size * 0.5; continue; }
    const latin = /[A-Za-z0-9]/.test(ch);
    const adv = latin ? ctx.measureText(ch).width : size;
    ctx.save();
    ctx.translate(cx, yy + adv / 2);
    if (latin || ROTATE.test(ch)) ctx.rotate(Math.PI / 2);
    if (CORNER.test(ch)) ctx.translate(size * 0.55, -size * 0.55);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    yy += adv + size * spacingEm;
  }
}

function canvasOf(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

/** 1080×1080 sample cover: night-blue sky, a moon, a lone pole and wires. */
export function makeDefaultCover() {
  const c = canvasOf(1080);
  const g = c.getContext('2d');
  g.scale(10.8, 10.8);
  g.fillStyle = '#23389C'; g.fillRect(0, 0, 100, 100);
  g.fillStyle = '#EEF1FA'; g.beginPath(); g.arc(70, 28, 8.5, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#0F1F6B'; g.lineWidth = 0.35;
  g.beginPath(); g.moveTo(0, 56); g.quadraticCurveTo(44, 63, 100, 52); g.stroke();
  g.lineWidth = 0.3;
  g.beginPath(); g.moveTo(0, 59); g.quadraticCurveTo(44, 66, 100, 55); g.stroke();
  g.fillStyle = '#0F1F6B'; g.fillRect(23.2, 44, 1.6, 38); g.fillRect(19.5, 48, 9, 1);
  g.fillStyle = '#1B2E86'; g.fillRect(0, 82, 100, 18);
  g.globalAlpha = 0.75; g.fillStyle = '#5DAEE6'; g.fillRect(0, 81.6, 100, 0.5); g.globalAlpha = 1;
  g.fillStyle = '#E9BE6A'; g.fillRect(62, 77, 1.6, 2.2);
  return c;
}
