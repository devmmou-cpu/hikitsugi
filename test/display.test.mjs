// 表示の直前の変換のテスト（内容レビュー R1）。manual.json の文を変えないこと、読む人が止まる箇所が減ること。

import assert from 'node:assert/strict';
import test from 'node:test';
import { forDisplay, internalFor, nearlySame, shortQuestion, unknownItems } from '../plugin/lib/display.mjs';
import { missingInterviewEvidence } from '../plugin/lib/transcript.mjs';
import { makeContext } from '../plugin/renderer/render.mjs';

const library = { procedures: [{ id: 'LIB-010', text: '部品です。' }, { id: 'LIB-021', text: 'Windows 10 の PC は、手順が違うので、連絡先へ連絡してください。' }] };

function build(pages, contacts = [], devices = []) {
  const statements = [];
  const add = (text, extra = {}) => {
    const id = `STM-${String(statements.length + 1).padStart(3, '0')}`;
    statements.push({ id, text, evidence: ['INT-001'], library: null, ...extra });
    return id;
  };
  const part = (entry) => (typeof entry === 'string' ? add(entry) : add(entry.text, { library: entry.lib, evidence: [entry.lib] }));
  return {
    statements,
    glossary: [],
    contacts: contacts.map(({ id, name, phone = '', hours, tell }) => ({ id, name, phone, role: add('役割'), hours: hours ? add(hours) : null, contract_location: null, what_to_tell: tell ? add(tell) : null })),
    routines: [],
    devices: devices.map(({ id, name, impact }) => ({ id, name: add(name), location: add('棚にあります。'), purpose: add('使います。'), impact: add(impact), credential_location: null, caution: null })),
    symptom_pages: pages.map(({ id, value = 'internal', title, contact, notes = [], first = [], branches = [], steps = [], exceptions = [] }) => ({
      id,
      category: 'other',
      title: add(title),
      badge: { value, statement: add('すること。') },
      reassurance: add('決まっています。'),
      minutes: 5,
      notes: notes.map(part),
      first_steps: first.map(part),
      first_goal: null,
      branches: branches.map(part),
      steps: steps.map(part),
      goal: null,
      exceptions: exceptions.map(part),
      info_rows: [],
      ...(contact ? { fallback: { contact, message: add('文面') } } : {}),
    })),
  };
}

const textOf = (manual, id) => manual.statements.find((statement) => statement.id === id).text;
const BOSS = { id: 'INH-02', name: '社長', hours: '連絡は内線でします。', tell: '次のときに伝えてください。NAS が直らないとき、不審なメールを削除してもらったとき、感染や情報漏えいが疑われるときです。' };
const CAD = { id: 'INH-01', name: '工場の CAD 担当者', hours: '工場事務所の席まで行ってください。', tell: '困っている内容を伝えてください。' };

test('「社内で相談してください」は相手の名前にし、manual の文は変えない', () => {
  const manual = build([
    { id: 'T5', title: 'NAS が止まっている', contact: 'INH-02', notes: ['置き場所は、記録がありません。社内で相談してください。'] },
    { id: 'T9', title: '新しい PC を入れたい', contact: 'INH-01', notes: ['やり方は記録がありません。社内で相談してください。'] },
    { id: 'T1', value: 'self', title: '関係のないページ', notes: ['分かりません。社内で相談してください。'] },
  ], [CAD, BOSS]);
  const before = JSON.stringify(manual);
  const shown = forDisplay(manual, { library });
  assert.equal(JSON.stringify(manual), before, '元の manual は変えない');
  const note = (id) => textOf(shown, shown.symptom_pages.find((page) => page.id === id).notes[0]);
  assert.equal(note('T5'), '置き場所は、記録がありません。社長に聞いてください（連絡先）。');
  assert.equal(note('T9'), 'やり方は記録がありません。工場の CAD 担当者に聞いてください（連絡先）。');
  assert.equal(note('T1'), '分かりません。工場の CAD 担当者に聞いてください（連絡先）。');
  assert.match(makeContext(shown).text(shown.symptom_pages[0].notes[0]), /<a class="tap text-link" href="#tab-contacts">連絡先<\/a>/);
  assert.doesNotMatch(makeContext(shown, { links: false }).text(shown.symptom_pages[0].notes[0]), /<a /);
});

