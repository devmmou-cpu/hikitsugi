#!/usr/bin/env node
// スマホ向けの出力。症状ごとの小さな HTML を、フォルダの束として作る。
//
// iPhone の OneDrive の表示では、JavaScript もページ内リンクも動かず、上から順に読むことしかできない（本人の実機）。
// そこで OneDrive のフォルダの一覧を目次にして、1ファイルに1症状だけを置く。
// - script も、リンクも、チェック欄も、開閉も置かない。読むだけで足りるようにする
// - その症状で使う会社の情報の表と連絡先を、同じファイルに同梱する
// - tel: リンクは動かないが、番号の文字を長押しすると発信できる（本人の実機）。番号はただの文字で、下に案内を書く
//   長押しの選択はハイフンで切れるので（本人の実機）、ハイフンの文字を入れず、余白で区切る
// - コピー欄は長押しで選択してコピーできる（本人の実機）。文字の枠のまま、下に案内を書く
// - 用語は details を使わず、開いたまま出す。チェック欄は付けない
//
// 使い方：node plugin/renderer/phone.mjs <入力.json> <出力フォルダ>

import { forDisplay } from '../lib/display.mjs';
import { mkdirSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileSize, oversizeMessage, PHONE_FILE_LIMIT, writeWithinLimit } from '../lib/limits.mjs';
import { contactProblems, pageProblems } from '../lib/page-check.mjs';
import { firstStepFigures } from '../lib/figures.mjs';
import { MEMO_NO_JS, actionHtml, contactGuide, hoursIconName, BADGE_ICONS, BADGE_LABELS, CATEGORY_LABELS, checkInput, compactCss, esc, evidenceLines, ICONS, infoTables, makeContext, pageTerms, stepParts, telHtml } from './render.mjs';
import { STYLES } from './styles.mjs';

const SYMPTOM_NAME_MAX = 30;
const LAST_NUMBER = 99;
/** 書き出すフォルダの名前。OneDrive の一覧でそのまま意味が分かるように、日本語にする。 */
export const PHONE_DIR = 'ITの取扱説明書（スマホ用）';
const CIRCLED = ['①', '②', '③', '④'];

/** 配色は PC 用と同じものを使う。暗い色は OS の設定に従う。 */
const TOKENS = STYLES.slice(STYLES.indexOf(':root {'), STYLES.indexOf(':root[data-theme="dark"]'));

