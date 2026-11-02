// 評価ランナーのテスト。API を使わず、基準の出力で全体の流れを確かめる。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NotImplementedError, runEval, UsageError } from '../eval/lib/runner.mjs';
import { summarize as summarizeVerifier } from '../eval/lib/scorers/verifier.mjs';
import { loadAnswers } from '../eval/lib/load-set.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SET = join(ROOT, 'eval/sets/okojo');

async function withResults(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'hikitsugi-results-'));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const run = (target, adapter, resultsRoot, extra = {}) =>
  runEval({ set: 'okojo', setDir: SET, target, adapter, resultsRoot, runId: `test-${target}-${adapter}`, ...extra });

for (const [adapter, detection, falsePositive] of [
  ['oracle', 100, 0],
  ['all-correct', 0, 0],
  ['all-flag', 100, 100],
]) {
  test(`Verifier の基準：${adapter} は検出率 ${detection}%、誤検出率 ${falsePositive}%`, () =>
    withResults(async (dir) => {
      const result = await run('verifier', adapter, dir);
      assert.equal(result.status, 'ok');
      assert.equal(result.summary.detection_rate, detection);
      assert.equal(result.summary.false_positive_rate, falsePositive);
    }));
}

test('Gap Finder の基準：oracle は全部 0、all-correct は見落とし 39、all-flag は過剰な指摘 1', () =>
  withResults(async (dir) => {
    const oracle = await run('gaps', 'oracle', dir);
    assert.equal(oracle.summary.missed, 0);
    assert.equal(oracle.summary.over_flagged, 0);
    const allFilled = await run('gaps', 'all-correct', dir);
    assert.equal(allFilled.summary.missed, 39);
    assert.equal(allFilled.summary.false_filled, 39);
    const allGap = await run('gaps', 'all-flag', dir);
    assert.equal(allGap.summary.missed, 0);
    assert.equal(allGap.summary.over_flagged, 1);
  }));

test('Interviewer の基準：oracle は 37/40、empty は調査で埋まる 1/40', () =>
  withResults(async (dir) => {
    assert.equal((await run('interview', 'oracle', dir)).summary.covered, 37);
    assert.equal((await run('interview', 'empty', dir)).summary.covered, 1);
  }));

test('模擬の後任の基準：oracle は 5/5、empty は 0/5', () =>
  withResults(async (dir) => {
    assert.equal((await run('troubles', 'oracle', dir)).summary.passed, 5);
    assert.equal((await run('troubles', 'empty', dir)).summary.passed, 0);
  }));

test('保存した集計は、1件ごとの行から再計算したものと一致する', () =>
  withResults(async (dir) => {
    const result = await run('verifier', 'oracle', dir);
    const saved = JSON.parse(readFileSync(join(result.dir, 'summary.json'), 'utf8'));
    const rows = readFileSync(join(result.dir, 'results.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(saved.summary, summarizeVerifier(rows));
    assert.equal(saved.label, '模擬評価');
  }));

test('保存した出力（fixture）で1件見逃すと 9/10 になる', () =>
  withResults(async (dir) => {
    const answers = loadAnswers(SET).verifier.statements;
    const output = {
      schema_version: 1,
      company: 'okojo',
      round: 1,
      results: answers.map((s) => ({
        statement: s.id,
        verdict: s.error === 'E3' ? 'correct' : s.expected,
        reason: '',
        checked: [],
        conflicts_with: [],
      })),
    };
    const outputPath = join(dir, 'output.json');
    writeFileSync(outputPath, JSON.stringify(output));
    const result = await run('verifier', 'fixture', dir, { outputPath });
    assert.equal(result.summary.detected, 9);
    assert.deepEqual(result.summary.missed_errors, ['E3']);
  }));

test('解析できない出力は errors に回り、0点として記録しない', () =>
  withResults(async (dir) => {
    const outputPath = join(dir, 'broken.json');
    writeFileSync(outputPath, '{ 壊れた JSON');
    const result = await run('verifier', 'fixture', dir, { outputPath });
    assert.equal(result.status, 'error');
    assert.equal(result.summary, null);
    assert.equal(result.errors[0].stage, 'adapter');
    assert.equal(readFileSync(join(result.dir, 'results.jsonl'), 'utf8'), '');
    assert.equal(readFileSync(join(result.dir, 'errors.jsonl'), 'utf8').trim().split('\n').length, 1);
  }));

test('形式が違う出力は errors に回る', () =>
  withResults(async (dir) => {
    const outputPath = join(dir, 'wrong.json');
    writeFileSync(outputPath, JSON.stringify({ results: [{ statement: 'S-01', verdict: 'たぶん' }] }));
    const result = await run('verifier', 'fixture', dir, { outputPath });
    assert.equal(result.status, 'error');
    assert.equal(result.errors[0].stage, 'schema');
  }));

test('採点できない出力（存在しない記述への判定）は errors に回る', () =>
  withResults(async (dir) => {
    const outputPath = join(dir, 'unknown.json');
    writeFileSync(
      outputPath,
      JSON.stringify({
        schema_version: 1,
        company: 'okojo',
        round: 1,
        results: [{ statement: 'S-99', verdict: 'correct', reason: '', checked: [], conflicts_with: [] }],
      }),
    );
    const result = await run('verifier', 'fixture', dir, { outputPath });
    assert.equal(result.status, 'error');
    assert.equal(result.errors[0].stage, 'score');
  }));

test('実行結果に記述の本文を保存しない（ダミーの認証情報が結果に残らない）', () =>
  withResults(async (dir) => {
    const result = await run('verifier', 'oracle', dir);
    const saved = readFileSync(join(result.dir, 'results.jsonl'), 'utf8');
    assert.ok(!saved.includes('パスワード'));
  }));

test('live は未実装で止まり、対応しないアダプターや対象は指定の誤りになる', () =>
  withResults(async (dir) => {
    await assert.rejects(run('verifier', 'live', dir), NotImplementedError);
    await assert.rejects(run('manual', 'oracle', dir), UsageError);
    await assert.rejects(run('存在しない', 'oracle', dir), UsageError);
    await assert.rejects(run('verifier', 'fixture', dir), UsageError);
  }));

function cli(...args) {
  return spawnSync(process.execPath, [join(ROOT, 'eval/run.mjs'), ...args], { encoding: 'utf8' });
}

test('コマンド：oracle は終了コード 0、live は未実装を表示して 2', () =>
  withResults(async (dir) => {
    const ok = cli('--set', 'okojo', '--target', 'verifier', '--adapter', 'oracle', '--results-dir', dir);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /模擬評価/);
    const live = cli('--set', 'okojo', '--target', 'verifier', '--adapter', 'live', '--results-dir', dir);
    assert.equal(live.status, 2);
    assert.match(live.stderr, /未実装/);
  }));

test('コマンド：壊れた出力は終了コード 1、指定の誤りは 2', () =>
  withResults(async (dir) => {
    const outputPath = join(dir, 'broken.json');
    writeFileSync(outputPath, 'x');
    const broken = cli('--set', 'okojo', '--target', 'verifier', '--adapter', 'fixture', '--output', outputPath, '--results-dir', dir);
    assert.equal(broken.status, 1);
    const missing = cli('--set', 'okojo');
    assert.equal(missing.status, 2);
    const noSet = cli('--set', 'nothing', '--target', 'verifier', '--adapter', 'oracle');
    assert.equal(noSet.status, 2);
  }));