test('感染と不審なメールのページは、伝えることに語のある社長にする', () => {
  const manual = build([{ id: 'T10', title: 'ウイルス感染や情報漏えいが疑われる', contact: 'INH-03' }, { id: 'T11', title: '社員から不審なメールを知らされた', contact: 'INH-03' }], [CAD, BOSS, { id: 'INH-03', name: '総務課', hours: '連絡は内線でします。' }]);
  const text = new Map(manual.statements.map((statement) => [statement.id, statement.text]));
  for (const page of manual.symptom_pages) assert.equal(internalFor(page, manual, (id) => text.get(id)).name, '社長', page.id);
});

test('Windows 10 の帯：PC の操作がないページには出さず、属性があれば属性のある部品のページだけに出す', () => {
  const band = { text: library.procedures[1].text, lib: 'LIB-021' };
  const manual = build([
    { id: 'T1', value: 'self', title: 'PC の操作', first: [{ text: '部品です。', lib: 'LIB-010' }], branches: [band] },
    { id: 'T2', title: 'AP の電源', steps: ['AP の電源を抜いてください。'], branches: [band] },
  ]);
  const bands = (shown) => shown.symptom_pages.map((page) => page.branches.filter((id) => shown.statements.find((s) => s.id === id)?.library === 'LIB-021').length);
  assert.deepEqual(bands(forDisplay(manual, { library })), [1, 0]);
  const attributed = { procedures: library.procedures.map((part) => (part.id === 'LIB-010' ? part : { ...part })).concat([{ id: 'LIB-099', text: '別', windows11_only: true }]) };
  assert.deepEqual(bands(forDisplay(manual, { library: attributed })), [0, 0], '属性のある部品がなければ出さない');
});

test('「〜のときは〜へ」は ② の見出しの直下に動かし、試したあとの話は手順の後に残す', () => {
  const manual = build([{
    id: 'T2', value: 'self', title: 'Wi-Fi', contact: 'VEN-02', steps: ['電源を抜いてください。'],
    exceptions: ['事務所の Wi-Fi がつながらないときは、カワウソシステムサービスに連絡してください。', '再起動しても、つながらないことがあります。その場合は、カワウソシステムサービスに連絡してください。', '電源を入れても直らないときは、社長に相談してください。'],
  }], [{ id: 'VEN-02', name: 'カワウソシステムサービス', phone: '03-0000-0102' }]);
  const shown = forDisplay(manual, { library }).symptom_pages[0];
  const original = manual.symptom_pages[0];
  assert.deepEqual(shown.branches, [original.exceptions[0]]);
  assert.deepEqual(shown.exceptions, original.exceptions.slice(1));
});

test('ほかの業者とページへのリンクを付け、業者のページの電源の手順はリンク1行にする', () => {
  const manual = build([
    { id: 'T5', title: 'NAS が止まっている', contact: 'INH-02', steps: ['NAS の電源ボタンを押してください。'], exceptions: ['サーバーの電源ボタンを押しても動かないときは、イイズナソフトに相談してください。'] },
    { id: 'T6', value: 'vendor', title: '生産管理システムが使えない', contact: 'VEN-04', notes: ['止まっているときだけ、電源ボタンを押してください。'] },
  ], [BOSS, { id: 'VEN-04', name: 'イイズナソフト', phone: '03-0000-0104' }]);
  const shown = forDisplay(manual, { library });
  const [t5, t6] = shown.symptom_pages;
  assert.deepEqual(shown.display_links[t5.exceptions[0]], [{ page: 'T6', title: '生産管理システムが使えない' }]);
  assert.equal(textOf(shown, t6.notes[0]), '電源を入れる手順は、次のページにあります。');
  assert.match(makeContext(shown).text(t6.notes[0]), /href="#symptom-T5"/);
  assert.match(makeContext(shown, { links: false }).text(t6.notes[0]), /のファイル/);
});

