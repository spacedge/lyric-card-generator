/* 歌词卡片 · 界面控制器
 * 负责：状态、存储、响应式手机/桌面工作台调度、预览尺寸自适应、导出。
 * 绘图本身全部在 render/ 里，这个文件不画卡片。
 */
import { FONT_CSS_URL, APP_VERSION } from './config.js';
import * as store from './storage.js';
import { FALLBACK_SEED, makeScheme, extractSeeds } from './color.js';
import {
  TEMPLATE_INFO, TEMPLATE_ORDER, FONT_PRESETS, DESIGN_WIDTH,
  makeDefaultCover, prepareCover, renderCard, fontsToLoad, groupsOf,
} from './render/index.js';

/* ====================================================================
 * 常量
 * ==================================================================== */

const PARSE_MODES = ['bilingual', 'blocks', 'single'];
const VARIANTS = ['content', 'tonal', 'vibrant', 'mono'];
const RATIOS = ['auto', '4:5', '9:16', '1:1'];
const ALIGNS = ['left', 'center'];
const TABS = ['content', 'color', 'type', 'extra'];
const MOBILE_TABS = ['content', 'template', 'color', 'type', 'extra'];
const EXTRA_KEYS = ['date', 'note', 'progress', 'qr'];
const EXTRA_TEXT = {
  dateText: 40, noteText: 60, cur: 8, dur: 8, link: 500, source: 40,
};
const EXTRA_FIELDS = {
  date: [['fDate', 'dateText']],
  note: [['fNote', 'noteText']],
  progress: [['fCur', 'cur'], ['fDur', 'dur']],
  qr: [['fLink', 'link'], ['fSource', 'source']],
};
const RATIO_HW = { '4:5': 5 / 4, '9:16': 16 / 9, '1:1': 1 };

const DESKTOP_MIN = 861;
const PREVIEW_MAX = { desktop: 440, phoneFull: 480 };
const SAVE_DELAY = 400;
const THUMB_DELAY = 250;
const FONT_DELAY = 300;
const THUMB_SCALE = 0.45;
const MAX_FONT_BYTES = 80 * 1024 * 1024;
const MAX_COVER_EDGE = 3000;
const MAX_EXPORT_AREA = 16e6;

const THEME_TOKENS = [
  ['--primary', 'primary'], ['--on-primary', 'onPrimary'],
  ['--primary-container', 'primaryContainer'], ['--on-primary-container', 'onPrimaryContainer'],
  ['--secondary-container', 'secondaryContainer'], ['--on-secondary-container', 'onSecondaryContainer'],
  ['--surface', 'surface'], ['--surface-low', 'surfaceContainerLow'], ['--surface-mid', 'surfaceContainer'],
  ['--surface-high', 'surfaceContainerHigh'], ['--surface-highest', 'surfaceContainerHighest'],
  ['--on-surface', 'onSurface'], ['--on-surface-variant', 'onSurfaceVariant'],
  ['--outline', 'outline'], ['--outline-variant', 'outlineVariant'],
  ['--inverse-surface', 'inverseSurface'], ['--inverse-on-surface', 'inverseOnSurface'], ['--inverse-primary', 'inversePrimary'],
];

const MODE_HELP = {
  bilingual: '一行原文、一行译文交替排列；最后单出来的一行只当原文。',
  blocks: '空一行分成一段。一段里两行是原文加译文，行数更多时前一半原文、后一半译文。',
  single: '每一行都是一句，不带译文。',
};

const PLUS_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>';

/* ====================================================================
 * 小工具
 * ==================================================================== */

const $ = (id) => document.getElementById(id);
const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const isHex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function todayText() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

function normFocus(list) {
  const out = new Set();
  for (const v of list || []) {
    if (Number.isInteger(v) && v >= 0) out.add(v);
  }
  return [...out].sort((a, b) => a - b);
}

function safeFileName(title) {
  const cleaned = String(title || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 80)
    .trim();
  return `${cleaned || '歌词卡片'}.png`;
}

function fileLabel(name) {
  const base = String(name || '').replace(/\.[a-z0-9]+$/i, '').trim();
  return base.slice(0, 40) || '导入的字体';
}

function isImageFile(file) {
  if (!file) return false;
  if (file.type) return file.type.startsWith('image/');
  return /\.(jpe?g|png|webp|gif|bmp|avif|svg|heic|heif)$/i.test(file.name || '');
}

/* ====================================================================
 * 状态
 * ==================================================================== */

function defaultState() {
  return {
    template: 'compact',
    title: '',
    artist: '',
    lyrics: '',
    parseMode: 'bilingual',
    focus: [],
    seed: FALLBACK_SEED,
    variant: 'content',
    dark: { compact: true, classic: false, immersive: true, quiet: false },
    font: 'sans',
    scale: 1,
    align: 'left',
    showTrans: true,
    ratio: TEMPLATE_INFO.compact.defaultRatio,
    scrim: 0.5,
    extras: {
      date: false, dateText: todayText(),
      note: false, noteText: '',
      progress: false, cur: '01:52', dur: '04:05',
      qr: false, link: '', source: '',
    },
  };
}

function defaultMeta() {
  return {
    tab: 'content',
    mobileTab: 'content',
    quality: 2,
    dateEdited: false,
    customFontName: '',
  };
}

const state = defaultState();
const assets = { cover: null, seeds: [FALLBACK_SEED], light: null, customFont: false };
const meta = defaultMeta();
const mobileUI = { fullPreview: false, contentExpanded: false };

const defaults = { source: null, cover: null, seeds: [FALLBACK_SEED], light: null };
let coverSource = null;

function replaceState(next) {
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, next);
}

/* ====================================================================
 * 元素缓存
 * ==================================================================== */

const els = {};

function cacheEls() {
  const ids = [
    'pane', 'stage', 'preview', 'statusSize', 'statusWarn', 'statusMsg',
    'miniPreviewBtn', 'miniThumb', 'miniTitle', 'miniSize',
    'zoomPreviewBtn', 'zoomPreviewLabel',
    'focusBar', 'focusHint', 'quickClearFocus',
    'editorPanel', 'ratioSeg', 'tiles', 'tabs', 'mobileNav',
    'coverThumb', 'coverBtn', 'coverInput',
    'fTitle', 'fArtist', 'fLyrics', 'pasteLyricsBtn', 'clearLyricsBtn',
    'modeSeg', 'modeHelp', 'focusDisclosure', 'focusBadge', 'pickList', 'pickClear',
    'swatches', 'variantSeg', 'darkSeg', 'darkHelp', 'scrimRow', 'fScrim', 'scrimOut',
    'fontChips', 'customChip', 'fontBtn', 'fontInput', 'fontHelp',
    'fScale', 'scaleOut', 'scaleReset', 'alignSeg', 'swTrans',
    'resetBtn', 'exportBtn',
    'exportDlg', 'exportClose', 'exportImg', 'exportInfo', 'qualitySeg', 'saveBtn', 'shareBtn', 'copyBtn',
    'snack', 'dynTheme',
  ];
  for (const id of ids) els[id] = $(id);
  els.panelTemplate = $('panel-template');
  els.themeColor = document.querySelector('meta[name="theme-color"]');
  els.dialog = els.exportDlg.querySelector('.dialog');
  els.exportStage = els.exportDlg.querySelector('.export-stage');
  els.exportActions = els.exportDlg.querySelector('.export-actions');
  els.exportGrid = els.exportActions.querySelector('.grid2');
  els.extraBlocks = qsa('.extra[data-x]');
  els.tileBtns = qsa('.tile', els.tiles);
  els.tabBtns = qsa('[role="tab"]', els.tabs);
  els.mobileTabBtns = qsa('[role="tab"]', els.mobileNav);
  els.background = [document.querySelector('.appbar'), document.querySelector('main.layout'), els.mobileNav];
}

