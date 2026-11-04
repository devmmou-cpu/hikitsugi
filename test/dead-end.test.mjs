// 行き止まりの検査と、前任者に聞いて書き直す流れ。偽の担当の出力で確かめる。AI も通信も使わない。

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadInput } from '../eval/lib/load-set.mjs';
import { deadEndFixProblems, deadEnds, firstInternal, unknownSentence } from '../plugin/lib/dead-end.mjs';
import { withoutReplies, withReplies } from '../plugin/lib/reply.mjs';
import { nextStep, run } from '../plugin/scripts/hikitsugi.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** 文と連絡先とページの最小の形を作る。 */
function manualOf(contacts, pages) {
  const statements = [];
  const add = (text) => {
    const id = `STM-${String(statements.length + 1).padStart(3, '0')}`;
    statements.push({ id, text, evidence: ['INT-001'], library: null });
    return id;
  };
  return {
    statements,
    contacts: contacts.map(([id, name, phone, hours]) => ({ id, name, phone, hours: hours ? add(hours) : null })),
    symptom_pages: pages.map(([id, value, title, contact, notes = []]) => ({
      id,
      title: add(title),
      badge: { value, statement: add('すること。') },
      reassurance: add('決まっています。'),
      notes: notes.map(add),
      first_steps: [],
      branches: [],
      steps: [],
      exceptions: [],
      ...(contact ? { fallback: { contact } } : {}),
    })),
  };
}

// クズリ運輸の記録（模擬評価 20261104T071245）から、検査に要る部分だけを写した
const KUZURI = () => manualOf(
  [
    ['VEN-01', 'クロテン通信', '03-0000-0111', '24時間受け付けています。'],
    ['VEN-02', 'カワウソシステムサービス', '03-0000-0112', '平日9時から18時に受け付けています。'],
    ['VEN-04', 'イタチ事務機', '03-0000-0113', '受付時間の記録がありません。'],
    ['INH-01', '配車室の係長', null, null],
    ['INH-02', '社長', null, null],
  ],
  [
    ['T1', 'self', '共有フォルダが見えない', 'VEN-02'],
    ['T4', 'vendor', '回線が止まって、ネットも社内も使えない', 'VEN-01'],
    ['T6', 'internal', 'ウイルスに感染したかもしれない PC がある', 'INH-02'],
    ['T7', 'internal', '怪しいメールが来た', 'INH-02'],
    ['T8', 'internal', '社員がパスワードを忘れた', 'INH-01'],
    ['T9', 'vendor', '複合機が故障した', 'VEN-04'],
  ],
);

test('クズリ運輸の記録で、連絡の手段がない社内の相談先のページが挙がる', () => {
  const found = deadEnds(KUZURI());
  assert.deepEqual(found.map(({ page }) => page), ['T6', 'T7', 'T8']);
  assert.deepEqual(found[0].kinds, ['no_means']);
  assert.equal(found[2].contact, '配車室の係長');
  assert.match(found[2].reasons[0], /配車室の係長.*連絡の手段がありません/);
});

test('名前がないページ、「社内で相談」だけで相手がいないページも挙がる', () => {
  const manual = manualOf(
    [['VEN-01', 'クロテン通信', '03-0000-0111', '24時間受け付けています。'], ['INH-01', '社長', null, '連絡は内線でします。']],
    [
      ['T1', 'internal', '名前がない', null],
      ['T2', 'vendor', '相手がいない', 'VEN-01', ['置き場所は、記録がありません。社内で相談してください。']],
      ['T3', 'internal', '社内の相手がいる', 'INH-01', ['置き場所は、記録がありません。社内で相談してください。']],
      ['T4', 'self', '自分で直せるページは見ない', null, ['社内で相談してください。']],
    ],
  );
  assert.deepEqual(deadEnds(manual).map(({ page, kinds }) => [page, kinds]), [['T1', ['no_contact']], ['T2', ['no_target']]]);
});

