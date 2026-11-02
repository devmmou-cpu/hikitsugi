#!/usr/bin/env node
// 表示プログラム（初版は T1 のみ）。取扱説明書の中身から、スマホで読む HTML を1ファイル作る。
// AI を使わず、時刻や乱数にも頼らない。同じ入力からは毎回同じ出力になる。
//
// 使い方：node plugin/renderer/render.mjs <入力.json> <出力.html>
// 終了コード：0＝成功、1＝入力の異常（出力ファイルを作らない）、2＝引数や出力先の誤り

import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validate } from '../lib/validate.mjs';
import { CLIENT_SCRIPT } from './client.mjs';
import { STYLES } from './styles.mjs';

const SCHEMA = JSON.parse(readFileSync(new URL('../schemas/manual.schema.json', import.meta.url), 'utf8'));

// ---- 画面の固定の文言 ----
const BADGE_LABELS = { self: '自分で直せる', check_first: '確認してから', vendor: '業者へ連絡' };

const CATEGORY_LABELS = [
  ['net', 'インターネット'],
  ['print_scan', '印刷とスキャン'],
  ['file', 'ファイル'],
  ['mail_teams', 'メールと Teams'],
  ['pc', 'PC'],
  ['other', 'その他'],
];

const TABS = [
  ['tab-help', '困ったとき'],
  ['tab-contacts', '連絡先'],
  ['tab-routines', '毎月やること'],
  ['tab-company', '会社のIT'],
];

// ---- 文字の扱い ----
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** 2026-11-20 を 2026年11月20日 にする。Date を使わず、文字列のまま変換する。 */
function formatDate(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return `${year}年${month}月${day}日`;
}

/** 語が使われているか。英数字の語は単語の境界で判定する（NAS が別の英単語の一部に当たらないように）。 */
function usesTerm(text, term) {
  if (!/^[A-Za-z0-9]+$/.test(term)) return text.includes(term);
  return new RegExp(`(?<![A-Za-z0-9])${term}(?![A-Za-z0-9])`).test(text);
}

// ---- 入力の検査 ----
// 認証情報の本体らしいものを探す。保管場所の文は通す。
// 全角は半角にそろえてから調べる。止めるときに値そのものは表示しない。
const CREDENTIAL =
  /(?:パスワード|パスコード|暗証番号|認証コード|password|passcode)(?:は|が|:|=|\s)[\s、,]*[「『"'(]?[!-~]{4,}/iu;

function assertNoCredentials(manual) {
  const fields = [
    ...manual.statements.map((s) => [s.id, s.text]),
    ['company_name', manual.company_name],
    ...manual.contacts.flatMap((c) => [
      [`${c.id} の名前`, c.name],
      [`${c.id} の電話番号`, c.phone],
    ]),
    ...manual.glossary.map((g) => ['用語', g.term]),
  ];
  const found = fields.filter(([, text]) => CREDENTIAL.test(text.normalize('NFKC'))).map(([where]) => where);
  if (found.length) {
    throw new Error(`認証情報の本体らしい文字があるので、出力を止めました（${found.join('、')}）。保管場所だけを書いてください。`);
  }
}

function assertUnique(ids, label) {
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`${label}の ID が重複しています: ${id}`);
    seen.add(id);
  }
}

/** 画面に出す記述の ID をすべて集める。 */
function referencedStatements(manual) {
  return [
    ...manual.symptom_pages.flatMap((p) => [p.title, p.badge.statement, p.reassurance, ...p.steps, ...(p.fallback ? [p.fallback.message] : [])]),
    ...manual.contacts.flatMap((c) => [c.role, c.hours, c.contract_location, c.what_to_tell]),
    ...manual.glossary.map((g) => g.explanation),
  ];
}

