// 社員に返す文の決まりを確かめる。プログラムが組み、部品の文面と定型文のほかは通さない。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { pageSchema } from '../plugin/lib/assemble.mjs';
import { plainProblems } from '../plugin/lib/plain-check.mjs';
import { loadLibrary } from '../plugin/lib/procedures.mjs';
import { composeReply, REPLY_LINES_MAX, replyProblems, withoutReplies, withReplies } from '../plugin/lib/reply.mjs';
import { renderManual } from '../plugin/renderer/render.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const fixture = () => JSON.parse(readFileSync(join(ROOT, 'test/fixtures/manual-full.json'), 'utf8'));
const library = loadLibrary();
const parts = new Map(library.procedures.map((part) => [part.id, part]));
const statementOf = (manual, id) => manual.statements.find((statement) => statement.id === id);
const replyOf = (manual, page) => statementOf(manual, page.reply_to_staff);

test('見本の全ページで、決まりに合っている', () => {
  assert.deepEqual(replyProblems(fixture()), []);
  assert.deepEqual(replyProblems(JSON.parse(readFileSync(join(ROOT, 'test/fixtures/manual-t1.json'), 'utf8'))), []);
});

test('① がすべて社員に渡せる部品のページは、その文面を順番どおりに写す', () => {
  const manual = fixture();
  const page = manual.symptom_pages.find((p) => p.first_steps.length && ['self', 'check_first'].includes(p.badge.value) && p.first_steps.every((id) => statementOf(manual, id).library && !parts.get(statementOf(manual, id).library).needs_table));
  assert.ok(page, '見本に該当のページがありません');
  const reply = replyOf(manual, page);
  assert.deepEqual(reply.text.split('\n'), page.first_steps.map((id) => statementOf(manual, id).text));
  assert.deepEqual(reply.evidence, page.first_steps.map((id) => statementOf(manual, id).library));
  assert.equal(reply.usage, 'reply_to_staff');
  assert.ok(reply.text.split('\n').length <= REPLY_LINES_MAX);
});

test('業者へ連絡、社内で相談のページは、操作を含まない定型文の1〜2行', () => {
  const manual = fixture();
  for (const page of manual.symptom_pages.filter((p) => ['vendor', 'internal'].includes(p.badge.value))) {
    const lines = replyOf(manual, page).text.split('\n');
    assert.equal(lines[0], 'いま確認しています。', page.id);
    const contact = manual.contacts.find((c) => c.id === page.fallback?.contact);
    if (contact) assert.equal(lines[1], `${contact.name}に連絡しました。`, page.id);
    assert.ok(lines.length <= 2, page.id);
  }
});

const firstActionPage = (manual) => manual.symptom_pages.find((p) => replyOf(manual, p).text.includes('ください'));

test('① に部品でない操作があれば、途中が抜けた手順にせず定型文にする', () => {
  const manual = fixture();
  const page = firstActionPage(manual);
  const mixed = { ...page, first_steps: [...page.first_steps.slice(0, 1), page.steps[0] ?? page.first_steps[1]] };
  statementOf(manual, mixed.first_steps[1]).library = null;
  statementOf(manual, mixed.first_steps[1]).text = '機器の電源を入れ直してください。';
  assert.match(composeReply(mixed, manual, library).text, /^いま確認しています。/);
});

test('会社の情報の表を指す部品は、社員に渡さない', () => {
  const manual = fixture();
  const page = firstActionPage(manual);
  const tableParts = library.procedures.find((part) => part.needs_table && part.kinds.includes('first_steps'));
  const first = statementOf(manual, page.first_steps[0]);
  first.library = tableParts.id;
  first.text = tableParts.text;
  assert.match(composeReply(page, manual, library).text, /^いま確認しています。/);
});

