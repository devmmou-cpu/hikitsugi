// 手順部品の操作。文面はプログラムが組み立て、モデルには書かせない。
// /hikitsugi:start と評価の両方で使う。

import { readFileSync } from 'node:fs';
import { pageProblems } from './page-check.mjs';

const LIBRARY_PATH = new URL('../library/procedures.json', import.meta.url);

export const loadLibrary = () => JSON.parse(readFileSync(LIBRARY_PATH, 'utf8'));

/** モデルに渡す部分。承認の状態や確認者は渡さない。 */
export const libraryForAgents = (library = loadLibrary()) => ({
  list_values: library.list_values,
  sequences: library.sequences,
  procedures: library.procedures.map(({ id, use_for, text, slots }) => ({ id, use_for, text, slots })),
});

const fill = (text, values) => values.reduce((filled, { slot, value }) => filled.replaceAll(`{${slot}}`, value), text);

/** 根拠の ID から、照合に使う文字列を返す。使えない根拠は null。 */
function evidenceReader({ survey, transcript }) {
  const inv = new Map(survey.items.map((item) => [item.id, item]));
  const int = new Map(transcript.entries.map((entry) => [entry.id, entry]));
  return (ref) => {
    // ドライブ文字のように、調査データでは項目名の側にある値も認める
    if (inv.get(ref)?.status === 'ok') return `${inv.get(ref).key} ${inv.get(ref).value}`;
    if (int.get(ref)?.status === 'answered') return int.get(ref).answer;
    return null;
  };
}

/**
 * Writer の出力の、部品を使った文章を組み立てる。
 * @returns { manual, problems } problems は、部品の指定の誤りや、根拠にない値の一覧
 */
export function composeProcedures(manual, sources, library = loadLibrary()) {
  const parts = new Map(library.procedures.map((part) => [part.id, part]));
  const readEvidence = evidenceReader(sources);
  const problems = [];
  const statements = manual.statements.map((raw) => {
    // 構造化出力で null が返ることがあるので、項目ごと外す
    const { library: use, ...statement } = raw;
    if (!use) {
      if (statement.evidence.some((ref) => ref.startsWith('LIB-'))) {
        problems.push(`${statement.id}: 部品の指定がないのに、部品を根拠にしています`);
      }
      return statement;
    }
    const part = parts.get(use.id);
    if (!part) {
      problems.push(`${statement.id}: 存在しない部品です: ${use.id}`);
      return { ...statement, library: use };
    }
    const given = use.values.map((entry) => entry.slot).sort();
    if (JSON.stringify(given) !== JSON.stringify([...part.slots].sort())) {
      problems.push(`${statement.id}: ${use.id} に入れる値が違います（必要なもの：${part.slots.join('、') || 'なし'}）`);
    }
    const valueEvidence = [];
    for (const { slot, value, evidence } of use.values) {
      // 同じページの表を指す値は、ここでは根拠を求めない。表の文章が根拠を持つ
      if (library.list_values?.[slot] === value) continue;
      if (!evidence.length) problems.push(`${statement.id}: {${slot}} の根拠がありません`);
      for (const ref of evidence) {
        const text = readEvidence(ref);
        if (text === null) problems.push(`${statement.id}: {${slot}} に使えない根拠です: ${ref}`);
        else if (!text.includes(value)) problems.push(`${statement.id}: {${slot}} の値「${value}」が根拠 ${ref} にありません`);
        valueEvidence.push(ref);
      }
    }
    return { id: statement.id, text: fill(part.text, use.values), evidence: [use.id, ...new Set(valueEvidence)], library: use };
  });

  // ページの中で、部品の順番が決まった順と逆になっていないこと
  const partOf = new Map(statements.filter((s) => s.library).map((s) => [s.id, s.library.id]));
  const byId = new Map(statements.map((s) => [s.id, s]));
  const usesList = (id) => byId.get(id)?.library?.values.some(({ slot, value }) => library.list_values?.[slot] === value);
  for (const page of manual.symptom_pages) {
    // 表を指す値を使うなら、そのページに共有フォルダの表が必要
    if (page.steps.some(usesList) && !page.drive_rows.length) {
      problems.push(`${page.id}: 表を指す値を使う部品がありますが、共有フォルダの表（drive_rows）がありません`);
    }
    const used = page.steps.map((id) => partOf.get(id)).filter(Boolean);
    for (const sequence of library.sequences) {
      const positions = used.filter((id) => sequence.order.includes(id)).map((id) => sequence.order.indexOf(id));
      if (positions.some((position, i) => i > 0 && position < positions[i - 1])) {
        problems.push(`${page.id}: 部品の順番が「${sequence.title}」と違います`);
      }
    }
  }
  const composed = { ...manual, statements };
  return { manual: composed, problems: [...problems, ...pageProblems(composed)] };
}

/** 取扱説明書が使っている部品のうち、承認されていないもの（存在しないものを含む）を返す。 */
export function unapprovedParts(manual, library = loadLibrary()) {
  const status = new Map(library.procedures.map((part) => [part.id, part.status]));
  const used = new Set(manual.statements.flatMap((s) => s.evidence.filter((ref) => ref.startsWith('LIB-'))));
  return [...used].filter((id) => status.get(id) !== 'approved').sort();
}
