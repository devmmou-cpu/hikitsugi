// 安心帯の保証の言い切りの検査のテスト。AI も通信も使わない。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyEdits } from '../plugin/lib/apply-edits.mjs';
import { reassuranceProblems } from '../plugin/lib/page-check.mjs';

const page = { id: 'T1', reassurance: 'STM-001' };
const about = (text) => reassuranceProblems(page, [{ id: 'STM-001', text }]);

test('安心帯の保証の言い切りを止める', () => {
  for (const text of ['社長に相談すれば大丈夫です。', '安心してください。', '触っても問題ありません。', '心配いりません。']) {
    assert.equal(about(text).length, 1, text);
    assert.match(about(text)[0], /T1: reassurance/);
  }
});

test('裏づけのある事実と決まりは止めない', () => {
  for (const text of ['つなぎ直すだけなので、データは消えません。', '故障のときの連絡先はイタチ事務機と決まっています。', '回線の故障窓口は24時間受け付けています。']) {
    assert.deepEqual(about(text), [], text);
  }
});

test('安心帯以外の文は止めない', () => {
  assert.deepEqual(reassuranceProblems(page, [{ id: 'STM-001', text: 'データは消えません。' }, { id: 'STM-002', text: 'はい、大丈夫です。' }]), []);
});

test('Writer の指示に保証の言い切りの決まりがある', () => {
  const writer = readFileSync(new URL('../plugin/agents/writer.md', import.meta.url), 'utf8');
  assert.match(writer, /`reassurance`.*保証の言い切りは書きません/);
});

const manual = (text) => ({
  statements: [{ id: 'STM-001', text, evidence: ['INT-001'], library: null }, { id: 'STM-002', text: '別の文です。', evidence: ['INT-001'], library: null }],
  symptom_pages: [{ id: 'T1', reassurance: 'STM-001', info_rows: [], first_steps: [], steps: [], title: 'STM-002', badge: { statement: 'STM-002' }, notes: [], branches: [], exceptions: [], first_goal: null, goal: null }],
  contacts: [],
  routines: [],
  devices: [],
  glossary: [],
});

test('Editor の直しで安心帯に保証の言い切りが戻らない', () => {
  const { manual: result, changes } = applyEdits(manual('データは消えません。'), { rewrites: [{ id: 'STM-001', text: 'データは消えないので大丈夫です。' }], glossary: [] });
  assert.equal(result.statements[0].text, 'データは消えません。');
  assert.deepEqual(changes, [{ statement: 'STM-001', missing: ['保証の言い切り'] }]);
});

test('安心帯以外の文の Editor の直しは止めない', () => {
  const { manual: result } = applyEdits(manual('データは消えません。'), { rewrites: [{ id: 'STM-002', text: '別の文で大丈夫です。' }], glossary: [] });
  assert.equal(result.statements[1].text, '別の文で大丈夫です。');
});

test('文が変わらない更新で、主のエージェントが言う文が SKILL にある', () => {
  const skill = readFileSync(new URL('../plugin/skills/start/SKILL.md', import.meta.url), 'utf8');
  assert.ok(skill.includes('「文は変わらないので、番号を置き換えて確認します」'));
});

const withText = (text) => ({ ...manual(text), statements: [{ id: 'STM-001', text, evidence: ['INT-001'], library: null }, { id: 'STM-002', text: 'ページの題名です。', evidence: ['INT-001'], library: null }], symptom_pages: [{ ...manual(text).symptom_pages[0], reassurance: 'STM-002' }] });

test('Editor が機器名を落とした文は元に戻す（語がなくなるとき）', () => {
  const { manual: result, changes } = applyEdits(withText('複合機が止まったらサーバーを確かめます。'), { rewrites: [{ id: 'STM-001', text: 'それが止まったらサーバーを確かめます。' }], glossary: [] });
  assert.equal(result.statements[0].text, '複合機が止まったらサーバーを確かめます。');
  assert.deepEqual(changes, [{ statement: 'STM-001', missing: ['複合機'] }]);
});

test('Editor が機器名を落とした文は元に戻す（同じ語の回数が減るとき）', () => {
  const before = 'NAS とサーバーが止まっているときだけ、NAS、サーバーの順に押します。';
  const { manual: result, changes } = applyEdits(withText(before), { rewrites: [{ id: 'STM-001', text: 'サーバーが止まっているときだけ、NAS、サーバーの順に押します。' }], glossary: [] });
  assert.equal(result.statements[0].text, before);
  assert.deepEqual(changes[0].missing, ['NAS']);
});

test('調査と聞き取りにある機器の名前も守り、機器名が残る直しは通す', () => {
  const sources = { survey: { items: [{ host: 'OKJ-CAD-01', key: 'printer.1', value: 'MODEL-A1 事務室' }] }, transcript: { entries: [{ answer: 'OKOJO-NAS に保存します。' }] } };
  const printer = applyEdits(withText('MODEL-A1 事務室で印刷します。'), { rewrites: [{ id: 'STM-001', text: '事務室で印刷します。' }], glossary: [] }, { sources });
  assert.equal(printer.manual.statements[0].text, 'MODEL-A1 事務室で印刷します。');
  const kept = applyEdits(withText('サーバーの電源を確かめてください。'), { rewrites: [{ id: 'STM-001', text: 'サーバーの電源が入っているかを確かめてください。' }], glossary: [] }, { sources });
  assert.equal(kept.manual.statements[0].text, 'サーバーの電源が入っているかを確かめてください。');
  assert.deepEqual(kept.changes, []);
});
