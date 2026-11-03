// Claude Code のフックのテスト。設定と、実行したときの止まり方を確かめる。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { manualHtmlProblems, writtenHtmlPaths } from '../scripts/hooks/check-manual-html.mjs';
import { runsGitPush } from '../scripts/hooks/pre-push-test.mjs';
import { renderManual } from '../plugin/renderer/render.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUSH_HOOK = join(ROOT, 'scripts/hooks/pre-push-test.mjs');
const HTML_HOOK = join(ROOT, 'scripts/hooks/check-manual-html.mjs');
const withTemp = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'hikitsugi-hook-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
const page = (body) => `<!doctype html><html><head><style>a{color:#123456} .x{width:0.5in} /* style.css */</style></head><body>${body}<script>const u = "fake.invalid"; const t = "06-0000-0000";</script></body></html>`;

test('設定：git push の前と、HTML を書き出したあとにフックが動く。失敗したら止める', () => {
  const { hooks } = JSON.parse(readFileSync(join(ROOT, '.claude/settings.json'), 'utf8'));
  const push = hooks.PreToolUse.find((entry) => entry.matcher === 'Bash').hooks[0];
  assert.match(push.command, /scripts\/hooks\/pre-push-test\.mjs/);
  assert.equal(push.onFailure, 'block');
  assert.ok(push.timeout >= 300);
  const html = hooks.PostToolUse.find((entry) => /Bash/.test(entry.matcher) && /Write/.test(entry.matcher)).hooks[0];
  assert.match(html.command, /scripts\/hooks\/check-manual-html\.mjs/);
});

test('git push を見つける。つないだ形も、関係のないコマンドも正しく分ける', () => {
  for (const command of ['git push', 'git push origin main', 'npm test; git push origin main', 'git branch -f main x && git push origin main 2>&1 | tail -1', 'git -C ../x push', '(git push)', 'cd x\ngit push']) {
    assert.equal(runsGitPush(command), true, command);
  }
  for (const command of ['git status', 'git commit -m "x"', 'git stash push -m x', 'echo pushed', 'ls git/push']) {
    assert.equal(runsGitPush(command), false, command);
  }
});

const runPushHook = (projectDir, command) =>
  spawnSync(process.execPath, [PUSH_HOOK], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir } });

test('フック：テストが失敗したら git push を止め（終了コード 2）、成功なら通す', () => {
  withTemp((dir) => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'exit 1' } }));
    const failed = runPushHook(dir, 'git push origin main');
    assert.equal(failed.status, 2);
    assert.match(failed.stderr, /git push を止めました/);
    // 関係のないコマンドでは、テストを走らせない
    assert.equal(runPushHook(dir, 'git status').status, 0);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'exit 0' } }));
    assert.equal(runPushHook(dir, 'git push origin main').status, 0);
  });
});

test('今日の形：失敗を見ないでつないだ push も止める', () => {
  withTemp((dir) => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'exit 1' } }));
    assert.equal(runPushHook(dir, 'npm test | grep fail; git commit -m x; git branch -f main x && git push origin main').status, 2);
  });
});

test('HTML の検査：架空の形式は通す。CSS と JavaScript の中は見ない', () => {
  assert.deepEqual(manualHtmlProblems(page('<a href="tel:03-0000-0101">03-0000-0101</a> <a href="tel:0300000102">電話</a> okojo-seiko.example kuzuri-unyu.example 192.168.10.5 2026-11-05 10.0.26100 報告書.pdf')), []);
  assert.deepEqual(manualHtmlProblems(page('パスワードは総務の金庫にあります。')), []);
});

