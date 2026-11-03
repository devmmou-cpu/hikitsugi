// 操作の図の決まりを確かめる。枠と文字と暖色の印だけで、1枚 2KB 以内。承認されるまで画面に出さない。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderManual } from '../plugin/renderer/render.mjs';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const { figures } = read('../plugin/library/figures.json');
const parts = new Set(read('../plugin/library/procedures.json').procedures.map((part) => part.id));

test('図は共有フォルダの ① の3手順分で、部品に対応する', () => {
  assert.deepEqual(Object.keys(figures), ['LIB-001', 'LIB-002', 'LIB-013']);
  for (const id of Object.keys(figures)) assert.ok(parts.has(id), id);
});

test('図：1枚 2KB 以内で、枠と文字と暖色の印だけ。読み込みも実在のアイコンの形もない', () => {
  for (const [id, figure] of Object.entries(figures)) {
    assert.ok(Buffer.byteLength(figure.svg) <= 2048, id);
    assert.match(figure.svg, /role="img" aria-label="[^"]+"/, id);
    assert.match(figure.svg, /var\(--accent\)/, id);
    assert.doesNotMatch(figure.svg, /<(?:style|script|image|use|a|foreignObject|linearGradient)\b|href|url\(|font-family/i, id);
    const tags = new Set([...figure.svg.matchAll(/<([a-z]+)\b/g)].map((m) => m[1]));
    for (const tag of tags) assert.ok(['svg', 'rect', 'path', 'text'].includes(tag), `${id}: ${tag}`);
    const colors = [...figure.svg.matchAll(/(?:fill|stroke)="([^"]+)"/g)].map((m) => m[1]);
    for (const color of colors) assert.ok(['none', 'currentColor'].includes(color), `${id}: ${color}`);
  }
});

test('図は承認されるまで画面に出さない', () => {
  for (const figure of Object.values(figures)) assert.equal(figure.status, 'draft');
  const html = renderManual(read('./fixtures/manual-full.json'));
  assert.ok(!html.includes(figures['LIB-002'].alt));
});
