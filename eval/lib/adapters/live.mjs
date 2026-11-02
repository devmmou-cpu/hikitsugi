// API を呼ぶアダプターの共通部分。エージェント定義（plugin/agents/*.md）を読み、1回呼び出して JSON を返す。
// 各エージェントのアダプターは、loadInput の結果など、渡してよいものだけを受け取る。
// SDK は実行時にだけ読み込むので、npm test は依存なしで動く。

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { costOf } from '../pricing.mjs';
import { UsageError } from './errors.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

// 評価では別名のままにせず、モデルを固定する。結果を比べられるようにするため
const MODELS = { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5' };
export const LIVE_MODEL = MODELS.opus;
// 上限に達しても 1 回あたりの費用が小さく、thinking の分も収まる長さにする
const MAX_TOKENS = 64000;
// 構造化出力が受け付けないキーワード。残すと API が 400 を返す
const UNSUPPORTED_KEYWORDS = new Set(['$comment', 'minimum', 'maximum', 'minLength', 'maxLength']);

/** 失敗した段階を持つ例外。ランナーはこの段階で errors.jsonl に記録する。 */
export class LiveFailure extends Error {
  constructor(stage, message) {
    super(message);
    this.stage = stage;
  }
}

/** エージェント定義のファイルを、frontmatter と本文（システムプロンプト）に分ける。 */
export function parseAgent(text) {
  const match = /^---\n([\s\S]*?)\n---\n+([\s\S]*)$/.exec(text);
  if (!match) throw new Error('エージェント定義に frontmatter がありません');
  const frontmatter = {};
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':');
    if (colon > 0) frontmatter[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return { frontmatter, prompt: match[2].trim() };
}

/** エージェント定義を読む。path はリポジトリの根からの相対パス。 */
export const loadAgent = (path) => parseAgent(readFileSync(join(ROOT, path), 'utf8'));
export const loadVerifierAgent = () => loadAgent('plugin/agents/verifier.md');
export const modelOf = (agent) => {
  const model = MODELS[agent.frontmatter.model];
  if (!model) throw new Error(`モデルの指定が違います: ${agent.frontmatter.model}`);
  return model;
};

function stripUnsupported(schema) {
  if (Array.isArray(schema)) return schema.map(stripUnsupported);
  if (schema === null || typeof schema !== 'object') return schema;
  return Object.fromEntries(
    Object.entries(schema)
      .filter(([key]) => !UNSUPPORTED_KEYWORDS.has(key))
      .map(([key, value]) => [key, stripUnsupported(value)]),
  );
}

/**
 * モデルに書かせる部分のスキーマを、正本の plugin/schemas から作る。
 * schema_version や company など、プログラムが付ける項目は keys に含めない。
 */
export function responseSchema(name, keys) {
  const full = JSON.parse(readFileSync(join(ROOT, 'plugin/schemas', `${name}.schema.json`), 'utf8'));
  return {
    type: 'object',
    additionalProperties: false,
    required: keys,
    properties: Object.fromEntries(keys.map((key) => [key, stripUnsupported(full.properties[key])])),
  };
}

export const verifierResponseSchema = () => responseSchema('verification', ['results']);

/** 入力を、名前つきの区切りで並べる。 */
export const tagged = (sections) =>
  Object.entries(sections)
    .map(([tag, value]) => `<${tag}>\n${typeof value === 'string' ? value : JSON.stringify(value)}\n</${tag}>`)
    .join('\n\n');

/** エージェント定義から、Messages API のリクエストを組み立てる。 */
export function buildRequest(agent, schema, content) {
  return {
    model: modelOf(agent),
    max_tokens: MAX_TOKENS,
    system: agent.prompt,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: agent.frontmatter.effort,
      format: { type: 'json_schema', schema },
    },
    messages: [{ role: 'user', content }],
  };
}

/** リクエストを組み立てる。引数は input だけなので、正解を混ぜることができない。 */
export function buildVerifierRequest(input, agent = loadVerifierAgent()) {
  const content = `${tagged({ survey: input.survey, transcript: input.transcript, statements: input.statements })}\n\nstatements のすべての記述を検証してください。`;
  return buildRequest(agent, verifierResponseSchema(), content);
}

async function defaultClient() {
  // Console のキーだけを使う。空のまま SDK に任せると、別の認証情報に切り替わることがある
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new UsageError('ANTHROPIC_API_KEY がありません。node --env-file=.env eval/run.mjs ... で実行してください（docs/api-key-setup.md）');
  }
  let Anthropic;
  try {
    ({ default: Anthropic } = await import('@anthropic-ai/sdk'));
  } catch {
    throw new UsageError('SDK が入っていません。cd eval && npm ci --ignore-scripts を実行してください');
  }
  return new Anthropic({ apiKey });
}

