// 通しの流れのテスト。偽のクライアントを使い、API は呼ばない。

import { withoutReplies, withReplies } from '../plugin/lib/reply.mjs';
import { locationWarnings } from '../plugin/lib/coverage-check.mjs';
import { structureCounts } from '../eval/holdout-structure.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildVerifierRequest } from '../eval/lib/adapters/live.mjs';
import { loadAnswers, loadInput } from '../eval/lib/load-set.mjs';
import * as manualScorer from '../eval/lib/scorers/manual.mjs';
import { buildWriterRequest, runWriterLive } from '../eval/lib/writing.mjs';
import { runPipeline } from '../eval/pipeline.mjs';
import { applyEdits, missingTokens } from '../plugin/lib/apply-edits.mjs';
import { assembleManual, checkCommon, commonStatementIds, droppedFromCommon, mergeRewritten, ownersOf, previousPiece } from '../plugin/lib/assemble.mjs';
import { buildRevision, carryForward, markReviewed, mergeVerification, prepareForRender, summarizeVerification, UnapprovedPartsError, verificationScope } from '../plugin/lib/handover.mjs';
import { coverageLeaks } from '../plugin/lib/coverage-check.mjs';
import { longSentences, plainProblems } from '../plugin/lib/plain-check.mjs';
import { applyRetireeCheck, namesRetireeAsContact, retireeFindings } from '../plugin/lib/retiree-check.mjs';
import { composeProcedures, libraryForAgents, loadLibrary, unapprovedParts } from '../plugin/lib/procedures.mjs';
import { validate } from '../plugin/lib/validate.mjs';
import { pageStatementIds, parseInfoRow } from '../plugin/lib/page-check.mjs';
import { renderManual } from '../plugin/renderer/render.mjs';
import { gapsFormat, nextStep, run } from '../plugin/scripts/hikitsugi.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SET = join(ROOT, 'eval/sets/okojo');
const input = loadInput(SET);
const gold = loadAnswers(SET);
// Writer の出力に当たる形。社員に返す文はプログラムが組むので、外しておく
const fixture = () => withoutReplies(JSON.parse(readFileSync(join(ROOT, 'test/fixtures/manual-t1.json'), 'utf8')));

const withTemp = async (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'hikitsugi-pipeline-'));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

// ---- 事実の保護 ----

test('Editor が数字や名前を変えたら検出する', () => {
  assert.deepEqual(missingTokens('電話は 03-0000-0101 です。', '電話は 03-0000-0102 です。'), ['03-0000-0101']);
  assert.deepEqual(missingTokens('NAS は 2 台です。', 'NAS は 2 台あります。'), []);
  assert.deepEqual(missingTokens('イタチ事務機に連絡します。', 'リース会社に連絡します。', ['イタチ事務機']), ['イタチ事務機']);
  assert.deepEqual(missingTokens('Z ドライブです。', 'Y ドライブです。'), ['Z']);
});

test('事実が変わった文章は元に戻し、変わっていない文章だけを反映する', () => {
  const manual = fixture();
  const [first, second] = manual.statements;
  const original = first.text;
  first.text = '電話は 03-0000-0101 です。';
  const before = first.text;
  const { manual: edited, changes } = applyEdits(manual, {
    rewrites: [{ id: first.id, text: '電話は 03-0000-0999 です。' }, { id: second.id, text: `${second.text}です。` }],
    glossary: [],
  });
  assert.equal(edited.statements[0].text, before);
  assert.equal(edited.statements[1].text, `${second.text}です。`);
  assert.equal(changes.length, 1);
  assert.ok(original);
});

test('評価では元に戻さず、変わったまま採点に回せる', () => {
  const manual = fixture();
  manual.statements[0].text = '電話は 03-0000-0101 です。';
  const { manual: edited, changes } = applyEdits(manual, { rewrites: [{ id: manual.statements[0].id, text: '電話します。' }], glossary: [] }, { revert: false });
  assert.equal(edited.statements[0].text, '電話します。');
  assert.equal(changes.length, 1);
});

test('用語の説明は新しい文章として番号を続けて振り、同じ語は足さない', () => {
  const manual = fixture();
  const last = Number(manual.statements.at(-1).id.slice(4));
  const { manual: edited } = applyEdits(manual, {
    rewrites: [],
    glossary: [{ term: '新しい語', one_line: '一言です。', analogy: 'たとえです。', company: '説明です。', evidence: ['INT-001'], help_page: '' }, { term: manual.glossary[0].term, one_line: '重複', analogy: '重複', company: '重複', evidence: ['INT-001'], help_page: '' }],
  });
  assert.equal(edited.glossary.length, manual.glossary.length + 1);
  assert.equal(edited.statements.at(-1).id, `STM-${String(last + 1).padStart(3, '0')}`);
  assert.throws(() => applyEdits(manual, { rewrites: [{ id: 'STM-999', text: 'x' }], glossary: [] }), /存在しない文章/);
});

test('長い文と説明のない語を見つける', () => {
  assert.equal(longSentences('あ'.repeat(51) + '。').length, 1);
  assert.equal(longSentences('あ'.repeat(49) + '。').length, 0);
  const manual = { statements: [{ id: 'STM-001', text: 'NAS と UTM を確認します。' }], glossary: [{ term: 'NAS', company: 'STM-002' }] };
  assert.deepEqual(plainProblems(manual).unexplained_terms, ['UTM']);
});

// ---- 表示プログラムへの受け渡し ----

test('判定のない文章があれば合格にしない', () => {
  const manual = { statements: [{ id: 'STM-001' }, { id: 'STM-002' }] };
  const result = summarizeVerification({ results: [{ statement: 'STM-001', verdict: 'correct' }] }, manual);
  assert.equal(result.passed, false);
  assert.deepEqual(result.unanswered, ['STM-002']);
  const flagged = summarizeVerification({ results: [{ statement: 'STM-001', verdict: 'dangerous' }, { statement: 'STM-002', verdict: 'correct' }] }, manual);
  assert.equal(flagged.passed, false);
  assert.equal(flagged.counts.dangerous, 1);
});

test('差し戻しでは前の版から用語の説明を外し、文章が増え続けないようにする', () => {
  const manual = fixture();
  const company = manual.glossary[0].company;
  const kept = manual.statements.find((s) => s.id !== company && !manual.glossary.some((g) => g.company === s.id)).id;
  const revision = buildRevision(manual, [{ statement: kept, verdict: 'unsupported' }, { statement: company, verdict: 'unsupported' }]);
  assert.deepEqual(revision.previous_manual.glossary, []);
  assert.ok(!revision.previous_manual.statements.some((s) => s.id === company));
  assert.ok(revision.previous_manual.statements.some((s) => s.id === kept));
  assert.deepEqual(revision.findings.map((f) => f.statement), [kept]);
});

test('差し戻しでは合格済みの用語の説明を引き継ぎ、変わった文章だけを返す', () => {
  const previous = {
    statements: [
      { id: 'STM-001', text: '本文1', evidence: ['INT-001'] },
      { id: 'STM-002', text: '本文2', evidence: ['INT-001'] },
      { id: 'STM-003', text: '説明A', evidence: ['INT-001'] },
      { id: 'STM-004', text: '説明B', evidence: ['INT-001'] },
    ],
    glossary: [{ term: 'A', company: 'STM-003' }, { term: 'B', company: 'STM-004' }],
  };
  const written = {
    statements: [{ id: 'STM-001', text: '本文1', evidence: ['INT-001'] }, { id: 'STM-002', text: '直した本文2', evidence: ['INT-001'] }],
    glossary: [],
  };
  const { manual, changed } = carryForward(previous, [{ statement: 'STM-002' }, { statement: 'STM-004' }], written);
  assert.deepEqual(changed, ['STM-002']);
  // 指摘された説明 B だけが落ちる。文章は増えない
  assert.deepEqual(manual.glossary, [{ term: 'A', company: 'STM-003' }]);
  assert.deepEqual(manual.statements.map((s) => s.id), ['STM-001', 'STM-002', 'STM-003']);
});

test('Writer が説明と同じ ID を別の文章に使っていたら、説明の番号を振り直す', () => {
  const previous = { statements: [{ id: 'STM-001', text: '説明', evidence: ['INT-001'] }], glossary: [{ term: 'A', company: 'STM-001' }] };
  const written = { statements: [{ id: 'STM-001', text: '新しい本文', evidence: ['INT-001'] }], glossary: [] };
  const { manual } = carryForward(previous, [], written);
  assert.deepEqual(manual.glossary, [{ term: 'A', company: 'STM-002' }]);
  assert.equal(manual.statements.find((s) => s.id === 'STM-002').text, '説明');
});

test('部品を使った文章は、変わった文章として Editor に渡さない', () => {
  const previous = { statements: [{ id: 'STM-001', text: '前', evidence: ['LIB-001'], library: 'LIB-001' }], glossary: [] };
  const written = { statements: [{ id: 'STM-001', text: '後', evidence: ['LIB-001'], library: 'LIB-001' }], glossary: [] };
  assert.deepEqual(carryForward(previous, [], written).changed, []);
});

// ---- 通しの評価 ----