test('内線、席、電話番号のどれかがあれば、手段があるとする', () => {
  for (const hours of ['連絡は内線でします。', '工場事務所の席にいます。', 'Teams で連絡します。']) {
    assert.deepEqual(deadEnds(manualOf([['INH-01', '係長', null, hours]], [['T1', 'internal', '題', 'INH-01']])), [], hours);
  }
  assert.deepEqual(deadEnds(manualOf([['VEN-01', '業者', '03-0000-0111', null]], [['T1', 'vendor', '題', 'VEN-01']])), []);
});

test('「分からない」の定型は、社内の相談先のうち手段があるものの先頭を指す', () => {
  const manual = manualOf([['VEN-01', '業者', '03-0000-0111', null], ['INH-01', '工場の CAD 担当者', null, null], ['INH-02', '社長', null, '連絡は内線でします。']], []);
  assert.equal(firstInternal(manual).name, '社長');
  assert.equal(unknownSentence(manual), '連絡先の記録がありません。社長に聞いてください。');
  // 手段のある相手がいなければ、社内の先頭
  assert.equal(unknownSentence(KUZURI()), '連絡先の記録がありません。配車室の係長に聞いてください。');
  // 社内の相手がいなければ、社内で相談
  assert.equal(unknownSentence(manualOf([['VEN-01', '業者', '03-0000-0111', null]], [])), '連絡先の記録がありません。社内で相談してください。');
});

test('相手がいないだけのページの定型は「記録がありません」と書かない（業者の記録と矛盾するため）', () => {
  const manual = manualOf([['VEN-01', '業者', '03-0000-0111', null], ['INH-01', '社長', null, '連絡は内線でします。']], []);
  assert.equal(unknownSentence(manual, ['no_target']), '社内で相談するときは、社長に聞いてください。');
  assert.equal(unknownSentence(manual, ['no_means']), '連絡先の記録がありません。社長に聞いてください。');
  assert.equal(unknownSentence(manual, ['no_contact', 'no_target']), '連絡先の記録がありません。社長に聞いてください。');
});

test('書き直したページは、答えを根拠にし、定型の文を入れる', () => {
  const statements = [{ id: 'STM-001', text: '連絡先の記録がありません。 社長に聞いてください。', evidence: ['INT-009'] }];
  assert.deepEqual(deadEndFixProblems(statements, 'T1', { evidence: 'INT-009', must_include: '連絡先の記録がありません。社長に聞いてください。' }), []);
  assert.match(deadEndFixProblems(statements, 'T1', { evidence: 'INT-010' })[0], /INT-010/);
  assert.match(deadEndFixProblems(statements, 'T1', { evidence: 'INT-009', must_include: '別の文。' })[0], /そのまま入れて/);
});

// ---- 流れ ----
const input = loadInput(join(ROOT, 'eval/sets/okojo'));

