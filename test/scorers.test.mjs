// 採点器のテスト。答えが分かっている出力を通して、数字が期待どおりになることを確かめる。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAnswers, loadHidden, loadInput } from '../eval/lib/load-set.mjs';
import * as verifier from '../eval/lib/scorers/verifier.mjs';
import * as gaps from '../eval/lib/scorers/gaps.mjs';
import * as interview from '../eval/lib/scorers/interview.mjs';
import * as manual from '../eval/lib/scorers/manual.mjs';
import * as troubles from '../eval/lib/scorers/troubles.mjs';
import { isActionText, nonActionSteps } from '../plugin/lib/page-check.mjs';

const SET = join(dirname(fileURLToPath(import.meta.url)), '../eval/sets/okojo');
const input = loadInput(SET);
const answers = loadAnswers(SET);
const hidden = loadHidden(SET);

const verdicts = (fn) => ({
  results: answers.verifier.statements.map((s) => ({
    statement: s.id,
    verdict: fn(s),
    reason: '',
    checked: [],
    conflicts_with: [],
  })),
});

// ---- Verifier ----
test('Verifier：正解どおりなら検出率 100%、誤検出率 0%', () => {
  const rows = verifier.score(verdicts((s) => s.expected), answers.verifier);
  const summary = verifier.summarize(rows);
  assert.equal(summary.detection_rate, 100);
  assert.equal(summary.false_positive_rate, 0);
  assert.equal(summary.type_matched, 10);
});

test('Verifier：1件見逃すと 9/10 になり、どの誤りかが分かる', () => {
  const output = verdicts((s) => (s.error === 'E7' ? 'correct' : s.expected));
  const summary = verifier.summarize(verifier.score(output, answers.verifier));
  assert.equal(summary.detected, 9);
  assert.equal(summary.detection_rate, 90);
  assert.deepEqual(summary.missed_errors, ['E7']);
});

test('Verifier：判定の種類が違っても検出には数え、種類の一致は別に数える', () => {
  const output = verdicts((s) => (s.error === 'E1' ? 'unsupported' : s.expected));
  const summary = verifier.summarize(verifier.score(output, answers.verifier));
  assert.equal(summary.detected, 10);
  assert.equal(summary.type_matched, 9);
});

test('Verifier：正しい記述を2件疑うと誤検出率 10%', () => {
  const targets = answers.verifier.statements.filter((s) => s.kind === 'correct').slice(0, 2).map((s) => s.id);
  const output = verdicts((s) => (targets.includes(s.id) ? 'contradiction' : s.expected));
  const summary = verifier.summarize(verifier.score(output, answers.verifier));
  assert.equal(summary.false_positives, 2);
  assert.equal(summary.false_positive_rate, 10);
  assert.deepEqual(summary.false_positive_statements, targets);
});

test('Verifier：回答なしは「正しい」と数えず、未完了として報告する', () => {
  const output = verdicts((s) => s.expected);
  const seeded = answers.verifier.statements.find((s) => s.error === 'E1').id;
  const correct = answers.verifier.statements.find((s) => s.kind === 'correct').id;
  output.results = output.results.filter((r) => r.statement !== seeded && r.statement !== correct);
  const summary = verifier.summarize(verifier.score(output, answers.verifier));
  assert.equal(summary.complete, false);
  assert.equal(summary.unanswered, 2);
  assert.deepEqual(summary.missed_errors, ['E1']);
  assert.equal(summary.correct_answered, 19);
  assert.equal(summary.false_positives, 0);
});

test('Verifier：何も答えないと誤検出率は 0 ではなく計算不能になる', () => {
  const summary = verifier.summarize(verifier.score({ results: [] }, answers.verifier));
  assert.equal(summary.detection_rate, 0);
  assert.equal(summary.false_positive_rate, null);
});

test('Verifier：存在しない記述や重複は例外にして errors に回す', () => {
  const unknown = verdicts((s) => s.expected);
  unknown.results[0].statement = 'S-99';
  assert.throws(() => verifier.score(unknown, answers.verifier), /評価セットにない記述/);
  const dup = verdicts((s) => s.expected);
  dup.results.push(dup.results[0]);
  assert.throws(() => verifier.score(dup, answers.verifier), /2回判定/);
});

