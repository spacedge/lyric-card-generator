// 振假名（ルビ）：把歌词里的注音标记解析成段落，供折行和绘制使用。纯逻辑模块，无依赖。
//
// 三种写法：
//   ｜東京《とうきょう》   竖线（全角 ｜ 或半角 |）标出注音范围，注音可以是任何文字
//   東京《とうきょう》     省略竖线：《》前面连续的汉字就是注音范围，注音只能是假名
//   {東京|とうきょう}      花括号写法，注音可以是任何文字
// ｜《 写出字面上的 《。
//
// 省略竖线的写法只认「汉字 + 《假名》」，所以中文歌词里的书名号（如「喜欢《晴天》」）不会被当成注音。

const HAN_RUN = '[\\p{Script=Han}々〆ヵヶ]{1,20}';
const KANA_RUN = '[\\p{Script=Hiragana}\\p{Script=Katakana}ー]{1,30}';

const RUBY = new RegExp([
  '[｜|]《',                                         // 1. 转义：字面上的 《
  '[｜|]([^｜|《》\\n]{1,20})《([^《》\\n]{1,30})》', // 2. 竖线写法
  '\\{([^{}|\\n]{1,20})\\|([^{}|\\n]{1,30})\\}',     // 3. 花括号写法
  `(${HAN_RUN})《(${KANA_RUN})》`,                    // 4. 省略竖线
].join('|'), 'gu');

const nonEmpty = (s) => /\S/.test(s);

/**
 * 把一段文本拆成 [{ t }] 和 [{ b, r }]：t 是普通文本，b 是被注音的文字，r 是注音。
 * 相邻的普通文本会合并；没有注音标记时返回 [{ t: text }]（空文本返回 []）。
 * 注音或被注音的文字只有空白时，按普通文本处理。
 */
export function parseRuby(text) {
  const src = String(text ?? '');
  const out = [];
  const pushText = (t) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last && last.t !== undefined) last.t += t;
    else out.push({ t });
  };
  let at = 0;
  for (const m of src.matchAll(RUBY)) {
    pushText(src.slice(at, m.index));
    at = m.index + m[0].length;
    if (m[1] === undefined && m[3] === undefined && m[5] === undefined) { pushText('《'); continue; }
    const b = m[1] ?? m[3] ?? m[5];
    const r = (m[2] ?? m[4] ?? m[6]).trim();
    if (nonEmpty(b) && nonEmpty(r)) out.push({ b, r });
    else pushText(b);
  }
  pushText(src.slice(at));
  return out;
}

/** 文本里有没有注音（转义的 ｜《 不算）。 */
export function hasRuby(text) {
  return parseRuby(text).some((s) => s.r !== undefined);
}

/** 去掉注音，只留被注音的文字（用于重点句列表这类纯文本的地方）。 */
export function stripRuby(text) {
  return parseRuby(text).map((s) => s.t ?? s.b).join('');
}

/** 按「是否显示注音」得到要排版的段落：不显示时注音段落并回普通文本。 */
export function rubySegments(text, show = true) {
  const segs = parseRuby(text);
  if (show) return segs;
  const plain = segs.map((s) => s.t ?? s.b).join('');
  return plain ? [{ t: plain }] : [];
}
