// 取扱説明書を表示プログラムへ渡す前の処理。/hikitsugi と評価の両方で使う。

/**
 * 表示プログラムの初版は機器の一覧と定期作業を表示できないので、外して渡す。
 * 黙って捨てないよう、外した件数を返す。
 */
export function prepareForRender(manual) {
  const { routines, devices } = manual;
  const kept = { ...manual, routines: [], devices: [] };
  const screens = JSON.stringify({ ...kept, statements: [] });
  const statements = manual.statements.filter((statement) => screens.includes(`"${statement.id}"`));
  return {
    manual: { ...kept, statements },
    omitted: { routines: routines.length, devices: devices.length, statements: manual.statements.length - statements.length },
  };
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
  const glossaryIds = new Set(manual.glossary.map((entry) => entry.explanation));
  return {
    previous_manual: { ...manual, glossary: [], statements: manual.statements.filter((statement) => !glossaryIds.has(statement.id)) },
    findings: findings.filter((finding) => !glossaryIds.has(finding.statement)),
  };
}
