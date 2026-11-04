// 聞き取り記録の操作。ID の採番と、記録してはいけない内容の確認はプログラムが行う。
// /hikitsugi:start と評価の両方で使う。

import { readFileSync } from 'node:fs';

export const QUESTION_LIMIT = 20;
export const REVIEW_GAP = 'GAP-000';
export const REVIEW_ITEM = 'CHK-00';
export const QUESTION_CHARS = 150;
// 同じ項目を聞くのは2回まで。答えが得られない項目で、質問を使い切らないため
const MAX_ASKS_PER_ITEM = 2;
const PRIORITY_RANK = { high: 0, mid: 1, low: 2 };
// 聞き直しは、障害のときに行き止まりになる項目を先にする。業者の連絡先、機器の置き場所、定期作業の入口、そのほかの順
const FOLLOWUP_RANK = { 連絡先: 0, 置き場所: 1, 定期作業: 2 };
const followupOf = new Map(JSON.parse(readFileSync(new URL('../checklist/handover-items.json', import.meta.url), 'utf8')).items.map((item) => [item.id, item.followup]));
const followupRank = (item) => FOLLOWUP_RANK[followupOf.get(item)] ?? 3;

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

/** 申告された未回収の項目のうち、次に聞き直す項目を返す。 */
function reviewTarget(next, gaps, transcript) {
  const unfilled = new Set(next.unfilled ?? []);
  return reviewCandidates(gaps, transcript).find(({ item }) => unfilled.has(item))?.item ?? null;
}

/**
 * 聞き直してよい項目を、聞く順に返す。行き止まりになる項目を先にし、同じ区分の中では空白の重要度の順。
 * 「分からない」「あとで」と答えた項目と、すでに2回聞いた項目は含めない。埋まったかどうかは Interviewer が記録を読んで判断する。
 */
export function reviewCandidates(gaps, transcript) {
  const entries = transcript.entries;
  const order = gaps.gaps
    .map((gap, index) => ({ gap, index }))
    .sort((a, b) => (PRIORITY_RANK[a.gap.priority] ?? 3) - (PRIORITY_RANK[b.gap.priority] ?? 3) || a.index - b.index);
  const seen = new Set();
  const candidates = [];
  for (const { gap } of order) {
    for (const item of gap.items) {
      if (seen.has(item)) continue;
      seen.add(item);
      const asked = entries.filter((entry) => entry.covers.includes(item));
      if (asked.length >= MAX_ASKS_PER_ITEM || asked.some((entry) => entry.status !== 'answered')) continue;
      candidates.push({ item, gap: gap.id, priority: gap.priority, asked: asked.length });
    }
  }
  // 並べ替えは安定なので、同じ区分の中は上の順番のまま
  return candidates.sort((a, b) => followupRank(a.item) - followupRank(b.item));
}

/** Interviewer に渡す進み具合。聞き直しの段階では、聞き直してよい項目を重要度の順に示す。 */
export function interviewProgress(gaps, transcript) {
  const unasked = unaskedItems(gaps, transcript);
  const asked = transcript.entries.length;
  return {
    asked,
    remaining: QUESTION_LIMIT - asked,
    stage: unasked.length ? 'first_pass' : 'review',
    unasked_items: unasked,
    review_candidates: unasked.length ? [] : reviewCandidates(gaps, transcript),
  };
}

/**
 * 次の質問が記録できる形かを確かめる。問題の一覧を返す。
 * @param transcript 指定があれば、聞いていない項目を残して終えようとしていないかも確かめる
 */
export function checkNextQuestion(next, gaps, transcript) {
  if (next.action !== 'ask') {
    if (!transcript || transcript.entries.length >= QUESTION_LIMIT) return [];
    const unasked = unaskedItems(gaps, transcript);
    if (unasked.length) return [`まだ聞いていない項目があるので、終えられません：${unasked.join('、')}`];
    const target = reviewTarget(next, gaps, transcript);
    return target ? [`質問が余っていて未回収の項目があるので、終えられません：${target} を聞き直してください`] : [];
  }
  const problems = [];
  const known = new Set(gaps.gaps.map((gap) => gap.id));
  const items = new Set(gaps.coverage.map((entry) => entry.item));
  if (!known.has(next.gap)) problems.push(`存在しない空白です: ${next.gap}`);
  if (!next.question.trim()) problems.push('質問が空です');
  problems.push(...questionProblems(next.question));
  if (next.covers.length === 0) problems.push('埋める項目がありません');
  for (const item of next.covers) if (!items.has(item)) problems.push(`存在しない必須項目です: ${item}`);
  // 全部聞き終えたあとは聞き直しの段階。未回収の項目を、重要度の高いものから聞く
  if (transcript && unaskedItems(gaps, transcript).length === 0) {
    const target = reviewTarget(next, gaps, transcript);
    if (!target) problems.push('聞き直せる未回収の項目がありません。unfilled に項目を挙げるか、終えてください');
    else if (!next.covers.includes(target)) problems.push(`未回収の項目は、決まった順番（業者の連絡先、機器の置き場所、定期作業の入口、そのほか）で聞いてください：${target} を covers に入れます`);
  }
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
export function appendReviewEntry(transcript, { pageId, title, comment, answeredAt, question }) {
  if (!comment.trim()) throw new Error('直す内容が空です');
  if (hasCredential(comment)) throw new Error('回答にパスワードの本体が含まれています。保管場所だけを記録してください');
  // manual.json から戻した記録は番号が飛ぶので、数ではなく最大の番号から続ける
  const number = String(Math.max(0, ...transcript.entries.map((item) => Number(item.id.slice(4)))) + 1).padStart(3, '0');
  const entry = {
    id: `INT-${number}`,
    gap: REVIEW_GAP,
    covers: [REVIEW_ITEM],
    question: question ?? `手順ページ ${pageId}「${title}」について、直すところを教えてください。`,
    answer: comment.trim(),
    status: 'answered',
    answered_at: answeredAt,
  };
  return { transcript: { ...transcript, entries: [...transcript.entries, entry] }, entry };
}

/** 文の根拠のうち、聞き取りの記録にない INT を返す。 */
export function missingInterviewEvidence(manual, transcript) {
  const known = new Set(transcript.entries.map((entry) => entry.id));
  return [...new Set(manual.statements.flatMap((statement) => statement.evidence ?? []).filter((id) => id.startsWith('INT-') && !known.has(id)))];
}

