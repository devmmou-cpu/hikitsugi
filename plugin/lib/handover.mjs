// 取扱説明書を表示プログラムへ渡す前の処理。/hikitsugi:start と評価の両方で使う。

import { withoutPcNotes, withoutReplies, withReplies } from './reply.mjs';
import { loadLibrary, unapprovedParts } from './procedures.mjs';

/** 未承認の部品が使われているときの例外。 */
export class UnapprovedPartsError extends Error {
  constructor(parts) {
    super(`未承認の手順部品が使われているので、取扱説明書を作れません：${parts.join('、')}`);
    this.parts = parts;
  }
}

/** 表示プログラムへ渡す前の確認。本人が確認していない部品は、取扱説明書に出さない。 */
export function prepareForRender(manual, library = loadLibrary()) {
  const unapproved = unapprovedParts(manual, library);
  if (unapproved.length) throw new UnapprovedPartsError(unapproved);
  return { ...withCurrentParts(manual, library), omitted: { routines: 0, devices: 0, statements: 0 } };
}

/**
 * 保存した説明書の部品の文面を、いまの承認済みの文面にそろえ、社員に返す文と業者に伝える文をいまの型で組み直す。
 * 本人が部品の文面や文の型を決め直したあと、通しをやり直さずに古い文の説明書を作らないため。どちらも同じなら、何も変えない。
 */
export function withCurrentParts(manual, library = loadLibrary()) {
  const texts = new Map(library.procedures.map((part) => [part.id, part.text]));
  const isStale = (statement) => texts.has(statement.library) && statement.text !== texts.get(statement.library);
  const stale = manual.statements.filter(isStale);
  const statements = manual.statements.map((statement) => (isStale(statement) ? { ...statement, text: texts.get(statement.library) } : statement));
  const rebuilt = withReplies({ ...manual, statements }, library);
  const composed = (target) => {
    const byId = new Map(target.statements.map((statement) => [statement.id, statement.text]));
    return target.symptom_pages.map((page) => [byId.get(page.reply_to_staff), byId.get(page.fallback?.message)]);
  };
  const before = composed(manual);
  const after = composed(rebuilt);
  const rebuiltCount = after.flat().filter((text, index) => text !== before.flat()[index]).length;
  if (!stale.length && !rebuiltCount) return { manual, updatedParts: [], rebuiltCount: 0 };
  return { manual: rebuilt, updatedParts: [...new Set(stale.map((statement) => statement.library))].sort(), rebuiltCount };
}

/** 検証結果を判定ごとに数え、指摘の一覧を返す。 */
export function summarizeVerification(verification, manual) {
  const counts = { correct: 0, contradiction: 0, unsupported: 0, dangerous: 0 };
  for (const result of verification.results) counts[result.verdict] += 1;
  const judged = new Set(verification.results.map((result) => result.statement));
  const unanswered = manual.statements.filter((statement) => !judged.has(statement.id)).map((statement) => statement.id);
  const findings = verification.results.filter((result) => result.verdict !== 'correct');
  return { counts, findings, unanswered, passed: findings.length === 0 && unanswered.length === 0 };
}

/**
 * 差し戻しで Writer に渡す内容を作る。用語の説明は Editor が作り直すので、前の版から外す。
 * 残すと、説明の文章が参照されないまま残り、作り直した分だけ文章が増え続けるため。
 */
export function buildRevision(manual, findings) {
  const glossaryIds = new Set(manual.glossary.map((entry) => entry.company));
  // 社員に返す文はプログラムが組むので、Writer に渡さない
  const written = withoutPcNotes(withoutReplies(manual));
  return {
    previous_manual: { ...written, glossary: [], statements: written.statements.filter((statement) => !glossaryIds.has(statement.id)) },
    findings: findings.filter((finding) => !glossaryIds.has(finding.statement)),
  };
}

/**
 * 差し戻しのあと、前の版の用語の説明を引き継ぐ。
 * 毎回作り直すと、合格済みの説明が別の文面に変わって新しい指摘を生み、差し戻しが増えるため。
 * 指摘された説明だけは引き継がない。
 * @returns { manual, changed } changed は、前の版から文面が変わった文章の ID。Editor はこれだけを直す
 */
export function carryForward(previous, findings, written) {
  const flagged = new Set(findings.map((finding) => finding.statement));
  const before = new Map(previous.statements.map((statement) => [statement.id, statement]));
  const current = new Map(written.statements.map((statement) => [statement.id, statement]));
  let next = Math.max(0, ...previous.statements.concat(written.statements).map((statement) => Number(statement.id.slice(4))));

  const carried = [];
  const glossary = [];
  for (const entry of previous.glossary) {
    if (flagged.has(entry.company)) continue;
    const statement = before.get(entry.company);
    const same = current.get(statement.id);
    if (same?.text === statement.text) {
      glossary.push(entry);
      continue;
    }
    // Writer が同じ ID を別の文章に使っていれば、番号を振り直す
    let id = statement.id;
    if (same) {
      next += 1;
      id = `STM-${String(next).padStart(3, '0')}`;
    }
    carried.push({ ...statement, id });
    glossary.push({ ...entry, company: id });
  }
  const changed = written.statements
    .filter((statement) => !statement.library && before.get(statement.id)?.text !== statement.text)
    .map((statement) => statement.id);
  return { manual: { ...written, statements: [...written.statements, ...carried], glossary }, changed };
}

/**
 * 差し戻しのあと、Verifier にかけ直す文章を選ぶ。
 * 前回「正しい」と判定され、文面が変わっていない文章は、かけ直さない。
 */
export function verificationScope(previousManual, previousVerification, manual) {
  const before = new Map(previousManual.statements.map((statement) => [statement.id, statement.text]));
  const correct = new Set(previousVerification.results.filter((result) => result.verdict === 'correct').map((result) => result.statement));
  return manual.statements.filter((statement) => !(correct.has(statement.id) && before.get(statement.id) === statement.text)).map((statement) => statement.id);
}

/** かけ直した結果に、変わっていない文章の前回の結果を足して、全文の結果にする。 */
export function mergeVerification(previousVerification, results, manual, scope) {
  const inScope = new Set(scope);
  const known = new Set(manual.statements.map((statement) => statement.id));
  const carried = previousVerification.results.filter((result) => known.has(result.statement) && !inScope.has(result.statement));
  return { ...previousVerification, results: [...carried, ...results] };
}

/** 全ページの確認が済んだ印を付ける。 */
export const markReviewed = (manual, reviewer, confirmedOn) => ({ ...manual, review: { reviewer, confirmed_on: confirmedOn } });