/* ====================================================================
 * 提示
 * ==================================================================== */

let snackTimer = 0;
function toast(message, long = false) {
  const el = els.snack;
  clearTimeout(snackTimer);
  el.textContent = message;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  snackTimer = setTimeout(() => el.classList.remove('show'), long ? 6000 : 2600);
}

let flashTimer = 0;
function flash(message, ms = 3200) {
  clearTimeout(flashTimer);
  els.statusMsg.textContent = message;
  flashTimer = setTimeout(() => { els.statusMsg.textContent = ''; }, ms);
}

/* ====================================================================
 * 存储
 * ==================================================================== */

let saveTimer = 0;
let warnedStorage = false;

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, SAVE_DELAY);
}

function flushSave() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  const ok = store.saveSettings({
    v: 1,
    app: APP_VERSION,
    state,
    meta: {
      tab: meta.tab,
      mobileTab: meta.mobileTab,
      quality: meta.quality,
      dateEdited: meta.dateEdited,
    },
  });
  if (!ok && !warnedStorage) {
    warnedStorage = true;
    toast('这个浏览器不让保存设置，关掉页面后内容不会保留。', true);
  }
}

function applySaved(saved) {
  const result = { seed: false };
  if (!isPlain(saved) || saved.v !== 1) return result;

  const s = saved.state;
  if (isPlain(s)) {
    if (TEMPLATE_ORDER.includes(s.template)) state.template = s.template;
    if (typeof s.title === 'string') state.title = s.title.slice(0, 200);
    if (typeof s.artist === 'string') state.artist = s.artist.slice(0, 200);
    if (typeof s.lyrics === 'string') state.lyrics = s.lyrics.slice(0, 40000);
    if (PARSE_MODES.includes(s.parseMode)) state.parseMode = s.parseMode;
    if (Array.isArray(s.focus)) state.focus = normFocus(s.focus);
    if (isHex(s.seed)) { state.seed = s.seed.toUpperCase(); result.seed = true; }
    if (VARIANTS.includes(s.variant)) state.variant = s.variant;
    if (isPlain(s.dark)) {
      for (const t of TEMPLATE_ORDER) if (typeof s.dark[t] === 'boolean') state.dark[t] = s.dark[t];
    }
    if (typeof s.font === 'string' && has(FONT_PRESETS, s.font)) state.font = s.font;
    if (typeof s.scale === 'number' && Number.isFinite(s.scale)) state.scale = clamp(s.scale, 0.8, 1.3);
    if (ALIGNS.includes(s.align)) state.align = s.align;
    if (typeof s.showTrans === 'boolean') state.showTrans = s.showTrans;
    if (RATIOS.includes(s.ratio)) state.ratio = s.ratio;
    if (typeof s.scrim === 'number' && Number.isFinite(s.scrim)) state.scrim = clamp(s.scrim, 0.25, 0.85);
    if (isPlain(s.extras)) {
      for (const k of EXTRA_KEYS) if (typeof s.extras[k] === 'boolean') state.extras[k] = s.extras[k];
      for (const [k, max] of Object.entries(EXTRA_TEXT)) {
        if (typeof s.extras[k] === 'string') state.extras[k] = s.extras[k].slice(0, max);
      }
    }
  }

  const m = saved.meta;
  if (isPlain(m)) {
    if (TABS.includes(m.tab)) meta.tab = m.tab;
    if (MOBILE_TABS.includes(m.mobileTab)) meta.mobileTab = m.mobileTab;
    if (m.quality === 2 || m.quality === 4) meta.quality = m.quality;
    if (typeof m.dateEdited === 'boolean') meta.dateEdited = m.dateEdited;
  }
  if (!meta.dateEdited) state.extras.dateText = todayText();
  return result;
}

/* ====================================================================
 * 页面动态配色
 * ==================================================================== */

let themeSeed = '';
let themeColors = null;
const darkMQ = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function roleCss(roles, dark) {
  let css = '';
  for (const [prop, key] of THEME_TOKENS) {
    if (roles && roles[key]) css += `${prop}: ${roles[key]}; `;
  }
  css += dark
    ? '--shadow: rgba(0, 0, 0, 0.5); --error: #FFB4AB; color-scheme: dark;'
    : '--shadow: rgba(18, 22, 40, 0.18); --error: #BA1A1A; color-scheme: light;';
  return css;
}

function updateThemeColorMeta() {
  if (!els.themeColor || !themeColors) return;
  const root = document.documentElement.getAttribute('data-theme');
  const dark = root === 'dark' || (root !== 'light' && darkMQ && darkMQ.matches);
  els.themeColor.setAttribute('content', dark ? themeColors.dark : themeColors.light);
}

function applyTheme() {
  const seed = isHex(state.seed) ? state.seed : FALLBACK_SEED;
  if (seed === themeSeed) return;
  let scheme;
  try {
    scheme = makeScheme(seed, 'tonal');
  } catch (err) {
    console.warn('[歌词卡片] 页面配色失败', err);
    return;
  }
  themeSeed = seed;
  const light = roleCss(scheme.light, false);
  const dark = roleCss(scheme.dark, true);
  els.dynTheme.textContent =
    `:root { ${light} }\n` +
    `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${dark} } }\n` +
    `:root[data-theme="dark"] { ${dark} }`;
  themeColors = { light: scheme.light.surface, dark: scheme.dark.surface };
  updateThemeColorMeta();
}

/* ====================================================================
 * 封面处理
 * ==================================================================== */

let coverToken = 0;

function sourceSize(src) {
  return {
    w: src.naturalWidth || src.videoWidth || src.width || 0,
    h: src.naturalHeight || src.videoHeight || src.height || 0,
  };
}

function normalizeSource(src) {
  const { w, h } = sourceSize(src);
  if (!w || !h) throw new Error('empty image');
  const isImg = typeof HTMLImageElement !== 'undefined' && src instanceof HTMLImageElement;
  const big = Math.max(w, h) > MAX_COVER_EDGE;
  if (!isImg && !big) return src;
  const k = big ? MAX_COVER_EDGE / Math.max(w, h) : 1;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  if (typeof src.close === 'function') src.close();
  return c;
}

function decodeViaImg(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try { resolve(normalizeSource(img)); }
      catch (err) { reject(err); }
      finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('img decode failed')); };
    img.src = url;
  });
}

async function decodeImage(blob) {
  if (typeof createImageBitmap === 'function') {
    try { return normalizeSource(await createImageBitmap(blob, { imageOrientation: 'from-image' })); } catch { /* fallback */ }
    try { return normalizeSource(await createImageBitmap(blob)); } catch { /* fallback */ }
  }
  return decodeViaImg(blob);
}

function drawCoverThumb(source) {
  const c = els.coverThumb;
  const ctx = c.getContext('2d');
  if (!ctx || !source) return;
  const { w, h } = sourceSize(source);
  if (!w || !h) return;
  const s = Math.min(w, h);
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = 'high';
  try {
    ctx.drawImage(source, (w - s) / 2, (h - s) / 2, s, s, 0, 0, c.width, c.height);
  } catch (err) {
    console.warn('[歌词卡片] 封面缩略图失败', err);
  }
}