/** 合格して、確認の前まで進んだ作業フォルダ。ページが2つあり、どちらも連絡の手段のない社内の相談先を指す。 */
function atDeadEnd(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'hikitsugi-dead-end-'));
  const work = join(dir, 'hikitsugi-work');
  const surveyPath = join(dir, 'survey-input.json');
  writeFileSync(surveyPath, JSON.stringify(input.survey));
  const hikitsugi = (command, args = [], stdin = '') => run(command, args, { work, stdin });
  const write = (name, value) => writeFileSync(join(work, name), JSON.stringify(value));
  const read = (name) => JSON.parse(readFileSync(join(work, name), 'utf8'));
  try {
    run('init', [surveyPath, '田中', '会社'], { work });
    const base = withoutReplies(JSON.parse(readFileSync(join(ROOT, 'test/fixtures/manual-t1.json'), 'utf8')));
    const [page] = base.symptom_pages;
    const role = { id: 'STM-901', text: '社内の相談', evidence: ['INT-001'], library: null };
    const title2 = { id: 'STM-902', text: '別の困りごと', evidence: ['INT-001'], library: null };
    const tell = { id: 'STM-903', text: '困っていることを伝えてください。', evidence: ['INT-001'], library: null };
    const fallback = { ...page.fallback, contact: 'INH-01' };
    const pages = [
      { ...page, badge: { ...page.badge, value: 'internal' }, fallback },
      { ...page, id: 'T2', title: 'STM-902', badge: { ...page.badge, value: 'internal' }, fallback },
    ];
    const manual = withReplies({
      ...base,
      company_name: '会社',
      statements: [...base.statements, role, title2, tell],
      contacts: [...base.contacts, { id: 'INH-01', name: '工場の担当者', phone: '', role: 'STM-901', hours: null, contract_location: null, what_to_tell: 'STM-903' }],
      symptom_pages: pages,
    });
    write('survey.json', { ...input.survey, items: [] });
    const entry = (n, answer) => ({ id: `INT-00${n}`, gap: 'GAP-001', covers: ['CHK-01'], question: '質問', answer, status: 'answered', answered_at: '2026-11-04T00:00:00Z' });
    write('transcript.json', { ...read('transcript.json'), entries: [entry(1, '保守はカワウソシステムサービスで、連絡先は 03-0000-0102 です。')] });
    write('gaps.json', { schema_version: 1, company: 'okojo', coverage: [], gaps: [] });
    for (const name of ['manual-final.json', 'manual-1.json', 'edited-1.json']) write(name, manual);
    write('verification-1.json', { schema_version: 1, company: 'okojo', round: 1, results: manual.statements.map(({ id }) => ({ statement: id, verdict: 'correct', reason: '', checked: [], conflicts_with: [] })) });
    write('state.json', { company: 'okojo', company_name: '会社', retiree: '田中', round: 1, interview_done: true, passed: true });
    return fn({ work, hikitsugi, write, read });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('確認の前に行き止まりを聞き、答えを記録して、答えのあったページだけを書き直す', () =>
  atDeadEnd(({ work, hikitsugi, write, read }) => {
    const first = nextStep(work);
    assert.equal(first.step, 'dead-end');
    assert.equal(first.page, 'T1');
    assert.equal(first.left, 2);
    assert.deepEqual(first.kinds, ['no_means']);
    assert.equal(first.same_answer, undefined);
    assert.throws(() => hikitsugi('dead-end-answer', ['T9'], '内線です'), /行き止まりのページではありません/);
    assert.throws(() => hikitsugi('dead-end-answer', ['T1'], '   '), /空です/);

    assert.match(hikitsugi('dead-end-answer', ['T1'], '工場事務所の内線 201 で聞きます。'), /INT-002.*残り 1 ページ/);
    const added = read('transcript.json').entries.at(-1);
    assert.match(added.question, /T1.*行き止まりです。誰に、どうやって連絡しますか。/);
    assert.equal(added.answer, '工場事務所の内線 201 で聞きます。');

    // 同じ相手のページには、前の答えを添える。まだ書き直さない
    const second = nextStep(work);
    assert.equal(second.page, 'T2');
    assert.equal(second.same_answer, '工場事務所の内線 201 で聞きます。');

    assert.match(hikitsugi('dead-end-unknown', ['T2']), /T1、T2 を書き直します/);
    const unknown = read('transcript.json').entries.at(-1);
    assert.match(unknown.answer, /^分からない。.*連絡先の記録がありません。工場の担当者に聞いてください。/);

    // まとめて1回で書き直す
    assert.deepEqual(nextStep(work), { step: 'writer', round: 2, part: 'T1' });
    hikitsugi('writer-task', ['2', 'T1']);
    const task = read('writer-task.json');
    assert.match(task.revision.page_fix.comment, /工場事務所の内線 201/);
    assert.equal(task.revision.page_fix.evidence, 'INT-002');

    // 答えを根拠にしない書き直しは通さない
    const { statements, ...rest } = task.revision.previous;
    write('writer-2-T1.json', { statements, page: rest.page });
    assert.throws(() => hikitsugi('check-writer', ['2', 'T1']), /根拠に INT-002/);
    const note = { id: 'STM-950', text: '工場の担当者には、工場事務所の内線 201 で聞きます。', evidence: ['INT-002'], library: null };
    write('writer-2-T1.json', { statements: [...statements, note], page: { ...rest.page, notes: ['STM-950', ...rest.page.notes] } });
    hikitsugi('check-writer', ['2', 'T1']);

    assert.equal(nextStep(work).part, 'T2');
    hikitsugi('writer-task', ['2', 'T2']);
    const other = read('writer-task.json').revision;
    assert.match(other.page_fix.comment, /次の文をそのまま/);
    // 定型の文がない書き直しは通さない
    const plain = { id: 'STM-951', text: '社内に聞いてください。', evidence: ['INT-003'], library: null };
    write('writer-2-T2.json', { statements: [...other.previous.statements, plain], page: { ...other.previous.page, notes: ['STM-951', ...other.previous.page.notes] } });
    assert.throws(() => hikitsugi('check-writer', ['2', 'T2']), /そのまま入れて/);
    const fixed = { ...plain, text: '連絡先の記録がありません。工場の担当者に聞いてください。' };
    write('writer-2-T2.json', { statements: [...other.previous.statements, fixed], page: { ...other.previous.page, notes: ['STM-951', ...other.previous.page.notes] } });
    hikitsugi('check-writer', ['2', 'T2']);

    // Editor と Verifier を通すと、もう聞かずに言い方へ進む
    assert.equal(nextStep(work).step, 'editor');
    write('editor-2.json', { rewrites: [], glossary: [] });
    hikitsugi('merge-edits', ['2']);
    assert.equal(nextStep(work).step, 'verifier');
    const scope = read('verify-scope-2.json').statements;
    write('verification-2.json', { schema_version: 1, company: 'okojo', round: 2, results: scope.map((id) => ({ statement: id, verdict: 'correct', reason: '', checked: [], conflicts_with: [] })) });
    assert.match(hikitsugi('check-verification', ['2']), /合格/);
    assert.equal(nextStep(work).step, 'phrases');
    const after = read('manual-final.json');
    assert.ok(after.statements.some((statement) => statement.text.includes('内線 201')));
    assert.equal(read('state.json').dead_end_fixes, undefined);
  }));

test('照合で定型の文に指摘が出たら、次の回は指摘を優先して、定型を強制しない', () =>
  atDeadEnd(({ work, hikitsugi, write, read }) => {
    hikitsugi('dead-end-answer', ['T1'], '工場事務所の内線 201 で聞きます。');
    hikitsugi('dead-end-unknown', ['T2']);
    const put = (part, sentence, evidence) => {
      hikitsugi('writer-task', [String(read('state.json').round), part]);
      const { previous } = read('writer-task.json').revision;
      const added = { id: 'STM-960', text: sentence, evidence: [evidence], library: null };
      write(`writer-${read('state.json').round}-${part}.json`, { statements: [...previous.statements, added], page: { ...previous.page, notes: ['STM-960', ...previous.page.notes] } });
      hikitsugi('check-writer', [String(read('state.json').round), part]);
    };
    put('T1', '工場事務所の内線 201 で聞きます。', 'INT-002');
    put('T2', '連絡先の記録がありません。工場の担当者に聞いてください。', 'INT-003');
    write('editor-2.json', { rewrites: [], glossary: [] });
    hikitsugi('merge-edits', ['2']);
    const edited = read('edited-2.json');
    const flagged = edited.statements.find((statement) => statement.text.startsWith('連絡先の記録がありません。工場')).id;
    write('verification-2.json', { schema_version: 1, company: 'okojo', round: 2, results: read('verify-scope-2.json').statements.map((id) => ({ statement: id, verdict: id === flagged ? 'contradiction' : 'correct', reason: '記録と矛盾します', checked: ['INT-001'], conflicts_with: id === flagged ? ['INT-001'] : [] })) });
    assert.match(hikitsugi('check-verification', ['2']), /差し戻します（直す部分：T2）/);
    hikitsugi('writer-task', ['3', 'T2']);
    const task = read('writer-task.json').revision;
    assert.match(task.page_fix.comment, /findings の指摘があるときは、指摘に従って/);
    // 定型の文がなくても通る。答えを根拠にすることは変わらない
    const { statements, page } = task.previous;
    const rewritten = statements.map((statement) => (statement.id === flagged ? { ...statement, text: '社内で相談するときは、工場の担当者に聞いてください。' } : statement));
    write('writer-3-T2.json', { statements: rewritten, page });
    assert.doesNotThrow(() => hikitsugi('check-writer', ['3', 'T2']));
  }));
