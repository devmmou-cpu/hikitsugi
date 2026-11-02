#!/usr/bin/env node
// 表示プログラム。取扱説明書の中身から、スマホで読む HTML を1ファイル作る。
// AI を使わず、時刻や乱数にも頼らない。同じ入力からは毎回同じ出力になる。
//
// 使い方：node plugin/renderer/render.mjs <入力.json> <出力.html>
// 終了コード：0＝成功、1＝入力の異常（出力ファイルを作らない）、2＝引数や出力先の誤り

import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bodyFields, pageStatementIds, parseInfoRow } from '../lib/page-check.mjs';
import { validate } from '../lib/validate.mjs';
import { CLIENT_SCRIPT } from './client.mjs';
import { STYLES } from './styles.mjs';

const SCHEMA = JSON.parse(readFileSync(new URL('../schemas/manual.schema.json', import.meta.url), 'utf8'));

// ---- 画面の固定の文言 ----
const BADGE_LABELS = { self: '自分で直せる', check_first: '確認してから', vendor: '業者へ連絡', internal: '社内で相談' };

const CATEGORY_LABELS = [
  ['net', 'インターネット'],
  ['print_scan', '印刷とスキャン'],
  ['file', 'ファイル'],
  ['mail_teams', 'メールと Teams'],
  ['pc', 'PC'],
  ['other', 'その他'],
];

const SHORT_STEP_LENGTH = 40;

const FREQUENCY_LABELS = [
  ['weekly', '毎週'],
  ['monthly', '毎月'],
  ['yearly', '年に1回'],
];

// ---- 印。線だけのインライン SVG で、色は文字の色に従う ----
const ICONS = {
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>',
  phone:
    '<path d="M6.6 3.5h2.2c.5 0 .9.3 1 .8l.8 3.2c.1.4 0 .8-.3 1L8.7 9.9a13 13 0 0 0 5.4 5.4l1.4-1.6c.3-.3.7-.4 1-.3l3.2.8c.5.1.8.5.8 1v2.2c0 1.1-.9 2-2 2C10.6 19.4 4.6 13.4 4.6 5.5c0-1.1.9-2 2-2z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
  next: '<path d="M9 6l6 6-6 6"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.1 1-1.1 1.8M12 16.8v.01"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="15" rx="2"/><path d="M4 10.5h16M8.5 3.5v4M15.5 3.5v4"/>',
  monitor: '<rect x="3.5" y="4.5" width="17" height="12" rx="2"/><path d="M9 20h6M12 16.5V20"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6M16 4.8a3.5 3.5 0 0 1 0 6.4M17.5 14.3c2.2.7 3.5 2.8 3.5 5.7"/>',
};

const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" role="presentation" focusable="false">${ICONS[name]}</svg>`;

const BADGE_ICONS = { self: 'check', check_first: 'alert', vendor: 'phone', internal: 'people' };

// 文字を大きくしたときは、<wbr> の位置（語の切れ目）でだけ折り返す
const TABS = [
  ['tab-help', '困った<wbr>とき', 'help'],
  ['tab-contacts', '連絡先', 'phone'],
  ['tab-routines', '毎月<wbr>やること', 'calendar'],
  ['tab-company', '会社の<wbr>IT', 'monitor'],
];

// ---- 文字の扱い ----
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** 2026-11-05 を 2026年11月5日 にする。Date を使わず、文字列のまま変換する。 */
function formatDate(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return `${year}年${month}月${day}日`;
}

/**
 * 文章を HTML にする。\\ で始まる接続先は、見ながら入力する値なので、途中で折り返さない印を付ける。
 * 文字は変えない（タグを除けば元の文章のまま。コピーする文面も変わらない）。
 */
function statementHtml(text) {
  return esc(text).replace(/\\\\[^\s、。，．）」』]+/g, (path) => `<span class="path">${path}</span>`);
}