async function loadCoverBlob(blob, opts = {}) {
  const { user = true, persist = true, keepSeed = false } = opts;
  if (!blob || (blob.type && !blob.type.startsWith('image/'))) {
    if (user) toast('这不是图片文件，请选 JPG、PNG 或 WebP 图片。', true);
    return false;
  }
  const token = ++coverToken;
  let src;
  try {
    src = await decodeImage(blob);
  } catch (err) {
    console.warn('[歌词卡片] 封面解码失败', err);
    if (user) toast('这张图片打不开，请换成 JPG 或 PNG 再试。', true);
    return false;
  }
  if (token !== coverToken) return false;

  let prepared;
  let found;
  try {
    prepared = prepareCover(src);
    found = extractSeeds(src);
  } catch (err) {
    console.error('[歌词卡片] 封面处理失败', err);
    if (user) toast('封面处理失败，请换一张小一点的图片。', true);
    return false;
  }

  assets.cover = prepared;
  assets.seeds = found && Array.isArray(found.seeds) && found.seeds.length ? found.seeds : [FALLBACK_SEED];
  assets.light = (found && found.light) || null;
  coverSource = src;
  if (!keepSeed) state.seed = assets.seeds[0];

  drawCoverThumb(src);
  buildSwatches();
  applyTheme();
  touch();
  if (user) flash('已换封面，配色已重新提取');
  if (persist) store.saveCover(blob);
  return true;
}

/* ====================================================================
 * 字体
 * ==================================================================== */

let userFace = null;
let fontTimer = 0;

function injectFontCss() {
  if (!FONT_CSS_URL) return;
  let url;
  try { url = new URL(FONT_CSS_URL, location.href); } catch { return; }
  if (url.hostname === 'fonts.googleapis.com') {
    for (const [href, cors] of [['https://fonts.googleapis.com', false], ['https://fonts.gstatic.com', true]]) {
      const pre = document.createElement('link');
      pre.rel = 'preconnect';
      pre.href = href;
      if (cors) pre.crossOrigin = '';
      document.head.appendChild(pre);
    }
  }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.media = 'print';
  link.href = url.href;
  link.addEventListener('load', () => {
    link.media = 'all';
    ensureFonts().then(() => { requestRender(); scheduleThumbs(); });
  });
  link.addEventListener('error', () => {
    flash('未连接字体服务，先用系统自带字体', 5000);
  });
  document.head.appendChild(link);
}

function ensureFonts(timeoutMs = 0) {
  if (!document.fonts || typeof document.fonts.load !== 'function') return Promise.resolve();
  let list = [];
  try { list = fontsToLoad(state) || []; } catch { list = []; }
  const jobs = list.map((f) => Promise.resolve().then(() => document.fonts.load(`${f.weight} 32px "${f.family}"`, f.text)));
  const all = Promise.allSettled(jobs);
  return timeoutMs ? Promise.race([all, delay(timeoutMs)]) : all;
}

function scheduleFonts() {
  clearTimeout(fontTimer);
  fontTimer = setTimeout(() => {
    ensureFonts().then(() => { requestRender(); scheduleThumbs(); });
  }, FONT_DELAY);
}

async function registerFont(buffer) {
  try {
    const face = new FontFace('LCUserFont', buffer.slice(0));
    await face.load();
    if (userFace) { try { document.fonts.delete(userFace); } catch { /* ignore */ } }
    document.fonts.add(face);
    userFace = face;
    return true;
  } catch (err) {
    console.warn('[歌词卡片] 字体注册失败', err);
    return false;
  }
}

async function importFont(file) {
  if (!file) return;
  if (file.size > MAX_FONT_BYTES) {
    toast('字体文件超过 80 MB，请换一个精简版本。', true);
    return;
  }
  let buffer;
  try { buffer = await file.arrayBuffer(); }
  catch { toast('读不了这个文件，请重新选一次。', true); return; }
  if (!(await registerFont(buffer))) {
    toast('字体文件打不开，请换 .ttf、.otf、.woff 或 .woff2 文件。', true);
    return;
  }
  meta.customFontName = fileLabel(file.name);
  assets.customFont = true;
  state.font = 'custom';
  syncFontChips();
  touch({ fonts: true });
  flash(`已导入字体：${meta.customFontName}`);
  store.saveFont({ name: meta.customFontName, buffer });
}

function removeUserFont() {
  if (userFace) { try { document.fonts.delete(userFace); } catch { /* ignore */ } }
  userFace = null;
  assets.customFont = false;
  meta.customFontName = '';
}

/* ====================================================================
 * 二维码库按需加载
 * ==================================================================== */

let qrLoadPromise = null;

function ensureQrLib() {
  if (typeof globalThis.qrcode === 'function') return Promise.resolve(true);
  if (qrLoadPromise) return qrLoadPromise;
  const src = new URL('../vendor/qrcode.js', import.meta.url).href;
  qrLoadPromise = new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => {
      const ok = typeof globalThis.qrcode === 'function';
      if (!ok) qrLoadPromise = null;
      resolve(ok);
    };
    s.onerror = () => {
      s.remove();
      qrLoadPromise = null;
      resolve(false);
    };
    document.head.appendChild(s);
  });
  return qrLoadPromise;
}

function loadQrAndRender({ warnOffline = false } = {}) {
  if (typeof globalThis.qrcode === 'function') return;
  ensureQrLib().then((ok) => {
    if (ok) {
      requestRender();
      scheduleThumbs();
    } else if (warnOffline && state.extras.qr && state.extras.link.trim()) {
      flash('当前离线，暂无法加载二维码模块', 4000);
    }
  });
}

/* ====================================================================
 * 预览渲染与移动端自适应尺寸
 * ==================================================================== */

const desktopMQ = window.matchMedia(`(min-width: ${DESKTOP_MIN}px)`);
let rafId = 0;
let lastRes = null;
let lastCssW = 0;
let lastDpr = 0;
let renderFailed = false;

function requestRender() {
  if (rafId) return;
  rafId = requestAnimationFrame(() => { rafId = 0; renderPreview(); });
}

function desktopStageMaxHeight() {
  const pane = els.pane;
  const cs = getComputedStyle(pane);
  let max = parseFloat(cs.maxHeight);
  if (!Number.isFinite(max)) max = window.innerHeight - 104;
  const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  const gap = parseFloat(cs.rowGap) || 16;
  let others = 0;
  let count = 0;
  for (const child of pane.children) {
    if (child === els.stage || child.hidden || getComputedStyle(child).display === 'none') continue;
    others += child.offsetHeight;
    count += 1;
  }
  return max - pad - others - gap * count;
}

function previewWidth(aspectHint) {
  const desktop = desktopMQ.matches;
  const stageW = Math.max(180, els.stage.clientWidth || (desktop ? 440 : window.innerWidth - 28));

  if (desktop) {
    let w = Math.min(stageW, PREVIEW_MAX.desktop);
    const hw = RATIO_HW[state.ratio];
    if (hw) {
      const maxH = desktopStageMaxHeight();
      if (maxH > 0) w = Math.min(w, Math.max(200, maxH / hw));
    }
    return Math.max(160, Math.floor(w));
  }

  // Phone full-screen preview: comfortable full width
  if (mobileUI.fullPreview) {
    return Math.max(200, Math.floor(Math.min(stageW, PREVIEW_MAX.phoneFull)));
  }

  // Phone compact mini-preview (hidden main canvas): lightweight render width
  if (document.body.classList.contains('mobile-compact-preview')) {
    return 240;
  }

  // Phone split view: fit cleanly inside upper stage height so whole card is visible without scrolling,
  // while keeping a legible floor for very tall auto-length lyrics.
  const stageH = Math.max(160, (els.stage.clientHeight || Math.round(window.innerHeight * 0.34)) - 8);
  const hw = RATIO_HW[state.ratio] || aspectHint || (lastRes ? lastRes.height / lastRes.width : 1.5);
  const fitByHeight = stageH / hw;
  const floorW = Math.min(stageW, 180);
  const w = Math.min(stageW, Math.max(floorW, fitByHeight));
  return Math.max(140, Math.floor(w));
}