test('HTML の検査：パスワードらしい文字列、形式の違う電話番号、ドメインを見つけ、値は出さない', () => {
  const secret = 'Abcd1234xyz';
  const found = manualHtmlProblems(page(`パスワードは ${secret} です。`));
  assert.match(found.join(), /パスワードらしい/);
  assert.ok(!found.join().includes(secret));
  assert.match(manualHtmlProblems(page('パスワード：abcd1234')).join(), /パスワードらしい/);
  for (const phone of ['06-0000-0000', '03-0000-0200', '0120-000-000', '０６-００００-００００', '0600000000']) {
    assert.match(manualHtmlProblems(page(`電話は ${phone} です。`)).join(), /電話番号/, phone);
  }
  assert.match(manualHtmlProblems(page('<a href="tel:06-0000-0000">電話</a>')).join(), /電話番号/);
  for (const domain of ['fake-company.invalid', 'mail.fake.test', 'info@fake.invalid']) {
    assert.match(manualHtmlProblems(page(`${domain} です。`)).join(), /ドメイン/, domain);
  }
  assert.match(manualHtmlProblems(page('<a href="https://fake.invalid/x">サイト</a>')).join(), /ドメイン/);
});

test('見本の取扱説明書は、HTML の検査に合格する', () => {
  for (const name of ['manual-t1', 'manual-full']) {
    const manual = JSON.parse(readFileSync(join(ROOT, `test/fixtures/${name}.json`), 'utf8'));
    assert.deepEqual(manualHtmlProblems(renderManual(manual)), [], name);
  }
});

test('書き出した HTML のパスを、ツールの実行から探す', () => {
  const cwd = '/work';
  assert.deepEqual(writtenHtmlPaths({ cwd, tool_name: 'Write', tool_input: { file_path: '/a/b.html' } }), ['/a/b.html']);
  assert.deepEqual(writtenHtmlPaths({ cwd, tool_name: 'Edit', tool_input: { file_path: '/a/b.mjs' } }), []);
  assert.deepEqual(writtenHtmlPaths({ cwd, tool_name: 'Bash', tool_input: { command: 'node plugin/renderer/render.mjs in.json out/manual.html' } }), ['/work/out/manual.html']);
  assert.deepEqual(writtenHtmlPaths({ cwd, tool_name: 'Bash', tool_input: { command: 'cat x.html' } }), []);
  // 名前が引数に出ただけでは、束の出力先と取り違えない
  assert.deepEqual(writtenHtmlPaths({ cwd, tool_name: 'Bash', tool_input: { command: 'grep -n x plugin/renderer/phone.mjs plugin/lib/page-check.mjs plugin/lib/assemble.mjs' } }), []);
  assert.deepEqual(writtenHtmlPaths({ cwd, tool_name: 'Bash', tool_input: { command: 'node plugin/renderer/phone.mjs in.json out/phone' } }), ['/work/out/phone']);
  assert.deepEqual(writtenHtmlPaths({ cwd, tool_name: 'Bash', tool_input: { command: 'node --env-file=.env eval/pipeline.mjs --set okojo' }, tool_response: { stdout: '保存先：eval/results/r1\n' } }), ['/work/eval/results/r1/manual.html']);
  assert.deepEqual(writtenHtmlPaths({ cwd, tool_name: 'Bash', tool_input: { command: 'node "x/scripts/hikitsugi.mjs" render' } }), ['/work/hikitsugi-work/manual.html']);
});

test('フック：問題のある HTML は改名して止め（終了コード 2）、問題がなければそのまま', () => {
  withTemp((dir) => {
    const bad = join(dir, 'bad.html');
    const good = join(dir, 'good.html');
    writeFileSync(bad, page('電話は 06-0000-0000 です。'));
    writeFileSync(good, page('電話は 03-0000-0101 です。'));
    const run = (path) => spawnSync(process.execPath, [HTML_HOOK], { input: JSON.stringify({ cwd: dir, tool_name: 'Write', tool_input: { file_path: path } }), encoding: 'utf8' });
    const blocked = run(bad);
    assert.equal(blocked.status, 2);
    assert.match(blocked.stderr, /電話番号/);
    assert.ok(!blocked.stderr.includes('06-0000-0000'));
    assert.ok(!existsSync(bad) && existsSync(`${bad}.blocked`));
    assert.equal(run(good).status, 0);
    assert.ok(existsSync(good));
    // 書き出していないときは何もしない
    assert.equal(run(join(dir, 'none.html')).status, 0);
  });
});
