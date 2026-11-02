// Verifier の採点。正解は answers/verifier.json。
// 「誤りを見つけた」は判定が correct 以外であること。種類の一致は別の指標として数える。

/** 出力の一覧を1件ごとの行に変換する。出力そのものの異常は例外にして errors に回す。 */
export function score(output, answers) {
  const byId = new Map();
  const known = new Set(answers.statements.map((s) => s.id));
  for (const result of output.results) {
    if (!known.has(result.statement)) {
      throw new Error(`評価セットにない記述への判定です: ${result.statement}`);
    }
    if (byId.has(result.statement)) throw new Error(`同じ記述に2回判定しています: ${result.statement}`);
    byId.set(result.statement, result);
  }
  return answers.statements.map((answer) => {
    const result = byId.get(answer.id);
    const base = { statement: answer.id, kind: answer.kind, error: answer.error, expected: answer.expected };
    // 回答なしは「正しい」とも「誤り」とも数えない
    if (!result) return { ...base, verdict: null, status: 'unanswered', flagged: false, type_match: false };
    return {
      ...base,
      verdict: result.verdict,
      status: 'answered',
      flagged: result.verdict !== 'correct',
      type_match: result.verdict === answer.expected,
    };
  });
}

const percent = (n, d) => (d === 0 ? null : Math.round((n / d) * 1000) / 10);

/** 集計は必ず行から計算する。出力側の集計値は信用しない。 */
export function summarize(rows) {
  const seeded = rows.filter((r) => r.kind === 'seeded');
  const correct = rows.filter((r) => r.kind === 'correct');
  const answeredCorrect = correct.filter((r) => r.status === 'answered');
  const detected = seeded.filter((r) => r.flagged);
  const falsePositives = answeredCorrect.filter((r) => r.flagged);
  const unanswered = rows.filter((r) => r.status === 'unanswered');
  return {
    detected: detected.length,
    seeded: seeded.length,
    detection_rate: percent(detected.length, seeded.length),
    false_positives: falsePositives.length,
    correct_answered: answeredCorrect.length,
    false_positive_rate: percent(falsePositives.length, answeredCorrect.length),
    type_matched: detected.filter((r) => r.type_match).length,
    unanswered: unanswered.length,
    complete: unanswered.length === 0,
    missed_errors: seeded.filter((r) => !r.flagged).map((r) => r.error),
    false_positive_statements: falsePositives.map((r) => r.statement),
    targets: { detection_rate_min: 90, false_positive_rate_max: 10 },
  };
}
