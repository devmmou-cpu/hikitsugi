#!/usr/bin/env node
// 模擬の社員の問い合わせで、正しい症状が上位3件に出る割合を測る（模擬評価）。文章のみで、画像は作らない。
// 問い合わせは索引を作る指示と別の指示で Haiku が作り、索引の言い方と重なるものはプログラムで除く。照合に AI は使わない。
// 使い方：node --env-file=.env eval/staff-eval.mjs --dir <通しの結果のフォルダ> --set <会社> [--count 30] [--round 1]

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { charPairs, normalizeText } from '../plugin/lib/search.mjs';
import { callAgent, clientOf, loadAgent } from './lib/adapters/live.mjs';
import { loadCase } from './lib/load-set.mjs';
import { buildQueriesRequest, pickQueries, scoreSearch } from './search-eval.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AGENT = 'eval/agents/mock-staff-queries.md';
const SIMILAR = 0.7;
const CONTAINED_MIN = 6;
const MAX_ATTEMPTS = 3;

const dice = (a, b) => {
  const left = new Set(charPairs(a));
  const right = new Set(charPairs(b));
  if (!left.size || !right.size) return 0;
  return (2 * [...left].filter((pair) => right.has(pair)).length) / (left.size + right.size);
};

/** 問い合わせが索引の言い方と重なるか。同じ、片方がもう片方を含む、文字の組がとても近い、のどれか。 */
export function overlapsPhrase(text, phrase) {
  const a = normalizeText(text);
  const b = normalizeText(phrase);
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  if (short.length >= CONTAINED_MIN && long.includes(short)) return true;
  return dice(a, b) >= SIMILAR;
}

/** 索引のどの言い方とも重ならない問い合わせと、除いた問い合わせに分ける。 */
export function splitOverlaps(queries, index) {
  const phrases = index.flatMap((entry) => entry.phrases);
  const kept = [];
  const dropped = [];
  for (const query of queries) (phrases.some((phrase) => overlapsPhrase(query.text, phrase)) ? dropped : kept).push(query);
  return { kept, dropped };
}

/** 対照：正解を隣のページにずらすと、当たらないはず。採点が甘くないことを確かめる。 */
export function shiftedScore(index, queries) {
  const ids = index.map((entry) => entry.page);
  return scoreSearch(index, queries.map((query) => ({ ...query, page: ids[(ids.indexOf(query.page) + 1) % ids.length] })));
}

async function main() {
  const { values } = parseArgs({ options: { dir: { type: 'string' }, set: { type: 'string' }, count: { type: 'string' }, round: { type: 'string' }, final: { type: 'boolean' } } });
  if (!values.dir || !values.set) throw new Error('使い方：--dir <通しの結果のフォルダ> --set <会社>');
  const info = loadCase(join(ROOT, 'eval/sets', values.set));
  if (info.split === 'holdout' && !values.final) throw new Error(`${values.set} は保留の会社です`);
  const count = Number(values.count ?? 30);
  const round = values.round ?? '1';
  const manual = JSON.parse(readFileSync(join(values.dir, 'manual-final.json'), 'utf8'));
  const text = new Map(manual.statements.map((statement) => [statement.id, statement.text]));
  const pages = JSON.parse(readFileSync(join(values.dir, 'search-index.json'), 'utf8')).pages;
  const titleOf = (id) => text.get(manual.symptom_pages.find((page) => page.id === id).title);
  const index = pages.map(({ id, phrases }) => ({ page: id, title: titleOf(id), phrases }));
  const pageIds = manual.symptom_pages.map((page) => page.id);

  const calls = [];
  const record = ({ raw_text: _raw, ...call }) => calls.push(call);
  const queriesPath = join(values.dir, `staff-queries-${round}.json`);
  const collected = existsSync(queriesPath) ? JSON.parse(readFileSync(queriesPath, 'utf8')).queries : [];
  if (!collected.length) {
    const api = await clientOf();
    const agent = loadAgent(AGENT);
    const list = manual.symptom_pages.map((page) => ({ id: page.id, title: text.get(page.title) }));
    // 重なるものを除くので、多めに頼む。足りなければ頼み直す
    for (let attempt = 0; attempt < MAX_ATTEMPTS && pickQueries(splitOverlaps(collected, index).kept, pageIds, count).picked.length < count; attempt += 1) {
      const parsed = await callAgent({ api, agent, params: buildQueriesRequest(list, count + 10, agent), record, estimate: false });
      collected.push(...parsed.queries);
    }
    writeFileSync(queriesPath, JSON.stringify({ queries: collected }, null, 2));
  }
  const { kept, dropped } = splitOverlaps(collected, index);
  const { picked, unknown } = pickQueries(kept, pageIds, count);
  if (picked.length < count) throw new Error(`${values.set}: 重ならない問い合わせが足りません（${picked.length} 件）`);
  const recheck = splitOverlaps(picked, index).dropped.length;
  if (recheck) throw new Error(`${values.set}: 索引と重なる問い合わせが残っています（${recheck} 件）`);

  const result = scoreSearch(index, picked);
  const shifted = shiftedScore(index, picked);
  const titleOnly = scoreSearch(index.map((entry) => ({ ...entry, phrases: [] })), picked);
  const cost = calls.reduce((sum, call) => sum + (call.cost_usd ?? 0), 0);
  writeFileSync(join(values.dir, `staff-result-${round}.json`), JSON.stringify({ label: '模擬評価', ...result, overlaps_dropped: dropped.length, unknown_pages: unknown, control: { shifted_top3: shifted.top3, title_only_top3: titleOnly.top3 }, cost_usd: cost }, null, 2));
  console.log(JSON.stringify({ set: values.set, round, total: result.total, top1: result.top1, top3: result.top3, overlaps_dropped: dropped.length, unknown_pages: unknown, shifted_top3: shifted.top3, title_only_top3: titleOnly.top3, cost_usd: cost }));
  for (const miss of result.rows.filter((row) => row.rank === 0 || row.rank > 3)) console.log(`  正解 ${miss.page}（圏外） ${miss.text} → ${miss.found.join(',')}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
