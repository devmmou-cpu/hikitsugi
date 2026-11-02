// 通しの流れのテスト。偽のクライアントを使い、API は呼ばない。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAnswers, loadInput } from '../eval/lib/load-set.mjs';
import { runPipeline } from '../eval/pipeline.mjs';
import { applyEdits, missingTokens } from '../plugin/lib/apply-edits.mjs';
import { buildRevision, prepareForRender, summarizeVerification } from '../plugin/lib/handover.mjs';
import { longSentences, plainProblems } from '../plugin/lib/plain-check.mjs';
import { renderManual } from '../plugin/renderer/render.mjs';
import { nextStep, run } from '../plugin/scripts/hikitsugi.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SET = join(ROOT, 'eval/sets/okojo');
const input = loadInput(SET);
const gold = loadAnswers(SET);
const fixture = () => JSON.parse(readFileSync(join(ROOT, 'test/fixtures/manual-t1.json'), 'utf8'));

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
    glossary: [{ term: '新しい語', text: '説明です。', evidence: ['INT-001'] }, { term: manual.glossary[0].term, text: '重複', evidence: ['INT-001'] }],
  });
  assert.equal(edited.glossary.length, manual.glossary.length + 1);
  assert.equal(edited.statements.at(-1).id, `STM-${String(last + 1).padStart(3, '0')}`);
  assert.throws(() => applyEdits(manual, { rewrites: [{ id: 'STM-999', text: 'x' }], glossary: [] }), /存在しない文章/);
});

test('長い文と説明のない語を見つける', () => {
  assert.equal(longSentences('あ'.repeat(51) + '。').length, 1);
  assert.equal(longSentences('あ'.repeat(49) + '。').length, 0);
  const manual = { statements: [{ id: 'STM-001', text: 'NAS と UTM を確認します。' }], glossary: [{ term: 'NAS', explanation: 'STM-002' }] };
  assert.deepEqual(plainProblems(manual).unexplained_terms, ['UTM']);
});

// ---- 表示プログラムへの受け渡し ----

test('表示できない項目は外し、件数を返す。参照されなくなった文章も外す。表示プログラムが受け取れる', () => {
  const manual = fixture();
  manual.statements.push({ id: 'STM-900', text: '定期作業です。', evidence: ['INT-001'] });
  manual.routines = [{ id: 'R1', frequency: 'weekly', title: 'STM-900', steps: [] }];
  assert.throws(() => renderManual(manual), /routines/);
  const { manual: prepared, omitted } = prepareForRender(manual);
  assert.equal(omitted.routines, 1);
  assert.equal(omitted.statements, 1);
  assert.ok(!prepared.statements.some((s) => s.id === 'STM-900'));
  assert.ok(renderManual(prepared).includes('<html'));
});

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
  const explanation = manual.glossary[0].explanation;
  const kept = manual.statements.find((s) => s.id !== explanation && !manual.glossary.some((g) => g.explanation === s.id)).id;
  const revision = buildRevision(manual, [{ statement: kept, verdict: 'unsupported' }, { statement: explanation, verdict: 'unsupported' }]);
  assert.deepEqual(revision.previous_manual.glossary, []);
  assert.ok(!revision.previous_manual.statements.some((s) => s.id === explanation));
  assert.ok(revision.previous_manual.statements.some((s) => s.id === kept));
  assert.deepEqual(revision.findings.map((f) => f.statement), [kept]);
});

// ---- 通しの評価 ----