// ---- Gap Finder ----
const goldGaps = () => ({
  coverage: answers.gaps.items.map((i) => ({ item: i.item, state: i.state, evidence: i.evidence })),
  gaps: [{ id: 'GAP-001', items: answers.gaps.items.filter((i) => i.state !== 'filled').map((i) => i.item), why: '', priority: 'high', question_hint: '' }],
});

test('Gap Finder：正解どおりなら見落とし 0、過剰な指摘も 0', () => {
  const summary = gaps.summarize(gaps.score(goldGaps(), answers.gaps, input));
  assert.equal(summary.missed, 0);
  assert.equal(summary.over_flagged, 0);
  assert.equal(summary.false_filled, 0);
});

test('Gap Finder：空白のまとめ方は点数に影響しない', () => {
  const output = goldGaps();
  const items = output.gaps[0].items;
  output.gaps = items.map((item, i) => ({ id: `GAP-${String(i + 1).padStart(3, '0')}`, items: [item], why: '', priority: 'mid', question_hint: '' }));
  assert.equal(gaps.summarize(gaps.score(output, answers.gaps, input)).missed, 0);
});

test('Gap Finder：聞くべき項目を落とすと見落としになる', () => {
  const output = goldGaps();
  output.gaps[0].items = output.gaps[0].items.filter((i) => i !== 'CHK-16');
  const summary = gaps.summarize(gaps.score(output, answers.gaps, input));
  assert.deepEqual(summary.missed_items, ['CHK-16']);
});

test('Gap Finder：全部を空白と言うと、見落とし 0 でも過剰な指摘が残る', () => {
  const output = {
    coverage: answers.gaps.items.map((i) => ({ item: i.item, state: 'gap', evidence: [] })),
    gaps: [{ id: 'GAP-001', items: answers.gaps.items.map((i) => i.item), why: '', priority: 'high', question_hint: '' }],
  };
  const summary = gaps.summarize(gaps.score(output, answers.gaps, input));
  assert.equal(summary.missed, 0);
  assert.equal(summary.over_flagged, 1);
});

test('Gap Finder：取得できなかった調査データを根拠にすると検出する', () => {
  const denied = input.survey.items.find((i) => i.status === 'denied').id;
  const output = goldGaps();
  output.coverage[0].evidence = [denied];
  assert.equal(gaps.summarize(gaps.score(output, answers.gaps, input)).bad_evidence, 1);
});

// ---- Interviewer ----
const scoreInterview = (output) =>
  interview.summarize(interview.score(output, answers.gaps, { facts: hidden.facts }), output);

test('Interviewer：固定の聞き取り記録で 37/40、20問以内', () => {
  const summary = scoreInterview(input.transcript);
  assert.equal(summary.covered, 37);
  assert.equal(summary.coverage_rate, 92.5);
  assert.equal(summary.questions, 20);
  assert.equal(summary.within_question_limit, true);
  assert.deepEqual(summary.uncovered_items, ['CHK-19', 'CHK-20', 'CHK-38']);
});

test('Interviewer：回答に事実がないのに covers だけ申告しても数えない', () => {
  const output = structuredClone(input.transcript);
  for (const entry of output.entries) entry.answer = 'はい、大丈夫です。';
  const summary = scoreInterview(output);
  // 調査だけで埋まる CHK-30 の1件だけが残る
  assert.equal(summary.covered, 1);
  assert.ok(summary.claimed_without_fact.includes('CHK-16'));
});

test('Interviewer：「分からない」の回答は埋まったと数えない', () => {
  const output = structuredClone(input.transcript);
  for (const entry of output.entries) entry.status = 'unknown';
  assert.equal(scoreInterview(output).covered, 1);
});

test('Interviewer：20問を超えると上限超えとして報告する', () => {
  const output = structuredClone(input.transcript);
  output.entries.push({ ...output.entries[0], id: 'INT-021', gap: 'GAP-021' });
  assert.equal(scoreInterview(output).within_question_limit, false);
});

