// 追加4社の評価データの合格テスト。夜間の作業ではこのファイルを変更しない。
// 4社ができるまでは失敗する。すべて通ったら main へ取り込める。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSet, CREDENTIAL } from '../eval/lib/integrity.mjs';
import { runEval } from '../eval/lib/runner.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SETS = join(ROOT, 'eval/sets');

// 会社の条件。規模と環境を変えて、オコジョ精工（42名、3台）の複製にならないようにする
const COMPANIES = [
  { company: 'kuzuri', name: 'クズリ運輸株式会社', split: 'tuning', employees: 85, hosts: 4, must: ['VPN'] },
  { company: 'kinodoten', name: 'キノドテン建設株式会社', split: 'tuning', employees: 12, hosts: 2, must: ['OneDrive'] },
  { company: 'rater', name: 'ラーテル商事株式会社', split: 'holdout', employees: 28, hosts: 3, must: ['RAID6'] },
  { company: 'kenaga', name: 'ケナガ印刷株式会社', split: 'holdout', employees: 18, hosts: 5, must: ['複合機'] },
];

// オコジョ精工のデータの基準値。夜間の作業で変更されていないことを確かめる
const OKOJO_SHA256 = 'f4c86b2b23860b17a17ff0618eb45f84a943ddbaedd90745ee12774ebbf74e9b';

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

const readJson = (company, file) => JSON.parse(readFileSync(join(SETS, company, file), 'utf8'));
const checkOptions = {
  repoRoot: ROOT,
  checklistPath: join(ROOT, 'plugin/checklist/handover-items.json'),
  schemaRoot: ROOT,
};

test('評価セットはオコジョ精工と追加4社の5社だけ', () => {
  const found = readdirSync(SETS).filter((name) => statSync(join(SETS, name)).isDirectory()).sort();
  assert.deepEqual(found, ['okojo', ...COMPANIES.map((c) => c.company)].sort());
});

test('オコジョ精工のデータは変更されていない', () => {
  const dir = join(SETS, 'okojo');
  const hash = createHash('sha256');
  for (const path of walk(dir).sort()) {
    hash.update(relative(dir, path));
    hash.update(readFileSync(path));
  }
  assert.equal(hash.digest('hex'), OKOJO_SHA256);
});

test('調整用は3社、保留は2社', () => {
  const splits = ['okojo', ...COMPANIES.map((c) => c.company)].map((c) => readJson(c, 'case.json').split);
  assert.equal(splits.filter((s) => s === 'tuning').length, 3);
  assert.equal(splits.filter((s) => s === 'holdout').length, 2);
});

for (const spec of COMPANIES) {
  const ready = () => {
    assert.ok(existsSync(join(SETS, spec.company, 'case.json')), `${spec.company} がまだありません`);
  };

  test(`${spec.company}：整合性の検査に合格する`, () => {
    ready();
    assert.deepEqual(checkSet(join(SETS, spec.company), checkOptions), []);
  });

  test(`${spec.company}：会社の条件を満たす`, () => {
    ready();
    const info = readJson(spec.company, 'case.json');
    assert.equal(info.name, spec.name);
    assert.equal(info.split, spec.split);
    assert.ok(info.summary.includes(`${spec.employees}名`), '従業員数が summary にありません');
    const survey = readJson(spec.company, 'input/survey.json');
    assert.equal(new Set(survey.items.map((item) => item.host)).size, spec.hosts);
    const everything = JSON.stringify([survey, readJson(spec.company, 'input/transcript.fixture.json')]);
    for (const word of spec.must) assert.ok(everything.includes(word), `環境の特徴がありません: ${word}`);
    // 確認日として画面に出るので、未来の日付にしない
    const latest = '2026-11-05';
    assert.ok(info.as_of <= latest, `基準日が未来です: ${info.as_of}`);
    assert.ok(survey.as_of <= latest, `調査の基準日が未来です: ${survey.as_of}`);
    for (const item of survey.items) assert.ok(item.collected_at.slice(0, 10) <= latest, `取得日時が未来です: ${item.id}`);
    assert.ok(readJson(spec.company, 'hidden/tanaka_facts.json').started_at.slice(0, 10) <= latest, '聞き取りの日時が未来です');
  });

  test(`${spec.company}：E4 は根拠なしで、誤り10件と正しい記述約20件がある`, () => {
    ready();
    const { statements } = readJson(spec.company, 'answers/verifier.json');
    assert.equal(statements.find((s) => s.error === 'E4').expected, 'unsupported');
    assert.equal(statements.filter((s) => s.kind === 'seeded').length, 10);
    const correct = statements.filter((s) => s.kind === 'correct').length;
    assert.ok(correct >= 18 && correct <= 22, `正しい記述が ${correct} 件です`);
    // 誤りと正しい記述が交互に並ぶなど、位置で見分けられないこと
    const flags = statements.map((s) => s.kind === 'seeded');
    assert.ok(flags.slice(0, 10).some(Boolean) && flags.slice(-10).some(Boolean), '誤りが前か後ろに偏っています');
  });

  test(`${spec.company}：基準の出力で採点の仕組みが正しく動く`, async () => {
    ready();
    const resultsRoot = mkdtempSync(join(tmpdir(), 'hikitsugi-accept-'));
    const run = (target, adapter) =>
      runEval({
        set: spec.company,
        setDir: join(SETS, spec.company),
        target,
        adapter,
        resultsRoot,
        runId: `${target}-${adapter}`,
        final: true,
      });
    try {
      const oracle = await run('verifier', 'oracle');
      assert.equal(oracle.status, 'ok');
      assert.equal(oracle.summary.detection_rate, 100);
      assert.equal(oracle.summary.false_positive_rate, 0);
      assert.equal((await run('verifier', 'all-correct')).summary.detection_rate, 0);
      assert.equal((await run('verifier', 'all-flag')).summary.false_positive_rate, 100);
      assert.equal((await run('gaps', 'oracle')).summary.missed, 0);
      const interview = (await run('interview', 'oracle')).summary;
      assert.ok(interview.coverage_rate >= 85, `聞き取りの上限が ${interview.coverage_rate}% です`);
      assert.ok(interview.within_question_limit);
      assert.equal((await run('troubles', 'oracle')).summary.passed, 5);
    } finally {
      rmSync(resultsRoot, { recursive: true, force: true });
    }
  });
}

