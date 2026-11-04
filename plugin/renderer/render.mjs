#!/usr/bin/env node
// 表示プログラム。取扱説明書の中身から、HTML を1ファイル作る。画面の正は docs/design/visual-spec.md。
// AI を使わず、時刻や乱数にも頼らない。同じ入力からは毎回同じ出力になる。
//
// 使い方：node plugin/renderer/render.mjs <入力.json> <出力.html>
// 終了コード：0＝成功、1＝入力の異常（出力ファイルを作らない）、2＝引数や出力先の誤り

import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bodyFields, pageStatementIds, parseInfoRow } from '../lib/page-check.mjs';
import { validate } from '../lib/validate.mjs';
import { CLIENT_HEAD_SCRIPT, CLIENT_SCRIPT } from './client.mjs';
import { STYLES } from './styles.mjs';
import { oversizeMessage, PC_FILE_LIMIT, writeWithinLimit } from '../lib/limits.mjs';
import { callScriptProblems, replyProblems } from '../lib/reply.mjs';
import { firstStepFigures } from '../lib/figures.mjs';
import { latestUpdateOf, UPDATE_KIND_LABELS } from '../lib/update.mjs';

const SCHEMA = JSON.parse(readFileSync(new URL('../schemas/manual.schema.json', import.meta.url), 'utf8'));

// ---- 画面の固定の文言 ----
export const BADGE_LABELS = { self: '自分で直せる', check_first: '確認してから', vendor: '業者へ連絡', internal: '社内で相談' };

// 凡例の短い説明。バッジの意味を「はじめに」で一度だけ伝える
const BADGE_MEANINGS = {
  self: '自分でやります',
  check_first: '確かめてから動きます',
  vendor: '業者に電話します',
  internal: '社内の人に聞きます',
};

export const CATEGORY_LABELS = [
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

const SCREEN_TITLE_HELP = '困ったとき';

// ---- 印。線だけのインライン SVG で、色は文字の色に従う ----
export const ICONS = {
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>',
  phone:
    '<path d="M6.6 3.5h2.2c.5 0 .9.3 1 .8l.8 3.2c.1.4 0 .8-.3 1L8.7 9.9a13 13 0 0 0 5.4 5.4l1.4-1.6c.3-.3.7-.4 1-.3l3.2.8c.5.1.8.5.8 1v2.2c0 1.1-.9 2-2 2C10.6 19.4 4.6 13.4 4.6 5.5c0-1.1.9-2 2-2z"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6M16 4.8a3.5 3.5 0 0 1 0 6.4M17.5 14.3c2.2.7 3.5 2.8 3.5 5.7"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.6-3.1 8-7.5 9.5-4.4-1.5-7.5-4.9-7.5-9.5V6z"/><path d="M8.8 12l2.3 2.3 4.2-4.4"/>',
  cross: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
  next: '<path d="M9 6l6 6-6 6"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.1 1-1.1 1.8M12 16.8v.01"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="15" rx="2"/><path d="M4 10.5h16M8.5 3.5v4M15.5 3.5v4"/>',
  monitor: '<rect x="3.5" y="4.5" width="17" height="12" rx="2"/><path d="M9 20h6M12 16.5V20"/>',
  list: '<path d="M8.5 6.5H20M8.5 12H20M8.5 17.5H20M4 6.5h.01M4 12h.01M4 17.5h.01"/>',
  stamp: '<rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><path d="M8 12.3l2.8 2.8L16.2 9.300"/>',
};

const icon = (name, extra = '') => `<svg class="icon${extra ? ` ${extra}` : ''}" role="presentation"><use href="#i-${name}"/></svg>`;

// アイコンの形は1か所にまとめる。同じ形を何度も書くと、ファイルが大きくなる
const iconDefs = (review) => `<svg class="icon-defs" width="0" height="0" role="presentation">${Object.entries({ ...ICONS, minus: '<path d="M5 12h14"/>', 'plus-v': '<path d="M12 5v14"/>' }).map(([name, shape]) => `<symbol id="i-${name}" viewBox="0 0 24 24">${shape}</symbol>`).join('')}${review ? `<symbol id="i-seal" viewBox="0 0 64 64">${sealParts(review).body}</symbol>` : ''}</svg>`;

/** CSS のコメント、字下げ、空行を除く。ファイルの上限のため。値は変えない。 */
export const compactCss = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]+/gm, '').replace(/\n{2,}/g, '\n');

/** 開閉の印。縦の線を CSS で消して「＋」と「−」を切り替える。 */
const PLUS_MINUS = '<svg class="icon plus" role="presentation"><use href="#i-minus"/><use class="plus-v" href="#i-plus-v"/></svg>';

export const BADGE_ICONS = { self: 'check', check_first: 'alert', vendor: 'phone', internal: 'people' };

// 文字を大きくしたときは、<wbr> の位置（語の切れ目）でだけ折り返す
const TABS = [
  ['tab-help', '困った<wbr>とき', 'help'],
  ['tab-contacts', '連絡先', 'phone'],
  ['tab-routines', '毎月<wbr>やること', 'calendar'],
  ['tab-company', '会社の<wbr>IT', 'monitor'],
];

// ---- 文字の扱い ----
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** 2026-11-05 を 2026年11月5日 にする。文字列のまま変換する。 */
function formatDate(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return `${year}年${month}月${day}日`;
}

/**
 * 電話番号の表示。iPhone では長押しの選択がハイフンで切れて「発信」が出ないので（本人の実機）、
 * 文字としてのハイフンを入れず、区切りは CSS の余白で見せる。
 */
export const telHtml = (phone) => `<span class="tel">${String(phone).split('-').map((part) => `<span>${esc(part)}</span>`).join('')}</span>`;

const PHONE_IN_TEXT = /(?<![\d-])0\d{0,4}-\d{1,4}-\d{3,4}(?![\d-])/g;

/**
 * 文章を HTML にする。\\ で始まる接続先は、見ながら入力する値なので、コードの形で示す。
 * 文字は電話番号のハイフンのほかは変えない。
 */
export function statementHtml(text, words) {
  return wrapWords(pathsHtml(esc(text)), words).replace(PHONE_IN_TEXT, telHtml);
}

/** 接続先をコードの形にする。 */
const pathsHtml = (escaped) => escaped.replace(/\\\\[^\s、。，．）」』]+/g, (path) => `<code class="path">${valueHtml(path)}</code>`);

