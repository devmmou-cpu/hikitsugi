// 取扱説明書の中身の採点。根拠、1文の長さ、用語、認証情報を機械的に確かめる。

const SENTENCE_LIMIT = 50;

// 非 IT 向けの文章で、説明なしに使ってはいけない語（用語集に載せれば使える）
const JARGON = [
  'NAS', 'UTM', 'RAID', 'DNS', 'DHCP', 'VPN', 'AP',
  'ルーター', 'ゲートウェイ', 'ネットワークドライブ', 'スイッチ', 'サーバー', 'ドメイン', 'バックアップ',
  '多要素認証', 'ファームウェア',
];

const CREDENTIAL = /(?:パスワード|暗証番号|認証コード|password|passcode)(?:は|:|：|=|＝)\s*[「"']?[!-~]{4,}/iu;

const sentences = (text) =>
  text
    .split(/(?<=[。！？!?])|\n/u)
    .map((s) => s.trim())
    .filter(Boolean);

/** 語が使われているかどうか。英字の語は単語の境界で判定する（AP が APP に当たらないように）。 */
function usesTerm(text, term) {
  if (/^[A-Za-z]+$/.test(term)) return new RegExp(`(?<![A-Za-z])${term}(?![A-Za-z])`).test(text);
  return text.includes(term);
}

/** 画面側から参照している STM-ID をすべて集める。 */
function referencedStatements(manual) {
  const refs = [];
  const visit = (value) => {
    if (typeof value === 'string' && /^STM-\d{3}$/.test(value)) refs.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  const { statements, ...screens } = manual;
  visit(screens);
  return refs;
}

export function score(output, _answers, context) {
  const inv = new Map(context.survey.items.map((item) => [item.id, item]));
  const int = new Map(context.transcript.entries.map((entry) => [entry.id, entry]));
  const glossary = new Set(output.glossary.map((g) => g.term));

  const seen = new Set();
  const rows = output.statements.map((statement) => {
    if (seen.has(statement.id)) throw new Error(`記述の ID が重複しています: ${statement.id}`);
    seen.add(statement.id);
    const badEvidence = statement.evidence.filter((ref) => {
      if (ref.startsWith('INV-')) return inv.get(ref)?.status !== 'ok';
      if (ref.startsWith('INT-')) return int.get(ref)?.status !== 'answered';
      // 公開資料の ID はまだ使わない
      return true;
    });
    return {
      statement: statement.id,
      bad_evidence: badEvidence,
      long_sentences: sentences(statement.text).filter((s) => [...s].length > SENTENCE_LIMIT).length,
      unexplained_terms: JARGON.filter((term) => usesTerm(statement.text, term) && !glossary.has(term)),
      credential: CREDENTIAL.test(statement.text),
    };
  });

  const refs = referencedStatements(output);
  const dangling = refs.filter((ref) => !seen.has(ref));
  if (dangling.length) throw new Error(`存在しない記述を参照しています: ${[...new Set(dangling)].join(', ')}`);
  return rows;
}

export function summarize(rows) {
  const unexplained = [...new Set(rows.flatMap((r) => r.unexplained_terms))];
  return {
    statements: rows.length,
    bad_evidence: rows.filter((r) => r.bad_evidence.length > 0).map((r) => r.statement),
    long_sentences: rows.reduce((sum, r) => sum + r.long_sentences, 0),
    unexplained_terms: unexplained,
    credentials: rows.filter((r) => r.credential).map((r) => r.statement),
    complete: true,
    targets: { bad_evidence_max: 0, long_sentences_max: 0, unexplained_terms_max: 0, credentials_max: 0 },
  };
}