const USAGE = { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

/** 各エージェントを、プロンプトの先頭の名前で見分けて応答する偽のクライアント。 */
function pipelineClient({ verdicts }) {
  const sent = [];
  let verifierCalls = 0;
  const manualBody = () => {
    const { schema_version, company, company_name, as_of, ...body } = fixture();
    return body;
  };
  const reply = (params) => {
    const system = params.system;
    if (system.includes('Gap Finder')) {
      return {
        coverage: gold.gaps.items.map((item) => ({ item: item.item, state: item.state, evidence: item.evidence })),
        gaps: [{ id: 'GAP-001', items: gold.gaps.items.filter((i) => i.state !== 'filled').map((i) => i.item), why: '理由', priority: 'high', question_hint: 'ヒント' }],
      };
    }
    if (system.includes('Interviewer')) {
      const asked = params.messages[0].content[1].text.includes('ここまでに 0 問');
      return asked ? { action: 'ask', gap: 'GAP-001', covers: ['CHK-01'], question: '質問' } : { action: 'finish', gap: '', covers: [], question: '' };
    }
    if (system.includes('模擬の担当者')) return { fact_ids: ['F-01'] };
    if (system.includes('Writer')) return manualBody();
    if (system.includes('Plain-Japanese Editor')) return { rewrites: [], glossary: [] };
    if (system.includes('Verifier')) {
      const verdict = verdicts[verifierCalls] ?? 'correct';
      verifierCalls += 1;
      return { results: fixture().statements.map((s) => ({ statement: s.id, verdict, reason: '', checked: [], conflicts_with: [] })) };
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
    assert.ok(summary.agents.verifier.calls === 1 && summary.agents.writer.calls === 1);
    assert.ok(summary.cost_usd > 0);
  }));

test('通し：不合格なら指摘を Writer に渡して差し戻す', () =>
  withTemp(async (dir) => {
    const client = pipelineClient({ verdicts: ['unsupported', 'correct'] });
    const summary = await runPipeline({ set: 'okojo', setDir: SET, dir, client });
    assert.equal(summary.status, 'passed', summary.error);
    assert.equal(summary.resends, 1);
    const writers = client.sent.filter((p) => p.system.includes('Writer'));
    assert.equal(writers.length, 2);
    assert.ok(!JSON.stringify(writers[0].messages).includes('<revision>'));
    assert.ok(JSON.stringify(writers[1].messages).includes('<revision>'));
  }));

test('通し：差し戻しは最大2回で、合格しなければ HTML を作らない', () =>
  withTemp(async (dir) => {
    const client = pipelineClient({ verdicts: ['dangerous', 'dangerous', 'dangerous', 'dangerous'] });
    const summary = await runPipeline({ set: 'okojo', setDir: SET, dir, client });
    assert.equal(summary.status, 'not_passed');
    assert.equal(client.sent.filter((p) => p.system.includes('Writer')).length, 3);
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

// ---- /hikitsugi の進行 ----

const manualBody = () => {
  const { schema_version, company, company_name, as_of, ...body } = fixture();
  return body;
};

test('/hikitsugi：段階をたどって取扱説明書まで進み、途中から再開できる', () =>
  withTemp(async (dir) => {
    const work = join(dir, 'work');
    const hikitsugi = (command, args = [], stdin = '') => run(command, args, { work, stdin });
    const write = (name, value) => writeFileSync(join(work, name), JSON.stringify(value));
    const surveyPath = join(dir, 'survey.json');
    writeFileSync(surveyPath, JSON.stringify(input.survey));
    assert.equal(nextStep(work).step, 'init');

    hikitsugi('init', [surveyPath, 'テスト', '会社']);
    assert.equal(JSON.parse(readFileSync(join(work, 'state.json'), 'utf8')).company_name, 'テスト 会社');
    assert.equal(nextStep(work).step, 'gap-finder');

    const coverage = gold.gaps.items.map((item) => ({ item: item.item, state: item.state, evidence: item.evidence }));
    write('gaps.json', { coverage, gaps: [] });
    assert.throws(() => hikitsugi('check-gaps'), /漏れた必須項目/);
    const items = gold.gaps.items.filter((i) => i.state !== 'filled').map((i) => i.item);
    write('gaps.json', { coverage, gaps: [{ id: 'GAP-001', items, why: '理由', priority: 'high', question_hint: 'ヒント' }] });
    hikitsugi('check-gaps');
    assert.equal(nextStep(work).step, 'interview');

    write('next.json', { action: 'ask', gap: 'GAP-001', covers: ['CHK-01'], question: '契約先を教えてください' });
    assert.equal(hikitsugi('check-next'), '契約先を教えてください');
    assert.equal(nextStep(work).pending_question, true);
    assert.throws(() => hikitsugi('record', ['answered'], 'パスワードは abcd1234 です'), /保管場所/);
    hikitsugi('record', ['answered'], '回答です');
    assert.equal(nextStep(work).asked, 1);
    assert.equal(nextStep(work).pending_question, false);

    write('next.json', { action: 'ask', gap: 'GAP-001', covers: ['CHK-02'], question: '次の質問' });
    hikitsugi('record', ['unknown'], '');
    const transcript = JSON.parse(readFileSync(join(work, 'transcript.json'), 'utf8'));
    assert.equal(transcript.entries[1].status, 'unknown');
    assert.equal(transcript.entries[1].answer, '分かりません。');

    write('next.json', { action: 'finish', gap: '', covers: [], question: '' });
    assert.match(hikitsugi('check-next'), /終えました/);
    assert.deepEqual(nextStep(work), { step: 'writer', round: 1 });

    // サブエージェントが会社の情報を書いても、プログラムの値で上書きする
    write('manual-1.json', { ...manualBody(), company_name: '仮の名前', company: '仮', as_of: '2000-01-01', schema_version: 1 });
    hikitsugi('check-writer', ['1']);
    const written = JSON.parse(readFileSync(join(work, 'manual-1.json'), 'utf8'));
    assert.equal(written.company_name, 'テスト 会社');
    assert.equal(written.company, input.survey.company);
    assert.equal(written.as_of, input.survey.as_of);
    assert.equal(nextStep(work).step, 'editor');
    write('editor-1.json', { rewrites: [], glossary: [] });
    hikitsugi('merge-edits', ['1']);
    assert.equal(nextStep(work).step, 'verifier');

    assert.throws(() => hikitsugi('render'), /合格していない/);
    const results = (verdict) => ({ results: fixture().statements.map((s) => ({ statement: s.id, verdict, reason: '', checked: [], conflicts_with: [] })) });
    write('verification-1.json', results('unsupported'));
    assert.match(hikitsugi('check-verification', ['1']), /差し戻します/);
    assert.deepEqual(nextStep(work), { step: 'writer', round: 2 });
    assert.ok(existsSync(join(work, 'findings-1.json')));

    write('manual-2.json', manualBody());
    hikitsugi('check-writer', ['2']);
    write('editor-2.json', { rewrites: [], glossary: [] });
    hikitsugi('merge-edits', ['2']);
    write('verification-2.json', results('correct'));
    assert.match(hikitsugi('check-verification', ['2']), /合格/);
    assert.equal(nextStep(work).step, 'render');
    assert.match(hikitsugi('render'), /作りました/);
    assert.ok(readFileSync(join(work, 'manual.html'), 'utf8').includes('<html'));
    assert.equal(nextStep(work).step, 'done');
  }));

test('/hikitsugi：差し戻しの上限に達すると not_passed で止まる', () =>
  withTemp(async (dir) => {
    const work = join(dir, 'work');
    const hikitsugi = (command, args = [], stdin = '') => run(command, args, { work, stdin });
    const write = (name, value) => writeFileSync(join(work, name), JSON.stringify(value));
    const surveyPath = join(dir, 'survey.json');
    writeFileSync(surveyPath, JSON.stringify(input.survey));
    hikitsugi('init', [surveyPath, '会社']);
    write('gaps.json', { schema_version: 1, company: 'okojo', coverage: [], gaps: [] });
    write('state.json', { company: 'okojo', company_name: '会社', round: 3, interview_done: true, passed: false });
    write('manual-3.json', manualBody());
    hikitsugi('check-writer', ['3']);
    write('editor-3.json', { rewrites: [], glossary: [] });
    hikitsugi('merge-edits', ['3']);
    write('verification-3.json', { results: fixture().statements.map((s) => ({ statement: s.id, verdict: 'dangerous', reason: '', checked: [], conflicts_with: [] })) });
    assert.match(hikitsugi('check-verification', ['3']), /上限/);
    assert.equal(nextStep(work).step, 'not_passed');
    assert.throws(() => hikitsugi('render'), /合格していない/);
  }));

test('スキルとプラグインの定義がそろっている', () => {
  const skill = readFileSync(join(ROOT, 'plugin/skills/hikitsugi/SKILL.md'), 'utf8');
  for (const agent of ['gap-finder', 'interviewer', 'writer', 'plain-japanese-editor', 'verifier']) {
    assert.ok(skill.includes(`hikitsugi:${agent}`), agent);
    assert.ok(existsSync(join(ROOT, `plugin/agents/${agent}.md`)), agent);
  }
  assert.ok(skill.includes('AskUserQuestion'));
  assert.equal(JSON.parse(readFileSync(join(ROOT, 'plugin/.claude-plugin/plugin.json'), 'utf8')).name, 'hikitsugi');
  // 模擬の田中さんは評価専用なので、配布物に含めない
  assert.ok(!existsSync(join(ROOT, 'plugin/agents/mock-tanaka.md')));
});
