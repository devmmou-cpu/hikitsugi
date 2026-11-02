// live アダプターのテスト。偽のクライアントを使い、API は呼ばない。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '../plugin/lib/validate.mjs';
import { getAdapter } from '../eval/lib/adapters/index.mjs';
import { buildVerifierRequest, LIVE_MODEL, loadVerifierAgent, verifierResponseSchema } from '../eval/lib/adapters/live.mjs';
import { CREDENTIAL } from '../eval/lib/integrity.mjs';
import { loadAnswers, loadHidden, loadInput, readJson } from '../eval/lib/load-set.mjs';
import { costOf } from '../eval/lib/pricing.mjs';
import { maskCredentials, runEval, UsageError } from '../eval/lib/runner.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SET = join(ROOT, 'eval/sets/okojo');
const input = loadInput(SET);
const statements = input.statements.statements;

const USAGE = { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

const textMessage = (text, overrides = {}) => ({
  id: 'msg_test',
  model: LIVE_MODEL,
  stop_reason: 'end_turn',
  usage: USAGE,
  content: [{ type: 'thinking', thinking: '' }, { type: 'text', text }],
  ...overrides,
});

const allCorrect = () =>
  JSON.stringify({
    results: statements.map((s) => ({ statement: s.id, verdict: 'correct', reason: '裏づけあり', checked: [], conflicts_with: [] })),
  });

/** 偽のクライアント。受け取ったリクエストを sent に残す。 */
function fakeClient(reply, { countError } = {}) {
  const sent = [];
  return {
    sent,
    messages: {
      countTokens: async () => {
        if (countError) throw countError;
        return { input_tokens: 1234 };
      },
      stream: (params) => {
        sent.push(params);
        return {
          finalMessage: async () => {
            if (reply instanceof Error) throw reply;
            return reply;
          },
        };
      },
    },
  };
}

async function runLive(client) {
  const resultsRoot = mkdtempSync(join(tmpdir(), 'hikitsugi-live-'));
  try {
    const result = await runEval({ set: 'okojo', setDir: SET, target: 'verifier', adapter: 'live', resultsRoot, runId: 'test', client });
    const files = {
      summary: JSON.parse(readFileSync(join(result.dir, 'summary.json'), 'utf8')),
      errors: readFileSync(join(result.dir, 'errors.jsonl'), 'utf8'),
      raw: (() => {
        try {
          return readFileSync(join(result.dir, 'raw-output.txt'), 'utf8');
        } catch {
          return null;
        }
      })(),
    };
    return { result, files };
  } finally {
    rmSync(resultsRoot, { recursive: true, force: true });
  }
}

test('live は answers と hidden に触れない', async () => {
  const forbidden = (name) => ({
    get() {
      throw new Error(`${name} を読みました`);
    },
    enumerable: true,
  });
  const client = fakeClient(textMessage(allCorrect()));
  const context = Object.defineProperties({ input, client, record() {} }, { answers: forbidden('answers'), hidden: forbidden('hidden') });
  const output = await getAdapter('verifier', 'live')(context);
  assert.equal(output.results.length, statements.length);
});

test('リクエストに正解のデータが混ざらず、記述の ID と本文は入る', () => {
  const body = JSON.stringify(buildVerifierRequest(input));
  const answers = loadAnswers(SET).verifier.statements;
  for (const answer of answers) assert.ok(body.includes(answer.id));
  for (const key of ['"expected"', '"kind"', '"support"', '"error"']) assert.ok(!body.includes(key), key);
  for (const statement of statements) assert.ok(body.includes(JSON.stringify(statement.text).slice(1, -1)));
});

test('リクエストは定義どおりのモデルと effort を使い、sampling と fallbacks を送らない', () => {
  const request = buildVerifierRequest(input);
  assert.equal(request.model, 'claude-opus-5-5');
  assert.equal(request.output_config.effort, 'high');
  assert.deepEqual(request.thinking, { type: 'adaptive' });
  assert.equal(request.system, loadVerifierAgent().prompt);
  for (const key of ['temperature', 'top_p', 'top_k', 'fallbacks']) assert.ok(!(key in request), key);
});

test('構造化出力のスキーマは正本から作り、API が受け付けないキーワードを含まない', () => {
  const schema = verifierResponseSchema();
  const text = JSON.stringify(schema);
  for (const keyword of ['$comment', '"minimum"', '"maximum"', '"minLength"', '"maxLength"']) assert.ok(!text.includes(keyword), keyword);
  const full = readJson(join(ROOT, 'plugin/schemas/verification.schema.json'));
  assert.deepEqual(schema.properties.results.items.properties.verdict, full.properties.results.items.properties.verdict);
  assert.deepEqual(schema.required, ['results']);
});

test('正常な応答：採点まで進み、使用量と費用を記録する', async () => {
  const client = fakeClient(textMessage(allCorrect()));
  const { result, files } = await runLive(client);
  assert.equal(result.status, 'ok');
  assert.equal(result.summary.detection_rate, 0);
  assert.equal(result.summary.complete, true);
  assert.equal(client.sent.length, 1);
  const call = files.summary.api.calls[0];
  assert.equal(call.input_tokens_estimate, 1234);
  assert.equal(call.served_model, LIVE_MODEL);
  assert.equal(call.fallbacks, false);
  assert.match(call.prompt_sha256, /^[0-9a-f]{64}$/);
  assert.equal(files.summary.api.input_tokens, 1000);
  assert.equal(files.summary.api.output_tokens, 500);
  assert.equal(files.summary.api.cost_usd, 0.014);
  assert.equal(files.summary.label, '模擬評価');
  assert.ok(!('raw_text' in call));
});

test('回答のない記述は unanswered になり、正しいとは数えない', async () => {
  const partial = JSON.parse(allCorrect());
  partial.results.pop();
  const { result } = await runLive(fakeClient(textMessage(JSON.stringify(partial))));
  assert.equal(result.status, 'ok');
  assert.equal(result.summary.unanswered, 1);
  assert.equal(result.summary.complete, false);
  assert.equal(result.summary.correct_answered + result.summary.seeded, statements.length - (result.rows.at(-1).kind === 'correct' ? 1 : 0));
});

for (const [name, reply, stage] of [
  ['拒否', textMessage('', { stop_reason: 'refusal', stop_details: { category: 'cyber' } }), 'refusal'],
  ['長さの上限', textMessage('{"results":[', { stop_reason: 'max_tokens' }), 'incomplete'],
  ['JSON でない出力', textMessage('これは JSON ではありません'), 'parse'],
  ['別のモデルの回答', textMessage(allCorrect(), { model: 'claude-opus-5' }), 'model'],
]) {
  test(`${name}：採点せずに errors へ回し、費用は残す`, async () => {
    const { result, files } = await runLive(fakeClient(reply));
    assert.equal(result.status, 'error');
    assert.equal(result.summary, null);
    assert.deepEqual(result.rows, []);
    assert.equal(JSON.parse(files.errors.trim()).stage, stage);
    assert.equal(files.summary.api.input_tokens, 1000);
  });
}

test('形式の違う出力：スキーマの検査で止まる', async () => {
  const { result, files } = await runLive(fakeClient(textMessage('{"results":[{"statement":"S-01"}]}')));
  assert.equal(result.status, 'error');
  assert.equal(JSON.parse(files.errors.trim()).stage, 'schema');
});

test('通信の失敗：採点せず、費用は不明として残す', async () => {
  const { result, files } = await runLive(fakeClient(Object.assign(new Error('切断'), { status: 529, requestID: 'req_x' })));
  assert.equal(result.status, 'error');
  assert.equal(result.summary, null);
  const error = JSON.parse(files.errors.trim());
  assert.equal(error.stage, 'network');
  assert.match(error.message, /HTTP 529/);
  assert.match(error.message, /req_x/);
  assert.equal(files.summary.api.cost_usd, null);
});

test('入力量の確認で失敗したら本体を呼ばず、費用は 0', async () => {
  const client = fakeClient(textMessage(allCorrect()), { countError: Object.assign(new Error('認証エラー'), { status: 401 }) });
  const { result, files } = await runLive(client);
  assert.equal(result.status, 'error');
  assert.equal(client.sent.length, 0);
  assert.equal(files.summary.api.cost_usd, 0);
});

test('生の出力に認証情報が書き写されていたら伏せて保存する', async () => {
  const value = statements.flatMap((s) => [...s.text.matchAll(CREDENTIAL)]).map((m) => m[1])[0];
  assert.ok(value);
  const echoed = JSON.parse(allCorrect());
  echoed.results[0].reason = `本文に ${value} が書かれている`;
  const { result, files } = await runLive(fakeClient(textMessage(JSON.stringify(echoed))));
  assert.equal(result.status, 'ok');
  assert.ok(!files.raw.includes(value));
  assert.ok(files.raw.includes('[伏せ字]'));
  assert.equal(files.summary.api.calls[0].credentials_masked, 1);
});

test('伏せ字：「パスワードは」の形も伏せる', () => {
  const { masked, count } = maskCredentials('パスワードは abcd1234 です');
  assert.equal(masked, 'パスワードは [伏せ字] です');
  assert.equal(count, 1);
});

test('費用：単価どおりに計算し、表にないモデルは不明にする', () => {
  assert.equal(
    costOf('claude-opus-5-5', { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 }),
    29.2,
  );
  assert.equal(costOf('未知のモデル', USAGE), null);
});

test('キーがなければ API を呼ばず、指定の誤りとして止まる', async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    await assert.rejects(runLive(undefined), UsageError);
  } finally {
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  }
});