function safeGroups() {
  try { return groupsOf(state) || []; } catch { return []; }
}

function pruneFocus(count) {
  const kept = state.focus.filter((i) => i < count);
  if (kept.length !== state.focus.length) {
    state.focus = kept;
    scheduleSave();
  }
}

function drawMiniThumb() {
  const target = els.miniThumb;
  const src = els.preview;
  if (!target || !src || !src.width || !src.height) return;
  const ctx = target.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.imageSmoothingQuality = 'high';
  // Fill thumbnail backdrop with card's own edge colour so short empty cards never show a grey band
  ctx.drawImage(src, 0, 0, 1, 1, 0, 0, target.width, target.height);
  const h = (src.height * target.width) / src.width;
  ctx.drawImage(src, 0, 0, target.width, h);
}

function updateStatusSize() {
  if (!lastRes) return;
  const h = lastRes.height;
  let k = meta.quality;
  if (DESIGN_WIDTH * k * h * k > MAX_EXPORT_AREA) k = Math.sqrt(MAX_EXPORT_AREA / (DESIGN_WIDTH * h));
  const pw = Math.max(1, Math.round(DESIGN_WIDTH * k));
  const ph = Math.max(1, Math.round(h * k));
  const sizeStr = `${pw} × ${ph} px`;
  els.statusSize.textContent = `导出 ${sizeStr}`;
  const dropped = Number(lastRes.dropped) || 0;
  els.statusWarn.textContent = dropped > 0
    ? `有 ${dropped} 句放不下，可改选“长图”`
    : '';

  // Sync mobile mini-preview summary
  const tLabel = TEMPLATE_INFO[state.template]?.label || '紧凑';
  const titleText = (state.title || '').trim();
  els.miniTitle.textContent = titleText ? `${tLabel} · ${titleText}` : `${tLabel}模板`;
  els.miniSize.textContent = dropped > 0 ? `${sizeStr} · ${dropped} 句溢出` : sizeStr;
}

function renderPreview() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
  const groups = safeGroups();
  pruneFocus(groups.length);
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  let cssW = previewWidth();

  try {
    let res = renderCard(els.preview, state, assets, {
      scale: (cssW * dpr) / DESIGN_WIDTH,
      purpose: 'preview',
    });

    // On phone split view with auto-height, refine cssW once if actual aspect changed significantly
    if (!desktopMQ.matches && !mobileUI.fullPreview && !document.body.classList.contains('mobile-compact-preview')) {
      const refinedW = previewWidth(res.height / res.width);
      if (Math.abs(refinedW - cssW) > 6) {
        cssW = refinedW;
        res = renderCard(els.preview, state, assets, {
          scale: (cssW * dpr) / DESIGN_WIDTH,
          purpose: 'preview',
        });
      }
    }

    const k = cssW / res.width;
    els.preview.style.width = `${cssW}px`;
    els.preview.style.height = `${res.height * k}px`;
    lastRes = res;
    lastCssW = cssW;
    lastDpr = dpr;
    renderFailed = false;
    drawMiniThumb();
    updateStatusSize();
  } catch (err) {
    console.error('[歌词卡片] 预览渲染失败', err);
    if (!renderFailed) {
      renderFailed = true;
      toast('预览画不出来，请换一张封面或刷新重试。', true);
    }
  }
  refreshPicker(groups);
}

function onResize() {
  syncNavigation({ scrollPanel: false });
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  if (previewWidth() !== lastCssW || dpr !== lastDpr) requestRender();
}

function hitAt(ev) {
  if (!lastRes || !Array.isArray(lastRes.hits)) return null;
  const rect = els.preview.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const x = ((ev.clientX - rect.left) * lastRes.width) / rect.width;
  const y = ((ev.clientY - rect.top) * lastRes.height) / rect.height;
  let best = null;
  for (const h of lastRes.hits) {
    if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) {
      if (!best || h.w * h.h < best.w * best.h) best = h;
    }
  }
  return best;
}

function toggleFocus(index) {
  const set = new Set(state.focus);
  if (set.has(index)) set.delete(index); else set.add(index);
  state.focus = normFocus([...set]);
  syncPickerState();
  touch();
}

/* ====================================================================
 * 模板缩略图
 * ==================================================================== */

let thumbTimer = 0;
let thumbToken = 0;
let thumbCanvas = null;

function scheduleThumbs() {
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(renderThumbs, THUMB_DELAY);
}

async function renderThumbs() {
  const token = ++thumbToken;
  if (!thumbCanvas) thumbCanvas = document.createElement('canvas');
  for (const t of TEMPLATE_ORDER) {
    if (token !== thumbToken) return;
    const tile = els.tileBtns.find((b) => b.dataset.t === t);
    const target = tile && tile.querySelector('canvas');
    if (target) {
      try {
        const info = TEMPLATE_INFO[t];
        renderCard(thumbCanvas, { ...state, template: t, ratio: info.defaultRatio }, assets, {
          scale: THUMB_SCALE,
          purpose: 'thumb',
        });
        const ctx = target.getContext('2d');
        ctx.clearRect(0, 0, target.width, target.height);
        ctx.imageSmoothingQuality = 'high';
        const h = (thumbCanvas.height * target.width) / thumbCanvas.width;
        ctx.drawImage(thumbCanvas, 0, 0, target.width, h);
      } catch (err) {
        console.warn('[歌词卡片] 模板缩略图失败', t, err);
      }
    }
    await delay(0);
  }
}

/* ====================================================================
 * 界面与导航同步（桌面双栏 + 手机固定舞台与底部导航）
 * ==================================================================== */

function touch(o = {}) {
  requestRender();
  scheduleSave();
  if (o.thumbs !== false) scheduleThumbs();
  if (o.fonts) scheduleFonts();
}

function setPressed(container, value) {
  for (const b of qsa('button[data-v]', container)) {
    b.setAttribute('aria-pressed', String(b.dataset.v === String(value)));
  }
}

function onSeg(container, fn) {
  container.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (b && !b.disabled && container.contains(b)) fn(b.dataset.v);
  });
}

function setSwitch(btn, on) {
  btn.setAttribute('aria-checked', String(!!on));
}

function setValue(input, value) {
  if (input.value !== value) input.value = value;
}

function syncLyricsActions() {
  els.clearLyricsBtn.disabled = !state.lyrics.trim();
}

function syncRatio() {
  setPressed(els.ratioSeg, state.ratio);
}

function syncDark() {
  const sup = TEMPLATE_INFO[state.template].supports;
  const buttons = qsa('button[data-v]', els.darkSeg);
  for (const b of buttons) b.disabled = !sup.dark;
  if (sup.dark) setPressed(els.darkSeg, state.dark[state.template] ? 'dark' : 'light');
  else for (const b of buttons) b.setAttribute('aria-pressed', 'false');
  els.darkHelp.hidden = !!sup.dark;
}

function syncTemplateUI() {
  const t = state.template;
  const sup = TEMPLATE_INFO[t].supports;
  for (const b of els.tileBtns) b.setAttribute('aria-pressed', String(b.dataset.t === t));
  syncRatio();
  syncDark();
  els.scrimRow.hidden = !sup.scrim;
  for (const block of els.extraBlocks) {
    block.hidden = sup[block.dataset.x] === false;
  }
}

function syncExtras() {
  for (const block of els.extraBlocks) {
    const key = block.dataset.x;
    const on = !!state.extras[key];
    block.classList.toggle('on', on);
    setSwitch(block.querySelector('.switch'), on);
  }
  for (const fields of Object.values(EXTRA_FIELDS)) {
    for (const [id, key] of fields) setValue($(id), state.extras[key]);
  }
}

