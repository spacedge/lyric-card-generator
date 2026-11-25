// Lyrics 4U 取色与模板视觉检查（本地手动运行，不进 CI）。
// 只依赖 src/color.js 和 src/render/index.js 的公开接口（见 README.md 末尾的清单）。
// 接口缺了或模块还在改的时候，页面照样打开，并写明缺什么、哪一步出了错。

/* ------------------------------------------------------------------ */
/* 常量                                                                */
/* ------------------------------------------------------------------ */

const COLOR_API = ['analyzeCover', 'cardPalette', 'resolveDark', 'hexToOklch', 'contrast'];
const RENDER_API = ['renderCard', 'TEMPLATE_ORDER', 'TEMPLATE_INFO', 'prepareCover'];

const STYLES = [['content', '忠实'], ['tonal', '柔和'], ['vibrant', '鲜明'], ['mono', '单色']];
const MODES = [['auto', '自动'], ['light', '浅色'], ['dark', '深色']];
const ROLE_LABEL = { base: '主色', accent: '强调', vivid: '艳色', neutral: '无彩' };
const STYLE_LABEL = Object.fromEntries(STYLES);
const MODE_LABEL = Object.fromEntries(MODES);
const NO_STYLE = new Set(['immersive', 'depth']);   // 接口没写 supports.style 时的兜底

const SEP_MIN = 8;          // 门 1：背景色差下限（OKLab × 100）
const VIVID_SEED_C = 0.15;  // 门 1：种子色 C 不小于这个值，忠实与鲜明这一对豁免
const ACHROMATIC_C = 0.04;  // 门 1：种子色 C 小于这个值算无彩
const ON_MIN = 7;           // 门 2：正文（黑或白能达到 7 的背景上）
const ON_FLOOR = 4.5;       // 门 2：正文的绝对下限
const ON_SLACK = 0.05;      // 门 2：背景达不到 7 时，正文 ≥ 黑/白最高值 − 0.05
const ONVAR_MIN = 4.5;      // 门 2：次要文字
const ACCENT_MIN = 4.5;     // 门 2：强调色

const CARD_W = 540;         // 设计宽度
const SCALE = 0.3;          // 缩略图渲染比例
const SEARCH_GAP_MS = 1100; // iTunes 搜索的最小间隔（官方限额约每分钟 20 次）
const MAX_PAGE_H = 12000;   // 导出的单张 PNG 最高像素（再高的图很多看图软件打不开），超过就分页

const SAMPLE_LYRICS = [
  '誰もいないホームに 夏の光が落ちてた',
  '空无一人的站台上，落着夏天的光',
  '時計の針だけが 少し先を歩いてく',
  '只有时钟的指针，先一步走远了',
].join('\n');

const HEX = /^#[0-9a-f]{6}$/i;

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 后台标签页里 setTimeout / rAF 会被限速，MessageChannel 不会。
const yieldNow = () => new Promise((resolve) => {
  const ch = new MessageChannel();
  ch.port1.onmessage = () => { ch.port1.close(); resolve(); };
  ch.port2.postMessage(0);
});
const floorTo = (v, n = 1) => (Math.floor(v * 10 ** n + 1e-9) / 10 ** n).toFixed(n);   // 失败时不能被四舍五入成“刚好过线”
const ceilTo = (v, n = 1) => (Math.ceil(v * 10 ** n - 1e-9) / 10 ** n).toFixed(n);     // 要求值向上取整，同理
const errText = (e) => (e && e.message) ? e.message : String(e);
const key = (tpl, mode, style) => `${tpl}|${mode}|${style}`;

async function loadModule(url) {
  try { return { mod: await import(url), error: null }; } catch (e) { return { mod: {}, error: e }; }
}

/* ------------------------------------------------------------------ */
/* 读取 src 模块（缺什么记什么，不让整页挂掉）                          */
/* ------------------------------------------------------------------ */

const colorLoad = await loadModule('../../src/color.js');
const renderLoad = await loadModule('../../src/render/index.js');
const color = colorLoad.mod;
const render = renderLoad.mod;

const api = {
  colorError: colorLoad.error && errText(colorLoad.error),
  renderError: renderLoad.error && errText(renderLoad.error),
  colorMissing: COLOR_API.filter((k) => !(k in color)),
  renderMissing: RENDER_API.filter((k) => !(k in render)),
};
api.canAnalyze = typeof color.analyzeCover === 'function';
api.canRender = api.canAnalyze
  && typeof render.renderCard === 'function' && typeof render.prepareCover === 'function'
  && Array.isArray(render.TEMPLATE_ORDER) && !!render.TEMPLATE_INFO && typeof render.TEMPLATE_INFO === 'object';

const TEMPLATES = Array.isArray(render.TEMPLATE_ORDER) ? render.TEMPLATE_ORDER.slice() : [];
const infoOf = (tpl) => (render.TEMPLATE_INFO && render.TEMPLATE_INFO[tpl]) || null;
const tplLabel = (tpl) => infoOf(tpl)?.label || tpl;
function isStyled(tpl) {
  const sup = infoOf(tpl)?.supports;
  if (sup && 'style' in sup) return !!sup.style;
  return !NO_STYLE.has(tpl);
}

function renderApiStatus() {
  const li = (name, ok) => `<li class="${ok ? 'ok' : 'miss'}">${ok ? '✓' : '✗'} <code>${esc(name)}</code></li>`;
  const html = [];
  html.push('<b>接口检查</b> ');
  if (api.colorError) html.push(`<div class="miss">src/color.js 加载失败：${esc(api.colorError)}</div>`);
  if (api.renderError) html.push(`<div class="miss">src/render/index.js 加载失败：${esc(api.renderError)}</div>`);
  html.push(`<ul>${COLOR_API.map((k) => li('color.' + k, !api.colorMissing.includes(k))).join('')}${RENDER_API.map((k) => li('render.' + k, !api.renderMissing.includes(k))).join('')}</ul>`);
  html.push(`<div class="muted">模板（TEMPLATE_ORDER）：${TEMPLATES.length ? TEMPLATES.map((t) => `${esc(tplLabel(t))}(${esc(t)})`).join(' · ') : '无'}</div>`);
  if (!api.canAnalyze) html.push('<div class="miss">缺少 analyzeCover：只显示封面，不做取色和渲染。</div>');
  else if (!api.canRender) html.push('<div class="miss">渲染接口不完整：只做取色和门 2、门 3，不渲染模板。</div>');
  $('#api').innerHTML = html.join('');
}

