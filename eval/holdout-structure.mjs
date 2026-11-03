#!/usr/bin/env node
// 保留の2社の構造の検査（模擬評価）。点数と文章は出さず、検査の合否の件数と例外の有無だけを報告する。
// 通しの出力は開かない。子プロセスの出力は表示せず、結果のフォルダの中で、プログラムの検査だけを動かす。
// 使い方：node --env-file=.env eval/holdout-structure.mjs --set <会社>
//         node eval/holdout-structure.mjs --dir <通しの結果のフォルダ>（通しを動かさず、検査だけ）

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { coverageLeaks, locationWarnings } from '../plugin/lib/coverage-check.mjs';
import { fileSize, PC_FILE_LIMIT } from '../plugin/lib/limits.mjs';
import { contactProblems, pageProblems } from '../plugin/lib/page-check.mjs';
import { plainProblems } from '../plugin/lib/plain-check.mjs';
import { callScriptProblems, replyProblems } from '../plugin/lib/reply.mjs';
import { phraseProblems } from '../plugin/lib/search-index.mjs';
import { validate } from '../plugin/lib/validate.mjs';
import { phoneFileProblems } from '../plugin/renderer/phone.mjs';
import { manualHtmlProblems } from '../scripts/hooks/check-manual-html.mjs';
import { checkSecretFiles } from '../scripts/check-secrets.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = JSON.parse(readFileSync(join(ROOT, 'plugin/schemas/manual.schema.json'), 'utf8'));

/** 検査ごとの問題の件数だけを返す。問題の文は、中身を含むので返さない。 */
export function structureCounts(dir) {
  const count = (fn) => {
    try {
      const found = fn();
      return { problems: found.length, error: false };
    } catch (error) {
      // 例外の文にも中身が入りうるので、種類だけを残す
      return { problems: 0, error: error.constructor.name };
    }
  };
  const summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
  const finalPath = join(dir, 'manual-final.json');
  if (!existsSync(finalPath)) return { status: summary.status, checks: {}, missing: ['manual-final.json'] };
  const manual = JSON.parse(readFileSync(finalPath, 'utf8'));
  const phoneDir = join(dir, 'phone');
  const phoneFiles = existsSync(phoneDir) ? readdirSync(phoneDir).filter((name) => name.endsWith('.html')) : [];
  const blocked = existsSync(phoneDir) ? readdirSync(phoneDir).filter((name) => name.endsWith('.blocked')) : [];
  const htmlPath = join(dir, 'manual.html');
  const html = existsSync(htmlPath) ? readFileSync(htmlPath, 'utf8') : '';
  const phones = phoneFiles.map((name) => readFileSync(join(phoneDir, name), 'utf8'));
  return {
    status: summary.status,
    pages: manual.symptom_pages.length,
    phone_files: phoneFiles.length,
    blocked_files: blocked.length,
    pc_within_limit: Boolean(html) && fileSize(html) <= PC_FILE_LIMIT,
    location_warnings: count(() => locationWarnings(manual)).problems,
    checks: {
      schema: count(() => validate(SCHEMA, manual)),
      pages: count(() => pageProblems(manual)),
      contacts: count(() => contactProblems(manual)),
      replies: count(() => replyProblems(manual)),
      call_scripts: count(() => callScriptProblems(manual)),
      search_index: count(() => phraseProblems({ pages: manual.search_index.map(({ page, phrases }) => ({ id: page, phrases })) }, manual)),
      long_sentences: count(() => plainProblems(manual).long_sentences),
      unexplained_terms: count(() => plainProblems(manual).unexplained_terms),
      pc_html: count(() => manualHtmlProblems(html)),
      phone_html: count(() => phones.flatMap((text) => [...manualHtmlProblems(text), ...phoneFileProblems(text)])),
      secrets: count(() => checkSecretFiles([phoneDir, htmlPath])),
    },
  };
}

function main() {
  const { values } = parseArgs({ options: { set: { type: 'string' }, dir: { type: 'string' } } });
  if (values.dir) {
    console.log(JSON.stringify(structureCounts(values.dir)));
    return 0;
  }
  if (!values.set) throw new Error('使い方：--set <会社> か --dir <フォルダ>');
  const results = join(ROOT, 'eval/results/holdout-structure');
  mkdirSync(results, { recursive: true });
  const before = new Set(readdirSync(results));
  // 出力は中身を含むので、表示しない。残すのは終了コードだけ
  const run = spawnSync(process.execPath, ['--env-file=.env', join(ROOT, 'eval/pipeline.mjs'), '--set', values.set, '--final', '--results-dir', results], { cwd: ROOT, stdio: 'ignore' });
  const created = readdirSync(results).filter((name) => !before.has(name) && statSync(join(results, name)).isDirectory());
  if (created.length !== 1) {
    console.log(JSON.stringify({ set: values.set, exit_code: run.status, folder: false }));
    return 1;
  }
  const dir = join(results, created[0]);
  const report = existsSync(join(dir, 'summary.json')) ? structureCounts(dir) : { missing: ['summary.json'] };
  console.log(JSON.stringify({ set: values.set, exit_code: run.status, label: '模擬評価', ...report }));
  return run.status === 0 ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main();