/** 渡されたクライアント、なければ SDK のクライアントを返す。 */
export const clientOf = async (client) => client ?? (await defaultClient());

const describeApiError = (error) => {
  const status = error?.status ? `HTTP ${error.status}：` : '';
  const requestId = error?.requestID ? `（request id：${error.requestID}）` : '';
  return `${status}${error?.message ?? String(error)}${requestId}`;
};

const textOf = (message) =>
  message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');

/**
 * エージェントを1回呼び出し、JSON を解析して返す。
 * 使用量、費用、生の出力は、失敗したときも record に渡す。
 * @param estimate 入力量を先に確かめるか。繰り返し呼ぶエージェントでは省く
 */
export async function callAgent({ api, agent, params, record = () => {}, estimate = true }) {
  const call = {
    agent: agent.frontmatter.name,
    requested_model: params.model,
    effort: params.output_config.effort,
    max_tokens: params.max_tokens,
    fallbacks: false,
    prompt_sha256: createHash('sha256').update(agent.prompt).digest('hex'),
  };
  const started = Date.now();

  if (estimate) {
    // 入力量の確認は無料。キーの誤りもここで分かる
    try {
      const { model, system, thinking, output_config, messages } = params;
      const { input_tokens: tokens } = await api.messages.countTokens({ model, system, thinking, output_config, messages });
      call.input_tokens_estimate = tokens;
    } catch (error) {
      record({ ...call, status: 'not_sent', cost_usd: 0 });
      throw new LiveFailure('network', `入力量の確認に失敗しました。${describeApiError(error)}`);
    }
  }

  let message;
  try {
    message = await api.messages.stream(params).finalMessage();
  } catch (error) {
    // 途中で切れた場合は使用量が分からない。費用は 0 ではなく不明として残す
    record({ ...call, status: 'failed', cost_usd: null, duration_ms: Date.now() - started });
    throw new LiveFailure('network', `API の呼び出しに失敗しました。${describeApiError(error)}`);
  }

  const raw = textOf(message);
  record({
    ...call,
    status: 'completed',
    served_model: message.model,
    request_id: message.id,
    stop_reason: message.stop_reason,
    usage: message.usage,
    cost_usd: costOf(message.model, message.usage),
    duration_ms: Date.now() - started,
    raw_text: raw,
  });

  if (message.stop_reason === 'refusal') {
    throw new LiveFailure('refusal', `モデルが回答を拒否しました（区分：${message.stop_details?.category ?? '不明'}）`);
  }
  if (message.stop_reason !== 'end_turn') {
    throw new LiveFailure('incomplete', `出力が完了していません（stop_reason：${message.stop_reason}）`);
  }
  if (message.model !== params.model) {
    throw new LiveFailure('model', `指定と別のモデルが回答しました：${message.model}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new LiveFailure('parse', `出力が JSON ではありません：${error.message}`);
  }
}

/**
 * Verifier を1回実行し、検証結果を返す。
 * @param input loadInput の結果
 * @param client 省略時は SDK のクライアントを作る。テストでは偽物を渡す
 * @param record 呼び出しの記録（使用量、費用、生の出力）を受け取る関数
 */
export async function runVerifierLive({ input, client, record = () => {}, round = 1 }) {
  const api = await clientOf(client);
  const agent = loadVerifierAgent();
  const parsed = await callAgent({ api, agent, params: buildVerifierRequest(input, agent), record });
  return { schema_version: 1, company: input.survey.company, round, results: parsed.results };
}

const CHECKLIST = join(ROOT, 'plugin/checklist/handover-items.json');
export const loadChecklist = () => JSON.parse(readFileSync(CHECKLIST, 'utf8'));

/** Gap Finder のリクエスト。調査データと必須項目だけを渡し、聞き取り記録は渡さない。 */
export function buildGapFinderRequest(survey, checklist = loadChecklist(), agent = loadAgent('plugin/agents/gap-finder.md')) {
  const content = `${tagged({ survey, checklist })}\n\nchecklist のすべての必須項目を判定してください。`;
  return buildRequest(agent, responseSchema('gaps', ['coverage', 'gaps']), content);
}

export async function runGapFinderLive({ survey, client, record = () => {} }) {
  const api = await clientOf(client);
  const agent = loadAgent('plugin/agents/gap-finder.md');
  const parsed = await callAgent({ api, agent, params: buildGapFinderRequest(survey, loadChecklist(), agent), record });
  return { schema_version: 1, company: survey.company, coverage: parsed.coverage, gaps: parsed.gaps };
}
