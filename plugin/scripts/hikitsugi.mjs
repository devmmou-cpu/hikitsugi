#!/usr/bin/env node
// /hikitsugi:start の進行を支えるプログラム。段階の判定、形式の検査、記録の採番、表示プログラムの呼び出しを行う。
// AI を使わず、外部への送信もしない。作業の結果は ./hikitsugi-work/ に保存するので、途中で止めても続きから再開できる。
// 終了コード：0＝成功、1＝内容の問題（理由を表示）、2＝使い方の誤り

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyEdits } from '../lib/apply-edits.mjs';
import { buildRevision, carryForward, prepareForRender, summarizeVerification, UnapprovedPartsError } from '../lib/handover.mjs';
import { plainProblems } from '../lib/plain-check.mjs';
import { composeProcedures, libraryForAgents } from '../lib/procedures.mjs';
import { appendEntry, checkNextQuestion, emptyTranscript, QUESTION_LIMIT } from '../lib/transcript.mjs';
import { validate } from '../lib/validate.mjs';
import { renderManual } from '../renderer/render.mjs';

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), '..');
export const MAX_RESENDS = 2;

class Problem extends Error {}

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Problem(`${path} を読めません：${error.message}`);
  }
};
const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');

const checkSchema = (name, value) => {
  const problems = validate(readJson(join(PLUGIN, 'schemas', `${name}.schema.json`)), value);
  if (problems.length) throw new Problem(`形式が違います（${name}）：\n${problems.slice(0, 10).join('\n')}`);
  return value;
};

/** 作業フォルダの中のファイルから、次にすることを判定する。 */
export function nextStep(work) {
  const has = (name) => existsSync(join(work, name));
  if (!has('state.json')) return { step: 'init' };
  if (!has('gaps.json')) return { step: 'gap-finder' };
  const state = readJson(join(work, 'state.json'));
  if (!state.interview_done) {
    const count = has('transcript.json') ? readJson(join(work, 'transcript.json')).entries.length : 0;
    return { step: 'interview', asked: count, limit: QUESTION_LIMIT, pending_question: has('next.json') };
  }
  const round = state.round ?? 1;
  if (!has(`manual-${round}.json`)) return { step: 'writer', round };
  if (!has(`edited-${round}.json`)) return { step: 'editor', round };
  if (!has(`verification-${round}.json`)) return { step: 'verifier', round };
  if (!has('manual.html') && state.passed) return { step: 'render', round };
  if (state.passed) return { step: 'done' };
  return { step: 'not_passed', round };
}

function init(work, [surveyPath, ...nameParts]) {
  const companyName = nameParts.join(' ').trim();
  if (!surveyPath || !companyName) throw new UsageError('使い方：init <調査データ.json> <会社名>');
  const survey = checkSchema('survey', readJson(resolve(surveyPath)));
  mkdirSync(work, { recursive: true });
  writeJson(join(work, 'survey.json'), survey);
  writeJson(join(work, 'checklist.json'), readJson(join(PLUGIN, 'checklist/handover-items.json')));
  writeJson(join(work, 'library.json'), libraryForAgents());
  writeJson(join(work, 'transcript.json'), emptyTranscript(survey.company));
  writeJson(join(work, 'state.json'), { company: survey.company, company_name: companyName, round: 1, interview_done: false, passed: false });
  return `準備ができました（調査データ ${survey.items.length} 件）`;
}

function checkGaps(work) {
  const survey = readJson(join(work, 'survey.json'));
  const raw = readJson(join(work, 'gaps.json'));
  const gaps = { schema_version: 1, company: survey.company, coverage: raw.coverage, gaps: raw.gaps };
  checkSchema('gaps', gaps);
  const checklist = readJson(join(work, 'checklist.json'));
  const judged = new Set(gaps.coverage.map((entry) => entry.item));
  const missing = checklist.items.filter((item) => !judged.has(item.id)).map((item) => item.id);
  if (missing.length) throw new Problem(`判定のない必須項目があります：${missing.join(', ')}`);
  const inGap = new Set(gaps.gaps.flatMap((gap) => gap.items));
  const dropped = gaps.coverage.filter((entry) => entry.state !== 'filled' && !inGap.has(entry.item)).map((entry) => entry.item);
  if (dropped.length) throw new Problem(`聞き取りの対象から漏れた必須項目があります：${dropped.join(', ')}`);
  writeJson(join(work, 'gaps.json'), gaps);
  const count = gaps.coverage.filter((entry) => entry.state === 'filled').length;
  return `調査データで埋まった項目 ${count} 件、聞き取りの空白 ${gaps.gaps.length} 件`;
}

