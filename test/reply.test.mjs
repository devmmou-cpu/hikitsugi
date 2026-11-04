// 社員に返す文の決まりを確かめる。プログラムが組み、部品の文面と定型文のほかは通さない。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { pageSchema } from '../plugin/lib/assemble.mjs';
import { buildRevision } from '../plugin/lib/handover.mjs';
import { plainProblems } from '../plugin/lib/plain-check.mjs';
import { loadLibrary } from '../plugin/lib/procedures.mjs';
import { callScriptProblems, composeCallScript, composeReply, REPLY_LINES_MAX, replyProblems, withoutReplies, withReplies, withWindows10Note } from '../plugin/lib/reply.mjs';
import { renderManual } from '../plugin/renderer/render.mjs';
import { summarizeReplies } from '../eval/reply-verify.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const fixture = () => JSON.parse(readFileSync(join(ROOT, 'test/fixtures/manual-full.json'), 'utf8'));
const library = loadLibrary();
const parts = new Map(library.procedures.map((part) => [part.id, part]));
const statementOf = (manual, id) => manual.statements.find((statement) => statement.id === id);
const replyOf = (manual, page) => statementOf(manual, page.reply_to_staff);

test('見本の全ページで、決まりに合っている', () => {
  assert.deepEqual(replyProblems(fixture()), []);
  assert.deepEqual(replyProblems(JSON.parse(readFileSync(join(ROOT, 'test/fixtures/manual-t1.json'), 'utf8'))), []);
});

const selfPage = (manual) => manual.symptom_pages.find((p) => p.badge.value === 'self' && p.first_steps.length && p.first_steps.every((id) => statementOf(manual, id).library && !parts.get(statementOf(manual, id).library).needs_table));
const firstActionPage = selfPage;

test('自分で直せる：定型、① の部品、① のゴールの順', () => {
  const manual = fixture();
  const page = selfPage(manual);
  assert.ok(page, '見本に該当のページがありません');
  const reply = replyOf(manual, page);
  assert.deepEqual(reply.text.split('\n'), ['次を試してみてください。', ...page.first_steps.map((id) => statementOf(manual, id).text), statementOf(manual, page.first_goal).text]);
  assert.equal(reply.usage, 'reply_to_staff');
  assert.ok(reply.text.split('\n').length <= REPLY_LINES_MAX);
});

test('自分で直せる：5行を超えるときは、ゴール文を省く', () => {
  const manual = fixture();
  const page = selfPage(manual);
  const first = page.first_steps[0];
  const longer = { ...page, first_steps: [first, first, first, first] };
  const lines = composeReply(longer, manual, library).text.split('\n');
  assert.equal(lines.length, 5);
  assert.ok(!lines.includes(statementOf(manual, page.first_goal).text));
});

test('確認してから：部品があっても「いま確認しています。」の1行だけ', () => {
  const manual = fixture();
  const page = selfPage(manual);
  const asked = { ...page, badge: { ...page.badge, value: 'check_first' } };
  assert.equal(composeReply(asked, manual, library).text, 'いま確認しています。');
  for (const each of manual.symptom_pages.filter((p) => p.badge.value === 'check_first')) assert.equal(replyOf(manual, each).text, 'いま確認しています。', each.id);
});

test('業者へ連絡と社内で相談：過去形にせず、これからすることを書く', () => {
  const manual = fixture();
  for (const page of manual.symptom_pages.filter((p) => ['vendor', 'internal'].includes(p.badge.value))) {
    const contact = manual.contacts.find((c) => c.id === page.fallback?.contact);
    const verb = page.badge.value === 'vendor' ? '連絡' : '相談';
    assert.equal(replyOf(manual, page).text, `いま確認しています。\n${contact.name}に${verb}します。`, page.id);
    assert.doesNotMatch(replyOf(manual, page).text, /しました/, page.id);
  }
});

