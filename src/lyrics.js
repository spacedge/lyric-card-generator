// 歌词解析：去掉 LRC 时间轴/元数据，按三种模式把文本分成 [{ o, t }]（原文 / 译文）。
// 纯逻辑模块，无依赖。

// [mm:ss.xx] [mm:ss:xx] [mm:ss] [hh:mm:ss] 这类时间标签
const TIMESTAMP = /\[\s*\d{1,3}\s*:\s*\d{1,2}(?:\s*[.:]\s*\d{1,3})?\s*\]/g;
// 增强型 LRC 的逐字时间标签 <mm:ss.xx>
const WORD_TIMESTAMP = /<\s*\d{1,3}\s*:\s*\d{1,2}(?:\s*[.:]\s*\d{1,3})?\s*>/g;
// [ti:..] [ar:..] [al:..] [by:..] [offset:..] 等元数据标签：字母键名 + 冒号
const META_TAG = /\[\s*[A-Za-z]{1,12}\s*:[^\]]*\]/g;

/**
 * 去掉一行里所有 LRC 时间标签和元数据标签，并去掉首尾空白。
 * 不带冒号的方括号（如 `[Chorus]`）不是 LRC 标签，原样保留。
 */
export function stripLrc(line) {
  return String(line)
    .replace(TIMESTAMP, '')
    .replace(WORD_TIMESTAMP, '')
    .replace(META_TAG, '')
    .trim();
}

/**
 * 清洗成一组行：每行去标签、连续空白折成一个半角空格；空行用 '' 保留（作为段落分隔），
 * 但原本有内容、去掉标签后什么都不剩的行（纯元数据/纯时间轴）直接丢弃，不当作分隔。
 */
function cleanLines(raw) {
  const lines = [];
  for (const src of String(raw ?? '').replace(/^﻿/, '').split(/\r\n|\r|\n/)) {
    const stripped = stripLrc(src);
    if (!stripped && src.trim()) continue;
    lines.push(stripped.replace(/\s+/g, ' '));
  }
  return lines;
}

/** 按空行把行分成若干段，忽略首尾和连续的空行。 */
function splitBlocks(lines) {
  const blocks = [];
  let current = [];
  for (const line of lines) {
    if (line) {
      current.push(line);
    } else if (current.length) {
      blocks.push(current);
      current = [];
    }
  }
  if (current.length) blocks.push(current);
  return blocks;
}

/** 一段里的行 → 一组：1 行只有原文；偶数行前一半原文后一半译文；奇数行第一行原文其余译文。 */
function blockToGroup(block) {
  const n = block.length;
  if (n === 1) return { o: block[0], t: '' };
  const split = n % 2 === 0 ? n / 2 : 1;
  return { o: block.slice(0, split).join('\n'), t: block.slice(split).join('\n') };
}

/**
 * 把歌词文本解析成 [{ o, t }]。
 * - 'bilingual'（默认）：去空行后两行一组，第二行是译文；最后落单的一行译文为空。
 * - 'blocks'：空行分段，见 blockToGroup。
 * - 'single'：每个非空行一组，译文为空。
 * 无法识别的 mode 按 'bilingual' 处理；输入为空返回 []。
 */
export function parseLyrics(raw, mode = 'bilingual') {
  const lines = cleanLines(raw);

  if (mode === 'blocks') return splitBlocks(lines).map(blockToGroup);

  const filled = lines.filter(Boolean);
  if (mode === 'single') return filled.map(o => ({ o, t: '' }));

  const groups = [];
  for (let i = 0; i < filled.length; i += 2) groups.push({ o: filled[i], t: filled[i + 1] ?? '' });
  return groups;
}