/* ------------------------------------------------------------------ */
/* 颜色测量（这里自己算，不依赖被测模块）                               */
/* ------------------------------------------------------------------ */

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
function oklab(r, g, b) {
  r = lin(r); g = lin(g); b = lin(b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
const deltaE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * 100;

/** 画布上一块设计坐标矩形的平均 OKLab。 */
function patchLab(canvas, k, x, y, w, h) {
  const x0 = Math.max(0, Math.floor(x * k)), y0 = Math.max(0, Math.floor(y * k));
  const x1 = Math.min(canvas.width, Math.ceil((x + w) * k)), y1 = Math.min(canvas.height, Math.ceil((y + h) * k));
  const pw = Math.max(1, x1 - x0), ph = Math.max(1, y1 - y0);
  const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(Math.min(x0, canvas.width - 1), Math.min(y0, canvas.height - 1), pw, ph).data;
  let L = 0, A = 0, B = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { const o = oklab(d[i], d[i + 1], d[i + 2]); L += o[0]; A += o[1]; B += o[2]; n++; }
  return [L / n, A / n, B / n];
}

/** 背景取样点：设计坐标 (8, 8) 的 8×8 方块；经典取底部 30 px 处（那里是纯背景）。 */
function sampleBackground(canvas, tpl) {
  const k = canvas.width / CARD_W, H = canvas.height / k;
  return patchLab(canvas, k, 8, tpl === 'classic' ? Math.max(0, H - 30) : 8, 8, 8);
}

/* ------------------------------------------------------------------ */
/* 封面来源：iTunes Search API / 本地文件                               */
/* ------------------------------------------------------------------ */

let lastSearchAt = 0;
async function throttle() {
  const wait = lastSearchAt + SEARCH_GAP_MS - Date.now();
  lastSearchAt = Math.max(Date.now(), lastSearchAt + SEARCH_GAP_MS);
  if (wait > 0) await sleep(wait);
}

async function fetchJson(url, onRetry) {
  const waits = [2500, 7000];
  for (let i = 0; ; i++) {
    let failure, retryable = true;
    try {
      const r = await fetch(url, { referrerPolicy: 'no-referrer' });
      if (r.ok) return await r.json();
      retryable = [403, 429, 500, 502, 503].includes(r.status);
      failure = new Error('iTunes 返回 HTTP ' + r.status);
    } catch (e) {
      failure = e;
    }
    if (!retryable || i >= waits.length) throw failure;
    onRetry?.(`iTunes 限流或网络出错，${waits[i] / 1000} 秒后重试…`);
    await sleep(waits[i]);
  }
}

function loadImage(src, cors) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
  });
}

/** 按 covers.json 里的一条检索（含 alt 备用检索），返回命中的 iTunes 结果。 */
async function findOnItunes(def, onNote) {
  const queries = [def, ...(def.alt || []).map((a) => ({ ...def, ...a, alt: undefined }))];
  const tried = [];
  for (const q of queries) {
    const entity = q.entity || 'album', country = q.country || 'us';
    tried.push(`${q.term} [${entity}/${country}]`);
    await throttle();
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(q.term)}&entity=${entity}&limit=5&country=${country}`;
    const json = await fetchJson(url, onNote);
    const results = (json.results || []).filter((r) => r.artworkUrl100);
    let hit = null;
    if (q.match) {
      const re = new RegExp(q.match, 'iu');
      hit = results.find((r) => re.test(r.collectionName || ''));
    } else if (entity === 'song') {
      hit = results[0];
    } else {
      hit = results.find((r) => !/ - (Single|EP)$/i.test(r.collectionName || '')) || results[0];
    }
    if (hit) return { hit, query: { ...q, entity, country }, tried };
  }
  return { hit: null, tried };
}

/** 读一张封面。永远不抛错：返回 { status: 'loaded' | 'missing' | 'error', ... }。 */
async function loadCover(def, onNote) {
  try {
    const { hit, query, tried } = await findOnItunes(def, onNote);
    if (!hit) return { def, status: 'missing', tried };
    const art = hit.artworkUrl100.replace(/\d+x\d+bb(?=\.\w+$)/, '600x600bb');
    const img = await loadImage(art, true);
    const name = `${hit.collectionName} — ${hit.artistName}${query.entity === 'song' ? `（曲目 ${hit.trackName}）` : ''}`;
    return { def, status: 'loaded', img, name, via: `iTunes ${query.country}/${query.entity}`, tried };
  } catch (e) {
    return { def, status: 'error', error: errText(e) };
  }
}

async function loadLocalFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url, false);
    return { def: { id: 'local-' + file.name, label: file.name, local: true }, status: 'loaded', img, name: '本地文件', via: '本地文件', tried: [] };
  } catch (e) {
    return { def: { id: 'local-' + file.name, label: file.name, local: true }, status: 'error', error: errText(e) };
  } finally {
    URL.revokeObjectURL(url);   // 图片已解码在内存里，不再需要这个地址
  }
}

/* ------------------------------------------------------------------ */
/* 渲染状态                                                            */
/* ------------------------------------------------------------------ */

function ratioFor(tpl, choice) {
  const info = infoOf(tpl) || {};
  if (choice === 'default') return info.defaultRatio || 'auto';
  const allowed = info.ratios ?? info.allowedRatios;     // 合同里叫 allowedRatios，渲染模块里现在叫 ratios，两个都认
  const list = Array.isArray(allowed) ? allowed : (allowed && typeof allowed === 'object' ? Object.keys(allowed) : null);
  if (list && !list.includes(choice)) return info.defaultRatio || list[0] || 'auto';
  return choice;
}

function makeState(tpl, seed, style, mode, ratio) {
  const dark = {};
  for (const t of new Set([...TEMPLATES, 'compact', 'classic', 'immersive', 'quiet', 'depth'])) dark[t] = mode;
  return {
    template: tpl, title: '八月のホーム', artist: '示例歌手', lyrics: SAMPLE_LYRICS, parseMode: 'bilingual', focus: [1],
    seed, variant: style, dark, blur: { immersive: 'mid', depth: 'mid' }, depthX: null,
    font: 'sans', scale: 1, align: 'left', showTrans: true, ratio, scrim: 0.5,
    extras: { date: false, dateText: '', note: false, noteText: '', progress: true, cur: '01:52', dur: '04:05', qr: false, link: '', source: '' },
  };
}

/* ------------------------------------------------------------------ */
/* 取色结果检查                                                         */
/* ------------------------------------------------------------------ */

function validateAnalysis(a) {
  const w = [];
  if (!a || typeof a !== 'object') throw new Error('analyzeCover 没有返回对象');
  if (!Array.isArray(a.swatches) || !a.swatches.length) throw new Error('analysis.swatches 为空');
  if (a.swatches.length > 6) w.push('swatches 超过 6 个');
  a.swatches.forEach((s, i) => { if (!HEX.test(s?.hex || '')) w.push(`swatches[${i}].hex 不是 #RRGGBB`); });
  if (!(Number.isInteger(a.defaultIndex) && a.defaultIndex >= 0 && a.defaultIndex < a.swatches.length)) w.push('defaultIndex 越界');
  if (a.swatches[0]?.role !== 'base') w.push("swatches[0].role 应为 'base'");
  if (a.accent != null && !HEX.test(a.accent)) w.push('accent 不是 #RRGGBB 或 null');
  if (!(a.meanL >= 0 && a.meanL <= 1)) w.push('meanL 不在 0..1');
  if (!(a.focus && a.focus.x >= 0 && a.focus.x <= 1 && a.focus.y >= 0 && a.focus.y <= 1)) w.push('focus 不在 0..1');
  if (!(a.edges && HEX.test(a.edges.top || '') && HEX.test(a.edges.bottom || ''))) w.push('edges.top / edges.bottom 不是 #RRGGBB');
  return w;
}

