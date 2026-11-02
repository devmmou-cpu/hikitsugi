// 秘密情報の点検のテスト。一時的な git リポジトリを作って確かめる。
// キーの形の文字列は、このファイル自体が検出されないよう実行時に組み立てる。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSecrets } from '../scripts/check-secrets.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FAKE_KEY = ['sk', 'ant', 'a'.repeat(30)].join('-');
const GOOD_IGNORE = '.env\n.env.*\n!.env.example\n*.pem\n*.key\n';

function withRepo(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'hikitsugi-secrets-'));
  const git = (...args) =>
    execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...args], { cwd: dir, encoding: 'utf8' });
  try {
    git('init', '-q');
    writeFileSync(join(dir, '.gitignore'), GOOD_IGNORE);
    git('add', '.');
    git('commit', '-q', '-m', '最初');
    return fn(dir, git);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const has = (problems, text) => assert.ok(problems.some((p) => p.includes(text)), problems.join('\n') || '問題なし');

test('このリポジトリは点検に合格する', () => {
  assert.deepEqual(checkSecrets(ROOT), []);
});

test('問題のないリポジトリは合格する', () => {
  withRepo((dir) => assert.deepEqual(checkSecrets(dir), []));
});

test('.env が無視されていないと失敗する', () => {
  withRepo((dir) => {
    writeFileSync(join(dir, '.gitignore'), '*.pem\n*.key\n');
    has(checkSecrets(dir), '.gitignore で無視されていません: .env');
  });
});

test('.env を追跡すると失敗する', () => {
  withRepo((dir, git) => {
    writeFileSync(join(dir, '.env'), 'X=1\n');
    git('add', '-f', '.env');
    git('commit', '-q', '-m', '誤って追加');
    has(checkSecrets(dir), '追跡されています: .env');
  });
});

test('.env.example は追跡してよい', () => {
  withRepo((dir, git) => {
    writeFileSync(join(dir, '.env.example'), 'ANTHROPIC_API_KEY=\n');
    git('add', '.env.example');
    git('commit', '-q', '-m', '見本');
    assert.deepEqual(checkSecrets(dir), []);
  });
});

test('過去のコミットのキーは、消した後でも検出し、値は表示しない', () => {
  withRepo((dir, git) => {
    writeFileSync(join(dir, 'a.txt'), `${FAKE_KEY}\n`);
    git('add', '.');
    git('commit', '-q', '-m', '混入');
    writeFileSync(join(dir, 'a.txt'), 'なし\n');
    git('add', '.');
    git('commit', '-q', '-m', '削除');
    const problems = checkSecrets(dir);
    has(problems, 'コミット履歴に Anthropic の API キー');
    assert.ok(!problems.join('\n').includes(FAKE_KEY));
  });
});

test('未コミットの変更にあるキーも検出する', () => {
  withRepo((dir, git) => {
    writeFileSync(join(dir, 'a.txt'), 'なし\n');
    git('add', '.');
    git('commit', '-q', '-m', '追加');
    writeFileSync(join(dir, 'a.txt'), `${FAKE_KEY}\n`);
    has(checkSecrets(dir), '作業中の変更に Anthropic の API キー');
  });
});
