// PC で症状を選ぶ前の中央。「はじめに」の中身を出し、左の一覧と同じ症状のカードは出さない。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { withReplies } from '../plugin/lib/reply.mjs';
import { renderManual } from '../plugin/renderer/render.mjs';

const manual = JSON.parse(readFileSync(new URL('./fixtures/manual-full.json', import.meta.url), 'utf8'));
const html = renderManual(manual);
const homeOf = (page) => page.match(/<div class="js-only pick-prompt" id="pick-home">[\s\S]*?<\/div>\n<article|<div class="js-only pick-prompt" id="pick-home">[\s\S]*?<\/div>\n<\/div>/)?.[0];
const home = homeOf(html);

test('中央に、説明書の説明、判定の凡例、まず誰に言うかを出す', () => {
  assert.ok(home, '中央の部品がありません');
  assert.match(home, /一次受け/);
  assert.match(home, /この説明書でできること/);
  assert.match(home, /判定の見かた/);
  assert.equal((home.match(/class="legend"/g) ?? []).length, 1);
  const first = manual.contacts.find((contact) => contact.id.startsWith('INH-'));
  const block = home.match(/<section class="pick-first"[\s\S]*?<\/section>/)?.[0];
  assert.ok(block, 'まず誰に言うかがありません');
  assert.ok(block.includes(first.name));
  assert.equal((block.match(/pick-first-name/g) ?? []).length, 1);
});

test('症状の大きなカードと右の列は出さず、症状は左の一覧だけにする', () => {
  assert.doesNotMatch(home, /class="sym[ "]/);
  assert.doesNotMatch(html, /pick-rail/);
  const left = html.match(/<section id="tab-help"[\s\S]*?<\/section>/)[0];
  assert.ok(manual.symptom_pages.every((page) => left.includes(`href="#symptom-${page.id}"`)));
});

test('更新の記録は、更新があるときだけ中央に出す', () => {
  assert.doesNotMatch(home, /update-log/);
  const updated = { ...manual, updates: [{ pages: [manual.symptom_pages[0].id], target: manual.symptom_pages[0].id, by: '佐藤', date: '2026-11-05', kind: 'page', summary: '手順を直しました。' }] };
  const shown = homeOf(renderManual(updated));
  assert.match(shown, /更新の記録/);
  assert.match(shown, /手順を直しました。/);
});

test('社内の相談先がなければ、まず誰に言うかを出さない', () => {
  const copy = JSON.parse(JSON.stringify(manual));
  const inside = new Set(copy.contacts.filter((contact) => contact.id.startsWith('INH-')).map((contact) => contact.id));
  assert.ok(inside.size);
  for (const page of copy.symptom_pages) if (inside.has(page.fallback?.contact)) page.fallback = null;
  const roles = new Set(copy.contacts.filter((contact) => inside.has(contact.id)).flatMap((contact) => [contact.role, contact.hours, contact.contract_location, contact.what_to_tell]));
  copy.contacts = copy.contacts.filter((contact) => !inside.has(contact.id));
  copy.statements = copy.statements.filter((statement) => !roles.has(statement.id));
  assert.ok(!renderManual(withReplies(copy)).includes('class="pick-first"'));
});

test('はじめにを最後に置く形と、フッターのリンクは変えない。中央は JavaScript があるときだけで、印刷には出ない', () => {
  assert.ok(html.indexOf('<section id="intro"') > html.indexOf('id="pick-home"'));
  assert.match(html, /<section id="intro" class="panel">[\s\S]*?<h1 class="intro-title">/);
  assert.match(html, /<a class="tap text-link" href="#intro">この説明書について<\/a>/);
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1, '見出しの h1 は はじめに の1つだけ');
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.match(css, /\.js \.pick-prompt\s*\{\s*display:\s*none/);
  assert.match(css.slice(css.indexOf('@media print')), /\.js-only[\s\S]*?\{\s*display:\s*none/);
});