const NA = (text) => ({ state: 'na', text, fails: [] });

/**
 * 门 2：cardPalette 直接算对比度，全部色板 × 风格 × 明暗。
 *   正文 on：黑或白在这个背景上能到 7 就必须 ≥ 7；到不了就 ≥ （黑/白最高值 − 0.05），且不低于 4.5。
 *   次要文字 onVar、强调色 accent：≥ 4.5。
 * 阈值全部在运行时从 cardPalette 返回的背景算出来，这里不写死任何色调。
 */
function gate2(row) {
  if (typeof color.cardPalette !== 'function' || typeof color.contrast !== 'function') return NA('缺少 cardPalette / contrast');
  const a = row.analysis;
  const worst = { on: { margin: Infinity }, onVar: { v: Infinity }, accent: { v: Infinity } };
  const label = { on: '正文', onVar: '次要', accent: '强调' };
  const fails = [];
  const where = (sw, style, mode) => `${STYLE_LABEL[style]}·${MODE_LABEL[mode]} 色板 ${sw.hex}（${ROLE_LABEL[sw.role] || sw.role || '?'}）`;
  try {
    for (const sw of a.swatches) for (const [style] of STYLES) for (const [mode] of MODES) {
      const p = color.cardPalette({ seed: sw.hex, accent: a.accent, style, mode, meanL: a.meanL });
      for (const m of ['bg', 'on', 'onVar', 'accent']) if (!HEX.test(p?.[m] || '')) throw new Error(`cardPalette 返回的 ${m} 不是 #RRGGBB`);
      const best = Math.max(color.contrast('#000000', p.bg), color.contrast('#FFFFFF', p.bg));
      const req = best >= ON_MIN ? ON_MIN : Math.max(ON_FLOOR, best - ON_SLACK);
      const cOn = color.contrast(p.on, p.bg);
      if (cOn - req < worst.on.margin) worst.on = { margin: cOn - req, c: cOn, req, best };
      if (cOn < req) fails.push(`${where(sw, style, mode)}：正文 ${floorTo(cOn, 2)} < ${ceilTo(req, 2)}（该背景黑/白最高 ${floorTo(best, 2)}；on ${p.on} / bg ${p.bg}）`);
      for (const [m, lim] of [['onVar', ONVAR_MIN], ['accent', ACCENT_MIN]]) {
        const c = color.contrast(p[m], p.bg);
        if (c < worst[m].v) worst[m] = { v: c };
        if (c < lim) fails.push(`${where(sw, style, mode)}：${label[m]} ${floorTo(c, 2)} < ${lim}（该背景黑/白最高 ${floorTo(best, 2)}；${m} ${p[m]} / bg ${p.bg}）`);
      }
    }
  } catch (e) {
    return { state: 'error', text: errText(e), fails: [] };
  }
  const w = worst.on;
  const onText = `正文 ${floorTo(w.c, 2)}${w.req < ON_MIN ? `（背景上限 ${floorTo(w.best, 2)}）` : ''}`;
  const text = [onText, `次要 ${floorTo(worst.onVar.v, 2)}`, `强调 ${floorTo(worst.accent.v, 2)}`].join(' · ');
  return { state: fails.length ? 'fail' : 'pass', text: fails.length ? `${fails.length} 项未过：${text}` : text, fails };
}

/** 门 3：自动明暗，只显示。 */
function gate3(row) {
  if (typeof color.resolveDark !== 'function') return NA('缺少 resolveDark');
  try {
    const dark = color.resolveDark('auto', row.analysis.meanL);
    return { state: 'info', text: `meanL ${row.analysis.meanL.toFixed(2)} → ${dark ? '深色' : '浅色'}`, fails: [] };
  } catch (e) { return { state: 'error', text: errText(e), fails: [] }; }
}

/**
 * 这一对风格如果背景太接近，要不要豁免？返回原因，不豁免返回 null。
 *   · 无彩种子（C < 0.04）：只检查 鲜明–柔和 和 忠实–鲜明，其余对不检查。
 *   · 种子 C ≥ 0.15：忠实–鲜明豁免（种子本身就是最鲜明的颜色）。
 *   · 自动明暗：忠实就是封面本色，它和任何风格接近都标“接近（封面本色）”。
 */
function exemptReason(sa, sb, mode, seedC) {
  const has = (s) => sa === s || sb === s;
  if (seedC < ACHROMATIC_C && !((has('vibrant') && has('tonal')) || (has('content') && has('vibrant')))) return '无彩种子：这一对不检查';
  if (seedC >= VIVID_SEED_C && has('content') && has('vibrant')) return `种子 C ≥ ${VIVID_SEED_C}：忠实与鲜明豁免`;
  if (mode === 'auto' && has('content')) return '接近（封面本色）';
  return null;
}

