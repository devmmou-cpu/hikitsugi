#!/usr/bin/env node
// /hikitsugi:start の進行を支えるプログラム。段階の判定、形式の検査、記録の採番、表示プログラムの呼び出しを行う。
// AI を使わず、外部への送信もしない。作業の結果は ./hikitsugi-work/ に保存するので、途中で止めても続きから再開できる。
// 終了コード：0＝成功、1＝内容の問題（理由を表示）、2＝使い方の誤り

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyEdits } from '../lib/apply-edits.mjs';
import { assembleManual, checkCommon, checkContact, checkPage, droppedFromCommon, mergeRewritten, ownersOf, previousPiece, writerFormat } from '../lib/assemble.mjs';
import { buildRevision, carryForward, markReviewed, mergeVerification, prepareForRender, summarizeVerification, UnapprovedPartsError, verificationScope } from '../lib/handover.mjs';
import { coverageLeaks, locationWarnings } from '../lib/coverage-check.mjs';
import { bodyFields } from '../lib/page-check.mjs';
import { plainProblems } from '../lib/plain-check.mjs';
import { pagesForPhrases, phraseProblems, withSearchIndex } from '../lib/search-index.mjs';
import { applyRetireeCheck } from '../lib/retiree-check.mjs';
import { composeProcedures, libraryForAgents } from '../lib/procedures.mjs';
import { appendEntry, appendReviewEntry, checkNextQuestion, emptyTranscript, interviewProgress, QUESTION_LIMIT } from '../lib/transcript.mjs';
import { validate } from '../lib/validate.mjs';
import { renderManual } from '../renderer/render.mjs';
import { isComposedStatement, withoutFlaggedPlace, withReplies, withWindows10Note } from '../lib/reply.mjs';
import { writePhoneBundle } from '../renderer/phone.mjs';
import { oversizeMessage, PC_FILE_LIMIT, PC_FILE_TARGET, writeWithinLimit } from '../lib/limits.mjs';
import { BUNDLE_NAME, bundleOf, pagesNeedingPhrases, pagesOfContact, parseMemos, targetKind, withUpdateMark } from '../lib/update.mjs';

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

/** Gap Finder の出力の形。schema_version と company は check-gaps が付けるので含めない。スキーマから作るので、検査とずれない。 */
export function gapsFormat() {
  const { coverage, gaps } = readJson(join(PLUGIN, 'schemas', 'gaps.schema.json')).properties;
  return { $comment: 'gaps.json の形。この項目の名前と値のとおりに保存する', type: 'object', additionalProperties: false, required: ['coverage', 'gaps'], properties: { coverage, gaps } };
}

const checkSchema = (name, value) => {
  const problems = validate(readJson(join(PLUGIN, 'schemas', `${name}.schema.json`)), value);
  if (problems.length) throw new Problem(`形式が違います（${name}）：\n${problems.slice(0, 10).join('\n')}`);
  return value;
};

// 検査に通した印。中身のハッシュを残すので、検査のあとに書き換えたファイルは「検査前」に戻る
const CHECKED = 'checked.json';
const digestOf = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const isChecked = (work, name) => existsSync(join(work, name)) && existsSync(join(work, CHECKED)) && readJson(join(work, CHECKED))[name] === digestOf(join(work, name));
function markChecked(work, name) {
  const marks = existsSync(join(work, CHECKED)) ? readJson(join(work, CHECKED)) : {};
  writeJson(join(work, CHECKED), { ...marks, [name]: digestOf(join(work, name)) });
}

/** 作業フォルダの中のファイルから、次にすることを判定する。unchecked は、結果はあるが検査に通っていないこと。 */
export function nextStep(work) {
  const has = (name) => existsSync(join(work, name));
  if (!has('state.json')) return existsSync(join(dirname(work), BUNDLE_NAME)) ? { step: 'update', from_bundle: true, updater: null, output_dir: dirname(work) } : { step: 'init' };
  if (!has('gaps.json')) return { step: 'gap-finder' };
  const state = readJson(join(work, 'state.json'));
  if (!state.interview_done) {
    if (!isChecked(work, 'gaps.json')) return { step: 'gap-finder', unchecked: true };
    const count = has('transcript.json') ? readJson(join(work, 'transcript.json')).entries.length : 0;
    return { step: 'interview', asked: count, limit: QUESTION_LIMIT, pending_question: has('next.json') };
  }
  const round = state.round ?? 1;
  if (!has(`manual-${round}.json`)) {
    const part = writerParts(work, state, round).find((name) => !isChecked(work, partFile(round, name)));
    return { step: 'writer', round, part, ...(has(partFile(round, part)) ? { unchecked: true } : {}) };
  }
  if (!has(`edited-${round}.json`)) return { step: 'editor', round };
  if (!has(`verification-${round}.json`)) return { step: 'verifier', round };
  if (!state.passed && !isChecked(work, `verification-${round}.json`)) return { step: 'verifier', round, unchecked: true };
  if (state.passed && !readJson(join(work, 'manual-final.json')).search_index) return { step: 'phrases' };
  if (state.passed && !state.review?.done) {
    const manual = readJson(join(work, 'manual-final.json'));
    if (state.update) return { step: 'review', reviewer: state.update.by, page: state.update.target, pages: 1, update: true };
    const page = manual.symptom_pages.find((candidate) => !state.review?.pages?.[candidate.id]);
    return { step: 'review', reviewer: state.review?.reviewer ?? null, page: page?.id ?? null, pages: manual.symptom_pages.length };
  }
  // manual.json から戻した作業フォルダには HTML がないが、隣に完成品があるので作り直さない
  if (state.passed && (state.needs_render || (!has('manual.html') && !state.restored))) return { step: 'render', round };
  if (state.passed) {
    const memos = has(MEMO_QUEUE) ? readJson(join(work, MEMO_QUEUE)).items.length : 0;
    return { step: 'update', updater: state.updater ?? null, output_dir: state.output_dir ?? null, memo_left: memos };
  }
  return { step: 'not_passed', round };
}