test('検査：部品にない操作、言い換え、順番の違い、6行以上、定型の崩れ、消えた文を見つける', () => {
  const broken = (change) => {
    const manual = fixture();
    change(manual, firstActionPage(manual));
    return replyProblems(manual).join('\n');
  };
  assert.match(broken((m, p) => { replyOf(m, p).text = '電源を入れ直してください。'; }), /手順部品の文面/);
  assert.match(broken((m, p) => { replyOf(m, p).text = `${replyOf(m, p).text}\n再起動してください。`; }), /手順部品の文面/);
  assert.match(broken((m, p) => { replyOf(m, p).text = replyOf(m, p).text.split('\n').reverse().join('\n'); }), /手順部品の文面/);
  assert.match(broken((m, p) => { replyOf(m, p).text = Array(6).fill('確認してください。').join('\n'); }), /5 行以内/);
  assert.match(broken((m, p) => { replyOf(m, p).text = 'いま確認しています。'; }), /① の部品を返せる/);
  const vendor = (change) => {
    const manual = fixture();
    change(manual, manual.symptom_pages.find((p) => p.badge.value === 'vendor'));
    return replyProblems(manual).join('\n');
  };
  assert.match(vendor((m, p) => { replyOf(m, p).text = 'いま確認しています。\n再起動してください。'; }), /定型文だけ/);
  assert.match(vendor((m, p) => { replyOf(m, p).text = 'いま確認しています。\nほかの業者に連絡しました。'; }), /定型文だけ/);
  assert.match(vendor((m, p) => { replyOf(m, p).text = 'いま確認しています。\n03-0000-0101 に電話しました。'; }), /定型文だけ/);
  assert.match(vendor((_m, p) => { delete p.reply_to_staff; }), /社員に返す文がありません/);
});

test('何度組んでも同じ結果で、外すと元の形に戻る。文章を増やし続けない', () => {
  const manual = fixture();
  assert.deepEqual(withReplies(manual), manual);
  const base = withoutReplies(manual);
  assert.ok(base.symptom_pages.every((page) => !('reply_to_staff' in page)));
  assert.ok(base.statements.every((statement) => !statement.usage));
  assert.deepEqual(withReplies(base), manual);
});

test('Writer の出力の形に入らない。Editor への直しの依頼にも入らない', () => {
  const schema = pageSchema();
  assert.ok(!('reply_to_staff' in schema.properties.page.properties));
  assert.ok(!('usage' in schema.properties.statements.items.properties));
  const manual = fixture();
  const reply = manual.statements.find((statement) => statement.usage);
  reply.text = `${'長'.repeat(80)}。`;
  assert.ok(!plainProblems(manual).long_sentences.some((row) => row.id === reply.id));
});

test('Verifier には usage を付けて渡す。プロンプトに定型文の扱いがある', () => {
  const manual = fixture();
  const replies = manual.statements.filter((statement) => statement.usage === 'reply_to_staff');
  assert.equal(replies.length, manual.symptom_pages.length);
  const prompt = readFileSync(join(ROOT, 'plugin/agents/verifier.md'), 'utf8');
  assert.match(prompt, /`usage` が `reply_to_staff`/);
  assert.match(prompt, /事実の主張として扱わず/);
});

test('PC 用：① の直下に枠とコピーのボタンがあり、ボタンは JavaScript があるときだけ', () => {
  const manual = fixture();
  const html = renderManual(manual);
  const page = manual.symptom_pages.find((p) => p.first_steps.length);
  const start = html.indexOf(`<article id="symptom-${page.id}"`);
  const body = html.slice(start, html.indexOf('</article>', start));
  const first = body.indexOf('まずこれだけ');
  const reply = body.indexOf('社員に返す文');
  assert.ok(first > 0 && first < reply);
  for (const later of ['それでも直らなければ', 'それでもだめなら']) if (body.includes(later)) assert.ok(reply < body.indexOf(later), later);
  assert.match(body, new RegExp(`<blockquote class="say reply" id="reply-${page.id}">`));
  assert.match(body, new RegExp(`<button[^>]*class="[^"]*js-only[^"]*"[^>]*data-copy="reply-${page.id}"[^>]*>文面をコピー`));
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.match(css, /\.say\s*\{[^}]*user-select:\s*all/);
  assert.match(css, /\.reply\s*\{\s*white-space:\s*pre-line/);
  for (const each of manual.symptom_pages) assert.ok(html.includes(`id="reply-${each.id}"`), each.id);
});

test('社員に返す文がない入力や、決まりに合わない入力からは作らない', () => {
  const missing = fixture();
  delete missing.symptom_pages[0].reply_to_staff;
  missing.statements = missing.statements.filter((statement) => statement.id !== fixture().symptom_pages[0].reply_to_staff);
  assert.throws(() => renderManual(missing), /社員に返す文/);
});