/** 語が使われているか。英数字の語は単語の境界で判定する（NAS が別の英単語の一部に当たらないように）。 */
function usesTerm(text, term) {
  if (!/^[A-Za-z0-9]+$/.test(term)) return text.includes(term);
  return new RegExp(`(?<![A-Za-z0-9])${term}(?![A-Za-z0-9])`).test(text);
}

/**
 * 文章に使われている用語を、文章に出てくる順に返す。
 * 長い語を先に探して消すので、「外付け USB」があれば「USB」は別に数えない。
 */
function termsInText(glossary, text) {
  const longestFirst = [...glossary].sort((a, b) => b.term.length - a.term.length);
  let rest = text;
  const found = [];
  for (const entry of longestFirst) {
    if (!usesTerm(rest, entry.term)) continue;
    found.push({ entry, at: rest.indexOf(entry.term) });
    rest = rest.split(entry.term).join('\u0000'.repeat(entry.term.length));
  }
  return found.sort((a, b) => a.at - b.at).map(({ entry }) => entry);
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
    ...manual.symptom_pages.flatMap(pageStatementIds),
    ...manual.contacts.flatMap((c) => [c.role, c.hours, c.contract_location, c.what_to_tell].filter(Boolean)),
    ...manual.routines.flatMap((r) => [r.title, ...r.steps]),
    ...manual.devices.flatMap((d) => [d.name, d.location, d.purpose, d.impact]),
    ...manual.glossary.map((g) => g.explanation),
  ];
}

function checkInput(manual) {
  const errors = validate(SCHEMA, manual);
  if (errors.length) throw new Error(`入力の形式が違います:\n${errors.map((e) => `- ${e}`).join('\n')}`);

  assertUnique(manual.statements.map((s) => s.id), '記述');
  assertUnique(manual.contacts.map((c) => c.id), '連絡先');
  assertUnique(manual.symptom_pages.map((p) => p.id), '手順ページ');

  // 13月などは並び順が壊れる。形式の検査では下限しか見ていないので、ここで止める
  const months = manual.routines.filter((r) => r.month !== undefined && r.month > 12).map((r) => r.id);
  if (months.length) throw new Error(`定期作業の月が 1〜12 ではありません: ${months.join(', ')}`);

  const known = new Set(manual.statements.map((s) => s.id));
  const refs = new Set(referencedStatements(manual));
  const dangling = [...refs].filter((id) => !known.has(id));
  if (dangling.length) throw new Error(`存在しない記述を参照しています: ${dangling.join(', ')}`);

  const contacts = new Set(manual.contacts.map((c) => c.id));
  const missing = manual.symptom_pages.filter((p) => p.fallback && !contacts.has(p.fallback.contact)).map((p) => p.fallback.contact);
  if (missing.length) throw new Error(`存在しない連絡先を参照しています: ${missing.join(', ')}`);

  // 表の行は文章から値を読むので、読めない形なら止める
  const textOf = new Map(manual.statements.map((s) => [s.id, s.text]));
  const badRows = manual.symptom_pages.flatMap((p) => p.info_rows.filter((id) => !parseInfoRow(textOf.get(id))));
  if (badRows.length) throw new Error(`会社の情報の表の文章の形が違います: ${badRows.join(', ')}`);

  // どの画面からも参照されない記述は読めなくなるので、止める
  const unused = [...known].filter((id) => !refs.has(id));
  if (unused.length) throw new Error(`どの画面からも使われていない記述があります: ${unused.join(', ')}`);

  assertNoCredentials(manual);
}

// ---- 部品 ----
const badgeHtml = (value) => `<span class="badge" data-badge="${esc(value)}">${icon(BADGE_ICONS[value])}${esc(BADGE_LABELS[value])}</span>`;

/** 電話リンク。番号として正しい形のときだけリンクにし、それ以外は文字で見せる。 */
function callHtml(phone) {
  if (/^\+?[0-9][0-9-]*$/.test(phone)) {
    return `<a class="tap call" href="tel:${esc(phone)}">${icon('phone')}電話をかける ${esc(phone)}</a>`;
  }
  return `<p>電話番号：${esc(phone)}</p>`;
}

