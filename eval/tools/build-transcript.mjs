#!/usr/bin/env node
// 隠し設定の台本から、固定の聞き取り記録を作る。記録は手で編集しない。
// 使い方：node eval/tools/build-transcript.mjs <会社>

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTranscript } from '../lib/build-transcript.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const company = process.argv[2];
if (!company) {
  console.error('使い方：node eval/tools/build-transcript.mjs <会社>');
  process.exit(2);
}
const setDir = join(ROOT, 'eval/sets', company);
const facts = JSON.parse(readFileSync(join(setDir, 'hidden/tanaka_facts.json'), 'utf8'));
writeFileSync(join(setDir, 'input/transcript.fixture.json'), JSON.stringify(buildTranscript(facts), null, 2) + '\n');
console.log(`${company}：聞き取り記録を作りました`);
