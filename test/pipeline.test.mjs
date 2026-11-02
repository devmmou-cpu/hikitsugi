// 通しの流れのテスト。偽のクライアントを使い、API は呼ばない。

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
import { buildRevision, carryForward, prepareForRender, summarizeVerification, UnapprovedPartsError } from '../plugin/lib/handover.mjs';
import { longSentences, plainProblems } from '../plugin/lib/plain-check.mjs';
import { composeProcedures, libraryForAgents, loadLibrary, unapprovedParts } from '../plugin/lib/procedures.mjs';
import { validate } from '../plugin/lib/validate.mjs';
import { parseDriveRow } from '../plugin/lib/page-check.mjs';
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

test('差し戻しでは合格済みの用語の説明を引き継ぎ、変わった文章だけを返す', () => {
  const previous = {
    statements: [
      { id: 'STM-001', text: '本文1', evidence: ['INT-001'] },
      { id: 'STM-002', text: '本文2', evidence: ['INT-001'] },
      { id: 'STM-003', text: '説明A', evidence: ['INT-001'] },
      { id: 'STM-004', text: '説明B', evidence: ['INT-001'] },
    ],
    glossary: [{ term: 'A', explanation: 'STM-003' }, { term: 'B', explanation: 'STM-004' }],
  };
  const written = {
    statements: [{ id: 'STM-001', text: '本文1', evidence: ['INT-001'] }, { id: 'STM-002', text: '直した本文2', evidence: ['INT-001'] }],
    glossary: [],
  };
  const { manual, changed } = carryForward(previous, [{ statement: 'STM-002' }, { statement: 'STM-004' }], written);
  assert.deepEqual(changed, ['STM-002']);
  // 指摘された説明 B だけが落ちる。文章は増えない
  assert.deepEqual(manual.glossary, [{ term: 'A', explanation: 'STM-003' }]);
  assert.deepEqual(manual.statements.map((s) => s.id), ['STM-001', 'STM-002', 'STM-003']);
});

test('Writer が説明と同じ ID を別の文章に使っていたら、説明の番号を振り直す', () => {
  const previous = { statements: [{ id: 'STM-001', text: '説明', evidence: ['INT-001'] }], glossary: [{ term: 'A', explanation: 'STM-001' }] };
  const written = { statements: [{ id: 'STM-001', text: '新しい本文', evidence: ['INT-001'] }], glossary: [] };
  const { manual } = carryForward(previous, [], written);
  assert.deepEqual(manual.glossary, [{ term: 'A', explanation: 'STM-002' }]);
  assert.equal(manual.statements.find((s) => s.id === 'STM-002').text, '説明');
});