function checkInput(manual) {
  const errors = validate(SCHEMA, manual);
  if (errors.length) throw new Error(`入力の形式が違います:\n${errors.map((e) => `- ${e}`).join('\n')}`);

  // 初版で表示できないものを、黙って捨てない
  if (manual.routines.length || manual.devices.length) {
    throw new Error('routines と devices は初版では表示できません。空にしてください。');
  }

  assertUnique(manual.statements.map((s) => s.id), '記述');
  assertUnique(manual.contacts.map((c) => c.id), '連絡先');
  assertUnique(manual.symptom_pages.map((p) => p.id), '手順ページ');

  const known = new Set(manual.statements.map((s) => s.id));
  const refs = new Set(referencedStatements(manual));
  const dangling = [...refs].filter((id) => !known.has(id));
  if (dangling.length) throw new Error(`存在しない記述を参照しています: ${dangling.join(', ')}`);

  const contacts = new Set(manual.contacts.map((c) => c.id));
  const missing = manual.symptom_pages.filter((p) => p.fallback && !contacts.has(p.fallback.contact)).map((p) => p.fallback.contact);
  if (missing.length) throw new Error(`存在しない連絡先を参照しています: ${missing.join(', ')}`);

  // どの画面からも参照されない記述は読めなくなるので、止める
  const unused = [...known].filter((id) => !refs.has(id));
  if (unused.length) throw new Error(`どの画面からも使われていない記述があります: ${unused.join(', ')}`);

  assertNoCredentials(manual);
}

// ---- 部品 ----
const badgeHtml = (value) => `<span class="badge" data-badge="${esc(value)}">${esc(BADGE_LABELS[value])}</span>`;

/** 電話リンク。番号として正しい形のときだけリンクにし、それ以外は文字で見せる。 */
function callHtml(phone) {
  if (/^\+?[0-9][0-9-]*$/.test(phone)) {
    return `<a class="tap call" href="tel:${esc(phone)}">電話をかける ${esc(phone)}</a>`;
  }
  return `<p>電話番号：${esc(phone)}</p>`;
}

const termHtml = (ctx, term) =>
  `<details class="term" open><summary class="tap">${esc(term.term)} とは？</summary><p>${ctx.text(term.explanation)}</p></details>`;

const emptyHtml = (text) => `<p class="empty">${esc(text)}</p>`;

// ---- 困ったとき：症状の一覧 ----
function helpPanel(ctx) {
  const groups = CATEGORY_LABELS.map(([category, label]) => {
    const pages = ctx.manual.symptom_pages.filter((p) => p.category === category);
    if (!pages.length) return '';
    const items = pages.map(
      (p) =>
        `<li><a class="tap symptom-link" href="#symptom-${esc(p.id)}"><span><span class="symptom-name">${ctx.text(p.title)}</span>${badgeHtml(p.badge.value)}</span></a></li>`,
    );
    return `<h3>${esc(label)}</h3>\n<ul class="symptoms">\n${items.join('\n')}\n</ul>`;
  }).filter(Boolean);

  const body = groups.length
    ? `<p class="lead">いま困っていることを押してください。</p>\n${groups.join('\n')}`
    : emptyHtml('症状の手順は、まだこの説明書に入っていません。');
  return `<section id="tab-help" class="panel">\n<h2 tabindex="-1">困ったとき</h2>\n${body}\n</section>`;
}

// ---- 手順ページ ----
/** 各手順に添える用語を選ぶ。同じ用語はページの中で最初の1回だけ。 */
function termsByStep(ctx, page) {
  const shown = new Set();
  return page.steps.map((id) => {
    const terms = ctx.manual.glossary.filter((g) => !shown.has(g.term) && usesTerm(ctx.raw(id), g.term));
    for (const term of terms) shown.add(term.term);
    return terms;
  });
}

