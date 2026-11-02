// Editor の採点。文章の読みやすさは取扱説明書の採点器で数え、事実が変わっていないかをここで数える。

import { missingTokens } from '../../../plugin/lib/apply-edits.mjs';
import * as manual from './manual.mjs';

export function score(output, original, context) {
  if (!original) throw new Error('Editor の採点には --from で元の取扱説明書が必要です');
  const before = new Map(original.statements.map((statement) => [statement.id, statement]));
  const names = original.contacts.map((contact) => contact.name);
  const changes = [];
  for (const statement of output.statements) {
    const old = before.get(statement.id);
    if (!old) continue;
    const missing = missingTokens(old.text, statement.text, names);
    const evidenceChanged = JSON.stringify(old.evidence) !== JSON.stringify(statement.evidence);
    if (missing.length || evidenceChanged) changes.push({ kind: 'fact_change', statement: statement.id, missing, evidence_changed: evidenceChanged });
  }
  const missingStatements = [...before.keys()].filter((id) => !output.statements.some((s) => s.id === id));
  for (const id of missingStatements) changes.push({ kind: 'fact_change', statement: id, missing: [], removed: true, evidence_changed: false });
  return [...manual.score(output, null, context), ...changes];
}

export function summarize(rows) {
  const changes = rows.filter((row) => row.kind === 'fact_change');
  return {
    ...manual.summarize(rows.filter((row) => row.kind !== 'fact_change')),
    fact_changes: changes.length,
    fact_change_statements: changes.map((row) => row.statement),
    targets: { bad_evidence_max: 0, long_sentences_max: 0, unexplained_terms_max: 0, credentials_max: 0, unsupported_phones_max: 0, fact_changes_max: 0 },
  };
}
