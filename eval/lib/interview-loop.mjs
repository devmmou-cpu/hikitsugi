// Interviewer と模擬の田中さんを交互に動かして、聞き取り記録を作る。
// Interviewer に渡すのは調査データ、空白の一覧、必須項目、ここまでの記録だけ。隠し設定は渡さない。

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendEntry, checkNextQuestion, emptyTranscript, QUESTION_CHARS, QUESTION_LIMIT } from '../../plugin/lib/transcript.mjs';
import { buildRequest, callAgent, clientOf, LiveFailure, loadAgent, loadChecklist, tagged } from './adapters/live.mjs';
import { createMockTanaka } from './mock-tanaka.mjs';

// 1問を返すだけなので、短い上限で打ち切る。暴走したときの費用と待ち時間を抑えるため
const INTERVIEWER_MAX_TOKENS = 2000;
// 暴走はまれなので、呼び直せば直る。3回続けて失敗したら止める
const MAX_ATTEMPTS = 3;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const NEXT_SCHEMA = (() => {
  const { $comment, ...schema } = JSON.parse(readFileSync(join(ROOT, 'plugin/schemas/next-question.schema.json'), 'utf8'));
  return schema;
})();

/**
 * Interviewer のリクエスト。変わらない部分を先頭に置いて、キャッシュする。
 * 回を重ねても前置きの費用がほとんど増えないようにするため。
 */
export function buildInterviewerRequest({ survey, gaps, checklist = loadChecklist(), transcript, agent = loadAgent('plugin/agents/interviewer.md') }) {
  const stable = tagged({ survey, gaps, checklist });
  const remaining = QUESTION_LIMIT - transcript.entries.length;
  const dynamic = `${tagged({ transcript })}\n\nここまでに ${transcript.entries.length} 問聞きました。残りは ${remaining} 問です。次の1問を決めてください。`;
  return buildRequest(agent, NEXT_SCHEMA, [
    { type: 'text', text: stable, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: dynamic },
  ], { maxTokens: INTERVIEWER_MAX_TOKENS });
}

/** 次の1問を受け取る。途中で切れた出力や、不自然な質問は、問題を伝えて呼び直す。 */
async function askNext({ api, agent, params, record, gaps }) {
  let last;
  let retryParams = params;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const next = await callAgent({ api, agent, params: retryParams, record, estimate: false });
      const problems = checkNextQuestion(next, gaps);
      if (problems.length === 0) return next;
      last = new LiveFailure('interviewer', problems.join(' / '));
    } catch (error) {
      if (error.stage !== 'incomplete' && error.stage !== 'parse') throw error;
      last = error;
    }
    // キャッシュの後ろに足すので、前置きの費用は増えない
    const [stable, dynamic] = params.messages[0].content;
    const notice = { type: 'text', text: `前回の出力には次の問題がありました：${last.message}\n質問を1つだけ、${QUESTION_CHARS}字以内の短い文にしてください。聞く内容が多いときは、今回は一部だけを聞きます。` };
    retryParams = { ...params, messages: [{ role: 'user', content: [stable, dynamic, notice] }] };
  }
  throw last;
}

/**
 * 聞き取りを最後まで実行して、記録を返す。
 * @param askTanaka 質問を受け取り { answer, status } を返す関数。評価では模擬の田中さん
 */
export async function runInterview({ survey, gaps, askTanaka, api, record, clock = () => new Date().toISOString() }) {
  const agent = loadAgent('plugin/agents/interviewer.md');
  const checklist = loadChecklist();
  let transcript = emptyTranscript(survey.company);
  while (transcript.entries.length < QUESTION_LIMIT) {
    const params = buildInterviewerRequest({ survey, gaps, checklist, transcript, agent });
    const next = await askNext({ api, agent, params, record, gaps });
    if (next.action === 'finish') break;
    const { answer, status } = await askTanaka(next.question);
    transcript = appendEntry(transcript, { next, answer, status, answeredAt: clock() });
  }
  return transcript;
}

export async function runInterviewLive({ survey, gaps, hidden, client, record = () => {} }) {
  const api = await clientOf(client);
  const askTanaka = createMockTanaka({ hidden, api, record });
  return runInterview({ survey, gaps, askTanaka, api, record });
}
