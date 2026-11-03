// 症状ごとの「普段の言い方」の検査と、取扱説明書への組み込み。/hikitsugi:start と評価の両方で使う。

import { hasCredential } from './transcript.mjs';

export const PHRASES_MIN = 15;
export const PHRASES_MAX = 30;
const PHRASE_CHARS_MAX = 60;

/** Writer に渡す症状の一覧。題名と判定の文と、最初の操作だけで十分なので、会社の値は渡さない。 */
export function pagesForPhrases(manual) {
  const text = new Map(manual.statements.map((statement) => [statement.id, statement.text]));
  return manual.symptom_pages.map((page) => ({
    id: page.id,
    title: text.get(page.title),
    what_to_do: text.get(page.badge.statement),
    first_steps: page.first_steps.map((id) => text.get(id)),
  }));
}

/** 言い方の問題の一覧。索引は検証の対象ではないので、出してはいけないものをプログラムで止める。 */
export function phraseProblems(output, manual, retiree) {
  const problems = [];
  const name = retiree?.trim().replace(/(さん|様|氏)$/, '').split(/\s+/)[0];
  const given = new Map(output.pages.map((entry) => [entry.id, entry.phrases]));
  for (const page of manual.symptom_pages) {
    const phrases = given.get(page.id);
    if (!phrases) {
      problems.push(`${page.id}: 言い方がありません`);
      continue;
    }
    const unique = new Set(phrases.map((phrase) => phrase.trim()));
    if (unique.size < PHRASES_MIN || unique.size > PHRASES_MAX) problems.push(`${page.id}: 言い方は重ならずに ${PHRASES_MIN}〜${PHRASES_MAX} 件です（今は ${unique.size} 件）`);
    for (const phrase of phrases) {
      if ([...phrase].length > PHRASE_CHARS_MAX) problems.push(`${page.id}: ${PHRASE_CHARS_MAX}字を超える言い方があります`);
      if (name && phrase.includes(name)) problems.push(`${page.id}: 退職する担当者の名前を書かないでください`);
      if (hasCredential(phrase)) problems.push(`${page.id}: 認証情報らしい値があります`);
      if (/0\d{1,4}-\d{1,4}-\d{3,4}|[a-z0-9-]+\.[a-z]{2,}/i.test(phrase)) problems.push(`${page.id}: 電話番号やドメインを書かないでください`);
    }
  }
  for (const id of given.keys()) if (!manual.symptom_pages.some((page) => page.id === id)) problems.push(`存在しないページです: ${id}`);
  return problems;
}

/** 取扱説明書に索引を付ける。重なりは1つにする。 */
export function withSearchIndex(manual, output) {
  return {
    ...manual,
    search_index: output.pages.map(({ id, phrases }) => ({ page: id, phrases: [...new Set(phrases.map((phrase) => phrase.trim()))] })),
  };
}
