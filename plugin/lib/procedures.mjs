// 手順部品の操作。文面はプログラムが組み立て、モデルには書かせない。
// /hikitsugi:start と評価の両方で使う。

import { readFileSync } from 'node:fs';
import { bodyFields, manualProblems, parseInfoRow } from './page-check.mjs';

const LIBRARY_PATH = new URL('../library/procedures.json', import.meta.url);

export const loadLibrary = () => JSON.parse(readFileSync(LIBRARY_PATH, 'utf8'));

/** モデルに渡す部分。承認の状態や確認者は渡さない。 */
export const libraryForAgents = (library = loadLibrary()) => ({
  sequences: library.sequences,
  procedures: library.procedures.map(({ id, use_for, text, kinds, needs_table }) => ({ id, use_for, text, kinds, needs_table })),
});

const compact = (text) => text.normalize('NFKC');

/** 根拠の ID から、照合に使う文字列を返す。使えない根拠は null。 */
export function evidenceReader({ survey, transcript }) {
  const inv = new Map(survey.items.map((item) => [item.id, item]));
  const int = new Map(transcript.entries.map((entry) => [entry.id, entry]));
  return (ref) => {
    // ドライブ文字のように、調査データでは項目名の側にある値も認める
    if (inv.get(ref)?.status === 'ok') return `${inv.get(ref).key} ${inv.get(ref).value}`;
    if (int.get(ref)?.status === 'answered') return int.get(ref).answer;
    return null;
  };
}

/** 部品を使った文章の文面を組み立てる。構造化出力で null が返ることがあるので、項目ごと外す。 */
export function composeStatements(rawStatements, library = loadLibrary()) {
  const parts = new Map(library.procedures.map((part) => [part.id, part]));
  const problems = [];
  const statements = rawStatements.map(({ library: partId, ...statement }) => {
    if (!partId) {
      if (statement.evidence.some((ref) => ref.startsWith('LIB-'))) problems.push(`${statement.id}: 部品の指定がないのに、部品を根拠にしています`);
      if (!statement.evidence.length) problems.push(`${statement.id}: 根拠（evidence）が空です。空にできるのは、部品を使う文章だけです`);
      return statement;
    }
    const part = parts.get(partId);
    if (!part) {
      problems.push(`${statement.id}: 存在しない部品です: ${partId}`);
      return { ...statement, library: partId };
    }
    return { id: statement.id, text: part.text, evidence: [partId], library: partId };
  });
  return { statements, problems };
}

/** ページの中の部品の置き場所、順番、表との関係を確かめる。 */
function partProblems(page, statements, library) {
  const parts = new Map(library.procedures.map((part) => [part.id, part]));
  const byId = new Map(statements.map((statement) => [statement.id, statement]));
  const partOf = (id) => parts.get(byId.get(id)?.library);
  const problems = [];
  const fields = bodyFields(page);
  for (const [field, ids] of Object.entries(fields)) {
    for (const id of ids) {
      const part = partOf(id);
      if (!part) continue;
      if (!part.kinds.includes(field)) problems.push(`${page.id}: ${part.id} は ${field} に置けません（置ける場所：${part.kinds.join('、')}）`);
      if (part.needs_table && !page.info_rows.length) problems.push(`${page.id}: ${part.id} は会社の情報の表を指しますが、表（info_rows）がありません`);
      if (part.text.includes('連絡先へ') && !page.fallback) problems.push(`${page.id}: ${part.id} は連絡先へ案内しますが、fallback がありません`);
    }
  }
  const used = [...page.first_steps, ...page.steps].map((id) => partOf(id)?.id).filter(Boolean);
  for (const sequence of library.sequences) {
    const order = [...sequence.first, ...sequence.steps];
    const positions = used.filter((id) => order.includes(id)).map((id) => order.indexOf(id));
    if (positions.some((position, i) => i > 0 && position < positions[i - 1])) {
      problems.push(`${page.id}: 部品の順番が「${sequence.title}」と違います`);
    }
  }
  return problems;
}

/** 表の値が、その文章の根拠に本当にあるかを確かめる。値を書き写した誤りをプログラムで止める。 */
function infoRowProblems(page, statements, readEvidence) {
  const byId = new Map(statements.map((statement) => [statement.id, statement]));
  const problems = [];
  for (const id of page.info_rows) {
    const statement = byId.get(id);
    const row = statement && parseInfoRow(statement.text);
    if (!row) continue;
    const refs = statement.evidence.filter((ref) => !ref.startsWith('LIB-'));
    const texts = refs.map(readEvidence).filter((text) => text !== null).map(compact);
    const values = row.type === 'drive' ? [row.drive, row.path] : [row.value];
    for (const value of values) {
      if (!texts.some((text) => text.includes(compact(value)))) problems.push(`${page.id}: ${id} の値「${value}」が根拠にありません`);
    }
  }
  return problems;
}

/** 連絡先の名前と電話番号が、使える根拠のどこかにあるかを確かめる。 */
export function contactEvidenceProblems(contacts, { survey, transcript }) {
  const all = compact(
    [
      ...survey.items.filter((item) => item.status === 'ok').map((item) => `${item.key} ${item.value}`),
      ...transcript.entries.filter((entry) => entry.status === 'answered').map((entry) => entry.answer),
    ].join('\n'),
  );
  return contacts.flatMap((contact) => [
    ...(all.includes(compact(contact.name)) ? [] : [`${contact.id}: 名前「${contact.name}」が根拠にありません`]),
    ...(!contact.phone || all.includes(compact(contact.phone)) ? [] : [`${contact.id}: 電話番号が根拠にありません`]),
  ]);
}

/** ページ1つの、部品と表の問題。 */
export function pageDetailProblems(page, statements, sources, library = loadLibrary()) {
  return [...partProblems(page, statements, library), ...infoRowProblems(page, statements, evidenceReader(sources))];
}

/**
 * Writer の出力の、部品を使った文章を組み立て、形を確かめる。
 * @returns { manual, problems } problems は、部品の指定の誤りや、根拠にない値の一覧
 */
export function composeProcedures(manual, sources, { library = loadLibrary(), retiree } = {}) {
  const { statements, problems } = composeStatements(manual.statements, library);
  const composed = { ...manual, statements };
  for (const page of manual.symptom_pages) problems.push(...pageDetailProblems(page, statements, sources, library));
  problems.push(...contactEvidenceProblems(manual.contacts, sources), ...manualProblems(composed, retiree));
  return { manual: composed, problems };
}

/** 取扱説明書が使っている部品のうち、承認されていないもの（存在しないものを含む）を返す。 */
export function unapprovedParts(manual, library = loadLibrary()) {
  const status = new Map(library.procedures.map((part) => [part.id, part.status]));
  const used = new Set(manual.statements.flatMap((s) => s.evidence.filter((ref) => ref.startsWith('LIB-'))));
  return [...used].filter((id) => status.get(id) !== 'approved').sort();
}