test('部品を使った文章は、変わった文章として Editor に渡さない', () => {
  const previous = { statements: [{ id: 'STM-001', text: '前', evidence: ['LIB-001'], library: { id: 'LIB-001', values: [] } }], glossary: [] };
  const written = { statements: [{ id: 'STM-001', text: '後', evidence: ['LIB-001'], library: { id: 'LIB-001', values: [] } }], glossary: [] };
  assert.deepEqual(carryForward(previous, [], written).changed, []);
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
      const first = params.messages[0].content[1].text.includes('ここまでに 0 問');
      const items = gold.gaps.items.filter((i) => i.state !== 'filled').map((i) => i.item);
      return first ? { action: 'ask', gap: 'GAP-001', covers: items, question: '質問' } : { action: 'finish', gap: '', covers: [], question: '' };
    }
    if (system.includes('模擬の担当者')) return { fact_ids: ['F-01'] };
    if (system.includes('Writer')) return manualBody();
    if (system.includes('Plain-Japanese Editor')) return { rewrites: [], glossary: [] };
    if (system.includes('Verifier')) {
      const verdict = verdicts[verifierCalls] ?? 'correct';
      verifierCalls += 1;
      // 指摘は最初の文章だけにする。用語の説明は合格のまま残る
      return { results: fixture().statements.map((s, i) => ({ statement: s.id, verdict: i === 0 ? verdict : 'correct', reason: '', checked: [], conflicts_with: [] })) };
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

// ---- /hikitsugi:start の進行 ----

const manualBody = () => {
  const { schema_version, company, company_name, as_of, ...body } = fixture();
  return body;
};

test('/hikitsugi:start：段階をたどって取扱説明書まで進み、途中から再開できる', () =>
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

    // 聞いていない項目を残して終えることはできない
    write('next.json', { action: 'finish', gap: '', covers: [], question: '' });
    assert.throws(() => hikitsugi('check-next'), /まだ聞いていない/);
    write('gaps.json', { schema_version: 1, company: input.survey.company, coverage, gaps: [{ id: 'GAP-001', items: ['CHK-01', 'CHK-02'], why: '理由', priority: 'high', question_hint: 'ヒント' }] });
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
    const results = (verdict) => ({ results: fixture().statements.map((s, i) => ({ statement: s.id, verdict: i === 0 ? verdict : 'correct', reason: '', checked: [], conflicts_with: [] })) });
    write('verification-1.json', results('unsupported'));
    assert.match(hikitsugi('check-verification', ['1']), /差し戻します/);
    assert.deepEqual(nextStep(work), { step: 'writer', round: 2 });
    assert.ok(existsSync(join(work, 'findings-1.json')));

    // 差し戻しで何も変わらなければ、Editor の作業は不要になる
    write('manual-2.json', manualBody());
    assert.match(hikitsugi('check-writer', ['2']), /Editor の作業は不要/);
    assert.equal(nextStep(work).step, 'verifier');
    write('verification-2.json', results('correct'));
    assert.match(hikitsugi('check-verification', ['2']), /合格/);
    assert.equal(nextStep(work).step, 'render');
    assert.match(hikitsugi('render'), /作りました/);
    assert.ok(readFileSync(join(work, 'manual.html'), 'utf8').includes('<html'));
    assert.equal(nextStep(work).step, 'done');
  }));