// ---- 取扱説明書 ----
const baseManual = (statements, glossary = []) => ({
  schema_version: 1,
  company: 'okojo',
  statements,
  symptom_pages: [],
  contacts: [],
  routines: [],
  devices: [],
  glossary,
});
const answeredInt = input.transcript.entries.find((e) => e.status === 'answered').id;
const unknownInt = input.transcript.entries.find((e) => e.status === 'unknown').id;
const okInv = input.survey.items.find((i) => i.status === 'ok').id;
const deniedInv = input.survey.items.find((i) => i.status === 'denied').id;
const scoreManual = (output) => manual.summarize(manual.score(output, null, input));

test('取扱説明書：問題のない記述は合格する', () => {
  const summary = scoreManual(baseManual([{ id: 'STM-001', text: '画面の右上を押します。', evidence: [okInv, answeredInt] }]));
  assert.deepEqual(summary.bad_evidence, []);
  assert.equal(summary.long_sentences, 0);
  assert.deepEqual(summary.unexplained_terms, []);
  assert.deepEqual(summary.credentials, []);
});

test('取扱説明書：回答のない聞き取りや取得できなかった調査は根拠にならない', () => {
  const summary = scoreManual(
    baseManual([
      { id: 'STM-001', text: 'あ。', evidence: [unknownInt] },
      { id: 'STM-002', text: 'い。', evidence: [deniedInv] },
      { id: 'STM-003', text: 'う。', evidence: ['INT-999'] },
    ]),
  );
  assert.deepEqual(summary.bad_evidence, ['STM-001', 'STM-002', 'STM-003']);
});

test('取扱説明書：1文が50字を超えると検出する（51字で失敗、50字で合格）', () => {
  const make = (n) => baseManual([{ id: 'STM-001', text: `${'あ'.repeat(n - 1)}。`, evidence: [okInv] }]);
  assert.equal(scoreManual(make(50)).long_sentences, 0);
  assert.equal(scoreManual(make(51)).long_sentences, 1);
});

test('取扱説明書：用語集にない専門用語を検出し、載せれば合格する', () => {
  const statements = [{ id: 'STM-001', text: 'NAS を確認します。', evidence: [okInv] }];
  assert.deepEqual(scoreManual(baseManual(statements)).unexplained_terms, ['NAS']);
  const glossary = [{ term: 'NAS', explanation: 'STM-001' }];
  assert.deepEqual(scoreManual(baseManual(statements, glossary)).unexplained_terms, []);
});

test('取扱説明書：英字の用語は単語の境界で判定する', () => {
  const statements = [{ id: 'STM-001', text: 'APPLE と書いてある箱です。', evidence: [okInv] }];
  assert.deepEqual(scoreManual(baseManual(statements)).unexplained_terms, []);
});

test('取扱説明書：パスワード本体を検出し、保管場所の文は通す', () => {
  const summary = scoreManual(
    baseManual([
      { id: 'STM-001', text: 'パスワードは abcd1234 です。', evidence: [okInv] },
      { id: 'STM-002', text: 'パスワードは書庫に保管しています。', evidence: [okInv] },
    ]),
  );
  assert.deepEqual(summary.credentials, ['STM-001']);
});

test('取扱説明書：存在しない記述を画面から参照すると例外にする', () => {
  const output = baseManual([{ id: 'STM-001', text: 'あ。', evidence: [okInv] }]);
  output.routines.push({ id: 'R1', frequency: 'weekly', title: 'STM-999', steps: [] });
  assert.throws(() => manual.score(output, null, input), /STM-999/);
});

// ---- 模擬の後任 ----
const { vendors } = JSON.parse(readFileSync(join(SET, 'case.json'), 'utf8'));
const vendorName = (id) => vendors.find((vendor) => vendor.id === id)?.name ?? null;
const goldTroubles = () => ({
  results: answers.troubles.troubles.map((t) => ({ trouble: t.id, action: t.action, contact: vendorName(t.contact) })),
});

test('模擬の後任：正解どおりなら 5/5', () => {
  assert.equal(troubles.summarize(troubles.score(goldTroubles(), answers.troubles, vendors)).passed, 5);
});