const partFile = (round, name) => `writer-${round}-${name}.json`;
const MEMO_QUEUE = 'memo-queue.json';
const BEFORE_UPDATE = 'before-update.json';

/** この回に Writer が書く部分の一覧。最初の回は共通部分とページの全部、差し戻しでは指摘のあった部分だけ。 */
function writerParts(work, state, round) {
  if (Number(round) > 1) return state.todo ?? [];
  const common = join(work, partFile(1, 'common'));
  return ['common', ...(existsSync(common) ? readJson(common).page_plan.map((entry) => entry.id) : [])];
}

function init(work, [surveyPath, retiree, ...nameParts]) {
  const companyName = nameParts.join(' ').trim();
  if (!surveyPath || !retiree || !companyName) throw new UsageError('使い方：init <調査データ.json> <退職する人の名前> <会社名>');
  const survey = checkSchema('survey', readJson(resolve(surveyPath)));
  mkdirSync(work, { recursive: true });
  writeJson(join(work, 'survey.json'), survey);
  writeJson(join(work, 'checklist.json'), readJson(join(PLUGIN, 'checklist/handover-items.json')));
  writeJson(join(work, 'library.json'), libraryForAgents());
  writeJson(join(work, 'gaps-format.json'), gapsFormat());
  writeJson(join(work, 'transcript.json'), emptyTranscript(survey.company));
  writeJson(join(work, 'state.json'), { company: survey.company, company_name: companyName, retiree, round: 1, interview_done: false, passed: false });
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
  markChecked(work, 'gaps.json');
  writeJson(join(work, 'interview-progress.json'), interviewProgress(gaps, readJson(join(work, 'transcript.json'))));
  const count = gaps.coverage.filter((entry) => entry.state === 'filled').length;
  return `調査データで埋まった項目 ${count} 件、聞き取りの空白 ${gaps.gaps.length} 件`;
}

function checkNext(work) {
  const next = checkSchema('next-question', readJson(join(work, 'next.json')));
  const transcript = readJson(join(work, 'transcript.json'));
  const gaps = readJson(join(work, 'gaps.json'));
  const unfinished = checkNextQuestion(next, gaps, transcript);
  if (next.action === 'finish' && unfinished.length) throw new Problem(unfinished.join('\n'));
  if (next.action === 'finish' || transcript.entries.length >= QUESTION_LIMIT) {
    const state = readJson(join(work, 'state.json'));
    writeJson(join(work, 'state.json'), { ...state, interview_done: true });
    rmNext(work);
    return `聞き取りを終えました（${transcript.entries.length} 問）`;
  }
  if (unfinished.length) throw new Problem(unfinished.join('\n'));
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
  writeJson(join(work, 'interview-progress.json'), interviewProgress(readJson(join(work, 'gaps.json')), updated));
  rmNext(work);
  return `記録しました（${updated.entries.length} / ${QUESTION_LIMIT} 問）`;
}
const rmNext = (work) => rmSync(join(work, 'next.json'), { force: true });

const contactsForPages = (statements, contacts) => {
  const text = new Map(statements.map((statement) => [statement.id, statement.text]));
  return contacts.map(({ id, name, role }) => ({ id, name, role: text.get(role) }));
};

/** 指定の部分を書くための指示を、writer-task.json に保存する。 */
function writerTask(work, [round, part]) {
  if (!round || !part) throw new UsageError('使い方：writer-task <回> <部分>');
  const state = readJson(join(work, 'state.json'));
  let task;
  if (Number(round) === 1) {
    if (part === 'common') {
      // 載せ漏れで書き直すときは、前の出力と足りない事実を渡す
      const saved = join(work, partFile(1, 'common-previous'));
      task = state.leaks && existsSync(saved) ? { part: 'common', revision: { previous: readJson(saved), findings: [], missing: state.leaks } } : { part: 'common' };
    }
    else {
      const common = readJson(join(work, partFile(1, 'common')));
      const entry = common.page_plan.find((candidate) => candidate.id === part);
      if (!entry) throw new Problem(`手順ページの一覧にありません：${part}`);
      task = { part: 'page', entry, contacts: contactsForPages(common.statements, common.contacts) };
    }
  } else {
    const { previous_manual: previous, findings } = readJson(join(work, `findings-${Number(round) - 1}.json`));
    // 連絡先1件の更新では、その連絡先の文の指摘は「共通部分」の持ち物として数えられている
    const findingsOf = state.update?.contact === part ? 'common' : part;
    const revision = { previous: previousPiece(previous, part), findings: ownersOf(previous, findings).get(findingsOf) ?? [] };
    if (state.page_fix?.page === part) revision.page_fix = state.page_fix;
    if (state.leaks && part === 'common') revision.missing = state.leaks;
    if (state.update) revision.update = { kind: state.update.kind, ...(state.update.add ? { add_symptom: state.update.add } : {}) };
    if (part === 'common') {
      revision.previous.page_plan = planOf(previous);
      task = { part: 'common', revision };
    } else if (state.update?.contact === part) {
      task = { part: 'contact', revision };
    } else {
      const added = state.update?.add?.id === part;
      const entry = added ? newPageEntry(work, round, state) : planOf(previous).find((candidate) => candidate.id === part);
      task = { part: 'page', entry, contacts: contactsForPages(...statementsAndContacts(work, round, state, previous)), revision };
    }
  }
  writeJson(join(work, 'writer-task.json'), { ...task, retiree: state.retiree });
  writeJson(join(work, 'writer-format.json'), writerFormat(task.part));
  return `${part} を書く準備ができました（writer-task.json）`;
}