test('コマンド：キーがなければ終了コード 2 で案内を出す', () => {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  const result = spawnSync(process.execPath, [join(ROOT, 'eval/run.mjs'), '--set', 'okojo', '--target', 'verifier', '--adapter', 'live'], { encoding: 'utf8', env });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--env-file/);
});

// ---- プロンプトに評価セットの内容が混ざっていないこと ----

const NGRAM = 10;
const collectStrings = (value, out = []) => {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectStrings(v, out));
  return out;
};

test('Verifier のプロンプトに評価セットの文が混ざっていない', () => {
  // 判定の名前はスキーマの語で、正解データにも同じ語がある。これは内容の混入ではないので除く
  const agentText = readFileSync(join(ROOT, 'plugin/agents/verifier.md'), 'utf8').replace(/dangerous|contradiction|unsupported|correct/g, '');
  const sources = collectStrings([input.statements, input.transcript, input.survey, loadAnswers(SET), loadHidden(SET)]);
  const grams = new Set();
  for (const source of sources) {
    for (let i = 0; i + NGRAM <= source.length; i += 1) grams.add(source.slice(i, i + NGRAM));
  }
  const leaked = [];
  for (let i = 0; i + NGRAM <= agentText.length; i += 1) {
    const gram = agentText.slice(i, i + NGRAM);
    if (grams.has(gram)) leaked.push(gram);
  }
  assert.deepEqual(leaked, []);
});