/** 値は語の途中で折り返さない。区切りの記号の直後でだけ折り返せるようにする。文字は変えない。 */
const valueHtml = (escaped) => escaped.replace(/(?<=[^\\][\\/_.-])(?=[^\\/_.-])/g, '<wbr>');

// 語の途中で折り返さない語の長さの上限。これより長い語を固定すると、スマホの幅からはみ出すため
const WORD_LENGTH_MAX = 16;

/** 語の途中で折り返さない語の探し方を作る。用語集の語と、カタカナの語（続く短い漢字まで）。 */
function wordPattern(glossary) {
  const terms = glossary.map((entry) => entry.term).filter((term) => term.length <= WORD_LENGTH_MAX).sort((a, b) => b.length - a.length);
  const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp([...escaped, '[ァ-ヶー]{2,}(?: [ァ-ヶー]{2,})*[一-龠々]{0,2}'].join('|'), 'g');
}

/** 語を折り返さない印で包む。接続先とキーの中は変えない。文字は変えない。 */
function wrapWords(html, words) {
  return html
    .split(/(<(?:code|kbd)\b[^>]*>[\s\S]*?<\/(?:code|kbd)>)/)
    .map((part, index) => (index % 2 ? part : part.replace(words, (word) => (word.length <= WORD_LENGTH_MAX ? `<span class="nb">${word}</span>` : word))))
    .join('');
}

/** 操作の文の中のキーの名前を kbd で囲む。文字は変えない。 */
export const actionHtml = (text, words) => wrapWords(pathsHtml(esc(text)).replace(/(?<![A-Za-z0-9-])([A-Z][A-Za-z0-9]*) (のキー|キー)/g, (_, key, rest) => `<kbd>${key}</kbd> ${rest}`), words).replace(PHONE_IN_TEXT, telHtml);

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
    ...manual.glossary.flatMap((g) => [['用語', g.term], [`${g.term} の一言`, g.one_line], [`${g.term} のたとえ`, g.analogy]]),
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
    ...manual.devices.flatMap((d) => [d.name, d.location, d.purpose, d.impact, d.credential_location, d.caution].filter(Boolean)),
    ...manual.glossary.map((g) => g.company),
  ];
}

export function checkInput(manual) {
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

  const replies = [...replyProblems(manual), ...callScriptProblems(manual)];
  if (replies.length) throw new Error(`社員に返す文か業者に伝える文に問題があります:\n${replies.map((p) => `- ${p}`).join('\n')}`);
}

// ---- 部品 ----
const isPhoneNumber = (phone) => /^\+?[0-9][0-9-]*$/.test(phone);

/** 判定バッジ。形は4種で同じで、色とアイコンだけが違う。 */
const badgeHtml = (value) =>
  `<span class="badge" data-badge="${esc(value)}" title="${esc(BADGE_LABELS[value])}">${icon(BADGE_ICONS[value])}<span class="badge-text">${esc(BADGE_LABELS[value])}</span></span>`;

const etaHtml = (minutes) => `<span class="eta">目安 約${esc(minutes)}分</span>`;

/** 電話ボタン。番号として正しい形のときだけリンクにし、それ以外は文字で見せる。 */
function callHtml(phone, quiet = false) {
  if (!isPhoneNumber(phone)) return `<p class="phone-text">電話番号：${esc(phone)}</p>`;
  const kind = quiet ? 'btn-call-quiet' : 'btn-call';
  return `<a class="btn ${kind} tap" href="tel:${esc(phone.replaceAll('-', ''))}">${icon('phone')}<span class="btn-text"><span class="btn-label">電話をかける</span><span class="num">${telHtml(phone)}</span></span></a>`;
}

/** PC では電話を押せないことがあるので、番号をコピーできるようにする。2列以上の幅でだけ出す。 */
const copyNumberHtml = (phone, statusId) =>
  isPhoneNumber(phone) ? `<button type="button" class="btn btn-copy btn-copy-num tap js-only" data-copy-text="${esc(phone)}" data-status="${statusId}">番号をコピー</button>` : '';

const copyStatusHtml = (statusId) => `<span class="js-only copy-status" id="${statusId}" role="status"></span>`;

/** 受付の時間。文章が「受付は〜」で始まるので、見出しを付けると同じ言葉が重なる。印と文だけで示す。 */
const hoursHtml = (ctx, id) => `<p class="contact-hours">${icon('clock')}<span>${ctx.text(id)}</span></p>`;

/** 用語の説明。JavaScript なしでも読めるように開いておき、JavaScript があれば閉じる。 */
/**
 * 手順ページの用語。一言だけを出し、続きは会社のITの説明へ送る。
 * 4段をすべてのページに書くと、同じ文が繰り返されるため。
 */
const pageTermHtml = (ctx, term, id) =>
  `<details class="term" id="${esc(id)}" open><summary class="tap"><span>${esc(term.term)}とは？</span>${PLUS_MINUS}</summary><p>${statementHtml(term.one_line, ctx.words)} <a class="tap text-link" href="#g-all-${ctx.manual.glossary.indexOf(term)}">くわしく</a></p></details>`;

