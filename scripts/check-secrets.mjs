#!/usr/bin/env node
// push の前に実行する秘密情報の点検。依存なし。問題があれば終了コード 1。
// 使い方：node scripts/check-secrets.mjs [リポジトリのフォルダ]

import { execFileSync, spawnSync } from 'node:child_process';

// 実際のキーの形だけを探す。E5 の評価用ダミーは対象外で、eval/lib/integrity.mjs が別に検査する。
const SECRET_PATTERNS = [
  ['Anthropic の API キー', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['GitHub のトークン', /gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/],
  ['AWS のアクセスキー', /AKIA[0-9A-Z]{16}/],
  ['Slack のトークン', /xox[abpr]-[A-Za-z0-9-]{10,}/],
  ['秘密鍵', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['環境変数への直書き', /ANTHROPIC_API_KEY\s*=\s*["']?[A-Za-z0-9_-]{8,}/],
  ['キーの代入', /(?:api[_-]?key|secret|token)["']?\s*[:=]\s*["'][A-Za-z0-9_\-]{20,}["']/i],
];

const SECRET_FILE = /(^|\/)(\.env(\..+)?|.*\.pem|.*\.key|id_rsa|id_ed25519)$/;
const MUST_BE_IGNORED = ['.env', '.env.local', 'secret.pem', 'secret.key'];

export function checkSecrets(cwd) {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1024 ** 3 });
  const problems = [];

  // 1. 秘密のファイルが追跡されていないこと
  for (const file of git('ls-files').split('\n').filter(Boolean)) {
    if (SECRET_FILE.test(file) && !file.endsWith('.env.example')) {
      problems.push(`秘密のファイルが git で追跡されています: ${file}`);
    }
  }

  // 2. 秘密のファイルが .gitignore で無視されること
  for (const file of MUST_BE_IGNORED) {
    const ignored = spawnSync('git', ['check-ignore', '-q', '--no-index', file], { cwd }).status === 0;
    if (!ignored) problems.push(`.gitignore で無視されていません: ${file}`);
  }

  // 3. コミット履歴全体と、これからコミットされる変更に、キーの形がないこと
  const sources = [
    ['コミット履歴', git('log', '-p', '--no-ext-diff', '--format=commit %h', 'HEAD')],
    ['作業中の変更', git('diff', 'HEAD', '--no-ext-diff')],
  ];
  for (const [where, text] of sources) {
    for (const line of text.split('\n')) {
      // 削除行は履歴に残っていても、追加した時点の行で検出できる
      if (!line.startsWith('+')) continue;
      for (const [label, pattern] of SECRET_PATTERNS) {
        // 値そのものは表示しない
        if (pattern.test(line)) problems.push(`${where}に ${label} の形があります`);
      }
    }
  }
  return [...new Set(problems)];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const problems = checkSecrets(process.argv[2] ?? process.cwd());
  if (problems.length) {
    console.error('秘密情報の点検：問題があります。push しないでください。');
    for (const problem of problems) console.error(`- ${problem}`);
    process.exitCode = 1;
  } else {
    console.log('秘密情報の点検：問題なし（追跡ファイル、.gitignore、コミット履歴、作業中の変更）');
  }
}