/** 门 1：紧凑 / 经典 / 留白（凡支持风格的模板）里，四种风格两两背景色差 ≥ 8，每种明暗分别算。 */
function gate1(row) {
  const res = row.render;
  if (!res) return NA('没有渲染');
  if (typeof color.hexToOklch !== 'function') return NA('缺少 hexToOklch');
  let seedC;
  try { seedC = color.hexToOklch(row.seed).C; } catch (e) { return { state: 'error', text: errText(e), fails: [] }; }
  let min = Infinity, minAt = '', checked = 0;
  const fails = [], exempt = [];
  res.bad = new Set(); res.near = new Set();
  for (const tpl of TEMPLATES) {
    if (!isStyled(tpl) || res.missing.has(tpl)) continue;
    for (const [mode] of MODES) {
      const labs = STYLES.map(([s]) => res.cells.get(key(tpl, mode, s))?.lab);
      if (labs.some((l) => !l)) continue;
      for (let i = 0; i < STYLES.length; i++) for (let j = i + 1; j < STYLES.length; j++) {
        const [sa] = STYLES[i], [sb] = STYLES[j];
        const d = deltaE(labs[i], labs[j]);
        const at = `${tplLabel(tpl)}·${MODE_LABEL[mode]} ${STYLE_LABEL[sa]}–${STYLE_LABEL[sb]}`;
        const why = exemptReason(sa, sb, mode, seedC);
        if (why) {
          if (d < SEP_MIN) {                      // 本来会不过的，记下来并用中性色标出
            exempt.push(`${at}：ΔE ${floorTo(d, 1)}，${why}`);
            res.near.add(key(tpl, mode, sa)); res.near.add(key(tpl, mode, sb));
          }
          continue;
        }
        checked++;
        if (d < min) { min = d; minAt = at; }
        if (d < SEP_MIN) {
          fails.push(`${at}：ΔE ${floorTo(d, 1)} < ${SEP_MIN}`);
          res.bad.add(key(tpl, mode, sa)); res.bad.add(key(tpl, mode, sb));
        }
      }
    }
  }
  if (!checked) return { ...NA('没有可比较的风格对'), exempt };
  const tail = exempt.length ? `；另有 ${exempt.length} 对接近但豁免` : '';
  return {
    state: fails.length ? 'fail' : 'pass',
    text: (fails.length ? `${fails.length} 对未过，最小 ${floorTo(min, 1)} ${minAt}` : `最小 ${floorTo(min, 1)} ${minAt}`) + tail,
    fails, exempt,
  };
}

/* ------------------------------------------------------------------ */
/* 渲染一张封面的全部缩略图                                              */
/* ------------------------------------------------------------------ */

async function renderRow(row, ratioChoice) {
  const t0 = performance.now();
  const assets = { cover: render.prepareCover(row.img), analysis: row.analysis, customFont: false };
  const out = { cells: new Map(), missing: new Map(), errors: [], ratio: ratioChoice, ms: 0 };

  for (const tpl of TEMPLATES) {
    if (!infoOf(tpl)) { out.missing.set(tpl, 'TEMPLATE_INFO 里没有这个模板'); continue; }
    const styled = isStyled(tpl);
    const ratio = ratioFor(tpl, ratioChoice);
    let first = true;
    for (const [mode] of MODES) {
      for (const [style] of (styled ? STYLES : STYLES.slice(0, 1))) {
        const canvas = document.createElement('canvas');
        canvas.getContext('2d', { willReadFrequently: true });
        try {
          const r = await render.renderCard(canvas, makeState(tpl, row.seed, style, mode, ratio), assets, { scale: SCALE, purpose: 'thumb' });
          const cell = { canvas, info: r || null };
          if (styled) cell.lab = sampleBackground(canvas, tpl);
          out.cells.set(key(tpl, mode, style), cell);
        } catch (e) {
          if (first) { out.missing.set(tpl, errText(e)); break; }          // 第一张就失败：当作这个模板还没实现
          out.cells.set(key(tpl, mode, style), { error: errText(e) });
          out.errors.push(`${tplLabel(tpl)}·${MODE_LABEL[mode]}·${STYLE_LABEL[style]}：${errText(e)}`);
        }
        first = false;
      }
      if (out.missing.has(tpl)) { for (const k of [...out.cells.keys()]) if (k.startsWith(tpl + '|')) out.cells.delete(k); break; }
    }
    await yieldNow();
  }
  out.ms = performance.now() - t0;
  return out;
}

/* ------------------------------------------------------------------ */
/* 一行的完整评估                                                        */
/* ------------------------------------------------------------------ */

async function evaluate(row, ratioChoice) {
  row.error = null; row.render = null;
  row.g1 = row.g2 = row.g3 = null;
  try {
    if (!api.canAnalyze) throw new Error('缺少 analyzeCover，没法取色');
    if (!row.analysis) {
      row.analysis = color.analyzeCover(row.img);
      row.warnings = validateAnalysis(row.analysis);
    }
    row.warnings ||= [];
    const a = row.analysis;
    row.seed = (a.swatches[a.defaultIndex] || a.swatches[0]).hex;
    row.seedC = typeof color.hexToOklch === 'function' ? color.hexToOklch(row.seed).C : NaN;
    row.g3 = gate3(row);
    row.g2 = gate2(row);
    if (api.canRender) {
      row.render = await renderRow(row, ratioChoice);
      row.g1 = gate1(row);
    } else {
      row.g1 = NA('渲染接口不完整');
    }
  } catch (e) {
    row.error = errText(e);
    console.error(row.label, e);
  }
  const errs = (row.render?.errors || []).length + (row.error ? 1 : 0);
  const gates = [row.g1, row.g2].filter(Boolean);
  if (errs || gates.some((g) => g.state === 'error')) row.status = 'error';
  else if (gates.some((g) => g.state === 'fail')) row.status = 'fail';
  else if (gates.some((g) => g.state === 'pass')) row.status = 'pass';
  else row.status = 'na';
  try { row.sheet = drawSheet(row); } catch (e) { console.error(e); row.error = (row.error ? row.error + '；' : '') + '画总图出错：' + errText(e); row.status = 'error'; row.sheet = drawSheet({ ...row, analysis: null, render: null }); }
  if (row.render) for (const c of row.render.cells.values()) delete c.canvas;   // 缩略图已经画进总图，释放内存
}