const USAGE = { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

/** T1 の見本を、Writer が書く共通部分とページに分ける。 */
const pieces = () => {
  const manual = fixture();
  const page = manual.symptom_pages[0];
  const pick = (ids) => manual.statements.filter((statement) => ids.includes(statement.id));
  const { contacts, routines, devices } = manual;
  return {
    common: {
      page_plan: [{ id: page.id, category: page.category, symptom: '共有フォルダが見えない' }],
      statements: pick(commonStatementIds(manual)),
      contacts,
      routines,
      devices,
      before_leaving: [],
    },
    page: { statements: pick(pageStatementIds(page)), page },
  };
};

/** 手順ページのない困りごとへの偽の応答。すべて外す。 */
const excludeAll = (task) => ({ decisions: task.gaps.map(({ id }) => ({ gap: id, decision: 'exclude', reason: 'テストの理由', category: 'other', symptom: '' })) });

/** 載せ漏れの書き直しの偽の応答。足りない事実を機器として足す。 */
const fillMissing = (previous, missing) => {
  const out = JSON.parse(JSON.stringify(previous));
  missing.forEach(({ detail, source }, index) => {
    const base = 800 + index * 4;
    const ids = [0, 1, 2, 3].map((n) => `STM-${base + n}`);
    out.statements.push({ id: ids[0], text: '追加の機器', evidence: [source] }, { id: ids[1], text: detail.replace(/\s+/g, ' '), evidence: [source] }, { id: ids[2], text: '役割です', evidence: [source] }, { id: ids[3], text: '困ります', evidence: [source] });
    out.devices.push({ id: `D${90 + index}`, name: ids[0], location: ids[1], purpose: ids[2], impact: ids[3], credential_location: null, caution: null });
  });
  return out;
};

const glossaryEdits = () => {
  const manual = fixture();
  return manual.glossary.map(({ term, company }) => {
    const statement = manual.statements.find((s) => s.id === company);
    return { term, one_line: `${term} の一言です。`, analogy: `${term} のたとえです。`, company: statement.text, evidence: statement.evidence, help_page: '' };
  });
};

const taggedIn = (params, tag) => {
  const text = params.messages[0].content.map?.((block) => block.text).join('\n') ?? params.messages[0].content;
  return JSON.parse(text.match(new RegExp(`<${tag}>\\n([\\s\\S]*?)\\n</${tag}>`))[1]);
};

/** 各エージェントを、プロンプトの先頭の名前で見分けて応答する偽のクライアント。 */
function pipelineClient({ verdicts }) {
  const sent = [];
  let verifierCalls = 0;
  let editorCalls = 0;
  const reply = (params) => {
    const system = params.system;
    if (system.includes('Gap Finder')) {
      return {
        coverage: gold.gaps.items.map((item) => ({ item: item.item, state: item.state, evidence: item.evidence })),
        gaps: [{ id: 'GAP-001', items: gold.gaps.items.filter((i) => i.state !== 'filled').map((i) => i.item), why: '理由', priority: 'high', question_hint: 'ヒント' }],
      };
    }
    if (system.includes('Interviewer')) {
      const first = params.messages[0].content[1].text.includes('ここまでに 0 問');
      const items = gold.gaps.items.filter((i) => i.state !== 'filled').map((i) => i.item);
      return first ? { action: 'ask', gap: 'GAP-001', covers: items, question: '質問' } : { action: 'finish', gap: '', covers: [], question: '' };
    }
    // 連絡先の名前と番号は根拠と照合されるので、それを含む事実を選ぶ
    if (system.includes('模擬の担当者')) return { fact_ids: ['F-05'] };
    if (system.includes('phrase-writer')) {
      const body = JSON.stringify(params.messages);
      const ids = [...new Set([...body.matchAll(/\\"id\\":\\"(T\d+)\\"/g)].map((m) => m[1]))];
      return { pages: ids.map((id) => ({ id, phrases: Array.from({ length: 15 }, (_, i) => `${id} の言い方 ${i}`) })) };
    }
    if (system.includes('Writer')) {
      const task = taggedIn(params, 'task');
      // 書き直しでは、前の版をそのまま返す。載せ漏れがあれば足す
      if (task.revision?.missing) return fillMissing(task.revision.previous, task.revision.missing);
      if (task.revision) return task.revision.previous;
      return task.part === 'common' ? pieces().common : pieces().page;
    }
    if (system.includes('Plain-Japanese Editor')) {
      editorCalls += 1;
      return { rewrites: [], glossary: editorCalls === 1 ? glossaryEdits() : [] };
    }
    if (system.includes('Verifier')) {
      const verdict = verdicts[verifierCalls] ?? 'correct';
      verifierCalls += 1;
      // 指摘は最初の文章だけにする。用語の説明は合格のまま残る
      return { results: taggedIn(params, 'statements').statements.map((s, i) => ({ statement: s.id, verdict: i === 0 ? verdict : 'correct', reason: '', checked: [], conflicts_with: [] })) };
    }
    throw new Error('想定外のエージェントです');
  };
  return {
    sent,
    messages: {
      countTokens: async () => ({ input_tokens: 1 }),
      stream: (params) => {
        sent.push(params);
        return {
          finalMessage: async () => ({
            id: 'msg',
            model: params.model,
            stop_reason: 'end_turn',
            usage: USAGE,
            content: [{ type: 'text', text: JSON.stringify(reply(params)) }],
          }),
        };
      },
    },
  };
}

test('通し：合格すれば HTML を作り、エージェントごとの費用を残す', () =>
  withTemp(async (dir) => {
    const summary = await runPipeline({ set: 'okojo', setDir: SET, dir, client: pipelineClient({ verdicts: ['correct'] }) });
    assert.equal(summary.status, 'passed', summary.error);
    assert.equal(summary.resends, 0);
    assert.equal(summary.label, '模擬評価');
    assert.ok(existsSync(join(dir, 'manual.html')));
    assert.ok(summary.agents.verifier.calls === 1);
    // 共通部分に1回、ページごとに1回、載せ漏れの書き直しに1回
    assert.equal(summary.agents.writer.calls, 3);
    assert.ok(summary.leaks[0].found > 0);
    assert.equal(summary.leaks[0].remaining, 0);
    assert.equal(summary.before_leaving, 0);
    assert.equal(summary.search_phrases, 15);
    assert.ok(readFileSync(join(dir, 'manual.html'), 'utf8').includes('id="search-index"'));
    assert.equal(summary.review.pages, 1);
    assert.match(summary.review.mode, /模擬/);
    const final = JSON.parse(readFileSync(join(dir, 'manual-final.json'), 'utf8'));
    assert.equal(final.review.reviewer, '田中');
    assert.ok(readFileSync(join(dir, 'manual.html'), 'utf8').includes('田中 確認'));
    assert.ok(summary.cost_usd > 0);
  }));

test('通し：不合格なら指摘を Writer に渡して差し戻す', () =>
  withTemp(async (dir) => {
    const client = pipelineClient({ verdicts: ['unsupported', 'correct'] });
    const summary = await runPipeline({ set: 'okojo', setDir: SET, dir, client });
    assert.equal(summary.status, 'passed', summary.error);
    assert.equal(summary.resends, 1);
    const writers = client.sent.filter((p) => p.system.includes('Writer'));
    // 指摘のあった部分だけを書き直す（載せ漏れの書き直しを含む）
    assert.equal(writers.length, 4);
    assert.ok(!taggedIn(writers[0], 'task').revision);
    assert.ok(taggedIn(writers[3], 'task').revision.findings.length);
    // 変わっていない文章は Verifier にかけ直さない
    const verifiers = client.sent.filter((p) => p.system.includes('Verifier'));
    assert.ok(taggedIn(verifiers[1], 'statements').statements.length < taggedIn(verifiers[0], 'statements').statements.length);
    assert.equal(summary.rounds[1].counts.correct, summary.rounds[0].counts.correct + 1);
  }));

test('通し：差し戻しで何も変わらなければ、Editor を呼び直さず用語の説明も作り直さない', () =>
  withTemp(async (dir) => {
    const client = pipelineClient({ verdicts: ['unsupported', 'correct'] });
    await runPipeline({ set: 'okojo', setDir: SET, dir, client });
    const editorCalls = client.sent.filter((p) => p.system.includes('Plain-Japanese Editor'));
    assert.equal(editorCalls.length, 1);
  }));

test('通し：差し戻しは最大2回で、合格しなければ HTML を作らない', () =>
  withTemp(async (dir) => {
    const client = pipelineClient({ verdicts: ['dangerous', 'dangerous', 'dangerous', 'dangerous'] });
    const summary = await runPipeline({ set: 'okojo', setDir: SET, dir, client });
    assert.equal(summary.status, 'not_passed');
    assert.equal(client.sent.filter((p) => p.system.includes('Writer')).length, 5);
    assert.ok(!existsSync(join(dir, 'manual.html')));
    assert.ok(summary.unresolved.length > 0);
  }));

test('通し：再開すると保存済みの段階は呼び直さない', () =>
  withTemp(async (dir) => {
    await runPipeline({ set: 'okojo', setDir: SET, dir, client: pipelineClient({ verdicts: ['correct'] }) });
    const client = pipelineClient({ verdicts: ['correct'] });
    const summary = await runPipeline({ set: 'okojo', setDir: SET, dir, client });
    assert.equal(summary.status, 'passed');
    assert.equal(client.sent.length, 0);
  }));

test('通し：どのエージェントにも正解と隠し設定を渡さない（模擬の田中さんの事実を除く）', () =>
  withTemp(async (dir) => {
    const client = pipelineClient({ verdicts: ['correct'] });
    await runPipeline({ set: 'okojo', setDir: SET, dir, client });
    for (const params of client.sent) {
      const body = JSON.stringify(params.messages);
      assert.ok(!body.includes('"match"') && !body.includes('"expected"') && !body.includes('"support"'));
      if (!params.system.includes('模擬の担当者')) assert.ok(!body.includes('"rules"'));
    }
  }));

// ---- /hikitsugi:start の進行 ----

test('/hikitsugi:start：段階をたどって取扱説明書まで進み、途中から再開できる', () =>
  withTemp(async (dir) => {
    const work = join(dir, 'work');
    const hikitsugi = (command, args = [], stdin = '') => run(command, args, { work, stdin });
    const write = (name, value) => writeFileSync(join(work, name), JSON.stringify(value));
    const surveyPath = join(dir, 'survey.json');
    writeFileSync(surveyPath, JSON.stringify(input.survey));
    assert.equal(nextStep(work).step, 'init');

    assert.throws(() => hikitsugi('init', [surveyPath, '田中']), /退職する人の名前/);
    hikitsugi('init', [surveyPath, '田中', 'テスト', '会社']);
    assert.equal(JSON.parse(readFileSync(join(work, 'state.json'), 'utf8')).retiree, '田中');
    assert.equal(JSON.parse(readFileSync(join(work, 'state.json'), 'utf8')).company_name, 'テスト 会社');
    assert.equal(nextStep(work).step, 'gap-finder');

    const coverage = gold.gaps.items.map((item) => ({ item: item.item, state: item.state, evidence: item.evidence }));
    write('gaps.json', { coverage, gaps: [] });
    assert.throws(() => hikitsugi('check-gaps'), /漏れた必須項目/);
    const items = gold.gaps.items.filter((i) => i.state !== 'filled').map((i) => i.item);
    write('gaps.json', { coverage, gaps: [{ id: 'GAP-001', items, why: '理由', priority: 'high', question_hint: 'ヒント' }] });
    hikitsugi('check-gaps');
    assert.equal(nextStep(work).step, 'interview');

    write('next.json', { action: 'ask', gap: 'GAP-001', covers: ['CHK-01'], question: '契約先を教えてください', unfilled: [] });
    assert.equal(hikitsugi('check-next'), '契約先を教えてください');
    assert.equal(nextStep(work).pending_question, true);
    assert.throws(() => hikitsugi('record', ['answered'], 'パスワードは abcd1234 です'), /保管場所/);
    hikitsugi('record', ['answered'], '保守はカワウソシステムサービスで、連絡先は 03-0000-0102 です。');
    assert.equal(nextStep(work).asked, 1);
    assert.equal(nextStep(work).pending_question, false);

    write('next.json', { action: 'ask', gap: 'GAP-001', covers: ['CHK-02'], question: '次の質問', unfilled: [] });
    hikitsugi('record', ['unknown'], '');
    const transcript = JSON.parse(readFileSync(join(work, 'transcript.json'), 'utf8'));
    assert.equal(transcript.entries[1].status, 'unknown');
    assert.equal(transcript.entries[1].answer, '分かりません。');

    // 聞いていない項目を残して終えることはできない
    write('next.json', { action: 'finish', gap: '', covers: [], question: '', unfilled: [] });
    assert.throws(() => hikitsugi('check-next'), /まだ聞いていない/);
    write('gaps.json', { schema_version: 1, company: input.survey.company, coverage, gaps: [{ id: 'GAP-001', items: ['CHK-01', 'CHK-02'], why: '理由', priority: 'high', question_hint: 'ヒント' }] });
    assert.match(hikitsugi('check-next'), /終えました/);
    // 共通部分、ページの順に、1回に1つずつ書く
    assert.deepEqual(nextStep(work), { step: 'writer', round: 1, part: 'common' });
    hikitsugi('writer-task', ['1', 'common']);
    assert.equal(JSON.parse(readFileSync(join(work, 'writer-task.json'), 'utf8')).part, 'common');
    write('writer-1-common.json', pieces().common);
    assert.match(hikitsugi('check-writer', ['1', 'common']), /残り 1 件/);
    assert.deepEqual(nextStep(work), { step: 'writer', round: 1, part: 'T1' });
    hikitsugi('writer-task', ['1', 'T1']);
    const task = JSON.parse(readFileSync(join(work, 'writer-task.json'), 'utf8'));
    assert.equal(task.entry.id, 'T1');
    assert.equal(task.contacts[0].name, 'カワウソシステムサービス');
    const broken = pieces().page;
    broken.statements.find((s) => s.id === broken.page.steps[0]).text = 'NAS は事務所にあります。';
    write('writer-1-T1.json', broken);
    assert.throws(() => hikitsugi('check-writer', ['1', 'T1']), /1つの操作ではありません/);
    write('writer-1-T1.json', pieces().page);
    // 載せ漏れがあれば、共通部分だけを書き直す
    assert.match(hikitsugi('check-writer', ['1', 'T1']), /載せ漏れがあるので、共通部分を書き直します/);
    assert.deepEqual(nextStep(work), { step: 'writer', round: 1, part: 'common' });
    hikitsugi('writer-task', ['1', 'common']);
    const leakTask = JSON.parse(readFileSync(join(work, 'writer-task.json'), 'utf8'));
    assert.ok(leakTask.revision.missing.length > 0);
    // 直らなければ止める
    write('writer-1-common.json', leakTask.revision.previous);
    assert.throws(() => hikitsugi('check-writer', ['1', 'common']), /載せ漏れが残っています/);
    write('writer-1-common.json', fillMissing(leakTask.revision.previous, leakTask.revision.missing));
    assert.match(hikitsugi('check-writer', ['1', 'common']), /書きました/);
    assert.ok(!JSON.parse(readFileSync(join(work, 'state.json'), 'utf8')).leaks);
    const written = JSON.parse(readFileSync(join(work, 'manual-1.json'), 'utf8'));
    assert.equal(written.company_name, 'テスト 会社');
    assert.equal(written.company, input.survey.company);
    assert.equal(written.as_of, input.survey.as_of);
    assert.equal(nextStep(work).step, 'editor');
    write('editor-1.json', { rewrites: [], glossary: glossaryEdits() });
    hikitsugi('merge-edits', ['1']);
    assert.equal(nextStep(work).step, 'verifier');

    assert.throws(() => hikitsugi('render'), /合格していない/);
    const edited = (round) => JSON.parse(readFileSync(join(work, `edited-${round}.json`), 'utf8'));
    const results = (ids, verdict) => ({ results: ids.map((id, i) => ({ statement: id, verdict: i === 0 ? verdict : 'correct', reason: '', checked: [], conflicts_with: [] })) });
    const firstAt = edited(1).symptom_pages[0].title;
    write('verification-1.json', results([firstAt, ...edited(1).statements.map((s) => s.id).filter((id) => id !== firstAt)], 'unsupported'));
    assert.match(hikitsugi('check-verification', ['1']), /差し戻します（直す部分：T1）/);
    assert.deepEqual(nextStep(work), { step: 'writer', round: 2, part: 'T1' });
    assert.ok(existsSync(join(work, 'findings-1.json')));

    // 差し戻しで何も変わらなければ、Editor の作業は不要になる
    hikitsugi('writer-task', ['2', 'T1']);
    const again = JSON.parse(readFileSync(join(work, 'writer-task.json'), 'utf8'));
    assert.equal(again.revision.findings.length, 1);
    write('writer-2-T1.json', again.revision.previous);
    assert.match(hikitsugi('check-writer', ['2', 'T1']), /Editor の作業は不要/);
    assert.equal(nextStep(work).step, 'verifier');
    // 前回「正しい」で変わっていない文章は、かけ直さない
    const scope = JSON.parse(readFileSync(join(work, 'verify-scope-2.json'), 'utf8')).statements;
    assert.deepEqual(scope, [firstAt]);
    write('verification-2.json', results(scope, 'correct'));
    assert.match(hikitsugi('check-verification', ['2']), /合格/);

    // 普段の言葉で探す索引を作る
    assert.deepEqual(nextStep(work), { step: 'phrases' });
    hikitsugi('phrase-task');
    assert.equal(JSON.parse(readFileSync(join(work, 'phrase-pages.json'), 'utf8')).pages[0].id, 'T1');
    const phrases = (n) => ({ pages: [{ id: 'T1', phrases: Array.from({ length: n }, (_, i) => `言い方 ${i}`) }] });
    write('phrases.json', phrases(3));
    assert.throws(() => hikitsugi('check-phrases'), /言い方は重ならずに/);
    write('phrases.json', phrases(15));
    assert.match(hikitsugi('check-phrases'), /言い方を入れました（15 件）/);

    // 前任者の確認。終わるまでは下書き
    assert.deepEqual(nextStep(work), { step: 'review', reviewer: null, page: 'T1', pages: 1 });
    assert.throws(() => hikitsugi('review-ok', ['T1']), /確認を始められる段階ではありません/);
    hikitsugi('review-start', ['田中']);
    // 見本の文の根拠は、この流れの聞き取りの記録より多い。根拠の検査に通るように足す
    const recorded = JSON.parse(readFileSync(join(work, 'transcript.json'), 'utf8'));
    const finalManual = JSON.parse(readFileSync(join(work, 'manual-final.json'), 'utf8'));
    const citedIds = [...new Set(finalManual.statements.flatMap((statement) => statement.evidence).filter((id) => id.startsWith('INT-') && !recorded.entries.some((item) => item.id === id)))];
    writeFileSync(join(work, 'transcript.json'), JSON.stringify({ ...recorded, entries: [...recorded.entries, ...citedIds.map((id) => ({ id, gap: 'GAP-001', covers: ['CHK-01'], question: '質問', answer: '記録です。', status: 'answered', answered_at: '2026-11-03T00:00:00Z' }))] }));
    assert.match(hikitsugi('render'), /下書きの「ITの取扱説明書（PC 用）manual\.html」を作りました：.*\n「ITの取扱説明書（スマホ用）」フォルダを作りました：/);
    const draft = readFileSync(join(work, 'manual.html'), 'utf8');
    assert.ok(draft.includes('下書き（前任者の確認前）'));
    assert.ok(!draft.includes('田中 確認'));
    assert.match(hikitsugi('review-show', ['T1']), /共有フォルダが見えない/);

    // 直すと聞き取りの記録になり、そのページだけ書き直して検証し直す
    assert.throws(() => hikitsugi('review-fix', ['T1'], 'パスワードは abcd1234 です'), /パスワードの本体/);
    assert.match(hikitsugi('review-fix', ['T1'], '受付は平日だけです。'), /T1 を書き直します/);
    const afterFix = JSON.parse(readFileSync(join(work, 'transcript.json'), 'utf8'));
    const entry = afterFix.entries.at(-1);
    assert.equal(entry.answer, '受付は平日だけです。');
    assert.equal(entry.status, 'answered');
    assert.deepEqual(nextStep(work), { step: 'writer', round: 3, part: 'T1' });
    assert.throws(() => hikitsugi('render'), /合格していない/);
    hikitsugi('writer-task', ['3', 'T1']);
    const fixTask = JSON.parse(readFileSync(join(work, 'writer-task.json'), 'utf8'));
    assert.deepEqual(fixTask.revision.page_fix, { page: 'T1', comment: '受付は平日だけです。', evidence: entry.id });
    const fixed = fixTask.revision.previous;
    const reassurance = fixed.statements.find((s) => s.id === fixed.page.reassurance);
    reassurance.text = 'データが消えることはありません。受付は平日だけです。';
    reassurance.evidence = [...reassurance.evidence, entry.id];
    write('writer-3-T1.json', fixed);
    assert.match(hikitsugi('check-writer', ['3', 'T1']), /やさしくする文章 1 件/);
    write('editor-3.json', { rewrites: [], glossary: [] });
    hikitsugi('merge-edits', ['3']);
    const scope3 = JSON.parse(readFileSync(join(work, 'verify-scope-3.json'), 'utf8')).statements;
    assert.deepEqual(scope3, [fixed.page.reassurance]);
    write('verification-3.json', results(scope3, 'correct'));
    assert.match(hikitsugi('check-verification', ['3']), /合格/);
    // 書き直しのあとは、言い方も作り直す
    assert.equal(nextStep(work).step, 'phrases');
    write('phrases.json', phrases(15));
    hikitsugi('check-phrases');

    // 全ページが「このままでよい」で、確認の印が付く
    assert.equal(nextStep(work).page, 'T1');
    assert.match(hikitsugi('review-ok', ['T1']), /全ページの確認が終わりました/);
    assert.equal(nextStep(work).step, 'render');
    assert.match(hikitsugi('render'), /^「ITの取扱説明書（PC 用）manual\.html」を作りました：/);
    const finalHtml = readFileSync(join(work, 'manual.html'), 'utf8');
    assert.ok(finalHtml.includes('<html'));
    assert.ok(!finalHtml.includes('下書き（前任者の確認前）'));
    assert.ok(finalHtml.includes('田中 確認'));
    assert.ok(finalHtml.includes('この取扱説明書は、AIがもとの情報と照らし合わせ、前任の田中さんが全ページを確認したものです。'));
    // 完成したあとは、更新の入口になる
    assert.equal(nextStep(work).step, 'update');
  }));

test('/hikitsugi:start：差し戻しの上限に達すると not_passed で止まる', () =>
  withTemp(async (dir) => {
    const work = join(dir, 'work');
    const hikitsugi = (command, args = [], stdin = '') => run(command, args, { work, stdin });
    const write = (name, value) => writeFileSync(join(work, name), JSON.stringify(value));
    const surveyPath = join(dir, 'survey.json');
    writeFileSync(surveyPath, JSON.stringify(input.survey));
    hikitsugi('init', [surveyPath, '田中', '会社']);
    write('gaps.json', { schema_version: 1, company: 'okojo', coverage: [], gaps: [] });
    write('state.json', { company: 'okojo', company_name: '会社', round: 3, interview_done: true, passed: false });
    const stamped = { ...fixture(), company_name: '会社' };
    write('manual-3.json', stamped);
    write('edited-3.json', stamped);
    write('verification-3.json', { results: fixture().statements.map((s) => ({ statement: s.id, verdict: 'dangerous', reason: '', checked: [], conflicts_with: [] })) });
    assert.match(hikitsugi('check-verification', ['3']), /上限/);
    assert.equal(nextStep(work).step, 'not_passed');
    assert.throws(() => hikitsugi('render'), /合格していない/);
  }));

test('Gap Finder の形：init が書き出し、スキルが渡し、検査と同じ名前と値を持つ', () =>
  withTemp(async (dir) => {
    const work = join(dir, 'work');
    const surveyPath = join(dir, 'survey.json');
    writeFileSync(surveyPath, JSON.stringify(input.survey));
    run('init', [surveyPath, '田中', '会社'], { work });
    const format = JSON.parse(readFileSync(join(work, 'gaps-format.json'), 'utf8'));
    assert.deepEqual(format, gapsFormat());
    const schema = JSON.parse(readFileSync(join(ROOT, 'plugin/schemas/gaps.schema.json'), 'utf8'));
    // 調べる側と同じ定義で、プログラムが付ける項目だけを除く
    assert.deepEqual(format.properties.coverage, schema.properties.coverage);
    assert.deepEqual(format.properties.gaps, schema.properties.gaps);
    assert.deepEqual(format.required, ['coverage', 'gaps']);

    // この形で保存したものは検査に通り、名前を変えたものは形で止まる
    const coverage = gold.gaps.items.map((item) => ({ item: item.item, state: item.state, evidence: item.evidence }));
    const items = gold.gaps.items.filter((item) => item.state !== 'filled').map((item) => item.item);
    const output = { coverage, gaps: [{ id: 'GAP-001', items, why: '理由', priority: 'high', question_hint: 'ヒント' }] };
    assert.deepEqual(validate(format, output), []);
    writeFileSync(join(work, 'gaps.json'), JSON.stringify(output));
    assert.match(run('check-gaps', [], { work }), /聞き取りの空白 1 件/);
    const renamed = { ...output, coverage: coverage.map(({ item, ...rest }) => ({ id: item, ...rest })) };
    assert.ok(validate(format, renamed).length > 0);
    writeFileSync(join(work, 'gaps.json'), JSON.stringify(renamed));
    assert.throws(() => run('check-gaps', [], { work }), /形式が違います/);

    const skill = readFileSync(join(ROOT, 'plugin/skills/start/SKILL.md'), 'utf8');
    assert.ok(skill.includes('hikitsugi-work/gaps-format.json'));
  }));

test('スキルとプラグインの定義がそろっている', () => {
  const skill = readFileSync(join(ROOT, 'plugin/skills/start/SKILL.md'), 'utf8');
  for (const agent of ['gap-finder', 'interviewer', 'writer', 'plain-japanese-editor', 'verifier']) {
    assert.ok(skill.includes(`hikitsugi:${agent}`), agent);
    assert.ok(existsSync(join(ROOT, `plugin/agents/${agent}.md`)), agent);
  }
  assert.ok(skill.includes('AskUserQuestion'));
  assert.equal(JSON.parse(readFileSync(join(ROOT, 'plugin/.claude-plugin/plugin.json'), 'utf8')).name, 'hikitsugi');
  // 模擬の田中さんは評価専用なので、配布物に含めない
  assert.ok(!existsSync(join(ROOT, 'plugin/agents/mock-tanaka.md')));
});

// ---- 手順部品 ----

const library = loadLibrary();
const sources = { survey: input.survey, transcript: input.transcript };
const driveItem = input.survey.items.find((item) => item.status === 'ok' && typeof item.value === 'string' && item.value.startsWith('\\\\'));
const FRAME = [
  ['STM-901', '共有フォルダが見えない'],
  ['STM-902', '手順どおりに進めれば直せます。'],
  ['STM-903', 'データは消えません。'],
  ['STM-904', '共有フォルダが見えません。'],
  ['STM-905', 'PC とサーバーの保守'],
  ['STM-906', '受付は平日です。'],
  ['STM-907', '控えは書庫にあります。'],
  ['STM-908', '見えないフォルダの名前を伝えてください。'],
].map(([id, text]) => ({ id, text, evidence: ['INT-002'] }));
/** 部品の検査のための、ページ1つの取扱説明書。 */
const withSteps = (statements, steps = statements.map((s) => s.id), fields = {}) => ({
  ...fixture(),
  statements: [...statements, ...FRAME],
  symptom_pages: [{
    id: 'T1',
    category: 'file',
    title: 'STM-901',
    badge: { value: 'self', statement: 'STM-902' },
    minutes: 2,
    reassurance: 'STM-903',
    notes: [],
    first_steps: [],
    first_goal: null,
    branches: [],
    steps,
    goal: null,
    exceptions: [],
    info_rows: [],
    fallback: { contact: 'VEN-02', message: 'STM-904' },
    ...fields,
  }],
  contacts: [{ id: 'VEN-02', name: 'カワウソシステムサービス', phone: '03-0000-0102', role: 'STM-905', hours: 'STM-906', contract_location: 'STM-907', what_to_tell: 'STM-908' }],
  routines: [],
  devices: [],
  glossary: [],
});
const step = (id, partId) => ({ id, text: '', evidence: [], library: partId });
const problemsOf = (manual) => composeProcedures(manual, sources).problems.join('\n');

test('部品の形式が正しく、すべて確認済みで、順番は実在する部品だけを指す', () => {
  assert.deepEqual(validate(JSON.parse(readFileSync(join(ROOT, 'plugin/schemas/procedures.schema.json'), 'utf8')), library), []);
  const ids = new Set(library.procedures.map((part) => part.id));
  for (const part of library.procedures) {
    assert.equal(part.status, 'approved', part.id);
    assert.equal(part.reviewed_by, 'Okojyo-Soft', part.id);
    assert.match(part.reviewed_on, /^2026-11-0[23]$/, part.id);
    // 値を入れる枠はない。会社の値は表に置く
    assert.doesNotMatch(part.text, /[{}]/, part.id);
    assert.deepEqual(longSentences(part.text), [], part.id);
    // 表を指す部品だけが、表の言葉を使う
    if (/会社の情報の表/.test(part.text)) assert.equal(part.needs_table, true, part.id);
  }
  for (const sequence of library.sequences) {
    const used = [...sequence.first, ...(sequence.first_goal ? [sequence.first_goal] : []), ...sequence.branches, ...sequence.steps, ...(sequence.goal ? [sequence.goal] : []), ...sequence.exceptions];
    for (const id of used) assert.ok(ids.has(id), id);
    const kindsOf = (id) => library.procedures.find((part) => part.id === id).kinds;
    for (const id of sequence.first) assert.ok(kindsOf(id).includes('first_steps'), id);
    for (const id of sequence.steps) assert.ok(kindsOf(id).includes('steps'), id);
    if (sequence.goal) assert.ok(kindsOf(sequence.goal).includes('goal'));
    if (sequence.first_goal) assert.ok(kindsOf(sequence.first_goal).includes('first_goal'));
  }
});

test('操作の部品は1つの操作を書き、確認や例外はゴールや例外に置く', () => {
  for (const part of library.procedures) {
    if (part.kinds.includes('goal') || part.kinds.includes('first_goal')) assert.doesNotMatch(part.text, /ください。$/, part.id);
    if (part.kinds.includes('steps') || part.kinds.includes('first_steps')) assert.match(part.text.split('。')[0], /ください$/, part.id);
  }
  const drive = library.sequences.find((sequence) => sequence.id === 'network-drive');
  assert.deepEqual(drive.first, ['LIB-001', 'LIB-002', 'LIB-013']);
  assert.equal(drive.first_goal, 'LIB-023');
  assert.equal(drive.goal, 'LIB-007');
});

test('部品に評価セットの値や、許可されていない製品名が入っていない', () => {
  const text = JSON.stringify(library);
  for (const name of ['オコジョ', 'OKOJO', 'okojo', 'クロテン', 'カワウソ', 'イタチ', 'イイズナ', 'フェレット', '田中', '佐藤']) assert.ok(!text.includes(name), name);
  assert.ok(!/192\.168\.|03-0000-01/.test(text));
  const allowed = new Set(['Windows', 'Ctrl', 'C', 'V', 'OneDrive', 'file-copy', 'wifi-off', 'onedrive-resume', 'first', 'first_goal', 'branches', 'steps', 'goal', 'exceptions', 'kinds', 'first_steps', 'needs_table', 'true', 'false', 'null', 'E', 'Enter', 'Wi-Fi', 'PC', 'LIB-', 'network-drive', 'free-space', 'admin-screen', 'wifi', 'restart', 'schema_version', 'sequences', 'id', 'title', 'procedures', 'use_for', 'text', 'status', 'approved', 'reviewed_by', 'Okojyo-Soft', 'reviewed_on']);
  const words = (text.match(/[A-Za-z][A-Za-z_-]*/g) ?? []).filter((word) => !allowed.has(word));
  assert.deepEqual(words, []);
});

test('部品の文面はプログラムが組み立て、根拠に部品を入れる', () => {
  const { manual, problems } = composeProcedures(withSteps([step('STM-001', 'LIB-001'), step('STM-002', 'LIB-005'), { id: 'STM-003', text: `Z ドライブは ${driveItem.value} です。`, evidence: [driveItem.id] }], ['STM-001', 'STM-002'], { info_rows: ['STM-003'] }), sources);
  assert.deepEqual(problems, []);
  assert.equal(manual.statements[0].text, library.procedures[0].text);
  assert.deepEqual(manual.statements[0].evidence, ['LIB-001']);
  assert.deepEqual(manual.statements[1].evidence, ['LIB-005']);
  assert.deepEqual(validate(JSON.parse(readFileSync(join(ROOT, 'plugin/schemas/manual.schema.json'), 'utf8')), manual), []);
});

test('部品の指定の誤りを見つける', () => {
  assert.match(problemsOf(withSteps([step('STM-001', 'LIB-999')])), /存在しない部品/);
  // 部品の指定がないのに部品を根拠にして、自分の文で手順を書く形
  assert.match(problemsOf(withSteps([{ id: 'STM-001', text: '自分の文で押してください。', evidence: ['LIB-001'] }])), /部品の指定がない/);
  // 置けない項目に置いた部品
  assert.match(problemsOf(withSteps([step('STM-001', 'LIB-007')])), /LIB-007 は steps に置けません/);
  assert.match(problemsOf(withSteps([step('STM-001', 'LIB-013')], [], { first_steps: ['STM-001'], steps: [] })), /^$/);
  assert.match(problemsOf(withSteps([step('STM-001', 'LIB-013')])), /LIB-013 は steps に置けません/);
});

test('表を指す部品のページには、会社の情報の表が必要', () => {
  assert.match(problemsOf(withSteps([step('STM-001', 'LIB-004')])), /会社の情報の表を指しますが/);
});

test('連絡先へ案内する部品のページには、fallback が必要', () => {
  const page = withSteps([step('STM-001', 'LIB-015')], [], { exceptions: ['STM-001'], fallback: null });
  assert.match(problemsOf(page), /連絡先へ案内しますが/);
});

test('ゴール、分岐、例外を手順と別の項目に置ける。手順は1文の操作だけ', () => {
  const statements = [
    { id: 'STM-001', text: 'NAS は事務所にあります。', evidence: [driveItem.id] },
    { id: 'STM-002', text: 'ルーターは初期化しないでください。', evidence: [driveItem.id] },
    { id: 'STM-003', text: 'ルーターの電源を確かめてください。', evidence: [driveItem.id, 'INT-001'] },
    { id: 'STM-005', text: '画面が消えます。そのあと電源を入れてください。', evidence: [driveItem.id] },
    step('STM-004', 'LIB-001'),
  ];
  const found = problemsOf(withSteps(statements, ['STM-001', 'STM-002', 'STM-003', 'STM-005', 'STM-004']));
  assert.match(found, /STM-001 は1つの操作ではありません/);
  assert.match(found, /STM-002 は1つの操作ではありません/);
  assert.match(found, /STM-005 は1つの操作ではありません/);
  assert.doesNotMatch(found, /STM-003/);
  assert.doesNotMatch(found, /STM-004/);
  const moved = withSteps(statements.filter((s) => s.id !== 'STM-005'), ['STM-003', 'STM-004'], { notes: ['STM-001', 'STM-002'] });
  assert.equal(problemsOf(moved), '');
});

test('まずこれだけは3つまで。ゴールだけのページや、操作のゴールを見つける', () => {
  const steps = [1, 2, 3, 4].map((n) => ({ id: `STM-00${n}`, text: '押してください。', evidence: [driveItem.id] }));
  assert.match(problemsOf(withSteps(steps, [], { first_steps: steps.map((s) => s.id) })), /first_steps は3つまで/);
  const goal = { id: 'STM-005', text: '開くか確かめてください。', evidence: [driveItem.id] };
  assert.match(problemsOf(withSteps([goal], [], { goal: 'STM-005' })), /goal があるのに steps がありません/);
  assert.match(problemsOf(withSteps([steps[0], goal], ['STM-001'], { goal: 'STM-005' })), /STM-005 はゴールなので/);
  assert.match(problemsOf(withSteps([goal], [], { first_goal: 'STM-005' })), /first_goal があるのに/);
});

test('後任が読む文章に、作り方の言葉があれば見つける', () => {
  const statements = [{ id: 'STM-001', text: '聞き取りに記録がありません。', evidence: [driveItem.id] }, step('STM-002', 'LIB-001')];
  assert.match(problemsOf(withSteps(statements, ['STM-002'], { notes: ['STM-001'] })), /作り方の言葉/);
});

test('途中で書くのをやめた出力は、手順ページがないことと空の文章で見つける', () => {
  const base = withSteps([{ id: 'STM-001', text: '', evidence: [driveItem.id] }], []);
  base.symptom_pages = [];
  const found = problemsOf(base);
  assert.match(found, /手順ページが1つもありません/);
  assert.match(found, /STM-001: 文章が空です/);
});

test('業者の連絡先がない vendor のページと、社内の相談先がない internal のページを見つける', () => {
  const noContact = withSteps([step('STM-001', 'LIB-001')], ['STM-001'], { fallback: null, badge: { value: 'vendor', statement: 'STM-902' } });
  assert.match(problemsOf(noContact), /vendor のページには、使える連絡先の中の業者/);
  noContact.symptom_pages[0].badge.value = 'internal';
  assert.match(problemsOf(noContact), /internal のページには社内の相談先/);
});

test('自分で直せるのに操作がないページと、確認してからなのに連絡先がないページを見つける', () => {
  const noWork = withSteps([], []);
  assert.match(problemsOf(noWork), /self のページには、後任が行う操作/);
  const noContact = withSteps([step('STM-001', 'LIB-001')], ['STM-001'], { fallback: null, badge: { value: 'check_first', statement: 'STM-902' } });
  assert.match(problemsOf(noContact), /check_first のページには、確かめたあとの連絡先/);
});

test('社内の相談先は電話番号や受付の記録がなくてよい。名前は根拠が必要', () => {
  const inside = withSteps([step('STM-001', 'LIB-001')], ['STM-001'], { badge: { value: 'internal', statement: 'STM-902' }, fallback: { contact: 'INH-01', message: 'STM-904' } });
  inside.contacts = [{ id: 'INH-01', name: '総務課', phone: '', role: 'STM-905', hours: null, contract_location: null, what_to_tell: 'STM-908' }];
  inside.statements = inside.statements.filter((s) => !['STM-906', 'STM-907'].includes(s.id));
  assert.equal(problemsOf(inside), '');
  assert.deepEqual(validate(JSON.parse(readFileSync(join(ROOT, 'plugin/schemas/manual.schema.json'), 'utf8')), composeProcedures(inside, sources).manual), []);
  inside.contacts[0].name = '架空の部署';
  assert.match(problemsOf(inside), /名前「架空の部署」が根拠にありません/);
  const vendor = withSteps([step('STM-001', 'LIB-001')]);
  vendor.contacts[0] = { ...vendor.contacts[0], phone: '', hours: null };
  // 番号の記録がない業者も載せる。番号があるのに受付の欄がなければ見つける
  assert.doesNotMatch(problemsOf(vendor), /電話番号が必要|hours/);
  vendor.contacts[0].phone = '03-0000-0102';
  assert.match(problemsOf(vendor), /hours と contract_location/);
});

test('連絡先の役割は短いラベルにする', () => {
  const long = withSteps([step('STM-001', 'LIB-001')]);
  long.statements.find((s) => s.id === 'STM-905').text = 'ルーターの保守をお願いしている会社です。';
  assert.match(problemsOf(long), /role は15字以内/);
});

test('会社の情報の表は文章から値を読む。形が違うか、根拠にない値なら見つけ、表示プログラムも止まる', () => {
  assert.deepEqual(parseInfoRow('Z ドライブは \\\\NAS\\図面 です。'), { type: 'drive', target: null, drive: 'Z', path: '\\\\NAS\\図面' });
  assert.deepEqual(parseInfoRow('総務用 PC（A-01）の S ドライブは \\\\NAS\\スキャン です。'), { type: 'drive', target: '総務用 PC（A-01）', drive: 'S', path: '\\\\NAS\\スキャン' });
  assert.deepEqual(parseInfoRow('工場の Wi-Fi の名前は NET-01 です。'), { type: 'value', label: '工場の Wi-Fi の名前', value: 'NET-01' });
  for (const text of ['経理は X ドライブです。', 'ドライブがあります。', '受付は平日です。']) assert.equal(parseInfoRow(text), null, text);
  const row = (text) => withSteps([{ id: 'STM-001', text, evidence: [driveItem.id] }, step('STM-002', 'LIB-001')], ['STM-002'], { info_rows: ['STM-001'] });
  assert.match(problemsOf(row('経理は X ドライブです。')), /表の行の形ではありません/);
  assert.match(problemsOf(row('Z ドライブは \\\\実在しない\\名前 です。')), /根拠にありません/);
  assert.equal(problemsOf(row(`Z ドライブは ${driveItem.value} です。`)).includes('根拠にありません'), false);
  const page = fixture();
  page.symptom_pages[0].info_rows = [page.symptom_pages[0].steps[0]];
  page.symptom_pages[0].steps = page.symptom_pages[0].steps.slice(1);
  assert.throws(() => renderManual(page), /会社の情報の表/);
});

// ---- ページ単位の Writer ----

test('部分を組み立てると、番号を全体で振り直し、参照も一緒に変わる。参照されない文章は捨てる', () => {
  const { common, page } = pieces();
  page.statements.push({ id: 'STM-950', text: 'どこからも使わない文章です。', evidence: ['INT-018'] });
  const manual = assembleManual(common, { T1: page }, { schema_version: 1, company: 'c', company_name: 'n', as_of: '2026-11-05' });
  const ids = manual.statements.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids[0], 'STM-001');
  assert.ok(!manual.statements.some((s) => s.text.includes('どこからも')));
  const textOf = (id) => manual.statements.find((s) => s.id === id).text;
  const original = fixture();
  assert.equal(textOf(manual.symptom_pages[0].title), original.statements.find((s) => s.id === original.symptom_pages[0].title).text);
  assert.equal(textOf(manual.contacts[0].role), original.statements.find((s) => s.id === original.contacts[0].role).text);
  assert.deepEqual(manual.glossary, []);
});

