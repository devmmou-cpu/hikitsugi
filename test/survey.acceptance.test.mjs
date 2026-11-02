// 調査スクリプトと、複数 PC の結果をまとめるプログラムの合格テスト。夜間の作業ではこのファイルを変更しない。
// Mac では PowerShell を実行しないので、スクリプトは静的に検査する。実機の確認は本人が Windows 11 Pro で行う。
//
// 約束
// - plugin/scripts/survey.ps1：Windows PowerShell 5.1 の標準機能だけで動く。読み取り専用で、変更、送信、他の機器への走査をしない
// - 1台分の結果（生データ）の形は test/fixtures/survey-raw/ の見本のとおり
// - 使える項目名は下の KEY_PATTERNS のとおり。評価データの調査項目と同じ名前
// - plugin/lib/merge-survey.mjs：mergeSurveys(raws, { company }) を export する。生データの配列から survey の形を返し、問題があれば例外を投げる
// - plugin/scripts/merge-survey.mjs：node merge-survey.mjs <出力.json> <会社の ID> <生データ1.json> [生データ2.json ...]
//   終了コード：0＝成功、1＝内容の問題（出力ファイルを作らない）、2＝引数の誤り
// - 認証情報らしい値を見つけて止めるときは、値そのものを表示しない

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validate } from '../plugin/lib/validate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'plugin/scripts/survey.ps1');
const LIB = join(ROOT, 'plugin/lib/merge-survey.mjs');
const CLI = join(ROOT, 'plugin/scripts/merge-survey.mjs');
const schema = JSON.parse(readFileSync(join(ROOT, 'plugin/schemas/survey.schema.json'), 'utf8'));
const rawOf = (name) => JSON.parse(readFileSync(join(ROOT, 'test/fixtures/survey-raw', `${name}.json`), 'utf8'));

const KEY_PATTERNS = [
  /^os\.caption$/, /^os\.version$/, /^hw\.maker$/, /^hw\.model$/, /^hw\.memory_gb$/, /^disk\.c_free_gb$/,
  /^net\.ip_mode$/, /^net\.gateway$/, /^net\.dns$/, /^net\.wifi_ssid$/,
  /^share\.drive\.[A-Z]$/, /^printer\.\d+$/, /^software\.\d+$/,
  /^security\.last_update$/, /^security\.feature_update$/, /^security\.antivirus$/, /^security\.bitlocker$/,
  /^account\.join_type$/, /^account\.m365_signed_in$/,
];

// ---- 調査スクリプトの静的な検査 ----
const bytes = existsSync(SCRIPT) ? readFileSync(SCRIPT) : Buffer.alloc(0);
const source = bytes.toString('utf8').replace(/^﻿/, '');
/** コメントを除いた本文。ブロックコメントと行コメントを消す。文字列の中の # は残す。 */
const code = source
  .replace(/<#[\s\S]*?#>/g, '')
  .split(/\r?\n/)
  .map((line) => {
    let quote = null;
    for (let i = 0; i < line.length; i += 1) {
      const c = line[i];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '#') return line.slice(0, i);
    }
    return line;
  })
  .join('\n');

