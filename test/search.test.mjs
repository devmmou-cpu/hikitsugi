// 普段の言葉で探す照合のテスト。AI も通信も使わない。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildQueriesRequest, pickQueries, scoreSearch } from '../eval/search-eval.mjs';
import { pagesForPhrases, phraseProblems, withSearchIndex } from '../plugin/lib/search-index.mjs';
import { buildSearch, charPairs, normalizeText, searchPages } from '../plugin/lib/search.mjs';
import { validate } from '../plugin/lib/validate.mjs';
import { renderManual } from '../plugin/renderer/render.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = () => JSON.parse(readFileSync(join(ROOT, 'test/fixtures/manual-full.json'), 'utf8'));
const INDEX = [
  { page: 'T1', title: '共有フォルダが見えない', phrases: ['ファイルの置き場が出てこない', 'みんなのフォルダが消えた', 'Zドライブがない', 'ネットワークパスが見つかりません'] },
  { page: 'T2', title: '工場の無線が切れる', phrases: ['わいふぁいがきれる', 'ネットが時々止まる', '電波が入らない'] },
  { page: 'T3', title: '複合機が故障した', phrases: ['コピー機が動かない', '紙が詰まった', 'トナーがない'] },
];

test('ひらがなとカタカナ、全角と半角、大文字と小文字、空白と記号をそろえる', () => {
  assert.equal(normalizeText('ファイル'), normalizeText('ふぁいる'));
  assert.equal(normalizeText('ＷｉーＦｉ'), normalizeText('wi fi'));
  assert.equal(normalizeText('サーバー'), normalizeText('さーば'));
  assert.equal(normalizeText('共有 フォルダ、！'), normalizeText('共有ﾌｫﾙﾀﾞ'));
  assert.deepEqual(charPairs('あいう'), ['あい', 'いう']);
  assert.deepEqual(charPairs('あ'), ['あ']);
  assert.deepEqual(charPairs(''), []);
});

test('言葉の並びが近い症状を、近い順に返す', () => {
  const search = buildSearch(INDEX);
  assert.equal(searchPages(search, 'フォルダが消えた')[0].page, 'T1');
  assert.equal(searchPages(search, 'ふぉるだ でてこない')[0].page, 'T1');
  assert.equal(searchPages(search, 'ワイファイ切れる')[0].page, 'T2');
  assert.equal(searchPages(search, 'コピーが動かないです')[0].page, 'T3');
  assert.equal(searchPages(search, 'ネットワークパスが見つかりません。')[0].page, 'T1');
});

test('どれにも近くなければ、候補を返さない。空の入力も同じ', () => {
  const search = buildSearch(INDEX);
  assert.deepEqual(searchPages(search, 'お昼ごはんを食べる'), []);
  assert.deepEqual(searchPages(search, ''), []);
  assert.deepEqual(searchPages(search, '  、。 '), []);
});

test('同じ入力からは毎回同じ結果になり、上限の件数までを返す', () => {
  const search = buildSearch(INDEX);
  assert.deepEqual(searchPages(search, 'ネットが止まる'), searchPages(search, 'ネットが止まる'));
  assert.ok(searchPages(search, 'ネット', 1).length <= 1);
});

test('照合の処理は、import も通信も使わず、HTML に埋め込める', () => {
  const source = readFileSync(join(ROOT, 'plugin/lib/search.mjs'), 'utf8');
  assert.doesNotMatch(source, /^import /m);
  assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|WebSocket|sendBeacon/);
});

test('採点：1番と3番以内の割合を数える', () => {
  const result = scoreSearch(INDEX, [
    { page: 'T1', text: 'フォルダが消えた' },
    { page: 'T2', text: 'コピー機が動かない' },
  ]);
  assert.equal(result.total, 2);
  assert.equal(result.top1, 50);
  assert.equal(result.misses.length, 1);
});

test('長い話し言葉でも、言い方が含まれていれば探せる', () => {
  const search = buildSearch(INDEX);
  assert.equal(searchPages(search, 'さっきからコピー機が動かないんですけど、どこに言えばいいですか')[0].page, 'T3');
  assert.equal(searchPages(search, '朝からみんなのフォルダが消えたって言われて困っています')[0].page, 'T1');
});

test('件数をそろえるときは、すべてのページを残し、存在しないページの入力は数えない', () => {
  const query = (page, n) => ({ page, text: `${page}-${n}` });
  const { picked, unknown } = pickQueries([query('T1', 1), query('T1', 2), query('T1', 3), query('T2', 1), query('T9', 1)], ['T1', 'T2'], 3);
  assert.equal(picked.length, 3);
  assert.ok(picked.some((item) => item.page === 'T2'));
  assert.equal(unknown, 1);
});