const termHtml = (ctx, term) =>
  `<details class="term" open><summary class="tap">${esc(term.term)} とは？</summary><p>${ctx.text(term.explanation)}</p></details>`;

const emptyHtml = (text) => `<p class="empty">${esc(text)}</p>`;

const factsHtml = (ctx, rows) => `<dl class="facts">${rows.map(([label, id]) => `<dt>${esc(label)}</dt><dd>${ctx.text(id)}</dd>`).join('')}</dl>`;

// ---- 困ったとき：症状の一覧 ----
function helpPanel(ctx) {
  const groups = CATEGORY_LABELS.map(([category, label]) => {
    const pages = ctx.manual.symptom_pages.filter((p) => p.category === category);
    if (!pages.length) return '';
    const items = pages.map(
      (p) =>
        `<li><a class="tap symptom-link" href="#symptom-${esc(p.id)}"><span><span class="symptom-name">${ctx.text(p.title)}</span>${badgeHtml(p.badge.value)}</span>${icon('next')}</a></li>`,
    );
    return `<h3>${esc(label)}</h3>\n<ul class="symptoms">\n${items.join('\n')}\n</ul>`;
  }).filter(Boolean);
  // 一覧に当てはまらないときの行き先を、必ず残す。社内の相談先は連絡先の先頭にある
  if (groups.length) {
    groups.push(`<h3>そのほか</h3>\n<ul class="symptoms">\n<li><a class="tap symptom-link no-match" href="#tab-contacts"><span><span class="symptom-name">当てはまる症状がないとき</span>${badgeHtml('internal')}</span>${icon('next')}</a></li>\n</ul>`);
  }

  const body = groups.length
    ? `<p class="lead">いま困っていることを押してください。</p>\n<p class="note">開いて読むだけなら、PC や機器には何も起きません。</p>\n${groups.join('\n')}`
    : emptyHtml('症状の手順は、まだこの説明書に入っていません。');
  return `<section id="tab-help" class="panel">\n<h2 tabindex="-1">困ったとき</h2>\n${body}\n</section>`;
}

// ---- 手順ページ ----
/**
 * 手順ページに添える用語を選ぶ。同じ用語はページの中で最初の1回だけ。
 * 手順で使う語はその手順の下に、それ以外の文に出てくる語はページの最後にまとめる。
 */
function pageTerms(ctx, page, contact) {
  const shown = new Set();
  const pick = (id) => {
    const terms = termsInText(ctx.manual.glossary, ctx.raw(id)).filter((g) => !shown.has(g.term));
    for (const term of terms) shown.add(term.term);
    return terms;
  };
  const steps = page.steps.map(pick);
  const { notes, first_steps: first, first_goal: firstGoal, branches, goal, exceptions } = bodyFields(page);
  const others = [page.title, page.badge.statement, page.reassurance, ...first, ...firstGoal, ...notes, ...branches, ...goal, ...exceptions, ...(contact ? [page.fallback.message] : [])];
  return { steps, rest: [...others, ...(contact?.hours ? [contact.hours] : [])].flatMap(pick) };
}

/** 帯。分岐と例外を手順の外に置く。 */
const bandsHtml = (ctx, ids, kind) => ids.map((id) => `<p class="band band-${kind}">${ctx.text(id)}</p>`).join('\n');

/** 直ったと分かる状態。チェック欄を付けない。 */
const goalHtml = (ctx, id) => (id ? `<p class="goal">${icon('check')}<span>${ctx.text(id)}</span></p>` : '');

/** ① まずこれだけ。手順ページの最初に見る場所。 */
function firstHtml(ctx, page, number) {
  if (!page.first_steps.length) return '';
  return [
    '<section class="first">',
    `<h3 class="first-kicker">${number} まずこれだけ<span class="eta">1分</span></h3>`,
    page.first_steps.map((id) => `<p class="first-body">${ctx.text(id)}</p>`).join('\n'),
    goalHtml(ctx, page.first_goal),
    '</section>',
  ].filter(Boolean).join('\n');
}