function checkNext(work) {
  const next = checkSchema('next-question', readJson(join(work, 'next.json')));
  const transcript = readJson(join(work, 'transcript.json'));
  if (next.action === 'finish' || transcript.entries.length >= QUESTION_LIMIT) {
    const state = readJson(join(work, 'state.json'));
    writeJson(join(work, 'state.json'), { ...state, interview_done: true });
    rmNext(work);
    return `聞き取りを終えました（${transcript.entries.length} 問）`;
  }
  const problems = checkNextQuestion(next, readJson(join(work, 'gaps.json')));
  if (problems.length) throw new Problem(problems.join('\n'));
  return next.question;
}

/** 回答は標準入力で受け取る。シェルの引数に載せると、記号で壊れることがあるため。 */
function record(work, [status], stdin) {
  if (!['answered', 'unknown', 'later'].includes(status)) throw new UsageError('使い方：record <answered|unknown|later>（回答は標準入力）');
  const answer = stdin.trim() || { unknown: '分かりません。', later: 'あとで調べます。' }[status];
  if (!answer) throw new Problem('回答が空です');
  const next = readJson(join(work, 'next.json'));
  const transcriptPath = join(work, 'transcript.json');
  let updated;
  try {
    updated = appendEntry(readJson(transcriptPath), { next, answer, status, answeredAt: new Date().toISOString() });
  } catch (error) {
    throw new Problem(error.message);
  }
  checkSchema('transcript', updated);
  writeJson(transcriptPath, updated);
  rmNext(work);
  return `記録しました（${updated.entries.length} / ${QUESTION_LIMIT} 問）`;
}
const rmNext = (work) => rmSync(join(work, 'next.json'), { force: true });

function checkWriter(work, [round]) {
  const state = readJson(join(work, 'state.json'));
  const survey = readJson(join(work, 'survey.json'));
  const path = join(work, `manual-${round}.json`);
  const raw = readJson(path);
  // 会社の情報はプログラムが付ける。サブエージェントが書いた値で上書きさせない
  const stamped = { ...raw, schema_version: 1, company: state.company, company_name: state.company_name, as_of: survey.as_of };
  checkSchema('manual', stamped);
  // 部品の文面はプログラムが組み立てる。問題があれば、Writer に直してもらう
  const { manual, problems } = composeProcedures(stamped, { survey, transcript: readJson(join(work, 'transcript.json')) });
  if (problems.length) throw new Problem(`手順部品の指定に問題があります：\n${problems.join('\n')}`);
  checkSchema('manual', manual);
  if (Number(round) === 1) {
    writeJson(path, manual);
    return `書きました（文章 ${manual.statements.length} 件、手順ページ ${manual.symptom_pages.length} 件）`;
  }
  // 差し戻しでは合格済みの用語の説明を引き継ぎ、変わった文章だけを Editor に渡す
  const before = readJson(join(work, `edited-${Number(round) - 1}.json`));
  const verification = readJson(join(work, `verification-${Number(round) - 1}.json`));
  const { findings } = summarizeVerification(verification, before);
  const { manual: carried, changed } = carryForward(before, findings, manual);
  checkSchema('manual', carried);
  writeJson(path, carried);
  const remaining = plainProblems(carried);
  if (changed.length === 0 && remaining.long_sentences.length === 0 && remaining.unexplained_terms.length === 0) {
    writeJson(join(work, `editor-${round}.json`), { rewrites: [], glossary: [] });
    writeJson(join(work, `edited-${round}.json`), carried);
    return `直しました。Editor の作業は不要です（文章 ${carried.statements.length} 件）`;
  }
  writeJson(join(work, `editor-findings-${round}.json`), { changed_statements: changed, ...remaining });
  return `直しました（文章 ${carried.statements.length} 件、やさしくする文章 ${changed.length} 件）`;
}

