// Interviewer の採点。必須項目ごとに、調査か聞き取りで埋まったかを数える。
// covers の自己申告だけでは数えない。回答に、その項目の事実を示す語が含まれている必要がある。

const QUESTION_LIMIT = 20;

export function score(output, answers, context) {
  const facts = new Map(context.facts.facts.map((fact) => [fact.id, fact]));
  const answered = output.entries.filter((entry) => entry.status === 'answered');

  return answers.items.map((gold) => {
    const base = { item: gold.item };
    if (gold.state === 'filled') return { ...base, covered: true, via: 'survey' };
    const phrases = gold.facts.flatMap((id) => facts.get(id)?.match ?? []);
    const hit = answered.find(
      (entry) => entry.covers.includes(gold.item) && phrases.some((phrase) => entry.answer.includes(phrase)),
    );
    if (hit) return { ...base, covered: true, via: 'interview', entry: hit.id };
    const claimed = answered.some((entry) => entry.covers.includes(gold.item));
    return { ...base, covered: false, via: 'none', claimed_without_fact: claimed };
  });
}

export function summarize(rows, output) {
  const covered = rows.filter((r) => r.covered).length;
  const questions = output.entries.length;
  return {
    covered,
    items: rows.length,
    coverage_rate: rows.length === 0 ? null : Math.round((covered / rows.length) * 1000) / 10,
    questions,
    within_question_limit: questions <= QUESTION_LIMIT,
    uncovered_items: rows.filter((r) => !r.covered).map((r) => r.item),
    claimed_without_fact: rows.filter((r) => r.claimed_without_fact).map((r) => r.item),
    unknown: output.entries.filter((e) => e.status === 'unknown').length,
    later: output.entries.filter((e) => e.status === 'later').length,
    complete: true,
    targets: { coverage_rate_min: 85, question_limit: QUESTION_LIMIT },
  };
}