test('指摘の持ち主を見つけ、書き直した部分だけを差し替える。ほかの文章と ID は変わらない', () => {
  const { common, page } = pieces();
  const second = JSON.parse(JSON.stringify(page));
  second.page.id = 'T2';
  const plan = [...common.page_plan, { id: 'T2', category: 'file', symptom: '別の症状' }];
  const manual = assembleManual({ ...common, page_plan: plan }, { T1: page, T2: second }, { schema_version: 1, company: 'c', company_name: 'n', as_of: '2026-11-05' });
  const [t1, t2] = manual.symptom_pages;
  const owners = ownersOf(manual, [{ statement: t2.title, verdict: 'unsupported' }, { statement: manual.contacts[0].role, verdict: 'unsupported' }, { statement: 'STM-999', verdict: 'unsupported' }]);
  assert.deepEqual([...owners.keys()].sort(), ['T2', 'common']);

  const rewrite = previousPiece(manual, 'T2');
  rewrite.statements.find((s) => s.id === t2.title).text = '書き直した症状';
  rewrite.statements.push({ id: 'STM-001', text: '新しい説明です。', evidence: ['INT-018'] });
  rewrite.page = { ...rewrite.page, notes: ['STM-001'] };
  const merged = mergeRewritten(manual, { pages: { T2: rewrite } });
  assert.deepEqual(merged.symptom_pages[0], t1);
  // 新しい文章は、ほかの部分と重ならない番号になる
  const ids = merged.statements.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  const newId = merged.symptom_pages[1].notes[0];
  assert.notEqual(newId, 'STM-001');
  assert.equal(merged.statements.find((s) => s.id === newId).text, '新しい説明です。');
  assert.equal(merged.statements.find((s) => s.id === t2.title).text, '書き直した症状');
  assert.equal(merged.statements.find((s) => s.id === t1.title).text, '共有フォルダが見えない');
});

