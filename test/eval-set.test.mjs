// 評価セットの整合性テスト。正常なデータが合格することに加えて、
// データを壊すと検査が失敗すること（検査が本当に効いていること）も確かめる。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSet } from '../eval/lib/integrity.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const options = (root) => ({
  repoRoot: root,
  checklistPath: join(root, 'plugin/checklist/handover-items.json'),
  schemaRoot: root,
});

/** eval と plugin を一時フォルダに複製し、壊して検査する。 */
function withCopy(mutate) {
  const root = mkdtempSync(join(tmpdir(), 'hikitsugi-'));
  try {
    cpSync(join(ROOT, 'eval/sets'), join(root, 'eval/sets'), { recursive: true });
    cpSync(join(ROOT, 'eval/schemas'), join(root, 'eval/schemas'), { recursive: true });
    cpSync(join(ROOT, 'plugin/schemas'), join(root, 'plugin/schemas'), { recursive: true });
    cpSync(join(ROOT, 'plugin/checklist'), join(root, 'plugin/checklist'), { recursive: true });
    const setDir = join(root, 'eval/sets/okojo');
    mutate(setDir, root);
    return checkSet(setDir, options(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function editJson(path, fn) {
  const data = JSON.parse(readFileSync(path, 'utf8'));
  fn(data);
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

const includes = (problems, text) =>
  assert.ok(
    problems.some((p) => p.includes(text)),
    `「${text}」を含む問題が見つかりません:\n${problems.join('\n')}`,
  );

test('オコジョ精工の評価セットは整合している', () => {
  const problems = checkSet(join(ROOT, 'eval/sets/okojo'), options(ROOT));
  assert.deepEqual(problems, []);
});

test('誤りは E1〜E10 が1件ずつで、正しい記述は20件ある', () => {
  const { statements } = JSON.parse(readFileSync(join(ROOT, 'eval/sets/okojo/answers/verifier.json'), 'utf8'));
  const errors = statements.filter((s) => s.kind === 'seeded').map((s) => s.error);
  assert.equal(new Set(errors).size, 10);
  assert.equal(statements.filter((s) => s.kind === 'correct').length, 20);
});

test('正解の根拠の語を壊すと失敗する', () => {
  const problems = withCopy((setDir) => {
    editJson(join(setDir, 'answers/verifier.json'), (d) => {
      d.statements[0].support[0].contains = '存在しない語';
    });
  });
  includes(problems, '存在しない語');
});

test('期待判定を変えると失敗する', () => {
  const problems = withCopy((setDir) => {
    editJson(join(setDir, 'answers/verifier.json'), (d) => {
      d.statements.find((s) => s.error === 'E5').expected = 'contradiction';
    });
  });
  includes(problems, 'E5 の期待判定');
});

test('聞き取り記録を手で書き換えると失敗する', () => {
  const problems = withCopy((setDir) => {
    editJson(join(setDir, 'input/transcript.fixture.json'), (d) => {
      d.entries[0].answer = '書き換えた回答';
    });
  });
  includes(problems, '再生成したものと一致しません');
});

test('必須項目の正解が欠けると失敗する', () => {
  const problems = withCopy((setDir) => {
    editJson(join(setDir, 'answers/gaps.json'), (d) => {
      d.items[4].facts = [];
    });
  });
  includes(problems, '聞き取りで埋める事実がありません');
});

test('入力に E 番号が漏れると失敗する', () => {
  const problems = withCopy((setDir) => {
    editJson(join(setDir, 'input/statements.json'), (d) => {
      d.statements[0].text += '（E3）';
    });
  });
  includes(problems, '正解を示す語');
});

test('許可リストにない英字の語を入れると失敗する', () => {
  const problems = withCopy((setDir) => {
    editJson(join(setDir, 'input/survey.json'), (d) => {
      d.items.find((i) => i.key === 'hw.maker').value = 'ZzyxBrand';
    });
  });
  includes(problems, 'ZzyxBrand');
});

test('架空の形式でない電話番号を入れると失敗する', () => {
  const problems = withCopy((setDir) => {
    editJson(join(setDir, 'hidden/tanaka_facts.json'), (d) => {
      d.facts[0].answer += '連絡先は 03-1234-5678 です。';
    });
  });
  includes(problems, '架空の形式ではない電話番号');
});

test('E4 の例外はオコジョ精工だけで、他の会社の E4 は「根拠なし」でなければ失敗する', () => {
  const answerOf = (d) => d.statements.find((s) => s.error === 'E4');
  // オコジョ精工：優先順により矛盾なので、根拠なしに戻すと失敗する
  const okojo = withCopy((setDir) => {
    editJson(join(setDir, 'answers/verifier.json'), (d) => {
      answerOf(d).expected = 'unsupported';
    });
  });
  includes(okojo, 'E4 の期待判定');
  // 他の会社：同じ「矛盾」は認めない
  const other = withCopy((setDir) => {
    editJson(join(setDir, 'case.json'), (d) => {
      d.company = 'other';
    });
  });
  includes(other, 'E4 の期待判定');
});

test('使えない人名、法人名、業者名、IP、ドメインは失敗する', () => {
  const edit = (fn) => withCopy((setDir) => editJson(join(setDir, 'input/statements.json'), (d) => fn(d.statements[0])));
  includes(edit((s) => { s.text = '鈴木さんに連絡します。'; }), '使えない人名');
  includes(edit((s) => { s.text = '株式会社テストに連絡します。'; }), '使えない法人名');
  includes(edit((s) => { s.text = '機器は 10.0.0.1 にあります。'; }), '架空の形式ではない IP');
  includes(edit((s) => { s.text = '管理画面は admin.okojo-seiko.com です。'; }), '架空の形式ではないドメイン');
  const vendor = withCopy((setDir) => editJson(join(setDir, 'case.json'), (d) => { d.vendors[0].name = 'テスト通信'; }));
  includes(vendor, '使えない業者名');
});

test('例外のない会社の E4 が純粋な「根拠なし」でなければ失敗する', () => {
  const asOther = (fn = () => {}) =>
    withCopy((setDir) => {
      editJson(join(setDir, 'case.json'), (d) => { d.company = 'other'; });
      editJson(join(setDir, 'answers/verifier.json'), (d) => {
        d.statements.find((s) => s.error === 'E4').expected = 'unsupported';
      });
      fn(setDir);
    });
  // オコジョ精工の E4 のままだと、業者名がなく、根拠が「保守契約はありません」なので通らない
  includes(asOther(), 'E4 の記述に業者名がありません');
  includes(asOther(), 'E4 の根拠が記述を否定しています');
});

test('E4 の電話番号が根拠側に現れると失敗する', () => {
  const problems = withCopy((setDir) => {
    editJson(join(setDir, 'case.json'), (d) => {
      d.summary += '保守窓口 03-0000-0199。';
    });
  });
  includes(problems, 'E4 の電話番号が根拠側に存在します');
});

test('ダミーのパスワードを別のファイルに置くと失敗する', () => {
  const statements = JSON.parse(readFileSync(join(ROOT, 'eval/sets/okojo/input/statements.json'), 'utf8'));
  const answers = JSON.parse(readFileSync(join(ROOT, 'eval/sets/okojo/answers/verifier.json'), 'utf8'));
  const e5 = answers.statements.find((s) => s.error === 'E5');
  const text = statements.statements.find((s) => s.id === e5.id).text;
  const dummy = text.match(/パスワードは (\S+) です/)[1];
  const problems = withCopy((_setDir, root) => {
    writeFileSync(join(root, 'plugin/note.md'), `控え：${dummy}\n`);
  });
  includes(problems, 'ダミーの認証情報が決められた場所以外にあります');
});

test('別のパスワード本体を評価セットに入れると失敗する', () => {
  const problems = withCopy((setDir) => {
    editJson(join(setDir, 'hidden/tanaka_facts.json'), (d) => {
      d.facts[0].answer += 'パスワードは abcd1234 です。';
    });
  });
  includes(problems, '認証情報の形をした記述');
});
