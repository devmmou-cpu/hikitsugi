// 取扱説明書の中身の採点。根拠、1文の長さ、用語、認証情報を機械的に確かめる。

import { nonActionSteps } from '../../../plugin/lib/page-check.mjs';
import { JARGON, longSentences, usesTerm } from '../../../plugin/lib/plain-check.mjs';
import { loadLibrary, unapprovedParts } from '../../../plugin/lib/procedures.mjs';

const CREDENTIAL = /(?:パスワード|暗証番号|認証コード|password|passcode)(?:は|:|：|=|＝)\s*[「"']?[!-~]{4,}/iu;

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

  const library = loadLibrary();
  const parts = new Set(library.procedures.map((part) => part.id));
  const seen = new Set();
  const rows = output.statements.map((statement) => {
    if (seen.has(statement.id)) throw new Error(`記述の ID が重複しています: ${statement.id}`);
    seen.add(statement.id);
    const badEvidence = statement.evidence.filter((ref) => {
      if (ref.startsWith('INV-')) return inv.get(ref)?.status !== 'ok';
      if (ref.startsWith('INT-')) return int.get(ref)?.status !== 'answered';
      if (ref.startsWith('LIB-')) return !parts.has(ref);
      // 公開資料の ID はまだ使わない
      return true;
    });
    return {
      statement: statement.id,
      bad_evidence: badEvidence,
      long_sentences: longSentences(statement.text).length,
      unexplained_terms: JARGON.filter((term) => usesTerm(statement.text, term) && !glossary.has(term)),
      credential: CREDENTIAL.test(statement.text),
    };
  });

  // 連絡先の名前と電話番号は文章ではなく Verifier の対象外なので、ここで根拠と照合する
  const evidenceText = [
    ...context.survey.items.filter((item) => item.status === 'ok').map((item) => String(item.value)),
    ...context.transcript.entries.filter((entry) => entry.status === 'answered').map((entry) => entry.answer),
  ].join('\n');
  const contactRows = output.contacts.map((contact) => ({
    kind: 'contact',
    contact: contact.id,
    unsupported_phone: Boolean(contact.phone) && !evidenceText.includes(contact.phone),
  }));

  const refs = referencedStatements(output);
  const dangling = refs.filter((ref) => !seen.has(ref));
  if (dangling.length) throw new Error(`存在しない記述を参照しています: ${[...new Set(dangling)].join(', ')}`);
  const partRows = unapprovedParts(output, library).map((part) => ({ kind: 'part', part }));
  const stepRows = nonActionSteps(output).map(({ page, statement }) => ({ kind: 'step', page, statement }));
  return [...rows, ...contactRows, ...partRows, ...stepRows];
}

export function summarize(allRows) {
  const rows = allRows.filter((row) => !['contact', 'part', 'step'].includes(row.kind));
  const unexplained = [...new Set(rows.flatMap((r) => r.unexplained_terms))];
  return {
    statements: rows.length,
    bad_evidence: rows.filter((r) => r.bad_evidence.length > 0).map((r) => r.statement),
    long_sentences: rows.reduce((sum, r) => sum + r.long_sentences, 0),
    unexplained_terms: unexplained,
    credentials: rows.filter((r) => r.credential).map((r) => r.statement),
    unsupported_phones: allRows.filter((r) => r.unsupported_phone).map((r) => r.contact),
    unapproved_parts: allRows.filter((r) => r.kind === 'part').map((r) => r.part),
    non_action_steps: allRows.filter((r) => r.kind === 'step').map((r) => r.statement),
    complete: true,
    targets: { bad_evidence_max: 0, long_sentences_max: 0, unexplained_terms_max: 0, credentials_max: 0, unsupported_phones_max: 0, unapproved_parts_max: 0, non_action_steps_max: 0 },
  };
}