test('Verifier にかけ直すのは、前回「正しい」でない文章と、変わった文章だけ', () => {
  const before = { statements: [{ id: 'STM-001', text: 'あ' }, { id: 'STM-002', text: 'い' }, { id: 'STM-003', text: 'う' }] };
  const verification = { results: [{ statement: 'STM-001', verdict: 'correct' }, { statement: 'STM-002', verdict: 'unsupported' }, { statement: 'STM-003', verdict: 'correct' }] };
  const after = { statements: [{ id: 'STM-001', text: 'あ' }, { id: 'STM-002', text: 'い' }, { id: 'STM-003', text: '変えた' }, { id: 'STM-004', text: '新しい' }] };
  const scope = verificationScope(before, verification, after);
  assert.deepEqual(scope, ['STM-002', 'STM-003', 'STM-004']);
  const merged = mergeVerification(verification, scope.map((statement) => ({ statement, verdict: 'correct' })), after, scope);
  assert.equal(summarizeVerification(merged, after).passed, true);
  assert.equal(merged.results.length, 4);
});

// ---- 退職する担当者 ----

test('退職する担当者を連絡先、転送先、相談先として書いた文を、文字列の照合で見つける', () => {
  for (const text of [
    '怪しいメールを開かずに、田中さんへ転送してもらってください。',
    'LAN ケーブルを抜いてください。Wi-Fi を切ってください。そのあと、田中さんと社長に連絡してください。',
    '感染が疑われるときは、社長のほかに田中さんにも連絡します。',
    '困ったら田中さんに相談してください。',
    '分からなければ田中に聞いてください。',
    '連絡先は田中さんです。',
    '田中さんが相談先です。',
    '田中さんまでお問い合わせください。報告も同じです。'.replace('お問い合わせください。報告も同じです。', '問い合わせてください。'),
    'スキャンは田中さんのアドレスへ送ってください。'.replace('田中さんのアドレスへ', '田中さんへ'),
  ]) assert.equal(namesRetireeAsContact(text, '田中'), true, text);
  for (const text of [
    'Microsoft 365 の管理者は田中さんだけです。',
    '管理者は田中さんと社長です。',
    '田中さんの PC は事務所にあります。',
    '田中さんが作った手順です。',
    '社長に連絡してください。',
    '記録がありません。社内で相談してください。',
  ]) assert.equal(namesRetireeAsContact(text, '田中'), false, text);
  // 名字と名前で登録されていても、名字で見つける
  assert.equal(namesRetireeAsContact('田中さんに連絡してください。', '田中 太郎'), true);
  assert.equal(namesRetireeAsContact('田中太郎さんに連絡してください。', '田中 太郎'), true);
  assert.equal(namesRetireeAsContact('田中さんに連絡してください。', '田中さん'), true);
  assert.equal(namesRetireeAsContact('田中さんに連絡してください。', ''), false);
});

