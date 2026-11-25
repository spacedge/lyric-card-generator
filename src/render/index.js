// Public render API (see CONTRACT.md). Renders a card onto a canvas at any scale.
import { parseLyrics } from '../lyrics.js';
import { makeScheme, FALLBACK_SEED } from '../color.js';
import { W, preset, makeBlurred, makeDefaultCover as defaultCoverCanvas } from './common.js';
import { TEMPLATES } from './templates.js';

export const DESIGN_WIDTH = W;

export const TEMPLATE_INFO = {
  compact:   { label: '紧凑', defaultRatio: 'auto', supports: { dark: true,  scrim: false, progress: true,  qr: true,  date: true, note: false } },
  classic:   { label: '经典', defaultRatio: 'auto', supports: { dark: false, scrim: false, progress: false, qr: true,  date: true, note: false } },
  immersive: { label: '沉浸', defaultRatio: '9:16', supports: { dark: true,  scrim: true,  progress: true,  qr: false, date: true, note: false } },
  quiet:     { label: '留白', defaultRatio: 'auto', supports: { dark: true,  scrim: false, progress: true,  qr: false, date: true, note: true } },
};
export const TEMPLATE_ORDER = ['compact', 'classic', 'immersive', 'quiet'];

export const FONT_PRESETS = {
  sans: { label: '黑体' }, serif: { label: '明朝' }, round: { label: '圆体' }, hand: { label: '手写' }, custom: { label: '导入的字体' },
};

const RATIO_HEIGHT = { '4:5': 675, '9:16': 960, '1:1': 540 };
const DARK_DEFAULTS = { compact: true, classic: false, immersive: true, quiet: false };
const EXTRA_DEFAULTS = {
  date: false, dateText: '', note: false, noteText: '', progress: false, cur: '01:52', dur: '04:05',
  qr: false, link: '', source: '',
};

export function makeDefaultCover() {
  return defaultCoverCanvas();
}

export function prepareCover(source) {
  const width = source.naturalWidth || source.videoWidth || source.width;
  const height = source.naturalHeight || source.videoHeight || source.height;
  return { source, width, height, blurred: makeBlurred(source) };
}

export function groupsOf(state) {
  return parseLyrics(state.lyrics || '', state.parseMode || 'bilingual');
}

let schemeMemo = { key: '', value: null };
function schemeFor(seed, variant) {
  const key = `${seed}|${variant}`;
  if (schemeMemo.key !== key) schemeMemo = { key, value: makeScheme(seed, variant) };
  return schemeMemo.value;
}

function normalize(state) {
  return {
    template: 'compact', title: '', artist: '', lyrics: '', parseMode: 'bilingual', focus: [], seed: FALLBACK_SEED,
    variant: 'content', font: 'sans', scale: 1, align: 'left', showTrans: true, ratio: 'auto', scrim: 0.5,
    ...state,
    dark: { ...DARK_DEFAULTS, ...(state.dark || {}) },
    extras: { ...EXTRA_DEFAULTS, ...(state.extras || {}) },
  };
}

/** When a fixed ratio can't hold everything, drop the unfocused group farthest from the first focused one. */
function dropGroup(groups, focus) {
  const anchor = groups.find((g) => focus.has(g.idx))?.idx ?? 0;
  let worst = -1, dist = -1;
  groups.forEach((g, i) => {
    if (focus.has(g.idx)) return;
    const d = Math.abs(g.idx - anchor) + (g.idx > anchor ? 0.5 : 0);
    if (d > dist) { dist = d; worst = i; }
  });
  if (worst < 0) worst = groups.length - 1;
  return groups.filter((_, i) => i !== worst);
}

/** Find cover size, type scale and group list that fit a fixed ratio. */
function solve(ctx, env, T) {
  const base = Math.max(0.6, Math.min(1.5, Number(env.st.scale) || 1));
  const p = { fs: base, cover: T.coverMax, groups: env.groups, off: 0 };
  let h = T.layout(ctx, env, p, false);
  let dropped = 0;
  if (!env.H) return { p, h: Math.ceil(h), dropped };
  let guard = 0;
  while (h > env.H + 0.5 && guard++ < 120) {
    if (T.coverMin && p.cover > T.coverMin) p.cover = Math.max(T.coverMin, p.cover - 24);
    else if (p.fs > base * 0.72) p.fs = Math.max(base * 0.72, p.fs * 0.95);
    else if (p.groups.length > 1) { p.groups = dropGroup(p.groups, env.focus); dropped++; }
    else break;
    h = T.layout(ctx, env, p, false);
  }
  if (T.center && h < env.H) p.off = (env.H - h) / 2;
  return { p, h: env.H, dropped };
}

/**
 * Draw the card. Sets canvas.width/height. Returns design size, pixel size, the scale used,
 * hit boxes for lyric groups (design coordinates) and how many groups a fixed ratio had to drop.
 */
export function renderCard(canvas, state, assets, opts = {}) {
  const st = normalize(state);
  const name = TEMPLATES[st.template] ? st.template : 'compact';
  const T = TEMPLATES[name];
  const groups = groupsOf(st).map((g, idx) => ({ ...g, idx }));
  const focus = new Set((st.focus || []).filter((i) => Number.isInteger(i) && i >= 0 && i < groups.length));
  const H = RATIO_HEIGHT[st.ratio] || null;

  const env = {
    st, assets, cover: assets.cover, fp: preset(st), sch: schemeFor(st.seed || FALLBACK_SEED, st.variant || 'content'),
    sup: TEMPLATE_INFO[name].supports, groups, focus, hasFocus: focus.size > 0, H, k: 1, hits: [], canvasH: 0,
    purpose: opts.purpose || 'preview',
  };

  const measureCtx = canvas.getContext('2d');
  measureCtx.setTransform(1, 0, 0, 1, 0, 0);
  const { p, h, dropped } = solve(measureCtx, env, T);

  let k = Number(opts.scale) || 2;
  const maxArea = opts.maxArea || 16e6;
  if (W * k * h * k > maxArea) k = Math.sqrt(maxArea / (W * h));
  canvas.width = Math.max(1, Math.round(W * k));
  canvas.height = Math.max(1, Math.round(h * k));
  k = canvas.width / W;

  env.k = k;
  env.canvasH = h;
  env.hits = [];
  const ctx = canvas.getContext('2d');
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  T.layout(ctx, env, p, true);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  return { width: W, height: h, pixelWidth: canvas.width, pixelHeight: canvas.height, scale: k, hits: env.hits, dropped };
}

/** Web fonts the current state needs; the app passes each to document.fonts.load(). */
export function fontsToLoad(state) {
  const st = normalize(state);
  const fp = preset(st);
  const text = [st.title, st.artist, st.lyrics, st.extras.noteText, st.extras.source, '长按识别二维码收听歌词会出现在这里']
    .join('').slice(0, 6000);
  const weights = [...new Set([fp.w.regular, fp.w.medium, fp.w.bold])];
  const out = [];
  for (const [family, available] of fp.web) {
    for (const weight of weights) if (available.includes(weight)) out.push({ family, weight, text });
  }
  out.push({ family: 'Roboto Mono', weight: 400, text: `0123456789:./·°C ${st.extras.dateText || ''}${st.extras.cur || ''}${st.extras.dur || ''}` });
  return out;
}