const notesHtml = (ctx, page) =>
  page.notes.length ? `<h3>先に知っておくこと</h3>\n<ul class="page-notes" role="list">\n${page.notes.map((id) => `<li>${ctx.text(id)}</li>`).join('\n')}\n</ul>` : '';

/** この症状で使う会社の情報。値は検証した文章から読む。 */
function infoHtml(ctx, page) {
  if (!page.info_rows.length) return '';
  const rows = page.info_rows.map((id) => parseInfoRow(ctx.raw(id)));
  const drives = rows.filter((row) => row.type === 'drive');
  const values = rows.filter((row) => row.type === 'value');
  const driveTable = drives.length
    ? `<table class="drive-table">\n<thead><tr><th scope="col">PC</th><th scope="col">ドライブ</th><th scope="col">接続先</th></tr></thead>\n<tbody>\n${drives.map((row) => `<tr><td>${esc(row.target ?? '全員')}</td><td class="drive-letter">${esc(row.drive)}</td><td><span class="path">${esc(row.path)}</span></td></tr>`).join('\n')}\n</tbody>\n</table>`
    : '';
  const valueTable = values.length
    ? `<table class="drive-table">\n<thead><tr><th scope="col">項目</th><th scope="col">値</th></tr></thead>\n<tbody>\n${values.map((row) => `<tr><td>${esc(row.label)}</td><td><span class="path">${esc(row.value)}</span></td></tr>`).join('\n')}\n</tbody>\n</table>`
    : '';
  return `<h3>この症状で使う会社の情報</h3>\n<div class="card drive-box">\n${[driveTable, valueTable].filter(Boolean).join('\n')}\n</div>`;
}

/** 部品の補足は、手順の下に分けて出す。チェックの対象は最初の1文の操作だけ。 */
function stepParts(text) {
  const end = text.indexOf('。');
  return end < 0 || end === text.length - 1 ? [text, ''] : [text.slice(0, end + 1), text.slice(end + 1)];
}

function stepsHtml(ctx, page, stepTerms, heading) {
  const items = page.steps.map((id, index) => {
    const terms = stepTerms[index].length ? `<div class="step-terms">${stepTerms[index].map((term) => termHtml(ctx, term)).join('')}</div>` : '';
    const [body, note] = stepParts(ctx.raw(id));
    // チェック欄を先に置くのは、チェックしたときに番号と文の色を CSS で変えるため。見た目では右端に並ぶ
    // 短い手順だけ文節で折り返す。長い文を文節で切ると、かえって行の長さがばらつくため
    const textClass = body.length <= SHORT_STEP_LENGTH ? 'step-text is-short' : 'step-text';
    const noteHtml = note ? `<p class="step-note">${statementHtml(note)}</p>` : '';
    return `<li><label class="tap step"><input type="checkbox" data-check="${esc(page.id)}:${esc(id)}"><span class="step-number">${index + 1}</span><span class="${textClass}">${statementHtml(body)}</span></label>${noteHtml}${terms}</li>`;
  });
  return [
    `<div class="steps-head"><h3>${heading}</h3><span class="js-only progress"></span></div>`,
    bandsHtml(ctx, page.branches, 'branch'),
    '<p class="note">上から順に進めます。終わった手順にチェックを入れてください。</p>',
    `<ol class="steps" role="list">\n${items.join('\n')}\n</ol>`,
    goalHtml(ctx, page.goal),
    bandsHtml(ctx, page.exceptions, 'exception'),
    '<button type="button" class="tap js-only reset" data-reset>チェックをすべて外す</button>',
  ].filter(Boolean).join('\n');
}