function stepsHtml(ctx, page, stepTerms) {
  const items = page.steps.map((id, index) => {
    const terms = stepTerms[index].map((term) => termHtml(ctx, term)).join('');
    return `<li><label class="tap step"><input type="checkbox" data-check="${esc(page.id)}:${esc(id)}"><span>${ctx.text(id)}</span></label>${terms}</li>`;
  });
  return [
    '<h3>やること</h3>',
    '<p>上から順に進めます。終わった手順にチェックを入れてください。</p>',
    `<ol class="steps">\n${items.join('\n')}\n</ol>`,
    '<button type="button" class="tap js-only button button-quiet" data-reset>チェックをすべて外す</button>',
  ].join('\n');
}

function fallbackHtml(ctx, page, contact) {
  const messageId = `message-${esc(page.id)}`;
  const statusId = `copy-status-${esc(page.id)}`;
  return [
    '<h3>直らなかったら</h3>',
    '<p>次の会社に連絡してください。</p>',
    '<div class="contact-box">',
    `<p class="contact-name">${esc(contact.name)}</p>`,
    callHtml(contact.phone),
    `<p>${ctx.text(contact.hours)}</p>`,
    `<p>${ctx.text(contact.what_to_tell)}</p>`,
    '</div>',
    '<h4>業者に送る文面</h4>',
    `<p class="message" id="${messageId}">${ctx.text(page.fallback.message)}</p>`,
    `<button type="button" class="tap js-only button" data-copy="${messageId}" data-status="${statusId}">文面をコピーする</button>`,
    `<span class="js-only copy-status" id="${statusId}" role="status"></span>`,
  ].join('\n');
}

/** ページに表示した記述の根拠から、確かめ方の一文を作る。 */
function evidenceHtml(ctx, ids) {
  const evidence = ids.flatMap((id) => ctx.statements.get(id).evidence);
  const has = (prefix) => evidence.some((ref) => ref.startsWith(prefix));
  const sources = [
    ...(has('INV-') ? [`調査データ（${formatDate(ctx.manual.as_of)}時点）`] : []),
    ...(has('INT-') ? ['聞き取り'] : []),
    ...(has('PUB-') ? ['公開資料'] : []),
    ...(has('LIB-') ? ['確認済みの標準手順'] : []),
  ];
  return `<p class="evidence">この手順は、${sources.join('と')}で確認済みです。</p>`;
}

function symptomPanel(ctx, page) {
  const contact = page.fallback ? ctx.contacts.get(page.fallback.contact) : null;
  const stepTerms = termsByStep(ctx, page);
  const shownIds = [
    page.title,
    page.badge.statement,
    page.reassurance,
    ...page.steps,
    ...stepTerms.flat().map((term) => term.explanation),
    ...(contact ? [contact.hours, contact.what_to_tell, page.fallback.message] : []),
  ];
  const parts = [
    `<article id="symptom-${esc(page.id)}" class="panel" data-tab="tab-help">`,
    '<a class="tap back" href="#tab-help">‹ 症状の一覧に戻る</a>',
    `<h2 tabindex="-1">${ctx.text(page.title)}</h2>`,
    `<p class="verdict">${badgeHtml(page.badge.value)}</p>`,
    `<p>${ctx.text(page.badge.statement)}</p>`,
    `<p class="time">目安の時間：約${esc(page.minutes)}分</p>`,
    `<p class="reassure">${ctx.text(page.reassurance)}</p>`,
    page.steps.length ? stepsHtml(ctx, page, stepTerms) : '',
    contact ? fallbackHtml(ctx, page, contact) : '',
    evidenceHtml(ctx, shownIds),
    '<a class="tap back" href="#tab-help">‹ 症状の一覧に戻る</a>',
    '</article>',
  ];
  return parts.filter(Boolean).join('\n');
}

// ---- 連絡先 ----
function contactCard(ctx, contact) {
  const rows = [
    ['どんな会社か', contact.role],
    ['受付の時間', contact.hours],
    ['契約番号の控えの場所', contact.contract_location],
    ['電話で伝えること', contact.what_to_tell],
  ].map(([label, id]) => `<dt>${esc(label)}</dt><dd>${ctx.text(id)}</dd>`);
  return [
    '<div class="contact-box card">',
    `<p class="contact-name">${esc(contact.name)}</p>`,
    callHtml(contact.phone),
    `<dl>${rows.join('')}</dl>`,
    '</div>',
  ].join('\n');
}

