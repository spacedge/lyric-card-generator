// 文字工具：文种检测和中日英混排的折行（禁则处理、按词组断行、防孤字）。
// 纯逻辑模块：折行所需的宽度由调用方通过 measure 回调提供（canvas measureText 或测试里的固定宽度）。

/* ------------------------------------------------------------------ */
/* 文种检测                                                            */
/* ------------------------------------------------------------------ */

// 平假名、片假名（含长音符 ー、小写假名、片假名扩展、半角片假名），不含中点 ・
const KANA = /[ぁ-ゖゝ-ゟァ-ヺー-ヿㇰ-ㇿｦ-ﾟ]/;

export function hasKana(s) { return KANA.test(s); }
export function hasHan(s) { return /\p{Script=Han}/u.test(s); }
export function hasHangul(s) { return /\p{Script=Hangul}/u.test(s); }

/* ------------------------------------------------------------------ */
/* 禁则字符                                                            */
/* ------------------------------------------------------------------ */

/** 不能出现在行首的字符：句读点、闭括号、长音符、省略号、小写假名等。 */
export const NO_START = new Set(Array.from(
  '、。，．,.!?！？：；:;・ー…‥」』）)】》〉”’]}〕］｝〗〙〛〜～' +
  'ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ'));

/** 不能出现在行尾的字符：开括号、开引号。 */
export const NO_END = new Set(Array.from('「『（(【《〈“‘[{〔［｛〖〘〚'));

/* ------------------------------------------------------------------ */
/* 分词                                                                */
/* ------------------------------------------------------------------ */

const SPACE = /\s/;
// 拉丁字母（含带音标的）、数字、撇号、连字符：连续出现时算同一个词
const WORD = /[A-Za-z0-9À-ɏḀ-ỿ'’-]/;
// 组合符号、变体选择符、肤色修饰符、零宽连接符：必须和前一个字符粘在一起
const EXTEND = /[\p{M}‍︀-️\u{1F3FB}-\u{1F3FF}]/u;

const isSpace = tok => /^\s+$/.test(tok);

/** 连续的拉丁词是一个 token，空格各自一个 token，其余每个字符（按码点）一个 token。 */
function tokenize(text) {
  const tokens = [];
  let kind = '';             // 当前最后一个 token 的类型：'word' | 'space' | 'other'
  let joinNext = false;      // 上一个字符是零宽连接符 ZWJ
  for (const ch of text) {
    if (tokens.length && kind !== 'space' && (joinNext || EXTEND.test(ch))) {
      tokens[tokens.length - 1] += ch;
    } else if (SPACE.test(ch)) {
      tokens.push(ch);
      kind = 'space';
    } else if (WORD.test(ch)) {
      if (kind === 'word') tokens[tokens.length - 1] += ch;
      else { tokens.push(ch); kind = 'word'; }
    } else {
      tokens.push(ch);
      kind = 'other';
    }
    joinNext = ch === '‍';
  }
  return tokens;
}

/* ------------------------------------------------------------------ */
/* 折行                                                                */
/* ------------------------------------------------------------------ */

const EPS = 1e-9;              // 浮点累加的容差，避免恰好排满的行被误判为放不下
const PHRASE_BREAK_MIN = 0.4;  // 空格要在行宽的 40% 之后，才值得在那里断开

/**
 * 把一个段落的 token 排成若干行（不含防孤字）。
 * 状态是当前行 line（token 数组）和它拼出的字符串 str；token 放不下时调用 breakLine
 * 把行首部分输出、行尾部分留给下一行，再重试。
 */
function layout(measure, tokens, maxWidth) {
  const lines = [];
  let line = [];
  let str = '';
  const fits = s => measure(s) <= maxWidth + EPS;

  const setLine = toks => {
    let from = 0;
    while (from < toks.length && isSpace(toks[from])) from++;     // 行首不留空格
    line = toks.slice(from);
    str = line.join('');
  };
  const emit = toks => {
    const s = toks.join('').trim();
    if (s) lines.push(s);
  };
  const push = tok => { line.push(tok); str += tok; };

  // 单个 token 比整行还宽（如超长英文单词）：按字符拆，最后一段留作当前行。
  const splitLong = tok => {
    for (const ch of tok) {
      if (line.length && !fits(str + ch)) { emit(line); setLine([]); }
      push(ch);
    }
  };

  // tok 放不下当前（非空）行：输出行首，保留行尾，调用方再重试 tok。每次至少让当前行变短一个 token。
  const breakLine = tok => {
    let trailingSpace = false;
    while (isSpace(line[line.length - 1])) { line.pop(); trailingSpace = true; }
    str = line.join('');

    // 行尾本来就是空格：这就是自然的断点，空格丢掉
    if (trailingSpace) { emit(line); setLine([]); return; }

    // 1. 行里有空格且最后一个空格在行宽 40% 之后：按词组在那里断开，空格丢掉，其后的部分接到下一行
    let sp = line.length - 1;
    while (sp > 0 && !isSpace(line[sp])) sp--;
    if (sp > 0 && measure(line.slice(0, sp).join('')) > PHRASE_BREAK_MIN * measure(str)) {
      emit(line.slice(0, sp));
      setLine(line.slice(sp + 1));
      return;
    }

    // 2./3. 禁则：断点 i 把 line[0..i) 留在本行，line[i..] 连同 tok 去下一行。
    //   - 下一行的第一个 token 属于 NO_START：把本行最后一个 token 一起带下去（追い出し）
    //   - 本行最后一个 token 属于 NO_END：把它移到下一行
    //   本行至少保留一个 token；两条规则可能连锁（如「…。」），所以循环到稳定为止。
    //   整行只有一个长词时没有整词可带，退回到按字符带下去。
    if (line.length === 1) line = Array.from(line[0]);
    let i = line.length;
    for (let moved = true; moved;) {
      moved = false;
      const nextFirst = i < line.length ? line[i] : tok;
      if (i > 1 && NO_START.has(nextFirst)) { i--; moved = true; }
      if (i > 1 && NO_END.has(line[i - 1])) { i--; moved = true; }
    }
    emit(line.slice(0, i));
    setLine(line.slice(i));
  };

  const place = tok => {
    for (;;) {
      if (isSpace(tok)) {
        if (!line.length) return;                              // 行首空格丢掉
        if (fits(str + tok)) push(tok); else { emit(line); setLine([]); }   // 放不下的空格就是断点
        return;
      }
      if (fits(str + tok)) { push(tok); return; }
      if (!line.length) { splitLong(tok); return; }
      breakLine(tok);
    }
  };

  tokens.forEach(place);
  emit(line);
  return lines;
}

const charCount = s => Array.from(s).length;

/**
 * 折一个段落。结果 ≥ 2 行且最后一行 ≤ 2 个字符时（孤字），
 * 在 [maxWidth×0.5, maxWidth] 里二分出仍能保持同样行数的最小宽度，按它重排一次。
 */
function wrapParagraph(measure, text, maxWidth) {
  const tokens = tokenize(text);
  const lines = layout(measure, tokens, maxWidth);
  const count = lines.length;
  if (count < 2 || charCount(lines[count - 1]) > 2) return lines;

  let lo = maxWidth * 0.5, hi = maxWidth, best = lines;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    const trial = layout(measure, tokens, mid);
    if (trial.length === count) { hi = mid; best = trial; } else lo = mid;
  }
  return best;
}

