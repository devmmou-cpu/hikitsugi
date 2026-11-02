// 聞き取り記録の操作。ID の採番と、記録してはいけない内容の確認はプログラムが行う。
// /hikitsugi:start と評価の両方で使う。

export const QUESTION_LIMIT = 20;
export const REVIEW_GAP = 'GAP-000';
export const REVIEW_ITEM = 'CHK-00';
export const QUESTION_CHARS = 150;

// パスワードや認証情報の本体を書いた形。保管場所の文には当たらない。
const CREDENTIAL = /(?:パスワード|暗証番号|認証コード|password|passcode)(?:は|:|：|=|＝)\s*[「"']?[!-~]{4,}/iu;

export const hasCredential = (text) => CREDENTIAL.test(text);

export const emptyTranscript = (company) => ({ schema_version: 1, company, entries: [] });

// モデルの出力が暴走すると、質問文の中にデータの形や繰り返しの文が混ざる
const BROKEN_QUESTION = /['"][A-Za-z_]+['"]\s*:/;

/** 質問文として不自然なところの一覧を返す。 */
export function questionProblems(question) {
  const problems = [];
  if ([...question].length > QUESTION_CHARS) problems.push(`質問が長すぎます（${[...question].length} 字、上限 ${QUESTION_CHARS} 字）`);
  if (BROKEN_QUESTION.test(question)) problems.push('質問の中にデータの形が混ざっています');
  return problems;
}

/** まだ1度も聞いていない必須項目を返す。回答が「分からない」でも、聞いたものとして数える。 */
export function unaskedItems(gaps, transcript) {
  const asked = new Set(transcript.entries.flatMap((entry) => entry.covers));
  return gaps.gaps.flatMap((gap) => gap.items).filter((item) => !asked.has(item));
}

/**
 * 次の質問が記録できる形かを確かめる。問題の一覧を返す。
 * @param transcript 指定があれば、聞いていない項目を残して終えようとしていないかも確かめる
 */
export function checkNextQuestion(next, gaps, transcript) {
  if (next.action !== 'ask') {
    if (!transcript || transcript.entries.length >= QUESTION_LIMIT) return [];
    const unasked = unaskedItems(gaps, transcript);
    return unasked.length ? [`まだ聞いていない項目があるので、終えられません：${unasked.join('、')}`] : [];
  }
  const problems = [];
  const known = new Set(gaps.gaps.map((gap) => gap.id));
  const items = new Set(gaps.coverage.map((entry) => entry.item));
  if (!known.has(next.gap)) problems.push(`存在しない空白です: ${next.gap}`);
  if (!next.question.trim()) problems.push('質問が空です');
  problems.push(...questionProblems(next.question));
  if (next.covers.length === 0) problems.push('埋める項目がありません');
  for (const item of next.covers) if (!items.has(item)) problems.push(`存在しない必須項目です: ${item}`);
  return problems;
}

/** 質問と回答を1件追加した、新しい記録を返す。パスワードの本体は記録しない。 */
export function appendEntry(transcript, { next, answer, status, answeredAt }) {
  if (transcript.entries.length >= QUESTION_LIMIT) throw new Error(`質問は ${QUESTION_LIMIT} 問までです`);
  if (hasCredential(answer)) {
    throw new Error('回答にパスワードの本体が含まれています。保管場所だけを記録してください');
  }
  const number = String(transcript.entries.length + 1).padStart(3, '0');
  return {
    ...transcript,
    entries: [
      ...transcript.entries,
      {
        id: `INT-${number}`,
        gap: next.gap,
        covers: [...new Set(next.covers)].sort(),
        question: next.question,
        answer,
        status,
        answered_at: answeredAt,
      },
    ],
  };
}

/**
 * 前任者の確認で出た直しを、聞き取りの記録に足す。質問の上限は数えない。
 * 空白や必須項目には対応しないので、予約の番号を入れる。
 */
export function appendReviewEntry(transcript, { pageId, title, comment, answeredAt }) {
  if (!comment.trim()) throw new Error('直す内容が空です');
  if (hasCredential(comment)) throw new Error('回答にパスワードの本体が含まれています。保管場所だけを記録してください');
  const number = String(transcript.entries.length + 1).padStart(3, '0');
  const entry = {
    id: `INT-${number}`,
    gap: REVIEW_GAP,
    covers: [REVIEW_ITEM],
    question: `手順ページ ${pageId}「${title}」について、直すところを教えてください。`,
    answer: comment.trim(),
    status: 'answered',
    answered_at: answeredAt,
  };
  return { transcript: { ...transcript, entries: [...transcript.entries, entry] }, entry };
}