/** 用語の説明。一言で、たとえ、この会社では、困ったときはの順に出す。 */
function termHtml(ctx, term, id) {
  const page = term.help_page && ctx.manual.symptom_pages.find((candidate) => candidate.id === term.help_page);
  const rows = [
    ['一言で', statementHtml(term.one_line, ctx.words)],
    ['たとえ', statementHtml(term.analogy, ctx.words)],
    ['この会社では', ctx.text(term.company)],
    ...(page ? [['困ったときは', `<a class="tap text-link" href="#symptom-${esc(page.id)}"><span>${ctx.text(page.title)}</span></a>`]] : []),
  ];
  return `<details class="term" id="${esc(id)}" open><summary class="tap"><span>${esc(term.term)}とは？</span>${PLUS_MINUS}</summary><dl class="term-rows">${rows.map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`).join('')}</dl></details>`;
}

const emptyHtml = (text) => `<p class="empty">${esc(text)}</p>`;

const factsHtml = (ctx, rows) => `<dl class="facts">${rows.map(([label, id]) => `<dt>${esc(label)}</dt><dd>${ctx.text(id)}</dd>`).join('')}</dl>`;

/** 帯。手順の外に置く。安心は盾、分岐は！、例外は×の印を付ける。 */
const BAND_ICONS = { safe: 'shield', branch: 'alert', exception: 'cross' };
const bandHtml = (ctx, id, kind) => `<p class="band band-${kind}">${icon(BAND_ICONS[kind])}<span>${ctx.text(id)}</span></p>`;
const bandsHtml = (ctx, ids, kind) => ids.map((id) => bandHtml(ctx, id, kind)).join('\n');

/** 直ったと分かる状態。チェック欄を付けない。 */
const goalHtml = (ctx, id) => (id ? `<p class="goal">${icon('check')}<span>${ctx.text(id)}</span></p>` : '');

// ---- 確認の印 ----
const latestCheck = (review) => ({ by: review.updated_by ?? review.reviewer, on: review.updated_on ?? review.confirmed_on });

/** 角印。文字は実寸で 14px にするので、64px の大きさで描く。色は墨で、押せないことを示す。 */
function sealParts(review) {
  // 角印は最新の確認者と確認日を出す。前任者の確認の文は、別に残す
  const { by, on } = latestCheck(review);
  const [, month, day] = on.split('-');
  const name = esc(by);
  // 長い名前は枠の中に収める
  const fit = [...by].length > 3 ? ' textLength="52" lengthAdjust="spacingAndGlyphs"' : '';
  const line = (y, text, attrs = '') => `<text x="32" y="${y}" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor"${attrs}>${text}</text>`;
  return {
    open: `<svg class="seal" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="${name} 確認 ${esc(formatDate(on))}">`,
    body: [
      '<rect x="1" y="1" width="62" height="62" rx="6" fill="none" stroke="currentColor" stroke-width="2"/>',
      line(20, name, fit),
      line(37, '確認'),
      line(54, `${esc(month)}.${esc(day)}`),
    ].join(''),
  };
}

const sealHtml = (review) => {
  const { open, body } = sealParts(review);
  return `${open}${body}</svg>`;
};

/** 手順ページの角印。ページごとに同じ図形を書かず、定義を参照する。 */
const sealUseHtml = (review) => `${sealParts(review).open}<use href="#i-seal"/></svg>`;

/** 新しく描いたオコジョ。白い体と黒い尾先。 */
const OKOJO = [
  '<svg class="okojo" width="16" height="16" viewBox="0 0 32 32" role="presentation" focusable="false">',
  '<path class="okojo-body" d="M1 17.500C2 15.500 3.500 14.500 5 14L5.500 11.500 7.500 13.500C10 13 12 12.500 15 12.500 18 12.500 20 13 22 15L27.500 15.200 27 18.500 24 20C22 20 21.500 21 21.500 24L18.500 24C18.500 22 18 20.500 16 20L10 20C9 21 9 22.500 9 24L6 24C6 22 6.200 20.500 6 19.500 4 19.500 2 19 1 17.500Z"/>',
  '<path class="okojo-tip" d="M27.500 15.200C28.800 14.500 30 13.400 31 12 31.500 15 30 17.700 27 18.500Z"/>',
  '</svg>',
].join('');

// ---- 上部 ----
/** 前任者の確認が終わるまで、下書きだと分かるようにする。 */
const draftBand = ({ review }) => (review ? '' : '<p class="draft-band" role="note">下書き（前任者の確認前）</p>\n');

/** 上部バーの確認の表示。角印の代わりに、文字のない 24px の印を添える。 */
function topStatus({ review }) {
  if (!review) return '<p class="top-status"><span>前任者の確認前</span></p>';
  const { by, on } = latestCheck(review);
  return `<p class="top-status">${icon('stamp', 'top-mark')}<span class="top-status-text"><span>${esc(by)} 確認 </span><span>${esc(formatDate(on))}</span></span></p>`;
}

function topbarHtml(ctx) {
  const links = TABS.map(([id, label]) => `<a class="tap" href="#${id}">${label}</a>`).join('');
  return [
    '<header class="topbar">',
    `<p class="brand"><span class="chip-secret">社外秘</span><span class="brand-names"><span class="brand-company">${esc(ctx.manual.company_name)}</span> <span class="brand-title">ITの取扱説明書</span></span></p>`,
    `<nav class="topnav" aria-label="画面の切り替え">${links}</nav>`,
    '<div class="top-side">',
    topStatus(ctx.manual),
    '<button type="button" class="btn btn-memo-copy tap js-only" data-memo-copy data-status="memo-copy-status">メモをまとめてコピー</button>',
    '<p class="copy-status memo-copy-status" id="memo-copy-status" role="status"></p>',
    '</div>',
    '</header>',
  ].join('\n');
}

// ---- 後任のメモ ----
// メモは確認されていない内容なので、説明書の文とは混ぜない。保存はこの PC のブラウザーの中だけで、ファイルには書かない
export const MEMO_NO_JS = '<p class="memo-nojs">メモは PC 版で書けます</p>';

// 欄の中身は JavaScript が作る。JavaScript なしでは何も出ないので、隠す指定が要らない
const memoHtml = (id, name) => `<div class="memo is-empty" data-memo="${esc(id)}" data-memo-name="${esc(name)}"></div>`;

/** 更新の記録の表。担当が代わっても、誰が何を確認したかを追えるようにする。新しい順。 */
function updateLogHtml({ manual, text }) {
  if (!manual.updates?.length) return '';
  const nameOf = (target) => {
    const page = manual.symptom_pages.find((candidate) => candidate.id === target);
    if (page) return text(page.title);
    const contact = manual.contacts.find((candidate) => candidate.id === target);
    if (contact) return esc(contact.name);
    const device = manual.devices.find((candidate) => candidate.id === target);
    return device ? text(device.name) : esc(target);
  };
  const rows = [...manual.updates].reverse().map(({ target, by, date, kind, summary }) => `<tr><td class="update-date">${esc(formatDate(date))}</td><td class="update-kind">${esc(UPDATE_KIND_LABELS[kind] ?? '')}</td><td>${esc(by)}</td><td>${nameOf(target)}</td><td>${esc(summary ?? '')}</td></tr>`);
  return [
    '<p class="label intro-label">更新の記録</p>',
    '<table class="update-log"><thead><tr><th>日付</th><th>種類</th><th>確認した人</th><th>ページ</th><th>内容</th></tr></thead>',
    `<tbody>${rows.join('')}</tbody></table>`,
  ].join('\n');
}

/** 判定の凡例。はじめにと、PC の開いた直後の画面で同じものを出す。 */
const legendHtml = () => `<ul class="legend" role="list">${Object.keys(BADGE_LABELS).map((value) => `<li>${badgeHtml(value)}<span class="legend-text">${esc(BADGE_MEANINGS[value])}</span></li>`).join('')}</ul>`;

