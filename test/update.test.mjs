// hikitsugi update：完成した説明書を、そのページだけ直して作り直す。偽の担当の出力で流れを確かめる。

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadInput } from '../eval/lib/load-set.mjs';
import { writerFormat } from '../plugin/lib/assemble.mjs';
import { pageStatementIds } from '../plugin/lib/page-check.mjs';
import { bundleOf, CREDENTIAL_MEMO, parseMemos, updateSummary, withContactPhone, withUpdateMark } from '../plugin/lib/update.mjs';
import { renderManual } from '../plugin/renderer/render.mjs';
import { withoutReplies, withReplies } from '../plugin/lib/reply.mjs';
import { validate } from '../plugin/lib/validate.mjs';
import { nextStep, run } from '../plugin/scripts/hikitsugi.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const input = loadInput(join(ROOT, 'eval/sets/okojo'));
const NEW_PHONE = '03-0000-0199';

const finishedManual = () => {
  const base = withoutReplies(JSON.parse(readFileSync(join(ROOT, 'test/fixtures/manual-t1.json'), 'utf8')));
  const manual = withReplies({ ...base, company_name: '会社', review: { reviewer: '田中', confirmed_on: '2026-11-05' } });
  return { ...manual, search_index: manual.symptom_pages.map((page) => ({ page: page.id, phrases: Array.from({ length: 15 }, (_, i) => `${page.id} の言い方 ${i}`) })) };
};