test('照合に当たった文章は、AI が正しいと判定しても「危険」になり、合格しない', () => {
  const manual = { statements: [{ id: 'STM-001', text: '田中さんに連絡してください。' }, { id: 'STM-002', text: '社長に連絡してください。' }], contacts: [] };
  const verification = { results: [{ statement: 'STM-001', verdict: 'correct', reason: '', checked: [], conflicts_with: [] }, { statement: 'STM-002', verdict: 'correct', reason: '', checked: [], conflicts_with: [] }] };
  const { verification: checked, hits } = applyRetireeCheck(verification, manual, '田中');
  assert.equal(hits, 1);
  const result = summarizeVerification(checked, manual);
  assert.equal(result.passed, false);
  assert.equal(result.counts.dangerous, 1);
  assert.deepEqual(result.findings.map((f) => f.statement), ['STM-001']);
  assert.match(result.findings[0].reason, /文字列の照合/);
  assert.ok(!JSON.stringify(checked).includes('"statement":"STM-001","verdict":"correct"'));
});

test('連絡先の一覧に退職する担当者が載っていれば、役割の文章を指摘する', () => {
  const manual = { statements: [{ id: 'STM-001', text: '社内の相談先' }], contacts: [{ id: 'INH-01', name: '田中さん', role: 'STM-001' }] };
  assert.deepEqual(retireeFindings(manual, '田中').map((f) => f.statement), ['STM-001']);
});

