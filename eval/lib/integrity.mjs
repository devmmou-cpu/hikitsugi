// 評価セットの整合性検査。API を使わず、データそのものの誤りを見つける。
// 問題の一覧（文字列の配列）を返す。空なら合格。

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { validate } from '../../plugin/lib/validate.mjs';
import { buildTranscript } from './build-transcript.mjs';
import { readJson } from './load-set.mjs';

const VERDICT_BY_ERROR = {
  E1: 'contradiction',
  E2: 'contradiction',
  E3: 'contradiction',
  E4: 'unsupported',
  E5: 'dangerous',
  E6: 'dangerous',
  E7: 'contradiction',
  E8: 'contradiction',
  E9: 'contradiction',
  E10: 'contradiction',
};

// 英字の語は許可リスト方式で確認する。実在の製品名やメーカー名を、禁止リストとしてリポジトリに置かないため。
const ALLOWED_WORDS = new Set([
  // 許可された実在の名前（製品名として使ってよいのはこの範囲だけ）
  'Windows', 'Microsoft', 'Teams', 'OneDrive', 'Outlook', 'Excel', 'PowerShell', 'Apps', 'Pro', 'Update',
  // 一般的な用語
  'AP', 'CAD', 'DHCP', 'DNS', 'IT', 'LAN', 'NAS', 'OS', 'PC', 'PDF', 'UTM', 'USB', 'Web', 'Wi-Fi',
  'RAID1', 'RAID5', 'X', 'Y', 'Z', 'S', 'A', 'B',
  // 予約済みドメイン
  'example',
]);
const ALLOWED_WORD_PATTERNS = [/^OKJ-/, /^OKOJO-/, /^okojo-seiko$/, /^Okojo$/, /^MODEL-[A-Z]\d$/];
const WORD = /(?<![0-9A-Za-z.\\-])[A-Za-z][A-Za-z0-9-]*/g;

// 入力に漏れてはいけない語（正解や仕掛けを示す語）
const LEAK = /(?<![0-9A-Za-z])E(?:[1-9]|10)(?![0-9A-Za-z])|誤り|わざと|正解|ダミー|埋め込/;

// パスワードや認証情報の本体を書いた形。保管場所の文には当たらない。
const CREDENTIAL = /(?:パスワード|暗証番号|認証コード|password|passcode)(?:は|:|：|=|＝)\s*[「"']?([!-~]{4,})/giu;

const PHONE = /0\d{1,4}-\d{1,4}-\d{3,4}/g;
const FICTIONAL_PHONE = /^03-0000-01\d{2}$/;

/** オブジェクトの中の文字列を、キーも含めて再帰的に集める。 */
function collectStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      collectStrings(v, out);
    }
  }
  return out;
}

// 識別子や区分だけを入れる項目。人が読む文章ではないので、語の検査から外す。
const IDENTIFIER_FIELDS = new Set([
  'action', 'category', 'company', 'contact', 'covers', 'error', 'evidence', 'expected', 'facts', 'gap', 'group',
  'id', 'item', 'key', 'kind', 'ref', 'split', 'state', 'status',
]);

/** 人が読む文章の文字列だけを集める。 */
function collectValues(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectValues(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      // 同じ名前でも中身が文章のオブジェクト（隠し設定の facts など）は検査する
      const isIdentifier =
        IDENTIFIER_FIELDS.has(k) &&
        (typeof v === 'string' || v === null || (Array.isArray(v) && v.every((x) => typeof x === 'string')));
      if (!isIdentifier) collectValues(v, out);
    }
  }
  return out;
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules' || name === 'results') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

/**
 * @param setDir 評価セットのフォルダ
 * @param options.repoRoot 認証情報の検査で走査するリポジトリの根
 * @param options.checklistPath 必須項目のファイル
 * @param options.schemaRoot スキーマを探す根（通常はリポジトリの根）
 */
