#!/usr/bin/env node
// 評価セット1社分の整合性を検査する。使い方：node eval/tools/check-set.mjs <会社>
// 終了コード：0＝合格、1＝問題あり、2＝指定の誤り

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSet } from '../lib/integrity.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const company = process.argv[2];
const setDir = company && join(ROOT, 'eval/sets', company);
if (!setDir || !existsSync(setDir)) {
  console.error('使い方：node eval/tools/check-set.mjs <会社>');
  process.exit(2);
}
let problems;
try {
  problems = checkSet(setDir, {
    repoRoot: ROOT,
    checklistPath: join(ROOT, 'plugin/checklist/handover-items.json'),
    schemaRoot: ROOT,
  });
} catch (error) {
  // ファイルが足りないなど。作成の途中ではよく起きるので、例外の全文ではなく理由だけを出す
  problems = [`検査を実行できません: ${error.message}`];
}
if (problems.length) {
  console.error(`${company}：問題が ${problems.length} 件あります`);
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}
console.log(`${company}：問題なし`);
