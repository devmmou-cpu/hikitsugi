#!/usr/bin/env node
// Claude Code のフック（PostToolUse）。取扱説明書の HTML を書き出したあとに、中身を検査する。
// パスワードらしい文字列や、架空の形式以外の電話番号、ドメインがあれば、ファイルを .blocked に改名して止める。
// 開発用の検査で、配布するプラグインには含めない。値そのものは表示しない。
//
// スマホ向けの束（manual.html の隣の phone/ と、phone.mjs の出力先）の全ファイルにも同じ検査をする。
// 単独でも使える：node scripts/hooks/check-manual-html.mjs --file <入力.html またはフォルダ>

import { existsSync, readdirSync, readFileSync, realpathSync, renameSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { secretProblems } from '../check-secrets.mjs';
import { fileSize, PC_FILE_LIMIT } from '../../plugin/lib/limits.mjs';
import { phoneFileProblems } from '../../plugin/renderer/phone.mjs';

const CREDENTIAL = /(?:パスワード|パスコード|暗証番号|認証コード|password|passcode)(?:は|が|:|=|\s)[\s、,]*[「『"'(]?[!-~]{4,}/iu;
const PHONE = /(?<![\d-])0\d{0,4}-\d{1,4}-\d{3,4}(?![\d-])/g;
const PHONE_COMPACT = /(?<![\d.-])0\d{9,10}(?![\d-])/g;
const ALLOWED_PHONE = /^03-?0000-?01\d{2}$/;
const DOMAIN = /(?<![a-z0-9.@-])(?:[a-z0-9-]+@)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?![a-z0-9-])/gi;
// ファイル名は、ドメインではない
const FILE_EXTENSION = /\.(?:html?|pdf|xlsx?|docx?|pptx?|csv|txt|zip|exe|png|jpe?g|json|ps1|mjs|js|css)$/i;
const ALLOWED_DOMAIN = /\.example$/i;

const decode = (text) =>
  text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;|&apos;/g, "'").replace(/&amp;/g, '&');

/** 検査する文字列を作る。CSS と JavaScript は除く。リンク先は電話番号やドメインが入るので残す。 */
function readableText(html) {
  const body = html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ');
  const links = [...body.matchAll(/\bhref="([^"#][^"]*)"/gi)].map((m) => m[1].replace(/^(?:tel|mailto|https?):\/{0,2}/i, ''));
  return decode(`${body.replace(/<[^>]+>/g, ' ')}\n${links.join('\n')}`).normalize('NFKC');
}

/** 問題の一覧を返す。値そのものは返さず、件数と種類だけを返す。 */
export function manualHtmlProblems(html) {
  const text = readableText(html);
  const problems = [];
  if (CREDENTIAL.test(text)) problems.push('パスワードらしい文字列があります');
  const phones = [...(text.match(PHONE) ?? []), ...(text.match(PHONE_COMPACT) ?? [])].filter((phone) => !ALLOWED_PHONE.test(phone));
  if (phones.length) problems.push(`架空の形式（03-0000-01xx）以外の電話番号が ${phones.length} 件あります`);
  const domains = (text.match(DOMAIN) ?? []).filter((domain) => !FILE_EXTENSION.test(domain) && !ALLOWED_DOMAIN.test(domain));
  if (domains.length) problems.push(`架空の形式（<名前>.example）以外のドメインが ${domains.length} 件あります`);
  problems.push(...secretProblems(html));
  return problems;
}

/** ツールの実行から、書き出した HTML のパスを探す。 */
export function writtenHtmlPaths(input) {
  const cwd = input.cwd ?? process.cwd();
  const at = (path) => (isAbsolute(path) ? path : resolve(cwd, path));
  if (input.tool_name === 'Write' || input.tool_name === 'Edit') {
    const path = input.tool_input?.file_path ?? '';
    return /\.html?$/i.test(path) ? [at(path)] : [];
  }
  const command = input.tool_input?.command ?? '';
  // スマホ向けの束は、出力先のフォルダを渡す
  const bundle = command.match(/phone\.mjs["']?\s+(?:"[^"]+"|\S+)\s+(?:"([^"]+)"|([^\s;&|]+))/);
  if (bundle) return [at(bundle[1] ?? bundle[2])];
  if (!/render\.mjs|hikitsugi(?:\.mjs)?["']?\s+render|eval\/pipeline\.mjs/.test(command)) return [];
  const output = typeof input.tool_response === 'string' ? input.tool_response : `${input.tool_response?.stdout ?? ''}`;
  const paths = [...command.matchAll(/(?:^|[\s"'=])([^\s"'=;&|]+\.html)(?=$|[\s"';&|])/g)].map((m) => at(m[1]));
  // 表示プログラムの案内と、評価の保存先からも探す
  for (const [, path] of output.matchAll(/(?:作りました|下書きを作りました)：(\S+\.html)/g)) paths.push(at(path));
  for (const [, dir] of output.matchAll(/保存先：(\S+)/g)) paths.push(join(at(dir), 'manual.html'));
  if (/hikitsugi(?:\.mjs)?["']?\s+render/.test(command)) paths.push(at('hikitsugi-work/manual.html'));
  return [...new Set(paths)];
}

const htmlIn = (dir) => (existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.html')).map((name) => join(dir, name)) : []);

/** フォルダは中の HTML に広げる。manual.html の隣にスマホ向けの束があれば、それも含める。 */
export function withPhoneBundles(paths) {
  return [...new Set(paths.flatMap((path) => {
    if (existsSync(path) && statSync(path).isDirectory()) return htmlIn(path);
    return basename(path) === 'manual.html' ? [path, ...htmlIn(join(dirname(path), 'phone'))] : [path];
  }))];
}

/** スマホ向けの束のファイルか。束の決まり（script、リンク、大きさ）も確かめる。 */
const isPhoneFile = (path) => basename(dirname(path)) === 'phone' || /^(?:\d{2}_)/.test(basename(path));

function checkFiles(paths) {
  let blocked = false;
  for (const path of withPhoneBundles(paths).filter((candidate) => existsSync(candidate))) {
    const html = readFileSync(path, 'utf8');
    const size = fileSize(html) > PC_FILE_LIMIT ? [`上限の ${PC_FILE_LIMIT / 1024}KB を超えています`] : [];
    const problems = [...manualHtmlProblems(html), ...(isPhoneFile(path) ? phoneFileProblems(html) : size)];
    if (!problems.length) continue;
    blocked = true;
    // 問題のあるファイルを、そのまま開いたり渡したりできないようにする
    renameSync(path, `${path}.blocked`);
    console.error(`取扱説明書の HTML に問題があるので止めました：${path}\n${problems.map((p) => `- ${p}`).join('\n')}\nファイルは ${path}.blocked に改名しました。`);
  }
  return blocked ? 2 : 0;
}

function main(args) {
  if (args[0] === '--file') return checkFiles(args.slice(1).map((path) => resolve(path)));
  const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
  return checkFiles(writtenHtmlPaths(input));
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