test('通し：後任向けの文章に退職する担当者の名前があれば、Writer の段階で直してもらう', () =>
  withTemp(async (dir) => {
    const client = pipelineClient({ verdicts: ['correct', 'correct', 'correct'] });
    const realStream = client.messages.stream;
    let retried = 0;
    client.messages.stream = (params) => {
      const stream = realStream(params);
      if (!params.system.includes('Writer')) return stream;
      const task = taggedIn(params, 'task');
      assert.equal(task.retiree, '田中');
      const hasProblems = JSON.stringify(params.messages).includes('structure_problems');
      return {
        finalMessage: async () => {
          const message = await stream.finalMessage();
          const body = JSON.parse(message.content[0].text);
          if (task.part === 'page') {
            const reassurance = body.statements.find((s) => s.id === body.page.reassurance);
            if (hasProblems) {
              reassurance.text = 'データは消えません。';
              retried += 1;
            } else reassurance.text = '困ったら田中さんに相談してください。';
          }
          return { ...message, content: [{ type: 'text', text: JSON.stringify(body) }] };
        },
      };
    };
    const summary = await runPipeline({ set: 'okojo', setDir: SET, dir, client });
    assert.equal(summary.status, 'passed', summary.error);
    assert.equal(retried, 1);
    assert.equal(summary.rounds[0].retiree_hits, 0);
    const final = JSON.parse(readFileSync(join(dir, 'manual-final.json'), 'utf8'));
    assert.ok(!final.statements.some((s) => s.text.includes('田中')));
    // Verifier にも退職する担当者を渡す
    const verifier = client.sent.find((p) => p.system.includes('Verifier'));
    assert.ok(JSON.stringify(verifier.messages).includes('<retiree>'));
  }));

// ---- 載せ漏れの検査と、退職前にやること ----
const leakSources = (answer, items = []) => ({ survey: { items }, transcript: { entries: [{ id: 'INT-001', status: 'answered', answer }] } });
const manualWith = (...texts) => ({ statements: texts.map((text, i) => ({ id: `STM-${i + 1}`, text, evidence: ['INT-001'] })) });

test('載せ漏れ：答えのあるパスワードの置き場所と機器の置き場所が、どの文章にもなければ見つける', () => {
  const sources = leakSources('管理者のパスワードの控えは総務の鍵つき棚にあります。ルーターは倉庫の奥の棚の上にあります。');
  const leaks = coverageLeaks(manualWith('関係のない文章です。'), sources);
  assert.deepEqual(leaks.map((leak) => leak.kind), ['credential_location', 'device_location']);
  assert.deepEqual(coverageLeaks(manualWith('控えは総務の鍵つき棚にあります。', 'ルーターの場所は 倉庫の奥の棚の上 です。'), sources), []);
});

test('載せ漏れ：ソフトを入れた話や掲示の話は、機器の置き場所として数えない', () => {
  const sources = leakSources('業務ソフトは2台の PC に入れていて、問い合わせ先は販売店です。ルールは注意書きにして各部署に貼ってあります。');
  assert.deepEqual(coverageLeaks(manualWith('関係のない文章です。'), sources), []);
  // 認証情報の文では、同じ言い方も置き場所として数える
  assert.equal(coverageLeaks(manualWith('関係のない文章です。'), leakSources('パスワードを書いたメモは総務の棚に入れてあります。')).length, 1);
});

test('載せ漏れの書き直しで、前の版の文章や機器が消えていれば止める', () => {
  const previous = pieces().common;
  assert.deepEqual(droppedFromCommon(previous, previous), []);
  const shrunk = { ...previous, statements: previous.statements.slice(1) };
  assert.match(droppedFromCommon(previous, shrunk).join(), /前の版の文章を消さないでください/);
  const before = { ...previous, devices: [{ id: 'D1' }] };
  assert.match(droppedFromCommon(before, previous).join(), /前の版の devices を消さないでください：D1/);
});

test('載せ漏れ：「分からない」の回答は対象にしない', () => {
  const sources = { survey: { items: [] }, transcript: { entries: [{ id: 'INT-001', status: 'later', answer: 'パスワードの控えは金庫にあります。' }] } };
  assert.deepEqual(coverageLeaks(manualWith('文章です。'), sources), []);
});

test('載せ漏れ：大型更新を保留している PC があるのに載っていなければ見つける。保留がなければ見つけない', () => {
  const item = (value) => ({ id: 'INV-001', host: 'PC-1', key: 'security.feature_update', value, status: 'ok' });
  const held = leakSources('回答です。', [item('大型更新は保留に設定')]);
  assert.deepEqual(coverageLeaks(manualWith('文章です。'), held).map((leak) => leak.kind), ['feature_update']);
  assert.deepEqual(coverageLeaks(manualWith('この PC は大型更新を進めないでください。'), held), []);
  assert.deepEqual(coverageLeaks(manualWith('文章です。'), leakSources('回答です。', [item('大型更新の保留の設定なし')])), []);
});

test('通し：載せ漏れが直らなければ止める', () =>
  withTemp(async (dir) => {
    const client = pipelineClient({ verdicts: ['correct'] });
    const realStream = client.messages.stream;
    client.messages.stream = (params) => {
      const stream = realStream(params);
      if (!params.system.includes('Writer') || !taggedIn(params, 'task').revision?.missing) return stream;
      return {
        finalMessage: async () => {
          const message = await stream.finalMessage();
          return { ...message, content: [{ type: 'text', text: JSON.stringify(taggedIn(params, 'task').revision.previous) }] };
        },
      };
    };
    const summary = await runPipeline({ set: 'okojo', setDir: SET, dir, client });
    assert.equal(summary.status, 'error');
    assert.match(summary.error, /載せ漏れが残っています/);
    assert.ok(!existsSync(join(dir, 'manual.html')));
  }));

test('退職前にやることは後任向けの HTML に出さず、根拠のない項目と認証情報は止める', () => {
  const manual = fixture();
  manual.before_leaving = [{ text: '管理者の権限を社長に移してください。', evidence: ['INT-018'] }];
  assert.deepEqual(validate(JSON.parse(readFileSync(join(ROOT, 'plugin/schemas/manual.schema.json'), 'utf8')), manual), []);
  assert.ok(!renderManual(withReplies(manual)).includes('管理者の権限を社長に移して'));
  const common = (before) => ({ ...pieces().common, before_leaving: before });
  const unknown = input.transcript.entries.find((entry) => entry.status !== 'answered');
  assert.deepEqual(checkCommon(common([{ text: '移してください。', evidence: ['INT-018'] }]), sources).problems, []);
  assert.match(checkCommon(common([{ text: '移してください。', evidence: [unknown.id] }]), sources).problems.join(), /回答のある聞き取り/);
  assert.match(checkCommon(common([{ text: 'パスワードは abcd1234 です', evidence: ['INT-018'] }]), sources).problems.join(), /認証情報/);
});

test('Editor は後任向けの文章と用語の説明に、退職する担当者の名前を入れられない', () => {
  const manual = fixture();
  const id = manual.statements[0].id;
  const before = manual.statements[0].text;
  const { manual: edited, changes } = applyEdits(manual, { rewrites: [{ id, text: '田中さんの手順です。' }], glossary: [{ term: '新しい語', one_line: '一言です。', analogy: 'たとえです。', help_page: '', company: '田中さんが管理しています。', evidence: ['INT-018'] }] }, { retiree: '田中' });
  assert.equal(edited.statements[0].text, before);
  assert.deepEqual(changes, [{ statement: id, missing: ['退職する担当者の名前'] }]);
  assert.ok(!edited.glossary.some((g) => g.term === '新しい語'));
});

test('番号の記録がない業者へ案内するページには、番号の調べ方の部品が要る', () => {
  const page = withSteps([step('STM-001', 'LIB-001')]);
  page.contacts[0].phone = '';
  assert.match(problemsOf(page), /LIB-030/);
  const fixed = withSteps([step('STM-001', 'LIB-030'), step('STM-002', 'LIB-001')]);
  fixed.contacts[0].phone = '';
  assert.doesNotMatch(problemsOf(fixed), /LIB-030/);
});

test('承認した部品が、決まった文面で入っている', () => {
  const texts = new Map(library.procedures.map((part) => [part.id, part.text]));
  assert.equal(texts.get('LIB-024'), 'コピーするフォルダーを1回押して選び、Ctrl キーを押しながら C のキーを押してください。');
  assert.equal(texts.get('LIB-025'), 'コピー先のフォルダーを開いて、Ctrl キーを押しながら V のキーを押してください。');
  assert.equal(texts.get('LIB-026'), 'フォルダーを右クリックして、「プロパティ」を選んでください。「内容」の欄に、ファイルの数が出ます。');
  assert.equal(texts.get('LIB-027'), '「Wi-Fi」のボタンを押して、色のない状態にしてください。');
  assert.equal(texts.get('LIB-028'), '画面の右下にある、雲のマークを押してください。見つからないときは、「^」を押すと出てきます。');
  assert.equal(texts.get('LIB-029'), '右上の歯車を押して、「同期の再開」を押してください。');
  assert.equal(texts.get('LIB-030'), '請求書や契約書で、電話番号を確かめてください。');
});