/** 症状を足すとき、この回の共通部分が決めた新しいページの一覧の行。 */
function newPageEntry(work, round, state) {
  const entry = readJson(join(work, partFile(round, 'common'))).page_plan.find((candidate) => candidate.id === state.update.add.id);
  if (!entry) throw new Problem(`共通部分の page_plan に ${state.update.add.id} がありません`);
  return entry;
}

/** ページを書くときに使う連絡先。症状を足すときは、この回の共通部分の連絡先を使う。 */
function statementsAndContacts(work, round, state, previous) {
  if (!state.update?.add) return [previous.statements, previous.contacts];
  const common = readJson(join(work, partFile(round, 'common')));
  return [common.statements, common.contacts];
}

const planOf = (manual) => {
  const text = new Map(manual.statements.map((statement) => [statement.id, statement.text]));
  return manual.symptom_pages.map(({ id, category, title }) => ({ id, category, symptom: text.get(title) }));
};

/** 書いた部分を確かめる。全部そろったら、取扱説明書の形に組み立てる。 */
function checkWriter(work, [round, part]) {
  if (!round || !part) throw new UsageError('使い方：check-writer <回> <部分>');
  const state = readJson(join(work, 'state.json'));
  const sources = { survey: readJson(join(work, 'survey.json')), transcript: readJson(join(work, 'transcript.json')) };
  const path = join(work, partFile(round, part));
  const raw = readJson(path);
  const previous = Number(round) > 1 ? readJson(join(work, `findings-${Number(round) - 1}.json`)).previous_manual : null;
  const added = state.update?.add;
  const plan = previous
    ? [...planOf(previous), ...(added && part === added.id ? [newPageEntry(work, round, state)] : [])]
    : part === 'common' ? null : readJson(join(work, partFile(1, 'common'))).page_plan;
  const contacts = previous
    ? (added && part === added.id ? readJson(join(work, partFile(round, 'common'))).contacts : previous.contacts)
    : part === 'common' ? null : readJson(join(work, partFile(1, 'common'))).contacts;
  let checked;
  if (state.update?.contact === part) {
    const schemaProblems = validate(writerFormat('contact'), raw);
    if (schemaProblems.length) throw new Problem(`形式が違います（${part}）：\n${schemaProblems.slice(0, 10).join('\n')}`);
    checked = checkContact(raw, part, sources, { retiree: state.retiree });
  } else if (part === 'common') {
    // 症状を足すときだけ、新しいページの行を受け取る。ほかの行は前の版のまま
    const addedRow = added ? raw.page_plan?.find((entry) => entry.id === added.id) : null;
    if (added && !addedRow) throw new Problem(`page_plan に ${added.id} を足してください`);
    const output = previous ? { ...raw, page_plan: addedRow ? [...plan, addedRow] : plan } : raw;
    const schemaProblems = validate(writerFormat('common'), output);
    if (schemaProblems.length) throw new Problem(`形式が違います（共通部分）：\n${schemaProblems.slice(0, 10).join('\n')}`);
    checked = checkCommon(output, sources, { retiree: state.retiree });
    // 載せ漏れの書き直しは足すだけ。前の版が消えていれば受け付けない
    if (state.leaks) {
      const before = Number(round) === 1 ? readJson(join(work, partFile(1, 'common-previous'))) : previousPiece(previous, 'common');
      checked.problems.push(...droppedFromCommon(before, raw));
    }
  } else {
    const schemaProblems = validate(writerFormat('page'), raw);
    if (schemaProblems.length) throw new Problem(`形式が違います（${part}）：\n${schemaProblems.slice(0, 10).join('\n')}`);
    const entry = plan.find((candidate) => candidate.id === part);
    if (!entry) throw new Problem(`手順ページの一覧にありません：${part}`);
    checked = checkPage(raw, entry, contacts, sources, { retiree: state.retiree });
  }
  if (checked.problems.length) throw new Problem(`手順部品の指定やページの形に問題があります：\n${checked.problems.join('\n')}`);
  writeJson(path, checked.output);
  const parts = writerParts(work, state, round);
  const left = parts.filter((name) => name !== part && !isChecked(work, partFile(round, name)));
  if (left.length) {
    markChecked(work, partFile(round, part));
    return `${part} を確かめました（残り ${left.length} 件）`;
  }
  // 最後の部分は、組み立てまで通ってから印を付ける。載せ漏れの書き直しでは、共通部分のファイルは消えている
  const message = assembleRound(work, Number(round));
  if (existsSync(path)) markChecked(work, partFile(round, part));
  return message;
}

