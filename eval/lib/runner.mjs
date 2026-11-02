// 評価の実行。出力を用意し、形式を検査し、採点して結果を保存する。
// 通信、解析、形式の失敗は errors.jsonl に分け、0点と混ぜない。

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '../../plugin/lib/validate.mjs';
import { getAdapter, NotImplementedError, UsageError } from './adapters/index.mjs';
import { loadAnswers, loadHidden, loadInput, readJson } from './load-set.mjs';
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
 * 1回分の評価を実行して結果を保存する。
 * 設定の誤り（UsageError）と未実装（NotImplementedError）は実行として記録せず、そのまま投げる。
 */
export async function runEval({ set, setDir, target, adapter: adapterName, outputPath, resultsRoot, runId }) {
  const spec = TARGETS[target];
  if (!spec) throw new UsageError(`${target} という対象はありません（使えるもの：${targetNames.join('、')}）`);
  const adapter = getAdapter(target, adapterName);

  const context = {
    input: loadInput(setDir),
    answers: loadAnswers(setDir),
    hidden: loadHidden(setDir),
    outputPath,
  };
  const meta = { set, target, adapter: adapterName, run_id: runId, label: '模擬評価' };

  let rows = [];
  let summary = null;
  const errors = [];
  const fail = (stage, error) => errors.push({ ...meta, stage, message: error.message });

  let output;
  try {
    output = await adapter(context);
  } catch (error) {
    if (error instanceof UsageError || error instanceof NotImplementedError) throw error;
    fail('adapter', error);
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
  const dir = join(resultsRoot, runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'summary.json'), JSON.stringify(result, null, 2) + '\n');
  writeFileSync(join(dir, 'results.jsonl'), toJsonl(rows));
  writeFileSync(join(dir, 'errors.jsonl'), toJsonl(errors));
  return { ...result, rows, errors, dir };
}