/* ------------------------------------------------------------------ */
/* 总图（每张封面一张 canvas）                                           */
/* ------------------------------------------------------------------ */

const FONT = 'system-ui, "Microsoft YaHei", "PingFang SC", sans-serif';
const SHEET_BG = '#e9e9e9';
const STATUS_COLOR = { pass: '#0a7a2f', fail: '#b00020', error: '#b00020', na: '#666' };
const STATUS_TEXT = { pass: 'PASS', fail: 'FAIL', error: '出错', na: '未检查' };

function fit(g, text, maxW) {
  if (g.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && g.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

function drawCoverThumb(g, img, x, y, size, analysis) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height, side = Math.min(w, h);
  g.save();
  g.beginPath(); g.roundRect(x, y, size, size, 6); g.clip();
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, x, y, size, size);
  g.restore();
  if (analysis?.focus) {          // 视觉中心：白点 + 黑边
    const fx = x + analysis.focus.x * size, fy = y + analysis.focus.y * size;
    g.beginPath(); g.arc(fx, fy, 6, 0, Math.PI * 2);
    g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.7)'; g.stroke();
    g.lineWidth = 1.5; g.strokeStyle = '#fff'; g.stroke();
  }
}

function drawMeta(g, row, x, y) {
  const a = row.analysis;
  drawCoverThumb(g, row.img, x, y, 150, a);
  if (!a) return;
  let yy = y + 150 + 8;
  a.swatches.forEach((s, i) => {
    g.beginPath(); g.arc(x + 11 + i * 25, yy + 11, 10, 0, Math.PI * 2);
    g.fillStyle = s.hex; g.fill();
    g.lineWidth = i === a.defaultIndex ? 3 : 1; g.strokeStyle = i === a.defaultIndex ? '#111' : 'rgba(0,0,0,.3)'; g.stroke();
  });
  yy += 28;
  g.font = `11px ${FONT}`; g.textBaseline = 'top';
  a.swatches.forEach((s, i) => {
    g.fillStyle = '#222';
    g.fillText(`${i === a.defaultIndex ? '★' : ' '} ${s.hex} ${ROLE_LABEL[s.role] || s.role || ''} ${(s.share * 100).toFixed(0)}%`, x, yy);
    yy += 14;
  });
  yy += 4;
  g.fillStyle = '#444';
  const lines = [
    `强调色 ${a.accent || '无'}`,
    `meanL ${Number(a.meanL).toFixed(2)} · 自动→${typeof color.resolveDark === 'function' ? (color.resolveDark('auto', a.meanL) ? '深色' : '浅色') : '?'}`,
    `focus ${a.focus ? `${a.focus.x.toFixed(2)}, ${a.focus.y.toFixed(2)}` : '无'}（白点）`,
  ];
  for (const l of lines) { g.fillText(fit(g, l, 168), x, yy); yy += 14; }
  if (a.edges) {
    g.fillText('边缘 上', x, yy); g.fillStyle = a.edges.top; g.fillRect(x + 42, yy, 16, 11);
    g.fillStyle = '#444'; g.fillText('下', x + 66, yy); g.fillStyle = a.edges.bottom; g.fillRect(x + 78, yy, 16, 11);
    g.strokeStyle = 'rgba(0,0,0,.3)'; g.lineWidth = 1; g.strokeRect(x + 42.5, yy + .5, 16, 11); g.strokeRect(x + 78.5, yy + .5, 16, 11);
  }
}

function drawSheet(row) {
  const PAD = 10, META_W = 170, LABEL_W = 34, GAP = 4, GROUP_GAP = 14, TITLE_Y = 8, HEAD_Y = 34, GRID_Y = 74;
  const cw = Math.round(CARD_W * SCALE);
  const res = row.render;

  const groups = [];
  let x = PAD + META_W + PAD + LABEL_W;
  for (const tpl of TEMPLATES) {
    const styles = isStyled(tpl) ? STYLES : STYLES.slice(0, 1);
    const w = styles.length * (cw + GAP) - GAP;
    groups.push({ tpl, styles, x, w });
    x += w + GROUP_GAP;
  }
  const gridRight = TEMPLATES.length ? x - GROUP_GAP : PAD + META_W + PAD + 420;
  const W = Math.max(gridRight + PAD, PAD + META_W + PAD + 420);

  const rowH = MODES.map(([mode]) => {
    let h = 60;
    if (res) for (const g of groups) for (const [style] of g.styles) {
      const c = res.cells.get(key(g.tpl, mode, style));
      if (c?.canvas) h = Math.max(h, c.canvas.height);
    }
    return h;
  });
  const H = Math.max(GRID_Y + rowH.reduce((s, h) => s + h + 10, 0) + PAD, 440);

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');
  g.fillStyle = SHEET_BG; g.fillRect(0, 0, W, H);
  g.textBaseline = 'top';

  // 标题行
  g.fillStyle = '#111'; g.font = `600 14px ${FONT}`;
  const title = `${row.index}. ${row.label}`;
  g.fillText(fit(g, title, 520), PAD, TITLE_Y);
  const tw = Math.min(520, g.measureText(title).width);
  g.fillStyle = '#555'; g.font = `12px ${FONT}`;
  g.fillText(fit(g, row.name || '', Math.max(120, W - PAD * 2 - tw - 140)), PAD + tw + 12, TITLE_Y + 2);
  g.fillStyle = STATUS_COLOR[row.status]; g.font = `700 13px ${FONT}`; g.textAlign = 'right';
  g.fillText(STATUS_TEXT[row.status], W - PAD, TITLE_Y); g.textAlign = 'left';

  try { drawMeta(g, row, PAD, HEAD_Y); } catch (e) { g.fillStyle = '#b00020'; g.font = `11px ${FONT}`; g.fillText(fit(g, '画取色信息出错：' + errText(e), META_W), PAD, HEAD_Y + 160); }

  // 网格表头
  const gx0 = PAD + META_W + PAD;
  for (const grp of groups) {
    g.fillStyle = '#111'; g.font = `600 12px ${FONT}`;
    g.fillText(tplLabel(grp.tpl), grp.x, HEAD_Y);
    g.font = `11px ${FONT}`; g.fillStyle = '#555';
    if (grp.styles.length > 1) grp.styles.forEach(([, label], i) => g.fillText(label, grp.x + i * (cw + GAP), HEAD_Y + 18));
    else g.fillText('无风格', grp.x, HEAD_Y + 18);
  }

  // 行标签 + 单元格
  let y = GRID_Y;
  MODES.forEach(([mode, mlabel], mi) => {
    g.fillStyle = '#333'; g.font = `600 12px ${FONT}`; g.fillText(mlabel, gx0, y + 2);
    for (const grp of groups) {
      if (!res) continue;
      if (res.missing.has(grp.tpl)) {
        g.setLineDash([4, 3]); g.strokeStyle = '#999'; g.lineWidth = 1;
        g.strokeRect(grp.x + .5, y + .5, grp.w - 1, rowH[mi] - 1); g.setLineDash([]);
        g.fillStyle = '#666'; g.font = `12px ${FONT}`;
        g.fillText('未实现', grp.x + 8, y + 8);
        if (mi === 0) { g.font = `10px ${FONT}`; g.fillStyle = '#888'; g.fillText(fit(g, res.missing.get(grp.tpl), grp.w - 16), grp.x + 8, y + 26); }
        continue;
      }
      grp.styles.forEach(([style], si) => {
        const cx = grp.x + si * (cw + GAP);
        const c = res.cells.get(key(grp.tpl, mode, style));
        if (c?.canvas) {
          g.drawImage(c.canvas, cx, y);
          const bad = res.bad?.has(key(grp.tpl, mode, style));
          const near = !bad && res.near?.has(key(grp.tpl, mode, style));
          const thick = bad || near;
          g.lineWidth = thick ? 3 : 1; g.strokeStyle = bad ? '#e0102a' : near ? '#5f7396' : 'rgba(0,0,0,.18)';
          g.strokeRect(cx - (thick ? 1 : -.5), y - (thick ? 1 : -.5), c.canvas.width + (thick ? 2 : -1), c.canvas.height + (thick ? 2 : -1));
        } else if (c?.error) {
          g.fillStyle = '#fbe4e4'; g.fillRect(cx, y, cw, 80);
          g.fillStyle = '#b00020'; g.font = `11px ${FONT}`; g.fillText('渲染出错', cx + 6, y + 6);
          g.font = `10px ${FONT}`; g.fillText(fit(g, c.error, cw - 12), cx + 6, y + 22);
        }
      });
    }
    y += rowH[mi] + 10;
  });

  if (!res) {   // 没渲染：把原因写在网格位置
    g.fillStyle = '#b00020'; g.font = `13px ${FONT}`;
    const msg = row.error || '没有渲染（接口缺失）';
    g.fillText(fit(g, msg, W - gx0 - PAD), gx0, GRID_Y);
  }
  return canvas;
}

