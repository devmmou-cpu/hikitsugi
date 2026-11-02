#!/usr/bin/env node
// 評価の実行コマンド。
// 終了コード：0＝採点まで完了、1＝出力の異常（errors.jsonl を参照）、2＝指定の誤りや未実装

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { adapterNames } from './lib/adapters/index.mjs';
import { NotImplementedError, runEval, targetNames, UsageError } from './lib/runner.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const HELP = `使い方：
  node eval/run.mjs --set okojo --target <対象> --adapter <アダプター> [--output <ファイル>] [--results-dir <フォルダ>] [--final]

対象とアダプター：
${targetNames.map((t) => `  ${t.padEnd(10)} ${adapterNames(t).join(', ')}`).join('\n')}

保留（holdout）の会社は --final を付けたときだけ実行できます。

アダプター：
  oracle       正解をそのまま返す（採点の仕組みの確認用）
  all-correct  全部「問題なし」と答える（基準の確認用）
  all-flag     全部を指摘する（基準の確認用）
  empty        何も答えない（基準の確認用）
  fixture      保存済みの出力を --output で読み込む
  live         API を呼ぶ（今は verifier だけ）。node --env-file=.env で実行する`;

function main() {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        set: { type: 'string' },
        target: { type: 'string' },
        adapter: { type: 'string' },
        output: { type: 'string' },
        'results-dir': { type: 'string' },
        final: { type: 'boolean' },
        help: { type: 'boolean' },
      },
    }));
  } catch (error) {
    throw new UsageError(error.message);
  }
  if (values.help) {
    console.log(HELP);
    return Promise.resolve(0);
  }
  if (!values.set || !values.target || !values.adapter) throw new UsageError('--set、--target、--adapter は必須です');

  const setDir = join(HERE, 'sets', values.set);
  if (!existsSync(setDir)) throw new UsageError(`評価セットがありません: ${values.set}`);

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
  return runEval({
    set: values.set,
    setDir,
    target: values.target,
    adapter: values.adapter,
    outputPath: values.output,
    final: values.final ?? false,
    resultsRoot: values['results-dir'] ?? join(HERE, 'results'),
    runId: `${stamp}-${values.set}-${values.target}-${values.adapter}`,
  }).then((result) => {
    console.log(`模擬評価 ${result.set} / ${result.target} / ${result.adapter}`);
    if (result.api) {
      const { input_tokens: input, output_tokens: output, cost_usd: cost } = result.api;
      console.log(`使用量：入力 ${input} トークン、出力 ${output} トークン、費用 ${cost === null ? '不明' : `$${cost.toFixed(4)}`}`);
    }
    if (result.status === 'error') {
      for (const error of result.errors) console.error(`失敗（${error.stage}）：${error.message}`);
      console.error(`採点できませんでした。詳細：${join(result.dir, 'errors.jsonl')}`);
      return 1;
    }
    console.log(JSON.stringify(result.summary, null, 2));
    console.log(`保存先：${result.dir}`);
    return 0;
  });
}

try {
  process.exitCode = await main();
} catch (error) {
  if (error instanceof UsageError || error instanceof NotImplementedError) {
    console.error(error.message);
    process.exitCode = 2;
  } else {
    throw error;
  }
}