test('調整用の2社は、誤りと対になる正しい記述を記録し、5件以上離して並べる', () => {
  for (const company of ['kuzuri', 'kinodoten']) {
    const { statements } = readJson(company, 'answers/verifier.json');
    const order = readJson(company, 'input/statements.json').statements.map((s) => s.id);
    const paired = statements.filter((s) => s.pair);
    assert.ok(paired.length >= 8, `${company} の対の記録は ${paired.length} 件です`);
    for (const answer of paired) {
      const distance = Math.abs(order.indexOf(answer.id) - order.indexOf(answer.pair));
      assert.ok(distance >= 5, `${company} ${answer.id} と ${answer.pair} の距離は ${distance} です`);
    }
  }
});

test('ダミーの認証情報は会社ごとに別の値で、1社に1件だけある', () => {
  const values = ['okojo', ...COMPANIES.map((c) => c.company)].map((company) => {
    const { statements } = readJson(company, 'input/statements.json');
    const found = statements.flatMap((s) => [...s.text.matchAll(CREDENTIAL)].map((m) => m[1]));
    assert.equal(found.length, 1, `${company} のダミーは1件だけです`);
    return found[0];
  });
  assert.equal(new Set(values).size, values.length);
});

// ---- 文面の流用がないこと ----
const GRAM = 12;
const gramsOf = (texts) => {
  const grams = new Set();
  for (const text of texts) for (let i = 0; i + GRAM <= text.length; i += 1) grams.add(text.slice(i, i + GRAM));
  return grams;
};
const answersOf = (company) => readJson(company, 'hidden/tanaka_facts.json').facts.map((fact) => fact.answer);
const statementsOf = (company) => readJson(company, 'input/statements.json').statements.map((s) => s.text);

test('記述の本文に、他の会社と同じ文がない', () => {
  const seen = new Map();
  for (const company of ['okojo', ...COMPANIES.map((c) => c.company)]) {
    for (const text of statementsOf(company)) {
      assert.ok(!seen.has(text), `${company} と ${seen.get(text)} に同じ記述があります`);
      seen.set(text, company);
    }
  }
});

test('聞き取りの回答が、他の会社の文面の流用ではない（共通部分は 30% 未満）', () => {
  const companies = ['okojo', ...COMPANIES.map((c) => c.company)];
  for (const a of companies) {
    const mine = gramsOf(answersOf(a));
    for (const b of companies) {
      if (a === b) continue;
      const theirs = gramsOf(answersOf(b));
      const shared = [...mine].filter((gram) => theirs.has(gram)).length;
      const rate = shared / mine.size;
      assert.ok(rate < 0.3, `${a} の回答の ${Math.round(rate * 100)}% が ${b} と同じです`);
    }
  }
});

test('エージェントのプロンプトに追加4社の内容が混ざっていない', () => {
  const dir = join(ROOT, 'plugin/agents');
  const grams = gramsOf(COMPANIES.flatMap((c) => [...answersOf(c.company), ...statementsOf(c.company)]));
  for (const path of walk(dir)) {
    const text = readFileSync(path, 'utf8');
    for (const c of COMPANIES) {
      assert.ok(!text.includes(c.name) && !text.includes(c.company), `${relative(ROOT, path)} に ${c.company} があります`);
    }
    for (let i = 0; i + GRAM <= text.length; i += 1) {
      assert.ok(!grams.has(text.slice(i, i + GRAM)), `${relative(ROOT, path)} に評価データの文があります`);
    }
  }
});