/* ------------------------------------------------------------------ */
/* 页面                                                                */
/* ------------------------------------------------------------------ */

const rows = [];
let ratioChoice = '4:5';
let pending = 0;
let chain = Promise.resolve();
let lastRun = '';

function setProgress(text, done, total) {
  $('#progressText').textContent = text;
  const bar = $('#bar');
  if (total) { bar.max = total; bar.value = done; bar.hidden = false; } else bar.hidden = true;
}

function enqueue(task) {
  pending++; window.__done = false;
  $('#export').disabled = true;
  chain = chain.then(task).catch((e) => { console.error(e); setProgress('出错：' + errText(e)); })
    .finally(() => { pending--; if (!pending) { window.__done = true; refreshControls(); renderSummary(); } });
  return chain;
}

function refreshControls() {
  $('#export').disabled = !rows.some((r) => r.sheet);
}

function gateCell(g) {
  if (!g) return '<td class="na">—</td>';
  const cls = { pass: 'pass', fail: 'fail', error: 'fail', info: '', na: 'na' }[g.state];
  const tag = { pass: 'PASS', fail: 'FAIL', error: '出错', info: '', na: '—' }[g.state];
  return `<td class="${cls}">${tag ? `<b>${tag}</b> ` : ''}${esc(g.text)}</td>`;
}

function chips(a) {
  return a.swatches.map((s, i) => `<span class="chip${i === a.defaultIndex ? ' def' : ''}" title="${esc(`${s.hex} ${ROLE_LABEL[s.role] || ''} ${(s.share * 100).toFixed(0)}%`)}" style="background:${esc(s.hex)}"></span>`).join('');
}

function notesOf(row) {
  const n = [];
  if (row.error) n.push(`<span class="err">${esc(row.error)}</span>`);
  for (const w of row.warnings || []) n.push(`<span class="err">⚠ ${esc(w)}</span>`);
  if (row.render) {
    const miss = [...row.render.missing.keys()].map((t) => tplLabel(t));
    if (miss.length) n.push(`未实现：${esc(miss.join('、'))}`);
    if (row.render.errors.length) n.push(`<span class="err">${row.render.errors.length} 张渲染出错</span>`);
  }
  return n.join('<br>');
}

function summaryOf() {
  const done = rows.filter((r) => r.status);
  const count = (s) => done.filter((r) => r.status === s).length;
  const missingTpl = new Map();
  for (const r of done) for (const t of r.render?.missing.keys() || []) missingTpl.set(t, (missingTpl.get(t) || 0) + 1);
  return {
    total: rows.length, pass: count('pass'), fail: count('fail'), error: count('error'), na: count('na'),
    skipped: rows.filter((r) => r.status === 'missing' || r.status === 'loaderror').length,
    missingTemplates: Object.fromEntries(missingTpl),
    evaluated: done.length,
  };
}

