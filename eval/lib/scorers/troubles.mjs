// 模擬の後任の採点。T1〜T5 で正しい行動を選べたかを確かめる。
// 行動は self（自力で解決）、check_first（確かめてから連絡先へ依頼）、contact（連絡）、internal（社内で相談）、gave_up（あきらめた）。
// 出力の形：{ results: [{ trouble: "T1", action: "contact", contact: "業者名", steps?: 3, stuck_at?: "…" }] }

export function validateOutput(output) {
  if (!output || !Array.isArray(output.results)) throw new Error('results の配列がありません');
  for (const result of output.results) {
    if (!/^T[1-5]$/.test(result.trouble ?? '')) throw new Error(`トラブルの ID が違います: ${result.trouble}`);
    if (!['self', 'check_first', 'contact', 'internal', 'gave_up'].includes(result.action)) throw new Error(`行動の値が違います: ${result.action}`);
  }
}

/**
 * @param vendors 業者の一覧（case.json）。連絡先は業者名で照合する。
 * VEN の番号は取扱説明書ごとに Writer が振るので、正解の番号とは一致しないため。
 */
export function score(output, answers, vendors) {
  validateOutput(output);
  const nameOf = new Map(vendors.map((vendor) => [vendor.id, vendor.name]));
  const byId = new Map();
  for (const result of output.results) {
    if (byId.has(result.trouble)) throw new Error(`同じトラブルに2回回答しています: ${result.trouble}`);
    byId.set(result.trouble, result);
  }
  return answers.troubles.map((gold) => {
    const result = byId.get(gold.id);
    const expectedContact = gold.contact === null ? null : nameOf.get(gold.contact);
    if (gold.contact !== null && !expectedContact) throw new Error(`正解の連絡先が業者の一覧にありません: ${gold.contact}`);
    const base = { trouble: gold.id, expected_action: gold.action, expected_contact: expectedContact };
    if (!result) return { ...base, status: 'unanswered', action: null, contact: null, passed: false };
    const passed = result.action === gold.action && (gold.action === 'self' || result.contact === expectedContact);
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