test('Verifier のプロンプトに架空の社名や人名、値の形が混ざっていない', () => {
  const agentText = readFileSync(join(ROOT, 'plugin/agents/verifier.md'), 'utf8');
  for (const name of ['オコジョ', '田中', '佐藤', 'クロテン', 'カワウソ', 'イタチ', 'イイズナ', 'フェレット']) {
    assert.ok(!agentText.includes(name), name);
  }
  assert.ok(!/03-0000-01\d\d/.test(agentText));
  assert.ok(!/192\.168\./.test(agentText));
  assert.ok(!/okojo/i.test(agentText));
  assert.ok(!/(?<![0-9A-Za-z])E(?:[1-9]|10)(?![0-9A-Za-z])/.test(agentText));
  assert.ok(!/(?:INV|INT|PUB|STM)-\d|S-\d\d/.test(agentText));
});

test('Verifier の定義はプラグインの frontmatter の形を満たす', () => {
  const { frontmatter, prompt } = loadVerifierAgent();
  assert.equal(frontmatter.name, 'verifier');
  assert.ok(frontmatter.description.length > 0);
  assert.equal(frontmatter.model, 'opus');
  assert.equal(frontmatter.tools, 'Read');
  assert.ok(prompt.startsWith('あなたは'));
  for (const verdict of ['dangerous', 'contradiction', 'unsupported', 'correct']) assert.ok(prompt.includes(`\`${verdict}\``));
});

test('正解をそのまま返す偽の応答は、形式の検査を通って検出率 100%', async () => {
  const answers = loadAnswers(SET).verifier.statements;
  const reply = JSON.stringify({
    results: answers.map((a) => ({ statement: a.id, verdict: a.expected, reason: '', checked: [], conflicts_with: [] })),
  });
  const { result } = await runLive(fakeClient(textMessage(reply)));
  assert.equal(result.summary.detection_rate, 100);
  assert.equal(result.summary.false_positive_rate, 0);
  const output = { schema_version: 1, company: input.survey.company, round: 1, results: JSON.parse(reply).results };
  assert.deepEqual(validate(readJson(join(ROOT, 'plugin/schemas/verification.schema.json')), output), []);
});
