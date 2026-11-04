// 探す仕組みの切り分けの部品のテスト。AI も通信も使わない。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapQueries, scoreAccepting, withoutHintPhrases } from '../eval/search-compare.mjs';
import { overlayEdited, withoutPage } from '../eval/symptom-page-trial.mjs';

test('同じ話のページがない問題文は採点から外し、数を返す', () => {
  const queries = [{ page: 'T1', text: 'あ' }, { page: 'T2', text: 'い' }, { page: 'T3', text: 'う' }];
  const { rows, dropped } = mapQueries(queries, { T1: ['T5'], T2: [] });
  assert.deepEqual(rows, [{ text: 'あ', accept: ['T5'] }]);
  assert.equal(dropped, 2);
});

test('分かれたページは、どちらが出ても正解として最もよい順位を数える', () => {
  const index = [
    { page: 'T1', title: '共有フォルダが開けない', phrases: ['共有フォルダが開かない'] },
    { page: 'T6', title: '停電のあとの共有フォルダ', phrases: ['停電のあとフォルダが開かない'] },
  ];
  const score = scoreAccepting(index, [{ text: '停電のあとフォルダが開かない', accept: ['T1', 'T6'] }]);
  assert.equal(score.rows[0].rank, 1);
  assert.equal(score.top1, 100);
});

test('ヒント由来の言い方は、受け皿のページで題名にない語を含むものだけ外す', () => {
  const manual = {
    statements: [{ id: 'S1', text: 'ネットが全部つながらない' }, { id: 'S2', text: '業者に電話します' }, { id: 'S3', text: 'ランプを見ます' }, { id: 'S4', text: 'Wi-Fi が切れる' }, { id: 'S5', text: '再起動します' }],
    symptom_pages: [
      { id: 'T1', title: 'S1', badge: { statement: 'S2' }, first_steps: ['S3'] },
      { id: 'T2', title: 'S4', badge: { statement: 'S2' }, first_steps: ['S5'] },
    ],
    contacts: [{ name: 'クロテン通信' }],
    symptom_exclusions: [{ source: 'INT-001', detail: 'ルーターの故障も、クロテン通信の窓口に電話します', reason: 'T1 で扱う', pages: ['T1'] }],
  };
  const { pages, removed } = withoutHintPhrases([{ id: 'T1', phrases: ['ルーターが壊れた', 'るーたーがおかしい', 'ネットが見れない'] }, { id: 'T2', phrases: ['ルーターの近くで切れる'] }], manual);
  assert.deepEqual(pages[0].phrases, ['ネットが見れない']);
  assert.deepEqual(removed.map(({ phrase }) => phrase), ['ルーターが壊れた', 'るーたーがおかしい']);
  // 受け皿でないページの言い方は外さない
  assert.deepEqual(pages[1].phrases, ['ルーターの近くで切れる']);
});

test('試験の入力は、除いたページの文と判定だけを消す', () => {
  const manual = { search_index: [], review: {}, glossary: [{ company: 'S1' }, { company: 'S2' }], statements: [{ id: 'STM-001', text: 'あ' }, { id: 'STM-002', text: 'い' }], symptom_pages: [{ id: 'T1', title: 'STM-001' }, { id: 'T2', title: 'STM-002' }] };
  const { manual: left, verification, removed } = withoutPage(manual, { results: [{ statement: 'STM-001' }, { statement: 'STM-002' }] }, 'T2');
  assert.deepEqual(left.statements.map(({ id }) => id), ['STM-001']);
  assert.deepEqual(left.symptom_pages.map(({ id }) => id), ['T1']);
  assert.deepEqual(verification.results, [{ statement: 'STM-001' }]);
  assert.deepEqual([...removed], ['STM-002']);
  assert.equal(left.search_index, undefined);
});

test('同じ番号でも、除いたページの文は Editor のあとの文に置き換えない', () => {
  const page = (id, title) => ({ id, title });
  const writerBefore = { statements: [{ id: 'STM-001', text: 'あ' }, { id: 'STM-002', text: 'い' }], symptom_pages: [page('T1', 'STM-001'), page('T2', 'STM-002')] };
  const editedBefore = { statements: [{ id: 'STM-001', text: 'あ（直した）' }], symptom_pages: [page('T1', 'STM-001')] };
  const written = { statements: [{ id: 'STM-001', text: 'あ' }, { id: 'STM-002', text: 'い' }], symptom_pages: [page('T1', 'STM-001'), page('T2', 'STM-002')] };
  const result = overlayEdited(written, writerBefore, editedBefore, new Set(['STM-002']));
  assert.equal(result.statements[0].text, 'あ（直した）');
  assert.equal(result.statements[1].text, 'い');
});

test('印刷では「はじめに」を中央に寄せない', async () => {
  const { STYLES } = await import('../plugin/renderer/styles.mjs');
  const print = STYLES.slice(STYLES.indexOf('@media print'));
  const rule = print.match(/#intro \{[^}]*\}/)[0];
  assert.match(rule, /max-width: none/);
  assert.match(rule, /margin: 0/);
});

test('社員に返す文の見出しは文面に重ならない', async () => {
  const { STYLES } = await import('../plugin/renderer/styles.mjs');
  assert.match(STYLES, /\.reply-box \.say-label \{\s*margin-bottom: var\(--s1\);/);
});