// 読み取りだけのコマンド。ここにないコマンド（動詞-名詞の形）は使えない
const ALLOWED_CMDLETS = new Set([
  'Get-CimInstance', 'Get-ItemProperty', 'Get-ItemPropertyValue', 'Get-NetIPConfiguration', 'Get-NetIPInterface', 'Get-DnsClientServerAddress',
  'Get-SmbMapping', 'Get-PSDrive', 'Get-Printer', 'Get-HotFix', 'Get-MpComputerStatus', 'Get-BitLockerVolume', 'Get-Date', 'Get-Location', 'Get-Command',
  'Test-Path', 'Join-Path', 'Split-Path',
  'Select-Object', 'Where-Object', 'ForEach-Object', 'Sort-Object', 'Measure-Object', 'Group-Object',
  'ConvertTo-Json', 'Write-Host', 'Write-Output', 'Write-Warning', 'Read-Host',
  'Wi-Fi', // コマンドではなく、案内の文の中の語
]);
const FORBIDDEN = [
  [/\bInvoke-(WebRequest|RestMethod|Expression|Command)\b/i, '外部への送信やコードの実行'],
  [/\b(iwr|irm|iex|curl|wget)\b/i, '外部への送信やコードの実行'],
  [/\b(Start-Process|Start-Job|Start-BitsTransfer|Enter-PSSession|New-PSSession|Send-MailMessage)\b/i, '別のプロセスや送信'],
  [/\[(System\.)?Net\b|\bNet\.WebClient\b|\bSystem\.Net\b|\bTcpClient\b|\bUdpClient\b/i, 'ネットワークの利用'],
  [/\bAdd-Type\b|-EncodedCommand|\bFromBase64String\b|\bDownloadString\b/i, 'コードの動的な実行'],
  [/\b(Test-Connection|Test-NetConnection|Resolve-DnsName|Get-NetNeighbor|Get-NetTCPConnection|ping|tracert|arp|nslookup|nmap)\b/i, '他の機器への走査'],
  [/\b(cmdkey|vaultcmd|Get-StoredCredential|ConvertFrom-SecureString|Get-Credential|mimikatz|dpapi)\b/i, '認証情報の取得'],
  [/\bkey=clear\b|\bshow\s+profiles?\b/i, 'Wi-Fi のパスワードの取得'],
  [/\b(Set|Remove|New|Clear|Rename|Move|Copy|Enable|Disable|Stop|Restart|Install|Uninstall|Update|Register|Unregister)-[A-Z][A-Za-z]+\b/, '変更'],
  [/\bGet-Content\b|\bGet-ChildItem\b|\bdir\b|\bls\b|\bgci\b/i, 'ファイルの中身やフォルダの一覧'],
  [/\bOut-File\b|\bAdd-Content\b|\bTee-Object\b|\bExport-[A-Z]/i, '決まった保存先以外への書き込み'],
  [/Win32_Product/i, 'Win32_Product は読むだけで修復が走るので使わない'],
  [/\bregedit\b|\breg(\.exe)?\s+(add|delete|import|copy|save|load)\b|\bschtasks\b|\bsc(\.exe)?\s+\w+|\bwmic\b/i, '変更や古いコマンド'],
];

test('調査スクリプトがあり、5.1 の日本語が崩れないよう BOM つき UTF-8 で書いてある', () => {
  assert.ok(existsSync(SCRIPT), 'plugin/scripts/survey.ps1 がありません');
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'Windows PowerShell 5.1 は BOM がないと日本語を正しく読めません');
});

test('使うコマンドは読み取りだけの許可リストの中にある', () => {
  const used = [...new Set(code.match(/\b[A-Z][a-z]+-[A-Z][A-Za-z0-9]+\b/g) ?? [])];
  assert.ok(used.length > 0);
  const stray = used.filter((name) => !ALLOWED_CMDLETS.has(name));
  assert.deepEqual(stray, []);
});

test('変更、送信、走査、認証情報の取得につながるものを使わない', () => {
  for (const [pattern, reason] of FORBIDDEN) assert.doesNotMatch(code, pattern, reason);
});

test('外部のコマンドは、Wi-Fi 名を読む netsh wlan show interfaces だけ', () => {
  const natives = [...code.matchAll(/\b([a-z]+)\.exe\b|\b(netsh|ipconfig|systeminfo|whoami|hostname|dsregcmd|manage-bde)\b/gi)].map((m) => (m[1] ?? m[2]).toLowerCase());
  for (const name of natives) assert.equal(name, 'netsh', `使えない外部コマンド：${name}`);
  for (const [line] of code.matchAll(/^.*\bnetsh\b.*$/gim)) assert.match(line, /netsh(\.exe)?\s+wlan\s+show\s+interfaces/i, line);
});

test('ファイルへの書き込みは結果の1か所だけで、今いるフォルダに保存する', () => {
  const writes = code.match(/\[(System\.)?IO\.File\]::Write\w+/g) ?? [];
  assert.equal(writes.length, 1, '書き込みは [System.IO.File]::WriteAllText の1か所だけ');
  assert.doesNotMatch(code, /\$env:(TEMP|TMP|APPDATA|LOCALAPPDATA|ProgramData)\b/i);
  assert.match(code, /hikitsugi-survey-/, '結果のファイル名は hikitsugi-survey- で始める');
});

