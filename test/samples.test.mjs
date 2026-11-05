// README からリンクするサンプル。架空の形式の番号とドメインだけで、表示の検査に通ること。

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { manualHtmlProblems } from '../scripts/hooks/check-manual-html.mjs';
import { PHONE_DIR } from '../plugin/renderer/phone.mjs';

const root = new URL('../samples/okojo/', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');

test('PC 用と束のサンプルは HTML の検査に通る', () => {
  assert.deepEqual(manualHtmlProblems(read('manual.html')), []);
  for (const name of readdirSync(new URL(`${PHONE_DIR}/`, root))) assert.deepEqual(manualHtmlProblems(read(`${PHONE_DIR}/${name}`)), [], name);
});

test('更新用のデータは架空の形式の番号とドメインだけ', () => {
  const data = read('manual.json');
  for (const phone of data.match(/(?<![\d-])0\d{0,4}-\d{1,4}-\d{3,4}(?![\d-])/g) ?? []) assert.match(phone, /^03-0000-01\d{2}$/);
  for (const domain of data.match(/[a-z0-9-]+\.(?:com|net|org|jp|co\.jp)\b/g) ?? []) assert.fail(`実在の形式のドメイン：${domain}`);
  assert.doesNotMatch(data, /パスワードは[^の、。]{4,}/);
});

test('README からサンプルへのリンクがある', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  for (const path of ['samples/okojo/manual.html', `samples/okojo/${PHONE_DIR}/`, 'samples/okojo/manual.json']) assert.ok(readme.includes(path), path);
  assert.ok(readme.includes('サンプル（架空の会社）'));
});
