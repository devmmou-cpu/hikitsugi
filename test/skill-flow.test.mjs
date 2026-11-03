// /hikitsugi:start の実物の通しで出た問題の再発を止める。検査の合否と進行、Writer の形、用語の説明の直し、プログラムが組む文の指摘。

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadAnswers, loadInput } from '../eval/lib/load-set.mjs';
import { commonSchema, commonStatementIds, pageSchema, writerFormat } from '../plugin/lib/assemble.mjs';
import { buildRevision, withCurrentParts } from '../plugin/lib/handover.mjs';
import { pageStatementIds } from '../plugin/lib/page-check.mjs';
import { callScriptProblems, composeCallScript, withoutFlaggedPlace, withoutReplies, withReplies } from '../plugin/lib/reply.mjs';
import { nextStep, run } from '../plugin/scripts/hikitsugi.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SET = join(ROOT, 'eval/sets/okojo');
const input = loadInput(SET);
const gold = loadAnswers(SET);
const t1 = () => withoutReplies(JSON.parse(readFileSync(join(ROOT, 'test/fixtures/manual-t1.json'), 'utf8')));
const full = () => JSON.parse(readFileSync(join(ROOT, 'test/fixtures/manual-full.json'), 'utf8'));

function workspace(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'hikitsugi-flow-'));
  const work = join(dir, 'work');
  const surveyPath = join(dir, 'survey.json');
  writeFileSync(surveyPath, JSON.stringify(input.survey));
  run('init', [surveyPath, '田中', '会社'], { work });
  const tool = {
    work,
    hikitsugi: (command, args = [], stdin = '') => run(command, args, { work, stdin }),
    write: (name, value) => writeFileSync(join(work, name), JSON.stringify(value)),
    read: (name) => JSON.parse(readFileSync(join(work, name), 'utf8')),
  };
  try {
    return fn(tool);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const gapsOutput = () => {
  const coverage = gold.gaps.items.map(({ item, state, evidence }) => ({ item, state, evidence }));
  const items = gold.gaps.items.filter((entry) => entry.state !== 'filled').map((entry) => entry.item);
  return { coverage, gaps: [{ id: 'GAP-001', items, why: '理由', priority: 'high', question_hint: 'ヒント' }] };
};

/** 聞き取りが終わった状態まで進める。根拠に使う回答を2件記録する。 */
function toWriter({ hikitsugi, write, read }) {
  write('gaps.json', gapsOutput());
  hikitsugi('check-gaps');
  write('next.json', { action: 'ask', gap: 'GAP-001', covers: ['CHK-01'], question: '契約先を教えてください', unfilled: [] });
  hikitsugi('record', ['answered'], '保守はカワウソシステムサービスで、連絡先は 03-0000-0102 です。');
  write('next.json', { action: 'ask', gap: 'GAP-001', covers: ['CHK-02'], question: '次の質問', unfilled: [] });
  hikitsugi('record', ['answered'], '再接続すれば直ります。');
  write('state.json', { ...read('state.json'), interview_done: true });
}

const pieces = () => {
  const manual = t1();
  const page = manual.symptom_pages[0];
  const pick = (ids) => manual.statements.filter((statement) => ids.includes(statement.id));
  const { contacts, routines, devices } = manual;
  return {
    common: { page_plan: [{ id: page.id, category: page.category, symptom: '共有フォルダが見えない' }], statements: pick(commonStatementIds(manual)), contacts, routines, devices, before_leaving: [] },
    page: { statements: pick(pageStatementIds(page)), page },
  };
};

// ---- status と検査の合否 ----

test('status：gaps.json があっても、検査に通るまで先へ進まない。検査のあとに書き換えれば戻る', () =>
  workspace(({ hikitsugi, write, work }) => {
    assert.deepEqual(nextStep(work), { step: 'gap-finder' });
    write('gaps.json', { coverage: [], gaps: [] });
    assert.deepEqual(nextStep(work), { step: 'gap-finder', unchecked: true });
    assert.throws(() => hikitsugi('check-gaps'), /判定のない必須項目/);
    assert.deepEqual(nextStep(work), { step: 'gap-finder', unchecked: true });

    write('gaps.json', gapsOutput());
    hikitsugi('check-gaps');
    assert.equal(nextStep(work).step, 'interview');

    write('gaps.json', { coverage: [], gaps: [] });
    assert.deepEqual(nextStep(work), { step: 'gap-finder', unchecked: true });
  }));

test('status：Writer の部分は、検査に通るまで次の部分へ進まない', () =>
  workspace((tool) => {
    const { hikitsugi, write, work } = tool;
    toWriter(tool);
    assert.deepEqual(nextStep(work), { step: 'writer', round: 1, part: 'common' });
    write('writer-1-common.json', pieces().common);
    assert.deepEqual(nextStep(work), { step: 'writer', round: 1, part: 'common', unchecked: true });
    hikitsugi('check-writer', ['1', 'common']);
    assert.deepEqual(nextStep(work), { step: 'writer', round: 1, part: 'T1' });

    const broken = pieces().page;
    broken.statements.find((statement) => statement.id === broken.page.steps[0]).text = 'NAS は事務所にあります。';
    write('writer-1-T1.json', broken);
    assert.deepEqual(nextStep(work), { step: 'writer', round: 1, part: 'T1', unchecked: true });
    assert.throws(() => hikitsugi('check-writer', ['1', 'T1']), /1つの操作ではありません/);
    assert.deepEqual(nextStep(work), { step: 'writer', round: 1, part: 'T1', unchecked: true });
  }));

test('status：Verifier の結果は、検査に通るまで「不合格」にしない', () =>
  workspace(({ hikitsugi, write, work }) => {
    write('gaps.json', { schema_version: 1, company: 'okojo', coverage: [], gaps: [] });
    write('state.json', { company: 'okojo', company_name: '会社', retiree: '田中', round: 3, interview_done: true, passed: false });
    const stamped = { ...t1(), company_name: '会社' };
    write('manual-3.json', stamped);
    write('edited-3.json', stamped);
    write('verification-3.json', { results: 'こわれた形' });
    assert.deepEqual(nextStep(work), { step: 'verifier', round: 3, unchecked: true });
    assert.throws(() => hikitsugi('check-verification', ['3']));
    assert.deepEqual(nextStep(work), { step: 'verifier', round: 3, unchecked: true });
    write('verification-3.json', { results: stamped.statements.map((statement) => ({ statement: statement.id, verdict: 'dangerous', reason: '', checked: [], conflicts_with: [] })) });
    assert.match(hikitsugi('check-verification', ['3']), /上限/);
    assert.equal(nextStep(work).step, 'not_passed');
  }));

// ---- Writer の形 ----

test('Writer の形：writer-task が部分に合う形を書き出す', () =>
  workspace((tool) => {
    const { hikitsugi, write, read } = tool;
    toWriter(tool);
    hikitsugi('writer-task', ['1', 'common']);
    assert.deepEqual(read('writer-format.json'), JSON.parse(JSON.stringify(writerFormat('common'))));
    write('writer-1-common.json', pieces().common);
    hikitsugi('check-writer', ['1', 'common']);
    hikitsugi('writer-task', ['1', 'T1']);
    assert.deepEqual(read('writer-format.json'), JSON.parse(JSON.stringify(writerFormat('page'))));
  }));

test('Writer の形：部品の文は text と evidence が空で通り、文面と根拠はプログラムが入れる', () =>
  workspace((tool) => {
    const { hikitsugi, write, read } = tool;
    toWriter(tool);
    write('writer-1-common.json', pieces().common);
    hikitsugi('check-writer', ['1', 'common']);
    const piece = pieces().page;
    const first = piece.statements.find((statement) => statement.id === piece.page.steps[0]);
    Object.assign(first, { library: 'LIB-001', text: '', evidence: [] });
    write('writer-1-T1.json', piece);
    hikitsugi('check-writer', ['1', 'T1']);
    // 載せ漏れの書き直しに進んでも、ページの部分は検査に通って残っている
    const saved = read('writer-1-T1.json').statements.find((statement) => statement.id === first.id);
    assert.ok(saved.text.includes('Windows'));
    assert.deepEqual(saved.evidence, ['LIB-001']);
  }));

test('Writer の形：部品でない文は、text も evidence も空を通さない', () =>
  workspace((tool) => {
    const { hikitsugi, write } = tool;
    toWriter(tool);
    write('writer-1-common.json', pieces().common);
    hikitsugi('check-writer', ['1', 'common']);
    const noEvidence = pieces().page;
    noEvidence.statements.find((statement) => !statement.library).evidence = [];
    write('writer-1-T1.json', noEvidence);
    assert.throws(() => hikitsugi('check-writer', ['1', 'T1']), /根拠（evidence）が空/);
    const noText = pieces().page;
    noText.statements.find((statement) => !statement.library).text = '';
    write('writer-1-T1.json', noText);
    assert.throws(() => hikitsugi('check-writer', ['1', 'T1']), /文章が空/);
  }));

test('Writer の形：API に渡す形（評価の条件）は変えない', () => {
  for (const schema of [commonSchema(), pageSchema()]) {
    assert.equal(schema.properties.statements.items.properties.text.minLength, 1);
    assert.equal(schema.properties.statements.items.properties.evidence.minItems, 1);
  }
});

// ---- 用語の説明の直し ----

test('merge-edits：この回に足した用語の説明の長い文は、語で伝え、追記した説明で直る', () =>
  workspace(({ hikitsugi, write, read }) => {
    const { previous_manual: manual } = buildRevision(t1(), []);
    const glossary = t1().glossary.map(({ term, company }) => {
      const statement = t1().statements.find((candidate) => candidate.id === company);
      return { term, one_line: `${term} の一言です。`, analogy: `${term} のたとえです。`, company: statement.text, evidence: statement.evidence, help_page: '' };
    });
    assert.ok(glossary.length > 0, '見本に用語の説明がありません');
    const long = { ...glossary[0], company: `${'長い説明'.repeat(15)}です。` };
    write('manual-1.json', manual);
    write('editor-1.json', { rewrites: [], glossary: [long, ...glossary.slice(1)] });
    hikitsugi('merge-edits', ['1']);
    const findings = read('plain-findings-1.json').long_sentences;
    assert.deepEqual(findings.map(({ glossary_term: term, id }) => [term, id]), [[long.term, undefined]]);

    // 語で伝えているので、ID で直す必要がない。古い案内のまま ID で直しても、手順の分かる問題で止まる
    const id = read('edited-1.json').glossary.find((entry) => entry.term === long.term).company;
    write('editor-1.json', { rewrites: [{ id, text: '短い説明です。' }], glossary: [long, ...glossary.slice(1)] });
    assert.throws(() => hikitsugi('merge-edits', ['1']), /glossary の同じ語の company/);

    // 追記した説明が使われる
    write('editor-1.json', { rewrites: [], glossary: [long, ...glossary.slice(1), { ...long, company: '短い説明です。' }] });
    hikitsugi('merge-edits', ['1']);
    assert.deepEqual(read('plain-findings-1.json').long_sentences, []);
    const edited = read('edited-1.json');
    const fixed = edited.glossary.find((entry) => entry.term === long.term).company;
    assert.equal(edited.statements.find((statement) => statement.id === fixed).text, '短い説明です。');
    assert.equal(edited.glossary.filter((entry) => entry.term === long.term).length, 1);
  }));

// ---- プログラムが組む文の指摘 ----

const vendorWithPlace = (manual) => manual.symptom_pages.find((page) => page.badge.value === 'vendor' && composeCallScript(page, manual).text.includes('機器の場所：'));

test('機器の場所の行：指摘されたページだけ外れ、組み直しても render の前でも戻らない', () => {
  const manual = withReplies(full());
  const page = vendorWithPlace(manual);
  assert.ok(page, '見本に機器の場所の行があるページがありません');
  assert.equal(withoutFlaggedPlace(manual, [{ statement: page.title }]), manual);

  const fixed = withoutFlaggedPlace(manual, [{ statement: page.fallback.message }]);
  assert.deepEqual(fixed.call_without_place, [page.id]);
  const rebuilt = withReplies(fixed);
  const textOf = (target) => {
    const found = target.symptom_pages.find((candidate) => candidate.id === page.id);
    return target.statements.find((statement) => statement.id === found.fallback.message).text;
  };
  assert.ok(!textOf(rebuilt).includes('機器の場所'));
  assert.ok(!textOf(withCurrentParts(rebuilt).manual).includes('機器の場所'));
  assert.deepEqual(callScriptProblems(rebuilt), []);
  // 差し戻しで Writer に渡す形を通っても残る
  assert.deepEqual(buildRevision(fixed, []).previous_manual.call_without_place, [page.id]);
});

/** Verifier の結果を、指定の文だけ根拠なしにして作る。 */
const verdicts = (manual, flagged) => ({ results: manual.statements.map(({ id }) => ({ statement: id, verdict: flagged.includes(id) ? 'unsupported' : 'correct', reason: '', checked: [], conflicts_with: [] })) });

/** 業者へ連絡のページ1つと、機器1つの説明書。題名の機器の置き場所が、業者に伝える文に入る。 */
const vendorPage = () => {
  const manual = { ...t1(), company_name: '会社' };
  const [page] = manual.symptom_pages;
  page.badge.value = 'vendor';
  manual.statements.find((statement) => statement.id === page.title).text = 'NAS が動かない';
  manual.statements.push(
    { id: 'STM-901', text: 'NAS', evidence: ['INT-002'] },
    { id: 'STM-902', text: '事務所の棚です。', evidence: ['INT-002'] },
    { id: 'STM-903', text: '共有フォルダを置きます。', evidence: ['INT-002'] },
    { id: 'STM-904', text: '共有フォルダが使えません。', evidence: ['INT-002'] },
    { id: 'STM-905', text: '事務所にあります。', evidence: ['INT-002'] },
  );
  manual.glossary.push({ term: 'NAS', one_line: 'NAS の一言です。', analogy: 'NAS のたとえです。', company: 'STM-905' });
  manual.devices.push({ id: 'D1', name: 'STM-901', location: 'STM-902', purpose: 'STM-903', impact: 'STM-904', credential_location: null, caution: null });
  return manual;
};

function atVerifier({ write }, manual) {
  write('gaps.json', { schema_version: 1, company: 'okojo', coverage: [], gaps: [] });
  write('state.json', { company: 'okojo', company_name: manual.company_name, retiree: '田中', round: 1, interview_done: true, passed: false });
  write('manual-1.json', manual);
  write('edited-1.json', manual);
}

test('プログラムが組む文の指摘：外せる行がなければ、回数を使わず本人に見せて止まる', () =>
  workspace((tool) => {
    const { hikitsugi, write, read, work } = tool;
    const manual = withReplies(t1());
    atVerifier(tool, manual);
    const flagged = manual.symptom_pages[0].reply_to_staff;
    write('verification-1.json', verdicts(manual, [flagged]));
    assert.match(hikitsugi('check-verification', ['1']), /書き直しでは直りません/);
    assert.equal(nextStep(work).step, 'not_passed');
    assert.equal(read('state.json').round, 1);
    assert.deepEqual(read('findings-1.json').findings.map((finding) => finding.statement), [flagged]);
  }));

test('プログラムが組む文の指摘：Writer が直す文の指摘も一緒なら、差し戻す', () =>
  workspace((tool) => {
    const { hikitsugi, write, read, work } = tool;
    const manual = withReplies(t1());
    atVerifier(tool, manual);
    const page = manual.symptom_pages[0];
    write('verification-1.json', verdicts(manual, [page.reply_to_staff, page.title]));
    assert.match(hikitsugi('check-verification', ['1']), /差し戻します（直す部分：T1）/);
    assert.equal(read('state.json').round, 2);
    assert.equal(nextStep(work).step, 'writer');
  }));

test('プログラムが組む文の指摘：機器の場所の行だけなら、Writer を呼ばずに外して検証し直す', () =>
  workspace((tool) => {
    const { hikitsugi, write, read, work } = tool;
    toWriter(tool);
    // 大型更新の載せ漏れの検査を外すため、調査データは空にする
    write('survey.json', { ...input.survey, items: [] });
    const manual = withReplies(vendorPage());
    write('manual-1.json', manual);
    write('edited-1.json', manual);
    const [page] = manual.symptom_pages;
    const message = (target) => target.statements.find((statement) => statement.id === target.symptom_pages[0].fallback.message).text;
    assert.ok(message(manual).includes('機器の場所：'));

    write('verification-1.json', verdicts(manual, [page.fallback.message]));
    assert.match(hikitsugi('check-verification', ['1']), /Editor の作業は不要/);
    assert.equal(nextStep(work).step, 'verifier');
    const edited = read('edited-2.json');
    assert.ok(!message(edited).includes('機器の場所'));
    assert.deepEqual(callScriptProblems(edited), []);
    assert.ok(read('verify-scope-2.json').statements.includes(edited.symptom_pages[0].fallback.message));

    write('verification-2.json', verdicts(edited, []));
    assert.match(hikitsugi('check-verification', ['2']), /合格/);
    assert.deepEqual(read('manual-final.json').call_without_place, [page.id]);
  }));

// ---- スキルの案内 ----

test('スキルの案内：形の指定、検査前の扱い、自由入力の言葉、確認の全文がそろっている', () => {
  const skill = readFileSync(join(ROOT, 'plugin/skills/start/SKILL.md'), 'utf8');
  for (const words of ['hikitsugi-work/writer-format.json', '"unchecked": true', 'glossary_term', '省略も要約もせず', '下の欄に入力してください']) {
    assert.ok(skill.includes(words), words);
  }
  assert.ok(skill.includes('「Other」とは書きません'));
});

test('プロンプト：R0 の直しと plain-words の決まりが入っている', () => {
  const read = (name) => readFileSync(join(ROOT, `plugin/agents/${name}.md`), 'utf8');
  const interviewer = read('interviewer');
  for (const words of ['それでも直らないときに誰へ連絡するか', '連絡の手段', '知らされた担当者がそのあと何をするか']) assert.ok(interviewer.includes(words), words);
  const writer = read('writer');
  for (const words of ['社員から知らされたとき', '見分け方を1行', '確認の結果ごとに行き先', '動いているときにしてはいけないこと', '手段を書きます']) assert.ok(writer.includes(words), words);
  const editor = read('plain-japanese-editor');
  for (const words of ['**35字以内**', 'ほかの専門用語を1つも入れません']) assert.ok(editor.includes(words), words);
});