test('実行前に集める内容と集めない内容を見せ、同意がなければ何も集めない', () => {
  assert.match(code, /Read-Host/);
  for (const word of ['PC 名', 'ネットワーク', '共有フォルダ', 'プリンター', 'ソフト', 'セキュリティ', 'アカウント']) assert.ok(source.includes(word), word);
  for (const word of ['パスワード', 'ファイルの中身', 'メールの中身', '閲覧履歴']) assert.ok(source.includes(word), word);
  const consent = code.search(/Read-Host/);
  const firstRead = code.search(/\bGet-(CimInstance|ItemProperty|NetIPConfiguration|SmbMapping|Printer|HotFix|MpComputerStatus|BitLockerVolume)\b/);
  // 関数の定義の中に集める処理を書いてもよいが、呼び出しは同意のあと。最後の同意の分岐より後で collect を呼ぶ形は下で確かめる
  assert.ok(consent >= 0 && firstRead >= 0);
  assert.match(code, /if\s*\([^)]*-(ne|notmatch|notin|cne)\b[^)]*\)\s*\{[^}]*\b(exit|return)\b/i, '同意しなければ終了する分岐が必要です');
});

test('管理者権限を求めず、PC の設定を変えない', () => {
  assert.doesNotMatch(code, /#requires\s+-RunAsAdministrator/i);
  assert.doesNotMatch(source, /#requires\s+-RunAsAdministrator/i);
  assert.doesNotMatch(code, /-Verb\s+RunAs/i);
  assert.doesNotMatch(code, /ExecutionPolicy/i);
});

test('必須の項目をすべて集める', () => {
  for (const key of ['os.caption', 'os.version', 'hw.maker', 'hw.model', 'hw.memory_gb', 'disk.c_free_gb', 'net.ip_mode', 'net.gateway', 'net.dns', 'net.wifi_ssid', 'share.drive.', 'printer.', 'software.', 'security.last_update', 'security.antivirus', 'security.bitlocker', 'account.join_type', 'account.m365_signed_in']) {
    assert.ok(code.includes(key), key);
  }
});

test('項目ごとに失敗を受け止め、取れない項目は unavailable か denied と記録する', () => {
  assert.ok((code.match(/\btry\b/g) ?? []).length >= 1);
  assert.ok((code.match(/\bcatch\b/g) ?? []).length >= 1);
  for (const status of ['ok', 'unavailable', 'denied']) assert.ok(code.includes(`'${status}'`) || code.includes(`"${status}"`), status);
  assert.match(code, /UnauthorizedAccess|Access(\s)?Denied|PermissionDenied|アクセス/i, '権限がないときの denied を区別する');
});

test('JSON は深さを指定して UTF-8 で書き、PC 名と取得日時を持つ', () => {
  assert.match(code, /ConvertTo-Json[^\n]*-Depth\s+\d/);
  assert.match(code, /UTF8Encoding|UTF8/);
  for (const field of ['schema_version', 'host', 'collected_at', 'items']) assert.ok(code.includes(field), field);
  assert.match(code, /\$env:COMPUTERNAME|Win32_ComputerSystem/);
  // 日時はタイムゾーンつきの形
  assert.match(code, /Get-Date[^\n]*(-Format\s+['"]?[^\n]*zzz|ToString\(['"][^\n]*zzz)/);
});

test('結果の中身を確かめてから渡すよう案内する', () => {
  assert.match(source, /中身を確か|中身を確認/);
  assert.match(source, /hikitsugi-survey-/);
});

test('スクリプトに実在しうる値を書き込んでいない', () => {
  assert.doesNotMatch(source, /\b(?:\d{1,3}\.){3}\d{1,3}\b/, 'IP アドレスを書かない');
  assert.doesNotMatch(source, /https?:\/\//, 'URL を書かない');
  assert.doesNotMatch(source, /\\\\[A-Za-z0-9_-]+\\/, '接続先を書かない');
});

// ---- まとめるプログラム ----
const merge = async () => (await import(pathToFileURL(LIB).href)).mergeSurveys;

test('見本の生データは、約束の項目名だけを使っている', () => {
  for (const name of ['pc-a', 'pc-b']) {
    for (const item of rawOf(name).items) assert.ok(KEY_PATTERNS.some((p) => p.test(item.key)), item.key);
  }
});

test('複数 PC をまとめると survey の形になり、ID は PC 名、項目名の順に振る', async () => {
  const mergeSurveys = await merge();
  const survey = mergeSurveys([rawOf('pc-b'), rawOf('pc-a')], { company: 'okojo' });
  assert.deepEqual(validate(schema, survey), []);
  assert.equal(survey.company, 'okojo');
  assert.equal(survey.items.length, rawOf('pc-a').items.length + rawOf('pc-b').items.length);
  const order = survey.items.map((item) => [item.host, item.key]);
  const sorted = [...order].sort((x, y) => (x[0] === y[0] ? (x[1] < y[1] ? -1 : 1) : x[0] < y[0] ? -1 : 1));
  assert.deepEqual(order, sorted);
  assert.deepEqual(survey.items.map((item) => item.id), survey.items.map((_, i) => `INV-${String(i + 1).padStart(3, '0')}`));
  assert.equal(survey.items[0].host, 'OKJ-CAD-01');
  assert.equal(survey.items[0].collected_at, '2026-11-04T17:10:00+09:00');
});

test('入力の順番によらず、同じ結果になる', async () => {
  const mergeSurveys = await merge();
  assert.deepEqual(mergeSurveys([rawOf('pc-a'), rawOf('pc-b')], { company: 'okojo' }), mergeSurveys([rawOf('pc-b'), rawOf('pc-a')], { company: 'okojo' }));
});

test('基準日は、いちばん新しい取得日にする。接続先の \\\\ と、値がない項目はそのまま残す', async () => {
  const mergeSurveys = await merge();
  const survey = mergeSurveys([rawOf('pc-a'), rawOf('pc-b')], { company: 'okojo' });
  assert.equal(survey.as_of, '2026-11-05');
  const drive = survey.items.find((item) => item.key === 'share.drive.S');
  assert.equal(drive.value, '\\\\OKOJO-NAS\\スキャン');
  const denied = survey.items.find((item) => item.key === 'security.bitlocker');
  assert.equal(denied.status, 'denied');
  assert.equal(denied.value, null);
  assert.equal(survey.items.find((item) => item.key === 'hw.memory_gb' && item.host === 'OKJ-CAD-01').value, 32);
  assert.equal(survey.items.find((item) => item.key === 'account.m365_signed_in').value, true);
});

const broken = (edit) => {
  const raw = rawOf('pc-a');
  edit(raw);
  return raw;
};

test('形が違う生データは、理由を示して止める', async () => {
  const mergeSurveys = await merge();
  const cases = [
    [broken((r) => { r.schema_version = 2; }), /schema_version|形式/],
    [broken((r) => { delete r.host; }), /host|PC/],
    [broken((r) => { r.host = ''; }), /host|PC/],
    [broken((r) => { r.collected_at = '昨日'; }), /collected_at|日時/],
    [broken((r) => { r.items = 'x'; }), /items|項目/],
    [broken((r) => { r.items[0].status = 'maybe'; }), /status|状態/],
    [broken((r) => { r.items[0].category = 'unknown'; }), /category|区分/],
    [broken((r) => { r.items[0].value = { nested: 1 }; }), /value|値/],
    [broken((r) => { r.items[0].status = 'ok'; r.items[0].value = null; }), /value|値/],
    [broken((r) => { r.items.push({ ...r.items[0] }); }), /重複/],
  ];
  for (const [raw, pattern] of cases) assert.throws(() => mergeSurveys([raw], { company: 'okojo' }), pattern);
  assert.throws(() => mergeSurveys([], { company: 'okojo' }), /生データ|1台/);
  assert.throws(() => mergeSurveys([rawOf('pc-a'), rawOf('pc-a')], { company: 'okojo' }), /重複/);
});

test('約束にない項目は受け付けない', async () => {
  const mergeSurveys = await merge();
  for (const key of ['wifi.password', 'user.documents', 'browser.history', 'os.caption2', 'share.drive.ZZ']) {
    assert.throws(() => mergeSurveys([broken((r) => { r.items.push({ category: 'os', key, value: 'x', status: 'ok' }); })], { company: 'okojo' }), /項目/, key);
  }
});

test('認証情報らしい値があれば止め、値そのものはエラーに出さない', async () => {
  const mergeSurveys = await merge();
  const secret = 'Abcd1234xyz';
  for (const value of [`パスワードは ${secret}`, `password=${secret}`, `\\\\NAS\\share password: ${secret}`]) {
    const raw = broken((r) => { r.items.push({ category: 'share', key: 'share.drive.Q', value, status: 'ok' }); });
    assert.throws(() => mergeSurveys([raw], { company: 'okojo' }), (error) => {
      assert.match(error.message, /認証情報/);
      assert.ok(!error.message.includes(secret), '値を表示してはいけません');
      return true;
    });
  }
});

test('999 件を超えると ID を振れないので止める', async () => {
  const mergeSurveys = await merge();
  const raw = broken((r) => {
    r.items = Array.from({ length: 1000 }, (_, i) => ({ category: 'software', key: `software.${i}`, value: `ソフト${i}`, status: 'ok' }));
  });
  assert.throws(() => mergeSurveys([raw], { company: 'okojo' }), /999|件/);
});

const runCli = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

test('コマンド：まとめた結果をファイルに保存し、BOM つきの生データも読める', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hikitsugi-survey-'));
  try {
    const a = join(dir, 'a.json');
    const b = join(dir, 'b.json');
    writeFileSync(a, `﻿${JSON.stringify(rawOf('pc-a'))}`);
    writeFileSync(b, JSON.stringify(rawOf('pc-b')));
    const out = join(dir, 'survey.json');
    const result = runCli([out, 'okojo', a, b]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(validate(schema, JSON.parse(readFileSync(out, 'utf8'))), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('コマンド：内容に問題があれば出力ファイルを作らず、終了コード 1。引数の誤りは 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hikitsugi-survey-'));
  try {
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{ これは JSON ではありません');
    const out = join(dir, 'survey.json');
    assert.equal(runCli([out, 'okojo', bad]).status, 1);
    assert.ok(!existsSync(out));
    assert.equal(runCli([out, 'okojo']).status, 2);
    assert.equal(runCli([]).status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('まとめる処理は通信も外部ライブラリも使わない', () => {
  for (const file of [LIB, CLI]) {
    const text = readFileSync(file, 'utf8');
    for (const [, specifier] of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) assert.ok(specifier.startsWith('.') || ['node:fs', 'node:path', 'node:url', 'node:process'].includes(specifier), specifier);
    assert.doesNotMatch(text, /fetch\(|node:https?|node:net|WebSocket/);
  }
});

// ---- 配布と案内 ----
test('スキルの最初の段階で、調査の実行とまとめ方を案内する', () => {
  const skill = readFileSync(join(ROOT, 'plugin/skills/start/SKILL.md'), 'utf8');
  assert.match(skill, /survey\.ps1/);
  assert.match(skill, /merge-survey/);
  assert.match(skill, /中身を確か|中身を確認/);
});

test('本人が Windows で試す手順書がある', () => {
  const guide = readFileSync(join(ROOT, 'docs/survey-test.md'), 'utf8');
  assert.match(guide, /Windows 11/);
  assert.match(guide, /powershell/i);
  assert.match(guide, /merge-survey/);
  for (const word of ['同意', 'denied', 'リポジトリに入れない']) assert.ok(guide.includes(word), word);
});

test('実機の生データをコミットしない設定になっている', () => {
  assert.match(readFileSync(join(ROOT, '.gitignore'), 'utf8'), /hikitsugi-survey-\*/);
});