function syncFontChips() {
  for (const chip of qsa('.chip[data-v]', els.fontChips)) {
    chip.setAttribute('aria-pressed', String(chip.dataset.v === state.font));
  }
  els.customChip.hidden = !assets.customFont;
  if (assets.customFont) {
    const name = meta.customFontName || '导入的字体';
    els.customChip.querySelector('.chip-label').textContent = name;
    els.customChip.title = name;
  }
}

function syncScaleUI() {
  const pct = Math.round(state.scale * 100);
  els.fScale.value = String(pct);
  els.scaleOut.textContent = `${pct}%`;
  els.scaleReset.classList.toggle('can-reset', pct !== 100);
}

function syncModeHelp() {
  els.modeHelp.textContent = MODE_HELP[state.parseMode] || '';
}

function syncNavigation({ scrollPanel = false } = {}) {
  const desktop = desktopMQ.matches;

  if (desktop) {
    document.body.classList.remove('mobile-compact-preview', 'mobile-full-preview');
    els.panelTemplate.hidden = false;
    for (const b of els.tabBtns) {
      const on = b.dataset.tab === meta.tab;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      $(`panel-${b.dataset.tab}`).hidden = !on;
    }
    return;
  }

  // Phone layout: bottom nav drives which single panel is active
  const cur = MOBILE_TABS.includes(meta.mobileTab) ? meta.mobileTab : 'content';
  meta.mobileTab = cur;
  els.panelTemplate.hidden = cur !== 'template';
  for (const name of TABS) {
    $(`panel-${name}`).hidden = cur !== name;
  }
  for (const b of els.mobileTabBtns) {
    const on = b.dataset.mtab === cur;
    b.setAttribute('aria-selected', String(on));
  }

  const compact = cur === 'content' && !mobileUI.contentExpanded && !mobileUI.fullPreview;
  document.body.classList.toggle('mobile-full-preview', mobileUI.fullPreview);
  document.body.classList.toggle('mobile-compact-preview', compact);

  els.zoomPreviewBtn.setAttribute('aria-pressed', String(mobileUI.fullPreview));
  els.zoomPreviewBtn.setAttribute('aria-label', mobileUI.fullPreview ? '退出全屏预览' : '展开全屏预览');
  els.zoomPreviewLabel.textContent = mobileUI.fullPreview ? '收起' : '放大';

  if (scrollPanel && els.editorPanel) els.editorPanel.scrollTop = 0;
}

function selectDesktopTab(name, { save = true } = {}) {
  if (!TABS.includes(name)) name = 'content';
  meta.tab = name;
  meta.mobileTab = name;
  syncNavigation();
  if (save) scheduleSave();
}

function selectMobileTab(name, { save = true } = {}) {
  if (!MOBILE_TABS.includes(name)) name = 'content';
  meta.mobileTab = name;
  if (TABS.includes(name)) meta.tab = name;
  mobileUI.fullPreview = false;
  if (name === 'content') mobileUI.contentExpanded = false;
  syncNavigation({ scrollPanel: true });
  requestRender();
  if (save) scheduleSave();
}

function onTabKey(e) {
  const i = TABS.indexOf(meta.tab);
  let n;
  if (e.key === 'ArrowRight') n = (i + 1) % TABS.length;
  else if (e.key === 'ArrowLeft') n = (i - 1 + TABS.length) % TABS.length;
  else if (e.key === 'Home') n = 0;
  else if (e.key === 'End') n = TABS.length - 1;
  else return;
  e.preventDefault();
  selectDesktopTab(TABS[n]);
  $(`tab-${TABS[n]}`).focus();
}

function syncAll() {
  setValue(els.fTitle, state.title);
  setValue(els.fArtist, state.artist);
  setValue(els.fLyrics, state.lyrics);
  syncLyricsActions();
  setPressed(els.modeSeg, state.parseMode);
  syncModeHelp();
  setPressed(els.variantSeg, state.variant);
  setPressed(els.alignSeg, state.align);
  setPressed(els.qualitySeg, meta.quality);
  setSwitch(els.swTrans, state.showTrans);
  syncScaleUI();
  els.fScrim.value = String(Math.round(state.scrim * 100));
  els.scrimOut.textContent = `${Math.round(state.scrim * 100)}%`;
  syncFontChips();
  syncExtras();
  syncTemplateUI();
  syncSwatches();
  syncNavigation();
  syncPickerState();
}

/* ---------- 重点句列表与快捷条 ---------- */

let pickerKey = null;

function refreshPicker(groups) {
  const key = groups.map((g) => g.o).join('\u0001');
  if (key !== pickerKey) {
    pickerKey = key;
    els.pickList.textContent = '';
    if (!groups.length) {
      const p = document.createElement('p');
      p.className = 'helper';
      p.textContent = '填入歌词后，可以在这里选重点句。';
      els.pickList.appendChild(p);
    } else {
      const frag = document.createDocumentFragment();
      groups.forEach((g, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'pick';
        b.dataset.i = String(i);
        b.title = g.t ? `${g.o}\n${g.t}` : g.o;
        const text = document.createElement('span');
        text.className = 'pick-text';
        text.textContent = String(g.o).replace(/\s*\n\s*/g, ' ');
        const tag = document.createElement('span');
        tag.className = 'pick-tag';
        tag.setAttribute('aria-hidden', 'true');
        b.append(text, tag);
        frag.appendChild(b);
      });
      els.pickList.appendChild(frag);
    }
  }
  syncPickerState();
}

function syncPickerState() {
  const set = new Set(state.focus);
  for (const b of qsa('.pick', els.pickList)) {
    const on = set.has(Number(b.dataset.i));
    b.setAttribute('aria-pressed', String(on));
    b.lastElementChild.textContent = on ? '重点' : '普通';
  }
  const n = state.focus.length;
  els.pickClear.disabled = n === 0;
  els.focusBadge.textContent = n ? `已选 ${n} 句` : '未选';
  els.focusBadge.classList.toggle('has-focus', n > 0);
  els.focusHint.textContent = n ? `已选 ${n} 句重点` : '点击图上句子可设为重点';
  els.quickClearFocus.hidden = n === 0;
}

/* ---------- 色板 ---------- */

const customSwatch = { el: null, input: null, face: null };

function makeCustomSwatch() {
  const el = document.createElement('div');
  el.className = 'swatch swatch-custom';
  el.title = '自选颜色';
  const face = document.createElement('span');
  face.innerHTML = PLUS_SVG;
  const input = document.createElement('input');
  input.type = 'color';
  input.value = '#5daee6';
  input.setAttribute('aria-label', '自选颜色');
  input.addEventListener('input', () => {
    state.seed = input.value.toUpperCase();
    onSeedChanged();
  });
  el.append(face, input);
  Object.assign(customSwatch, { el, input, face });
}

function buildSwatches() {
  els.swatches.textContent = '';
  assets.seeds.forEach((seed, i) => {
    const hex = seed.toUpperCase();
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.dataset.seed = hex;
    b.setAttribute('aria-label', `封面里的第 ${i + 1} 个颜色 ${hex}`);
    const face = document.createElement('span');
    let p80 = hex;
    let t80 = hex;
    try {
      const sc = makeScheme(hex, 'tonal');
      p80 = sc.p(80);
      t80 = sc.t(80);
    } catch { /* fallback */ }
    face.style.setProperty('--c1', hex);
    face.style.setProperty('--c2', p80);
    face.style.setProperty('--c3', t80);
    b.appendChild(face);
    els.swatches.appendChild(b);
  });
  els.swatches.appendChild(customSwatch.el);
  syncSwatches();
}