function fallbackHtml(ctx, page, contact, heading) {
  const messageId = `message-${esc(page.id)}`;
  const statusId = `copy-status-${esc(page.id)}`;
  const internal = contact.id.startsWith('INH-');
  // 連絡先の「伝えること」は1社に1文で、別の症状の文のことがある。ここではこのページの文面だけを出す
  return [
    `<h3>${heading}</h3>`,
    '<div class="card contact-box">',
    `<p class="contact-name">${esc(contact.name)}<span class="contact-role">${ctx.text(contact.role)}</span></p>`,
    contact.phone ? callHtml(contact.phone) : '',
    contact.hours ? `<dl class="facts"><dt>受付の時間</dt><dd>${ctx.text(contact.hours)}</dd></dl>` : '',
    '</div>',
    `<h4>${internal ? '相談のときに伝える文面' : '業者に送る文面'}</h4>`,
    `<p class="message" id="${messageId}">${ctx.text(page.fallback.message)}</p>`,
    `<button type="button" class="tap js-only button" data-copy="${messageId}" data-status="${statusId}">文面をコピーする</button>`,
    `<span class="js-only copy-status" id="${statusId}" role="status"></span>`,
  ].filter(Boolean).join('\n');
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
  const review = ctx.manual.review;
  const state = review ? `この手順は、前任の${esc(review.reviewer)}さんが確認済みです。` : 'この手順は、前任者の確認前です。';
  return `<p class="evidence"><span>${state}</span><span>もとにした情報：${sources.join('、')}</span></p>`;
}

const CIRCLED = ['①', '②', '③', '④'];

function symptomPanel(ctx, page) {
  const contact = page.fallback ? ctx.contacts.get(page.fallback.contact) : null;
  const terms = pageTerms(ctx, page, contact);
  const shownIds = [
    ...pageStatementIds(page),
    ...terms.steps.flat().map((term) => term.explanation),
    ...terms.rest.map((term) => term.explanation),
    ...(contact?.hours ? [contact.hours] : []),
  ];
  // 3部構成。部がないページは番号を詰め、見出しもそのページに合う言葉にする
  const hasFirst = page.first_steps.length > 0;
  const hasSteps = page.steps.length > 0;
  let part = 0;
  const number = () => CIRCLED[part++];
  const first = hasFirst ? firstHtml(ctx, page, number()) : '';
  const steps = hasSteps ? stepsHtml(ctx, page, terms.steps, `${number()} ${hasFirst ? 'それでも直らなければ' : 'やること'}`) : '';
  const lastLabel = hasFirst || hasSteps ? 'それでもだめなら' : contact?.id.startsWith('INH-') ? '相談してください' : '連絡してください';
  const last = contact ? fallbackHtml(ctx, page, contact, `${number()} ${lastLabel}`) : '';
  // 手順がないページの分岐と例外も、落とさず出す
  const looseBands = hasSteps ? '' : [bandsHtml(ctx, page.branches, 'branch'), bandsHtml(ctx, page.exceptions, 'exception')].filter(Boolean).join('\n');
  const backLink = `<a class="tap back" href="#tab-help">${icon('back')}症状の一覧に戻る</a>`;
  const parts = [
    `<article id="symptom-${esc(page.id)}" class="panel" data-tab="tab-help">`,
    backLink,
    `<h2 tabindex="-1">${ctx.text(page.title)}</h2>`,
    '<div class="card verdict">',
    `<div class="verdict-head">${badgeHtml(page.badge.value)}<p class="time">${icon('clock')}目安：約${esc(page.minutes)}分</p></div>`,
    `<p class="verdict-text">${ctx.text(page.badge.statement)}</p>`,
    '</div>',
    `<p class="reassure">${ctx.text(page.reassurance)}</p>`,
    first,
    notesHtml(ctx, page),
    looseBands,
    steps,
    last,
    !contact && ctx.manual.contacts.length ? '<p class="tab-link"><a class="tap button button-quiet" href="#tab-contacts">連絡先の一覧を見る</a></p>' : '',
    infoHtml(ctx, page),
    terms.rest.length ? `<h4>このページのことば</h4>\n<div class="terms">\n${terms.rest.map((term) => termHtml(ctx, term)).join('\n')}\n</div>` : '',
    evidenceHtml(ctx, shownIds),
    backLink,
    '</article>',
  ];
  return parts.filter(Boolean).join('\n');
}