// ---- はじめに ----
function introPanel(ctx) {
  const { manual } = ctx;
  const { review } = manual;
  const cans = [
    ['check', '症状を選ぶと、やることが順に出ます。'],
    ['phone', '直せないときは、電話と、送る文面があります。'],
    ...(review ? [['stamp', `この取扱説明書は、AIがもとの情報と照らし合わせ、前任の${esc(review.reviewer)}さんが全ページを確認したものです。`]] : []),
  ];
  return [
    '<section id="intro" class="panel">',
    `<div class="intro-top"><span class="chip-secret">社外秘</span>${review ? sealHtml(review) : ''}</div>`,
    `<p class="intro-company">${esc(manual.company_name)}</p>`,
    '<h1 class="intro-title">ITの取扱説明書</h1>',
    '<p class="intro-role">この説明書は、社員から最初に相談を受ける人（一次受け）のためのものです。</p>',
    `<p class="intro-date">${esc(formatDate(manual.as_of))}時点の内容です。</p>`,
    '<p class="intro-text">前任の担当者が使っていた設定と手順を、調査と聞き取りをもとにまとめました。</p>',
    `<a class="btn btn-primary tap" href="#tab-help">困ったときは</a>`,
    '<p class="intro-more"><a class="tap text-link" href="#tab-contacts">連絡先を見る</a></p>',
    '<p class="label intro-label">この説明書でできること</p>',
    `<ul class="can-list" role="list">${cans.map(([name, text]) => `<li>${icon(name)}<span>${text}</span></li>`).join('')}</ul>`,
    '<p class="label intro-label">判定の見かた</p>',
    legendHtml(),
    updateLogHtml(ctx),
    '</section>',
  ].filter(Boolean).join('\n');
}

// ---- 困ったとき：症状の一覧 ----
function symHtml(ctx, page) {
  return [
    `<li><a class="sym tap" href="#symptom-${esc(page.id)}">`,
    `<span class="sym-title">${ctx.text(page.title)}</span>`,
    `<span class="sym-meta">${badgeHtml(page.badge.value)}${etaHtml(page.minutes)}</span>`,
    icon('next', 'chev'),
    '</a></li>',
  ].join('');
}

function helpPanel(ctx) {
  const groups = CATEGORY_LABELS.map(([category, label]) => [category, label, ctx.manual.symptom_pages.filter((p) => p.category === category)]).filter(([, , pages]) => pages.length);
  const searchBox = ctx.manual.search_index?.length
    ? [
        '<div class="js-only search-box" id="search-box" role="search">',
        '<label class="search-label" for="search-input">何が起きていますか？</label>',
        '<input class="search-input" id="search-input" type="search" autocomplete="off" enterkeyhint="search">',
        '<div class="search-area">',
        '<p class="search-status" role="status"></p>',
        '<ul class="sym-group search-results" role="list"></ul>',
        '<p class="label search-more">当てはまらないとき</p>',
        '<ul class="sym-group search-fallback" role="list"></ul>',
        '</div>',
        '</div>',
      ].join('\n')
    : '';
  const lead = '<p class="lead">いま困っていることを押してください。</p>\n<p class="note">開いて読むだけなら、PC や機器には何も起きません。</p>';
  if (!groups.length) {
    return `<section id="tab-help" class="panel col-list">\n<h2 tabindex="-1">${SCREEN_TITLE_HELP}</h2>\n${emptyHtml('症状の手順は、まだこの説明書に入っていません。')}\n</section>`;
  }
  const jump = groups.length > 1 ? `<nav class="jump" aria-label="症状のまとまりへ移る">${groups.map(([category, label]) => `<a class="tap" href="#cat-${category}">${esc(label)}</a>`).join('')}</nav>` : '';
  const lists = groups.map(([category, label, pages]) => `<h3 class="group-title" id="cat-${category}">${esc(label)}</h3>\n<ul class="sym-group" role="list">\n${pages.map((page) => symHtml(ctx, page)).join('\n')}\n</ul>`);
  // 一覧に当てはまらないときの行き先を、必ず残す。社内の相談先は連絡先の先頭にある
  const noMatch = `<ul class="sym-group sym-group-last" role="list"><li><a class="sym tap" href="#tab-contacts"><span class="sym-title">当てはまる症状がないとき</span><span class="sym-meta">${badgeHtml('internal')}</span>${icon('next', 'chev')}</a></li></ul>`;
  return [`<section id="tab-help" class="panel col-list">`, `<h2 tabindex="-1">${SCREEN_TITLE_HELP}</h2>`, searchBox, lead, jump, ...lists, noMatch, '</section>'].filter(Boolean).join('\n');
}

/** 2列以上で、まだ症状を選んでいないときに中央の列に出す案内。 */
/** 開いた直後の右の列。社内の相談先の先頭を「まず誰に言うか」として1枚だけ置く。 */
function firstContactHtml(ctx) {
  const first = ctx.manual.contacts.find((contact) => contact.id.startsWith('INH-'));
  if (!first) return '';
  return [
    '<aside class="pick-rail" aria-label="まず誰に言うか">',
    '<div class="rail-block">',
    '<h3 class="label">まず誰に言うか</h3>',
    `<p class="rail-name">${esc(first.name)}</p>`,
    `<p class="rail-hours">${esc(ctx.raw(first.role))}</p>`,
    first.hours ? `<p class="rail-hours">${ctx.text(first.hours)}</p>` : '',
    first.phone ? callHtml(first.phone, true) : '',
    '</div>',
    '</aside>',
  ].filter(Boolean).join('\n');
}

function pickPromptHtml(ctx) {
  const groups = CATEGORY_LABELS.map(([category, label]) => [label, ctx.manual.symptom_pages.filter((p) => p.category === category)]).filter(([, pages]) => pages.length);
  return [
    '<div class="js-only pick-prompt" id="pick-home">',
    firstContactHtml(ctx),
    '<div class="pick-main">',
    '<p class="pick-lead">いま困っていることを押してください。</p>',
    '<p class="pick-note">開いて読むだけなら、PC や機器には何も起きません。</p>',
    '<p class="label pick-label">判定の見かた</p>',
    legendHtml(),
    ...groups.flatMap(([label, pages]) => [`<h3 class="group-title">${esc(label)}</h3>`, `<ul class="sym-group" role="list">\n${pages.map((page) => symHtml(ctx, page)).join('\n')}\n</ul>`]),
    '</div>',
    '</div>',
  ].join('\n');
}

