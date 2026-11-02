// Gap Finder、Interviewer、模擬の田中さんのテスト。偽のクライアントを使い、API は呼ばない。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGapFinderRequest, loadAgent, responseSchema } from '../eval/lib/adapters/live.mjs';
import { buildInterviewerRequest, runInterview } from '../eval/lib/interview-loop.mjs';
import { loadAnswers, loadHidden, loadInput } from '../eval/lib/load-set.mjs';
import { buildMockRequest, composeAnswer } from '../eval/lib/mock-tanaka.mjs';
import { costOf } from '../eval/lib/pricing.mjs';
import { score as scoreInterview, summarize as summarizeInterview } from '../eval/lib/scorers/interview.mjs';
import { runEval, UsageError } from '../eval/lib/runner.mjs';
import { appendEntry, checkNextQuestion, emptyTranscript, hasCredential, QUESTION_CHARS, QUESTION_LIMIT, questionProblems } from '../plugin/lib/transcript.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SET = join(ROOT, 'eval/sets/okojo');
const input = loadInput(SET);
const hidden = loadHidden(SET).facts;
const answers = loadAnswers(SET);

const USAGE = { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const message = (model, value) => ({
  id: 'msg_test',
  model,
  stop_reason: 'end_turn',
  usage: USAGE,
  content: [{ type: 'text', text: JSON.stringify(value) }],
});

/** 宛先のモデルごとに応答を決める偽のクライアント。 */
function fakeClient(reply) {
  const sent = [];
  return {
    sent,
    messages: {
      countTokens: async () => ({ input_tokens: 1 }),
      stream: (params) => {
        sent.push(params);
        return { finalMessage: async () => message(params.model, reply(params, sent.length)) };
      },
    },
  };
}

const gapsOutput = {
  schema_version: 1,
  company: 'okojo',
  coverage: answers.gaps.items.map((item) => ({ item: item.item, state: item.state, evidence: item.evidence })),
  gaps: [{ id: 'GAP-001', items: ['CHK-01'], why: '理由', priority: 'high', question_hint: 'ヒント' }],
};

test('モデルとエフォートは仕様どおり', () => {
  const expected = {
    'plugin/agents/gap-finder.md': ['claude-sonnet-5-5', 'medium'],
    'plugin/agents/interviewer.md': ['claude-sonnet-5-5', 'low'],
    'eval/agents/mock-tanaka.md': ['claude-haiku-5-5', 'low'],
  };
  const checks = {
    'plugin/agents/gap-finder.md': () => buildGapFinderRequest(input.survey),
    'plugin/agents/interviewer.md': () => buildInterviewerRequest({ survey: input.survey, gaps: gapsOutput, transcript: emptyTranscript('okojo') }),
    'eval/agents/mock-tanaka.md': () => buildMockRequest(hidden, '質問'),
  };
  for (const [path, build] of Object.entries(checks)) {
    const request = build();
    assert.equal(request.model, expected[path][0], path);
    assert.equal(request.output_config.effort, expected[path][1], path);
    assert.equal(request.system, loadAgent(path).prompt);
  }
});

test('Gap Finder に聞き取り記録と正解を渡さない', () => {
  const body = JSON.stringify(buildGapFinderRequest(input.survey));
  assert.ok(!body.includes(input.transcript.entries[0].answer));
  assert.ok(!body.includes(hidden.facts[0].answer));
  assert.ok(!body.includes('"facts"'));
  assert.ok(body.includes('CHK-40'));
});

test('Interviewer に隠し設定と固定の聞き取り記録を渡さない', () => {
  const body = JSON.stringify(buildInterviewerRequest({ survey: input.survey, gaps: gapsOutput, transcript: emptyTranscript('okojo') }));
  for (const fact of hidden.facts) assert.ok(!body.includes(JSON.stringify(fact.answer).slice(1, -1)), fact.id);
  assert.ok(!body.includes('"match"'));
});

test('Interviewer の変わらない部分をキャッシュし、記録はその後ろに置く', () => {
  const request = buildInterviewerRequest({ survey: input.survey, gaps: gapsOutput, transcript: emptyTranscript('okojo') });
  const [stable, dynamic] = request.messages[0].content;
  assert.deepEqual(stable.cache_control, { type: 'ephemeral' });
  assert.ok(!stable.text.includes('<transcript>'));
  assert.ok(dynamic.text.includes('<transcript>'));
  assert.ok(dynamic.text.includes('残りは 20 問'));
});

test('模擬の田中さんに、採点に使う照合語と必須項目を渡さない', () => {
  const body = buildMockRequest(hidden, '質問').messages[0].content;
  assert.ok(!body.includes('"match"'));
  assert.ok(!body.includes('"covers"'));
  assert.ok(body.includes(hidden.facts[0].answer));
});

test('模擬の田中さんの回答は隠し設定の文そのもので、回答のある事実を優先する', () => {
  const facts = {
    facts: [
      { id: 'F-01', answer: '答え1。', status: 'answered' },
      { id: 'F-02', answer: '分かりません。', status: 'unknown' },
      { id: 'F-03', answer: 'あとで調べます。', status: 'later' },
    ],
  };
  assert.deepEqual(composeAnswer(facts, ['F-01', 'F-02']), { answer: '答え1。', status: 'answered' });
  assert.deepEqual(composeAnswer(facts, ['F-03']), { answer: 'あとで調べます。', status: 'later' });
  assert.deepEqual(composeAnswer(facts, []), { answer: '分かりません。', status: 'unknown' });
  assert.throws(() => composeAnswer(facts, ['F-99']), /存在しない事実/);
});

test('聞き取りは20問で止まり、ID はプログラムが振る', async () => {
  let asked = 0;
  const client = fakeClient(() => ({ action: 'ask', gap: 'GAP-001', covers: ['CHK-01'], question: '質問です' }));
  const transcript = await runInterview({
    survey: input.survey,
    gaps: gapsOutput,
    api: client,
    record: () => {},
    askTanaka: async () => {
      asked += 1;
      return { answer: '回答です', status: 'answered' };
    },
    clock: () => '2026-11-05T10:00:00+09:00',
  });
  assert.equal(asked, QUESTION_LIMIT);
  assert.equal(transcript.entries.at(-1).id, 'INT-020');
});

test('finish で聞き取りを終える', async () => {
  const client = fakeClient(() => ({ action: 'finish', gap: '', covers: [], question: '' }));
  const transcript = await runInterview({ survey: input.survey, gaps: gapsOutput, api: client, record: () => {}, askTanaka: async () => assert.fail('質問されない') });
  assert.equal(transcript.entries.length, 0);
});

test('存在しない空白や項目を指す質問は失敗として止める', async () => {
  const client = fakeClient(() => ({ action: 'ask', gap: 'GAP-999', covers: ['CHK-01'], question: '質問' }));
  await assert.rejects(
    runInterview({ survey: input.survey, gaps: gapsOutput, api: client, record: () => {}, askTanaka: async () => ({ answer: 'x', status: 'answered' }) }),
    /存在しない空白/,
  );
  assert.ok(checkNextQuestion({ action: 'ask', gap: 'GAP-001', covers: ['CHK-99'], question: '質問' }, gapsOutput).some((p) => p.includes('CHK-99')));
  assert.ok(checkNextQuestion({ action: 'ask', gap: 'GAP-001', covers: [], question: '質問' }, gapsOutput).length > 0);
});

test('暴走した質問文を見つける', () => {
  assert.deepEqual(questionProblems('契約先を教えてください。'), []);
  assert.equal(questionProblems('あ'.repeat(QUESTION_CHARS)).length, 0);
  assert.match(questionProblems('あ'.repeat(QUESTION_CHARS + 1))[0], /長すぎます/);
  assert.match(questionProblems("質問です。','question_end':'','x':''")[0], /データの形/);
  assert.match(questionProblems('質問です。","x":""')[0], /データの形/);
});

test('Interviewer は短い上限で打ち切る', () => {
  const request = buildInterviewerRequest({ survey: input.survey, gaps: gapsOutput, transcript: emptyTranscript('okojo') });
  assert.equal(request.max_tokens, 2000);
});

/** 順番に応答を返す Interviewer。 */
function sequenceClient(replies) {
  let count = 0;
  return {
    get count() {
      return count;
    },
    messages: {
      stream: (params) => ({
        finalMessage: async () => {
          const reply = replies[Math.min(count, replies.length - 1)];
          count += 1;
          return { id: 'm', model: params.model, stop_reason: reply.stop ?? 'end_turn', usage: USAGE, content: [{ type: 'text', text: reply.text }] };
        },
      }),
    },
  };
}
const FINISH = JSON.stringify({ action: 'finish', gap: '', covers: [], question: '' });
const GOOD = JSON.stringify({ action: 'ask', gap: 'GAP-001', covers: ['CHK-01'], question: '良い質問です' });
const BROKEN = JSON.stringify({ action: 'ask', gap: 'GAP-001', covers: ['CHK-01'], question: `質問です。${'あ'.repeat(200)}` });

test('暴走した質問や途中で切れた出力は呼び直し、本人には見せない', async () => {
  const asked = [];
  const client = sequenceClient([{ text: BROKEN }, { text: '{"action":"ask","ga', stop: 'max_tokens' }, { text: GOOD }, { text: FINISH }]);
  const transcript = await runInterview({
    survey: input.survey,
    gaps: gapsOutput,
    api: client,
    record: () => {},
    askTanaka: async (question) => {
      asked.push(question);
      return { answer: '回答', status: 'answered' };
    },
  });
  assert.deepEqual(asked, ['良い質問です']);
  assert.equal(transcript.entries.length, 1);
});

test('3回続けて失敗したら止める。回答の拒否は呼び直さない', async () => {
  const askTanaka = async () => assert.fail('質問されない');
  const options = { survey: input.survey, gaps: gapsOutput, record: () => {}, askTanaka };
  const broken = sequenceClient([{ text: BROKEN }]);
  await assert.rejects(runInterview({ ...options, api: broken }), /長すぎます/);
  assert.equal(broken.count, 3);
  const refused = sequenceClient([{ text: '', stop: 'refusal' }]);
  await assert.rejects(runInterview({ ...options, api: refused }), /拒否/);
  assert.equal(refused.count, 1);
});

test('採点は不自然な質問を数える', async () => {
  const summary = summarizeInterview(scoreInterview({ entries: [] }, answers.gaps, { facts: hidden }), {
    entries: [
      { id: 'INT-001', status: 'answered', question: '良い質問です', answer: 'a', covers: ['CHK-01'] },
      { id: 'INT-002', status: 'answered', question: 'あ'.repeat(151), answer: 'a', covers: ['CHK-01'] },
    ],
  });
  assert.deepEqual(summary.bad_questions, ['INT-002']);
});

test('回答にパスワードの本体があれば記録しない。保管場所は記録できる', () => {
  const next = { action: 'ask', gap: 'GAP-001', covers: ['CHK-01'], question: '質問' };
  const args = { next, status: 'answered', answeredAt: 'x' };
  assert.throws(() => appendEntry(emptyTranscript('c'), { ...args, answer: 'パスワードは abcd1234 です' }), /保管場所/);
  assert.equal(appendEntry(emptyTranscript('c'), { ...args, answer: 'パスワードの控えは総務課の書庫にあります' }).entries.length, 1);
  assert.equal(hasCredential('保管場所は書庫です'), false);
});

test('live の聞き取りは --from がなければ指定の誤りになる', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hikitsugi-agents-'));
  try {
    const options = { set: 'okojo', setDir: SET, target: 'interview', adapter: 'live', resultsRoot: dir, runId: 'x', client: fakeClient(() => ({})) };
    await assert.rejects(runEval(options), UsageError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('聞き取りを通しで実行すると、形式の検査を通って採点され、呼び出しの費用が残る', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hikitsugi-agents-'));
  try {
    const fromPath = join(dir, 'gaps.json');
    writeFileSync(fromPath, JSON.stringify(gapsOutput));
    const client = fakeClient((params, n) => {
      if (params.model === 'claude-haiku-5-5') return { fact_ids: ['F-01'] };
      return n < 5 ? { action: 'ask', gap: 'GAP-001', covers: ['CHK-01'], question: '質問' } : { action: 'finish', gap: '', covers: [], question: '' };
    });
    const result = await runEval({ set: 'okojo', setDir: SET, target: 'interview', adapter: 'live', resultsRoot: dir, runId: 'x', client, fromPath });
    assert.equal(result.status, 'ok', JSON.stringify(result.errors));
    assert.ok(result.summary.questions >= 1);
    assert.ok(result.api.calls.some((call) => call.agent === 'mock-tanaka'));
    assert.ok(JSON.parse(readFileSync(join(result.dir, 'output.json'), 'utf8')).entries.length >= 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Sonnet と Haiku の費用を単価どおりに計算する', () => {
  const million = { input_tokens: 1_000_000, output_tokens: 1_000_000 };
  assert.equal(costOf('claude-sonnet-5-5', million), 12);
  assert.equal(costOf('claude-haiku-5-5', million), 0.6);
  assert.equal(costOf('claude-sonnet-5-5', { cache_read_input_tokens: 1_000_000 }), 0.1);
});

test('構造化出力のスキーマは正本から作り、受け付けないキーワードを含まない', () => {
  const text = JSON.stringify(responseSchema('gaps', ['coverage', 'gaps']));
  for (const keyword of ['$comment', '"minLength"', '"minimum"']) assert.ok(!text.includes(keyword), keyword);
});

// ---- プロンプトへの混入 ----

const NGRAM = 10;
const collect = (value, out = []) => {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collect(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collect(v, out));
  return out;
};
const agentFiles = [
  ...readdirSync(join(ROOT, 'plugin/agents')).map((name) => join(ROOT, 'plugin/agents', name)),
  ...readdirSync(join(ROOT, 'eval/agents')).map((name) => join(ROOT, 'eval/agents', name)),
];

test('すべてのエージェントのプロンプトに、評価セットの文と値が混ざっていない', () => {
  // 判定の名前や状態の名前はスキーマの語で、正解データにも同じ語がある。これは内容の混入ではないので除く
  const schemaWords = /dangerous|contradiction|unsupported|correct|answered|unknown|filled|partial|check_first|Microsoft 365/g;
  const grams = new Set();
  for (const source of collect([input.statements, input.transcript, input.survey, answers, hidden])) {
    for (let i = 0; i + NGRAM <= source.length; i += 1) grams.add(source.slice(i, i + NGRAM));
  }
  for (const file of agentFiles) {
    const text = readFileSync(file, 'utf8').replace(schemaWords, '');
    const leaked = [];
    for (let i = 0; i + NGRAM <= text.length; i += 1) if (grams.has(text.slice(i, i + NGRAM))) leaked.push(text.slice(i, i + NGRAM));
    assert.deepEqual(leaked, [], file);
  }
});

test('すべてのエージェントのプロンプトに、架空の社名や値の形が混ざっていない', () => {
  for (const file of agentFiles) {
    const text = readFileSync(file, 'utf8');
    for (const name of ['オコジョ', 'クズリ', 'キノドテン', 'ラーテル', 'ケナガ', 'クロテン', 'カワウソ', 'イタチ', 'イイズナ', 'フェレット', '田中', '佐藤']) {
      assert.ok(!text.includes(name), `${file}: ${name}`);
    }
    assert.ok(!/03-0000-01\d\d|192\.168\.|\.example/.test(text), file);
  }
});
