// 症状ページの抜けの検査。困りごとを聞いて答えがあったのに、手順ページがないものを挙げる。
// 語の照合の概算なので、関係のないものも混ざる。挙がったものは Writer が「ページにする」か「理由を付けて外す」かを1回だけ答える。
// /hikitsugi:start と評価の両方で使う。

import { hasCredential } from './transcript.mjs';

// 困りごと（症状、故障、対応先）を聞く項目
const TROUBLE_ITEMS = new Set(['CHK-02', 'CHK-04', 'CHK-09', 'CHK-14', 'CHK-15', 'CHK-18', 'CHK-22', 'CHK-27', 'CHK-32', 'CHK-33', 'CHK-37', 'CHK-38']);
// 困りごとか対応先の文の言い方
const TROUBLE_SIGN = /(?:ときは|ときも|たら[、,]|なければ|ことがあり|故障|壊れ|止ま|つながら|見えな|届か|開け|開か|動か|切れ|失敗|満杯|エラー|(?:に|へ|で)(?:頼み|任せ|連絡し|電話し|相談し|依頼し))/;
// 入退社と定期作業の文。困りごとではない
const NOT_TROUBLE = /入社|退職|毎週|毎月|毎年|更新し|定期/;
// どの困りごとでも使う語。これだけ一致しても、同じ話とは言えない
const COMMON_WORDS = new Set(['連絡', '連絡先', '電話', '相談', '依頼', '窓口', '対応', '故障', '障害', '担当', '担当者', '受付', '自分', '本社', '社員', '調子', '時間', '半日', '昨年', '去年']);

const compact = (text) => text.normalize('NFKC').replace(/\s+/g, '');

/** 文の話題の語。カタカナ、漢字、英字のまとまりから、連絡先の名前とどこにでも出る語を除く。 */
export function topicWords(sentence, names) {
  let text = sentence.normalize('NFKC');
  for (const name of names) text = text.replaceAll(name, '');
  const words = text.match(/[A-Za-z][A-Za-z0-9-]+|[ァ-ヶー]{2,}|[一-龠々]{2,}/g) ?? [];
  return [...new Set(words)].filter((word) => !COMMON_WORDS.has(word));
}

/**
 * 手順ページのない困りごとの一覧を返す。
 * 題名に同じ語があるページは、同じ話として数える。機器の欄や本文に書いてあっても、後任は症状から探すので数えない。
 * @returns { id, sources, detail }[]
 */
export function symptomGaps(manual, transcript, retiree = '') {
  const text = new Map(manual.statements.map((statement) => [statement.id, statement.text]));
  const titles = manual.symptom_pages.map((page) => compact(text.get(page.title) ?? ''));
  const names = [...manual.contacts.map((contact) => contact.name), retiree.replace(/さん$/, '')].filter(Boolean);
  const answered = transcript.entries.filter((entry) => entry.status === 'answered');
  const found = new Map();
  for (const entry of answered) {
    if (!entry.covers.some((item) => TROUBLE_ITEMS.has(item))) continue;
    // 主語が前の文にある短い文は、前の文の語で照合する
    let topic = [];
    for (const raw of entry.answer.split('。')) {
      const sentence = raw.trim();
      if (!sentence) continue;
      const own = topicWords(sentence, names);
      if (own.length) topic = own;
      if (!TROUBLE_SIGN.test(sentence) || NOT_TROUBLE.test(sentence) || !topic.length) continue;
      if (topic.some((word) => titles.some((title) => title.includes(word)))) continue;
      found.set(compact(sentence), sentence);
    }
  }
  return [...found].map(([key, detail], index) => ({
    id: `SYM-${index + 1}`,
    sources: answered.filter((entry) => compact(entry.answer).includes(key)).map((entry) => entry.id),
    detail,
  }));
}

/** 外す理由に書かれた、今あるページの ID。 */
const receivingPages = (reason, plan) => [...new Set(reason.normalize('NFKC').match(/T\d+/g) ?? [])].filter((id) => plan.some((entry) => entry.id === id));

const nextPageNumber = (plan) => Math.max(0, ...plan.map((entry) => Number(entry.id.slice(1)))) + 1;

/**
 * Writer の答えを確かめて、足すページと外す理由に分ける。
 * 同じ symptom の件は1ページにまとめる。
 * 外す理由にページの ID があれば、受け皿のページとして残す。普段の言い方の索引に、その症状の言い方を足すため。
 * @returns { problems, additions: { id, category, symptom, sources, detail }[], exclusions: { source, detail, reason, pages }[] }
 */
export function applySymptomAnswer(output, gaps, plan) {
  const problems = [];
  const byGap = new Map(output.decisions.map((decision) => [decision.gap, decision]));
  for (const decision of output.decisions) if (!gaps.some((gap) => gap.id === decision.gap)) problems.push(`一覧にない件です：${decision.gap}`);
  const additions = [];
  const exclusions = [];
  let number = nextPageNumber(plan);
  for (const gap of gaps) {
    const decision = byGap.get(gap.id);
    if (!decision) {
      problems.push(`${gap.id} の答えがありません`);
    } else if (decision.decision === 'exclude') {
      if (!decision.reason?.trim()) problems.push(`${gap.id}：外す理由を書いてください`);
      else if (hasCredential(decision.reason)) problems.push(`${gap.id}：認証情報の本体を書かないでください`);
      else exclusions.push({ source: gap.sources[0], detail: gap.detail, reason: decision.reason.trim(), pages: receivingPages(decision.reason, plan) });
    } else if (!decision.symptom?.trim() || !decision.category) {
      problems.push(`${gap.id}：ページにするときは symptom と category を書いてください`);
    } else {
      const same = additions.find((addition) => addition.symptom === decision.symptom.trim());
      if (same) {
        same.sources = [...new Set([...same.sources, ...gap.sources])];
        same.detail = `${same.detail}。${gap.detail}`;
      } else {
        additions.push({ id: `T${number}`, category: decision.category, symptom: decision.symptom.trim(), sources: gap.sources, detail: gap.detail });
        number += 1;
      }
    }
  }
  return { problems, additions, exclusions };
}

/** 新しいページが、挙がった答えを根拠にしているか。一覧に足したのにページがない件も問題にする。 */
export function additionProblems(manual, additions) {
  const problems = [];
  for (const addition of additions) {
    const page = manual.symptom_pages.find((candidate) => candidate.id === addition.id);
    if (!page) problems.push(`${addition.id}（${addition.symptom}）のページがありません`);
  }
  return problems;
}

/** ページの文章の根拠に、挙がった答えが入っているか。 */
export function basisProblems(statements, addition) {
  const cited = new Set(statements.flatMap((statement) => statement.evidence));
  return addition.sources.some((source) => cited.has(source)) ? [] : [`${addition.id}：このページの根拠に ${addition.sources.join(' か ')} を入れてください`];
}
