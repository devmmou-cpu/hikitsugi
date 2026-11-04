#!/usr/bin/env node
// 探す仕組みの数字が下がった原因の切り分け（模擬評価）。Writer と Verifier は動かさない。
// 1. 前回の問題文を固定して、前回の索引と今回の索引で採点する
// 2. 今回の索引の問題文の揺れは search-eval.mjs の --round で作る。ここでは集計だけする
// 3. 今回の索引からヒント由来の言い方を外した版で、1 を測る
// --regen を付けると、ヒントなしで phrase-writer を動かした索引でも 1 を測る（索引そのものの揺れを見るため）
// 使い方：node --env-file=.env eval/search-compare.mjs --old <時刻> --new <時刻> [--rounds 2,3,4] [--regen]

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildSearch, searchPages } from '../plugin/lib/search.mjs';
import { pagesForPhrases } from '../plugin/lib/search-index.mjs';
import { topicWords } from '../plugin/lib/symptom-check.mjs';
import { pickQueries } from './search-eval.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COUNT = 30;

// 20261103T225654 のページ → 20261104T034644 のページ。点数を見る前に、題名だけを比べて決めた。
// 今回に同じ話のページがないものは空にして、両方の索引の採点から外す。
// 前回の1ページが今回2ページに分かれたものは、どちらが出ても正解とする。
export const PAGE_MAP = {
  okojo: { T1: ['T1'], T2: ['T2'], T3: ['T8'], T4: ['T3'], T5: ['T4'], T6: [], T7: ['T5'], T8: ['T9'], T9: ['T13'], T10: ['T10'], T11: ['T7'], T12: ['T6'], T13: ['T11'], T14: ['T12'] },
  kuzuri: { T1: ['T1'], T2: ['T3'], T3: ['T2'], T4: ['T4'], T5: ['T6'], T6: ['T7'], T7: ['T5'], T8: ['T12'], T9: ['T9'], T10: ['T8'], T11: ['T10'] },
  kinodoten: { T1: ['T3'], T2: ['T2'], T3: ['T1', 'T6'], T4: ['T4'], T5: ['T5'], T6: ['T7'], T7: ['T8'], T8: ['T9'], T9: ['T10'], T10: ['T11'] },
};

/** 正解のページが1つでも上位に出た、最もよい順位を数える。 */
export function scoreAccepting(index, rows) {
  const search = buildSearch(index);
  const ranked = rows.map(({ accept, text }) => {
    const found = searchPages(search, text, 3).map((result) => result.page);
    const ranks = accept.map((page) => found.indexOf(page) + 1).filter((rank) => rank > 0);
    return { accept, text, found, rank: ranks.length ? Math.min(...ranks) : 0 };
  });
  const rate = (limit) => (ranked.length ? Math.round((ranked.filter((row) => row.rank >= 1 && row.rank <= limit).length / ranked.length) * 1000) / 10 : 0);
  return { total: ranked.length, top1: rate(1), top3: rate(3), rows: ranked };
}

/** 前回の問題文を、今回のページで採点できる形にする。同じ話のページがないものは外して数を返す。 */
export function mapQueries(queries, map) {
  const rows = queries.filter((query) => map[query.page]?.length).map((query) => ({ text: query.text, accept: map[query.page] }));
  return { rows, dropped: queries.length - rows.length };
}

const toKatakana = (text) => text.replace(/[ぁ-ゖ]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 0x60));

/**
 * ヒント由来の言い方を外す。受け皿のページの言い方のうち、外した困りごとの語を含み、
 * その語がページの題名、すること、最初の操作に出てこないものを、ヒント由来とする。
 * @returns { pages, removed: { page, phrase }[] }
 */