function contactsPanel(ctx) {
  const body = ctx.manual.contacts.length
    ? `<p class="lead">困ったときに連絡する会社です。</p>\n${ctx.manual.contacts.map((c) => contactCard(ctx, c)).join('\n')}`
    : emptyHtml('連絡先は、まだこの説明書に入っていません。');
  return `<section id="tab-contacts" class="panel">\n<h2 tabindex="-1">連絡先</h2>\n${body}\n</section>`;
}

// ---- 毎月やること、会社のIT ----
function routinesPanel() {
  return `<section id="tab-routines" class="panel">\n<h2 tabindex="-1">毎月やること</h2>\n${emptyHtml('毎月やることは、まだこの説明書に入っていません。')}\n</section>`;
}

function companyPanel(ctx) {
  const glossary = ctx.manual.glossary.length
    ? `<h3>ことばの説明</h3>\n<p>押すと説明が開きます。</p>\n<div class="terms">\n${ctx.manual.glossary.map((g) => termHtml(ctx, g)).join('\n')}\n</div>`
    : '';
  return `<section id="tab-company" class="panel">\n<h2 tabindex="-1">会社のIT</h2>\n${emptyHtml('機器の一覧は、まだこの説明書に入っていません。')}\n${glossary}\n</section>`;
}

// ---- 全体 ----
function navHtml() {
  const links = TABS.map(([id, label]) => `<a class="tap tab" href="#${id}">${esc(label)}</a>`);
  return `<nav class="tabs" aria-label="画面の切り替え">\n${links.join('\n')}\n</nav>`;
}

/** 取扱説明書の中身から HTML の文字列を作る。入力に異常があれば例外を投げる。 */
export function renderManual(manual) {
  checkInput(manual);

  const statements = new Map(manual.statements.map((s) => [s.id, s]));
  const ctx = {
    manual,
    statements,
    contacts: new Map(manual.contacts.map((c) => [c.id, c])),
    raw: (id) => statements.get(id).text,
    text: (id) => esc(statements.get(id).text),
  };

  const company = esc(manual.company_name);
  return `<!doctype html>
<html lang="ja" data-company="${esc(manual.company)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${company} ITの取扱説明書</title>
<style>
${STYLES}
</style>
</head>
<body>
<header class="masthead">
<p class="confidential"><strong>社外秘</strong>${company}</p>
<h1>ITの取扱説明書</h1>
<p>${esc(formatDate(manual.as_of))}時点の内容です。</p>
</header>
<main>
${helpPanel(ctx)}
${manual.symptom_pages.map((page) => symptomPanel(ctx, page)).join('\n')}
${contactsPanel(ctx)}
${routinesPanel()}
${companyPanel(ctx)}
</main>
${navHtml()}
<script>
${CLIENT_SCRIPT}
</script>
</body>
</html>
`;
}

// ---- コマンド ----
function main(args) {
  if (args.length !== 2) {
    console.error('使い方: node plugin/renderer/render.mjs <入力.json> <出力.html>');
    return 2;
  }
  const [inputPath, outputPath] = args;
  if (resolve(inputPath) === resolve(outputPath)) {
    console.error('入力と出力に同じファイルは指定できません。');
    return 2;
  }

  let html;
  try {
    html = renderManual(JSON.parse(readFileSync(inputPath, 'utf8')));
  } catch (error) {
    console.error(`入力に問題があります: ${error.message}`);
    return 1;
  }

  try {
    writeFileSync(outputPath, html);
  } catch (error) {
    console.error(`出力先に書き込めません: ${error.message}`);
    return 2;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