test('確かめる入力を作る模擬の後任には、題名だけを渡し、索引を渡さない', () => {
  const request = buildQueriesRequest([{ id: 'T1', title: '題名', phrases: ['見せてはいけない言い方'] }], 30);
  const body = JSON.stringify(request.messages);
  assert.ok(body.includes('題名'));
  assert.ok(!body.includes('見せてはいけない言い方'));
  assert.equal(request.model, 'claude-haiku-5-5');
  const writer = readFileSync(join(ROOT, 'plugin/agents/phrase-writer.md'), 'utf8');
  const queries = readFileSync(join(ROOT, 'eval/agents/mock-successor-queries.md'), 'utf8');
  assert.notEqual(writer, queries);
});

test('言い方の検査：件数、名前、認証情報、電話番号、ページの過不足を見つける', () => {
  const manual = fixture();
  const good = { pages: manual.symptom_pages.map((page) => ({ id: page.id, phrases: Array.from({ length: 15 }, (_, i) => `${page.id} 言い方 ${i}`) })) };
  assert.deepEqual(phraseProblems(good, manual, '田中'), []);
  const copy = () => JSON.parse(JSON.stringify(good));
  const few = copy(); few.pages[0].phrases = few.pages[0].phrases.slice(0, 5);
  assert.match(phraseProblems(few, manual).join(), /15〜30 件/);
  const many = copy(); many.pages[0].phrases = Array.from({ length: 31 }, (_, i) => `言い方 ${i}`);
  assert.match(phraseProblems(many, manual).join(), /15〜30 件/);
  const name = copy(); name.pages[0].phrases[0] = '田中さんに聞きたい';
  assert.match(phraseProblems(name, manual, '田中').join(), /退職する担当者/);
  const secret = copy(); secret.pages[0].phrases[0] = 'パスワードは abcd1234';
  assert.match(phraseProblems(secret, manual).join(), /認証情報/);
  const phone = copy(); phone.pages[0].phrases[0] = '03-0000-0101 にかける';
  assert.match(phraseProblems(phone, manual).join(), /電話番号/);
  const lost = copy(); lost.pages.shift();
  assert.match(phraseProblems(lost, manual).join(), /言い方がありません/);
  const extra = copy(); extra.pages.push({ id: 'T99', phrases: [] });
  assert.match(phraseProblems(extra, manual).join(), /存在しないページ/);
});

test('索引は HTML に入り、画面の文字にはならず、タグとして解釈されない', () => {
  const manual = fixture();
  const output = { pages: manual.symptom_pages.map((page) => ({ id: page.id, phrases: ['<b>太字</b>の言い方', '同じ言い方', '同じ言い方'] })) };
  const indexed = withSearchIndex(manual, output);
  assert.deepEqual(validate(JSON.parse(readFileSync(join(ROOT, 'plugin/schemas/manual.schema.json'), 'utf8')), indexed), []);
  assert.equal(indexed.search_index[0].phrases.length, 2);
  const html = renderManual(indexed);
  const script = html.match(/<script type="application\/json" id="search-index">([\s\S]*?)<\/script>/)[1];
  assert.ok(!script.includes('<b>'));
  assert.equal(JSON.parse(script)[0].phrases[0], '<b>太字</b>の言い方');
  assert.equal(JSON.parse(script)[0].page, manual.symptom_pages[0].id);
  assert.ok(!html.replace(/<script\b[\s\S]*?<\/script>/g, '').includes('同じ言い方'));
  // 索引がない取扱説明書では、何も足さない
  assert.ok(!renderManual(manual).includes('search-index'));
});

test('アイコンの形は1か所にあり、使うアイコンはすべて定義されている', () => {
  const html = renderManual(fixture());
  const used = new Set([...html.matchAll(/<use (?:class="[^"]*" )?href="#(i-[a-z-]+)"/g)].map((match) => match[1]));
  assert.ok(used.size > 3);
  for (const id of used) assert.equal((html.match(new RegExp(`<symbol id="${id}"`, 'g')) ?? []).length, 1, id);
});

test('モデルに渡す症状の一覧には、題名とすることと最初の操作だけが入る', () => {
  const pages = pagesForPhrases(fixture());
  assert.deepEqual(Object.keys(pages[0]).sort(), ['first_steps', 'id', 'title', 'what_to_do']);
});