export function withoutHintPhrases(indexPages, manual) {
  const own = new Map(pagesForPhrases({ ...manual, symptom_exclusions: [] }).map((page) => [page.id, toKatakana([page.title, page.what_to_do, ...page.first_steps].join(' ').normalize('NFKC'))]));
  const names = manual.contacts.map((contact) => contact.name);
  const removed = [];
  const pages = indexPages.map(({ id, phrases }) => {
    const hints = (manual.symptom_exclusions ?? []).filter((exclusion) => exclusion.pages?.includes(id));
    const words = hints.flatMap((hint) => topicWords(hint.detail, names)).map((word) => toKatakana(word)).filter((word) => !own.get(id).includes(word));
    const kept = phrases.filter((phrase) => {
      const hit = words.some((word) => toKatakana(phrase.normalize('NFKC')).includes(word));
      if (hit) removed.push({ page: id, phrase });
      return !hit;
    });
    return { id, phrases: kept };
  });
  return { pages, removed };
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

/** 索引を探す仕組みの形にする。 */
function asIndex(pages, manual) {
  const text = new Map(manual.statements.map((statement) => [statement.id, statement.text]));
  return pages.map(({ id, phrases }) => ({ page: id, title: text.get(manual.symptom_pages.find((page) => page.id === id).title), phrases }));
}

async function main() {
  const { values } = parseArgs({ options: { old: { type: 'string' }, new: { type: 'string' }, rounds: { type: 'string' }, regen: { type: 'boolean' }, out: { type: 'string' } } });
  if (!values.old || !values.new) throw new Error('使い方：--old <時刻> --new <時刻>');
  const rounds = (values.rounds ?? '').split(',').filter(Boolean);
  const report = { label: '模擬評価', old: values.old, new: values.new, sets: {}, cost_usd: 0 };
  for (const set of Object.keys(PAGE_MAP)) {
    const oldDir = join(ROOT, 'eval/results', `${values.old}-${set}-pipeline`);
    const newDir = join(ROOT, 'eval/results', `${values.new}-${set}-pipeline`);
    const oldManual = readJson(join(oldDir, 'manual-final.json'));
    const newManual = readJson(join(newDir, 'manual-final.json'));
    const oldPages = readJson(join(oldDir, 'search-index.json')).pages;
    const newPages = readJson(join(newDir, 'search-index.json')).pages;
    const { picked } = pickQueries(readJson(join(oldDir, 'search-queries-1.json')).queries, oldManual.symptom_pages.map((page) => page.id), COUNT);
    const { rows, dropped } = mapQueries(picked, PAGE_MAP[set]);

    // 前回の結果を今のプログラムで再現できることを確かめる
    const identity = Object.fromEntries(oldManual.symptom_pages.map((page) => [page.id, [page.id]]));
    const reproduced = scoreAccepting(asIndex(oldPages, oldManual), mapQueries(picked, identity).rows);
    const oldScore = scoreAccepting(asIndex(oldPages, oldManual), rows.map((row) => ({ ...row, accept: oldAccept(row, picked, set) })));
    const newScore = scoreAccepting(asIndex(newPages, newManual), rows);
    const stripped = withoutHintPhrases(newPages, newManual);
    const hintless = scoreAccepting(asIndex(stripped.pages, newManual), rows);

    const entry = {
      fixed_queries: rows.length,
      dropped_queries: dropped,
      reproduced: { top1: reproduced.top1, top3: reproduced.top3 },
      old_index: { top1: oldScore.top1, top3: oldScore.top3 },
      new_index: { top1: newScore.top1, top3: newScore.top3 },
      hints_removed: { top1: hintless.top1, top3: hintless.top3, phrases_removed: stripped.removed.length, removed: stripped.removed },
      rounds: { 1: pickRound(newDir, 1) },
      differences: differences(oldScore.rows, newScore.rows, hintless.rows),
    };
    for (const round of rounds) entry.rounds[round] = pickRound(newDir, round);

    if (values.regen) {
      const regenPath = join(newDir, 'search-index-no-hints.json');
      if (!existsSync(regenPath)) {
        const { runPhraseWriterLive } = await import('./lib/writing.mjs');
        const { clientOf } = await import('./lib/adapters/live.mjs');
        const calls = [];
        const parsed = await runPhraseWriterLive({ manual: { ...newManual, symptom_exclusions: [] }, retiree: '田中', client: await clientOf(), record: (call) => calls.push(call) });
        writeFileSync(regenPath, JSON.stringify(parsed, null, 2));
        report.cost_usd += calls.reduce((sum, call) => sum + (call.cost_usd ?? 0), 0);
      }
      const regen = readJson(regenPath).pages;
      const score = scoreAccepting(asIndex(regen, newManual), rows);
      entry.regenerated = { top1: score.top1, top3: score.top3 };
    }
    report.sets[set] = entry;
    console.log(JSON.stringify({ set, ...entry, hints_removed: { ...entry.hints_removed, removed: undefined }, differences: undefined }));
  }
  if (values.out) writeFileSync(values.out, JSON.stringify(report, null, 2) + '\n');
  console.log(`phrase-writer の費用 $${report.cost_usd.toFixed(3)}`);
}

/** 前回の索引では、前回のページが正解。問題文から前回のページを引く。 */
function oldAccept(row, picked) {
  return [picked.find((query) => query.text === row.text).page];
}

function pickRound(dir, round) {
  const path = join(dir, `search-result-${round}.json`);
  if (!existsSync(path)) return null;
  const { top1, top3 } = readJson(path);
  return { top1, top3 };
}

/** 索引で順位が変わった問題文だけを残す。 */
function differences(oldRows, newRows, hintRows) {
  return newRows.flatMap((row, index) => {
    const before = oldRows[index].rank;
    const hint = hintRows[index].rank;
    return before === row.rank && hint === row.rank ? [] : [{ text: row.text, accept: row.accept, old_rank: before, new_rank: row.rank, hint_removed_rank: hint, new_found: row.found }];
  });
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