test('/hikitsugi:start：差し戻しの上限に達すると not_passed で止まる', () =>
  withTemp(async (dir) => {
    const work = join(dir, 'work');
    const hikitsugi = (command, args = [], stdin = '') => run(command, args, { work, stdin });
    const write = (name, value) => writeFileSync(join(work, name), JSON.stringify(value));
    const surveyPath = join(dir, 'survey.json');
    writeFileSync(surveyPath, JSON.stringify(input.survey));
    hikitsugi('init', [surveyPath, '会社']);
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
const withSteps = (statements, steps = statements.map((s) => s.id)) => ({
  ...fixture(),
  statements,
  symptom_pages: [{ ...fixture().symptom_pages[0], steps }],
});
const step = (id, partId, values = []) => ({ id, text: '', evidence: [], library: { id: partId, values } });

test('部品の形式が正しく、すべて確認済みで、順番は実在する部品だけを指す', () => {
  assert.deepEqual(validate(JSON.parse(readFileSync(join(ROOT, 'plugin/schemas/procedures.schema.json'), 'utf8')), library), []);
  const ids = new Set(library.procedures.map((part) => part.id));
  for (const part of library.procedures) {
    assert.equal(part.status, 'approved', part.id);
    assert.equal(part.reviewed_by, 'Okojyo-Soft', part.id);
    assert.equal(part.reviewed_on, '2026-11-02', part.id);
    // 枠と文面が食い違っていないこと
    assert.deepEqual([...part.text.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]), part.slots, part.id);
    // 値を入れる前の文面が、1文50字以内であること
    assert.deepEqual(longSentences(part.text), [], part.id);
  }
  for (const sequence of library.sequences) for (const id of sequence.order) assert.ok(ids.has(id), id);
});

test('部品に評価セットの値や、許可されていない製品名が入っていない', () => {
  const text = JSON.stringify(library);
  for (const name of ['オコジョ', 'OKOJO', 'okojo', 'クロテン', 'カワウソ', 'イタチ', 'イイズナ', 'フェレット', '田中', '佐藤']) assert.ok(!text.includes(name), name);
  assert.ok(!/192\.168\.|03-0000-01/.test(text));
  const allowed = new Set(['list_values', 'Windows', 'E', 'Enter', 'Wi-Fi', 'PC', 'LIB-', 'network-drive', 'free-space', 'admin-screen', 'wifi', 'restart', 'schema_version', 'sequences', 'id', 'title', 'order', 'procedures', 'use_for', 'text', 'slots', 'status', 'approved', 'reviewed_by', 'Okojyo-Soft', 'reviewed_on']);
  const words = (text.match(/[A-Za-z][A-Za-z_-]*/g) ?? []).filter((word) => !allowed.has(word));
  assert.deepEqual(words, []);
});

test('部品の文面はプログラムが組み立て、根拠に部品と値の根拠を入れる', () => {
  const { manual, problems } = composeProcedures(
    withSteps([step('STM-001', 'LIB-001'), step('STM-002', 'LIB-005', [{ slot: '接続先', value: driveItem.value, evidence: [driveItem.id] }])]),
    sources,
  );
  assert.deepEqual(problems, []);
  assert.equal(manual.statements[0].text, library.procedures[0].text);
  assert.deepEqual(manual.statements[0].evidence, ['LIB-001']);
  assert.ok(manual.statements[1].text.includes(driveItem.value));
  assert.ok(!manual.statements[1].text.includes('{'));
  assert.deepEqual(manual.statements[1].evidence, ['LIB-005', driveItem.id]);
  assert.deepEqual(validate(JSON.parse(readFileSync(join(ROOT, 'plugin/schemas/manual.schema.json'), 'utf8')), manual), []);
});

test('調査データの項目名の側にある値も、部品に入れる値として認める', () => {
  const survey = { items: [{ id: 'INV-001', status: 'ok', key: 'drive.Z', value: 'path' }] };
  const { problems } = composeProcedures(withSteps([step('STM-001', 'LIB-004', [{ slot: 'ドライブ文字', value: 'Z', evidence: ['INV-001'] }])]), { survey, transcript: { entries: [] } });
  assert.deepEqual(problems, []);
});

test('部品の指定の誤りと、根拠にない値を見つける', () => {
  const problemsOf = (statements) => composeProcedures(withSteps(statements), sources).problems.join('\n');
  assert.match(problemsOf([step('STM-001', 'LIB-999')]), /存在しない部品/);
  assert.match(problemsOf([step('STM-001', 'LIB-005')]), /入れる値が違います/);
  assert.match(problemsOf([step('STM-001', 'LIB-005', [{ slot: '接続先', value: '\\\\実在しない', evidence: [driveItem.id] }])]), /根拠 .* にありません/);
  assert.match(problemsOf([step('STM-001', 'LIB-005', [{ slot: '接続先', value: driveItem.value, evidence: [] }])]), /根拠がありません/);
  assert.match(problemsOf([step('STM-001', 'LIB-005', [{ slot: '接続先', value: 'x', evidence: ['INV-999'] }])]), /使えない根拠/);
  // 部品の指定がないのに部品を根拠にして、自分の文で手順を書く形
  assert.match(problemsOf([{ id: 'STM-001', text: '自分の文です。', evidence: ['LIB-001'] }]), /部品の指定がない/);
  // unknown の回答は、値の根拠にできない
  const unknown = input.transcript.entries.find((entry) => entry.status !== 'answered');
  assert.match(problemsOf([step('STM-001', 'LIB-005', [{ slot: '接続先', value: 'x', evidence: [unknown.id] }])]), /使えない根拠/);
});

test('対象だけが違う手順は、表を指す値で1ページにまとめられる。表がなければ見つける', () => {
  const list = library.list_values;
  const parts = [
    step('STM-010', 'LIB-004', [{ slot: 'ドライブ文字', value: list['ドライブ文字'], evidence: [] }]),
    step('STM-011', 'LIB-005', [{ slot: '接続先', value: list['接続先'], evidence: [] }]),
    step('STM-012', 'LIB-007', [{ slot: 'フォルダ名', value: list['フォルダ名'], evidence: [] }]),
  ];
  const rows = [
    { id: 'STM-001', text: 'X ドライブは \\\\NAS\\経理 です。', evidence: [driveItem.id] },
    { id: 'STM-002', text: '総務の PC の Y ドライブは \\\\NAS\\総務 です。', evidence: [driveItem.id] },
  ];
  const base = withSteps([...rows, ...parts], parts.map((part) => part.id));
  base.symptom_pages[0].drive_rows = rows.map((row) => row.id);
  const { manual, problems } = composeProcedures(base, sources);
  assert.deepEqual(problems, []);
  const text = (id) => manual.statements.find((s) => s.id === id).text;
  assert.ok(text('STM-010').includes(list['ドライブ文字']));
  assert.ok(text('STM-011').includes(list['接続先']));
  assert.ok(!text('STM-010').includes('{'));
  assert.match(composeProcedures(withSteps(parts), sources).problems.join('\n'), /共有フォルダの表/);
});

test('手順に置いた事実や禁止は、notes へ移すよう Writer に伝える', () => {
  const statements = [
    { id: 'STM-001', text: 'NAS は事務所にあります。', evidence: [driveItem.id] },
    { id: 'STM-002', text: 'ルーターは初期化しないでください。', evidence: [driveItem.id] },
    { id: 'STM-003', text: 'ルーターの電源を確かめてください。', evidence: [driveItem.id] },
    step('STM-004', 'LIB-001'),
  ];
  const found = composeProcedures(withSteps(statements), sources).problems.join('\n');
  assert.match(found, /STM-001 はやることではありません/);
  assert.match(found, /STM-002 はやることではありません/);
  assert.doesNotMatch(found, /STM-003/);
  assert.doesNotMatch(found, /STM-004/);
  const moved = withSteps(statements, ['STM-003', 'STM-004']);
  moved.symptom_pages[0].notes = ['STM-001', 'STM-002'];
  assert.deepEqual(composeProcedures(moved, sources).problems, []);
});

test('後任が読む文章に、作り方の言葉があれば見つける', () => {
  const statements = [{ id: 'STM-001', text: '聞き取りに記録がありません。', evidence: [driveItem.id] }, step('STM-002', 'LIB-001')];
  const page = withSteps(statements, ['STM-002']);
  page.symptom_pages[0].notes = ['STM-001'];
  assert.match(composeProcedures(page, sources).problems.join('\n'), /作り方の言葉/);
});

test('途中で書くのをやめた出力は、手順ページがないことと空の文章で見つける', () => {
  const base = withSteps([{ id: 'STM-001', text: '', evidence: [driveItem.id] }], []);
  base.symptom_pages = [];
  const found = composeProcedures(base, sources).problems.join('\n');
  assert.match(found, /手順ページが1つもありません/);
  assert.match(found, /STM-001: 文章が空です/);
});

test('業者の連絡先がない vendor のページは、internal を案内する。internal は連絡先がなくてよい', () => {
  const statements = [step('STM-001', 'LIB-001')];
  const noContact = withSteps(statements);
  noContact.symptom_pages[0] = { ...noContact.symptom_pages[0], fallback: null, badge: { ...noContact.symptom_pages[0].badge, value: 'vendor' } };
  assert.match(composeProcedures(noContact, sources).problems.join('\n'), /internal/);
  noContact.symptom_pages[0].badge.value = 'internal';
  assert.deepEqual(composeProcedures(noContact, sources).problems, []);
});

test('共有フォルダの表の行は文章から値を読む。形が違えば見つけ、表示プログラムも止まる', () => {
  assert.deepEqual(parseDriveRow('Z ドライブは \\\\NAS\\図面 です。'), { target: null, drive: 'Z', path: '\\\\NAS\\図面' });
  assert.deepEqual(parseDriveRow('総務用 PC（A-01）の S ドライブは \\\\NAS\\スキャン です。'), { target: '総務用 PC（A-01）', drive: 'S', path: '\\\\NAS\\スキャン' });
  for (const text of ['Z ドライブは \\NAS\\図面 です。', 'Z ドライブは \\\\NAS です。', 'ドライブは \\\\NAS\\図面 です。', '経理は X ドライブです。']) assert.equal(parseDriveRow(text), null, text);
  const statements = [{ id: 'STM-001', text: '経理は X ドライブです。', evidence: [driveItem.id] }, step('STM-002', 'LIB-001')];
  const wrong = withSteps(statements, ['STM-002']);
  wrong.symptom_pages[0].drive_rows = ['STM-001'];
  assert.match(composeProcedures(wrong, sources).problems.join('\n'), /表の行の形ではありません/);
  const page = fixture();
  const [first, ...others] = page.symptom_pages[0].steps;
  page.symptom_pages[0].steps = others;
  page.symptom_pages[0].drive_rows = [first];
  assert.throws(() => renderManual(page), /共有フォルダの表/);
});

test('Writer の形の問題は1回だけ伝えて直してもらい、直らなければ失敗にする', async () => {
  const { schema_version, company, company_name, as_of, ...good } = fixture();
  const bad = JSON.parse(JSON.stringify(good));
  bad.statements.find((s) => s.id === bad.symptom_pages[0].steps[0]).text = 'NAS は事務所にあります。';
  const clientOf = (replies) => {
    const sent = [];
    return {
      sent,
      messages: {
        countTokens: async () => ({ input_tokens: 1 }),
        stream: (params) => {
          sent.push(params);
          const reply = replies[sent.length - 1];
          return { finalMessage: async () => ({ id: 'msg', model: params.model, stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: JSON.stringify(reply) }] }) };
        },
      },
    };
  };
  const args = { survey: input.survey, transcript: input.transcript, companyName: 'オコジョ精工' };
  const fixed = clientOf([bad, good]);
  const result = await runWriterLive({ ...args, client: fixed });
  assert.equal(fixed.sent.length, 2);
  assert.ok(JSON.stringify(fixed.sent[1].messages).includes('structure_problems'));
  assert.equal(result.company_name, 'オコジョ精工');
  const stuck = clientOf([bad, bad]);
  await assert.rejects(runWriterLive({ ...args, client: stuck }), /やることではありません/);
  assert.equal(stuck.sent.length, 2);
});