test('模擬の後任：連絡先を間違えると不合格', () => {
  const output = goldTroubles();
  output.results.find((r) => r.trouble === 'T4').contact = vendorName('VEN-02');
  assert.deepEqual(troubles.summarize(troubles.score(output, answers.troubles, vendors)).failed, ['T4']);
});

test('模擬の後任：直せないものを自力で解決したと答えると不合格', () => {
  const output = goldTroubles();
  output.results.find((r) => r.trouble === 'T4').action = 'self';
  assert.deepEqual(troubles.summarize(troubles.score(output, answers.troubles, vendors)).failed, ['T4']);
});

test('模擬の後任：回答なしは不合格で、未完了として報告する', () => {
  const summary = troubles.summarize(troubles.score({ results: [] }, answers.troubles, vendors));
  assert.equal(summary.passed, 0);
  assert.equal(summary.complete, false);
});

test('模擬の後任：不正な値は例外にする', () => {
  assert.throws(() => troubles.score({ results: [{ trouble: 'T9', action: 'self' }] }, answers.troubles, vendors), /トラブルの ID/);
  assert.throws(() => troubles.score({ results: [{ trouble: 'T1', action: 'maybe' }] }, answers.troubles, vendors), /行動の値/);
});

test('模擬の後任：「確かめてから依頼」は、行動と連絡先の両方が合って合格になる', () => {
  const output = (action, contact) => ({
    results: answers.troubles.troubles.map((t) => (t.id === 'T5' ? { trouble: 'T5', action, contact } : { trouble: t.id, action: t.action, contact: vendorName(t.contact) })),
  });
  const gold = answers.troubles.troubles.find((t) => t.id === 'T5');
  assert.equal(gold.action, 'check_first');
  const passed = (out) => troubles.summarize(troubles.score(out, answers.troubles, vendors)).passed;
  assert.equal(passed(output('check_first', vendorName(gold.contact))), 5);
  assert.equal(passed(output('check_first', vendorName('VEN-01'))), 4);
  assert.equal(passed(output('self', null)), 4);
  assert.equal(passed(output('contact', vendorName(gold.contact))), 4);
});

test('模擬の後任：連絡先は業者名で照合し、取扱説明書ごとの番号では照合しない', () => {
  const gold = answers.troubles.troubles.find((t) => t.action === 'contact');
  const output = goldTroubles();
  const entry = output.results.find((r) => r.trouble === gold.id);
  // 正解と同じ番号でも、業者名でなければ不合格
  entry.contact = gold.contact;
  assert.deepEqual(troubles.summarize(troubles.score(output, answers.troubles, vendors)).failed, [gold.id]);
  entry.contact = vendorName(gold.contact);
  assert.deepEqual(troubles.summarize(troubles.score(output, answers.troubles, vendors)).failed, []);
});

test('取扱説明書の採点：手順に置いた、やることではない文を数える', () => {
  const statements = [
    { id: 'STM-001', text: 'NAS に保守契約はありません。', evidence: ['INV-001'] },
    { id: 'STM-002', text: '電源を確かめてください。', evidence: ['INV-001'] },
    { id: 'STM-003', text: '部品の文面です。', evidence: ['LIB-001'], library: 'LIB-001' },
  ];
  const page = { id: 'T1', first_steps: [], steps: ['STM-001', 'STM-002', 'STM-003'] };
  assert.deepEqual(nonActionSteps({ statements, symptom_pages: [page] }), [{ page: 'T1', statement: 'STM-001' }]);
  assert.equal(isActionText('総務課に知らせてください。'), true);
  assert.equal(isActionText('勝手に再起動しないでください。'), false);
  assert.equal(isActionText('NAS は事務所にあります。'), false);
  assert.equal(isActionText('画面が消えます。そのあと電源を入れてください。'), false);
});

test('模擬の後任：社内で相談は有効な行動で、連絡先への連絡の正解とは一致しない', () => {
  const vendors = [{ id: 'VEN-01', name: '業者' }];
  const answers = { troubles: [{ id: 'T1', action: 'contact', contact: 'VEN-01' }] };
  const rows = troubles.score({ results: [{ trouble: 'T1', action: 'internal', contact: null }] }, answers, vendors);
  assert.equal(rows[0].status, 'answered');
  assert.equal(rows[0].passed, false);
});