/** 部分をまとめて、この回の取扱説明書にする。 */
function assembleRound(work, round) {
  const state = readJson(join(work, 'state.json'));
  const survey = readJson(join(work, 'survey.json'));
  const sources = { survey, transcript: readJson(join(work, 'transcript.json')) };
  const load = (name) => readJson(join(work, partFile(round, name)));
  const header = { schema_version: 1, company: state.company, company_name: state.company_name, as_of: survey.as_of };
  const contactPart = state.update?.contact;
  const assembled = round === 1
    ? (() => {
        const common = load('common');
        return assembleManual(common, Object.fromEntries(common.page_plan.map((entry) => [entry.id, load(entry.id)])), header);
      })()
    : (() => {
        const previous = readJson(join(work, `findings-${round - 1}.json`)).previous_manual;
        const parts = state.todo ?? [];
        return mergeRewritten(previous, {
          ...(parts.includes('common') ? { common: load('common') } : {}),
          pages: Object.fromEntries(parts.filter((name) => name !== 'common' && name !== contactPart).map((name) => [name, load(name)])),
          ...(contactPart ? { contacts: { [contactPart]: load(contactPart) } } : {}),
        });
      })();
  const { manual, problems } = composeProcedures(assembled, sources, { retiree: state.retiree });
  if (problems.length) throw new Problem(`手順部品の指定やページの形に問題があります：\n${problems.join('\n')}`);
  // 載せ漏れは、共通部分を1回だけ書き直して埋める。それでも残れば止める
  // 更新は依頼された箇所だけを直すので、過去の回答の載せ漏れで全体を書き直さない
  const leaks = state.update ? [] : coverageLeaks(manual, sources);
  if (leaks.length) {
    const list = leaks.map((leak) => `${leak.kind} ${leak.source}`).join('、');
    if (state.leaks_retried) throw new Problem(`載せ漏れが残っています：${list}`);
    const common = join(work, partFile(round, 'common'));
    if (round === 1) writeJson(join(work, partFile(1, 'common-previous')), load('common'));
    rmSync(common, { force: true });
    const todo = round === 1 ? state.todo : [...new Set([...(state.todo ?? []), 'common'])];
    writeJson(join(work, 'state.json'), { ...state, leaks, leaks_retried: true, todo });
    return `載せ漏れがあるので、共通部分を書き直します：${list}`;
  }
  if (state.leaks) {
    const { leaks: _done, leaks_retried: _retried, ...rest } = state;
    writeJson(join(work, 'state.json'), rest);
  }
  checkSchema('manual', manual);
  const path = join(work, `manual-${round}.json`);
  if (round === 1) {
    writeJson(path, manual);
    return `書きました（文章 ${manual.statements.length} 件、手順ページ ${manual.symptom_pages.length} 件）`;
  }
  // 差し戻しでは合格済みの用語の説明を引き継ぎ、変わった文章だけを Editor に渡す
  const before = readJson(join(work, `edited-${round - 1}.json`));
  const verification = readJson(join(work, `verification-${round - 1}.json`));
  const { findings } = summarizeVerification(verification, before);
  const { manual: carried, changed } = carryForward(before, findings, manual);
  checkSchema('manual', carried);
  writeJson(path, carried);
  const remaining = plainProblems(carried);
  if (changed.length === 0 && remaining.long_sentences.length === 0 && remaining.unexplained_terms.length === 0) {
    writeJson(join(work, `editor-${round}.json`), { rewrites: [], glossary: [] });
    writeJson(join(work, `edited-${round}.json`), withReplies(withWindows10Note(carried, readJson(join(work, 'survey.json')))));
    writeScope(work, round);
    // 連絡先の番号だけの更新では、照合する文がない。番号はプログラムが聞き取りと照らしている
    if (state.update && !readJson(join(work, `verify-scope-${round}.json`)).statements.length) {
      writeJson(join(work, `verification-${round}.json`), { results: [] });
      return `直しました。照合する文の変更はありません\n${checkVerification(work, [String(round)])}`;
    }
    return `直しました。Editor の作業は不要です（文章 ${carried.statements.length} 件）`;
  }
  writeJson(join(work, `editor-findings-${round}.json`), { changed_statements: changed, ...remaining });
  return `直しました（文章 ${carried.statements.length} 件、やさしくする文章 ${changed.length} 件）`;
}

/** Verifier にかける文章の一覧を保存する。差し戻しのあとは、変わった文章だけ。 */
function writeScope(work, round) {
  const manual = readJson(join(work, `edited-${round}.json`));
  const scope = Number(round) === 1
    ? manual.statements.map((statement) => statement.id)
    : verificationScope(readJson(join(work, `edited-${Number(round) - 1}.json`)), readJson(join(work, `verification-${Number(round) - 1}.json`)), manual);
  writeJson(join(work, `verify-scope-${round}.json`), { statements: scope });
}

