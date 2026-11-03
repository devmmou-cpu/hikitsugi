#!/usr/bin/env node
// 調査データから取扱説明書までを API で1本通す評価。各段階の出力を保存し、--resume で続きから再開できる。
// 差し戻しは最大2回。Verifier が合格しなければ、表示プログラムには渡さない。
// 終了コード：0＝合格して HTML まで完了、1＝失敗または不合格、2＝指定の誤り

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildRevision, carryForward, markReviewed, mergeVerification, prepareForRender, summarizeVerification, UnapprovedPartsError, verificationScope } from '../plugin/lib/handover.mjs';
import { applyRetireeCheck } from '../plugin/lib/retiree-check.mjs';
import { withSearchIndex } from '../plugin/lib/search-index.mjs';
import { validate } from '../plugin/lib/validate.mjs';
import { renderManual } from '../plugin/renderer/render.mjs';
import { withReplies } from '../plugin/lib/reply.mjs';
import { writePhoneBundle } from '../plugin/renderer/phone.mjs';
import { PC_FILE_LIMIT, writeWithinLimit } from '../plugin/lib/limits.mjs';
import { clientOf, runGapFinderLive, runVerifierLive } from './lib/adapters/live.mjs';
import { UsageError } from './lib/adapters/errors.mjs';
import { runInterviewLive } from './lib/interview-loop.mjs';
import { loadAnswers, loadCase, loadHidden, loadInput, readJson } from './lib/load-set.mjs';
import { maskCredentials } from './lib/runner.mjs';
import * as gapsScorer from './lib/scorers/gaps.mjs';
import * as interviewScorer from './lib/scorers/interview.mjs';
import * as manualScorer from './lib/scorers/manual.mjs';
import { runEditorLive, runPhraseWriterLive, runWriterLive } from './lib/writing.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const MAX_RESENDS = 2;
// 評価の会社では、退職するのは田中さん。模擬の田中さんが全ページを「このままでよい」にする設定で進める
const RETIREE = '田中';

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
    // 失敗の原因を調べられるよう、生の出力も残す。認証情報は伏せる
    if (masked) appendFileSync(join(dir, 'raw-output.txt'), `${JSON.stringify({ stage, agent: call.agent, stop_reason: call.stop_reason })}\n${masked.masked}\n`);
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

  const summary = { set, split: info.split, label: '模擬評価', stages: {}, rounds: [], leaks: [], status: 'running' };
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
    let previousManual = null;
    let previousVerification = null;
    for (let round = 1; round <= MAX_RESENDS + 1; round += 1) {
      // ページ単位で書くので、止まっても書き終えた部分はやり直さない
      const pieces = {
        get: (name) => (existsSync(pathOf(`writer-${round}-${name}`)) ? readJson(pathOf(`writer-${round}-${name}`)) : undefined),
        set: (name, value) => save(`writer-${round}-${name}`, value),
      };
      const written = await once(`manual-${round}-writer`, 'manual', () =>
        runWriterLive({ survey, transcript, companyName: info.name, retiree: RETIREE, revision, client: api, record, store: pieces, onLeaks: (leaks) => { summary.leaks.push({ round, ...leaks }); } }),
      );
      const edited = await once(`manual-${round}-editor`, null, () => {
        // 差し戻しでは合格済みの用語の説明を引き継ぎ、変わった文章だけを直す
        const base = previousManual ? carryForward(previousManual, lastFindings, written) : { manual: written };
        return runEditorLive({ manual: base.manual, survey, transcript, retiree: RETIREE, changed: base.changed, client: api, record });
      });
      // 社員に返す文は Editor のあとにプログラムで組み、Verifier にはかける
      const manual = schemaCheck('manual', withReplies(edited.manual));
      // 差し戻しのあとは、変わった文章だけをかけ直す。合格済みの文章のばらつきで止まらないように
      const scope = previousManual ? verificationScope(previousManual, previousVerification, manual) : manual.statements.map((statement) => statement.id);
      const inScope = new Set(scope);
      const judged = await once(`verification-${round}`, 'verification', async () => {
        const fresh = await runVerifierLive({
          input: { survey, transcript, retiree: RETIREE, statements: { schema_version: 1, company: survey.company, statements: manual.statements.filter((statement) => inScope.has(statement.id)) } },
          client: api,
          record,
          round,
        });
        return previousManual ? { ...mergeVerification(previousVerification, fresh.results, manual, scope), round } : fresh;
      });
      // 退職する担当者を連絡先にしている文章は、AI の判定によらず文字列の照合で「危険」にする
      const { verification, hits: retireeHits } = applyRetireeCheck(judged, manual, RETIREE);
      const result = summarizeVerification(verification, manual);
      const scores = manualScorer.summarize(manualScorer.score(manual, null, context));
      summary.rounds.push({ round, verified: scope.length, retiree_hits: retireeHits, counts: result.counts, unanswered: result.unanswered, fact_changes_reverted: edited.changes.length, manual: scores });

      if (result.passed) {
        // 模擬評価。実際の /hikitsugi:start では、前任者がページごとに確認する
        const phrases = await once('search-index', null, () => runPhraseWriterLive({ manual, retiree: RETIREE, client: api, record }));
        const reviewed = withSearchIndex(markReviewed(manual, RETIREE, survey.as_of), phrases);
        summary.search_phrases = reviewed.search_index.reduce((sum, entry) => sum + entry.phrases.length, 0);
        save('manual-final', reviewed);
        summary.review = { mode: '模擬（全ページ このままでよい）', pages: reviewed.symptom_pages.length };
        summary.before_leaving = reviewed.before_leaving?.length ?? 0;
        let prepared;
        try {
          prepared = prepareForRender(reviewed);
        } catch (error) {
          if (error instanceof UnapprovedPartsError) return finish('blocked_unapproved_parts', { resends: round - 1, unapproved_parts: error.parts });
          throw error;
        }
        const { manual: forRender, omitted } = prepared;
        const html = renderManual(forRender);
        const bundle = writePhoneBundle(forRender, join(dir, 'phone'));
        if (writeWithinLimit(join(dir, 'manual.html'), html, PC_FILE_LIMIT) || bundle.blocked.length) return finish('blocked_file_size', { resends: round - 1, omitted });
        return finish('passed', { resends: round - 1, omitted });
      }
      revision = buildRevision(manual, result.findings);
      lastFindings = result.findings;
      previousManual = manual;
      previousVerification = verification;
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