const PHONE_STYLES = compactCss(`${TOKENS}
* { box-sizing: border-box; }
html {
  font-family: system-ui, sans-serif;
  font-size: 17px;
  line-height: 1.7;
  color: var(--ink);
  background: var(--bg);
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
}
body { margin: 0; padding: var(--s4); overflow-wrap: anywhere; }
h1, h2, h3, p, ul, ol, dl, dd, blockquote { margin: 0; }
.nb { white-space: nowrap; }
.top { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s2); font-size: 14px; color: var(--ink-2); }
.chip-secret { padding: 0 var(--s2); font-size: 13px; font-weight: 700; color: var(--ink); border: 1px solid var(--ink); border-radius: 4px; }
.draft { margin-top: var(--s3); padding: var(--s2) var(--s3); font-weight: 700; color: var(--warn-fg); background: var(--warn-bg); border-radius: 8px; }
h1 { margin-top: var(--s4); font-size: 26px; line-height: 1.4; }
.verdict { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s1) var(--s3); margin-top: var(--s3); font-size: 15px; color: var(--ink-2); }
.badge { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px 0 10px; font-size: 15px; font-weight: 700; line-height: 1; white-space: nowrap; border-radius: 999px; }
.badge svg { width: 16px; height: 16px; flex: none; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
.badge[data-badge="self"] { color: var(--ok-fg); background: var(--ok-bg); }
.badge[data-badge="check_first"] { color: var(--warn-fg); background: var(--warn-bg); }
.badge[data-badge="vendor"] { color: var(--call-fg); background: var(--call-bg); }
.badge[data-badge="internal"] { color: var(--ask-fg); background: var(--ask-bg); }
.verdict-text { margin-top: var(--s2); }
.safe { margin-top: var(--s3); color: var(--ink-2); }
.part { margin-top: var(--s6); }
h2 { font-size: 22px; line-height: 1.4; }
h3 { margin-top: var(--s4); font-size: 17px; }
.first { padding: var(--s4); background: var(--card); border: 2px solid var(--accent); border-radius: 12px; }
.first-body { margin-top: var(--s2); font-size: 19px; font-weight: 500; }
.step-figure { display: block; width: 100%; max-width: 320px; height: auto; margin-top: var(--s2); color: var(--ink); }
.goal { margin-top: var(--s3); padding: var(--s2) var(--s3); color: var(--ok-fg); background: var(--ok-bg); border-radius: 8px; }
.band { margin-top: var(--s3); padding: var(--s2) var(--s3); background: var(--card-2); border-radius: 8px; }
.notes, .phone-steps { padding-left: 1.5em; }
.notes li, .phone-steps li { margin-top: var(--s2); }
.step-note { font-size: 15px; color: var(--ink-2); }
.info-table { width: 100%; margin-top: var(--s2); font-size: 15px; border-collapse: collapse; background: var(--card); }
.info-table th, .info-table td { padding: var(--s2); text-align: left; vertical-align: top; border: 1px solid var(--line); }
.info-table th { white-space: nowrap; }
.info-drive { white-space: nowrap; text-align: center; }
code, kbd { font-family: ui-monospace, monospace; font-size: .95em; }
.contact { margin-top: var(--s3); padding: var(--s4); background: var(--card); border: 1px solid var(--line); border-radius: 12px; }
.contact-name { margin-top: 0; font-size: 19px; }
.contact-role { display: block; font-size: 15px; font-weight: 400; color: var(--ink-2); }
.tel { white-space: nowrap; -webkit-user-select: all; user-select: all; }
.tel > span + span { margin-left: .3em; }
.num { margin-top: var(--s2); font-size: 22px; font-weight: 700; line-height: 1.3; letter-spacing: .02em; }
.note { margin-top: var(--s1); font-size: 15px; color: var(--ink-2); }
.no-phone { margin-top: var(--s2); font-weight: 700; color: var(--danger-fg); }
.label { margin-top: var(--s3); font-size: 15px; font-weight: 700; }
.contact-hours { display: flex; gap: var(--s2); align-items: flex-start; }
.contact-hours svg { flex: none; width: 20px; height: 20px; margin-top: 4px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; color: var(--ink-2); }
.say { margin-top: var(--s1); padding: var(--s3) var(--s4); background: var(--card-2); border-left: 4px solid var(--line-strong); border-radius: 0 8px 8px 0; white-space: pre-line; -webkit-user-select: all; user-select: all; }
.terms dt { margin-top: var(--s3); font-weight: 700; }
.terms dd { color: var(--ink-2); }
.foot { margin-top: var(--s7); padding-top: var(--s3); font-size: 14px; color: var(--ink-2); border-top: 1px solid var(--line); }
.foot p + p { margin-top: var(--s1); }
`);

/** 症状名をファイル名に使える形にする。30字で切り、使えない文字と、先頭と末尾の空白とピリオドを置き換える。 */
export function safeSymptomName(title) {
  const cleaned = title.normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
  const cut = [...cleaned].slice(0, SYMPTOM_NAME_MAX).join('');
  return cut.replace(/^[\s.]+|[\s.]+$/g, (edge) => '_'.repeat([...edge].length));
}

/** 「番号 判定 症状.html」の名前を作る。iPhone の OneDrive の一覧は名前の途中で切れるので、記号を減らして症状の文字を残す。 */
export const phoneFileName = (number, badge, title) => `${String(number).padStart(2, '0')} ${BADGE_LABELS[badge]} ${safeSymptomName(title)}.html`;

/** 番号は PC 版と同じ分類の順。同じ分類の中は、説明書の順のまま。 */
function orderedPages(manual) {
  return CATEGORY_LABELS.flatMap(([category]) => manual.symptom_pages.filter((page) => page.category === category));
}

