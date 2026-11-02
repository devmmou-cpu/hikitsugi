// Editor の出力を取扱説明書に反映する。事実が変わっていないかは、AI ではなくプログラムが確かめる。
// /hikitsugi:start と評価の両方で使う。

const PROTECTED = /[0-9０-９]+(?:[-:：.,／/年月日時分台名回週][0-9０-９]*)*|[A-Za-z][A-Za-z0-9_\\-]*(?:[.\\][A-Za-z0-9_\\-]+)*/gu;

/** 文章の中の、変えてはいけない語（数字や英字の名前）を取り出す。 */
export const protectedTokens = (text) => [...new Set(text.match(PROTECTED) ?? [])];

const compact = (text) => text.normalize('NFKC').replace(/\s+/g, '');

/** 元の文章にあった語のうち、直したあとの文章からなくなったものを返す。 */
export function missingTokens(before, after, extra = []) {
  const target = compact(after);
  const tokens = [...protectedTokens(before), ...extra.filter((name) => before.includes(name))];
  return tokens.filter((token) => !target.includes(compact(token)));
}

/**
 * @param manual Writer の出力
 * @param edits Editor の出力（rewrites、glossary）
 * @param revert true なら、事実が変わった文章を元に戻す。評価では false にして、変わった件数をそのまま数える
 * @returns { manual, changes } changes は事実が変わった文章の一覧
 */
export function applyEdits(manual, edits, { revert = true } = {}) {
  const known = new Map(manual.statements.map((statement) => [statement.id, statement]));
  const names = manual.contacts.map((contact) => contact.name);
  const rewrites = new Map();
  for (const { id, text } of edits.rewrites) {
    if (!known.has(id)) throw new Error(`存在しない文章を直しています: ${id}`);
    rewrites.set(id, text);
  }
  // 会社の情報の表の文章は、決まった形から値を読むので直さない
  const tableStatements = new Set(manual.symptom_pages.flatMap((page) => page.info_rows));
  const changes = [];
  const statements = manual.statements.map((statement) => {
    const text = rewrites.get(statement.id);
    if (text === undefined) return statement;
    // 部品の文面は確認済みなので、Editor の直しを受け付けない
    if (statement.library) {
      if (text !== statement.text) changes.push({ statement: statement.id, missing: ['部品の文面'] });
      return statement;
    }
    if (tableStatements.has(statement.id)) {
      if (text !== statement.text) changes.push({ statement: statement.id, missing: ['表の文章'] });
      return statement;
    }
    const missing = missingTokens(statement.text, text, names);
    if (missing.length) {
      changes.push({ statement: statement.id, missing });
      if (revert) return statement;
    }
    return { ...statement, text };
  });

  // 用語の説明は、新しい文章として番号を続けて振る
  let next = Math.max(0, ...manual.statements.map((s) => Number(s.id.slice(4))));
  const added = [];
  const glossary = [...manual.glossary];
  const terms = new Set(glossary.map((entry) => entry.term));
  for (const { term, text, evidence } of edits.glossary) {
    if (terms.has(term)) continue;
    terms.add(term);
    next += 1;
    const id = `STM-${String(next).padStart(3, '0')}`;
    added.push({ id, text, evidence });
    glossary.push({ term, explanation: id });
  }
  return { manual: { ...manual, statements: [...statements, ...added], glossary }, changes };
}
