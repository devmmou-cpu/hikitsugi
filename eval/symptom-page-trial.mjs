#!/usr/bin/env node
// 症状ページの抜けの検査の「ページにする」を API で1回動かす（模擬評価）。評価セットは変えない。
// 通しの評価の結果から、Writer の最初の一覧に入っていた NAS のディスクのページだけを除いた入力を作る。
// そのページを除く部分は、Editor と Verifier を通った前回の文を引き継ぐ。差し戻しと同じく、変わった文だけをかけ直す。
// 使い方：node --env-file=.env eval/symptom-page-trial.mjs --base <通しの結果のフォルダ> --page T13 [--resume <フォルダ>]

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildRevision, carryForward, markReviewed, mergeVerification, prepareForRender, summarizeVerification, verificationScope } from '../plugin/lib/handover.mjs';
import { applyRetireeCheck } from '../plugin/lib/retiree-check.mjs';
import { validate } from '../plugin/lib/validate.mjs';
import { withoutFlaggedPlace, withReplies, withWindows10Note } from '../plugin/lib/reply.mjs';
import { renderManual } from '../plugin/renderer/render.mjs';
import { clientOf, runVerifierLive } from './lib/adapters/live.mjs';
import { loadCase, loadInput } from './lib/load-set.mjs';
import { maskCredentials } from './lib/runner.mjs';
import { runEditorLive, runWriterLive } from './lib/writing.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RETIREE = '田中';
const SET = 'okojo';
const MAX_RESENDS = 2;
const BUDGET_USD = 1.5;
const SCOPE_LIMIT = 80;

/** ページが使う文の ID。 */
const idsOf = (page) => new Set(JSON.stringify(page).match(/STM-\d+/g) ?? []);

/** 通しの結果から、1ページを除いた Writer の部分を作る。ほかの部分は変えない。 */
export function seedPieces(base, pageId) {
  const read = (name) => JSON.parse(readFileSync(join(base, name), 'utf8'));
  const common = read('writer-1-common.json');
  const plan = common.page_plan.filter((entry) => entry.id !== pageId);
  const pieces = new Map([['common', { ...common, page_plan: plan }]]);
  for (const entry of plan) pieces.set(entry.id, read(`writer-1-${entry.id}.json`));
  return pieces;
}

/** 前回の結果から、除いたページの文と判定を消す。 */
export function withoutPage(manual, verification, pageId) {
  const page = manual.symptom_pages.find((candidate) => candidate.id === pageId);
  const removed = idsOf(page);
  const { search_index: _index, review: _review, ...rest } = manual;
  return {
    manual: { ...rest, symptom_pages: manual.symptom_pages.filter((candidate) => candidate !== page), statements: manual.statements.filter((statement) => !removed.has(statement.id)), glossary: manual.glossary.filter((entry) => !removed.has(entry.company)) },
    verification: { ...verification, results: verification.results.filter((result) => !removed.has(result.statement)) },
    removed,
  };
}

/** Writer の文のうち、前回と同じものは、Editor のあとの文に置き換える。新しく書いた文は Editor に渡す。 */
export function overlayEdited(written, writerBefore, editedBefore, removed) {
  const before = new Map(writerBefore.statements.map((statement) => [statement.id, statement]));
  const edited = new Map(editedBefore.statements.map((statement) => [statement.id, statement]));
  const editedPages = new Map(editedBefore.symptom_pages.map((page) => [page.id, page]));
  const removedPage = new Set(writerBefore.symptom_pages.filter((page) => !editedPages.has(page.id) || [...idsOf(page)].some((id) => removed.has(id))).map((page) => page.id));
  return {
    ...written,
    statements: written.statements.map((statement) => (!removed.has(statement.id) && before.get(statement.id)?.text === statement.text && edited.has(statement.id) ? edited.get(statement.id) : statement)),
    symptom_pages: written.symptom_pages.map((page) => (editedPages.has(page.id) && !removedPage.has(page.id) ? editedPages.get(page.id) : page)),
  };
}

