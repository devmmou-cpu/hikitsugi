#!/usr/bin/env node
// 普段の言葉で探す仕組みの評価（模擬評価）。通しの評価の結果のフォルダを使う。
// 索引は phrase-writer が作り、確かめる入力は別の指示で模擬の後任が作る。照合に AI は使わない。
// 使い方：node --env-file=.env eval/search-eval.mjs --dir <通しの結果のフォルダ> --set <会社> [--count 30] [--round 1]
// --round ごとに新しい入力を作る。調整に使った回の入力は、確かめに使わない。

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildSearch, searchPages } from '../plugin/lib/search.mjs';
import { buildRequest, callAgent, clientOf, loadAgent, tagged } from './lib/adapters/live.mjs';
import { runPhraseWriterLive } from './lib/writing.mjs';
import { loadCase } from './lib/load-set.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUERIES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['queries'],
  properties: { queries: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['page', 'text'], properties: { page: { type: 'string' }, text: { type: 'string' } } } } },
};

/** 題名だけを渡す。索引を見せないので、作るときと別の言葉で確かめられる。 */
export function buildQueriesRequest(pages, count, agent = loadAgent('eval/agents/mock-successor-queries.md')) {
  return buildRequest(agent, QUERIES_SCHEMA, `${tagged({ pages: pages.map(({ id, title }) => ({ id, title })), count: String(count) })}\n\nすべてのページを含めて、${count} 件作ってください。`);
}

/** 指定の件数にそろえる。各ページから順に取るので、どのページも残る。存在しないページの入力は採点に入れず、数を返す。 */
export function pickQueries(queries, pageIds, count) {
  const known = new Set(pageIds);
  const left = pageIds.map((id) => queries.filter((query) => query.page === id));
  const picked = [];
  while (picked.length < count && left.some((list) => list.length)) {
    for (const list of left) if (list.length && picked.length < count) picked.push(list.shift());
  }
  return { picked, unknown: queries.filter((query) => !known.has(query.page)).length };
}

/** 上位1件と上位3件に正しい症状が入る割合を数える。 */
export function scoreSearch(index, queries) {
  const search = buildSearch(index);
  const rows = queries.map(({ page, text }) => {
    const found = searchPages(search, text, 3).map((result) => result.page);
    return { page, text, found, rank: found.indexOf(page) + 1 };
  });
  const rate = (limit) => (rows.length ? Math.round((rows.filter((row) => row.rank >= 1 && row.rank <= limit).length / rows.length) * 1000) / 10 : 0);
  return { total: rows.length, top1: rate(1), top3: rate(3), misses: rows.filter((row) => row.rank !== 1), rows };
}

async function main() {
  const { values } = parseArgs({ options: { dir: { type: 'string' }, set: { type: 'string' }, count: { type: 'string' }, round: { type: 'string' }, final: { type: 'boolean' } } });
  if (!values.dir || !values.set) throw new Error('使い方：--dir <通しの結果のフォルダ> --set <会社>');
  const info = loadCase(join(ROOT, 'eval/sets', values.set));
  if (info.split === 'holdout' && !values.final) throw new Error(`${values.set} は保留の会社です`);
  const count = Number(values.count ?? 30);
  const round = values.round ?? '1';
  const api = await clientOf();
  const calls = [];
  const record = ({ raw_text: _raw, ...call }) => calls.push(call);
  const manual = JSON.parse(readFileSync(join(values.dir, 'manual-final.json'), 'utf8'));
  const text = new Map(manual.statements.map((statement) => [statement.id, statement.text]));

  // 索引は1度だけ作る。入力を増やして確かめるときも同じ索引を使う
  const indexPath = join(values.dir, 'search-index.json');
  if (!existsSync(indexPath)) writeFileSync(indexPath, JSON.stringify(await runPhraseWriterLive({ manual, retiree: '田中', client: api, record }), null, 2));
  const pages = JSON.parse(readFileSync(indexPath, 'utf8')).pages;
  const index = pages.map(({ id, phrases }) => ({ page: id, title: text.get(manual.symptom_pages.find((page) => page.id === id).title), phrases }));

  const queriesPath = join(values.dir, `search-queries-${round}.json`);
  if (!existsSync(queriesPath)) {
    const agent = loadAgent('eval/agents/mock-successor-queries.md');
    const list = manual.symptom_pages.map((page) => ({ id: page.id, title: text.get(page.title) }));
    // モデルの件数は少しぶれるので、多めに頼んで指定の件数にそろえる
    const parsed = await callAgent({ api, agent, params: buildQueriesRequest(list, count + 10, agent), record, estimate: false });
    writeFileSync(queriesPath, JSON.stringify(parsed, null, 2));
  }
  const { picked, unknown } = pickQueries(JSON.parse(readFileSync(queriesPath, 'utf8')).queries, manual.symptom_pages.map((page) => page.id), count);
  if (picked.length < count) throw new Error(`${values.set}: 入力が足りません（${picked.length} 件）`);
  const result = scoreSearch(index, picked);
  const cost = calls.reduce((sum, call) => sum + (call.cost_usd ?? 0), 0);
  writeFileSync(join(values.dir, `search-result-${round}.json`), JSON.stringify({ label: '模擬評価', ...result, unknown_pages: unknown, cost_usd: cost }, null, 2));
  console.log(JSON.stringify({ set: values.set, round, total: result.total, unknown_pages: unknown, top1: result.top1, top3: result.top3, phrases: pages.reduce((sum, page) => sum + page.phrases.length, 0), cost_usd: cost }));
  for (const miss of result.misses) console.log(`  正解 ${miss.page}（順位 ${miss.rank || '圏外'}） ${miss.text} → ${miss.found.join(',')}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