test('電話番号の記録がない業者は載せて、記録がないと表示する', () => {
  const manual = fixture();
  manual.contacts[0].phone = '';
  const html = renderManual(withReplies(manual));
  assert.ok(html.includes('電話番号の記録がありません'));
  assert.ok(!/href="tel:"/.test(html));
});

test('機器のパスワードの置き場所と、やってはいけないことを表示する', () => {
  const manual = JSON.parse(readFileSync(join(ROOT, 'test/fixtures/manual-full.json'), 'utf8'));
  const last = Math.max(...manual.statements.map((s) => Number(s.id.slice(4))));
  const [a, b] = [`STM-${last + 1}`, `STM-${last + 2}`];
  manual.statements.push({ id: a, text: '控えは書庫にあります。', evidence: ['INT-001'] }, { id: b, text: '大型更新を進めないでください。', evidence: ['INT-001'] });
  manual.devices[0].credential_location = a;
  manual.devices[0].caution = b;
  const html = renderManual(manual);
  for (const word of ['パスワードの保管場所', '控えは書庫にあります', 'やってはいけないこと']) assert.ok(html.includes(word), word);
});

test('/hikitsugi:start：退職する担当者を連絡先にした文章は、照合で差し戻す', () =>
  withTemp(async (dir) => {
    const work = join(dir, 'work');
    const hikitsugi = (command, args = [], stdin = '') => run(command, args, { work, stdin });
    const write = (name, value) => writeFileSync(join(work, name), JSON.stringify(value));
    const surveyPath = join(dir, 'survey.json');
    writeFileSync(surveyPath, JSON.stringify(input.survey));
    hikitsugi('init', [surveyPath, '田中', '会社']);
    const manual = fixture();
    manual.statements.find((s) => s.id === manual.symptom_pages[0].reassurance).text = '困ったら田中さんに相談してください。';
    write('state.json', { company: 'okojo', company_name: '会社', retiree: '田中', round: 1, interview_done: true, passed: false });
    write('gaps.json', { schema_version: 1, company: 'okojo', coverage: [], gaps: [] });
    write('manual-1.json', manual);
    write('edited-1.json', manual);
    write('verification-1.json', { results: manual.statements.map((s) => ({ statement: s.id, verdict: 'correct', reason: '', checked: [], conflicts_with: [] })) });
    assert.match(hikitsugi('check-verification', ['1']), /危険 1 件/);
    assert.deepEqual(JSON.parse(readFileSync(join(work, 'state.json'), 'utf8')).todo, ['T1']);
    hikitsugi('writer-task', ['2', 'T1']);
    assert.equal(JSON.parse(readFileSync(join(work, 'writer-task.json'), 'utf8')).retiree, '田中');
  }));

test('確認の印は、確認した人と日付を取扱説明書に付ける', () => {
  const reviewed = markReviewed(fixture(), '田中', '2026-11-06');
  assert.deepEqual(reviewed.review, { reviewer: '田中', confirmed_on: '2026-11-06' });
  assert.deepEqual(validate(JSON.parse(readFileSync(join(ROOT, 'plugin/schemas/manual.schema.json'), 'utf8')), reviewed), []);
});

test('Writer の形の問題は部分ごとに1回だけ伝えて直してもらい、直らなければ失敗にする', async () => {
  const bad = pieces().page;
  bad.statements.find((s) => s.id === bad.page.steps[0]).text = 'NAS は事務所にあります。';
  const clientOf = (pageReplies) => {
    const sent = [];
    let pageCalls = 0;
    return {
      sent,
      messages: {
        countTokens: async () => ({ input_tokens: 1 }),
        stream: (params) => {
          sent.push(params);
          const task = taggedIn(params, 'task');
          const reply = task.part === 'symptoms' ? excludeAll(task) : task.revision?.missing ? fillMissing(task.revision.previous, task.revision.missing) : task.part === 'common' ? pieces().common : pageReplies[pageCalls++];
          return { finalMessage: async () => ({ id: 'msg', model: params.model, stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: JSON.stringify(reply) }] }) };
        },
      },
    };
  };
  const args = { survey: input.survey, transcript: input.transcript, companyName: 'オコジョ精工' };
  const fixed = clientOf([bad, pieces().page]);
  const result = await runWriterLive({ ...args, client: fixed });
  // 共通部分は書き直さない（最後の2回は載せ漏れの書き直しと、手順ページのない困りごとの判断）
  assert.equal(fixed.sent.length, 5);
  assert.ok(JSON.stringify(fixed.sent[2].messages).includes('structure_problems'));
  assert.equal(result.company_name, 'オコジョ精工');
  const stuck = clientOf([bad, bad]);
  await assert.rejects(runWriterLive({ ...args, client: stuck }), /1つの操作ではありません/);
  assert.equal(stuck.sent.length, 3);
});

test('Writer は書き終えた部分を保存し、再開するとその部分を呼び直さない', async () => {
  const saved = new Map();
  const store = { get: (name) => saved.get(name), set: (name, value) => saved.set(name, value) };
  const sent = [];
  const client = {
    messages: {
      stream: (params) => {
        sent.push(params);
        const task = taggedIn(params, 'task');
        const reply = task.part === 'symptoms' ? excludeAll(task) : task.revision?.missing ? fillMissing(task.revision.previous, task.revision.missing) : task.part === 'common' ? pieces().common : pieces().page;
        return { finalMessage: async () => ({ id: 'msg', model: params.model, stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: JSON.stringify(reply) }] }) };
      },
    },
  };
  const args = { survey: input.survey, transcript: input.transcript, companyName: 'オコジョ精工', client, store };
  await runWriterLive(args);
  assert.deepEqual([...saved.keys()].sort(), ['T1', 'common', 'common-leaks', 'symptoms']);
  assert.equal(sent.length, 4);
  await runWriterLive(args);
  assert.equal(sent.length, 4);
});

test('Writer の前置きはキャッシュし、調査データと聞き取りを部分ごとに送り直さない', () => {
  const request = buildWriterRequest({ survey: input.survey, transcript: input.transcript, task: { part: 'common' } });
  const [stable, dynamic] = request.messages[0].content;
  assert.deepEqual(stable.cache_control, { type: 'ephemeral' });
  assert.ok(stable.text.includes('<survey>') && stable.text.includes('<transcript>') && stable.text.includes('<library>'));
  assert.ok(dynamic.text.includes('<task>'));
  assert.ok(!dynamic.text.includes('<survey>'));
});

test('Editor は会社の情報の表の文章を変えられない', () => {
  const manual = fixture();
  const id = manual.symptom_pages[0].steps[4];
  const before = manual.statements.find((s) => s.id === id).text;
  manual.symptom_pages[0].steps = manual.symptom_pages[0].steps.filter((step) => step !== id);
  manual.symptom_pages[0].info_rows = [id];
  const { manual: edited, changes } = applyEdits(manual, { rewrites: [{ id, text: '言い換えた文です。' }], glossary: [] });
  assert.equal(edited.statements.find((s) => s.id === id).text, before);
  assert.deepEqual(changes, [{ statement: id, missing: ['表の文章'] }]);
});

test('Editor は手順を2文に分けられない', () => {
  const manual = fixture();
  const id = manual.symptom_pages[0].steps[0];
  const before = manual.statements.find((s) => s.id === id).text;
  const { manual: edited, changes } = applyEdits(manual, { rewrites: [{ id, text: '事務所に PC があります。その PC の電源を確かめてください。' }], glossary: [] });
  assert.equal(edited.statements.find((s) => s.id === id).text, before);
  assert.deepEqual(changes, [{ statement: id, missing: ['手順の形'] }]);
});

test('部品の順番が決まった順と逆なら見つける', () => {
  const statements = [step('STM-001', 'LIB-002'), step('STM-002', 'LIB-001')];
  assert.match(problemsOf(withSteps(statements)), /順番/);
  assert.doesNotMatch(problemsOf(withSteps(statements, ['STM-002', 'STM-001'])), /順番/);
});

test('Editor は部品の文面を変えられない', () => {
  const { manual } = composeProcedures(withSteps([step('STM-001', 'LIB-001')]), sources);
  for (const revert of [true, false]) {
    const { manual: edited, changes } = applyEdits(manual, { rewrites: [{ id: 'STM-001', text: '書き換えました。' }], glossary: [] }, { revert });
    assert.equal(edited.statements[0].text, library.procedures[0].text);
    assert.equal(changes.length, 1);
  }
});

test('未承認の部品があれば取扱説明書を作らず、承認済みなら作れる', () => {
  const { manual: complete } = composeProcedures(withSteps([step('STM-001', 'LIB-001')]), sources);
  const unapproved = { ...library, procedures: library.procedures.map((part) => (part.id === 'LIB-001' ? { ...part, status: 'unapproved', reviewed_by: null, reviewed_on: null } : part)) };
  assert.deepEqual(unapprovedParts(complete, unapproved), ['LIB-001']);
  assert.throws(() => prepareForRender(complete, unapproved), UnapprovedPartsError);
  assert.deepEqual(unapprovedParts(complete, library), []);
  assert.ok(prepareForRender(complete, library).manual);
  // 存在しない部品も承認されていないものとして止める
  assert.deepEqual(unapprovedParts({ statements: [{ id: 'STM-001', text: 'x', evidence: ['LIB-999'] }] }, library), ['LIB-999']);
});

test('部品を使った手順は、表示で「確認済みの標準手順」と示す', () => {
  const manual = fixture();
  manual.statements.find((s) => s.id === manual.symptom_pages[0].steps[0]).evidence.push('LIB-001');
  assert.ok(renderManual(withReplies(manual)).includes('確認済みの標準手順'));
});

test('Writer と Verifier に部品を渡し、承認の状態は渡さない', () => {
  for (const request of [buildWriterRequest({ survey: input.survey, transcript: input.transcript }), buildVerifierRequest(input)]) {
    const body = JSON.stringify(request.messages);
    assert.ok(body.includes('LIB-001'));
    assert.ok(!body.includes('reviewed_by') && !body.includes('"status\\":\\"approved'));
  }
  assert.ok(!JSON.stringify(libraryForAgents()).includes('approved'));
});

test('採点器は部品を根拠として認め、存在しない部品は不備として数える', () => {
  const manual = fixture();
  manual.statements[0].evidence = ['LIB-001'];
  assert.deepEqual(manualScorer.summarize(manualScorer.score(manual, null, input)).bad_evidence, []);
  manual.statements[0].evidence = ['LIB-999'];
  const summary = manualScorer.summarize(manualScorer.score(manual, null, input));
  assert.deepEqual(summary.bad_evidence, [manual.statements[0].id]);
  assert.deepEqual(summary.unapproved_parts, ['LIB-999']);
});