test('自分で直せるでも ① に部品でない操作があれば、途中が抜けた手順にせず定型文にする', () => {
  const manual = fixture();
  const page = selfPage(manual);
  const statement = statementOf(manual, page.first_steps[1]);
  statement.library = null;
  statement.text = '機器の電源を入れ直してください。';
  assert.equal(composeReply(page, manual, library).text, 'いま確認しています。');
});

test('会社の情報の表を指す部品は、社員に渡さない', () => {
  const manual = fixture();
  const page = selfPage(manual);
  const part = library.procedures.find((each) => each.needs_table && each.kinds.includes('first_steps'));
  const first = statementOf(manual, page.first_steps[0]);
  first.library = part.id;
  first.text = part.text;
  assert.equal(composeReply(page, manual, library).text, 'いま確認しています。');
});

test('検査：部品にない操作、言い換え、順番の違い、6行以上、定型の崩れ、消えた文を見つける', () => {
  const broken = (change) => {
    const manual = fixture();
    change(manual, selfPage(manual));
    return replyProblems(manual).join('\n');
  };
  assert.match(broken((m, p) => { replyOf(m, p).text = '電源を入れ直してください。'; }), /で始めます/);
  assert.match(broken((m, p) => { replyOf(m, p).text = `${replyOf(m, p).text}\n再起動してください。`; }), /手順部品の文面/);
  assert.match(broken((m, p) => { const [head, ...rest] = replyOf(m, p).text.split('\n'); replyOf(m, p).text = [head, ...rest.reverse()].join('\n'); }), /手順部品の文面/);
  assert.match(broken((m, p) => { replyOf(m, p).text = Array(6).fill('次を試してみてください。').join('\n'); }), /5 行以内/);
  const pageOf = (badge) => (change) => {
    const manual = fixture();
    change(manual, manual.symptom_pages.find((p) => p.badge.value === badge));
    return replyProblems(manual).join('\n');
  };
  assert.match(pageOf('vendor')((m, p) => { replyOf(m, p).text = 'いま確認しています。\n再起動してください。'; }), /定型文だけ/);
  assert.match(pageOf('vendor')((m, p) => { const c = m.contacts.find((x) => x.id === p.fallback.contact); replyOf(m, p).text = `いま確認しています。\n${c.name}に連絡しました。`; }), /定型文だけ/);
  assert.match(pageOf('internal')((m, p) => { const c = m.contacts.find((x) => x.id === p.fallback.contact); replyOf(m, p).text = `いま確認しています。\n${c.name}に連絡します。`; }), /定型文だけ/);
  assert.match(pageOf('check_first')((m, p) => { replyOf(m, p).text = 'いま確認しています。\n少しお待ちください。'; }), /だけです/);
  assert.match(pageOf('vendor')((_m, p) => { delete p.reply_to_staff; }), /社員に返す文がありません/);
});

// ---- 業者に伝える文 ----
const callOf = (manual, page) => statementOf(manual, page.fallback.message);

test('業者に伝える文：決まった型に、題名、① の文、機器の置き場所を差し込む', () => {
  const manual = fixture();
  const page = manual.symptom_pages.find((p) => p.fallback && p.first_steps.length);
  const steps = page.first_steps.map((id) => `「${statementOf(manual, id).text.replace(/。$/, '')}」`).join('、');
  const lines = callOf(manual, page).text.split('\n');
  assert.equal(lines[0], `${manual.company_name}です。`);
  assert.equal(lines[1], `「${statementOf(manual, page.title).text}」件で連絡しました。`);
  assert.equal(lines[2], `説明書の手順${steps}は試しました。直りません。`);
  assert.equal(lines.at(-1), '確認をお願いします。');
  assert.equal(callOf(manual, page).usage, 'call_script');
});

