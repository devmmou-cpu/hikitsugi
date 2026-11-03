#!/usr/bin/env node
// Claude Code のフック（PreToolUse、Bash）。git push の前に npm test を実行し、失敗したら止める。
// 終了コード 2 で、コマンドの実行を止めて理由を伝える。

import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** コマンドの中に git push があるか。`&&` や `;` でつないだものや、git -C の形も見つける。 */
export const runsGitPush = (command) => /(?:^|[;&|(\n]|\s)git\s+(?:-[Cc]\s+\S+\s+|--?[a-z-]+(?:=\S+)?\s+)*push(?:\s|$|[;&|)])/.test(command);

/** テストの結果の要約を作る。失敗したテストの名前だけを伝える。 */
function summarize(output) {
  const failed = [...new Set(output.split('\n').filter((line) => /^✖ /.test(line) && !line.includes('failing tests')))];
  const counts = output.split('\n').filter((line) => /^ℹ (tests|pass|fail) /.test(line));
  return [...counts, ...failed.slice(0, 20)].join('\n');
}

function main() {
  const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
  if (!runsGitPush(input.tool_input?.command ?? '')) return 0;
  const cwd = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
  const result = spawnSync('npm', ['test'], { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (result.status === 0) return 0;
  console.error(`npm test が通らないので、git push を止めました。\n${summarize(`${result.stdout}\n${result.stderr}`)}`);
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exitCode = main();