function syncSwatches() {
  if (!customSwatch.el) return;
  const cur = String(state.seed).toUpperCase();
  let matched = false;
  for (const b of qsa('.swatch[data-seed]', els.swatches)) {
    const on = b.dataset.seed === cur;
    matched = matched || on;
    b.setAttribute('aria-pressed', String(on));
  }
  customSwatch.el.classList.toggle('is-on', !matched);
  customSwatch.face.style.background = matched ? '' : cur;
  if (!matched && customSwatch.input.value.toUpperCase() !== cur) customSwatch.input.value = cur.toLowerCase();
}

function onSeedChanged() {
  syncSwatches();
  applyTheme();
  touch();
}

/* ====================================================================
 * 事件绑定
 * ==================================================================== */

function selectTemplate(t) {
  if (!TEMPLATE_INFO[t] || t === state.template) return;
  state.template = t;
  state.ratio = TEMPLATE_INFO[t].defaultRatio;
  syncTemplateUI();
  touch({ thumbs: false });
}

async function pasteLyricsFromClipboard() {
  if (!navigator.clipboard || typeof navigator.clipboard.readText !== 'function') {
    els.fLyrics.focus();
    toast('当前环境不支持一键读取，请长按歌词框粘贴。');
    return;
  }
  try {
    const text = await navigator.clipboard.readText();
    if (!text || !text.trim()) {
      toast('剪贴板里没有文字。');
      return;
    }
    state.lyrics = text.slice(0, 40000);
    state.focus = [];
    setValue(els.fLyrics, state.lyrics);
    syncLyricsActions();
    touch({ fonts: true });
    toast('已粘贴歌词');
  } catch {
    els.fLyrics.focus();
    toast('浏览器未授权读取剪贴板，请直接长按歌词框粘贴。');
  }
}

function bindEditor() {
  // 模板与比例
  els.tiles.addEventListener('click', (e) => {
    const b = e.target.closest('.tile');
    if (b) selectTemplate(b.dataset.t);
  });
  onSeg(els.ratioSeg, (v) => {
    if (!RATIOS.includes(v)) return;
    state.ratio = v;
    syncRatio();
    touch({ thumbs: false });
  });

  // 桌面标签 & 手机底部导航
  els.tabs.addEventListener('click', (e) => {
    const b = e.target.closest('[role="tab"]');
    if (b) selectDesktopTab(b.dataset.tab);
  });
  els.tabs.addEventListener('keydown', onTabKey);

  els.mobileNav.addEventListener('click', (e) => {
    const b = e.target.closest('[role="tab"]');
    if (b) selectMobileTab(b.dataset.mtab);
  });

  // 手机端：点击迷你预览条展开预览；点击放大/收起切换全屏预览
  els.miniPreviewBtn.addEventListener('click', () => {
    mobileUI.contentExpanded = true;
    syncNavigation();
    requestRender();
  });
  els.zoomPreviewBtn.addEventListener('click', () => {
    mobileUI.fullPreview = !mobileUI.fullPreview;
    syncNavigation();
    requestRender();
  });

  // 手机端聚焦内容输入框时自动折叠预览，避免软键盘挤占输入区
  for (const field of [els.fTitle, els.fArtist, els.fLyrics]) {
    field.addEventListener('focus', () => {
      if (!desktopMQ.matches && meta.mobileTab === 'content' && mobileUI.contentExpanded) {
        mobileUI.contentExpanded = false;
        syncNavigation();
      }
    });
  }

  // 内容编辑
  els.fTitle.addEventListener('input', () => {
    state.title = els.fTitle.value;
    touch({ fonts: true });
  });
  els.fArtist.addEventListener('input', () => {
    state.artist = els.fArtist.value;
    touch({ fonts: true });
  });
  els.fLyrics.addEventListener('input', () => {
    state.lyrics = els.fLyrics.value;
    syncLyricsActions();
    touch({ fonts: true });
  });
  els.pasteLyricsBtn.addEventListener('click', pasteLyricsFromClipboard);
  els.clearLyricsBtn.addEventListener('click', () => {
    state.lyrics = '';
    state.focus = [];
    setValue(els.fLyrics, '');
    syncLyricsActions();
    touch({ fonts: true });
    els.fLyrics.focus();
  });

  els.coverBtn.addEventListener('click', () => els.coverInput.click());
  els.coverInput.addEventListener('change', () => {
    const file = els.coverInput.files && els.coverInput.files[0];
    els.coverInput.value = '';
    if (file) loadCoverBlob(file);
  });

  onSeg(els.modeSeg, (v) => {
    if (!PARSE_MODES.includes(v) || v === state.parseMode) return;
    state.parseMode = v;
    state.focus = [];
    setPressed(els.modeSeg, v);
    syncModeHelp();
    touch();
  });

  // 重点句选择与清除（列表 + 预览条快捷清除 + 点击画布）
  const clearAllFocus = () => {
    state.focus = [];
    syncPickerState();
    touch();
  };
  els.pickList.addEventListener('click', (e) => {
    const b = e.target.closest('.pick');
    if (b) toggleFocus(Number(b.dataset.i));
  });
  els.pickClear.addEventListener('click', clearAllFocus);
  els.quickClearFocus.addEventListener('click', clearAllFocus);

  els.preview.addEventListener('click', (e) => {
    const h = hitAt(e);
    if (h) toggleFocus(h.index);
  });
  els.preview.addEventListener('pointermove', (e) => {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    els.preview.classList.toggle('can-pick', !!hitAt(e));
  });
  els.preview.addEventListener('pointerleave', () => els.preview.classList.remove('can-pick'));

  // 配色
  els.swatches.addEventListener('click', (e) => {
    const b = e.target.closest('.swatch[data-seed]');
    if (!b) return;
    state.seed = b.dataset.seed;
    onSeedChanged();
  });
  onSeg(els.variantSeg, (v) => {
    if (!VARIANTS.includes(v)) return;
    state.variant = v;
    setPressed(els.variantSeg, v);
    touch();
  });
  onSeg(els.darkSeg, (v) => {
    if (!TEMPLATE_INFO[state.template].supports.dark) return;
    state.dark[state.template] = v === 'dark';
    syncDark();
    touch();
  });
  els.fScrim.addEventListener('input', () => {
    const v = Number(els.fScrim.value);
    state.scrim = clamp(v / 100, 0.25, 0.85);
    els.scrimOut.textContent = `${v}%`;
    touch();
  });

  // 文字
  els.fontChips.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip[data-v]');
    if (!chip || chip.hidden) return;
    if (chip.dataset.v === 'custom' && !assets.customFont) return;
    state.font = chip.dataset.v;
    syncFontChips();
    touch({ fonts: true });
  });
  els.fontBtn.addEventListener('click', () => els.fontInput.click());
  els.fontInput.addEventListener('change', () => {
    const file = els.fontInput.files && els.fontInput.files[0];
    els.fontInput.value = '';
    importFont(file);
  });
  els.fScale.addEventListener('input', () => {
    state.scale = clamp(Number(els.fScale.value) / 100, 0.8, 1.3);
    syncScaleUI();
    touch();
  });
  els.scaleReset.addEventListener('click', () => {
    if (Math.round(state.scale * 100) === 100) return;
    state.scale = 1;
    syncScaleUI();
    touch();
    flash('字号已恢复 100%');
  });
  onSeg(els.alignSeg, (v) => {
    if (!ALIGNS.includes(v)) return;
    state.align = v;
    setPressed(els.alignSeg, v);
    touch();
  });
  els.swTrans.addEventListener('click', () => {
    state.showTrans = !state.showTrans;
    setSwitch(els.swTrans, state.showTrans);
    touch();
  });

  // 附加
  for (const block of els.extraBlocks) {
    const key = block.dataset.x;
    block.querySelector('.switch').addEventListener('click', () => {
      state.extras[key] = !state.extras[key];
      block.classList.toggle('on', state.extras[key]);
      setSwitch(block.querySelector('.switch'), state.extras[key]);
      if (key === 'qr' && state.extras.qr) loadQrAndRender({ warnOffline: true });
      touch();
    });
  }
  for (const fields of Object.values(EXTRA_FIELDS)) {
    for (const [id, key] of fields) {
      $(id).addEventListener('input', (e) => {
        state.extras[key] = e.target.value;
        if (key === 'dateText') meta.dateEdited = true;
        if (key === 'link' && state.extras.qr && e.target.value.trim()) loadQrAndRender({ warnOffline: true });
        touch();
      });
    }
  }
}