function documentHtml(ctx, title, body, footLines = []) {
  const { manual } = ctx;
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
${PHONE_STYLES}
</style>
</head>
<body>
<p class="top"><span class="chip-secret">社外秘</span><span>${esc(manual.company_name)} ITの取扱説明書</span></p>
${manual.review ? '' : '<p class="draft">下書き（前任者の確認前）</p>\n'}${body}
<div class="foot">
${[...footLines, 'ほかの症状は、フォルダの一覧から開いてください。'].map((line) => `<p>${line}</p>`).join('\n')}
</div>
</body>
</html>
`;
}

/** 判定のバッジ。PC 用と同じ色と形で、図形はこのファイルの中に持つ（ページ内の参照は動かないため）。 */
const badgeHtml = (value) => `<span class="badge" data-badge="${esc(value)}"><svg viewBox="0 0 24 24" role="presentation">${ICONS[BADGE_ICONS[value]]}</svg><span>${esc(BADGE_LABELS[value])}</span></span>`;

const PHONE_NOTE = '番号を長押しすると、発信できます。';
const COPY_NOTE = '長押しして選択し、コピーしてください。';

/** コピーする文の枠と、やり方の案内。 */
const copyBoxHtml = (html) => `<blockquote class="say">${html}</blockquote>\n<p class="note">${COPY_NOTE}</p>`;

/** 連絡先の枠。電話番号はただの文字にする。 */
function contactHtml(ctx, contact, sayLabel, sayId) {
  const parts = [
    '<div class="contact">',
    `<h3 class="contact-name">${esc(contact.name)}<span class="contact-role">${esc(ctx.raw(contact.role))}</span></h3>`,
    // 受付を番号の上に置く。長押しのメニューが番号の下の行に重なるため（本人の実機）
    contact.hours ? `<p class="contact-hours"><svg viewBox="0 0 24 24" role="presentation">${ICONS[hoursIconName(ctx.raw(contact.hours))]}</svg><span>${ctx.text(contact.hours)}</span></p>` : '',
    !contact.phone && contact.id.startsWith('VEN-') ? '<p class="no-phone">電話番号の記録がありません</p>' : contact.phone ? `<p class="num">${telHtml(contact.phone)}</p>\n<p class="note">${PHONE_NOTE}</p>` : '',
    sayId ? `<p class="label">${sayLabel}</p>\n${copyBoxHtml(ctx.text(sayId))}` : '',
    '</div>',
  ];
  return parts.filter(Boolean).join('\n');
}

function symptomHtml(ctx, page, fileTitle) {
  const contact = page.fallback ? ctx.contacts.get(page.fallback.contact) : null;
  const hasFirst = page.first_steps.length > 0;
  const hasSteps = page.steps.length > 0;
  const contactLeads = !hasFirst && !hasSteps && Boolean(contact);
  let part = 0;
  const number = () => CIRCLED[part++];
  const internal = contact?.id.startsWith('INH-');
  const bands = (ids) => ids.map((id) => `<p class="band">${ctx.text(id)}</p>`).join('\n');
  const goal = (id) => (id ? `<p class="goal">${ctx.text(id)}</p>` : '');
  const list = (ids) => ids.map((id) => {
    const [body, note] = stepParts(ctx.raw(id));
    return `<li>${actionHtml(body, ctx.words)}${note ? `<p class="step-note">${actionHtml(note, ctx.words)}</p>` : ''}</li>`;
  }).join('\n');

  // 番号は読む順に振るので、上から順に組み立てる
  const contactPart = () => {
    if (!contact) return '';
    const heading = hasFirst || hasSteps ? 'それでもだめなら' : internal ? '相談してください' : '連絡してください';
    return `<section class="part">\n<h2>${number()} ${heading}</h2>\n${contactHtml(ctx, contact, internal ? '相談するときの言い方' : '業者に伝える文面', page.fallback.message)}\n</section>`;
  };
  const leading = contactLeads ? contactPart() : '';
  const figures = firstStepFigures(page, ctx.manual);
  const first = hasFirst
    ? `<section class="part first">\n<h2>${number()} まずこれだけ</h2>\n${page.first_lead ? `<p class="note">${esc(page.first_lead)}</p>\n` : ''}${page.first_steps.map((id) => `<p class="first-body">${actionHtml(ctx.raw(id), ctx.words)}${figures.get(id) ?? ''}</p>`).join('\n')}\n${goal(page.first_goal)}\n</section>`
    : '';
  const reply = `<section class="part">\n<h2>社員に返す文</h2>\n${copyBoxHtml(ctx.text(page.reply_to_staff))}\n</section>`;
  const notes = page.notes.length ? `<section class="part">\n<h2>先に知っておくこと</h2>\n<ul class="notes">\n${page.notes.map((id) => `<li>${ctx.text(id)}</li>`).join('\n')}\n</ul>\n</section>` : '';
  const info = page.info_rows.length ? `<section class="part">\n<h2>この症状で使う会社の情報</h2>\n${infoTables(ctx, page)}\n</section>` : '';
  const steps = hasSteps
    ? `<section class="part">\n<h2>${number()} ${hasFirst ? 'それでも直らなければ' : 'やること'}</h2>\n${bands(page.branches)}\n<ol class="phone-steps">\n${list(page.steps)}\n</ol>\n${goal(page.goal)}\n${bands(page.exceptions)}\n</section>`
    : [bands(page.branches), bands(page.exceptions)].filter(Boolean).join('\n');
  const closing = contactLeads ? '' : contactPart();
  const noContact = contact ? '' : '<section class="part">\n<h2>連絡先</h2>\n<p>連絡先は、フォルダの中の「00 連絡先」を開いてください。</p>\n</section>';

  const terms = pageTerms(ctx, page, contact);
  const allTerms = [...terms.steps.flat(), ...terms.rest];
  const termsPart = allTerms.length
    ? `<section class="part terms">\n<h2>このページのことば</h2>\n<dl>\n${allTerms.map((term) => `<dt>${esc(term.term)}</dt>\n<dd>${esc(term.one_line)}</dd>`).join('\n')}\n</dl>\n</section>`
    : '';

  const body = [
    `<h1>${ctx.text(page.title)}</h1>`,
    `<p class="verdict">${badgeHtml(page.badge.value)}<span>目安 約${esc(page.minutes)}分</span></p>`,
    `<p class="verdict-text">${ctx.text(page.badge.statement)}</p>`,
    `<p class="safe">${ctx.text(page.reassurance)}</p>`,
    hasFirst ? '' : reply,
    leading,
    first,
    hasFirst ? reply : '',
    notes,
    info,
    steps,
    closing,
    noContact,
    MEMO_NO_JS,
    termsPart,
  ].filter(Boolean).join('\n');
  const shown = [page.title, page.badge.statement, page.reassurance, ...page.first_steps, ...page.steps, ...page.notes, ...page.info_rows, ...page.branches, ...page.exceptions, ...(page.fallback ? [page.fallback.message] : [])];
  return documentHtml(ctx, fileTitle, body, evidenceLines(ctx, shown, page.id));
}

/** 連絡先の一覧。まず誰に言うかの順に、社内の相談先を先に並べる。 */
function contactsHtml(ctx, heading, lead, fileTitle, guide) {
  const { contacts } = ctx.manual;
  const inside = contacts.filter((c) => c.id.startsWith('INH-'));
  const vendors = contacts.filter((c) => !c.id.startsWith('INH-'));
  const card = (c) => {
    const location = c.contract_location ? `<p class="label">契約番号の控えの場所</p>\n<p>${ctx.text(c.contract_location)}</p>\n` : '';
    return contactHtml(ctx, c, c.id.startsWith('INH-') ? '相談のときに伝えること' : '電話で伝えること', c.what_to_tell).replace(/<\/div>$/, `${location}</div>`);
  };
  const body = [
    `<h1>${heading}</h1>`,
    `<p class="verdict-text">${lead}</p>`,
    ...(guide ? [`<p class="note">${guide}</p>`] : []),
    inside.length ? `<section class="part">\n<h2>まず社内に相談</h2>\n${inside.map(card).join('\n')}\n</section>` : '',
    vendors.length ? `<section class="part">\n<h2>業者</h2>\n${vendors.map(card).join('\n')}\n</section>` : '',
    contacts.length ? MEMO_NO_JS : '<p>連絡先は、まだこの説明書に入っていません。</p>',
  ].filter(Boolean).join('\n');
  return documentHtml(ctx, fileTitle, body);
}

/** 1ファイルの形の問題を返す。外へ出ない、ほかへ飛ばない。 */
function phoneShapeProblems(html) {
  const problems = [];
  if (/<script\b/i.test(html)) problems.push('script があります');
  if (/<a\b|\bhref\s*=/i.test(html)) problems.push('リンクがあります');
  if (/<(?:input|details|button|iframe|img|link|use)\b/i.test(html)) problems.push('操作する部品か、読み込む部品があります');
  if (/\bsrc\s*=|url\s*\(|@import/i.test(html)) problems.push('外部を読み込む指定があります');
  return problems;
}

/** 1ファイルの問題を返す。形に加えて、大きすぎないこと。 */
export function phoneFileProblems(html) {
  return [...(fileSize(html) > PHONE_FILE_LIMIT ? [`上限の ${PHONE_FILE_LIMIT / 1024}KB を超えています`] : []), ...phoneShapeProblems(html)];
}

/**
 * スマホ向けのファイルの一覧を作る。{ name, html } の配列で、並びはフォルダの一覧と同じ。
 * 入力か出力に問題があれば、例外を投げて1つも作らない。
 */
export function renderPhoneBundle(input) {
  checkInput(input);
  const shape = [...pageProblems(input), ...contactProblems(input)];
  const manual = forDisplay(input);
  if (shape.length) throw new Error(`手順ページの形に問題があります:\n${shape.map((p) => `- ${p}`).join('\n')}`);
  const pages = orderedPages(manual);
  if (pages.length >= LAST_NUMBER) throw new Error(`症状が多すぎて、番号が 99 に届きます（${pages.length} ページ）`);

  const ctx = makeContext(manual, { links: false });
  const bundle = [
    { name: '00 連絡先.html', html: contactsHtml(ctx, '連絡先', '困ったときに連絡する相手です。', '連絡先', contactGuide(manual.contacts)) },
    ...pages.map((page, index) => {
      const title = ctx.raw(page.title);
      return { name: phoneFileName(index + 1, page.badge.value, title), html: symptomHtml(ctx, page, title) };
    }),
    { name: '99 当てはまる症状がないとき.html', html: contactsHtml(ctx, '当てはまる症状がないとき', '次の相手に、困っていることをそのまま伝えてください。', '当てはまる症状がないとき') },
  ];
  const problems = bundle.flatMap(({ name, html }) => phoneShapeProblems(html).map((problem) => `${name}: ${problem}`));
  if (problems.length) throw new Error(`スマホ向けのファイルに問題があります:\n${problems.map((p) => `- ${p}`).join('\n')}`);
  return bundle;
}

/**
 * フォルダを作り直して書き出す。古い症状のファイルが残らないようにする。
 * 上限を超えたファイルは .blocked で保存して、blocked に理由を返す。
 */
export function writePhoneBundle(manual, dir) {
  const bundle = renderPhoneBundle(manual);
  mkdirSync(dir, { recursive: true });
  for (const name of readdirSync(dir)) if (/\.html(?:\.blocked)?$/.test(name)) rmSync(join(dir, name));
  const blocked = bundle.filter(({ name, html }) => writeWithinLimit(join(dir, name), html, PHONE_FILE_LIMIT)).map(({ name, html }) => oversizeMessage(join(dir, name), html, PHONE_FILE_LIMIT));
  return Object.assign(bundle, { blocked });
}

function main(args) {
  if (args.length !== 2) {
    console.error('使い方: node plugin/renderer/phone.mjs <入力.json> <出力フォルダ>');
    return 2;
  }
  try {
    const bundle = writePhoneBundle(JSON.parse(readFileSync(args[0], 'utf8')), resolve(args[1]));
    console.log(`スマホ向けのファイルを作りました：${resolve(args[1])}（${bundle.length} ファイル）`);
    if (bundle.blocked.length) {
      for (const message of bundle.blocked) console.error(message);
      return 1;
    }
  } catch (error) {
    console.error(`入力に問題があります: ${error.message}`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