async function main() {
  const { values } = parseArgs({ options: { base: { type: 'string' }, page: { type: 'string' }, resume: { type: 'string' } } });
  if (!values.base || !values.page) throw new Error('使い方：--base <通しの結果のフォルダ> --page <除くページ>');
  const setDir = join(ROOT, 'eval/sets', SET);
  const info = loadCase(setDir);
  const input = loadInput(setDir);
  const { survey } = input;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
  const dir = values.resume ?? join(ROOT, 'eval/results', `${stamp}-${SET}-symptom-page`);
  mkdirSync(dir, { recursive: true });
  const read = (name) => JSON.parse(readFileSync(join(values.base, name), 'utf8'));
  const transcript = read('transcript.json');
  const api = await clientOf();

  const pathOf = (name) => join(dir, `${name}.json`);
  const save = (name, value) => {
    writeFileSync(pathOf(name), maskCredentials(JSON.stringify(value, null, 2), input).masked + '\n');
    return value;
  };
  const saved = (name) => (existsSync(pathOf(name)) ? JSON.parse(readFileSync(pathOf(name), 'utf8')) : undefined);
  const calls = saved('calls') ?? [];
  let stage = 'start';
  const spent = () => calls.reduce((sum, call) => sum + (call.cost_usd ?? 0), 0);
  const record = ({ raw_text: rawText, ...call }) => {
    calls.push({ ...call, stage });
    if (rawText !== undefined) appendFileSync(join(dir, 'raw-output.txt'), `${JSON.stringify({ stage, agent: call.agent, stop_reason: call.stop_reason })}\n${maskCredentials(rawText, input).masked}\n`);
    save('calls', calls);
    if (spent() > BUDGET_USD) throw new Error(`費用の上限 $${BUDGET_USD} を超えたので止めました`);
  };

  const report = { label: '模擬評価', base: basename(values.base), removed_page: values.page, rounds: [], leaks: [], symptoms: [], status: 'running' };
  const finish = (status, extra = {}) => {
    Object.assign(report, extra, { status, cost_usd: spent(), by_agent: calls.reduce((all, call) => ({ ...all, [call.agent]: (all[call.agent] ?? 0) + (call.cost_usd ?? 0) }), {}) });
    save('report', report);
    console.log(JSON.stringify(report, null, 2));
    console.log(`保存先：${dir}`);
    return status === 'passed' ? 0 : 1;
  };

  const seeds = seedPieces(values.base, values.page);
  const final = read('manual-final.json');
  const start = withoutPage(final, read('verification-2.json'), values.page);
  const writerBefore = read('manual-1-writer.json');
  const editedBefore = withoutPage(read('manual-2-editor.json').manual, { results: [] }, values.page).manual;

  let revision;
  let lastFindings = [];
  let previousManual = start.manual;
  let previousVerification = start.verification;
  for (let round = 1; round <= MAX_RESENDS + 1; round += 1) {
    stage = `writer-${round}`;
    const store = {
      get: (name) => saved(`writer-${round}-${name}`) ?? (round === 1 ? seeds.get(name) : undefined),
      set: (name, value) => save(`writer-${round}-${name}`, value),
    };
    const written = saved(`manual-${round}-writer`) ?? save(`manual-${round}-writer`, await runWriterLive({
      survey, transcript, companyName: info.name, retiree: RETIREE, revision, client: api, record, store,
      onLeaks: (leaks) => { report.leaks.push({ round, ...leaks }); },
      onSymptoms: (symptoms) => { report.symptoms.push({ round, ...symptoms }); },
    }));
    if (round === 1) {
      const added = written.symptom_pages.filter((page) => page.id === values.page);
      if (!added.length) return finish('no_page_added', { exclusions: written.symptom_exclusions ?? [] });
    }
    stage = `editor-${round}`;
    const edited = saved(`manual-${round}-editor`) ?? await (async () => {
      const source = round === 1 ? overlayEdited(written, writerBefore, editedBefore, start.removed) : written;
      const base = carryForward(previousManual, lastFindings, source);
      report[`changed_${round}`] = base.changed.length;
      return save(`manual-${round}-editor`, await runEditorLive({ manual: base.manual, survey, transcript, retiree: RETIREE, changed: base.changed, client: api, record }));
    })();
    const manual = withReplies(withWindows10Note(edited.manual, survey));
    const schema = JSON.parse(readFileSync(join(ROOT, 'plugin/schemas/manual.schema.json'), 'utf8'));
    const problems = validate(schema, manual);
    if (problems.length) return finish('schema_failed', { problems: problems.slice(0, 5) });
    const scope = verificationScope(previousManual, previousVerification, manual);
    if (scope.length > SCOPE_LIMIT) return finish('scope_too_large', { scope: scope.length });
    const inScope = new Set(scope);
    stage = `verification-${round}`;
    const judged = saved(`verification-${round}`) ?? save(`verification-${round}`, { ...mergeVerification(previousVerification, (await runVerifierLive({
      input: { survey, transcript, retiree: RETIREE, statements: { schema_version: 1, company: survey.company, statements: manual.statements.filter((statement) => inScope.has(statement.id)) } },
      client: api, record, round,
    })).results, manual, scope), round });
    const { verification, hits } = applyRetireeCheck(judged, manual, RETIREE);
    const result = summarizeVerification(verification, manual);
    report.rounds.push({ round, statements: manual.statements.length, verified: scope.length, retiree_hits: hits, counts: result.counts, unanswered: result.unanswered, findings: result.findings.map(({ statement, verdict }) => ({ statement, verdict })) });
    if (result.passed) {
      const reviewed = { ...markReviewed(manual, RETIREE, survey.as_of), search_index: manual.symptom_pages.map((page) => ({ page: page.id, phrases: [] })) };
      save('manual-final', reviewed);
      const { manual: forRender } = prepareForRender(reviewed);
      writeFileSync(join(dir, 'manual.html'), renderManual(forRender));
      return finish('passed', { resends: round - 1, pages: manual.symptom_pages.length, exclusions: manual.symptom_exclusions ?? [] });
    }
    revision = buildRevision(withoutFlaggedPlace(manual, result.findings), result.findings);
    lastFindings = result.findings;
    previousManual = manual;
    previousVerification = verification;
  }
  return finish('not_passed', { unresolved: lastFindings.map(({ statement, verdict }) => ({ statement, verdict })) });
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = await main();
