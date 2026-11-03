#!/usr/bin/env node
// プログラムが組む文（社員に返す文、業者に伝える文）だけを Verifier にかける（模擬評価）。通しの評価の結果のフォルダを使い、ほかの文章はかけ直さない。
// 使い方：node --env-file=.env eval/reply-verify.mjs --dir <通しの結果のフォルダ> --set <会社>

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { withCurrentParts } from '../plugin/lib/handover.mjs';
import { withReplies, withWindows10Note } from '../plugin/lib/reply.mjs';
import { clientOf, runVerifierLive } from './lib/adapters/live.mjs';
import { loadInput } from './lib/load-set.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RETIREE = '田中';

/** かける文章を選ぶ。プログラムが組んだ文だけ。 */
export const replyStatements = (manual) => manual.statements.filter((statement) => statement.usage);

/** 判定を数える。回答がない文章を「正しい」に数えない。 */
export function summarizeReplies(statements, results) {
  const judged = new Map(results.map((result) => [result.statement, result.verdict]));
  const counts = { correct: 0, contradiction: 0, unsupported: 0, dangerous: 0, unanswered: 0 };
  for (const statement of statements) counts[judged.get(statement.id) ?? 'unanswered'] += 1;
  return { total: statements.length, ...counts };
}

async function main() {
  const { values } = parseArgs({ options: { dir: { type: 'string' }, set: { type: 'string' }, source: { type: 'string', default: 'manual-glossary4.json' } } });
  if (!values.dir || !values.set) throw new Error('使い方：--dir <通しの結果のフォルダ> --set <会社>');
  const { survey } = loadInput(join(ROOT, 'eval/sets', values.set));
  const transcript = JSON.parse(readFileSync(join(values.dir, 'transcript.json'), 'utf8'));
  // render と同じ文面でかける。保存したあとに部品の文面が変わっていても、画面に出る文を確かめる
  const manual = withReplies(withWindows10Note(withCurrentParts(JSON.parse(readFileSync(join(values.dir, values.source), 'utf8'))).manual, survey));
  const statements = replyStatements(manual);
  const calls = [];
  const fresh = await runVerifierLive({
    input: { survey, transcript, retiree: RETIREE, statements: { schema_version: 1, company: survey.company, statements } },
    client: await clientOf(),
    record: (call) => calls.push(call),
  });
  const summary = summarizeReplies(statements, fresh.results);
  const cost = calls.reduce((sum, call) => sum + (call.cost_usd ?? 0), 0);
  writeFileSync(join(values.dir, 'reply-verification.json'), JSON.stringify({ label: '模擬評価', ...summary, results: fresh.results, statements, cost_usd: cost }, null, 2));
  console.log(JSON.stringify({ set: values.set, ...summary, cost_usd: cost }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
