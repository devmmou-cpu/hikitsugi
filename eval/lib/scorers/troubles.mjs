// 模擬の後任の採点。T1〜T5 で正しい行動を選べたかを確かめる。
// 出力の形：{ results: [{ trouble: "T1", action: "self", contact: null, steps?: 3, stuck_at?: "…" }] }

export function validateOutput(output) {
  if (!output || !Array.isArray(output.results)) throw new Error('results の配列がありません');
  for (const result of output.results) {
    if (!/^T[1-5]$/.test(result.trouble ?? '')) throw new Error(`トラブルの ID が違います: ${result.trouble}`);
    if (!['self', 'contact', 'gave_up'].includes(result.action)) throw new Error(`行動の値が違います: ${result.action}`);
  }
}

export function score(output, answers) {
  validateOutput(output);
  const byId = new Map();
  for (const result of output.results) {
    if (byId.has(result.trouble)) throw new Error(`同じトラブルに2回回答しています: ${result.trouble}`);
    byId.set(result.trouble, result);
  }
  return answers.troubles.map((gold) => {
    const result = byId.get(gold.id);
    const base = { trouble: gold.id, expected_action: gold.action, expected_contact: gold.contact };
    if (!result) return { ...base, status: 'unanswered', action: null, contact: null, passed: false };
    const passed = result.action === gold.action && (gold.action !== 'contact' || result.contact === gold.contact);
    return { ...base, status: 'answered', action: result.action, contact: result.contact ?? null, passed };
  });
}

export function summarize(rows) {
  const unanswered = rows.filter((r) => r.status === 'unanswered').length;
  return {
    passed: rows.filter((r) => r.passed).length,
    troubles: rows.length,
    failed: rows.filter((r) => !r.passed).map((r) => r.trouble),
    unanswered,
    complete: unanswered === 0,
    targets: { passed_min: 5 },
  };
}