export function checkSet(setDir, { repoRoot, checklistPath, schemaRoot = repoRoot }) {
  const problems = [];
  const schema = (rel) => readJson(join(schemaRoot, rel));

  const files = {
    case: ['case.json', 'eval/schemas/case.schema.json'],
    survey: ['input/survey.json', 'plugin/schemas/survey.schema.json'],
    transcript: ['input/transcript.fixture.json', 'plugin/schemas/transcript.schema.json'],
    statements: ['input/statements.json', 'eval/schemas/statements.schema.json'],
    facts: ['hidden/tanaka_facts.json', 'eval/schemas/facts.schema.json'],
    verifier: ['answers/verifier.json', 'eval/schemas/answers-verifier.schema.json'],
    gaps: ['answers/gaps.json', 'eval/schemas/answers-gaps.schema.json'],
    troubles: ['answers/troubles.json', 'eval/schemas/answers-troubles.schema.json'],
  };
  const data = {};
  for (const [name, [file, schemaFile]] of Object.entries(files)) {
    data[name] = readJson(join(setDir, file));
    for (const error of validate(schema(schemaFile), data[name])) problems.push(`形式 ${file} ${error}`);
  }
  const checklist = readJson(checklistPath);
  for (const error of validate(schema('plugin/schemas/checklist.schema.json'), checklist)) {
    problems.push(`形式 checklist ${error}`);
  }
  // 形式が壊れていると以降の検査が意味を持たないので、ここで返す
  if (problems.length) return problems;

  // ---- 必須項目 ----
  const expectedChk = Array.from({ length: 40 }, (_, i) => `CHK-${String(i + 1).padStart(2, '0')}`);
  const chkIds = checklist.items.map((item) => item.id);
  if (JSON.stringify(chkIds) !== JSON.stringify(expectedChk)) problems.push('必須項目の ID が CHK-01〜40 の連番ではありません');

  // ---- 調査データ ----
  const inv = new Map(data.survey.items.map((item) => [item.id, item]));
  data.survey.items.forEach((item, i) => {
    const expected = `INV-${String(i + 1).padStart(3, '0')}`;
    if (item.id !== expected) problems.push(`調査データの ID が連番ではありません: ${item.id}`);
    if (i > 0) {
      const prev = data.survey.items[i - 1];
      const order = `${prev.host}\0${prev.key}` < `${item.host}\0${item.key}`;
      if (!order) problems.push(`調査データが PC 名と項目キーの順に並んでいません: ${item.id}`);
    }
    if ((item.status === 'ok') !== (item.value !== null)) {
      problems.push(`調査データの status と value が食い違っています: ${item.id}`);
    }
  });

  // ---- 聞き取り ----
  const rebuilt = buildTranscript(data.facts);
  if (JSON.stringify(rebuilt) !== JSON.stringify(data.transcript)) {
    problems.push('固定の聞き取り記録が、隠し設定から再生成したものと一致しません');
  }
  const int = new Map(data.transcript.entries.map((entry) => [entry.id, entry]));
  const factById = new Map(data.facts.facts.map((fact) => [fact.id, fact]));
  const usedFacts = data.facts.script.flatMap((step) => step.facts);
  if (new Set(usedFacts).size !== usedFacts.length) problems.push('同じ事実が台本に2回出ています');
  for (const fact of data.facts.facts) {
    if (!usedFacts.includes(fact.id)) problems.push(`台本で使われていない事実があります: ${fact.id}`);
    for (const phrase of fact.match) {
      if (!fact.answer.includes(phrase)) problems.push(`事実の照合語が回答にありません: ${fact.id} ${phrase}`);
    }
    for (const item of fact.covers) {
      if (!expectedChk.includes(item)) problems.push(`事実が存在しない項目を参照しています: ${fact.id} ${item}`);
    }
  }

  // ---- 根拠の参照 ----
  const evidenceText = (ref) => {
    if (inv.has(ref)) return String(inv.get(ref).value ?? '');
    if (int.has(ref)) return int.get(ref).answer;
    return null;
  };
  const checkSupport = (owner, support) => {
    for (const { ref, contains } of support) {
      const text = evidenceText(ref);
      if (text === null) problems.push(`${owner}: 存在しない根拠です: ${ref}`);
      else if (!text.includes(contains)) problems.push(`${owner}: 根拠 ${ref} に「${contains}」がありません`);
    }
  };

  // ---- 記述と Verifier の正解 ----
  const statements = data.statements.statements;
  const answers = data.verifier.statements;
  const statementIds = statements.map((s) => s.id);
  const answerIds = answers.map((a) => a.id);
  if (JSON.stringify([...statementIds].sort()) !== JSON.stringify([...answerIds].sort())) {
    problems.push('記述と正解の ID が一致しません');
  }
  if (new Set(statementIds).size !== statementIds.length) problems.push('記述の ID が重複しています');
  for (const statement of statements) {
    for (const ref of statement.evidence) {
      if (evidenceText(ref) === null) {
        problems.push(`${statement.id}: 存在しない根拠です: ${ref}`);
      } else if (int.has(ref) && int.get(ref).status !== 'answered') {
        problems.push(`${statement.id}: 回答のない聞き取りを根拠にしています: ${ref}`);
      }
    }
  }
  const seeded = answers.filter((a) => a.kind === 'seeded');
  const correct = answers.filter((a) => a.kind === 'correct');
  for (const code of Object.keys(VERDICT_BY_ERROR)) {
    const hits = seeded.filter((a) => a.error === code);
    if (hits.length !== 1) problems.push(`${code} は1件必要です（${hits.length} 件）`);
  }
  if (correct.length < 18 || correct.length > 22) problems.push(`正しい記述は約20件必要です（${correct.length} 件）`);
  for (const answer of answers) {
    checkSupport(answer.id, answer.support);
    if (answer.kind === 'seeded' && answer.expected !== VERDICT_BY_ERROR[answer.error]) {
      problems.push(`${answer.id}: ${answer.error} の期待判定が違います`);
    }
    if (answer.kind === 'correct' && (answer.expected !== 'correct' || answer.error !== null)) {
      problems.push(`${answer.id}: 正しい記述の期待判定は correct で、error は null です`);
    }
  }
  // 誤りが先頭や末尾に固まっていないこと
  const isSeeded = (id) => answers.find((a) => a.id === id)?.kind === 'seeded';
  if (statementIds.slice(0, 10).every(isSeeded) || statementIds.slice(-10).every(isSeeded)) {
    problems.push('記述の順序が混ざっていません');
  }

  // ---- 入力への漏れ ----
  for (const [name, content] of Object.entries({
    survey: data.survey,
    transcript: data.transcript,
    statements: data.statements,
  })) {
    for (const text of collectStrings(content)) {
      const hit = text.match(LEAK);
      if (hit) problems.push(`入力 ${name} に正解を示す語があります: ${hit[0]}（${text}）`);
    }
  }

  // ---- 空白の正解 ----
  const gapItems = data.gaps.items;
  if (JSON.stringify(gapItems.map((g) => g.item)) !== JSON.stringify(expectedChk)) {
    problems.push('空白の正解が CHK-01〜40 を網羅していません');
  }
  for (const gap of gapItems) {
    for (const ref of gap.evidence) {
      if (!inv.has(ref) || inv.get(ref).status !== 'ok') problems.push(`${gap.item}: 使えない調査データを根拠にしています: ${ref}`);
    }
    if (gap.state === 'gap' && gap.evidence.length > 0) problems.push(`${gap.item}: 空白なのに根拠があります`);
    if (gap.state !== 'gap' && gap.evidence.length === 0) problems.push(`${gap.item}: 根拠がありません`);
    if (gap.state !== 'filled' && gap.facts.length === 0) problems.push(`${gap.item}: 聞き取りで埋める事実がありません`);
    for (const id of gap.facts) {
      if (!factById.get(id)?.covers.includes(gap.item)) problems.push(`${gap.item}: 事実 ${id} が対応していません`);
    }
  }
  // 聞き取りの上限が目標（85%）に届くこと
  const reachable = gapItems.filter(
    (gap) => gap.state === 'filled' || gap.facts.some((id) => factById.get(id)?.status === 'answered'),
  );
  if (reachable.length < 34) problems.push(`聞き取りで埋められる項目が少なすぎます（${reachable.length}/40）`);

  // ---- 行動の正解 ----
  const vendorIds = new Set(data.case.vendors.map((v) => v.id));
  const troubles = data.troubles.troubles;
  if (troubles.filter((t) => t.action === 'self').length !== 3) problems.push('自力で解決するトラブルは3件必要です');
  for (const trouble of troubles) {
    checkSupport(trouble.id, trouble.support);
    if (trouble.action === 'contact' && !vendorIds.has(trouble.contact)) problems.push(`${trouble.id}: 連絡先がありません`);
    if (trouble.action === 'self' && trouble.contact !== null) problems.push(`${trouble.id}: 自力の場合、連絡先は null です`);
  }

  // ---- 架空性：英字の語 ----
  const textSources = [...Object.values(data), checklist];
  for (const source of textSources) {
    for (const text of collectValues(source)) {
      for (const [word] of text.matchAll(WORD)) {
        if (ALLOWED_WORDS.has(word) || ALLOWED_WORD_PATTERNS.some((p) => p.test(word))) continue;
        // 正解の説明文では E 番号を使ってよい
        if (/^E(?:[1-9]|10)$/.test(word)) continue;
        problems.push(`許可リストにない英字の語があります: ${word}（${text}）`);
      }
    }
  }

  // ---- 架空性：電話番号 ----
  for (const source of textSources) {
    for (const text of collectValues(source)) {
      for (const [phone] of text.matchAll(PHONE)) {
        if (!FICTIONAL_PHONE.test(phone)) problems.push(`架空の形式ではない電話番号です: ${phone}`);
      }
    }
  }
  // E4 の電話番号は、どの根拠にもあってはいけない
  const e4 = seeded.find((a) => a.error === 'E4');
  const e4Phone = statements.find((s) => s.id === e4?.id)?.text.match(PHONE)?.[0];
  if (!e4Phone) problems.push('E4 の記述に電話番号がありません');
  else if ([data.survey, data.transcript, data.facts, data.case].some((src) => JSON.stringify(src).includes(e4Phone))) {
    problems.push(`E4 の電話番号が根拠側に存在します: ${e4Phone}`);
  }

  // ---- 認証情報：E5 の1件以外に存在しないこと ----
  const e5 = seeded.find((a) => a.error === 'E5');
  const e5Text = statements.find((s) => s.id === e5?.id)?.text ?? '';
  const dummy = [...e5Text.matchAll(CREDENTIAL)][0]?.[1];
  if (!dummy) problems.push('E5 の記述がパスワード本体の形になっていません');
  for (const path of walk(repoRoot)) {
    const rel = relative(repoRoot, path).split(sep).join('/');
    const isSetFile = path.startsWith(setDir);
    if (!isSetFile && !/\.(json|mjs|js|md|ps1|html)$/.test(path)) continue;
    const content = readFileSync(path, 'utf8');
    const expectedHome = path === join(setDir, 'input/statements.json');
    if (dummy && content.includes(dummy) && !expectedHome) {
      problems.push(`ダミーの認証情報が決められた場所以外にあります: ${rel}`);
    }
    if (isSetFile || rel.startsWith('plugin/checklist/')) {
      for (const match of content.matchAll(CREDENTIAL)) {
        if (!(expectedHome && match[1].replace(/["',]+$/, '') === dummy)) {
          problems.push(`認証情報の形をした記述があります: ${rel}（${match[0]}）`);
        }
      }
    }
  }

  return problems;
}
