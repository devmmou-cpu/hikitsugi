// 普段の言葉で症状を探す照合。通信せず、端末の中だけで動く。
// 取扱説明書の HTML にも同じ処理を埋め込むので、import を使わず、外の変数に頼らない形にする。

/** ひらがなとカタカナ、全角と半角、大文字と小文字をそろえ、空白と記号と長音を外す。 */
export function normalizeText(text) {
  return String(text)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s\u30fc\-_.,、。・!?！？「」『』()（）[\]【】〜~:：;；/\\'"’”]/g, '');
}

const UNKNOWN_WEIGHT = 2;

/** 文字の並びの近さを測るための、2文字ずつの組。1文字の語はそのまま使う。 */
export function charPairs(text) {
  if (text.length < 2) return text ? [text] : [];
  const pairs = [];
  for (let i = 0; i < text.length - 1; i += 1) pairs.push(text.slice(i, i + 2));
  return pairs;
}

/**
 * 索引を探しやすい形にする。多くの症状に出る文字の組は、見分ける力が弱いので軽くする。
 * @param index { page, title, phrases }[]
 */
export function buildSearch(index) {
  const entries = index.map(({ page, title, phrases }) => {
    const list = [title, ...phrases].map(normalizeText).filter(Boolean).map((text) => ({ text, pairs: [...new Set(charPairs(text))] }));
    return { page, phrases: list, all: new Set(list.flatMap((phrase) => phrase.pairs)) };
  });
  const seenIn = new Map();
  for (const entry of entries) for (const pair of entry.all) seenIn.set(pair, (seenIn.get(pair) ?? 0) + 1);
  const count = entries.length;
  // 索引にない文字の組も数える。数えないと、関係のない入力が少しの一致で高い点になる
  const weightOf = (pair) => {
    const seen = seenIn.get(pair) ?? 0;
    return seen ? Math.log(1 + count / seen) ** 2 : UNKNOWN_WEIGHT;
  };
  return { entries, weightOf };
}

const sumOf = (pairs, weightOf) => pairs.reduce((sum, pair) => sum + weightOf(pair), 0);

/** 1つの言い方が、入力の中にどれだけ現れているか。0〜1。短い言い方の偶然の一致で上がりすぎないようにする。 */
function phraseFit(querySet, phrase, weightOf) {
  const shared = phrase.pairs.filter((pair) => querySet.has(pair));
  if (!shared.length) return 0;
  const inPhrase = sumOf(shared, weightOf) / (sumOf(phrase.pairs, weightOf) || 1);
  return inPhrase * Math.min(1, shared.length / 3);
}

/**
 * 入力に近い症状を、近い順に返す。どれも遠ければ空の配列。
 * 長い入力でも探せるように、入力の文字の組が症状の言い方全体にどれだけあるかと、
 * いちばん近い1つの言い方が入力にどれだけ現れているかを合わせて点数にする。
 * @returns { page, score }[]
 */
export function searchPages(search, input, limit = 3, threshold = 0.25) {
  const pairs = [...new Set(charPairs(normalizeText(input)))];
  const known = sumOf(pairs, search.weightOf);
  if (!known) return [];
  const querySet = new Set(pairs);
  const results = search.entries.map(({ page, phrases, all }) => {
    const covered = sumOf(pairs.filter((pair) => all.has(pair)), search.weightOf) / known;
    const best = phrases.reduce((top, phrase) => Math.max(top, phraseFit(querySet, phrase, search.weightOf)), 0);
    return { page, score: covered * 0.5 + best * 0.5 };
  });
  return results.filter((result) => result.score >= threshold).sort((a, b) => b.score - a.score || (a.page < b.page ? -1 : 1)).slice(0, limit);
}
