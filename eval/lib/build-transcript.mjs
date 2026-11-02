// 隠し設定の台本から、固定の聞き取り記録を作る。
// 手で編集すると事実とずれるので、記録は必ずこの関数の出力と一致させる（整合性テストで確認）。

const pad = (n, width) => String(n).padStart(width, '0');

/** 開始時刻から i 分後の時刻を、日本時間の表記で返す。実行時刻には依存しない。 */
function minutesAfter(startedAt, minutes) {
  const match = startedAt.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):00\+09:00$/);
  if (!match) throw new Error(`開始時刻の形式が違います: ${startedAt}`);
  const [, date, hour, minute] = match;
  const total = Number(hour) * 60 + Number(minute) + minutes;
  return `${date}T${pad(Math.floor(total / 60), 2)}:${pad(total % 60, 2)}:00+09:00`;
}

export function buildTranscript(factsFile) {
  const byId = new Map(factsFile.facts.map((fact) => [fact.id, fact]));
  const entries = factsFile.script.map((step, index) => {
    const facts = step.facts.map((id) => {
      const fact = byId.get(id);
      if (!fact) throw new Error(`台本が存在しない事実を参照しています: ${id}`);
      return fact;
    });
    const statuses = new Set(facts.map((fact) => fact.status));
    if (statuses.size !== 1) {
      throw new Error(`1つの質問に異なる回答区分が混ざっています: ${step.question}`);
    }
    const number = pad(index + 1, 3);
    return {
      id: `INT-${number}`,
      gap: `GAP-${number}`,
      covers: [...new Set(facts.flatMap((fact) => fact.covers))].sort(),
      question: step.question,
      answer: facts.map((fact) => fact.answer).join(''),
      status: facts[0].status,
      answered_at: minutesAfter(factsFile.started_at, index + 1),
    };
  });
  return { schema_version: 1, company: factsFile.company, entries };
}
