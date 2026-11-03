// 開いた直後の PC 画面の右の列。合格テストは変えず、この部品の決まりだけを足す。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { withReplies } from '../plugin/lib/reply.mjs';
import { renderManual } from '../plugin/renderer/render.mjs';

const manual = JSON.parse(readFileSync(new URL('./fixtures/manual-full.json', import.meta.url), 'utf8'));
const html = renderManual(manual);

test('開いた直後の右の列に、社内の相談先の先頭を「まず誰に言うか」として1枚だけ置く', () => {
  const first = manual.contacts.find((contact) => contact.id.startsWith('INH-'));
  const rail = html.match(/<aside class="pick-rail"[\s\S]*?<\/aside>/)?.[0];
  assert.ok(rail, '右の列がありません');
  assert.equal((html.match(/class="pick-rail"/g) ?? []).length, 1);
  assert.match(rail, /まず誰に言うか/);
  assert.ok(rail.includes(first.name));
  assert.equal((rail.match(/rail-name/g) ?? []).length, 1);
});

test('社内の相談先がなければ、右の列を出さない', () => {
  const copy = JSON.parse(JSON.stringify(manual));
  const inside = new Set(copy.contacts.filter((contact) => contact.id.startsWith('INH-')).map((contact) => contact.id));
  assert.ok(inside.size);
  for (const page of copy.symptom_pages) if (inside.has(page.fallback?.contact)) page.fallback = null;
  const roles = new Set(copy.contacts.filter((contact) => inside.has(contact.id)).flatMap((contact) => [contact.role, contact.hours, contact.contract_location, contact.what_to_tell]));
  copy.contacts = copy.contacts.filter((contact) => !inside.has(contact.id));
  copy.statements = copy.statements.filter((statement) => !roles.has(statement.id));
  assert.ok(!renderManual(withReplies(copy)).includes('class="pick-rail"'));
});

test('右の列は3列の幅でだけ出し、JavaScript なしの本文には出さない', () => {
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.match(css, /\.js \.pick-rail\s*\{\s*display:\s*none/);
  assert.match(css, /@media \(min-width: 1200px\)[\s\S]*\.js \.pick-rail\s*\{\s*display:\s*block/);
  assert.ok(html.indexOf('class="pick-rail"') > html.indexOf('id="pick-home"'));
});