function mergeEdits(work, [round]) {
  const manual = readJson(join(work, `manual-${round}.json`));
  const { manual: edited, changes } = applyEdits(manual, readJson(join(work, `editor-${round}.json`)));
  checkSchema('manual', edited);
  writeJson(join(work, `edited-${round}.json`), edited);
  const problems = plainProblems(edited);
  const remaining = { long_sentences: problems.long_sentences, unexplained_terms: problems.unexplained_terms };
  writeJson(join(work, `plain-findings-${round}.json`), remaining);
  const notes = [`やさしく直しました。事実が変わったので元に戻した文章：${changes.length} 件`];
  if (problems.long_sentences.length || problems.unexplained_terms.length) {
    notes.push(`残った問題：長い文 ${problems.long_sentences.length} 件、説明のない語 ${problems.unexplained_terms.length} 件（plain-findings-${round}.json）`);
  }
  return notes.join('\n');
}

function checkVerification(work, [round]) {
  const state = readJson(join(work, 'state.json'));
  const manual = readJson(join(work, `edited-${round}.json`));
  const path = join(work, `verification-${round}.json`);
  const raw = readJson(path);
  const verification = { schema_version: 1, company: state.company, round: Number(round), results: raw.results };
  checkSchema('verification', verification);
  writeJson(path, verification);
  const result = summarizeVerification(verification, manual);
  if (result.passed) {
    writeJson(join(work, 'state.json'), { ...state, passed: true });
    writeJson(join(work, 'manual-final.json'), manual);
    return `合格しました（文章 ${manual.statements.length} 件）`;
  }
  const line = `不合格：矛盾 ${result.counts.contradiction} 件、根拠なし ${result.counts.unsupported} 件、危険 ${result.counts.dangerous} 件、判定なし ${result.unanswered.length} 件`;
  writeJson(join(work, `findings-${round}.json`), buildRevision(manual, result.findings));
  if (Number(round) > MAX_RESENDS) return `${line}\n差し戻しの上限に達しました`;
  writeJson(join(work, 'state.json'), { ...state, round: Number(round) + 1 });
  return `${line}\n差し戻します（findings-${round}.json）`;
}

function render(work, [outPath]) {
  const state = readJson(join(work, 'state.json'));
  if (!state.passed) throw new Problem('Verifier が合格していないので、取扱説明書を作れません');
  let prepared;
  try {
    prepared = prepareForRender(readJson(join(work, 'manual-final.json')));
  } catch (error) {
    if (error instanceof UnapprovedPartsError) throw new Problem(error.message);
    throw error;
  }
  const { manual, omitted } = prepared;
  const target = resolve(outPath ?? join(work, 'manual.html'));
  writeFileSync(target, renderManual(manual));
  if (target !== resolve(join(work, 'manual.html'))) writeFileSync(join(work, 'manual.html'), renderManual(manual));
  const notes = [`取扱説明書を作りました：${target}`];
  if (omitted.routines || omitted.devices) notes.push(`表示プログラムが未対応のため外した項目：定期作業 ${omitted.routines} 件、機器 ${omitted.devices} 件`);
  return notes.join('\n');
}

class UsageError extends Error {}

const COMMANDS = {
  status: (work) => JSON.stringify(nextStep(work)),
  init,
  'check-gaps': checkGaps,
  'check-next': checkNext,
  record,
  'check-writer': checkWriter,
  'merge-edits': mergeEdits,
  'check-verification': checkVerification,
  render,
};

/** コマンドを実行して、表示する文字列を返す。 */
export function run(command, args, { work, stdin = '' }) {
  const handler = COMMANDS[command];
  if (!handler) throw new UsageError(`使えるコマンド：${Object.keys(COMMANDS).join('、')}`);
  return handler(work, args, stdin);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command, ...args] = process.argv.slice(2);
  const work = resolve(process.env.HIKITSUGI_WORK ?? 'hikitsugi-work');
  try {
    const stdin = command === 'record' ? readFileSync(0, 'utf8') : '';
    console.log(run(command, args, { work, stdin }));
  } catch (error) {
    if (error instanceof Problem) {
      console.error(error.message);
      process.exitCode = 1;
    } else if (error instanceof UsageError) {
      console.error(error.message);
      process.exitCode = 2;
    } else {
      throw error;
    }
  }
}