function mergeEdits(work, [round]) {
  const manual = readJson(join(work, `manual-${round}.json`));
  let applied;
  try {
    applied = applyEdits(manual, readJson(join(work, `editor-${round}.json`)), { retiree: readJson(join(work, 'state.json')).retiree });
  } catch (error) {
    if (error instanceof Problem) throw error;
    throw new Problem(`${error.message}\n用語の説明の文は rewrites ではなく、glossary の同じ語の company を直してください`);
  }
  const { manual: edited, changes } = applied;
  // 社員に返す文は Editor のあとにプログラムで組み、Verifier にはかける
  const withReply = withReplies(withWindows10Note(edited, readJson(join(work, 'survey.json'))));
  checkSchema('manual', withReply);
  writeJson(join(work, `edited-${round}.json`), withReply);
  writeScope(work, round);
  const problems = plainProblems(edited);
  // この回に足した用語の説明の文は manual-<回>.json になく、ID では直せないので、語で伝える
  const known = new Set(manual.statements.map((statement) => statement.id));
  const termOf = new Map(edited.glossary.filter((entry) => !known.has(entry.company)).map((entry) => [entry.company, entry.term]));
  const remaining = {
    long_sentences: problems.long_sentences.map(({ id, sentence }) => (termOf.has(id) ? { glossary_term: termOf.get(id), sentence } : { id, sentence })),
    unexplained_terms: problems.unexplained_terms,
  };
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
  let results = raw.results;
  // 差し戻しのあとは変わった文章だけをかけ直すので、ほかは前回の結果を使う
  if (Number(round) > 1 && existsSync(join(work, `verify-scope-${round}.json`))) {
    const scope = readJson(join(work, `verify-scope-${round}.json`)).statements;
    const inScope = new Set(scope);
    results = mergeVerification(readJson(join(work, `verification-${Number(round) - 1}.json`)), raw.results.filter((result) => inScope.has(result.statement)), manual, scope).results;
  }
  // 退職する担当者を連絡先にしている文章は、AI の判定によらず文字列の照合で「危険」にする
  const { verification } = applyRetireeCheck({ schema_version: 1, company: state.company, round: Number(round), results }, manual, state.retiree);
  checkSchema('verification', verification);
  writeJson(path, verification);
  markChecked(work, `verification-${round}.json`);
  const result = summarizeVerification(verification, manual);
  if (result.passed) {
    const { page_fix: _fix, todo: _todo, ...rest } = state;
    writeJson(join(work, 'state.json'), { ...rest, passed: true });
    // 書き直しのあとは症状が変わることがあるので、言い方は作り直す
    const { search_index: _old, ...fresh } = manual;
    if (state.update) {
      // 更新では、変わったページの言い方だけを作り直し、ほかは残す
      const before = readJson(join(work, 'manual-final.json'));
      const needed = pagesNeedingPhrases(before, manual);
      if (!needed.length) {
        writeJson(join(work, 'manual-final.json'), { ...fresh, search_index: before.search_index });
        return `合格しました（文章 ${manual.statements.length} 件）`;
      }
      writeJson(join(work, 'search-index-previous.json'), before.search_index ?? []);
      writeJson(join(work, 'state.json'), { ...readJson(join(work, 'state.json')), update: { ...state.update, phrase_pages: needed } });
    }
    writeJson(join(work, 'manual-final.json'), fresh);
    return `合格しました（文章 ${manual.statements.length} 件）`;
  }
  const line = `不合格：矛盾 ${result.counts.contradiction} 件、根拠なし ${result.counts.unsupported} 件、危険 ${result.counts.dangerous} 件、判定なし ${result.unanswered.length} 件`;
  const fixed = withoutFlaggedPlace(manual, result.findings);
  const revision = buildRevision(fixed, result.findings);
  writeJson(join(work, `findings-${round}.json`), revision);
  if (Number(round) - (state.round_base ?? 0) > MAX_RESENDS) return `${line}\n差し戻しの上限に達しました`;
  const todo = [...ownersOf(revision.previous_manual, revision.findings).keys()].map((name) => (name === 'common' && state.update?.contact ? state.update.contact : name));
  // プログラムが組む文の指摘だけが残り、外せる行もないなら、やり直しても同じ文になる。回数を使わずに止める
  const byId = new Map(manual.statements.map((statement) => [statement.id, statement]));
  if (!todo.length && fixed === manual && result.findings.length && result.findings.every((finding) => isComposedStatement(byId.get(finding.statement)))) {
    return `${line}\nプログラムが組む文への指摘で、書き直しでは直りません（${result.findings.map((finding) => finding.statement).join('、')}）`;
  }
  const next = Number(round) + 1;
  writeJson(join(work, 'state.json'), { ...state, round: next, todo });
  // 用語の説明だけの指摘なら、Writer の仕事はない。すぐに組み立てて Editor へ進む
  if (!todo.length) return `${line}\n${assembleRound(work, next)}`;
  return `${line}\n差し戻します（直す部分：${todo.join('、')}）`;
}

// ---- 普段の言葉で探す索引 ----
function phraseTask(work) {
  const only = readJson(join(work, 'state.json')).update?.phrase_pages;
  const pages = pagesForPhrases(readJson(join(work, 'manual-final.json'))).filter((page) => !only || only.includes(page.id));
  writeJson(join(work, 'phrase-pages.json'), { pages });
  return '症状の一覧を保存しました（phrase-pages.json）';
}

function checkPhrases(work) {
  const state = readJson(join(work, 'state.json'));
  const finalPath = join(work, 'manual-final.json');
  const manual = readJson(finalPath);
  const written = checkSchema('search-index', readJson(join(work, 'phrases.json')));
  // 更新では、書き直していないページの言い方を前の版から足す
  const only = state.update?.phrase_pages;
  const kept = only ? readJson(join(work, 'search-index-previous.json')).filter((entry) => !only.includes(entry.page)).map(({ page, phrases }) => ({ id: page, phrases })) : [];
  const raw = { ...written, pages: [...kept, ...written.pages] };
  const problems = phraseProblems(raw, manual, state.retiree);
  if (problems.length) throw new Problem(`言い方に問題があります：\n${problems.join('\n')}`);
  const indexed = withSearchIndex(manual, raw);
  checkSchema('manual', indexed);
  writeJson(finalPath, indexed);
  return `言い方を入れました（${indexed.search_index.reduce((sum, entry) => sum + entry.phrases.length, 0)} 件）`;
}

// ---- 前任者の確認 ----
const textsOf = (manual, ids) => {
  const text = new Map(manual.statements.map((statement) => [statement.id, statement.text]));
  return ids.map((id) => text.get(id));
};

function reviewStart(work, nameParts) {
  const reviewer = nameParts.join(' ').trim();
  if (!reviewer) throw new UsageError('使い方：review-start <確認する人の名前>');
  const state = readJson(join(work, 'state.json'));
  writeJson(join(work, 'state.json'), { ...state, review: { reviewer, pages: {}, done: false } });
  return `${reviewer} さんの確認を始めます\n${beforeLeaving(work)}`;
}

/** 退職する本人にしかできない作業の一覧。後任向けの取扱説明書には出さず、確認のときに本人に見せる。 */
function beforeLeaving(work) {
  const tasks = readJson(join(work, 'manual-final.json')).before_leaving ?? [];
  if (!tasks.length) return '退職前にやることはありません';
  return ['【退職前にやること】', ...tasks.map(({ text }, index) => `${index + 1}. ${text}`)].join('\n');
}

const section2 = (manual, label, id) => (id ? [`【${label}】`, ...textsOf(manual, [id])] : []);

