#!/usr/bin/env node
// 調査データから取扱説明書までを API で1本通す評価。各段階の出力を保存し、--resume で続きから再開できる。
// 差し戻しは最大2回。Verifier が合格しなければ、表示プログラムには渡さない。
// 終了コード：0＝合格して HTML まで完了、1＝失敗または不合格、2＝指定の誤り

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildRevision, prepareForRender, summarizeVerification } from '../plugin/lib/handover.mjs';
import { validate } from '../plugin/lib/validate.mjs';
import { renderManual } from '../plugin/renderer/render.mjs';
import { clientOf, runGapFinderLive, runVerifierLive } from './lib/adapters/live.mjs';
import { UsageError } from './lib/adapters/errors.mjs';
import { runInterviewLive } from './lib/interview-loop.mjs';
import { loadAnswers, loadCase, loadHidden, loadInput, readJson } from './lib/load-set.mjs';
import { maskCredentials } from './lib/runner.mjs';
import * as gapsScorer from './lib/scorers/gaps.mjs';
import * as interviewScorer from './lib/scorers/interview.mjs';
import * as manualScorer from './lib/scorers/manual.mjs';
import { runEditorLive, runWriterLive } from './lib/writing.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const MAX_RESENDS = 2;

const schemaCheck = (name, value) => {
  const problems = validate(readJson(join(ROOT, 'plugin/schemas', `${name}.schema.json`)), value);
  if (problems.length) throw new Error(`${name} の形式が違います：${problems.slice(0, 5).join(' / ')}`);
  return value;
};

/**
 * 通しの評価を実行する。
 * @param client テストでは偽物を渡す
 * @param dir 出力先。すでにある段階の出力は再利用する
 */
export async function runPipeline({ set, setDir, dir, client, final = false }) {
  const info = loadCase(setDir);
  if (info.split === 'holdout' && !final) {
    throw new UsageError(`${set} は保留の会社です。最終確認のときだけ --final を付けて実行してください`);
  }
  const input = loadInput(setDir);
  const survey = input.survey;
  // 正解と隠し設定は採点と模擬の田中さんにだけ使い、エージェントには渡さない
  const answers = loadAnswers(setDir);
  const hidden = loadHidden(setDir).facts;
  mkdirSync(dir, { recursive: true });
  const api = await clientOf(client);

  const callsPath = join(dir, 'calls.json');
  const calls = existsSync(callsPath) ? JSON.parse(readFileSync(callsPath, 'utf8')) : [];
  let stage = 'start';
  const record = ({ raw_text: rawText, ...call }) => {
    const masked = rawText === undefined ? null : maskCredentials(rawText, input);
    calls.push({ ...call, stage, ...(masked ? { credentials_masked: masked.count } : {}) });
    writeFileSync(callsPath, JSON.stringify(calls, null, 2) + '\n');
  };
  const pathOf = (name) => join(dir, `${name}.json`);
  const save = (name, value) => {
    writeFileSync(pathOf(name), maskCredentials(JSON.stringify(value, null, 2), input).masked + '\n');
    return value;
  };
  /** 保存済みの段階は呼び直さない。止まったところから再開するため。 */
  const once = async (name, schema, run) => {
    stage = name;
    if (existsSync(pathOf(name))) return readJson(pathOf(name));
    const value = await run();
    return save(name, schema ? schemaCheck(schema, value) : value);
  };

  const summary = { set, split: info.split, label: '模擬評価', stages: {}, rounds: [], status: 'running' };
  const finish = (status, extra = {}) => {
    const agents = {};
    for (const call of calls) {
      const entry = (agents[call.agent] ??= { calls: 0, input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0, cost_usd: 0 });
      entry.calls += 1;
      for (const key of ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens']) entry[key] += call.usage?.[key] ?? 0;
      entry.cost_usd = call.cost_usd === null || entry.cost_usd === null ? null : entry.cost_usd + call.cost_usd;
    }
    const costs = calls.map((call) => call.cost_usd);
    Object.assign(summary, extra, { status, agents, cost_usd: costs.includes(null) ? null : costs.reduce((a, b) => a + b, 0) });
    writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
    return summary;
  };

  try {
    const gaps = await once('gaps', 'gaps', () => runGapFinderLive({ survey, client: api, record }));
    summary.stages.gaps = gapsScorer.summarize(gapsScorer.score(gaps, answers.gaps, input));

    const transcript = await once('transcript', 'transcript', () => runInterviewLive({ survey, gaps, hidden, client: api, record }));
    summary.stages.interview = interviewScorer.summarize(interviewScorer.score(transcript, answers.gaps, { facts: hidden }), transcript);

    const context = { survey, transcript };
    let revision;
    let lastFindings = [];
    for (let round = 1; round <= MAX_RESENDS + 1; round += 1) {
      const written = await once(`manual-${round}-writer`, 'manual', () =>
        runWriterLive({ survey, transcript, companyName: info.name, revision, client: api, record }),
      );
      const edited = await once(`manual-${round}-editor`, null, () =>
        runEditorLive({ manual: written, survey, transcript, client: api, record }),
      );
      const manual = schemaCheck('manual', edited.manual);
      const verification = await once(`verification-${round}`, 'verification', () =>
        runVerifierLive({
          input: { survey, transcript, statements: { schema_version: 1, company: survey.company, statements: manual.statements } },
          client: api,
          record,
          round,
        }),
      );
      const result = summarizeVerification(verification, manual);
      const scores = manualScorer.summarize(manualScorer.score(manual, null, context));
      summary.rounds.push({ round, counts: result.counts, unanswered: result.unanswered, fact_changes_reverted: edited.changes.length, manual: scores });

      if (result.passed) {
        const { manual: forRender, omitted } = prepareForRender(manual);
        save('manual-final', manual);
        writeFileSync(join(dir, 'manual.html'), renderManual(forRender));
        return finish('passed', { resends: round - 1, omitted });
      }
      revision = buildRevision(manual, result.findings);
      lastFindings = result.findings;
    }
    return finish('not_passed', { resends: MAX_RESENDS, unresolved: lastFindings.map((f) => ({ statement: f.statement, verdict: f.verdict })) });
  } catch (error) {
    if (error instanceof UsageError) throw error;
    return finish('error', { failed_stage: stage, error: maskCredentials(error.message, input).masked });
  }
}

async function main() {
  const { values } = parseArgs({
    options: { set: { type: 'string' }, resume: { type: 'string' }, final: { type: 'boolean' }, 'results-dir': { type: 'string' } },
  });
  if (!values.set) throw new UsageError('使い方：node --env-file=.env eval/pipeline.mjs --set <会社> [--resume <フォルダ>] [--final]');
  const setDir = join(ROOT, 'eval/sets', values.set);
  if (!existsSync(setDir)) throw new UsageError(`評価セットがありません: ${values.set}`);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
  const dir = values.resume ?? join(values['results-dir'] ?? join(ROOT, 'eval/results'), `${stamp}-${values.set}-pipeline`);
  const summary = await runPipeline({ set: values.set, setDir, dir, final: values.final ?? false });
  console.log(JSON.stringify(summary, null, 2));
  console.log(`保存先：${dir}`);
  return summary.status === 'passed' ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exitCode = await main();
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(error.message);
    process.exitCode = 2;
  }
}