// ---- 手順ページ ----
/**
 * 手順ページに添える用語を選ぶ。同じ用語はページの中で最初の1回だけ。
 * 手順で使う語はその手順の下からリンクし、説明はすべてページの最後に置く。
 */
export function pageTerms(ctx, page, contact) {
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

const termAnchor = (ctx, page, term) => `g-${page.id}-${ctx.manual.glossary.indexOf(term)}`;

/** ① まずこれだけ。手順ページの最初に見る場所で、ページ内で唯一の暖色の枠と影を持つ。 */
function firstHtml(ctx, page, number) {
  const many = page.first_steps.length > 1;
  const figures = firstStepFigures(page, ctx.manual);
  return [
    '<section class="first">',
    `<h3 class="first-kicker">${number} まずこれだけ <span class="eta">1分</span></h3>`,
    `<div class="first-steps${many ? ' is-many' : ''}">`,
    page.first_steps.map((id) => `<p class="first-body"><span>${actionHtml(ctx.raw(id), ctx.words)}${figures.get(id) ?? ''}</span></p>`).join('\n'),
    '</div>',
    goalHtml(ctx, page.first_goal),
    '</section>',
  ].filter(Boolean).join('\n');
}

function notesHtml(ctx, page, leading) {
  if (!page.notes.length) return '';
  return `<div class="page-notes${leading ? ' is-main' : ''}"><h3 class="sub-title">先に知っておくこと</h3>\n<ul role="list">\n${page.notes.map((id) => `<li>${ctx.text(id)}</li>`).join('\n')}\n</ul></div>`;
}

/** この症状で使う会社の情報。値は検証した文章から読む。本文と右の列で同じものを出す。 */
export function infoTables(ctx, page) {
  const rows = page.info_rows.map((id) => parseInfoRow(ctx.raw(id)));
  const drives = rows.filter((row) => row.type === 'drive');
  const values = rows.filter((row) => row.type === 'value');
  const driveTable = drives.length
    ? `<table class="info-table info-drives">\n<thead><tr><th scope="col">PC</th><th scope="col">ドライブ</th><th scope="col">接続先</th></tr></thead>\n<tbody>\n${drives.map((row) => `<tr><td class="info-target">${valueHtml(esc(row.target ?? '全員'))}</td><td class="info-drive">${esc(row.drive)}</td><td class="info-path"><code class="path">${valueHtml(esc(row.path))}</code></td></tr>`).join('\n')}\n</tbody>\n</table>`
    : '';
  const valueTable = values.length
    ? `<table class="info-table info-values">\n<thead><tr><th scope="col">項目</th><th scope="col">値</th></tr></thead>\n<tbody>\n${values.map((row) => `<tr><td class="info-target">${esc(row.label)}</td><td class="info-path"><code class="path">${valueHtml(esc(row.value))}</code></td></tr>`).join('\n')}\n</tbody>\n</table>`
    : '';
  return [driveTable, valueTable].filter(Boolean).join('\n');
}

function infoHtml(ctx, page) {
  if (!page.info_rows.length) return '';
  return `<div class="info-block"><h3 class="sub-title">この症状で使う会社の情報</h3>\n<div class="card info-card">\n${infoTables(ctx, page)}\n</div></div>`;
}

/** 部品の補足は、手順の下に分けて出す。チェックの対象は最初の1文の操作だけ。 */
export function stepParts(text) {
  const end = text.indexOf('。');
  return end < 0 || end === text.length - 1 ? [text, ''] : [text.slice(0, end + 1), text.slice(end + 1)];
}

function stepsHtml(ctx, page, stepTerms, heading) {
  const items = page.steps.map((id, index) => {
    const [body, note] = stepParts(ctx.raw(id));
    // 短い手順だけ文節で折り返す。長い文を文節で切ると、かえって行の長さがばらつくため
    const bodyClass = body.length <= SHORT_STEP_LENGTH ? 'step-body is-short' : 'step-body';
    const noteHtml = note ? `<p class="step-note">${statementHtml(note, ctx.words)}</p>` : '';
    const terms = stepTerms[index].length
      ? `<p class="step-terms">${stepTerms[index].map((term) => `<a class="tap" href="#${esc(termAnchor(ctx, page, term))}">${esc(term.term)}とは？</a>`).join('')}</p>`
      : '';
    return [
      '<li class="step">',
      `<label class="tap"><input type="checkbox" data-check="${esc(page.id)}:${esc(id)}">`,
      `<span class="step-n">${index + 1}</span>`,
      `<span class="${bodyClass}">${actionHtml(body, ctx.words)}</span>`,
      `<span class="step-box">${icon('check')}</span>`,
      '</label>',
      noteHtml,
      terms,
      '</li>',
    ].join('');
  });
  return [
    '<div class="part part-steps">',
    `<div class="part-head"><h3 class="part-title">${heading}</h3><p class="progress"><span class="count-static">手順は ${page.steps.length} つです</span><span class="count-live"></span></p></div>`,
    bandsHtml(ctx, page.branches, 'branch'),
    '<p class="steps-note">上から順に進めます。終わった手順にチェックを入れてください。</p>',
    `<ol class="steps" role="list">\n${items.join('\n')}\n</ol>`,
    goalHtml(ctx, page.goal),
    bandsHtml(ctx, page.exceptions, 'exception'),
    '<button type="button" class="tap js-only btn-reset" data-reset>チェックをすべて外す</button>',
    '</div>',
  ].filter(Boolean).join('\n');
}

/** 連絡先の部。手順ページでは、連絡先の「伝えること」ではなく、このページの文面だけを出す。 */
function contactPartHtml(ctx, page, contact, heading, leading) {
  const messageId = `message-${esc(page.id)}`;
  const statusId = `copy-status-${esc(page.id)}`;
  const internal = contact.id.startsWith('INH-');
  return [
    `<div class="part part-contact${leading ? ' is-lead' : ''}">`,
    `<h3 class="part-title">${heading}</h3>`,
    '<div class="contact-box">',
    `<h4 class="contact-name">${esc(contact.name)}<span class="contact-role">${esc(ctx.raw(contact.role))}</span></h4>`,
    contact.hours ? hoursHtml(ctx, contact.hours) : '',
    !contact.phone && contact.id.startsWith('VEN-') ? '<p class="no-phone">電話番号の記録がありません</p>' : contact.phone ? `<div class="call-row">${callHtml(contact.phone)}${copyNumberHtml(contact.phone, statusId)}</div>` : '',
    `<p class="say-label">${internal ? '相談のときに伝える文面' : '業者に送る文面'}</p>`,
    `<blockquote class="say" id="${messageId}">${ctx.text(page.fallback.message)}</blockquote>`,
    `<button type="button" class="btn btn-copy tap js-only" data-copy="${messageId}" data-status="${statusId}">文面をコピー</button>`,
    copyStatusHtml(statusId),
    '</div>',
    '</div>',
  ].filter(Boolean).join('\n');
}

/** 右の列。手順を読みながら見る表と連絡先。本文にも同じものがあるので、1200px 未満と印刷では出さない。 */
function railHtml(ctx, page, contact, leading) {
  if (!page.info_rows.length && !contact) return '';
  const statusId = `copy-status-rail-${esc(page.id)}`;
  const info = page.info_rows.length ? `<div class="rail-block"><h3 class="label">この症状で使う会社の情報</h3>\n${infoTables(ctx, page)}\n</div>` : '';
  // 右の列の電話は枠だけにする。塗りつぶした電話は本文の連絡先にあり、画面の主役を1つにするため
  const contactBlock = contact
    ? [
        '<div class="rail-block">',
        `<h3 class="label">${leading ? '連絡先' : '直らなかったら'}</h3>`,
        `<p class="rail-name">${esc(contact.name)}</p>`,
        contact.hours ? `<p class="rail-hours">${ctx.text(contact.hours)}</p>` : '',
        contact.phone ? callHtml(contact.phone, true) : '',
        leading ? '' : `<button type="button" class="btn btn-copy tap js-only" data-copy="message-${esc(page.id)}" data-status="${statusId}">文面をコピー</button>`,
        leading ? '' : copyStatusHtml(statusId),
        '</div>',
      ].filter(Boolean).join('\n')
    : '';
  return `<aside class="rail" aria-label="この症状の情報">\n${info}\n${contactBlock}\n</aside>`;
}

/** ページに表示した記述の根拠から、確かめ方の一文を作る。as_of は調査の日付で、確認の日付とは別のもの。 */
export function evidenceLines(ctx, ids, pageId) {
  const evidence = ids.flatMap((id) => ctx.statements.get(id).evidence);
  const has = (prefix) => evidence.some((ref) => ref.startsWith(prefix));
  const sources = [
    ...(has('INV-') ? [`調査データ（${formatDate(ctx.manual.as_of)}時点）`] : []),
    ...(has('INT-') ? ['聞き取り'] : []),
    ...(has('PUB-') ? ['公開資料'] : []),
    ...(has('LIB-') ? ['確認済みの標準手順'] : []),
  ];
  const { review } = ctx.manual;
  const made = review ? `作成：${esc(formatDate(review.confirmed_on))} ${esc(review.reviewer)} 確認` : 'この手順は、前任者の確認前です。';
  const update = pageId ? latestUpdateOf(ctx.manual, pageId) : null;
  return [made, ...(update ? [`更新：${esc(formatDate(update.date))} ${esc(update.by)} 確認`] : []), `もとにした情報：${sources.join('、')}`];
}

function evidenceHtml(ctx, ids, pageId) {
  const { review } = ctx.manual;
  const lines = evidenceLines(ctx, ids, pageId);
  return `<div class="evidence">${review ? sealUseHtml(review) : ''}<p>${lines.map((line) => `<span>${line}</span>`).join('')}</p></div>`;
}

const CIRCLED = ['①', '②', '③', '④'];

/** 社員に返す文。業者に送る文面と同じ部品で、JavaScript なしでは選択しやすい枠だけを出す。 */
function replyHtml(ctx, page) {
  const id = `reply-${esc(page.id)}`;
  const statusId = `copy-status-reply-${esc(page.id)}`;
  return [
    '<div class="reply-box">',
    '<p class="say-label">社員に返す文</p>',
    `<blockquote class="say reply" id="${id}">${ctx.text(page.reply_to_staff)}</blockquote>`,
    `<button type="button" class="btn btn-copy tap js-only" data-copy="${id}" data-status="${statusId}">文面をコピー</button>`,
    copyStatusHtml(statusId),
    '</div>',
  ].join('\n');
}

function symptomPanel(ctx, page) {
  const contact = page.fallback ? ctx.contacts.get(page.fallback.contact) : null;
  const terms = pageTerms(ctx, page, contact);
  const allTerms = [...terms.steps.flat(), ...terms.rest];
  const shownIds = [...pageStatementIds(page), ...(contact?.hours ? [contact.hours] : [])];
  // 3部構成。部がないページは番号を詰め、見出しもそのページに合う言葉にする
  const hasFirst = page.first_steps.length > 0;
  const hasSteps = page.steps.length > 0;
  // 操作が1つもないページは、連絡先を主役にして、題名と判定のすぐあとに置く
  const contactLeads = !hasFirst && !hasSteps && Boolean(contact);
  let part = 0;
  const number = () => CIRCLED[part++];
  const first = hasFirst ? firstHtml(ctx, page, number()) : '';
  const steps = hasSteps ? stepsHtml(ctx, page, terms.steps, `${number()} ${hasFirst ? 'それでも直らなければ' : 'やること'}`) : '';
  const lastLabel = hasFirst || hasSteps ? 'それでもだめなら' : contact?.id.startsWith('INH-') ? '相談してください' : '連絡してください';
  const last = contact ? contactPartHtml(ctx, page, contact, `${number()} ${lastLabel}`, contactLeads) : '';
  // 手順がないページの分岐と例外も、落とさず出す
  const looseBands = hasSteps ? '' : [bandsHtml(ctx, page.branches, 'branch'), bandsHtml(ctx, page.exceptions, 'exception')].filter(Boolean).join('\n');
  const backLink = `<a class="tap back" href="#tab-help">${icon('back')}<span>症状の一覧に戻る</span></a>`;
  const termsBlock = allTerms.length
    ? `<div class="terms-block"><h3 class="sub-title">このページのことば</h3>\n<div class="terms">\n${allTerms.map((term) => pageTermHtml(ctx, term, termAnchor(ctx, page, term))).join('\n')}\n</div></div>`
    : '';
  const parts = [
    `<article id="symptom-${esc(page.id)}" class="panel symptom" data-tab="tab-help">`,
    '<div class="symptom-body">',
    backLink,
    `<h2 class="symptom-title" tabindex="-1">${ctx.text(page.title)}</h2>`,
    `<div class="verdict">${badgeHtml(page.badge.value)}${etaHtml(page.minutes)}</div>`,
    `<p class="verdict-text">${ctx.text(page.badge.statement)}</p>`,
    bandHtml(ctx, page.reassurance, 'safe'),
    hasFirst ? '' : replyHtml(ctx, page),
    contactLeads ? last : '',
    first,
    hasFirst ? replyHtml(ctx, page) : '',
    notesHtml(ctx, page, !hasFirst && !hasSteps),
    looseBands,
    steps,
    contactLeads ? '' : last,
    !contact && ctx.manual.contacts.length ? '<p class="tab-link"><a class="tap text-link" href="#tab-contacts">連絡先の一覧を見る</a></p>' : '',
    infoHtml(ctx, page),
    memoHtml(page.id, ctx.raw(page.title)),
    MEMO_NO_JS,
    termsBlock,
    evidenceHtml(ctx, shownIds, page.id),
    backLink,
    '</div>',
    railHtml(ctx, page, contact, contactLeads),
    '</article>',
  ];
  return parts.filter(Boolean).join('\n');
}

// ---- 連絡先 ----
/** 連絡先のカードと、その下のメモ。 */
const contactWithMemo = (ctx, contact) => `<div class="with-memo">\n${contactCard(ctx, contact)}\n${memoHtml(contact.id, contact.name)}\n</div>`;

function contactCard(ctx, contact) {
  const internal = contact.id.startsWith('INH-');
  const statusId = `copy-status-c-${esc(contact.id)}`;
  return [
    '<div class="card contact-box">',
    `<h3 class="contact-name">${esc(contact.name)}<span class="contact-role">${esc(ctx.raw(contact.role))}</span></h3>`,
    contact.hours ? hoursHtml(ctx, contact.hours) : '',
    !contact.phone && contact.id.startsWith('VEN-') ? '<p class="no-phone">電話番号の記録がありません</p>' : contact.phone ? `<div class="call-row">${callHtml(contact.phone)}${copyNumberHtml(contact.phone, statusId)}</div>` : '',
    contact.phone ? copyStatusHtml(statusId) : '',
    `<p class="say-label">${internal ? '相談のときに伝えること' : '電話で伝えること'}</p>`,
    `<blockquote class="say">${ctx.text(contact.what_to_tell)}</blockquote>`,
    contact.contract_location
      ? `<details class="term contact-more" open><summary class="tap"><span>契約番号の控えの場所</span>${PLUS_MINUS}</summary><p>${ctx.text(contact.contract_location)}</p></details>`
      : '',
    '</div>',
  ].filter(Boolean).join('\n');
}

function contactsPanel(ctx) {
  // まず誰に言うかの順に、社内の相談先を先に並べる
  const inside = ctx.manual.contacts.filter((c) => c.id.startsWith('INH-'));
  const vendors = ctx.manual.contacts.filter((c) => !c.id.startsWith('INH-'));
  const grid = (items) => `<div class="contact-grid">\n${items.map((c) => contactWithMemo(ctx, c)).join('\n')}\n</div>`;
  const body = ctx.manual.contacts.length
    ? [
        '<p class="lead">困ったときに連絡する相手です。</p>',
        '<p class="note">電話のボタンを押すと、電話をかける画面が開きます。</p>',
        MEMO_NO_JS,
        ...(inside.length ? ['<h3 class="section-title">まず社内に相談</h3>', grid(inside)] : []),
        ...(vendors.length ? [inside.length ? '<h3 class="section-title">業者</h3>' : '', grid(vendors)] : []),
      ].filter(Boolean).join('\n')
    : emptyHtml('連絡先は、まだこの説明書に入っていません。');
  return `<section id="tab-contacts" class="panel screen">\n<h2 tabindex="-1">連絡先</h2>\n${body}\n</section>`;
}

// ---- 毎月やること ----
/** 基準日の月から数えて、何か月先か。月のない年の作業は最後に回す。 */
function monthsAway(routine, asOfMonth) {
  return routine.month === undefined ? 12 : (routine.month - asOfMonth + 12) % 12;
}

function routineHtml(ctx, routine) {
  const steps = routine.steps.map((id, index) => `<li><span class="step-n">${index + 1}</span><span>${ctx.text(id)}</span></li>`);
  const details = steps.length
    ? `<details class="term routine-steps" open><summary class="tap"><span>手順を見る</span>${PLUS_MINUS}</summary><ol class="routine-list" role="list">${steps.join('')}</ol></details>`
    : '';
  const title = `<h4 class="routine-title">${ctx.text(routine.title)}</h4>`;
  if (routine.frequency !== 'yearly') return `<article class="card routine" data-frequency="${esc(routine.frequency)}">${title}${details}</article>`;
  // 年表の左に月を太字でそろえる。題名に月が書いてあれば、同じことを2回出さない
  const showMonth = routine.month !== undefined && !ctx.raw(routine.title).includes(`${routine.month}月`);
  const month = `<p class="routine-month">${showMonth ? `${esc(routine.month)}月` : ''}</p>`;
  return `<article class="routine routine-year" data-frequency="yearly">${month}<div class="routine-main">${title}${details}</div></article>`;
}

function routinesPanel(ctx) {
  const { routines, as_of: asOf, glossary } = ctx.manual;
  if (!routines.length) {
    return `<section id="tab-routines" class="panel screen">\n<h2 tabindex="-1">毎月やること</h2>\n${emptyHtml('毎月やることは、まだこの説明書に入っていません。')}\n</section>`;
  }
  const asOfMonth = Number(asOf.slice(5, 7));
  const present = FREQUENCY_LABELS.filter(([frequency]) => routines.some((r) => r.frequency === frequency));
  const groups = present.map(([frequency, label]) => {
    const items = routines.filter((r) => r.frequency === frequency);
    if (frequency === 'yearly') {
      items.sort((a, b) => monthsAway(a, asOfMonth) - monthsAway(b, asOfMonth));
      return `<h3 class="section-title" id="freq-yearly">${esc(label)}</h3>\n<p class="note">${esc(formatDate(asOf))}から近い順に並べています。</p>\n<div class="timeline">\n${items.map((r) => routineHtml(ctx, r)).join('\n')}\n</div>`;
    }
    return `<h3 class="section-title" id="freq-${frequency}">${esc(label)}</h3>\n<div class="routine-cards">\n${items.map((r) => routineHtml(ctx, r)).join('\n')}\n</div>`;
  });
  const toc = `<nav class="toc" aria-label="頻度へ移る">${present.map(([frequency, label]) => `<a class="tap" href="#freq-${frequency}">${esc(label)}</a>`).join('')}</nav>`;
  const link = glossary.length ? '\n<p class="tab-link"><a class="tap text-link" href="#company-terms">分からないことばを調べる</a></p>' : '';
  return `<section id="tab-routines" class="panel screen">\n<h2 tabindex="-1">毎月やること</h2>\n<p class="lead">決まった時期にやる作業です。</p>\n<div class="routines-layout">\n${toc}\n<div class="routines-main">\n${groups.join('\n')}${link}\n</div>\n</div>\n</section>`;
}

// ---- 会社のIT ----
function deviceHtml(ctx, device) {
  return [
    '<div class="with-memo">',
    '<article class="card device">',
    `<h4 class="device-name">${ctx.text(device.name)}</h4>`,
    factsHtml(ctx, [
      ['置き場所', device.location],
      ...(device.credential_location ? [['パスワードの保管場所', device.credential_location]] : []),
      ['役割', device.purpose],
      ['止まると', device.impact],
      ...(device.caution ? [['やってはいけないこと', device.caution]] : []),
    ]),
    '</article>',
    memoHtml(device.id, ctx.raw(device.name)),
    '</div>',
  ].join('\n');
}

function companyPanel(ctx) {
  const { devices, glossary } = ctx.manual;
  const list = devices.length
    ? `<div class="company-devices"><h3 class="section-title">機器の一覧</h3>\n${MEMO_NO_JS}\n<div class="device-grid">\n${devices.map((d) => deviceHtml(ctx, d)).join('\n')}\n</div></div>`
    : emptyHtml('機器の一覧は、まだこの説明書に入っていません。');
  const terms = glossary.length
    ? `<div class="company-terms"><h3 class="section-title" id="company-terms" tabindex="-1">ことばの説明</h3>\n<p class="note">押すと説明が開きます。</p>\n<div class="terms">\n${glossary.map((g, index) => termHtml(ctx, g, `g-all-${index}`)).join('\n')}\n</div></div>`
    : '';
  const jump = glossary.length && devices.length ? '<p class="tab-link company-jump"><a class="tap text-link" href="#company-terms">ことばの説明へ移る</a></p>\n' : '';
  return `<section id="tab-company" class="panel screen">\n<h2 tabindex="-1">会社のIT</h2>\n<p class="lead">会社にある機器と、ことばの説明です。</p>\n${jump}<div class="company-layout">\n${list}\n${terms}\n</div>\n</section>`;
}

// ---- フッターと下部タブ ----
function footerHtml() {
  const themes = [
    ['auto', '自動'],
    ['light', '明るい'],
    ['dark', '暗い'],
  ];
  return [
    '<footer class="site-footer">',
    `<p>${OKOJO}<span>このファイルは Okojyo-Soft のヒキツギで作られました。</span></p>`,
    // はじめには文書の最後に置く。JavaScript なしでは続けて読めるので、リンクは JavaScript があるときだけ出す
    '<span class="js-only about-link"><a class="tap text-link" href="#intro">この説明書について</a></span>',
    `<span class="js-only theme-switch">表示：${themes.map(([value, label]) => `<button type="button" class="tap" data-theme-set="${value}">${label}</button>`).join('')}</span>`,
    '</footer>',
  ].join('\n');
}

function tabsHtml() {
  const links = TABS.map(([id, label, name]) => `<a class="tap" href="#${id}">${icon(name)}<span>${label}</span></a>`);
  return `<nav class="tabs" aria-label="画面の切り替え">\n${links.join('\n')}\n</nav>`;
}

// ---- 全体 ----
/** 探すための索引。画面には出さない。通信はしない。< を消して、script の外に出ないようにする。 */
function searchIndexHtml({ search_index: index, statements, symptom_pages: pages }) {
  if (!index?.length) return '';
  const textOf = new Map(statements.map((s) => [s.id, s.text]));
  const rows = index.map(({ page, phrases }) => ({ page, title: textOf.get(pages.find((p) => p.id === page)?.title) ?? '', phrases }));
  return `<script type="application/json" id="search-index">${JSON.stringify(rows).replace(/</g, '\\u003c')}</script>\n`;
}

/** 画面を組み立てるときに使う、文章と連絡先の引き方。 */
export function makeContext(manual) {
  const statements = new Map(manual.statements.map((s) => [s.id, s]));
  const words = wordPattern(manual.glossary);
  return {
    manual,
    statements,
    contacts: new Map(manual.contacts.map((c) => [c.id, c])),
    raw: (id) => statements.get(id).text,
    words,
    text: (id) => statementHtml(statements.get(id).text, words),
  };
}

/** 取扱説明書の中身から HTML の文字列を作る。入力に異常があれば例外を投げる。 */
export function renderManual(manual) {
  checkInput(manual);
  const ctx = makeContext(manual);
  const company = esc(manual.company_name);
  return `<!doctype html>
<html lang="ja" class="no-js" data-company="${esc(manual.company)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${company} ITの取扱説明書</title>
<script>
${CLIENT_HEAD_SCRIPT}
</script>
<style>
${compactCss(STYLES)}
</style>
</head>
<body>
${iconDefs(manual.review)}
${draftBand(manual)}${topbarHtml(ctx)}
<main>
<div class="workspace">
${helpPanel(ctx)}
<div class="col-main">
${pickPromptHtml(ctx)}
${manual.symptom_pages.map((page) => symptomPanel(ctx, page)).join('\n')}
</div>
</div>
${contactsPanel(ctx)}
${routinesPanel(ctx)}
${companyPanel(ctx)}
${introPanel(ctx)}
</main>
${footerHtml()}
${tabsHtml()}
${searchIndexHtml(manual)}<script>
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
    if (writeWithinLimit(outputPath, html, PC_FILE_LIMIT)) {
      console.error(oversizeMessage(outputPath, html, PC_FILE_LIMIT));
      return 1;
    }
  } catch (error) {
    console.error(`出力先に書き込めません: ${error.message}`);
    return 2;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