test('連絡先の枠とほぼ同じ説明は落とす', () => {
  assert.ok(nearlySame('工場の CAD 担当者に聞くときは、工場事務所の席まで行ってください。', '工場の CAD 担当者には、工場事務所の席まで行って聞いてください。'));
  assert.ok(!nearlySame('工場の CAD 担当者に聞くときは、工場事務所の席まで行ってください。', '来客用の Wi-Fi はありません。'));
  const manual = build([{ id: 'T3', title: '来客', contact: 'INH-01', notes: ['工場事務所の席まで行ってください。', '来客用の Wi-Fi はありません。'] }], [CAD]);
  const shown = forDisplay(manual, { library });
  assert.deepEqual(shown.symptom_pages[0].notes.map((id) => textOf(shown, id)), ['来客用の Wi-Fi はありません。']);
});

test('表にないフォルダは、説明の一覧と表の差から出す', () => {
  const manual = build([{ id: 'T4', value: 'self', title: '共有フォルダ', contact: 'INH-01', notes: ['共有フォルダは、総務、営業、図面の3つです。'] }], [CAD]);
  const rows = ['Z ドライブは \\\\OKOJO-NAS\\図面 です。', 'OKJ-SOUMU-01 の Y ドライブは \\\\OKOJO-NAS\\総務 です。'];
  manual.statements.push(...rows.map((text, index) => ({ id: `STM-9${index}0`, text, evidence: ['INT-001'], library: null })));
  manual.symptom_pages[0].info_rows = ['STM-900', 'STM-910'];
  assert.equal(forDisplay(manual, { library }).symptom_pages[0].info_note, '表にないフォルダ（営業）の接続先は記録がありません。工場の CAD 担当者に聞いてください。');
});

test('機器の一覧：台数の内訳と、同じ種類の機器から分かる「止まると」を補う', () => {
  const manual = build([{ id: 'T2', value: 'self', title: 'Wi-Fi', notes: ['事務所の PC は、OKOJO-OFFICE の Wi-Fi につながります。'] }], [], [
    { id: 'DEV-02', name: '無線 AP（事務所）', impact: '止まったときの影響の記録がありません。' },
    { id: 'DEV-03', name: '無線 AP（工場）', impact: '止まると、工場の Wi-Fi が切れます。' },
    { id: 'DEV-08', name: '設計用 PC（OKJ-CAD-01、CAD 用）', impact: '止まると、使えません。' },
    { id: 'DEV-09', name: '社員用の PC（全18台）', impact: '止まると、使えません。' },
  ]);
  const shown = forDisplay(manual, { library });
  const name = (id) => textOf(shown, shown.devices.find((device) => device.id === id).name);
  assert.equal(name('DEV-09'), '社員用の PC（全 18 台。うち 1 台が設計用 PC）');
  assert.equal(textOf(shown, shown.devices.find((device) => device.id === 'DEV-02').impact), '止まると、事務所の Wi-Fi が切れます。');
});

test('まだ分かっていないこと：質問を短くし、退職する本人の名前を出さない', () => {
  assert.equal(shortQuestion('【18問目】多要素認証について、田中さんご自身は設定済みですか。社長は分かりますか。', '田中'), '多要素認証について、前任者は設定済みですか。');
  assert.ok(shortQuestion('共有フォルダのうち、総務、営業、スキャンの3つは、それぞれ何に使い、どの部署や誰が使ってよいですか、それから誰が管理していて、どこに一覧がありますか。', '田中').endsWith('…'));
  const transcript = { entries: [{ status: 'answered', question: '答えた質問。' }, { status: 'unknown', question: '分からない質問。' }, { status: 'later', question: 'あとでの質問。' }] };
  assert.deepEqual(unknownItems(transcript, '田中'), ['分からない質問。', 'あとでの質問。']);
});

test('聞き取りの記録にない根拠を挙げる', () => {
  const manual = { statements: [{ evidence: ['INT-001', 'LIB-001'] }, { evidence: ['INT-009', 'INV-001'] }] };
  assert.deepEqual(missingInterviewEvidence(manual, { entries: [{ id: 'INT-001' }] }), ['INT-009']);
});