/** ページの中身を、確認しやすい文章にして返す。 */
function reviewShow(work, [pageId]) {
  const manual = readJson(join(work, 'manual-final.json'));
  const contactShown = manual.contacts.find((candidate) => candidate.id === pageId);
  if (contactShown) {
    const { name, phone, role, hours, contract_location: place, what_to_tell: tell } = contactShown;
    return [
      `${pageId}：${name}`,
      ...textsOf(manual, [role]),
      `電話番号：${phone || '記録がありません'}`,
      ...section2(manual, '受付時間や連絡の手段', hours),
      ...section2(manual, '契約番号の控えの場所', place),
      ...section2(manual, '伝えること', tell),
      `この連絡先を使うページ：${pagesOfContact(manual, pageId).join('、') || 'なし'}`,
    ].join('\n');
  }
  const deviceShown = manual.devices.find((candidate) => candidate.id === pageId);
  if (deviceShown) {
    const { name, location, purpose, impact, credential_location: credential, caution } = deviceShown;
    return [`${pageId}：${textsOf(manual, [name])[0]}`, ...textsOf(manual, [location, purpose, impact]), ...section2(manual, 'パスワードを置いてある場所', credential), ...section2(manual, 'やってはいけないこと', caution)].join('\n');
  }
  const page = manual.symptom_pages.find((candidate) => candidate.id === pageId);
  if (!page) throw new Problem(`手順ページがありません：${pageId}`);
  const fields = bodyFields(page);
  const section = (label, ids) => (ids.length ? [`【${label}】`, ...textsOf(manual, ids)] : []);
  const contact = page.fallback ? manual.contacts.find((candidate) => candidate.id === page.fallback.contact) : null;
  return [
    `${pageId}：${textsOf(manual, [page.title])[0]}`,
    ...textsOf(manual, [page.badge.statement, page.reassurance]),
    ...section('まずこれだけ', [...fields.first_steps, ...fields.first_goal]),
    ...(page.reply_to_staff ? section('社員に返す文', [page.reply_to_staff]) : []),
    ...section('先に知っておくこと', fields.notes),
    ...section('手順', [...fields.branches, ...fields.steps, ...fields.goal, ...fields.exceptions]),
    ...(contact ? ['【それでもだめなら】', `${contact.name} ${contact.phone}`.trim(), ...textsOf(manual, [page.fallback.message])] : []),
    ...section('この症状で使う会社の情報', fields.info_rows),
  ].join('\n');
}

function reviewOk(work, [pageId]) {
  const state = readJson(join(work, 'state.json'));
  if (!state.passed || !state.review?.reviewer) throw new Problem('確認を始められる段階ではありません');
  const finalPath = join(work, 'manual-final.json');
  const manual = readJson(finalPath);
  if (state.update) return finishUpdate(work, state, manual, pageId);
  if (!manual.symptom_pages.some((page) => page.id === pageId)) throw new Problem(`手順ページがありません：${pageId}`);
  const pages = { ...state.review.pages, [pageId]: 'ok' };
  const left = manual.symptom_pages.filter((page) => !pages[page.id]);
  if (left.length) {
    writeJson(join(work, 'state.json'), { ...state, review: { ...state.review, pages } });
    return `${pageId} を確認しました（残り ${left.length} ページ）`;
  }
  // 全ページが済んだので、確認の印を付ける。下書きの HTML は作り直す
  const today = new Date().toLocaleDateString('sv');
  writeJson(finalPath, checkSchema('manual', markReviewed(manual, state.review.reviewer, today)));
  rmSync(join(work, 'manual.html'), { force: true });
  rmSync(join(work, 'phone'), { recursive: true, force: true });
  writeJson(join(work, 'state.json'), { ...state, review: { ...state.review, pages, done: true, confirmed_on: today } });
  return '全ページの確認が終わりました';
}

/** 直す内容は標準入力で受け取り、聞き取りの記録にする。そのページだけを書き直して、検証し直す。 */
function reviewFix(work, [pageId], stdin) {
  const state = readJson(join(work, 'state.json'));
  if (!state.passed || !state.review?.reviewer) throw new Problem('確認を始められる段階ではありません');
  const manual = readJson(join(work, 'manual-final.json'));
  const page = manual.symptom_pages.find((candidate) => candidate.id === pageId);
  if (!page) throw new Problem(`手順ページがありません：${pageId}`);
  const transcriptPath = join(work, 'transcript.json');
  let added;
  try {
    added = appendReviewEntry(readJson(transcriptPath), { pageId, title: textsOf(manual, [page.title])[0], comment: stdin, answeredAt: new Date().toISOString() });
  } catch (error) {
    throw new Problem(error.message);
  }
  checkSchema('transcript', added.transcript);
  writeJson(transcriptPath, added.transcript);
  const round = state.round;
  writeJson(join(work, `findings-${round}.json`), buildRevision(manual, []));
  const { [pageId]: _done, ...pages } = state.review.pages;
  writeJson(join(work, 'state.json'), {
    ...state,
    passed: false,
    round: round + 1,
    round_base: round,
    todo: [pageId],
    page_fix: { page: pageId, comment: added.entry.answer, evidence: added.entry.id },
    review: { ...state.review, pages },
  });
  return `記録しました（${added.entry.id}）。${pageId} を書き直します`;
}

// ---- 完成後の更新 ----
const today = () => new Date().toLocaleDateString('sv');

/** manual.json から作業フォルダを作り直す。合格済みの説明書として扱う。 */
function restoreFromBundle(work) {
  const path = join(dirname(work), BUNDLE_NAME);
  const bundle = readJson(path);
  if (bundle.kind !== 'hikitsugi-manual') throw new Problem(`${path} は取扱説明書のデータではありません`);
  mkdirSync(work, { recursive: true });
  const { manual, sources, round, round_base: base } = bundle;
  writeJson(join(work, 'survey.json'), sources.survey);
  writeJson(join(work, 'transcript.json'), sources.transcript);
  writeJson(join(work, 'checklist.json'), readJson(join(PLUGIN, 'checklist/handover-items.json')));
  writeJson(join(work, 'library.json'), libraryForAgents());
  writeJson(join(work, 'gaps.json'), { schema_version: 1, company: bundle.company, coverage: [], gaps: [] });
  writeJson(join(work, 'manual-final.json'), manual);
  writeJson(join(work, `manual-${round}.json`), manual);
  writeJson(join(work, `edited-${round}.json`), manual);
  writeJson(join(work, `verification-${round}.json`), {
    schema_version: 1,
    company: bundle.company,
    round,
    results: manual.statements.map(({ id }) => ({ statement: id, verdict: 'correct', reason: '', checked: [], conflicts_with: [] })),
  });
  markChecked(work, `verification-${round}.json`);
  const pages = Object.fromEntries(manual.symptom_pages.map((page) => [page.id, 'ok']));
  writeJson(join(work, 'state.json'), {
    company: bundle.company,
    company_name: bundle.company_name,
    retiree: bundle.retiree,
    round,
    round_base: base,
    interview_done: true,
    passed: true,
    output_dir: dirname(work),
    restored: true,
    review: { reviewer: manual.review.reviewer, pages, done: true, confirmed_on: manual.review.confirmed_on },
  });
}

