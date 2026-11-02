// 表示プログラムの入力に使う T1 の見本が、取扱説明書の決まりを守っていることを確かめる。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '../plugin/lib/validate.mjs';
import { loadInput } from '../eval/lib/load-set.mjs';
import * as manual from '../eval/lib/scorers/manual.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(readFileSync(join(ROOT, 'test/fixtures/manual-t1.json'), 'utf8'));
const schema = JSON.parse(readFileSync(join(ROOT, 'plugin/schemas/manual.schema.json'), 'utf8'));
const input = loadInput(join(ROOT, 'eval/sets/okojo'));

test('T1 の見本は形式に合っている', () => {
  assert.deepEqual(validate(schema, fixture), []);
});

test('T1 の見本は採点の全項目に合格する', () => {
  const summary = manual.summarize(manual.score(fixture, null, input));
  assert.deepEqual(summary.bad_evidence, []);
  assert.equal(summary.long_sentences, 0);
  assert.deepEqual(summary.unexplained_terms, []);
  assert.deepEqual(summary.credentials, []);
});

test('T1 の接続先は調査データと一致する', () => {
  const step = fixture.statements.find((s) => s.text.includes('OKOJO-NAS'));
  const inv = input.survey.items.find((i) => i.id === step.evidence[0]);
  assert.equal(inv.value, '\\\\OKOJO-NAS\\図面');
  assert.ok(step.text.includes(inv.value));
});

test('T1 の連絡先は聞き取りと一致する', () => {
  const contact = fixture.contacts[0];
  const answer = input.transcript.entries.find((e) => e.id === 'INT-002').answer;
  assert.ok(answer.includes(contact.name));
  assert.ok(answer.includes(contact.phone));
});
