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

// 説明がなくても通じる語。docs/design/plain-words.md の §3-1 のうち、英字とカタカナの語。これ以外の英字の語とカタカナの語には説明を求める
const EVERYDAY_WORDS = new Set(['PC', 'パソコン', 'スマホ', 'キーボード', 'マウス', 'ケーブル', 'コンセント', 'プリンター', 'コピー', 'ボタン', 'クリック', 'ダブルクリック', 'メール', 'インターネット', 'ネット', 'Wi-Fi', 'ファイル', 'フォルダ', 'ソフト', 'アプリ', 'パスワード', 'スキャン', 'サイト', 'Windows', 'Microsoft', 'Teams', 'OneDrive', 'Outlook', 'Excel', 'PowerShell', 'BitLocker']);
const DEVICE_WORDS = /[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*|[\u30a1-\u30faー]{2,}/g;
// 大文字と数字をハイフンでつないだものは、機器の名前や型番なので語として扱わない
const IDENTIFIER = /^[A-Z0-9]+(?:-[A-Z0-9]+)+$/;

/** 機器の一覧（名前と用途）に出る語のうち、用語の説明がないもの。用語の中に含まれていれば説明があるものとする。 */
export function deviceTermProblems(manual) {
  const text = new Map(manual.statements.map((statement) => [statement.id, statement.text]));
  const terms = (manual.glossary ?? []).map((entry) => entry.term);
  const words = new Set();
  for (const device of manual.devices ?? []) {
    const shown = [device.name, device.purpose].map((id) => text.get(id) ?? '').join(' ');
    for (const [word] of shown.matchAll(DEVICE_WORDS)) if (!IDENTIFIER.test(word) && !EVERYDAY_WORDS.has(word)) words.add(word);
  }
  return [...words].filter((word) => !terms.some((term) => usesTerm(term, word)));
}

/** 一般の説明の文の問題。根拠の照合をしない文なので、書いてはいけないものをプログラムで止める。 */
export function plainTextProblem(text) {
  if (longSentences(text).length) return `${SENTENCE_LIMIT}字を超える文です`;
  if (/0\d{1,4}-\d{1,4}-\d{3,4}|[a-z0-9-]+\.[a-z]{2,}|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/i.test(text)) return '電話番号やアドレスは書けません';
  return null;
}

/** 取扱説明書全体の問題の一覧を返す。 */
export function plainProblems(manual) {
  const glossary = new Set(manual.glossary.map((entry) => entry.term));
  // 部品の文面は Editor が直せないので、直しの依頼に含めない
  const long = manual.statements.filter((statement) => !statement.library).flatMap((statement) =>
    longSentences(statement.text).map((sentence) => ({ id: statement.id, sentence })),
  );
  const terms = JARGON.filter((term) => !glossary.has(term) && manual.statements.some((s) => usesTerm(s.text, term)));
  return { long_sentences: long, unexplained_terms: [...new Set([...terms, ...deviceTermProblems(manual)])] };
}