/** 完成した作業フォルダを作る。根拠の聞き取りは、連絡先の名前と番号が入る2件。 */
function finished(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'hikitsugi-update-'));
  const work = join(dir, 'hikitsugi-work');
  const surveyPath = join(dir, 'survey-input.json');
  writeFileSync(surveyPath, JSON.stringify(input.survey));
  const tool = {
    dir,
    work,
    hikitsugi: (command, args = [], stdin = '') => run(command, args, { work, stdin }),
    write: (name, value) => writeFileSync(join(work, name), JSON.stringify(value)),
    read: (name) => JSON.parse(readFileSync(join(work, name), 'utf8')),
  };
  try {
    run('init', [surveyPath, '田中', '会社'], { work });
    const manual = finishedManual();
    tool.write('survey.json', { ...input.survey, items: [] });
    const transcript = tool.read('transcript.json');
    const entry = (n, answer, status = 'answered') => ({ id: `INT-00${n}`, gap: 'GAP-001', covers: ['CHK-01'], question: '質問', answer, status, answered_at: '2026-11-04T00:00:00Z' });
    tool.write('transcript.json', { ...transcript, entries: [entry(1, '保守はカワウソシステムサービスで、連絡先は 03-0000-0102 です。'), entry(2, '再接続すれば直ります。'), entry(3, '分かりません。', 'unknown')] });
    tool.write('gaps.json', { schema_version: 1, company: 'okojo', coverage: [], gaps: [] });
    tool.write('manual-final.json', manual);
    tool.write('manual-1.json', manual);
    tool.write('edited-1.json', manual);
    tool.write('verification-1.json', { results: manual.statements.map(({ id }) => ({ statement: id, verdict: 'correct', reason: '', checked: [], conflicts_with: [] })) });
    tool.write('state.json', { company: 'okojo', company_name: '会社', retiree: '田中', round: 1, interview_done: true, passed: true, review: { reviewer: '田中', pages: { T1: 'ok' }, done: true } });
    tool.hikitsugi('render');
    return fn(tool);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const textOf = (manual, id) => manual.statements.find((statement) => statement.id === id).text;
const allCorrect = (ids) => ({ results: ids.map((id) => ({ statement: id, verdict: 'correct', reason: '', checked: [], conflicts_with: [] })) });

test('完成すると status が update を返し、manual.json を隣に置く', () =>
  finished(({ work, read }) => {
    assert.deepEqual(nextStep(work), { step: 'update', updater: null, output_dir: null, memo_left: 0 });
    const bundle = read('manual.json');
    assert.equal(bundle.kind, 'hikitsugi-manual');
    assert.equal(bundle.manual.company_name, '会社');
  }));

test('manual.json：引用された根拠だけを入れ、「分からない」の回答と本人向けの一覧を入れない', () => {
  const manual = { ...finishedManual(), before_leaving: [{ text: '本人向け', evidence: ['INT-001'] }] };
  const bundle = bundleOf({
    manual,
    survey: { ...input.survey, items: input.survey.items.slice(0, 3) },
    transcript: {
      entries: [
        { id: 'INT-001', answer: '引用される', status: 'answered' },
        { id: 'INT-050', answer: '引用されない', status: 'answered' },
        { id: 'INT-051', answer: 'カワウソシステムサービスの話', status: 'answered' },
        { id: 'INT-052', answer: 'カワウソシステムサービスは分かりません', status: 'unknown' },
      ],
    },
    state: { company: 'okojo', company_name: '会社', retiree: '田中', round: 1 },
  });
  const ids = bundle.sources.transcript.entries.map((entry) => entry.id);
  assert.ok(!ids.includes('INT-050'));
  assert.ok(ids.includes('INT-051'), '連絡先の照合に使う回答は入れる');
  assert.ok(!ids.includes('INT-052'));
  assert.equal(bundle.manual.before_leaving, undefined);
});

test('連絡先の電話番号の変更：その連絡先の番号だけが変わり、文は変わらず、印が付く', () =>
  finished(({ work, dir, hikitsugi, write, read }) => {
    const out = join(dir, 'onedrive');
    mkdirSync(out);
    const before = read('manual-final.json');
    assert.throws(() => hikitsugi('update-fix', ['VEN-02'], 'x'), /update-start/);
    hikitsugi('update-start', ['佐藤']);
    hikitsugi('update-output', [out]);
    assert.equal(nextStep(work).updater, '佐藤');
    assert.equal(nextStep(work).output_dir, out);
    assert.match(hikitsugi('review-show', ['VEN-02']), /電話番号：03-0000-0102/);

    assert.match(hikitsugi('update-fix', ['VEN-02'], `電話番号が ${NEW_PHONE} に変わりました。`), /INT-004/);
    assert.deepEqual(nextStep(work), { step: 'writer', round: 2, part: 'VEN-02' });
    hikitsugi('writer-task', ['2', 'VEN-02']);
    const task = read('writer-task.json');
    assert.equal(task.part, 'contact');
    assert.equal(task.revision.page_fix.evidence, 'INT-004');
    assert.equal(task.revision.update.kind, 'contact');
    assert.deepEqual(read('writer-format.json'), JSON.parse(JSON.stringify(writerFormat('contact'))));

    const { statements, contact } = task.revision.previous;
    const old = { statements, contact };
    // 聞き取りにない番号は通さない
    write('writer-2-VEN-02.json', { statements, contact: { ...contact, phone: '03-0000-0177' } });
    assert.throws(() => hikitsugi('check-writer', ['2', 'VEN-02']), /電話番号が根拠にありません/);
    assert.deepEqual(validate(writerFormat('contact'), old), []);
    write('writer-2-VEN-02.json', { statements, contact: { ...contact, phone: NEW_PHONE } });
    // 文が変わっていないので、照合なしで確認へ進む
    assert.match(hikitsugi('check-writer', ['2', 'VEN-02']), /合格/);
    assert.deepEqual(nextStep(work), { step: 'review', reviewer: '佐藤', page: 'VEN-02', pages: 1, update: true });
    assert.throws(() => hikitsugi('review-ok', ['T1']), /確認するのは VEN-02/);
    hikitsugi('review-ok', ['VEN-02']);
    assert.equal(nextStep(work).step, 'render');
    const output = hikitsugi('render');
    assert.ok(output.includes(join(out, 'manual.html')));

    const after = read('manual-final.json');
    assert.deepEqual(after.statements, before.statements, '文章はすべて同じ');
    assert.deepEqual(after.symptom_pages, before.symptom_pages);
    assert.deepEqual(after.search_index, before.search_index, '言い方は作り直さない');
    assert.equal(after.contacts.find((c) => c.id === 'VEN-02').phone, NEW_PHONE);
    assert.deepEqual(after.updates.map(({ target, pages, by }) => [target, pages, by]), [['VEN-02', ['T1'], '佐藤']]);
    assert.equal(after.updates[0].summary, `電話番号が ${NEW_PHONE} に変わりました。`);
    assert.equal(after.updates[0].kind, 'contact');
    assert.equal(after.review.reviewer, '田中');
    assert.equal(after.review.updated_by, '佐藤');

    // 出力先へ、PC 用、束、manual.json を直接書く
    const html = readFileSync(join(out, 'manual.html'), 'utf8');
    assert.ok(html.includes('佐藤 確認'), '角印と上部は最新の確認者');
    assert.ok(html.includes('前任の田中さんが全ページを確認'), '前任者の確認の文は残す');
    assert.match(html, /作成：[^<]* 田中 確認/);
    assert.match(html, /<p class="label intro-label">更新の記録<\/p>/);
    assert.ok(html.includes(`<td>連絡先の変更</td><td>佐藤</td><td>${after.contacts.find((contact) => contact.id === 'VEN-02').name}</td>`), '更新の記録に種類、確認した人、相手を出す');
    assert.match(html, /更新：[^<]* 佐藤 確認/);
    assert.ok(existsSync(join(out, 'phone')));
    assert.equal(JSON.parse(readFileSync(join(out, 'manual.json'), 'utf8')).manual.review.updated_by, '佐藤');
    assert.equal(nextStep(work).step, 'update');
  }));

test('手順を直す：そのページだけを書き直し、照合して、更新者が確認する', () =>
  finished(({ work, hikitsugi, write, read }) => {
    const before = read('manual-final.json');
    hikitsugi('update-start', ['佐藤']);
    hikitsugi('update-fix', ['T1'], '再接続の前に、社内 LAN につないでください。');
    assert.deepEqual(nextStep(work), { step: 'writer', round: 2, part: 'T1' });
    hikitsugi('writer-task', ['2', 'T1']);
    const task = read('writer-task.json');
    assert.equal(task.revision.page_fix.page, 'T1');
    const { statements, page } = task.revision.previous;
    const changed = page.notes[0] ?? page.reassurance;
    write('writer-2-T1.json', { statements: statements.map((s) => (s.id === changed ? { ...s, text: `${s.text}（直しました）`, evidence: ['INT-004'] } : s)), page });
    hikitsugi('check-writer', ['2', 'T1']);
    assert.equal(nextStep(work).step, 'editor');
    write('editor-2.json', { rewrites: [], glossary: [] });
    hikitsugi('merge-edits', ['2']);
    assert.deepEqual(nextStep(work), { step: 'verifier', round: 2 });
    const scope = read('verify-scope-2.json').statements;
    assert.ok(scope.includes(changed));
    assert.ok(scope.length < before.statements.length, 'かけ直すのは変わった文だけ');
    write('verification-2.json', allCorrect(scope));
    assert.match(hikitsugi('check-verification', ['2']), /合格/);
    // 題名や ① が変わらなければ、言い方は作り直さない
    assert.equal(nextStep(work).step, 'review');
    hikitsugi('review-ok', ['T1']);
    hikitsugi('render');
    const after = read('manual-final.json');
    assert.deepEqual(after.search_index, before.search_index);
    assert.match(textOf(after, changed), /直しました/);
    const unrelated = before.statements.filter((s) => s.id !== changed && !s.usage).map((s) => s.id);
    for (const id of unrelated) assert.equal(textOf(after, id), textOf(before, id), id);
    assert.match(readFileSync(join(work, 'manual.html'), 'utf8'), /更新：[^<]* 佐藤 確認/);
  }));

test('症状を足す：共通部分と新しいページを書き、言い方は新しいページだけ作る', () =>
  finished(({ work, hikitsugi, write, read }) => {
    const before = read('manual-final.json');
    hikitsugi('update-start', ['佐藤']);
    hikitsugi('update-add', [], '再接続しても開けないときは、カワウソシステムサービスに電話します。');
    assert.deepEqual(nextStep(work), { step: 'writer', round: 2, part: 'common' });
    hikitsugi('writer-task', ['2', 'common']);
    const commonTask = read('writer-task.json');
    assert.equal(commonTask.revision.update.add_symptom.id, 'T2');
    const { previous } = commonTask.revision;
    const common = { ...previous, page_plan: previous.page_plan };
    write('writer-2-common.json', common);
    assert.throws(() => hikitsugi('check-writer', ['2', 'common']), /page_plan に T2 を足してください/);
    write('writer-2-common.json', { ...common, page_plan: [...previous.page_plan, { id: 'T2', category: 'file', symptom: '開けない' }] });
    hikitsugi('check-writer', ['2', 'common']);
    assert.deepEqual(nextStep(work), { step: 'writer', round: 2, part: 'T2' });
    hikitsugi('writer-task', ['2', 'T2']);
    const pageTask = read('writer-task.json');
    assert.equal(pageTask.entry.id, 'T2');
    assert.equal(pageTask.revision.previous.page, null);

    // 前のページを写して新しいページの形にする
    const source = before.symptom_pages[0];
    const ids = new Set(pageStatementIds(source));
    const { reply_to_staff: _reply, ...page } = source;
    const statements = before.statements.filter((s) => ids.has(s.id) && !s.usage).map(({ usage: _usage, ...s }) => s);
    write('writer-2-T2.json', { statements, page: { ...page, fallback: { contact: source.fallback.contact } } });
    hikitsugi('check-writer', ['2', 'T2']);
    const step = nextStep(work).step;
    if (step === 'editor') {
      write('editor-2.json', { rewrites: [], glossary: [] });
      hikitsugi('merge-edits', ['2']);
    }
    assert.deepEqual(nextStep(work), { step: 'verifier', round: 2 });
    write('verification-2.json', allCorrect(read('verify-scope-2.json').statements));
    hikitsugi('check-verification', ['2']);
    assert.equal(nextStep(work).step, 'phrases');
    hikitsugi('phrase-task');
    assert.deepEqual(read('phrase-pages.json').pages.map((entry) => entry.id), ['T2']);
    write('phrases.json', { pages: [{ id: 'T2', phrases: Array.from({ length: 15 }, (_, i) => `T2 の言い方 ${i}`) }] });
    hikitsugi('check-phrases');
    assert.deepEqual(nextStep(work), { step: 'review', reviewer: '佐藤', page: 'T2', pages: 1, update: true });
    hikitsugi('review-ok', ['T2']);
    hikitsugi('render');
    const after = read('manual-final.json');
    assert.deepEqual(after.symptom_pages.map((p) => p.id), ['T1', 'T2']);
    assert.deepEqual(after.search_index.map((e) => e.page).sort(), ['T1', 'T2']);
    assert.deepEqual(after.search_index.find((e) => e.page === 'T1'), before.search_index[0]);
  }));

test('manual.json だけの場所から更新を始められる。番号は重ならず、同じ場所へ書く', () =>
  finished(({ dir, work, read }) => {
    const shared = join(dir, 'shared');
    mkdirSync(shared);
    writeFileSync(join(shared, 'manual.json'), JSON.stringify(read('manual.json')));
    const newWork = join(shared, 'hikitsugi-work');
    const go = (command, args = [], stdin = '') => run(command, args, { work: newWork, stdin });
    assert.equal(nextStep(newWork).step, 'update');
    assert.equal(nextStep(newWork).from_bundle, true);
    go('update-start', ['佐藤']);
    assert.equal(nextStep(newWork).output_dir, shared);
    assert.match(go('update-fix', ['VEN-02'], `電話番号が ${NEW_PHONE} に変わりました。`), /INT-003/);
    go('writer-task', ['2', 'VEN-02']);
    const { revision } = JSON.parse(readFileSync(join(newWork, 'writer-task.json'), 'utf8'));
    writeFileSync(join(newWork, 'writer-2-VEN-02.json'), JSON.stringify({ statements: revision.previous.statements, contact: { ...revision.previous.contact, phone: NEW_PHONE } }));
    go('check-writer', ['2', 'VEN-02']);
    go('review-ok', ['VEN-02']);
    go('render');
    assert.equal(JSON.parse(readFileSync(join(shared, 'manual.json'), 'utf8')).manual.contacts[0].phone, NEW_PHONE);
    assert.ok(readFileSync(join(shared, 'manual.html'), 'utf8').includes('佐藤 確認'));
    assert.ok(work);
  }));

test('差し戻しの上限で止まった更新は取り消せて、次の更新に古いファイルを使わない', () =>
  finished(({ work, hikitsugi, write, read }) => {
    const before = read('manual-final.json');
    hikitsugi('update-start', ['佐藤']);
    hikitsugi('update-fix', ['T1'], 'ページを直します。');
    hikitsugi('writer-task', ['2', 'T1']);
    const { statements, page } = read('writer-task.json').revision.previous;
    write('writer-2-T1.json', { statements, page });
    hikitsugi('check-writer', ['2', 'T1']);
    assert.match(hikitsugi('update-cancel'), /前のまま/);
    assert.deepEqual(read('manual-final.json'), before);
    assert.equal(read('transcript.json').entries.length, 3);
    assert.equal(read('state.json').round, 1);
    assert.ok(!existsSync(join(work, 'writer-2-T1.json')));
    assert.equal(nextStep(work).step, 'update');
    hikitsugi('update-fix', ['T1'], 'もう一度直します。');
    assert.deepEqual(nextStep(work), { step: 'writer', round: 2, part: 'T1' });
  }));

test('メモの取り込み：ページごとに分け、続きの行をまとめ、パスワードらしい文に印を付ける', () => {
  const manual = finishedManual();
  const title = textOf(manual, manual.symptom_pages[0].title);
  const items = parseMemos(`${title}：一言目\n二行目\nカワウソシステムサービス：パスワードは abcd1234 です\n知らない名前：あとの行\n`, manual);
  assert.deepEqual(items.map(({ target }) => target), ['T1', 'VEN-02']);
  assert.equal(items[0].text, '一言目\n二行目');
  assert.equal(items[1].text, CREDENTIAL_MEMO, '本文は残さない');
  assert.equal(items[1].has_credential, true);
  assert.equal(items[0].has_credential, false);
});

test('メモの列：1件ずつ取り出して進める', () =>
  finished(({ work, hikitsugi, read }) => {
    hikitsugi('update-start', ['佐藤']);
    const title = textOf(read('manual-final.json'), read('manual-final.json').symptom_pages[0].title);
    const first = JSON.parse(hikitsugi('update-memo', [], `${title}：メモ1\nカワウソシステムサービス：メモ2\n`));
    assert.equal(first.count, 2);
    assert.equal(first.next.target, 'T1');
    assert.equal(nextStep(work).memo_left, 2);
    assert.equal(JSON.parse(hikitsugi('memo-next', ['done'])).next.target, 'VEN-02');
    assert.equal(JSON.parse(hikitsugi('memo-next', ['done'])).next, null);
    assert.equal(nextStep(work).memo_left, 0);
  }));

test('更新の印：連絡先はそれを使うページに付け、機器はページに付けない', () => {
  const manual = finishedManual();
  assert.deepEqual(withUpdateMark(manual, { target: 'VEN-02', by: '佐藤', date: '2026-12-01' }).updates[0].pages, ['T1']);
  assert.deepEqual(withUpdateMark(manual, { target: 'T1', by: '佐藤', date: '2026-12-01' }).updates[0].pages, ['T1']);
});

test('スキルの案内：update の4択と、更新に Claude Code が要ることがそろっている', () => {
  const skill = readFileSync(join(ROOT, 'plugin/skills/start/SKILL.md'), 'utf8');
  for (const words of ['「連絡先を直す」「症状を足す」「手順を直す」「後任のメモから取り込む」', 'update-fix', 'update-add', 'update-memo', 'update-cancel', '更新には Claude Code が要ります', 'update-output']) assert.ok(skill.includes(words), words);
  assert.ok(!skill.includes('### done'));
  assert.ok(readFileSync(join(ROOT, 'plugin/agents/writer.md'), 'utf8').includes('task.revision.update'));
});

test('更新の記録：内容は60字までで文の切れ目で切り、種類を出す。確認した人が複数なら角印の名前を「・」でつなぐ', () => {
  const manual = finishedManual();
  assert.equal(updateSummary(`  あ\nい${'う'.repeat(40)}`), `あ い${'う'.repeat(40)}`, '60字までは切らない');
  const sixty = 'あ'.repeat(40);
  assert.equal(updateSummary(`${sixty}。${'い'.repeat(40)}`), `${sixty}…`, '「。」で切る');
  assert.equal(updateSummary(`${sixty}、${'い'.repeat(10)}。${'う'.repeat(40)}`), `${sixty}、${'い'.repeat(10)}…`, '60字の中の最後の切れ目で切る');
  assert.equal(updateSummary(`${'あ'.repeat(30)}、${'い'.repeat(40)}`), `${'あ'.repeat(30)}…`, '「、」でも切る');
  assert.equal(updateSummary('あ'.repeat(70)), `${'あ'.repeat(60)}…`, '切れ目がなければ60字で切る');
  const first = withUpdateMark(manual, { target: 'T1', by: '佐藤', date: '2026-12-01', summary: '受付を直す', kind: 'page' });
  assert.equal(first.review.updated_by, '佐藤');
  assert.deepEqual(first.updates[0], { target: 'T1', pages: ['T1'], by: '佐藤', date: '2026-12-01', kind: 'page', summary: '受付を直す' });
  const second = withUpdateMark(first, { target: 'T1', by: '社長', date: '2027-01-10', summary: '番号を直す', kind: 'memo' });
  assert.equal(second.review.updated_by, '佐藤・社長');
  assert.equal(second.review.updated_on, '2027-01-10');
  const third = withUpdateMark(second, { target: 'T1', by: '佐藤', date: '2027-02-01', summary: 'もう一度' });
  assert.equal(third.review.updated_by, '佐藤・社長', '同じ人は1回だけ');
  const html = renderManual(third);
  assert.match(html, /aria-label="佐藤・社長 確認/);
  assert.match(html, /<th>日付<\/th><th>種類<\/th><th>確認した人<\/th>/);
  assert.ok(html.includes('<td>メモの取り込み</td><td>社長</td>'));
  assert.ok(html.includes('<td>手順の修正</td><td>佐藤</td>'));
  // 表は新しい順
  assert.ok(html.indexOf('もう一度') < html.indexOf('番号を直す') && html.indexOf('番号を直す') < html.indexOf('受付を直す'));
  // ページ末尾は作成と更新の2段
  assert.match(html, /<span>作成：[^<]* 田中 確認<\/span><span>更新：[^<]* 佐藤 確認<\/span>/);
});

test('費用の測定：3種類を測り、費用の上限を超えたら担当を呼ばずに止まる', async () => {
  const { CASES, driveUpdate } = await import('../eval/update-cost.mjs');
  assert.deepEqual(CASES.map((item) => item.name), ['contact', 'page', 'add']);
  const stopped = await driveUpdate({ work: '/存在しないフォルダ', api: null, overBudget: () => true }).catch((error) => error.message);
  assert.match(stopped, /費用の上限/);
});

test('番号の更新：文の中の古い番号も直し、根拠を足す。ほかの連絡先が同じ番号なら置き換えない', () => {
  const manual = {
    contacts: [{ id: 'VEN-01', name: 'A', phone: '03-0000-0102' }, { id: 'VEN-02', name: 'B', phone: '03-0000-0103' }],
    statements: [{ id: 'STM-001', text: '連絡先は 03-0000-0102 です。', evidence: ['INT-001'] }, { id: 'STM-002', text: '別の文です。', evidence: ['INT-001'] }],
  };
  const replaced = withContactPhone(manual, 'VEN-01', '03-0000-0102', NEW_PHONE, 'INT-009');
  assert.deepEqual(replaced.statements[0], { id: 'STM-001', text: `連絡先は ${NEW_PHONE} です。`, evidence: ['INT-001', 'INT-009'] });
  assert.equal(replaced.statements[1], manual.statements[1]);
  assert.equal(withContactPhone(manual, 'VEN-01', '03-0000-0102', '03-0000-0102', 'INT-009'), manual);
  const shared = { ...manual, contacts: [manual.contacts[0], { ...manual.contacts[1], phone: '03-0000-0102' }] };
  assert.equal(withContactPhone(shared, 'VEN-01', '03-0000-0102', NEW_PHONE, 'INT-009'), shared);
});

test('番号の更新の流れ：文の中の番号が直って照合にかかり、古い番号が残らず、そのページに更新の行が付く', () =>
  finished(({ work, dir, hikitsugi, write, read }) => {
    const manual = read('manual-final.json');
    const contact = manual.contacts.find((candidate) => candidate.id === 'VEN-02');
    const page = manual.symptom_pages[0];
    const target = manual.statements.find((statement) => statement.id === page.reassurance);
    const oldText = `${contact.name}の連絡先は ${contact.phone} です。`;
    target.text = oldText;
    // 用語の説明の文にも番号がある場合。差し戻しの形に入らない文
    const termStatement = manual.statements.find((statement) => statement.id === manual.glossary[0].company);
    termStatement.text = `この会社では ${contact.phone} に電話します。`;
    write('manual-final.json', manual);
    write(`edited-${read('state.json').round}.json`, manual);
    hikitsugi('update-start', ['佐藤']);
    const shown = hikitsugi('review-show', ['VEN-02']);
    assert.match(shown, /【この名前が出てくるほかの文】/);
    assert.ok(shown.includes(oldText));
    hikitsugi('update-fix', ['VEN-02'], `電話番号が ${NEW_PHONE} に変わりました。`);
    hikitsugi('writer-task', ['2', 'VEN-02']);
    const { statements, contact: previous } = read('writer-task.json').revision.previous;
    write('writer-2-VEN-02.json', { statements, contact: { ...previous, phone: NEW_PHONE } });
    hikitsugi('check-writer', ['2', 'VEN-02']);
    const written = read('manual-2.json');
    const fixed = written.statements.find((statement) => statement.id === target.id);
    assert.equal(fixed.text, `${contact.name}の連絡先は ${NEW_PHONE} です。`);
    assert.ok(fixed.evidence.includes('INT-004'), '今回の回答を根拠に足す');
    assert.ok(!written.statements.some((statement) => statement.text.includes(contact.phone)), '古い番号は残らない');
    assert.equal(nextStep(work).step, 'editor');
    write('editor-2.json', { rewrites: [], glossary: [] });
    hikitsugi('merge-edits', ['2']);
    assert.deepEqual(read('verify-scope-2.json').statements.includes(target.id), true, '直した文は照合にかける');
    const edited = read('edited-2.json');
    assert.ok(read('verify-scope-2.json').statements.includes(termStatement.id), '用語の説明の文も照合にかける');
    assert.equal(edited.statements.find((statement) => statement.id === termStatement.id).text, `この会社では ${NEW_PHONE} に電話します。`);
    assert.ok(!edited.statements.some((statement) => statement.text.includes(contact.phone)), '用語の説明にも古い番号は残らない');
    write('verification-2.json', { results: read('verify-scope-2.json').statements.map((statement) => ({ statement, verdict: 'correct', reason: '', checked: [], conflicts_with: [] })) });
    hikitsugi('check-verification', ['2']);
    assert.equal(edited.contacts.find((candidate) => candidate.id === 'VEN-02').phone, NEW_PHONE);
    hikitsugi('review-ok', ['VEN-02']);
    assert.ok(read('manual-final.json').updates[0].pages.includes(page.id), '番号を書いているページにも更新の行を出す');
    hikitsugi('render');
    assert.ok(!readFileSync(join(work, 'manual.html'), 'utf8').includes('<span>0102</span>'), 'HTML にも古い番号が残らない');
  }));

test('メモ：パスワードらしい値のある文は、列にも担当にも渡さない', () => {
  const manual = finishedManual();
  const items = parseMemos('社長：社長の PC のパスワードは abcd1234 です。', manual);
  assert.equal(items[0].has_credential, true);
  assert.equal(items[0].text, CREDENTIAL_MEMO);
  assert.ok(!JSON.stringify(items).includes('abcd1234'));
});

test('症状を足す：差し戻しの回には足した行を二重にせず、共通部分と新しいページを書き直せる', () =>
  finished(({ work, hikitsugi, write, read }) => {
    const before = read('manual-final.json');
    hikitsugi('update-start', ['佐藤']);
    hikitsugi('update-add', [], '再接続しても開けないときは、カワウソシステムサービスに電話します。');
    hikitsugi('writer-task', ['2', 'common']);
    const { previous } = read('writer-task.json').revision;
    // 共通部分の文を1つ変えて、照合にかかるようにする
    const commonOne = before.contacts[0].what_to_tell;
    const changedCommon = previous.statements.map((s) => (s.id === commonOne ? { ...s, text: `${s.text} 足しました。` } : s));
    write('writer-2-common.json', { ...previous, statements: changedCommon, page_plan: [...previous.page_plan, { id: 'T2', category: 'file', symptom: '開けない' }] });
    hikitsugi('check-writer', ['2', 'common']);
    const source = before.symptom_pages[0];
    const ids = new Set(pageStatementIds(source));
    const { reply_to_staff: _reply, ...page } = source;
    const statements = before.statements.filter((s) => ids.has(s.id) && !s.usage).map(({ usage: _usage, ...s }) => s);
    write('writer-2-T2.json', { statements, page: { ...page, fallback: { contact: source.fallback.contact } } });
    hikitsugi('check-writer', ['2', 'T2']);
    write('editor-2.json', { rewrites: [], glossary: [] });
    hikitsugi('merge-edits', ['2']);
    // 共通部分の文と新しいページの文の両方に指摘を付ける
    const scope = read('verify-scope-2.json').statements;
    const edited = read('edited-2.json');
    const added = edited.symptom_pages.find((candidate) => candidate.id === 'T2');
    const verdicts = [...new Set([...scope, commonOne, added.reassurance])].map((statement) => ({ statement, verdict: statement === commonOne || statement === added.reassurance ? 'unsupported' : 'correct', reason: '根拠がありません', checked: [], conflicts_with: [] }));
    write('verification-2.json', { results: verdicts });
    assert.match(hikitsugi('check-verification', ['2']), /差し戻します/);
    assert.deepEqual(read('state.json').todo.sort(), ['T2', 'common']);

    assert.deepEqual(nextStep(work), { step: 'writer', round: 3, part: 'common' });
    hikitsugi('writer-task', ['3', 'common']);
    const again = read('writer-task.json');
    assert.equal(again.revision.update.add_symptom, undefined, '行はもう足してある');
    write('writer-3-common.json', again.revision.previous);
    hikitsugi('check-writer', ['3', 'common']);
    hikitsugi('writer-task', ['3', 'T2']);
    const pageTask = read('writer-task.json');
    assert.equal(pageTask.entry.id, 'T2');
    assert.ok(pageTask.revision.previous.page, '前の版のページを渡す');
    write('writer-3-T2.json', pageTask.revision.previous);
    hikitsugi('check-writer', ['3', 'T2']);
    assert.deepEqual(read('manual-3.json').symptom_pages.map((candidate) => candidate.id), ['T1', 'T2']);
  }));

test('メモから始めた更新は、種類を「メモの取り込み」として記録する', () =>
  finished(({ work, hikitsugi, write, read }) => {
    hikitsugi('update-start', ['佐藤']);
    const title = read('manual-final.json').statements.find((statement) => statement.id === read('manual-final.json').symptom_pages[0].title).text;
    hikitsugi('update-memo', [], `${title}：再接続の前に、社内 LAN につないでください。`);
    hikitsugi('update-fix', ['T1'], '再接続の前に、社内 LAN につないでください。');
    assert.equal(read('state.json').update.from_memo, true);
    hikitsugi('update-cancel');
    hikitsugi('memo-next', ['done']);
    hikitsugi('update-fix', ['T1'], '別の直しです。');
    assert.equal(read('state.json').update.from_memo, undefined);
    assert.equal(nextStep(work).step, 'writer');
  }));