// ---- 連絡先 ----
function contactCard(ctx, contact) {
  const internal = contact.id.startsWith('INH-');
  const rows = [
    ...(contact.hours ? [['受付の時間', contact.hours]] : []),
    [internal ? '相談のときに伝えること' : '電話で伝えること', contact.what_to_tell],
  ];
  return [
    '<div class="card contact-box">',
    `<h3 class="contact-name">${esc(contact.name)}<span class="contact-role">${ctx.text(contact.role)}</span></h3>`,
    contact.phone ? callHtml(contact.phone) : '',
    factsHtml(ctx, rows),
    contact.contract_location ? `<details class="term contact-more"><summary class="tap">契約番号の控えの場所</summary><p>${ctx.text(contact.contract_location)}</p></details>` : '',
    '</div>',
  ].filter(Boolean).join('\n');
}

function contactsPanel(ctx) {
  // まず誰に言うかの順に、社内の相談先を先に並べる
  const inside = ctx.manual.contacts.filter((c) => c.id.startsWith('INH-'));
  const vendors = ctx.manual.contacts.filter((c) => !c.id.startsWith('INH-'));
  const body = ctx.manual.contacts.length
    ? [
        '<p class="lead">困ったときに連絡する相手です。</p>',
        '<p class="note">押すと、電話をかける画面が開きます。</p>',
        ...(inside.length ? ['<h3>社内の相談先</h3>', ...inside.map((c) => contactCard(ctx, c))] : []),
        ...(vendors.length ? [inside.length ? '<h3>業者</h3>' : '', ...vendors.map((c) => contactCard(ctx, c))] : []),
      ].filter(Boolean).join('\n')
    : emptyHtml('連絡先は、まだこの説明書に入っていません。');
  return `<section id="tab-contacts" class="panel">\n<h2 tabindex="-1">連絡先</h2>\n${body}\n</section>`;
}

// ---- 毎月やること ----
/** 基準日の月から数えて、何か月先か。月のない年の作業は最後に回す。 */
function monthsAway(routine, asOfMonth) {
  return routine.month === undefined ? 12 : (routine.month - asOfMonth + 12) % 12;
}

function routineHtml(ctx, routine) {
  // 題名に月が書いてあれば、同じことを2回出さない。書いていなければ、月をデータから補う
  const showMonth = routine.frequency === 'yearly' && routine.month !== undefined && !ctx.raw(routine.title).includes(`${routine.month}月`);
  const month = showMonth ? `<p class="routine-month">毎年${esc(routine.month)}月</p>` : '';
  const steps = routine.steps.map((id, index) => `<li><span class="step-number">${index + 1}</span><span class="step-text">${ctx.text(id)}</span></li>`);
  const details = steps.length
    ? `<details class="routine-steps" open><summary class="tap">手順を見る</summary><ol class="routine-list" role="list">${steps.join('')}</ol></details>`
    : '';
  return `<article class="card routine" data-frequency="${esc(routine.frequency)}">${month}<h4 class="routine-title">${ctx.text(routine.title)}</h4>${details}</article>`;
}

