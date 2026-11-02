// 評価の実行。出力を用意し、形式を検査し、採点して結果を保存する。
// 通信、解析、形式の失敗は errors.jsonl に分け、0点と混ぜない。

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '../../plugin/lib/validate.mjs';
import { getAdapter, NotImplementedError, UsageError } from './adapters/index.mjs';
import { CREDENTIAL } from './integrity.mjs';
import { loadAnswers, loadCase, loadHidden, loadInput, readJson } from './load-set.mjs';
import * as verifier from './scorers/verifier.mjs';
import * as gaps from './scorers/gaps.mjs';
import * as interview from './scorers/interview.mjs';
import * as manual from './scorers/manual.mjs';
import * as troubles from './scorers/troubles.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const schemaFile = (name) => join(ROOT, 'plugin/schemas', `${name}.schema.json`);

const TARGETS = {
  verifier: {
    schema: 'verification',
    score: (output, c) => verifier.score(output, c.answers.verifier),
    summarize: (rows) => verifier.summarize(rows),
  },
  gaps: {
    schema: 'gaps',
    score: (output, c) => gaps.score(output, c.answers.gaps, c.input),
    summarize: (rows) => gaps.summarize(rows),
  },
  interview: {
    schema: 'transcript',
    score: (output, c) => interview.score(output, c.answers.gaps, c.hidden),
    summarize: (rows, output) => interview.summarize(rows, output),
  },
  manual: {
    schema: 'manual',
    score: (output, c) => manual.score(output, null, c.input),
    summarize: (rows) => manual.summarize(rows),
  },
  troubles: {
    // 模擬の後任の出力はプラグインの成果物ではないので、形式は採点器で確かめる
    schema: null,
    score: (output, c) => troubles.score(output, c.answers.troubles),
    summarize: (rows) => troubles.summarize(rows),
  },
};

export const targetNames = Object.keys(TARGETS);
export { NotImplementedError, UsageError };

const toJsonl = (rows) => rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');

/**
 * 認証情報を伏せる。評価用のダミーも、実行結果に書き写さない。
 * 「パスワードは〜」の形に加えて、入力の記述に含まれる値そのものも探す。
 */
export function maskCredentials(text, input) {
  let count = 0;
  let masked = text.replace(CREDENTIAL, (match, value) => {
    count += 1;
    return match.slice(0, match.length - value.length) + '[伏せ字]';
  });
  const statements = input?.statements?.statements ?? [];
  for (const statement of statements) {
    for (const [, value] of statement.text.matchAll(CREDENTIAL)) {
      const parts = masked.split(value);
      count += parts.length - 1;
      masked = parts.join('[伏せ字]');
    }
  }
  return { masked, count };
}

/** API の呼び出しの記録を、保存する形にまとめる。費用が不明な呼び出しがあれば合計も不明にする。 */
function summarizeCalls(calls) {
  const sum = (key) => calls.reduce((total, call) => total + (call.usage?.[key] ?? 0), 0);
  const costs = calls.map((call) => call.cost_usd);
  return {
    calls,
    input_tokens: sum('input_tokens'),
    cache_creation_input_tokens: sum('cache_creation_input_tokens'),
    cache_read_input_tokens: sum('cache_read_input_tokens'),
    output_tokens: sum('output_tokens'),
    cost_usd: costs.includes(null) ? null : costs.reduce((total, cost) => total + cost, 0),
  };
}

/**
 * 1回分の評価を実行して結果を保存する。
 * 設定の誤り（UsageError）と未実装（NotImplementedError）は実行として記録せず、そのまま投げる。
 */
export async function runEval({ set, setDir, target, adapter: adapterName, outputPath, resultsRoot, runId, client, final = false }) {
  const spec = TARGETS[target];
  if (!spec) throw new UsageError(`${target} という対象はありません（使えるもの：${targetNames.join('、')}）`);
  const adapter = getAdapter(target, adapterName);
  // 保留の会社は最終確認にだけ使う。うっかり実行して調整に使わないよう、明示の指定がなければ止める
  const { split } = loadCase(setDir);
  if (split === 'holdout' && !final) {
    throw new UsageError(`${set} は保留の会社です。最終確認のときだけ --final を付けて実行してください`);
  }

  const calls = [];
  const rawTexts = [];
  const context = {
    input: loadInput(setDir),
    answers: loadAnswers(setDir),
    hidden: loadHidden(setDir),
    outputPath,
    client,
    record: ({ raw_text: rawText, ...call }) => {
      if (rawText === undefined) {
        calls.push(call);
        return;
      }
      const { masked, count } = maskCredentials(rawText, context.input);
      rawTexts.push(masked);
      calls.push({ ...call, credentials_masked: count });
    },
  };
  const meta = { set, split, target, adapter: adapterName, run_id: runId, label: '模擬評価' };

  let rows = [];
  let summary = null;
  const errors = [];
  const fail = (stage, error) => errors.push({ ...meta, stage, message: maskCredentials(error.message, context.input).masked });

  let output;
  try {
    output = await adapter(context);
  } catch (error) {
    if (error instanceof UsageError || error instanceof NotImplementedError) throw error;
    fail(error.stage ?? 'adapter', error);
  }

  if (output !== undefined && spec.schema) {
    const problems = validate(readJson(schemaFile(spec.schema)), output);
    if (problems.length) {
      fail('schema', new Error(problems.slice(0, 10).join(' / ')));
      output = undefined;
    }
  }

  if (output !== undefined) {
    try {
      rows = spec.score(output, context);
      summary = spec.summarize(rows, output);
    } catch (error) {
      rows = [];
      summary = null;
      fail('score', error);
    }
  }

  const result = { ...meta, status: errors.length ? 'error' : 'ok', summary };
  // 失敗した実行でも費用はかかるので、API を呼んだら必ず残す
  if (calls.length) result.api = summarizeCalls(calls);
  const dir = join(resultsRoot, runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'summary.json'), JSON.stringify(result, null, 2) + '\n');
  writeFileSync(join(dir, 'results.jsonl'), toJsonl(rows));
  writeFileSync(join(dir, 'errors.jsonl'), toJsonl(errors));
  if (rawTexts.length) writeFileSync(join(dir, 'raw-output.txt'), rawTexts.join('\n') + '\n');
  return { ...result, rows, errors, dir };
}