/** 更新を始める人を記録する。作業フォルダがなければ、manual.json から作り直す。 */
function updateStart(work, nameParts) {
  const by = nameParts.join(' ').trim();
  if (!by) throw new UsageError('使い方：update-start <更新する人の名前>');
  if (!existsSync(join(work, 'state.json'))) restoreFromBundle(work);
  const state = readJson(join(work, 'state.json'));
  if (!state.passed || !state.review?.done) throw new Problem('取扱説明書が完成していないので、更新を始められません');
  writeJson(join(work, 'state.json'), { ...state, updater: by });
  return `${by} さんの更新を始めます`;
}

function updateOutput(work, [path]) {
  if (!path) throw new UsageError('使い方：update-output <出力先のフォルダ>');
  const target = resolve(path);
  if (!existsSync(target)) throw new Problem(`フォルダがありません：${target}`);
  writeJson(join(work, 'state.json'), { ...readJson(join(work, 'state.json')), output_dir: target });
  return `出力先を覚えました：${target}`;
}

/** 更新の対象の一覧。 */
function updateTargets(work) {
  const manual = readJson(join(work, 'manual-final.json'));
  const text = new Map(manual.statements.map((statement) => [statement.id, statement.text]));
  return JSON.stringify({
    pages: manual.symptom_pages.map((page) => ({ id: page.id, title: text.get(page.title) })),
    contacts: manual.contacts.map((contact) => ({ id: contact.id, name: contact.name, phone: contact.phone })),
    devices: manual.devices.map((device) => ({ id: device.id, name: text.get(device.name) })),
  });
}

/** 更新の対象を決めて、聞き取りの記録に足し、その部分だけを書き直す段階へ進める。 */
function beginUpdate(work, { kind, target, title, comment, question, todo, extra = {} }) {
  const state = readJson(join(work, 'state.json'));
  if (!state.updater) throw new Problem('先に update-start で更新する人の名前を記録してください');
  if (state.update) throw new Problem(`${state.update.target} の更新が終わっていません`);
  const manual = readJson(join(work, 'manual-final.json'));
  const transcriptPath = join(work, 'transcript.json');
  const before = readJson(transcriptPath);
  let added;
  try {
    added = appendReviewEntry(before, { pageId: target, title, comment, answeredAt: new Date().toISOString(), question });
  } catch (error) {
    throw new Problem(error.message);
  }
  checkSchema('transcript', added.transcript);
  // 差し戻しの上限で止まったときに戻せるよう、元の状態を残す
  writeJson(join(work, BEFORE_UPDATE), { state, transcript: before, manual });
  writeJson(transcriptPath, added.transcript);
  const round = state.round;
  writeJson(join(work, `findings-${round}.json`), buildRevision(manual, []));
  writeJson(join(work, 'state.json'), {
    ...state,
    passed: false,
    round: round + 1,
    round_base: round,
    todo,
    page_fix: { page: todo.at(-1), comment: added.entry.answer, evidence: added.entry.id },
    update: { kind, target, by: state.updater, ...extra },
    review: { ...state.review, done: false },
  });
  return `記録しました（${added.entry.id}）。${target} を書き直します`;
}

/** 手順ページ、連絡先、機器を直す。内容は標準入力で受け取る。 */
function updateFix(work, [target], stdin) {
  if (!target) throw new UsageError('使い方：update-fix <ページか連絡先の ID>（内容は標準入力）');
  const manual = readJson(join(work, 'manual-final.json'));
  const kind = targetKind(manual, target);
  if (!kind) throw new Problem(`更新の対象がありません：${target}`);
  const text = new Map(manual.statements.map((statement) => [statement.id, statement.text]));
  if (kind === 'contact') {
    const { name } = manual.contacts.find((contact) => contact.id === target);
    return beginUpdate(work, { kind, target, title: name, comment: stdin, question: `連絡先「${name}」について、直すところを教えてください。`, todo: [target], extra: { contact: target } });
  }
  if (kind === 'device') {
    const device = manual.devices.find((candidate) => candidate.id === target);
    return beginUpdate(work, { kind, target, title: text.get(device.name), comment: stdin, question: `機器「${text.get(device.name)}」について、直すところを教えてください。`, todo: ['common'] });
  }
  const page = manual.symptom_pages.find((candidate) => candidate.id === target);
  return beginUpdate(work, { kind, target, title: text.get(page.title), comment: stdin, todo: [target] });
}

/** 症状を足す。内容は標準入力で受け取る。共通部分と新しいページを書く。 */
function updateAdd(work, _args, stdin) {
  const manual = readJson(join(work, 'manual-final.json'));
  const symptom = stdin.trim();
  if (!symptom) throw new Problem('足す症状が空です');
  const id = `T${Math.max(0, ...manual.symptom_pages.map((page) => Number(page.id.slice(1)))) + 1}`;
  return beginUpdate(work, { kind: 'add', target: id, title: symptom, comment: symptom, question: '手順ページを足します。症状と、そのときの対応を教えてください。', todo: ['common', id], extra: { add: { id, symptom } } });
}