function renderSummary() {
  $('#summary thead').innerHTML = '<tr><th>#</th><th>封面</th><th>色板（粗圈 = 默认种子）</th><th>门 3 自动明暗</th><th>门 1 风格分离</th><th>门 2 对比度</th><th>备注</th></tr>';
  $('#summary tbody').innerHTML = rows.map((r) => {
    const name = `<a href="#sheet-${r.index}">${esc(r.label)}</a>`;
    if (r.status === 'missing') return `<tr><td class="num">${r.index}</td><td>${esc(r.label)}</td><td colspan="5" class="na">iTunes 没找到，已跳过<br><span class="small">${esc((r.tried || []).join(' ｜ '))}</span></td></tr>`;
    if (r.status === 'loaderror') return `<tr><td class="num">${r.index}</td><td>${esc(r.label)}</td><td colspan="5" class="fail">加载失败：${esc(r.error)}</td></tr>`;
    if (!r.status) return `<tr><td class="num">${r.index}</td><td>${esc(r.label)}</td><td colspan="5" class="na">处理中…</td></tr>`;
    return `<tr><td class="num">${r.index}</td><td>${name}</td><td>${r.analysis ? chips(r.analysis) : '—'}</td>` +
      `<td>${esc(r.g3?.text || '—')}</td>${gateCell(r.g1)}${gateCell(r.g2)}<td>${notesOf(r)}</td></tr>`;
  }).join('');

  const s = summaryOf();
  const v = $('#verdict');
  const parts = [`${s.total} 张封面`, `通过 ${s.pass}`, `未通过 ${s.fail}`];
  if (s.error) parts.push(`出错 ${s.error}`);
  if (s.na) parts.push(`未检查 ${s.na}`);
  if (s.skipped) parts.push(`跳过 ${s.skipped}`);
  const miss = Object.entries(s.missingTemplates).map(([t, n]) => `${tplLabel(t)} 未实现（${n} 张）`);
  v.textContent = parts.join('，') + (miss.length ? '；' + miss.join('，') : '');
  v.className = 'verdict ' + (pending ? 'wait' : (s.fail || s.error ? 'fail' : (s.pass ? 'pass' : 'wait')));
}

function sheetBadge(row) {
  return `<span class="tag ${row.status === 'pass' ? 'pass' : row.status === 'na' ? 'na' : 'fail'}">${STATUS_TEXT[row.status]}</span>`;
}

function upsertSheet(row) {
  let el = document.getElementById('sheet-' + row.index);
  if (!el) {
    el = document.createElement('article');
    el.className = 'sheet'; el.id = 'sheet-' + row.index;
    $('#sheets').append(el);
  }
  const lines = [];
  if (row.error) lines.push('出错：' + row.error);
  for (const w of row.warnings || []) lines.push('⚠ ' + w);
  if (row.g1?.fails.length) lines.push('门 1 风格分离（未过）：', ...row.g1.fails.map((f) => '  ' + f));
  if (row.g1?.exempt?.length) lines.push('门 1 接近但豁免（不算失败，图中蓝灰框）：', ...row.g1.exempt.map((f) => '  ' + f));
  if (row.g2?.state === 'error') lines.push('门 2 出错：' + row.g2.text);
  if (row.g2?.fails.length) lines.push('门 2 对比度：', ...row.g2.fails.slice(0, 40).map((f) => '  ' + f), ...(row.g2.fails.length > 40 ? [`  …另有 ${row.g2.fails.length - 40} 项`] : []));
  if (row.g1?.state === 'error') lines.push('门 1 出错：' + row.g1.text);
  for (const e of row.render?.errors || []) lines.push('渲染出错：' + e);
  for (const [t, m] of row.render?.missing || []) lines.push(`未实现 ${tplLabel(t)}（${t}）：${m}`);
  if (row.render) lines.push(`渲染 ${Math.round(row.render.ms)} ms · 种子 ${row.seed} · 画幅 ${row.render.ratio}`);

  el.innerHTML = `<header><h3>${row.index}. ${esc(row.label)}</h3>${sheetBadge(row)}<span class="muted small grow">${esc(row.name || '')} · ${esc(row.via || '')}</span><button type="button" data-save>导出此封面</button></header>` +
    '<div class="view"></div>' +
    (lines.length ? `<details${row.status === 'pass' ? '' : ' open'}><summary>明细（${lines.length} 行）</summary><pre>${esc(lines.join('\n'))}</pre></details>` : '');
  const cv = row.sheet;
  cv.title = '点击在“适应宽度”和“原始大小”之间切换';
  cv.addEventListener('click', () => cv.classList.toggle('natural'));
  el.querySelector('.view').append(cv);
  el.querySelector('[data-save]').addEventListener('click', () => download(cv, `lyrics4u-visual-${slug(row.label)}.png`));
}

