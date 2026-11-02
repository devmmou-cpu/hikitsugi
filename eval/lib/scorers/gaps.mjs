// Gap Finder の採点。空白のまとめ方は問わず、必須項目単位で結果だけを見る。
// 見落としだけでなく、過剰な指摘も数える（全部を空白と言えば見落としは 0 になるため）。

export function score(output, answers, context) {
  const coverage = new Map();
  for (const entry of output.coverage) {
    if (coverage.has(entry.item)) throw new Error(`同じ項目に2回判定しています: ${entry.item}`);
    coverage.set(entry.item, entry);
  }
  const inGap = new Set(output.gaps.flatMap((gap) => gap.items));
  const known = new Set(answers.items.map((item) => item.item));
  for (const item of [...coverage.keys(), ...inGap]) {
    if (!known.has(item)) throw new Error(`存在しない必須項目です: ${item}`);
  }
  const inv = new Map(context.survey.items.map((item) => [item.id, item]));

  return answers.items.map((gold) => {
    const entry = coverage.get(gold.item);
    const base = { item: gold.item, expected: gold.state };
    if (!entry) return { ...base, predicted: null, status: 'unanswered', missed: gold.state !== 'filled', false_filled: false, over_flagged: false, bad_evidence: 0 };
    const needsInterview = gold.state !== 'filled';
    const asked = inGap.has(gold.item);
    return {
      ...base,
      predicted: entry.state,
      status: 'answered',
      // 聞くべき項目を聞かずに済ませると、引き継ぎから抜け落ちる
      missed: needsInterview && !asked,
      false_filled: needsInterview && entry.state === 'filled',
      over_flagged: !needsInterview && asked,
      bad_evidence: entry.evidence.filter((ref) => inv.get(ref)?.status !== 'ok').length,
    };
  });
}

export function summarize(rows) {
  const count = (fn) => rows.filter(fn).length;
  return {
    items: rows.length,
    missed: count((r) => r.missed),
    missed_items: rows.filter((r) => r.missed).map((r) => r.item),
    false_filled: count((r) => r.false_filled),
    over_flagged: count((r) => r.over_flagged),
    bad_evidence: rows.reduce((sum, r) => sum + r.bad_evidence, 0),
    unanswered: count((r) => r.status === 'unanswered'),
    complete: count((r) => r.status === 'unanswered') === 0,
    targets: { missed_max: 0 },
  };
}
