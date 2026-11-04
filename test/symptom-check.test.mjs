// 症状ページの抜けの検査。クズリ運輸の記録（模擬評価 20261103T225654）から、検査に要る部分だけを写した。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { additionProblems, applySymptomAnswer, basisProblems, symptomGaps } from '../plugin/lib/symptom-check.mjs';

const KUZURI_PAGES = ['共有フォルダが見えない', '営業所だけ社内につながらない', '車庫の Wi-Fi が切れる', '配車システムの画面が動かない', 'ウイルス感染が疑われる PC がある', '怪しいメールが来た', '回線が止まってネットが使えない', '社員がパスワードを忘れた', '営業所の NAS が満杯に近い', '停電のあと、配車システムが使えない', '複合機が故障した'];

const KUZURI_ANSWER = 'NAS は本社のサーバー室にあり、ディスク構成は RAID1 です。管理画面を開いて確かめました。NAS は年間保守に入っていて、受け付けはカワウソシステムサービスです。ディスクの交換もそこに頼みます。NAS の管理画面は、本社の PC のブラウザーで 192.168.10.20 を開くと入れます。配車システムは、本社のサーバー室にある専用のサーバーで動いています。停電のあと NAS は自動で起動します。配車サーバーだけは手で電源を入れ、起動したらイイズナソフトに連絡します。';

const manualWith = (titles, contacts = ['カワウソシステムサービス', 'イイズナソフト']) => ({
  statements: titles.map((text, index) => ({ id: `STM-${String(index + 1).padStart(3, '0')}`, text, evidence: [] })),
  symptom_pages: titles.map((_, index) => ({ id: `T${index + 1}`, title: `STM-${String(index + 1).padStart(3, '0')}` })),
  contacts: contacts.map((name, index) => ({ id: `VEN-0${index + 1}`, name })),
});
const entry = (id, covers, answer, status = 'answered') => ({ id, covers, answer, status });

test('クズリ運輸の記録で、NAS のディスクが挙がる', () => {
  const transcript = { entries: [
    entry('INT-004', ['CHK-09', 'CHK-11', 'CHK-14', 'CHK-15'], KUZURI_ANSWER),
    entry('INT-012', ['CHK-35', 'CHK-36'], 'NAS は年間保守に入っていて、受け付けはカワウソシステムサービスです。ディスクの交換もそこに頼みます。'),
  ] };
  const gaps = symptomGaps(manualWith(KUZURI_PAGES), transcript, '田中さん');
  const disk = gaps.find((gap) => gap.detail.includes('ディスク'));
  assert.ok(disk, JSON.stringify(gaps));
  assert.equal(disk.detail, 'ディスクの交換もそこに頼みます');
  // 困りごとを聞いていない項目の答えでも、同じ文なら根拠に数える
  assert.deepEqual(disk.sources, ['INT-004', 'INT-012']);
  // 題名に同じ語がある答えは挙げない
  assert.ok(!gaps.some((gap) => gap.detail.includes('配車サーバー')), JSON.stringify(gaps));
});

test('同じ語の題名のページがあれば挙げない', () => {
  const transcript = { entries: [entry('INT-001', ['CHK-37'], 'ディスクの交換はカワウソシステムサービスに頼みます。')] };
  assert.deepEqual(symptomGaps(manualWith(['NAS のディスクの調子が悪い']), transcript), []);
});

test('困りごとを聞いていない項目、答えのない回答、入退社の文は挙げない', () => {
  const titles = ['関係のないページ'];
  assert.deepEqual(symptomGaps(manualWith(titles), { entries: [entry('INT-001', ['CHK-35'], 'ディスクの交換はカワウソシステムサービスに頼みます。')] }), []);
  assert.deepEqual(symptomGaps(manualWith(titles), { entries: [entry('INT-001', ['CHK-37'], 'ディスクが壊れたら頼みます。', 'unknown')] }), []);
  assert.deepEqual(symptomGaps(manualWith(titles), { entries: [entry('INT-001', ['CHK-37'], '退職のときはライセンスを外して社長に連絡します。')] }), []);
});

test('主語が前の文にある短い文は、前の文の語で照合する', () => {
  const answer = '複合機のリース会社はイタチ事務機です。故障もイタチ事務機に連絡します。';
  const transcript = { entries: [entry('INT-001', ['CHK-27'], answer)] };
  assert.deepEqual(symptomGaps(manualWith(['複合機が故障した'], ['イタチ事務機']), transcript), []);
  assert.equal(symptomGaps(manualWith(['ネットがつながらない'], ['イタチ事務機']), transcript).length, 1);
});

test('同じ文は1件にまとめる', () => {
  const transcript = { entries: [entry('INT-001', ['CHK-37'], 'ディスクが壊れたら頼みます。'), entry('INT-002', ['CHK-38'], 'ディスクが壊れたら頼みます。')] };
  const gaps = symptomGaps(manualWith(['関係のないページ']), transcript);
  assert.equal(gaps.length, 1);
  assert.deepEqual(gaps[0].sources, ['INT-001', 'INT-002']);
});

const GAPS = [{ id: 'SYM-1', sources: ['INT-004'], detail: 'ディスクの交換もそこに頼みます' }, { id: 'SYM-2', sources: ['INT-005'], detail: 'ディスクが壊れたら頼みます' }, { id: 'SYM-3', sources: ['INT-006'], detail: '関係のない文です' }];
const PLAN = [{ id: 'T1' }, { id: 'T11' }];

test('答えを、足すページと外す理由に分ける。同じ症状は1ページにまとめる', () => {
  const decisions = [
    { gap: 'SYM-1', decision: 'page', reason: '', category: 'other', symptom: 'NAS のディスクが壊れた' },
    { gap: 'SYM-2', decision: 'page', reason: '', category: 'other', symptom: 'NAS のディスクが壊れた' },
    { gap: 'SYM-3', decision: 'exclude', reason: '困りごとの話ではありません', category: null, symptom: null },
  ];
  const { problems, additions, exclusions } = applySymptomAnswer({ decisions }, GAPS, PLAN);
  assert.deepEqual(problems, []);
  assert.equal(additions.length, 1);
  assert.equal(additions[0].id, 'T12');
  assert.deepEqual(additions[0].sources, ['INT-004', 'INT-005']);
  assert.deepEqual(exclusions, [{ source: 'INT-006', detail: '関係のない文です', reason: '困りごとの話ではありません' }]);
});

test('答えのない件、理由のない除外、症状のないページ、一覧にない件を問題にする', () => {
  const decisions = [
    { gap: 'SYM-1', decision: 'exclude', reason: ' ', category: null, symptom: null },
    { gap: 'SYM-2', decision: 'page', reason: '', category: null, symptom: null },
    { gap: 'SYM-9', decision: 'exclude', reason: '理由', category: null, symptom: null },
  ];
  const { problems } = applySymptomAnswer({ decisions }, GAPS, PLAN);
  assert.equal(problems.length, 4, problems.join('\n'));
});

test('足したページがなければ問題にする。ページの根拠に挙がった答えが要る', () => {
  const addition = { id: 'T12', symptom: 'NAS のディスクが壊れた', sources: ['INT-004', 'INT-012'] };
  assert.equal(additionProblems({ symptom_pages: [{ id: 'T1' }] }, [addition]).length, 1);
  assert.deepEqual(additionProblems({ symptom_pages: [{ id: 'T12' }] }, [addition]), []);
  assert.equal(basisProblems([{ evidence: ['INT-001'] }], addition).length, 1);
  assert.deepEqual(basisProblems([{ evidence: ['INT-012'] }], addition), []);
});