test('置き場所に部屋らしい語がない機器を警告し、記録がないと書いた機器は除く', () => {
  const statements = [
    { id: 'STM-001', text: '機器A' }, { id: 'STM-002', text: '棚の上にあります。' },
    { id: 'STM-003', text: '機器B' }, { id: 'STM-004', text: '総務室の棚の上にあります。' },
    { id: 'STM-005', text: '機器C' }, { id: 'STM-006', text: '置き場所の記録がありません。' },
  ];
  const devices = [['STM-001', 'STM-002'], ['STM-003', 'STM-004'], ['STM-005', 'STM-006']].map(([name, location]) => ({ name, location }));
  assert.deepEqual(locationWarnings({ statements, devices }), [{ device: '機器A', place: '棚の上にあります。' }]);
});

test('Interviewer は、部屋の名前と目印で置き場所を聞き、部屋の名前がなければ1回だけ聞き直す', () => {
  const prompt = readFileSync(join(ROOT, 'plugin/agents/interviewer.md'), 'utf8');
  assert.match(prompt, /部屋の名前＋部屋の中の目印/);
  assert.match(prompt, /部屋の名前だけを1回だけ聞き直します/);
});

test('保留の会社の構造の検査は、件数だけを返し、文章も点数も返さない', () =>
  withTemp((dir) => {
    const manual = withReplies(JSON.parse(readFileSync(join(ROOT, 'test/fixtures/manual-full.json'), 'utf8')));
    const secretWord = '中身に入っている文';
    manual.statements[0].text = `${manual.statements[0].text}${secretWord}`;
    writeFileSync(join(dir, 'manual-final.json'), JSON.stringify(manual));
    writeFileSync(join(dir, 'summary.json'), JSON.stringify({ status: 'passed', rounds: [{ counts: { correct: 9 } }], stages: { interview: { covered: 30 } } }));
    writeFileSync(join(dir, 'manual.html'), '<!doctype html><p>本文</p>');
    const report = structureCounts(dir);
    assert.equal(report.status, 'passed');
    assert.equal(report.checks.replies.problems, 0);
    assert.equal(report.checks.search_index.error, false);
    const text = JSON.stringify(report);
    assert.ok(!text.includes(secretWord));
    assert.ok(!text.includes('covered') && !text.includes('correct'));
  }));

test('/hikitsugi:start：手順ページのない困りごとを Writer に聞き、ページを足すか理由を残して外す', () =>
  withTemp(async (dir) => {
    const work = join(dir, 'work');
    const hikitsugi = (command, args = [], stdin = '') => run(command, args, { work, stdin });
    const write = (name, value) => writeFileSync(join(work, name), JSON.stringify(value));
    const read = (name) => JSON.parse(readFileSync(join(work, name), 'utf8'));
    const surveyPath = join(dir, 'survey.json');
    writeFileSync(surveyPath, JSON.stringify(input.survey));
    hikitsugi('init', [surveyPath, '田中', 'テスト', '会社']);
    const coverage = gold.gaps.items.map((item) => ({ item: item.item, state: item.state, evidence: item.evidence }));
    write('gaps.json', { coverage, gaps: [{ id: 'GAP-001', items: gold.gaps.items.filter((i) => i.state !== 'filled').map((i) => i.item), why: '理由', priority: 'high', question_hint: 'ヒント' }] });
    hikitsugi('check-gaps');
    write('next.json', { action: 'ask', gap: 'GAP-001', covers: ['CHK-37'], question: 'よくある問い合わせを教えてください', unfilled: [] });
    hikitsugi('check-next');
    hikitsugi('record', ['answered'], '保守はカワウソシステムサービスで、連絡先は 03-0000-0102 です。ディスクの交換はカワウソシステムサービスに頼みます。ルーターの故障はカワウソシステムサービスに電話します。');
    write('gaps.json', { schema_version: 1, company: input.survey.company, coverage, gaps: [{ id: 'GAP-001', items: ['CHK-37'], why: '理由', priority: 'high', question_hint: 'ヒント' }] });
    write('next.json', { action: 'finish', gap: '', covers: [], question: '', unfilled: [] });
    hikitsugi('check-next');

    write('writer-1-common.json', pieces().common);
    hikitsugi('check-writer', ['1', 'common']);
    write('writer-1-T1.json', pieces().page);
    hikitsugi('check-writer', ['1', 'T1']);
    hikitsugi('writer-task', ['1', 'common']);
    const leakTask = read('writer-task.json');
    write('writer-1-common.json', fillMissing(leakTask.revision.previous, leakTask.revision.missing));
    assert.match(hikitsugi('check-writer', ['1', 'common']), /困りごとが 2 件あります/);

    assert.deepEqual(nextStep(work), { step: 'writer', round: 1, part: 'symptoms' });
    hikitsugi('writer-task', ['1', 'symptoms']);
    const task = read('writer-task.json');
    assert.deepEqual(task.gaps.map((gap) => gap.detail), ['ディスクの交換はカワウソシステムサービスに頼みます', 'ルーターの故障はカワウソシステムサービスに電話します']);
    assert.equal(task.pages[0].id, 'T1');
    assert.ok(read('writer-format.json').properties.decisions);

    // 理由のない除外は受け付けない
    write('writer-1-symptoms.json', { decisions: task.gaps.map(({ id }) => ({ gap: id, decision: 'exclude', reason: '', category: 'other', symptom: '' })) });
    assert.throws(() => hikitsugi('check-writer', ['1', 'symptoms']), /外す理由/);
    assert.equal(nextStep(work).part, 'symptoms');

    write('writer-1-symptoms.json', { decisions: [
      { gap: 'SYM-1', decision: 'page', reason: '', category: 'other', symptom: 'NAS のディスクが壊れた' },
      { gap: 'SYM-2', decision: 'exclude', reason: 'T1 と同じ窓口で足ります', category: 'other', symptom: '' },
    ] });
    assert.match(hikitsugi('check-writer', ['1', 'symptoms']), /ページにする 1 件、外す 1 件.*T2/);

    // 共通部分は足すだけ。行はプログラムが入れる
    assert.deepEqual(nextStep(work), { step: 'writer', round: 1, part: 'common' });
    hikitsugi('writer-task', ['1', 'common']);
    const commonTask = read('writer-task.json');
    assert.deepEqual(commonTask.revision.add_symptoms, [{ id: 'T2', category: 'other', symptom: 'NAS のディスクが壊れた' }]);
    const { previous } = commonTask.revision;
    write('writer-1-common.json', { ...previous, statements: previous.statements.slice(1) });
    assert.throws(() => hikitsugi('check-writer', ['1', 'common']), /消さないでください|参照/);
    write('writer-1-common.json', previous);
    hikitsugi('check-writer', ['1', 'common']);
    assert.deepEqual(read('writer-1-common.json').page_plan.map((entry) => entry.id), ['T1', 'T2']);

    // 新しいページだけを書く。挙がった答えを根拠にしないと通らない
    assert.deepEqual(nextStep(work), { step: 'writer', round: 1, part: 'T2' });
    hikitsugi('writer-task', ['1', 'T2']);
    const pageTask = read('writer-task.json');
    assert.deepEqual(pageTask.basis.sources, ['INT-001']);
    assert.match(pageTask.basis.detail, /ディスクの交換/);
    const page = pieces().page;
    write('writer-1-T2.json', page);
    assert.throws(() => hikitsugi('check-writer', ['1', 'T2']), /根拠に INT-001/);
    page.statements[0].evidence = [...page.statements[0].evidence, 'INT-001'];
    write('writer-1-T2.json', page);
    assert.match(hikitsugi('check-writer', ['1', 'T2']), /書きました/);

    const manual = read('manual-1.json');
    assert.deepEqual(manual.symptom_pages.map((entry) => entry.id), ['T1', 'T2']);
    assert.deepEqual(manual.symptom_exclusions, [{ source: 'INT-001', detail: 'ルーターの故障はカワウソシステムサービスに電話します', reason: 'T1 と同じ窓口で足ります', pages: ['T1'] }]);
    assert.equal(nextStep(work).step, 'editor');
    // 後任向けの文章には出ない
    assert.ok(!manual.statements.some((statement) => statement.text.includes('同じ窓口で足ります')));
  }));

test('評価の Writer：手順ページのない困りごとからページを足し、外す理由を残す', async () => {
  const transcript = { ...input.transcript, entries: [...input.transcript.entries, { id: 'INT-099', gap: 'GAP-001', covers: ['CHK-37'], question: '質問', answer: 'ソフトの入れ替えはカワウソシステムサービスに頼みます。', status: 'answered', answered_at: '2026-11-04T00:00:00Z' }] };
  const reported = [];
  const sent = [];
  const client = {
    messages: {
      stream: (params) => {
        sent.push(params);
        const task = taggedIn(params, 'task');
        const newPage = () => {
          const page = pieces().page;
          page.statements[0].evidence = [...page.statements[0].evidence, ...task.basis.sources];
          return page;
        };
        const decide = ({ id, detail }) => (detail.includes('入れ替え')
          ? { gap: id, decision: 'page', reason: '', category: 'other', symptom: 'ソフトの入れ替えが要る' }
          : { gap: id, decision: 'exclude', reason: '困りごとではありません', category: 'other', symptom: '' });
        const reply = task.part === 'symptoms' ? { decisions: task.gaps.map(decide) }
          : task.revision?.add_symptoms ? task.revision.previous
          : task.revision?.missing ? fillMissing(task.revision.previous, task.revision.missing)
          : task.part === 'common' ? pieces().common
          : task.basis ? newPage() : pieces().page;
        return { finalMessage: async () => ({ id: 'msg', model: params.model, stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: JSON.stringify(reply) }] }) };
      },
    },
  };
  const manual = await runWriterLive({ survey: input.survey, transcript, companyName: 'オコジョ精工', client, onSymptoms: (found) => reported.push(found) });
  assert.deepEqual(manual.symptom_pages.map((page) => page.id), ['T1', 'T2']);
  assert.ok(reported[0].found >= 1);
  assert.deepEqual(reported[0].pages, [{ id: 'T2', symptom: 'ソフトの入れ替えが要る' }]);
  assert.equal(manual.symptom_exclusions?.length ?? 0, reported[0].excluded);
  const parts = sent.map((params) => taggedIn(params, 'task').part);
  assert.equal(parts.filter((part) => part === 'symptoms').length, 1);
  // 判断の出力の形を API に渡している
  const decide = sent.find((params) => taggedIn(params, 'task').part === 'symptoms');
  assert.match(JSON.stringify(decide.output_config ?? decide), /decisions/);
});

test('定期作業の手順に、会社の情報の表を指す部品は使えない', () => {
  const { common } = pieces();
  const part = JSON.parse(readFileSync(join(ROOT, 'plugin/library/procedures.json'), 'utf8')).procedures.find((candidate) => candidate.needs_table);
  const broken = JSON.parse(JSON.stringify(common));
  broken.statements.push({ id: 'STM-900', text: '', evidence: [], library: part.id }, { id: 'STM-901', text: '毎月の確認', evidence: ['INT-001'], library: null });
  broken.routines.push({ id: 'R90', frequency: 'monthly', title: 'STM-901', steps: ['STM-900'] });
  assert.match(checkCommon(broken, { survey: input.survey, transcript: input.transcript }).problems.join('\n'), /会社の情報の表を指す部品は使えません/);
  assert.doesNotMatch(checkCommon(common, { survey: input.survey, transcript: input.transcript }).problems.join('\n'), /会社の情報の表を指す部品/);
});