/* ---------- 拖放和粘贴封面 ---------- */

function hasFiles(e) {
  const types = e.dataTransfer && e.dataTransfer.types;
  return !!types && Array.from(types).includes('Files');
}

function bindCoverIntake() {
  let depth = 0;
  const clear = () => { depth = 0; document.body.classList.remove('dragging'); };

  document.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth += 1;
    if (!exp.open) document.body.classList.add('dragging');
  });
  document.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = exp.open ? 'none' : 'copy';
  });
  document.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) document.body.classList.remove('dragging');
  });
  document.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    clear();
    if (exp.open) return;
    const file = Array.from(e.dataTransfer.files || []).find(isImageFile);
    if (file) loadCoverBlob(file);
    else toast('拖进来的不是图片，请拖 JPG、PNG 或 WebP 文件。', true);
  });
  window.addEventListener('blur', clear);

  document.addEventListener('paste', (e) => {
    const data = e.clipboardData;
    if (!data || exp.open) return;
    let file = null;
    for (const f of Array.from(data.files || [])) {
      if (isImageFile(f)) { file = f; break; }
    }
    if (!file) {
      for (const item of Array.from(data.items || [])) {
        if (item.kind === 'file' && item.type.startsWith('image/')) { file = item.getAsFile(); break; }
      }
    }
    if (!file) return;
    const t = e.target;
    const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (inField && data.getData('text/plain')) return;
    e.preventDefault();
    loadCoverBlob(file);
  });
}

/* ====================================================================
 * 导出
 * ==================================================================== */

const exp = { open: false, opener: null, token: 0, blob: null, url: '', file: null, name: '' };

function canvasToBlob(canvas) {
  return new Promise((resolve) => {
    try { canvas.toBlob((b) => resolve(b), 'image/png'); } catch { resolve(null); }
  });
}

function revokeExport() {
  if (exp.url) URL.revokeObjectURL(exp.url);
  exp.url = '';
  exp.blob = null;
  exp.file = null;
}

function setInert(on) {
  for (const el of els.background) {
    if (!el) continue;
    el.inert = on;
    if (on) el.setAttribute('aria-hidden', 'true'); else el.removeAttribute('aria-hidden');
  }
}

function safeCanShare(file) {
  try {
    return typeof navigator.canShare === 'function' && typeof navigator.share === 'function' && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

function canCopyImage() {
  return typeof window.ClipboardItem === 'function' && !!navigator.clipboard && typeof navigator.clipboard.write === 'function';
}

function layoutActions(probeFile) {
  const canShare = safeCanShare(probeFile);
  const canCopy = canCopyImage();
  const touchOnly = window.matchMedia('(pointer: coarse) and (hover: none)').matches;
  const sharePrimary = canShare && touchOnly;
  els.shareBtn.hidden = !canShare;
  els.copyBtn.hidden = !canCopy;
  els.exportGrid.dataset.n = String((canShare ? 1 : 0) + (canCopy ? 1 : 0));

  els.saveBtn.className = (sharePrimary ? 'btn-tonal' : 'btn') + ' btn-lg';
  els.shareBtn.className = (sharePrimary ? 'btn' : 'btn-tonal') + ' btn-lg';
  if (sharePrimary) {
    els.exportActions.insertBefore(els.shareBtn, els.exportGrid);
    els.exportGrid.insertBefore(els.saveBtn, els.exportGrid.firstChild);
  } else {
    els.exportActions.insertBefore(els.saveBtn, els.exportGrid);
    els.exportGrid.insertBefore(els.shareBtn, els.exportGrid.firstChild);
  }
}

function setExportBusy(busy) {
  els.exportStage.setAttribute('aria-busy', String(busy));
  for (const b of [els.saveBtn, els.shareBtn, els.copyBtn]) b.disabled = busy || !exp.blob;
  if (busy) els.exportInfo.textContent = '正在生成…';
}

async function generateExport() {
  const token = ++exp.token;
  setExportBusy(true);
  try {
    await ensureFonts(3500);
    if (state.extras.qr && state.extras.link.trim() && TEMPLATE_INFO[state.template].supports.qr !== false) {
      await ensureQrLib();
    }
    await delay(30);
    if (token !== exp.token) return;
    const canvas = document.createElement('canvas');
    const res = renderCard(canvas, state, assets, { scale: meta.quality, purpose: 'export' });
    const blob = await canvasToBlob(canvas);
    canvas.width = canvas.height = 1;
    if (token !== exp.token) return;
    if (!blob) throw new Error('toBlob returned null');

    revokeExport();
    exp.blob = blob;
    exp.name = safeFileName(state.title);
    exp.url = URL.createObjectURL(blob);
    try { exp.file = new File([blob], exp.name, { type: 'image/png' }); } catch { exp.file = null; }
    els.exportImg.src = exp.url;
    els.exportInfo.textContent = `PNG · ${res.pixelWidth} × ${res.pixelHeight}`;
    setExportBusy(false);
  } catch (err) {
    console.error('[歌词卡片] 导出失败', err);
    if (token !== exp.token) return;
    revokeExport();
    els.exportImg.removeAttribute('src');
    els.exportInfo.textContent = '生成失败';
    setExportBusy(false);
    toast(
      meta.quality === 4
        ? '图片太大，生成失败，请改选“标准 1080 宽”重试。'
        : '图片生成失败，请关闭重试或换一张小一点的封面。',
      true,
    );
  }
}

function focusables() {
  return qsa('button, [href], input, select, textarea, [tabindex]', els.dialog)
    .filter((el) => !el.disabled && !el.hidden && el.tabIndex >= 0 && el.getClientRects().length > 0);
}

function onDialogKey(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeExport();
    return;
  }
  if (e.key !== 'Tab') return;
  const list = focusables();
  if (!list.length) { e.preventDefault(); els.dialog.focus(); return; }
  const first = list[0];
  const last = list[list.length - 1];
  const active = document.activeElement;
  const inside = els.dialog.contains(active);
  if (e.shiftKey && (active === first || !inside)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !inside)) {
    e.preventDefault();
    first.focus();
  }
}

function openExport(opener) {
  if (exp.open) return;
  exp.open = true;
  exp.opener = opener || document.activeElement;
  document.body.classList.remove('dragging');
  els.exportDlg.hidden = false;
  document.body.classList.add('modal-open');
  setInert(true);
  document.addEventListener('keydown', onDialogKey, true);
  setPressed(els.qualitySeg, meta.quality);
  let probe = null;
  try { probe = new File([''], 'a.png', { type: 'image/png' }); } catch { /* ignore */ }
  layoutActions(probe);
  els.exportImg.removeAttribute('src');
  els.exportInfo.textContent = '';
  els.exportClose.focus();
  generateExport();
}