function routinesPanel(ctx) {
  const { routines, as_of: asOf, glossary } = ctx.manual;
  if (!routines.length) {
    return `<section id="tab-routines" class="panel">\n<h2 tabindex="-1">毎月やること</h2>\n${emptyHtml('毎月やることは、まだこの説明書に入っていません。')}\n</section>`;
  }
  const asOfMonth = Number(asOf.slice(5, 7));
  const groups = FREQUENCY_LABELS.map(([frequency, label]) => {
    const items = routines.filter((r) => r.frequency === frequency);
    if (!items.length) return '';
    if (frequency === 'yearly') items.sort((a, b) => monthsAway(a, asOfMonth) - monthsAway(b, asOfMonth));
    const note = frequency === 'yearly' ? `<p class="note">${esc(formatDate(asOf))}から近い順に並べています。</p>\n` : '';
    return `<h3>${esc(label)}</h3>\n${note}${items.map((r) => routineHtml(ctx, r)).join('\n')}`;
  }).filter(Boolean);
  const link = glossary.length ? '\n<p class="tab-link"><a class="tap button button-quiet" href="#company-terms">分からないことばを調べる</a></p>' : '';
  return `<section id="tab-routines" class="panel">\n<h2 tabindex="-1">毎月やること</h2>\n<p class="lead">決まった時期にやる作業です。</p>\n${groups.join('\n')}${link}\n</section>`;
}

// ---- 会社のIT ----
function deviceHtml(ctx, device) {
  return [
    '<article class="card device">',
    `<h4 class="device-name">${ctx.text(device.name)}</h4>`,
    factsHtml(ctx, [
      ['置き場所', device.location],
      ['役割', device.purpose],
      ['止まると', device.impact],
    ]),
    '</article>',
  ].join('\n');
}

function companyPanel(ctx) {
  const { devices, glossary } = ctx.manual;
  const list = devices.length
    ? `<p class="lead">会社にある機器と、ことばの説明です。</p>\n${glossary.length ? '<p class="tab-link"><a class="tap button button-quiet" href="#company-terms">ことばの説明へ移る</a></p>\n' : ''}<h3>機器の一覧</h3>\n${devices.map((d) => deviceHtml(ctx, d)).join('\n')}`
    : emptyHtml('機器の一覧は、まだこの説明書に入っていません。');
  const terms = glossary.length
    ? `<h3 id="company-terms" tabindex="-1">ことばの説明</h3>\n<p class="note">押すと説明が開きます。</p>\n<div class="terms">\n${glossary.map((g) => termHtml(ctx, g)).join('\n')}\n</div>`
    : '';
  return `<section id="tab-company" class="panel">\n<h2 tabindex="-1">会社のIT</h2>\n${list}\n${terms}\n</section>`;
}

// ---- 全体 ----
function navHtml() {
  const links = TABS.map(([id, label, name]) => `<a class="tap tab" href="#${id}">${icon(name)}<span>${label}</span></a>`);
  return `<nav class="tabs" aria-label="画面の切り替え">\n${links.join('\n')}\n</nav>`;
}

/** 前任者の確認が終わるまで、下書きだと分かるようにする。 */
const reviewBand = (manual) => (manual.review ? '' : '<p class="draft-band" role="note">下書き（前任者の確認前）</p>\n');

/** 全ページの確認が済んだら、確認した人と日付を示す。 */
const reviewNote = ({ review }) =>
  review
    ? `<p class="confirmed"><span class="seal">${esc(review.reviewer)} 確認 ${esc(formatDate(review.confirmed_on))}</span>この取扱説明書は、AIがもとの情報と照らし合わせ、前任の${esc(review.reviewer)}さんが全ページを確認したものです。</p>\n`
    : '';

/** 取扱説明書の中身から HTML の文字列を作る。入力に異常があれば例外を投げる。 */
export function renderManual(manual) {
  checkInput(manual);

  const statements = new Map(manual.statements.map((s) => [s.id, s]));
  const ctx = {
    manual,
    statements,
    contacts: new Map(manual.contacts.map((c) => [c.id, c])),
    raw: (id) => statements.get(id).text,
    text: (id) => statementHtml(statements.get(id).text),
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
${reviewBand(manual)}<p class="confidential"><strong>社外秘</strong>${company}</p>
<h1>ITの取扱説明書</h1>
<p>${esc(formatDate(manual.as_of))}時点の内容です。</p>
${reviewNote(manual)}</header>
<main>
${helpPanel(ctx)}
${manual.symptom_pages.map((page) => symptomPanel(ctx, page)).join('\n')}
${contactsPanel(ctx)}
${routinesPanel(ctx)}
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
