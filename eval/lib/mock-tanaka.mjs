// 模擬の田中さん。隠し設定（hidden）に触れてよいのは、評価の中でここだけ。
// モデルは事実の ID を選ぶだけで、回答の文面は隠し設定の文をそのまま使う。作り話や、言い換えによる採点のずれを防ぐため。

import { callAgent, buildRequest, loadAgent, tagged } from './adapters/live.mjs';
import { LiveFailure } from './adapters/live.mjs';

const RESPONSE = {
  type: 'object',
  additionalProperties: false,
  required: ['fact_ids'],
  properties: { fact_ids: { type: 'array', items: { type: 'string', pattern: '^F-\\d{2}$' } } },
};

// 採点に使う照合語や必須項目は渡さない
const publicFacts = (hidden) => hidden.facts.map(({ id, answer, status }) => ({ id, answer, status }));

export function buildMockRequest(hidden, question, agent = loadAgent('eval/agents/mock-tanaka.md')) {
  const content = tagged({ rules: hidden.rules, facts: publicFacts(hidden), question });
  return buildRequest(agent, RESPONSE, content);
}

/** 選ばれた事実から、回答の文面と区分を作る。回答のある事実を優先し、なければ分からないとする。 */
export function composeAnswer(hidden, factIds) {
  const byId = new Map(hidden.facts.map((fact) => [fact.id, fact]));
  const facts = [...new Set(factIds)].map((id) => {
    const fact = byId.get(id);
    if (!fact) throw new LiveFailure('mock', `存在しない事実を選びました: ${id}`);
    return fact;
  });
  const answered = facts.filter((fact) => fact.status === 'answered');
  const chosen = answered.length ? answered : facts;
  if (chosen.length === 0) return { answer: '分かりません。', status: 'unknown' };
  return { answer: chosen.map((fact) => fact.answer).join(''), status: chosen[0].status };
}

export function createMockTanaka({ hidden, api, record }) {
  const agent = loadAgent('eval/agents/mock-tanaka.md');
  return async function answer(question) {
    const parsed = await callAgent({ api, agent, params: buildMockRequest(hidden, question, agent), record, estimate: false });
    return composeAnswer(hidden, parsed.fact_ids);
  };
}
