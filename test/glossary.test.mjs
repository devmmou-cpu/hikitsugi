// 用語の説明（一言で／たとえ／この会社では／困ったときは）と、機器の一覧の語の載せ漏れのテスト。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyEdits } from '../plugin/lib/apply-edits.mjs';
import { deviceTermProblems, plainProblems, plainTextProblem } from '../plugin/lib/plain-check.mjs';
import { validate } from '../plugin/lib/validate.mjs';
import { renderManual } from '../plugin/renderer/render.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = () => JSON.parse(readFileSync(join(ROOT, 'test/fixtures/manual-full.json'), 'utf8'));
const schema = JSON.parse(readFileSync(join(ROOT, 'plugin/schemas/manual.schema.json'), 'utf8'));
const edit = (fields = {}) => ({ term: '新しい語', one_line: '何かをする機器です。', analogy: '棚のようなものです。', company: '事務所にあります。', evidence: ['INT-001'], help_page: '', ...fields });
const added = (manual, fields, options) => applyEdits(manual, { rewrites: [], glossary: [edit(fields)] }, options).manual.glossary.find((entry) => entry.term === '新しい語');

test('Editor の説明は4段の形になり、この会社では、だけが根拠つきの文章になる', () => {
  const manual = fixture();
  const page = manual.symptom_pages[0].id;
  const result = applyEdits(manual, { rewrites: [], glossary: [edit({ help_page: page })] }).manual;
  const entry = result.glossary.at(-1);
  assert.deepEqual(Object.keys(entry).sort(), ['analogy', 'company', 'help_page', 'one_line', 'term']);
  assert.equal(entry.help_page, page);
  const statement = result.statements.find((item) => item.id === entry.company);
  assert.equal(statement.text, '事務所にあります。');
  assert.deepEqual(statement.evidence, ['INT-001']);
  assert.deepEqual(validate(schema, result), []);
});

test('困ったときのページは、なければ付けず、存在しないページも付けない', () => {
  assert.equal(added(fixture(), {}).help_page, undefined);
  assert.equal(added(fixture(), { help_page: 'T99' }).help_page, undefined);
});

test('一言とたとえは根拠を照合しないので、書いてはいけないものを止める', () => {
  const long = 'あ'.repeat(51) + '。';
  assert.equal(added(fixture(), { one_line: long }), undefined);
  assert.equal(added(fixture(), { analogy: long }), undefined);
  assert.equal(added(fixture(), { one_line: '03-0000-0101 に聞く機器です。' }), undefined);
  assert.equal(added(fixture(), { analogy: 'okojo-seiko.example のようなものです。' }), undefined);
  assert.equal(added(fixture(), { one_line: 'パスワードは abcd1234 です。' }), undefined);
  assert.equal(added(fixture(), { analogy: '田中さんのようなものです。' }, { retiree: '田中' }), undefined);
  assert.equal(added(fixture(), { company: '田中さんが管理しています。' }, { retiree: '田中' }), undefined);
  assert.equal(plainTextProblem('棚のようなものです。'), null);
});

test('画面には4段の順で出て、困ったときはページへのリンクになる', () => {
  const manual = fixture();
  const entry = manual.glossary.find((item) => item.help_page);
  const html = renderManual(manual);
  const company = html.slice(html.indexOf('id="tab-company"'));
  const block = company.match(new RegExp(`<details class="term"[^>]*>(?:(?!</details>)[\\s\\S])*?${entry.term}とは？[\\s\\S]*?</details>`))[0];
  const labels = [...block.matchAll(/<dt>([^<]*)<\/dt>/g)].map((match) => match[1]);
  assert.deepEqual(labels, ['一言で', 'たとえ', 'この会社では', '困ったときは']);
  assert.ok(block.includes(`href="#symptom-${entry.help_page}"`));
  const plain = block.replace(/<[^>]+>/g, '');
  assert.ok(plain.includes(entry.one_line) && plain.includes(entry.analogy));
  // リンク先がない語は3段
  const other = manual.glossary.find((item) => !item.help_page);
  const otherBlock = company.match(new RegExp(`<details class="term"[^>]*><summary class="tap"><span>(?:<[^>]+>)*${other.term}(?:<[^>]+>)*とは？[\\s\\S]*?</details>`))[0];
  assert.ok(!otherBlock.includes('困ったときは'));
});

test('一言とたとえに認証情報らしい値があれば、画面を作らない', () => {
  const manual = fixture();
  manual.glossary[0].analogy = 'パスワードは abcd1234 です。';
  assert.throws(() => renderManual(manual), /認証情報/);
});

const withDevice = (name, purpose, glossary = []) => ({
  statements: [{ id: 'STM-001', text: name }, { id: 'STM-002', text: purpose }],
  devices: [{ name: 'STM-001', purpose: 'STM-002' }],
  glossary,
});

test('機器の一覧の英字の語、カタカナの語に説明がなければ、説明のない語として返す', () => {
  assert.deepEqual(deviceTermProblems(withDevice('ゲートウェイ（事務所）', 'VPN の出口です。')).sort(), ['VPN', 'ゲートウェイ'].sort());
  assert.deepEqual(deviceTermProblems(withDevice('複合機', 'PC からファイルを印刷します。')), []);
  assert.ok(plainProblems(withDevice('スイッチング機器', '分ける機器です。')).unexplained_terms.includes('スイッチング'));
});

test('機器の名前や型番、日常の語、用語に含まれる語は、説明を求めない', () => {
  assert.deepEqual(deviceTermProblems(withDevice('設計用 MODEL-A1（OKJ-CAD-01）', 'OKOJO-OFFICE のファイルをコピーします。')), []);
  assert.deepEqual(deviceTermProblems(withDevice('VPN ルーター', '拠点をつなぎます。', [{ term: 'VPN ルーター' }])), []);
  assert.deepEqual(deviceTermProblems(withDevice('Wi-Fi', '')), []);
});

test('英字の語は単語の境界で見る（AP は APP の説明では済まない）', () => {
  assert.deepEqual(deviceTermProblems(withDevice('AP', '', [{ term: 'APP' }])), ['AP']);
});

test('見本の機器の一覧に、説明のない語がない', () => {
  assert.deepEqual(deviceTermProblems(fixture()), []);
});