/** 差し戻しの上限で止まった更新を取り消し、前の説明書に戻す。 */
function updateCancel(work) {
  const path = join(work, BEFORE_UPDATE);
  if (!existsSync(path)) throw new Problem('取り消す更新がありません');
  const { state, transcript, manual } = readJson(path);
  // 取り消した回のファイルが残ると、次の更新で書いたものとして数えられる
  for (const name of readdirSync(work)) {
    const match = name.match(/^(?:writer|manual|edited|editor|editor-findings|plain-findings|verify-scope|verification|findings)-(\d+)(?:-|\.)/);
    if (match && Number(match[1]) > state.round) rmSync(join(work, name));
  }
  rmSync(join(work, `findings-${state.round}.json`), { force: true });
  writeJson(join(work, 'state.json'), state);
  writeJson(join(work, 'transcript.json'), transcript);
  writeJson(join(work, 'manual-final.json'), manual);
  rmSync(path);
  return '更新を取り消しました。説明書は前のままです';
}

/** 更新者の「このままでよい」。更新の印を付け、作り直す段階へ進める。 */
function finishUpdate(work, state, manual, pageId) {
  if (pageId !== state.update.target) throw new Problem(`確認するのは ${state.update.target} です`);
  writeJson(join(work, 'manual-final.json'), checkSchema('manual', withUpdateMark(manual, { target: pageId, by: state.update.by, date: today() })));
  const pages = Object.fromEntries(manual.symptom_pages.map((page) => [page.id, 'ok']));
  rmSync(join(work, 'manual.html'), { force: true });
  rmSync(join(work, BEFORE_UPDATE), { force: true });
  const { update: _done, ...rest } = state;
  writeJson(join(work, 'state.json'), { ...rest, needs_render: true, review: { ...state.review, pages, done: true } });
  return `${pageId} の更新を確認しました`;
}

/** 後任のメモのまとめを受け取り、1件ずつの列にする。 */
function updateMemo(work, _args, stdin) {
  const items = parseMemos(stdin, readJson(join(work, 'manual-final.json')));
  if (!items.length) throw new Problem('メモが見つかりません');
  writeJson(join(work, MEMO_QUEUE), { items });
  return JSON.stringify({ count: items.length, next: items[0] });
}

/** 列の先頭を返す。done を渡すと先頭を外す。 */
function memoNext(work, [action]) {
  const path = join(work, MEMO_QUEUE);
  const { items } = existsSync(path) ? readJson(path) : { items: [] };
  const left = action === 'done' ? items.slice(1) : items;
  if (action === 'done') writeJson(path, { items: left });
  return JSON.stringify({ left: left.length, next: left[0] ?? null });
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
  const { manual, omitted, updatedParts, rebuiltCount } = prepared;
  const target = resolve(outPath ?? (state.output_dir ? join(state.output_dir, 'manual.html') : join(work, 'manual.html')));
  const html = renderManual(manual);
  if (writeWithinLimit(target, html, PC_FILE_LIMIT)) throw new Problem(oversizeMessage(target, html, PC_FILE_LIMIT));
  if (target !== resolve(join(work, 'manual.html'))) writeWithinLimit(join(work, 'manual.html'), html, PC_FILE_LIMIT);
  const phoneDir = join(dirname(target), 'phone');
  const bundle = writePhoneBundle(manual, phoneDir);
  if (bundle.blocked.length) throw new Problem(bundle.blocked.join('\n'));
  // 更新に使うデータを隣に置く。下書きは更新の対象にならないので、確認が済んでから置く
  if (manual.review && existsSync(join(work, 'survey.json')) && existsSync(join(work, 'transcript.json'))) {
    const data = JSON.stringify(bundleOf({ manual, survey: readJson(join(work, 'survey.json')), transcript: readJson(join(work, 'transcript.json')), state }), null, 2) + '\n';
    for (const dir of new Set([dirname(target), work])) writeFileSync(join(dir, BUNDLE_NAME), data);
  }
  if (state.needs_render) {
    const { needs_render: _done, ...rest } = state;
    writeJson(join(work, 'state.json'), rest);
  }
  const notes = [manual.review ? `取扱説明書を作りました：${target}` : `下書きを作りました：${target}`, `スマホ向けのファイル：${phoneDir}（${bundle.length} ファイル）`];
  if (Buffer.byteLength(html) > PC_FILE_TARGET) notes.push(`PC 用のファイルが目標の ${PC_FILE_TARGET / 1024}KB を超えています（上限の範囲です）`);
  if (updatedParts.length) notes.push(`部品の文面が変わったので、いまの文面で作りました：${updatedParts.join('、')}`);
  if (rebuiltCount) notes.push(`社員に返す文と業者に伝える文を、いまの型で ${rebuiltCount} 件組み直しました`);
  const places = locationWarnings(manual);
  if (places.length) notes.push(`置き場所に部屋の名前がない機器があります（止めません）：${places.map(({ device }) => device).join('、')}`);
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
  'writer-task': writerTask,
  'check-writer': checkWriter,
  'merge-edits': mergeEdits,
  'check-verification': checkVerification,
  'phrase-task': phraseTask,
  'check-phrases': checkPhrases,
  'review-start': reviewStart,
  'before-leaving': beforeLeaving,
  'review-show': reviewShow,
  'review-ok': reviewOk,
  'review-fix': reviewFix,
  'update-start': updateStart,
  'update-output': updateOutput,
  'update-targets': updateTargets,
  'update-fix': updateFix,
  'update-add': updateAdd,
  'update-cancel': updateCancel,
  'update-memo': updateMemo,
  'memo-next': memoNext,
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
    const stdin = ['record', 'review-fix', 'update-fix', 'update-add', 'update-memo'].includes(command) ? readFileSync(0, 'utf8') : '';
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