function closeExport() {
  if (!exp.open) return;
  exp.open = false;
  exp.token += 1;
  document.removeEventListener('keydown', onDialogKey, true);
  els.exportDlg.hidden = true;
  document.body.classList.remove('modal-open');
  setInert(false);
  els.exportImg.removeAttribute('src');
  revokeExport();
  const opener = exp.opener;
  exp.opener = null;
  if (opener && opener.isConnected && opener.getClientRects().length > 0) opener.focus();
}

function saveExport() {
  if (!exp.blob || !exp.url) return;
  const a = document.createElement('a');
  a.href = exp.url;
  a.download = exp.name;
  a.rel = 'noopener';
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
  toast('已保存');
}

async function shareExport() {
  if (!exp.file) { toast('这台设备不能直接分享，请用“保存图片”。', true); return; }
  try {
    await navigator.share({ files: [exp.file], title: state.title || '歌词卡片' });
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    console.warn('[歌词卡片] 分享失败', err);
    toast('分享未成功，可先“保存图片”再从相册发送。', true);
  }
}

async function copyExport() {
  if (!exp.blob) return;
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': exp.blob })]);
    toast('已复制图片');
  } catch (err) {
    console.warn('[歌词卡片] 复制失败', err);
    toast('复制未成功，请改用“保存图片”。', true);
  }
}

function bindExport() {
  els.exportBtn.addEventListener('click', () => openExport(els.exportBtn));
  els.exportClose.addEventListener('click', closeExport);
  els.exportDlg.addEventListener('click', (e) => {
    if (e.target === els.exportDlg) closeExport();
  });
  onSeg(els.qualitySeg, (v) => {
    const q = Number(v);
    if (q !== 2 && q !== 4) return;
    meta.quality = q;
    setPressed(els.qualitySeg, q);
    updateStatusSize();
    scheduleSave();
    generateExport();
  });
  els.saveBtn.addEventListener('click', saveExport);
  els.shareBtn.addEventListener('click', shareExport);
  els.copyBtn.addEventListener('click', copyExport);
}

/* ====================================================================
 * 重新开始
 * ==================================================================== */

let resetArmed = false;
let resetTimer = 0;

function disarmReset() {
  clearTimeout(resetTimer);
  resetArmed = false;
  els.resetBtn.textContent = '重新开始';
  els.resetBtn.classList.remove('confirm');
}

function onResetClick() {
  if (!resetArmed) {
    resetArmed = true;
    els.resetBtn.textContent = '再点一次';
    els.resetBtn.classList.add('confirm');
    resetTimer = setTimeout(disarmReset, 3000);
    return;
  }
  disarmReset();
  resetAll();
}

async function resetAll() {
  coverToken += 1;
  clearTimeout(saveTimer);
  replaceState(defaultState());
  Object.assign(meta, defaultMeta());
  mobileUI.fullPreview = false;
  mobileUI.contentExpanded = false;
  removeUserFont();
  assets.cover = defaults.cover;
  assets.seeds = defaults.seeds.slice();
  assets.light = defaults.light;
  coverSource = defaults.source;
  state.seed = assets.seeds[0];
  pickerKey = null;
  themeSeed = '';

  syncAll();
  drawCoverThumb(coverSource);
  buildSwatches();
  applyTheme();
  touch({ fonts: true });
  toast('已清空全部内容');

  await store.clearAll();
  scheduleSave();
}

/* ====================================================================
 * 离线缓存
 * ==================================================================== */

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const host = location.hostname;
  const local = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  if (location.protocol !== 'https:' && !local) return;

  const params = new URLSearchParams(location.search);
  if (params.has('nosw')) {
    navigator.serviceWorker.getRegistrations()
      .then((list) => Promise.all(list.map((r) => r.unregister())))
      .then(() => (window.caches ? caches.keys() : []))
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('lyric-card')).map((k) => caches.delete(k))))
      .catch(() => {});
    return;
  }
  if (params.has('test')) return;

  const go = () => {
    const swUrl = new URL('../sw.js', import.meta.url);
    const scope = new URL('../', import.meta.url).href;
    navigator.serviceWorker.register(swUrl.href, { scope }).catch((err) => {
      console.warn('[歌词卡片] 离线缓存没有启用', err);
    });
  };
  if (document.readyState === 'complete') go();
  else window.addEventListener('load', go, { once: true });
}

/* ====================================================================
 * 启动
 * ==================================================================== */

async function restoreFiles(seedWasSaved) {
  const [coverBlob, fontRec] = await Promise.all([store.loadCover(), store.loadFont()]);
  if (fontRec && (await registerFont(fontRec.buffer))) {
    assets.customFont = true;
    meta.customFontName = fontRec.name || '导入的字体';
  } else if (fontRec) {
    store.clearFont();
  }
  if (!assets.customFont && state.font === 'custom') state.font = 'sans';
  if (coverBlob) {
    await loadCoverBlob(coverBlob, { user: false, persist: false, keepSeed: seedWasSaved });
  }
}

function bindGlobal() {
  els.resetBtn.addEventListener('click', onResetClick);

  if (typeof ResizeObserver === 'function') new ResizeObserver(onResize).observe(els.stage);
  window.addEventListener('resize', onResize);
  desktopMQ.addEventListener('change', () => { syncNavigation(); requestRender(); });
  if (darkMQ && darkMQ.addEventListener) darkMQ.addEventListener('change', updateThemeColorMeta);

  if (document.fonts && document.fonts.addEventListener) {
    document.fonts.addEventListener('loadingdone', () => { requestRender(); scheduleThumbs(); });
  }

  window.addEventListener('pagehide', flushSave);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });
}

async function boot() {
  cacheEls();
  makeCustomSwatch();
  document.querySelector('.appbar h1').title = `版本 ${APP_VERSION}`;

  bindEditor();
  bindCoverIntake();
  bindExport();
  bindGlobal();

  injectFontCss();
  registerServiceWorker();

  const saved = applySaved(store.loadSettings());
  if (state.extras.qr) loadQrAndRender();

  const source = makeDefaultCover();
  const found = extractSeeds(source);
  defaults.source = source;
  defaults.cover = prepareCover(source);
  defaults.seeds = found && found.seeds && found.seeds.length ? found.seeds : [FALLBACK_SEED];
  defaults.light = (found && found.light) || null;

  assets.cover = defaults.cover;
  assets.seeds = defaults.seeds.slice();
  assets.light = defaults.light;
  coverSource = source;
  if (!saved.seed) state.seed = assets.seeds[0];

  const restoring = restoreFiles(saved.seed).catch((err) => {
    console.warn('[歌词卡片] 恢复上次的封面或字体失败', err);
  });
  await Promise.race([restoring, delay(400)]);

  syncAll();
  drawCoverThumb(coverSource);
  buildSwatches();
  applyTheme();
  renderPreview();
  scheduleThumbs();
  scheduleFonts();

  await restoring;
  syncAll();
  buildSwatches();
  applyTheme();
  requestRender();
  scheduleThumbs();
  scheduleFonts();
  console.info(`[歌词卡片] v${APP_VERSION}`);
}

let readyResolve;
const ready = new Promise((resolve) => { readyResolve = resolve; });

boot().then(readyResolve, (err) => {
  console.error('[歌词卡片] 启动失败', err);
  try { toast('页面未正常启动，请刷新重试。', true); } catch { /* ignore */ }
  readyResolve();
});

if (new URLSearchParams(location.search).has('test')) {
  window.__lc = {
    state,
    assets,
    meta,
    ready,
    selectMobileTab,
    loadCoverBlob: (blob) => loadCoverBlob(blob, { user: true, persist: false }),
    rerender: () => renderPreview(),
  };
}