test('業者に伝える文：① がなければ3行目を出さず、置き場所の記録がなければ機器の行を出さない', () => {
  const manual = fixture();
  const page = manual.symptom_pages.find((p) => p.fallback && !p.first_steps.length);
  const none = { ...page, title: page.title };
  const device = manual.devices[0];
  statementOf(manual, device.location).text = '置き場所の記録がありません。社内で相談してください。';
  statementOf(manual, none.title).text = `${statementOf(manual, device.name).text}が止まった`;
  const lines = composeCallScript(none, withoutReplies(manual)).text.split('\n');
  assert.ok(!lines.some((line) => line.startsWith('説明書の手順')));
  assert.ok(!lines.some((line) => line.startsWith('機器の場所')));
});

test('業者に伝える文：業者へ連絡のページで、題名か ① に機器があり、根拠のある置き場所があれば、機器の場所の行を出す', () => {
  const manual = withoutReplies(fixture());
  const page = manual.symptom_pages.find((p) => p.fallback && p.badge.value === 'vendor');
  const device = manual.devices.find((d) => statementOf(manual, d.location).evidence.length && !/記録がありません/.test(statementOf(manual, d.location).text));
  const name = statementOf(manual, device.name).text.replace(/[（(].*$/, '').trim();
  statementOf(manual, page.title).text = `${name}が止まった`;
  const line = composeCallScript(page, manual).text.split('\n').find((each) => each.startsWith('機器の場所：'));
  assert.ok(line, '機器の場所の行がありません');
  assert.ok(manual.devices.some((d) => line === `機器の場所：${statementOf(manual, d.location).text.replace(/。$/, '')}`), line);
});

test('検査：業者に伝える文の型の崩れと、根拠のない値を見つける', () => {
  const broken = (change) => {
    const manual = fixture();
    change(manual, manual.symptom_pages.find((p) => p.fallback && p.first_steps.length));
    return callScriptProblems(manual).join('\n');
  };
  assert.equal(callScriptProblems(fixture()).length, 0);
  assert.match(broken((m, p) => { callOf(m, p).text = callOf(m, p).text.replace(m.company_name, '別の会社'); }), /1行目/);
  assert.match(broken((m, p) => { callOf(m, p).text = callOf(m, p).text.replace('件で連絡しました', 'の件です'); }), /2行目/);
  assert.match(broken((m, p) => { callOf(m, p).text = callOf(m, p).text.replace('説明書の手順', '説明書の手順「再起動してください」、'); }), /3行目/);
  assert.match(broken((m, p) => { callOf(m, p).text = callOf(m, p).text.replace('確認をお願いします。', '機器の場所：どこか\n確認をお願いします。'); }), /機器の場所/);
  assert.match(broken((m, p) => { callOf(m, p).text = callOf(m, p).text.replace('確認をお願いします。', '急いでください。'); }), /最後の行/);
  assert.match(broken((m, p) => { statementOf(m, p.title).evidence = []; }), /根拠がありません/);
  assert.match(broken((_m, p) => { delete p.fallback.message; }), /業者に伝える文がありません/);
});

test('何度組んでも同じ結果で、外すと元の形に戻る。文章を増やし続けない', () => {
  const manual = fixture();
  assert.deepEqual(withReplies(manual), manual);
  const base = withoutReplies(manual);
  assert.ok(base.symptom_pages.every((page) => !('reply_to_staff' in page)));
  assert.ok(base.statements.every((statement) => !statement.usage));
  assert.deepEqual(withReplies(base), manual);
});

test('Writer の出力の形に入らない。Editor への直しの依頼にも入らない', () => {
  const schema = pageSchema();
  assert.ok(!('reply_to_staff' in schema.properties.page.properties));
  assert.ok(!('usage' in schema.properties.statements.items.properties));
  const manual = fixture();
  const reply = manual.statements.find((statement) => statement.usage);
  reply.text = `${'長'.repeat(80)}。`;
  assert.ok(!plainProblems(manual).long_sentences.some((row) => row.id === reply.id));
});

test('補足つきの部品も文面のまま写す', () => {
  const manual = fixture();
  const page = selfPage(manual);
  const part = parts.get('LIB-028');
  const first = statementOf(manual, page.first_steps[0]);
  first.library = part.id;
  first.text = part.text;
  assert.deepEqual(replyProblems(withReplies(manual)), []);
  assert.ok(replyOf(withReplies(manual), withReplies(manual).symptom_pages.find((p) => p.id === page.id)).text.includes(part.text));
});

test('社員に返す文の判定を数える。回答がない文章を「正しい」に数えない', () => {
  const statements = [{ id: 'STM-001' }, { id: 'STM-002' }, { id: 'STM-003' }];
  assert.deepEqual(summarizeReplies(statements, [{ statement: 'STM-001', verdict: 'correct' }, { statement: 'STM-002', verdict: 'dangerous' }]), { total: 3, correct: 1, contradiction: 0, unsupported: 0, dangerous: 1, unanswered: 1 });
});

test('Verifier には usage を付けて渡す。プロンプトに定型文の扱いがある', () => {
  const manual = fixture();
  assert.equal(manual.statements.filter((statement) => statement.usage === 'reply_to_staff').length, manual.symptom_pages.length);
  assert.equal(manual.statements.filter((statement) => statement.usage === 'call_script').length, manual.symptom_pages.filter((page) => page.fallback).length);
  const prompt = readFileSync(join(ROOT, 'plugin/agents/verifier.md'), 'utf8');
  assert.match(prompt, /`usage` が `reply_to_staff`/);
  assert.match(prompt, /事実の主張として扱わず/);
  assert.match(prompt, /`usage` が `call_script`/);
  assert.match(prompt, /実際に試したかどうかは主張として扱いません/);
  const writer = readFileSync(join(ROOT, 'plugin/agents/writer.md'), 'utf8');
  assert.match(writer, /相手に伝える文面はプログラムが組む/);
  assert.ok(!('message' in pageSchema().properties.page.properties.fallback.properties));
});

test('PC 用：① の直下に枠とコピーのボタンがあり、ボタンは JavaScript があるときだけ', () => {
  const manual = fixture();
  const html = renderManual(manual);
  const page = manual.symptom_pages.find((p) => p.first_steps.length);
  const start = html.indexOf(`<article id="symptom-${page.id}"`);
  const body = html.slice(start, html.indexOf('</article>', start));
  const first = body.indexOf('まずこれだけ');
  const reply = body.indexOf('社員に返す文');
  assert.ok(first > 0 && first < reply);
  for (const later of ['それでも直らなければ', 'それでもだめなら']) if (body.includes(later)) assert.ok(reply < body.indexOf(later), later);
  assert.match(body, new RegExp(`<blockquote class="say reply" id="reply-${page.id}">`));
  assert.match(body, new RegExp(`<button[^>]*class="[^"]*js-only[^"]*"[^>]*data-copy="reply-${page.id}"[^>]*>文面をコピー`));
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.match(css, /\.say\s*\{[^}]*user-select:\s*all/);
  assert.match(css, /\.reply\s*\{\s*white-space:\s*pre-line/);
  for (const each of manual.symptom_pages) assert.ok(html.includes(`id="reply-${each.id}"`), each.id);
});

test('社員に返す文がない入力や、決まりに合わない入力からは作らない', () => {
  const missing = fixture();
  delete missing.symptom_pages[0].reply_to_staff;
  missing.statements = missing.statements.filter((statement) => statement.id !== fixture().symptom_pages[0].reply_to_staff);
  assert.throws(() => renderManual(missing), /社員に返す文/);
});

test('前任者の確認の画面に、社員に返す文も見せる', () => {
  const source = readFileSync(join(ROOT, 'plugin/scripts/hikitsugi.mjs'), 'utf8');
  assert.match(source, /section\('社員に返す文', \[page\.reply_to_staff\]\)/);
});

// ---- Windows 10 の分岐（中-4） ----
const surveyWith = (...rows) => ({ items: rows.map(([host, value, status = 'ok'], index) => ({ id: `INV-${String(index + 1).padStart(3, '0')}`, host, key: 'os.caption', value, status })) });
const withBranch = () => {
  const manual = withoutReplies(fixture());
  assert.ok(manual.statements.some((s) => s.library === 'LIB-021'), '見本に分岐がありません');
  return manual;
};
const pageWithBranch = (manual) => manual.symptom_pages.find((p) => p.branches.some((id) => statementOf(manual, id)?.library === 'LIB-021'));

test('Windows 10 の分岐：調査データの該当する PC 名を、分岐の直後に根拠つきで出す', () => {
  const manual = withWindows10Note(withBranch(), surveyWith(['OKJ-CAD-01', 'Windows 10 Pro'], ['OKJ-SOUMU-01', 'Windows 11 Pro'], ['OKJ-X-01', 'Windows 10 Pro', 'denied']));
  const page = pageWithBranch(manual);
  const at = page.branches.findIndex((id) => statementOf(manual, id).library === 'LIB-021');
  const note = statementOf(manual, page.branches[at + 1]);
  assert.equal(note.text, '該当する PC：OKJ-CAD-01。');
  assert.deepEqual(note.evidence, ['INV-001']);
  assert.equal(note.usage, 'pc_note');
});

test('Windows 10 の分岐：該当がなければ、分岐そのものを出さず、「ありません」とも書かない', () => {
  const manual = withWindows10Note(withBranch(), surveyWith(['OKJ-SOUMU-01', 'Windows 11 Pro']));
  assert.equal(pageWithBranch(manual), undefined);
  assert.ok(!manual.statements.some((s) => s.library === 'LIB-021'));
  assert.ok(!manual.statements.some((s) => /Windows 10 の PC は(?:あり|、手順)/.test(s.text)));
  assert.doesNotThrow(() => renderManual(withReplies({ ...manual, statements: manual.statements })));
});

test('Windows 10 の分岐：何度組んでも増えず、Writer には渡さない', () => {
  const survey = surveyWith(['OKJ-CAD-01', 'Windows 10 Pro']);
  const once = withWindows10Note(withBranch(), survey);
  assert.deepEqual(withWindows10Note(once, survey), once);
  const revision = buildRevision(withReplies(once), []);
  assert.ok(!revision.previous_manual.statements.some((s) => s.usage));
  assert.ok(revision.previous_manual.symptom_pages.every((p) => !p.branches.some((id) => !revision.previous_manual.statements.some((s) => s.id === id))));
  const shown = renderManual(withReplies(once)).replace(/<[^>]+>/g, '');
  assert.match(shown, /Windows 10 の PC（OKJ-CAD-01）は、手順が違うので、連絡先へ連絡してください。/);
  assert.doesNotMatch(shown, /該当する PC/);
});

test('業者に伝える文：業者へ連絡以外のページには、機器の場所の行を出さない', () => {
  const manual = withoutReplies(fixture());
  const device = manual.devices.find((d) => statementOf(manual, d.location).evidence.length && !/記録がありません/.test(statementOf(manual, d.location).text));
  const name = statementOf(manual, device.name).text.replace(/[（(].*$/, '').trim();
  const vendor = manual.symptom_pages.find((p) => p.fallback && p.badge.value === 'vendor');
  statementOf(manual, vendor.title).text = `${name}が止まった`;
  assert.ok(composeCallScript(vendor, manual).text.includes('機器の場所：'));
  for (const value of ['check_first', 'internal', 'self']) {
    const page = { ...vendor, badge: { ...vendor.badge, value } };
    assert.ok(!composeCallScript(page, manual).text.includes('機器の場所'), value);
  }
});

test('業者に伝える文：① に手順部品でない文があれば、「試しました」の行を出さない', () => {
  const manual = withoutReplies(fixture());
  const page = manual.symptom_pages.find((p) => p.fallback && p.first_steps.length && p.first_steps.every((id) => statementOf(manual, id).library));
  assert.ok(composeCallScript(page, manual).text.includes('は試しました。直りません。'));
  manual.statements.push({ id: 'STM-901', text: '不審なメールは開かずに、知らせてください。', evidence: ['INT-001'], library: null });
  const mixed = { ...page, first_steps: [page.first_steps[0], 'STM-901'] };
  const built = composeCallScript(mixed, manual);
  assert.ok(!built.text.includes('試しました'));
  assert.ok(!built.text.includes('不審なメール'));
  assert.ok(!built.evidence.includes('INT-001'));
});

test('検査：手順部品でない ① を「試しました」と書いた文と、業者へ連絡以外の機器の場所を見つける', () => {
  const broken = (edit) => {
    const manual = fixture();
    edit(manual);
    return callScriptProblems(manual).join('\n');
  };
  const nonVendor = (manual) => manual.symptom_pages.find((p) => p.fallback && p.badge.value !== 'vendor');
  assert.match(broken((m) => { const p = nonVendor(m); callOf(m, p).text = callOf(m, p).text.replace('確認をお願いします。', '機器の場所：事務所\n確認をお願いします。'); }), /機器の場所/);
  assert.match(broken((m) => {
    const p = m.symptom_pages.find((candidate) => candidate.fallback && candidate.first_steps.length && !candidate.first_steps.every((id) => statementOf(m, id).library));
    const lines = callOf(m, p).text.split('\n');
    lines.splice(2, 0, '説明書の手順「知らせる」は試しました。直りません。');
    callOf(m, p).text = lines.join('\n');
  }), /件で相談です/);
});

test('業者に伝える文：機器を1つに絞れないときは、機器の場所の行を出さない', () => {
  const manual = withoutReplies(fixture());
  const page = manual.symptom_pages.find((p) => p.fallback && p.badge.value === 'vendor');
  const add = (id, text) => manual.statements.push({ id, text, evidence: ['INT-001'], library: null });
  add('STM-901', 'NAS');
  add('STM-902', '事務所のサーバーラックにあります。');
  add('STM-903', '生産管理サーバー（社内サーバー1台）');
  add('STM-904', '置き場所の記録がありません。');
  add('STM-905', '無線 AP（工場）');
  add('STM-906', '工場の入口に近い柱の上にあります。');
  add('STM-907', '無線 AP（事務所）');
  add('STM-908', '事務所の天井にあります。');
  manual.devices = [['STM-901', 'STM-902'], ['STM-903', 'STM-904'], ['STM-905', 'STM-906'], ['STM-907', 'STM-908']].map(([name, location]) => ({ name, location }));
  const placeLine = (title) => {
    statementOf(manual, page.title).text = title;
    return composeCallScript(page, manual).text.split('\n').find((line) => line.startsWith('機器の場所：')) ?? null;
  };
  assert.equal(placeLine('停電のあと NAS やサーバーが動かない'), null, 'NAS とサーバーの2台');
  assert.equal(placeLine('NAS のディスクの交換が必要そう'), '機器の場所：事務所のサーバーラックにあります');
  assert.equal(placeLine('サーバーが動かない'), null, '置き場所の記録がない');
  assert.equal(placeLine('工場の AP が止まった'), '機器の場所：工場の入口に近い柱の上にあります');
  assert.equal(placeLine('AP が止まった'), null, 'どちらの AP か分からない');
});

test('Windows 10 の分岐：束でも1本にまとめ、manual の文は分けたまま根拠を残す', async () => {
  const { renderPhoneBundle } = await import('../plugin/renderer/phone.mjs');
  const { withPcInBranch } = await import('../plugin/lib/reply.mjs');
  const manual = withReplies(withWindows10Note(withBranch(), surveyWith(['OKJ-CAD-01', 'Windows 10 Pro'], ['OKJ-CAD-02', 'Windows 10 Pro'])));
  const page = pageWithBranch(manual);
  const merged = withPcInBranch(manual);
  const part = merged.statements.find((s) => s.library === 'LIB-021');
  assert.equal(part.text, 'Windows 10 の PC（OKJ-CAD-01、OKJ-CAD-02）は、手順が違うので、連絡先へ連絡してください。');
  assert.ok(part.evidence.includes('INV-001'));
  assert.ok(!merged.statements.some((s) => s.usage === 'pc_note'));
  assert.equal(merged.symptom_pages.find((p) => p.id === page.id).branches.length, page.branches.length - 1);
  assert.ok(manual.statements.some((s) => s.usage === 'pc_note'), '元の manual は変えない');
  const text = renderPhoneBundle(manual).map(({ html }) => html.replace(/<[^>]+>/g, '')).join('\n');
  assert.match(text, /Windows 10 の PC（OKJ-CAD-01、OKJ-CAD-02）は、手順が違う/);
  assert.doesNotMatch(text, /該当する PC/);
});

test('社内の相談先に言う文：名乗らず、同僚に言う型で、① が手順部品のときだけ試した行を入れる', async () => {
  const { composeCallScript, callScriptProblems } = await import('../plugin/lib/reply.mjs');
  const manual = {
    company_name: 'オコジョ精工株式会社',
    contacts: [{ id: 'INH-01', name: '社長' }, { id: 'VEN-01', name: 'クロテン通信' }],
    devices: [],
    statements: [
      { id: 'STM-001', text: 'NAS のディスクが壊れた', evidence: ['INT-001'] },
      { id: 'STM-002', text: '電源を入れ直してください。', evidence: ['LIB-001'], library: 'LIB-001' },
      { id: 'STM-003', text: '自分で考えた操作をしてください。', evidence: ['INT-001'] },
    ],
    symptom_pages: [],
  };
  const page = (first) => ({ id: 'T1', title: 'STM-001', badge: { value: 'internal' }, first_steps: first, fallback: { contact: 'INH-01', message: 'STM-010' } });
  assert.equal(composeCallScript(page([]), manual).text, '「NAS のディスクが壊れた」の件で相談です。\nどうすればよいですか。');
  assert.equal(composeCallScript(page(['STM-002']), manual).text, '「NAS のディスクが壊れた」の件で相談です。\n説明書の手順「電源を入れ直してください」は試しました。\nどうすればよいですか。');
  assert.equal(composeCallScript(page(['STM-003']), manual).text, '「NAS のディスクが壊れた」の件で相談です。\nどうすればよいですか。', '手順部品でない ① は試したことにしない');
  // 業者の型は変えない
  const vendor = { ...page([]), fallback: { contact: 'VEN-01', message: 'STM-010' }, badge: { value: 'vendor' } };
  assert.match(composeCallScript(vendor, manual).text, /^オコジョ精工株式会社です。\n「NAS のディスクが壊れた」件で連絡しました。\n確認をお願いします。$/);
  // 型の検査
  const composed = { ...manual, statements: [...manual.statements, { id: 'STM-010', text: composeCallScript(page([]), manual).text, evidence: ['INT-001'], usage: 'call_script' }], symptom_pages: [page([])] };
  assert.deepEqual(callScriptProblems(composed), []);
  const wrong = { ...composed, statements: composed.statements.map((statement) => (statement.id === 'STM-010' ? { ...statement, text: 'オコジョ精工株式会社です。' } : statement)) };
  assert.match(callScriptProblems(wrong)[0], /件で相談です/);
});

test('文面の枠は改行を保つ（1行ずつ言う文面のため）', async () => {
  const { STYLES } = await import('../plugin/renderer/styles.mjs');
  assert.match(STYLES, /\.say \{\s*white-space: pre-line;/);
});

test('連絡先の印：受付時間は時計、連絡の手段は人', async () => {
  const { hoursIconName } = await import('../plugin/renderer/render.mjs');
  for (const text of ['受付は平日9時から18時です。', '24時間受け付けています。', '受付時間の記録がありません。', '平日に電話で受け付けています。']) assert.equal(hoursIconName(text), 'clock', text);
  for (const text of ['連絡は内線でします。', '工場の CAD 担当者に聞くときは、工場事務所の席まで行ってください。', 'メールで連絡します。']) assert.equal(hoursIconName(text), 'people', text);
});