test('Editor は共有フォルダの表の文章を変えられない', () => {
  const manual = fixture();
  const id = manual.symptom_pages[0].steps[4];
  const before = manual.statements.find((s) => s.id === id).text;
  manual.symptom_pages[0].steps = manual.symptom_pages[0].steps.filter((step) => step !== id);
  manual.symptom_pages[0].drive_rows = [id];
  const { manual: edited, changes } = applyEdits(manual, { rewrites: [{ id, text: '言い換えた文です。' }], glossary: [] });
  assert.equal(edited.statements.find((s) => s.id === id).text, before);
  assert.deepEqual(changes, [{ statement: id, missing: ['表の文章'] }]);
});

test('部品の順番が決まった順と逆なら見つける', () => {
  const statements = [step('STM-001', 'LIB-002'), step('STM-002', 'LIB-001')];
  assert.match(composeProcedures(withSteps(statements), sources).problems.join('\n'), /順番/);
  assert.deepEqual(composeProcedures(withSteps(statements, ['STM-002', 'STM-001']), sources).problems, []);
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
  const { manual } = composeProcedures(withSteps([step('STM-001', 'LIB-001')]), sources);
  const page = manual.symptom_pages[0];
  const refs = new Set([page.title, page.badge.statement, page.reassurance, page.fallback?.message, ...fixture().contacts.flatMap((c) => [c.role, c.hours, c.contract_location, c.what_to_tell]), ...fixture().glossary.map((g) => g.explanation)]);
  const complete = { ...manual, statements: [...manual.statements, ...fixture().statements.filter((s) => refs.has(s.id) && s.id !== 'STM-001')] };
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
  assert.ok(renderManual(manual).includes('確認済みの標準手順'));
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