/**
 * 把 text 折成宽度不超过 maxWidth 的若干行。
 * measure(s) 返回字符串 s 的宽度。`\n` 是硬换行，每段单独折行；空段落不产生行；每行首尾空白已去掉。
 */
export function wrap(measure, text, maxWidth) {
  return String(text ?? '')
    .split(/\r\n|\r|\n/)
    .flatMap(paragraph => wrapParagraph(measure, paragraph, maxWidth));
}

/* ------------------------------------------------------------------ */
/* 带注音的折行                                                        */
/* ------------------------------------------------------------------ */

// 每个注音段落在折行时换成一个私用区字符：它是一个 token，不会被拆开，禁则和防孤字照常生效。
const SLOT = 0xF0000;                       // 补充私用区 A
const SLOT_RE = /[\u{F0000}-\u{FFFFD}]/gu;

/**
 * 折带注音的文本。segs 来自 parseRuby：[{ t }] 是普通文本，[{ b, r }] 是注音段落。
 * measure(s) 量普通文本；rubyWidth(seg, before, after) 是一个注音段落在这一行里占的宽度，
 * before / after 是它左右相邻的那个字符（在行首/行尾时是 ''，相邻的是另一个注音段落时是 null），
 * 用来决定注音能不能探出到旁边的假名上方。
 * 返回若干行，每行是一个段落数组；没有注音段落时结果和 wrap() 完全一样（每行是 [{ t }]）。
 */
export function wrapRuby(measure, segs, maxWidth, rubyWidth) {
  const groups = [];
  let text = '';
  for (const s of segs) {
    if (s.r === undefined) { text += String(s.t ?? '').replace(SLOT_RE, ''); continue; }
    text += String.fromCodePoint(SLOT + groups.length);
    groups.push(s);
  }
  const groupAt = cp => (cp >= SLOT && cp < SLOT + groups.length ? groups[cp - SLOT] : null);

  // 相邻字符：行首行尾是 ''，相邻的是另一个注音段落时是 null
  const neighbor = ch => (ch === undefined ? '' : groupAt(ch.codePointAt(0)) ? null : ch);
  const measureMixed = s => {
    const chars = Array.from(s);
    let w = 0, run = '';
    chars.forEach((ch, i) => {
      const g = groupAt(ch.codePointAt(0));
      if (!g) { run += ch; return; }
      if (run) { w += measure(run); run = ''; }
      w += rubyWidth(g, neighbor(chars[i - 1]), neighbor(chars[i + 1]));
    });
    return run ? w + measure(run) : w;
  };

  const toSegs = line => {
    const out = [];
    let run = '';
    for (const ch of line) {
      const g = groupAt(ch.codePointAt(0));
      if (!g) { run += ch; continue; }
      if (run) { out.push({ t: run }); run = ''; }
      out.push(g);
    }
    if (run) out.push({ t: run });
    return out;
  };

  return wrap(groups.length ? measureMixed : measure, text, maxWidth).map(toSegs);
}
