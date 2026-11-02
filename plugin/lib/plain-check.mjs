// やさしい日本語の機械的な検査。1文の長さと、説明のない専門用語を数える。
// 評価の採点器と、Editor への直しの依頼の両方で使う。

export const SENTENCE_LIMIT = 50;

// 非 IT 向けの文章で、説明なしに使ってはいけない語（用語集に載せれば使える）
export const JARGON = [
  'NAS', 'UTM', 'RAID', 'DNS', 'DHCP', 'VPN', 'AP',
  'ルーター', 'ゲートウェイ', 'ネットワークドライブ', 'スイッチ', 'サーバー', 'ドメイン', 'バックアップ',
  '多要素認証', 'ファームウェア',
];

export const sentences = (text) =>
  text
    .split(/(?<=[。！？!?])|\n/u)
    .map((s) => s.trim())
    .filter(Boolean);

export const longSentences = (text) => sentences(text).filter((s) => [...s].length > SENTENCE_LIMIT);

/** 語が使われているかどうか。英字の語は単語の境界で判定する（AP が APP に当たらないように）。 */
export function usesTerm(text, term) {
  if (/^[A-Za-z]+$/.test(term)) return new RegExp(`(?<![A-Za-z])${term}(?![A-Za-z])`).test(text);
  return text.includes(term);
}

/** 取扱説明書全体の問題の一覧を返す。 */
export function plainProblems(manual) {
  const glossary = new Set(manual.glossary.map((entry) => entry.term));
  const long = manual.statements.flatMap((statement) =>
    longSentences(statement.text).map((sentence) => ({ id: statement.id, sentence })),
  );
  const terms = JARGON.filter((term) => !glossary.has(term) && manual.statements.some((s) => usesTerm(s.text, term)));
  return { long_sentences: long, unexplained_terms: terms };
}
