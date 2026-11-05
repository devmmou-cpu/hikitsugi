// 本人が部品の文面を直したあとの render を確かめる。通しをやり直さなくても、次の render で新しい文面になること。

import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { prepareForRender } from '../plugin/lib/handover.mjs';
import { composeStatements, loadLibrary } from '../plugin/lib/procedures.mjs';
import { withReplies } from '../plugin/lib/reply.mjs';
import { run } from '../plugin/scripts/hikitsugi.mjs';
import { PHONE_DIR } from '../plugin/renderer/phone.mjs';

const OLD_RESUME = '「同期の再開」を押してください。';
const library = loadLibrary();
const textOf = (id) => library.procedures.find((part) => part.id === id).text;
const NEW_RESUME = textOf('LIB-029');
const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/manual-full.json', import.meta.url), 'utf8'));
const plain = (html) => html.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"');
// 新しい文面の中にも古い文面の言葉があるので、前に「押して、」がないものを古い文面と数える
const STANDS_ALONE = /(?<!押して、)「同期の再開」を押してください。/;

/** LIB-029 が古い文面のまま保存された説明書。① が OneDrive の2部品の「自分で直せる」ページを持つ（キノドテン建設の同期のページと同じ形）。 */
function savedWithOldText() {
  const manual = fixture();
  const page = manual.symptom_pages.find((candidate) => candidate.id === 'T3');
  const old = library.procedures.map((part) => (part.id === 'LIB-029' ? { ...part, text: OLD_RESUME } : part));
  const replaced = new Set([...page.first_steps, page.first_goal, ...page.steps, page.goal, ...page.branches, ...page.exceptions]);
  manual.statements = manual.statements.filter((statement) => !replaced.has(statement.id));
  manual.statements.push(
    { id: 'STM-901', text: textOf('LIB-028'), evidence: ['LIB-028'], library: 'LIB-028' },
    { id: 'STM-902', text: OLD_RESUME, evidence: ['LIB-029'], library: 'LIB-029' },
  );
  Object.assign(page, { first_steps: ['STM-901', 'STM-902'], first_goal: null, steps: [], goal: null, branches: [], exceptions: [] });
  return withReplies(manual, { ...library, procedures: old });
}

const replyLines = (manual) => {
  const page = manual.symptom_pages.find((candidate) => candidate.id === 'T3');
  return manual.statements.find((statement) => statement.id === page.reply_to_staff).text.split('\n');
};

test('承認した LIB-029 の文面', () => {
  assert.equal(NEW_RESUME, '右上の歯車を押して、「同期の再開」を押してください。');
  assert.equal(library.procedures.find((part) => part.id === 'LIB-029').status, 'approved');
});

test('新しい通しでは、Writer が部品を指定するだけで新しい文面になる', () => {
  const { statements } = composeStatements([{ id: 'STM-001', text: '', evidence: [], library: 'LIB-029' }], library);
  assert.equal(statements[0].text, NEW_RESUME);
});

test('保存した説明書の ① と社員に返す文が、次の render で新しい文面になる', () => {
  const saved = savedWithOldText();
  assert.deepEqual(replyLines(saved).slice(0, 3), ['次を試してみてください。', textOf('LIB-028'), OLD_RESUME]);

  const work = mkdtempSync(join(tmpdir(), 'hikitsugi-part-'));
  try {
    writeFileSync(join(work, 'state.json'), JSON.stringify({ company: 'テスト', passed: true }));
    writeFileSync(join(work, 'manual-final.json'), JSON.stringify(saved));
    const output = run('render', [], { work });
    assert.match(output, /いまの文面で作りました：LIB-029/);

    const article = readFileSync(join(work, 'manual.html'), 'utf8').match(/<article[^>]*id="symptom-T3"[\s\S]*?<\/article>/)[0];
    const first = plain(article.match(/<section class="first">[\s\S]*?<\/section>/)[0]);
    assert.ok(first.includes(NEW_RESUME), 'PC 用の ①');
    assert.ok(plain(article.match(/<blockquote class="say reply"[\s\S]*?<\/blockquote>/)[0]).includes(NEW_RESUME), 'PC 用の社員に返す文');
    assert.doesNotMatch(plain(article), STANDS_ALONE);

    const name = readdirSync(join(work, PHONE_DIR)).find((file) => file.includes('共有フォルダ'));
    const phone = plain(readFileSync(join(work, PHONE_DIR, name), 'utf8').replace(/<style[\s\S]*?<\/style>/, ''));
    assert.ok(phone.split(NEW_RESUME).length - 1 >= 2, '束の ① と社員に返す文');
    assert.doesNotMatch(phone, STANDS_ALONE);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('文面を直したあとの社員に返す文は、部品を順番どおりに写した形のまま', () => {
  const { manual, updatedParts } = prepareForRender(savedWithOldText());
  assert.deepEqual(updatedParts, ['LIB-029']);
  assert.deepEqual(replyLines(manual).slice(0, 3), ['次を試してみてください。', textOf('LIB-028'), NEW_RESUME]);
});

test('部品の文面が同じなら、何も変えない', () => {
  const manual = fixture();
  const prepared = prepareForRender(manual);
  assert.equal(prepared.manual, manual);
  assert.deepEqual(prepared.updatedParts, []);
  assert.equal(prepared.rebuiltCount, 0);
});

test('古い型の業者に伝える文を保存した説明書も、次の render でいまの型になる', () => {
  const saved = fixture();
  const page = saved.symptom_pages.find((candidate) => candidate.fallback && candidate.badge.value !== 'vendor');
  const old = saved.statements.find((statement) => statement.id === page.fallback.message);
  old.text = old.text.replace('確認をお願いします。', '機器の場所：事務所のサーバーラック\n確認をお願いします。');
  const { manual, updatedParts, rebuiltCount } = prepareForRender(saved);
  assert.deepEqual(updatedParts, []);
  assert.equal(rebuiltCount, 1);
  const message = manual.symptom_pages.find((candidate) => candidate.id === page.id).fallback.message;
  assert.ok(!manual.statements.find((statement) => statement.id === message).text.includes('機器の場所'));
});