const slug = (s) => String(s).replace(/[^\p{L}\p{N}]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'cover';

async function download(canvas, name) {
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('canvas.toBlob 失败（图太大？）');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* ---- 导出：汇总 + 全部总图，超过 MAX_PAGE_H 就分页 ---- */

function drawSummaryCanvas(width) {
  const LH = 18, PAD = 12;
  const list = rows;
  const H = PAD * 2 + 60 + (list.length + 1) * LH;
  const c = document.createElement('canvas'); c.width = width; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, width, H); g.textBaseline = 'top';
  const s = summaryOf();
  g.fillStyle = '#111'; g.font = `600 16px ${FONT}`;
  g.fillText(`Lyrics 4U 取色与模板视觉检查 · ${lastRun} · 画幅 ${ratioChoice}`, PAD, PAD);
  g.font = `13px ${FONT}`; g.fillStyle = s.fail || s.error ? '#b00020' : '#0a7a2f';
  const miss = Object.entries(s.missingTemplates).map(([t, n]) => `${tplLabel(t)} 未实现（${n} 张）`);
  g.fillText(`${s.total} 张封面，通过 ${s.pass}，未通过 ${s.fail}，出错 ${s.error}，跳过 ${s.skipped}${miss.length ? '；' + miss.join('，') : ''}`, PAD, PAD + 24);
  g.font = `12px ${FONT}`;
  const X = [PAD, PAD + 28, PAD + 300, PAD + 480, PAD + 760];
  let y = PAD + 52;
  g.fillStyle = '#555';
  ['#', '封面', '自动明暗（门 3）', '门 1 风格分离', '门 2 对比度'].forEach((t, i) => g.fillText(t, X[i], y));
  y += LH;
  for (const r of list) {
    g.fillStyle = '#111'; g.fillText(String(r.index), X[0], y);
    g.fillText(fit(g, r.label, 262), X[1], y);
    if (r.status === 'missing' || r.status === 'loaderror') { g.fillStyle = '#777'; g.fillText(r.status === 'missing' ? '没找到，已跳过' : '加载失败：' + (r.error || ''), X[2], y); }
    else if (r.status) {
      g.fillStyle = '#333'; g.fillText(r.g3?.text || '—', X[2], y);
      for (const [gate, x] of [[r.g1, X[3]], [r.g2, X[4]]]) {
        g.fillStyle = gate?.state === 'pass' ? '#0a7a2f' : gate?.state === 'fail' || gate?.state === 'error' ? '#b00020' : '#777';
        const tag = { pass: 'PASS ', fail: 'FAIL ', error: '出错 ' }[gate?.state] || '— ';
        g.fillText(fit(g, tag + (gate?.text || ''), 270), x, y);
      }
    }
    y += LH;
  }
  return c;
}

async function exportAll() {
  const sheets = rows.filter((r) => r.sheet).map((r) => r.sheet);
  if (!sheets.length) return;
  const width = Math.max(...sheets.map((s) => s.width), 1000);
  const parts = [drawSummaryCanvas(width), ...sheets];
  const pages = [];
  let cur = [], h = 0;
  for (const p of parts) {
    if (cur.length && h + p.height > MAX_PAGE_H) { pages.push(cur); cur = []; h = 0; }
    cur.push(p); h += p.height;
  }
  if (cur.length) pages.push(cur);
  const stamp = lastRun.replace(/[^0-9]/g, '').slice(0, 12);
  for (let i = 0; i < pages.length; i++) {
    const H = pages[i].reduce((s, p) => s + p.height, 0);
    const c = document.createElement('canvas'); c.width = width; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = SHEET_BG; g.fillRect(0, 0, width, H);
    let y = 0;
    for (const p of pages[i]) { g.drawImage(p, 0, y); y += p.height; }
    await download(c, `lyrics4u-visual-${stamp}${pages.length > 1 ? `-${i + 1}of${pages.length}` : ''}.png`);
    await sleep(400);
  }
}

/* ---- 一张封面加进页面 ---- */

async function addLoaded(item, total) {
  const row = {
    index: rows.length + 1, id: item.def.id, label: item.def.label, local: !!item.def.local,
    name: item.name || '', via: item.via || '', tried: item.tried || [], img: item.img || null,
  };
  rows.push(row);
  if (item.status === 'missing') { row.status = 'missing'; renderSummary(); return row; }
  if (item.status === 'error') { row.status = 'loaderror'; row.error = item.error; renderSummary(); return row; }
  renderSummary();
  await evaluate(row, ratioChoice);
  upsertSheet(row);
  renderSummary();
  await yieldNow();
  return row;
}

async function runCatalog() {
  const params = new URLSearchParams(location.search);
  const only = (params.get('only') || '').split(',').map((s) => s.trim()).filter(Boolean);
  let defs;
  try {
    const r = await fetch('./covers.json', { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    defs = (await r.json()).covers || [];
  } catch (e) {
    setProgress('读不到 covers.json：' + errText(e));
    return;
  }
  if (only.length) defs = defs.filter((d) => only.includes(d.id));
  setProgress('加载封面…', 0, defs.length);
  const note = (t) => setProgress(t);
  let next = defs.length ? loadCover(defs[0], note) : null;
  for (let i = 0; i < defs.length; i++) {
    setProgress(`加载封面 ${i + 1}/${defs.length}：${defs[i].label}`, i, defs.length);
    const item = await next;
    next = i + 1 < defs.length ? loadCover(defs[i + 1], note) : null;     // 渲染这一张的同时预取下一张
    setProgress(`处理 ${i + 1}/${defs.length}：${defs[i].label}`, i, defs.length);
    await addLoaded(item, defs.length);
  }
  setProgress(`完成：${defs.length} 条检索，${rows.filter((r) => r.img).length} 张封面进入检查。`, defs.length, defs.length);
}

async function runFiles(files) {
  const list = [...files].filter((f) => f.type.startsWith('image/'));
  for (let i = 0; i < list.length; i++) {
    setProgress(`处理本地封面 ${i + 1}/${list.length}：${list[i].name}`, i, list.length);
    await addLoaded(await loadLocalFile(list[i]));
  }
  setProgress(`完成：${list.length} 张本地封面。`, list.length, list.length);
}

async function rerenderAll() {
  const todo = rows.filter((r) => r.img);
  for (let i = 0; i < todo.length; i++) {
    setProgress(`按 ${ratioChoice} 重新渲染 ${i + 1}/${todo.length}：${todo[i].label}`, i, todo.length);
    await evaluate(todo[i], ratioChoice);
    upsertSheet(todo[i]);
    renderSummary();
    await yieldNow();
  }
  setProgress(`完成：重新渲染 ${todo.length} 张。`, todo.length, todo.length);
}

/* ---- 可供自动化脚本读取 ---- */

window.__visual = {
  api, rows,
  report: () => rows.map((r) => ({
    index: r.index, id: r.id, label: r.label, name: r.name, status: r.status, error: r.error || null, warnings: r.warnings || [],
    seed: r.seed || null, meanL: r.analysis?.meanL ?? null, swatches: r.analysis?.swatches?.map((s) => s.hex) ?? null,
    gate1: r.g1 && { state: r.g1.state, text: r.g1.text, fails: r.g1.fails },
    gate2: r.g2 && { state: r.g2.state, text: r.g2.text, fails: r.g2.fails },
    gate3: r.g3 && { text: r.g3.text },
    missingTemplates: r.render ? Object.fromEntries(r.render.missing) : null,
    renderErrors: r.render?.errors ?? null, renderMs: r.render ? Math.round(r.render.ms) : null,
  })),
  summary: summaryOf,
  idle: () => chain,
};

/* ---- 启动 ---- */

function wireUi() {
  $('#reload').addEventListener('click', () => location.reload());
  $('#export').addEventListener('click', () => { exportAll().catch((e) => setProgress('导出失败：' + errText(e))); });
  $('#ratio').addEventListener('change', (e) => { ratioChoice = e.target.value; enqueue(rerenderAll); });
  $('#pick').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) enqueue(() => runFiles(f)); });
  let depth = 0;
  addEventListener('dragenter', (e) => { e.preventDefault(); depth++; document.body.classList.add('dragging'); });
  addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) document.body.classList.remove('dragging'); });
  addEventListener('dragover', (e) => e.preventDefault());
  addEventListener('drop', (e) => {
    e.preventDefault(); depth = 0; document.body.classList.remove('dragging');
    const f = [...(e.dataTransfer?.files || [])];
    if (f.length) enqueue(() => runFiles(f));
  });
}

renderApiStatus();
wireUi();
const now = new Date();
lastRun = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
renderSummary();
try { await document.fonts.ready; } catch { /* 没有也行 */ }
enqueue(runCatalog);
