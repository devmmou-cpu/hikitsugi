// 表示プログラム完成版の合格テスト。夜間の作業ではこのファイルを変更しない。
// 入力の見本は test/fixtures/manual-full.json。
//
// 初版の約束（test/renderer.acceptance.test.mjs の冒頭）に加えて、次を守る。
// - タブは <section id="tab-…" class="panel"> で書き、中に section を入れない。手順ページは <article id="symptom-T1"> で書く
// - 手順の一覧は <ol class="steps">。番号は <span class="step-number">1</span> の要素で書き、ol の標準の番号を消す。
//   .steps の最初のルールに list-style: none と padding: 0 を書く
// - 毎月やることの定期作業は <article class="routine" data-frequency="weekly"> の形で書き、
//   頻度は「毎週」「毎月」「年に1回」の文字でも示す
// - 機器は <article class="device"> の形で書き、「置き場所」「役割」「止まると」の見出しを付ける
// - 色は :root の CSS 変数で定義する。--color-bg、--color-surface、--color-text、--color-muted、--color-accent は必須。
//   値は #rrggbb で書き、ダークモードでは @media (prefers-color-scheme: dark) の :root で定義し直す
// - 色の値は変数の定義の中にだけ書く。ほかの場所では var() で参照する

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareForRender } from '../plugin/lib/handover.mjs';
import { parseInfoRow } from '../plugin/lib/page-check.mjs';
import { validate } from '../plugin/lib/validate.mjs';
import { renderManual } from '../plugin/renderer/render.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = () => JSON.parse(readFileSync(join(ROOT, 'test/fixtures/manual-full.json'), 'utf8'));
const manual = fixture();
const html = renderManual(manual);
const textOf = (id) => manual.statements.find((s) => s.id === id).text;

const decode = (text) =>
  text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;|&apos;/g, "'").replace(/&amp;/g, '&');
const strip = (source) =>
  decode(source.replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ''));
const visibleText = strip(html);
const css = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');

/** id を持つ要素の開始位置から、次の同じ階層の区切りまでを切り出す。 */
function sectionOf(id, tag) {
  const start = html.search(new RegExp(`<${tag}\\b[^>]*\\bid="${id}"`));
  assert.ok(start >= 0, `${id} がありません`);
  const end = html.indexOf(`</${tag}>`, start);
  return html.slice(start, end);
}
const tags = (source, name) => source.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) ?? [];

/** 条件に合う @media の中身を取り出す。 */
function mediaBlock(pattern) {
  const out = [];
  let index = 0;
  for (;;) {
    const at = css.indexOf('@media', index);
    if (at < 0) return out.join('\n');
    const open = css.indexOf('{', at);
    let depth = 1;
    let i = open + 1;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth += 1;
      if (css[i] === '}') depth -= 1;
      i += 1;
    }
    if (pattern.test(css.slice(at, open))) out.push(css.slice(open + 1, i - 1));
    index = i;
  }
}

// ---- 見本そのもの ----
test('見本は5ページ以上で、全タブの内容を持つ', () => {
  assert.deepEqual(validate(JSON.parse(readFileSync(join(ROOT, 'plugin/schemas/manual.schema.json'), 'utf8')), manual), []);
  assert.ok(manual.symptom_pages.length >= 5);
  assert.ok(manual.contacts.length >= 3);
  assert.ok(manual.routines.length >= 3);
  assert.ok(manual.devices.length >= 3);
  assert.ok(manual.glossary.length >= 3);
});

// ---- 全タブの内容 ----
test('JavaScript なしで、すべての記述が読める', () => {
  // 会社の情報の表の文章は検証用で、画面には表の形で出す（値は下のテストで確かめる）
  const inTable = new Set(manual.symptom_pages.flatMap((p) => p.info_rows));
  for (const statement of manual.statements) {
    // 部品の補足は手順の下に分けて出す。文は1文ずつ確かめる
    if (inTable.has(statement.id)) continue;
    for (const sentence of statement.text.split('。').filter(Boolean)) assert.ok(visibleText.includes(sentence), statement.id);
  }
});

test('全タブに実際の内容があり、「まだ入っていません」の案内が出ない', () => {
  assert.ok(!visibleText.includes('まだこの説明書に入っていません'));
  for (const id of ['tab-help', 'tab-contacts', 'tab-routines', 'tab-company']) assert.ok(html.includes(`id="${id}"`), id);
});

test('連絡先：全社のカードに、電話のリンクと全項目がある', () => {
  const section = sectionOf('tab-contacts', 'section');
  for (const contact of manual.contacts) {
    assert.ok(strip(section).includes(contact.name), contact.name);
    if (contact.phone) assert.ok(section.includes(`href="tel:${contact.phone}"`) || section.includes(`href="tel:${contact.phone.replaceAll('-', '')}"`), contact.phone);
    for (const id of [contact.role, contact.hours, contact.contract_location, contact.what_to_tell].filter(Boolean)) assert.ok(strip(section).includes(textOf(id)), id);
  }
});

test('毎月やること：全作業が頻度つきで並び、手順も読める', () => {
  const section = sectionOf('tab-routines', 'section');
  const articles = tags(section, 'article').filter((tag) => /class="[^"]*\broutine\b/.test(tag));
  assert.equal(articles.length, manual.routines.length);
  const text = strip(section);
  for (const routine of manual.routines) {
    assert.ok(text.includes(textOf(routine.title)), routine.id);
    for (const step of routine.steps) assert.ok(text.includes(textOf(step)), step);
  }
  for (const [frequency, label] of [['weekly', '毎週'], ['monthly', '毎月'], ['yearly', '年に1回']]) {
    if (manual.routines.some((r) => r.frequency === frequency)) {
      assert.ok(section.includes(`data-frequency="${frequency}"`), frequency);
      assert.ok(text.includes(label), label);
    }
  }
});

test('毎月やること：毎週、毎月のあとに、年の作業が基準日から近い順に並ぶ', () => {
  const section = strip(sectionOf('tab-routines', 'section'));
  const position = (routine) => section.indexOf(textOf(routine.title));
  const asOfMonth = Number(manual.as_of.slice(5, 7));
  const distance = (month) => (month - asOfMonth + 12) % 12;
  const ordered = [...manual.routines].sort((a, b) => {
    const rank = { weekly: 0, monthly: 1, yearly: 2 };
    return rank[a.frequency] - rank[b.frequency] || (a.frequency === 'yearly' ? distance(a.month) - distance(b.month) : 0);
  });
  const positions = ordered.map(position);
  assert.ok(positions.every((p) => p >= 0));
  // 同じ頻度の中の順番は、年の作業だけを確かめる
  const years = ordered.filter((r) => r.frequency === 'yearly').map(position);
  assert.deepEqual(years, [...years].sort((a, b) => a - b));
  const firstYear = Math.min(...years);
  for (const routine of ordered.filter((r) => r.frequency !== 'yearly')) assert.ok(position(routine) < firstYear, routine.id);
});

test('会社のIT：全機器の名前、置き場所、役割、止まると困ることが読める', () => {
  const section = sectionOf('tab-company', 'section');
  const articles = tags(section, 'article').filter((tag) => /class="[^"]*\bdevice\b/.test(tag));
  assert.equal(articles.length, manual.devices.length);
  const text = strip(section);
  for (const device of manual.devices) {
    for (const id of [device.name, device.location, device.purpose, device.impact]) assert.ok(text.includes(textOf(id)), id);
  }
  for (const label of ['置き場所', '役割', '止まると']) assert.ok(text.includes(label), label);
});

test('会社のIT：用語集の全語が、押して開閉でき、説明が読める', () => {
  const section = sectionOf('tab-company', 'section');
  const text = strip(section);
  for (const entry of manual.glossary) {
    assert.ok(text.includes(entry.term), entry.term);
    assert.ok(text.includes(textOf(entry.explanation)), entry.explanation);
  }
  assert.ok(tags(section, 'details').length >= manual.glossary.length);
});

// ---- 手順ページ ----
test('全ページに症状の一覧からのリンクがあり、一覧に戻れる', () => {
  const help = sectionOf('tab-help', 'section');
  for (const page of manual.symptom_pages) {
    assert.ok(help.includes(`href="#symptom-${page.id}"`), page.id);
    const section = sectionOf(`symptom-${page.id}`, 'article');
    assert.ok(section.includes('href="#tab-help"'), page.id);
    assert.ok(strip(section).includes(textOf(page.title)), page.id);
  }
});

test('手順は全ページで、番号の要素と1つのチェックを持ち、番号はページごとに1から振る', () => {
  const seen = new Set();
  for (const page of manual.symptom_pages.filter((p) => p.steps.length)) {
    const section = sectionOf(`symptom-${page.id}`, 'article');
    const list = section.match(/<ol\b[^>]*class="[^"]*\bsteps\b[\s\S]*?<\/ol>/i)?.[0];
    assert.ok(list, `${page.id} の手順の一覧がありません`);
    const numbers = [...list.matchAll(/class="step-number"[^>]*>\s*(\d+)/g)].map((m) => Number(m[1]));
    assert.deepEqual(numbers, page.steps.map((_, i) => i + 1), page.id);
    const boxes = tags(list, 'input').filter((tag) => /type="checkbox"/.test(tag));
    assert.equal(boxes.length, page.steps.length, page.id);
    for (const box of boxes) {
      const key = box.match(/data-check="([^"]+)"/)?.[1];
      assert.ok(key && !seen.has(key), `チェックの保存先が重複しています: ${key}`);
      seen.add(key);
    }
    const text = strip(list);
    let position = -1;
    for (const id of page.steps) {
      const next = text.indexOf(textOf(id).split('。')[0]);
      assert.ok(next > position, `${page.id} の手順の順番が違います: ${id}`);
      position = next;
    }
  }
});

test('手順の一覧は標準の番号を消し、左の余白を足さない', () => {
  const rule = css.match(/\.steps\s*\{[^}]*\}/)?.[0] ?? '';
  assert.match(rule, /list-style(-type)?\s*:\s*none/);
  assert.match(rule, /padding(-left|-inline-start)?\s*:\s*0/);
});

test('部品を使った手順は、確認済みの標準手順と示す', () => {
  const page = manual.symptom_pages.find((p) => p.steps.some((id) => manual.statements.find((s) => s.id === id).library));
  assert.ok(page, '見本に部品を使ったページがありません');
  assert.ok(strip(sectionOf(`symptom-${page.id}`, 'article')).includes('確認済みの標準手順'));
});

// ---- 基準を全タブに広げる ----
test('外部への読み込みがない', () => {
  assert.ok(!/<link\b/i.test(html));
  assert.ok(!/<script\b[^>]*\bsrc=/i.test(html));
  assert.ok(!/<img\b[^>]*\bsrc="(?!data:)/i.test(html));
  assert.ok(!/@import|url\(\s*["']?(?!data:|#)/i.test(css));
  assert.ok(!/@font-face/i.test(css));
  assert.ok(!/https?:\/\//i.test(html));
});

test('ファイルの大きさは 400KB 以下', () => {
  assert.ok(Buffer.byteLength(html) <= 400 * 1024, `${Buffer.byteLength(html)} バイト`);
});

test('押す部品はすべて tap のクラスを持ち、高さ 44px 以上', () => {
  const required = [...tags(html, 'button'), ...tags(html, 'summary'), ...tags(html, 'a').filter((tag) => /href="(tel:|#)/.test(tag))];
  assert.ok(required.length > 0);
  for (const tag of required) assert.match(tag, /class="[^"]*\btap\b/, tag);
  const rule = css.match(/\.tap\s*\{[^}]*\}/)?.[0] ?? '';
  const height = Number(rule.match(/min-height\s*:\s*(\d+)px/)?.[1] ?? 0);
  assert.ok(height >= 44, `.tap の高さ ${height}px`);
});

test('印刷：タブとボタンを隠し、全画面の内容を印刷する', () => {
  const print = mediaBlock(/print/);
  assert.ok(print, '印刷用の指定がありません');
  assert.match(print, /\.tabs[^{]*\{[^}]*display\s*:\s*none/);
  assert.match(print, /button|\.js-only/);
  assert.match(print, /\.panel[^{]*\{[^}]*display\s*:\s*block/);
});

// ---- 色 ----
const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const luminance = (hex) => {
  const [r, g, b] = hexToRgb(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const hsl = (hex) => {
  const [r, g, b] = hexToRgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
};
const palette = (source) => {
  const root = source.match(/:root\s*\{([^}]*)\}/)?.[1] ?? '';
  return Object.fromEntries([...root.matchAll(/(--color-[a-z-]+)\s*:\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
};
const REQUIRED = ['--color-bg', '--color-surface', '--color-text', '--color-muted', '--color-accent'];
const light = palette(css);
const dark = palette(mediaBlock(/prefers-color-scheme:\s*dark/));

test('色は CSS 変数で定義し、ライトとダークの両方にそろっている', () => {
  for (const name of REQUIRED) {
    assert.match(light[name] ?? '', /^#/, `ライトの ${name}`);
    assert.match(dark[name] ?? '', /^#/, `ダークの ${name}`);
  }
  const withoutDefinitions = css.replace(/--[a-z0-9-]+\s*:[^;}]*[;}]/gi, '');
  assert.deepEqual(withoutDefinitions.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g) ?? [], [], '色の値が変数の定義の外にあります');
});

test('ライト：雪のような白と墨色を基調に、暖色を差し色にする', () => {
  const bg = hsl(light['--color-bg']);
  assert.ok(bg.l >= 0.95, `背景の明るさ ${bg.l}`);
  assert.ok(bg.s <= 0.35 || bg.l >= 0.97, `背景の彩度 ${bg.s}`);
  const text = hsl(light['--color-text']);
  assert.ok(text.l <= 0.25, `文字の明るさ ${text.l}`);
  assert.ok(text.s <= 0.2, `文字の彩度 ${text.s}`);
  const accent = hsl(light['--color-accent']);
  assert.ok(accent.h >= 15 && accent.h <= 50, `差し色の色相 ${accent.h}`);
  assert.ok(accent.s >= 0.25, `差し色の彩度 ${accent.s}`);
});

test('ダーク：墨色を基調に、暖色の差し色を保つ', () => {
  const bg = hsl(dark['--color-bg']);
  assert.ok(bg.l <= 0.2, `背景の明るさ ${bg.l}`);
  const accent = hsl(dark['--color-accent']);
  assert.ok(accent.h >= 15 && accent.h <= 50, `差し色の色相 ${accent.h}`);
});

test('文字のコントラストは 4.5 以上（本文は 7 以上）', () => {
  for (const [name, colors] of [['ライト', light], ['ダーク', dark]]) {
    for (const surface of ['--color-bg', '--color-surface']) {
      assert.ok(contrast(colors['--color-text'], colors[surface]) >= 7, `${name} 本文と ${surface}`);
      assert.ok(contrast(colors['--color-muted'], colors[surface]) >= 4.5, `${name} 補足と ${surface}`);
      assert.ok(contrast(colors['--color-accent'], colors[surface]) >= 4.5, `${name} 差し色と ${surface}`);
    }
  }
});

// ---- 受け渡し ----
test('定期作業と機器を外さずに、表示プログラムへ渡せる', () => {
  const { manual: prepared } = prepareForRender(manual);
  assert.equal(prepared.routines.length, manual.routines.length);
  assert.equal(prepared.devices.length, manual.devices.length);
  assert.equal(prepared.statements.length, manual.statements.length);
});

// ---- 実際の画面 ----
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

test('実際の画面（幅 375px）で、全画面の検査に合格し、スクリーンショットが撮れる', { skip: existsSync(CHROME) ? false : 'Chrome がありません' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'hikitsugi-shots-'));
  try {
    const input = join(dir, 'manual.html');
    writeFileSync(input, html);
    const output = join(dir, 'shots');
    const result = spawnSync(process.execPath, [join(ROOT, 'scripts/screenshots.mjs'), input, output], { encoding: 'utf8', timeout: 600000 });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const files = readdirSync(output);
    const screens = ['tab-help', 'tab-contacts', 'tab-routines', 'tab-company', ...manual.symptom_pages.map((p) => `symptom-${p.id}`)];
    for (const theme of ['light', 'dark']) {
      for (const screen of screens) assert.ok(files.includes(`${theme}-${screen}.png`), `${theme}-${screen}`);
    }
    assert.ok(files.includes('nojs-all.png') && files.includes('print.pdf'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('説明欄の文には、番号もチェック欄も付けず、手順より前に出す', () => {
  const page = manual.symptom_pages.find((p) => p.notes.length && p.steps.length);
  const section = sectionOf(`symptom-${page.id}`, 'article');
  const list = section.match(/<ol\b[\s\S]*?<\/ol>/i)[0];
  for (const id of page.notes) {
    const text = textOf(id);
    assert.ok(strip(section).includes(text), id);
    assert.ok(!strip(list).includes(text), id);
    assert.ok(strip(section).indexOf(text) < strip(section).indexOf(strip(list)), id);
  }
  assert.equal(tags(list, 'input').length, page.steps.length);
});

test('この症状で使う会社の情報：見出しと値を出し、\\\\ を保ち、手順に値を書かない', () => {
  const page = manual.symptom_pages.find((p) => p.info_rows.some((id) => parseInfoRow(textOf(id)).type === 'drive'));
  const section = sectionOf(`symptom-${page.id}`, 'article');
  const text = strip(section);
  assert.ok(text.includes('この症状で使う会社の情報'));
  const list = section.match(/<ol\b[\s\S]*?<\/ol>/i)[0];
  for (const row of page.info_rows.map((id) => parseInfoRow(textOf(id))).filter((r) => r.type === 'drive')) {
    assert.ok(/^\\\\/.test(row.path));
    assert.ok(text.includes(row.path), row.path);
    assert.ok(!strip(list).includes(row.path), row.path);
    if (row.target) assert.ok(text.includes(row.target), row.target);
  }
});

test('手順ページは ① まずこれだけ、② それでも直らなければ、③ それでもだめなら の順に並ぶ', () => {
  const page = manual.symptom_pages.find((p) => p.first_steps.length && p.steps.length && p.fallback);
  const text = strip(sectionOf(`symptom-${page.id}`, 'article'));
  const order = ['① まずこれだけ', textOf(page.first_steps[0]), '② それでも直らなければ', textOf(page.steps[0]).split('。')[0], '③ それでもだめなら'];
  let position = -1;
  for (const expected of order) {
    const next = text.indexOf(expected);
    assert.ok(next > position, expected);
    position = next;
  }
});

test('ゴール、分岐、例外は手順の一覧の外に置き、チェック欄を付けない', () => {
  const pages = manual.symptom_pages.filter((p) => p.steps.length && (p.goal || p.branches.length || p.exceptions.length));
  assert.ok(pages.length > 0);
  for (const page of pages) {
    const section = sectionOf(`symptom-${page.id}`, 'article');
    const list = strip(section.match(/<ol\b[\s\S]*?<\/ol>/i)[0]);
    for (const id of [...page.branches, ...page.exceptions, ...(page.goal ? [page.goal] : [])]) {
      assert.ok(strip(section).includes(textOf(id)), id);
      assert.ok(!list.includes(textOf(id)), id);
    }
  }
});

test('まずこれだけのカードにはチェック欄がない', () => {
  const page = manual.symptom_pages.find((p) => p.first_steps.length);
  const section = sectionOf(`symptom-${page.id}`, 'article');
  const first = section.match(/<section class="first">[\s\S]*?<\/section>/)[0];
  assert.equal(tags(first, 'input').length, 0);
  for (const id of page.first_steps) assert.ok(strip(first).includes(textOf(id)), id);
});

test('部品の補足は手順の文から分けて出し、チェックの対象にしない', () => {
  const page = manual.symptom_pages.find((p) => p.steps.some((id) => textOf(id).split('。').filter(Boolean).length > 1));
  const id = page.steps.find((candidate) => textOf(candidate).split('。').filter(Boolean).length > 1);
  const [body, note] = textOf(id).split('。').filter(Boolean);
  const section = sectionOf(`symptom-${page.id}`, 'article');
  const labels = [...section.matchAll(/<label\b[\s\S]*?<\/label>/g)].map((m) => strip(m[0]));
  assert.ok(labels.some((label) => label.includes(body)));
  assert.ok(!labels.some((label) => label.includes(note)));
  assert.match(section, /class="step-note"/);
});

test('一覧の末尾に「当てはまる症状がないとき」を置き、社内で相談として連絡先へ案内する', () => {
  const section = sectionOf('tab-help', 'section');
  const links = [...section.matchAll(/<a\b[\s\S]*?<\/a>/g)].map((m) => m[0]);
  const last = links.at(-1);
  assert.ok(strip(last).includes('当てはまる症状がないとき'));
  assert.match(last, /data-badge="internal"/);
  assert.match(last, /href="#tab-contacts"/);
});

test('連絡先：社内の相談先を先頭に並べ、役割のラベルを名前と一緒に出す', () => {
  const section = sectionOf('tab-contacts', 'section');
  const text = strip(section);
  const inside = manual.contacts.filter((c) => c.id.startsWith('INH-'));
  const vendors = manual.contacts.filter((c) => c.id.startsWith('VEN-'));
  assert.ok(inside.length > 0);
  for (const a of inside) for (const b of vendors) assert.ok(text.indexOf(a.name) < text.indexOf(b.name), a.name);
  assert.ok(!text.includes('どんな会社か'));
  for (const contact of manual.contacts) {
    const name = section.match(new RegExp(`<h3 class="contact-name">${contact.name}<span class="contact-role">([^<]*)`));
    assert.equal(name?.[1], textOf(contact.role), contact.name);
  }
});

test('社内の相談先には、番号の記録がなければ電話のボタンを出さない', () => {
  const m = fixture();
  const inside = m.contacts.find((c) => c.id.startsWith('INH-'));
  inside.phone = '';
  const output = renderManual(m);
  const contacts = output.slice(output.indexOf('id="tab-contacts"'));
  assert.ok(!/href="tel:"/.test(contacts));
});

test('確認の前は下書きの帯を出し、確認の印を出さない', () => {
  const m = fixture();
  delete m.review;
  const draft = renderManual(m);
  assert.ok(strip(draft).includes('下書き（前任者の確認前）'));
  assert.ok(!strip(draft).includes('全ページを確認したものです'));
  assert.ok(!/class="seal"/.test(draft));
  assert.ok(!strip(draft).includes('確認済みです'));
});

test('全ページの確認が済むと、確認した人と日付の印と、はじめにの文を出す', () => {
  assert.ok(manual.review);
  const text = strip(html);
  assert.ok(!text.includes('下書き（前任者の確認前）'));
  assert.ok(text.includes(`${manual.review.reviewer} 確認`));
  assert.ok(text.includes(`この取扱説明書は、AIがもとの情報と照らし合わせ、前任の${manual.review.reviewer}さんが全ページを確認したものです。`));
});

test('社内で相談のページ：バッジを文字で出し、業者へ連絡とは書かない', () => {
  const page = manual.symptom_pages.find((p) => p.badge.value === 'internal');
  const section = sectionOf(`symptom-${page.id}`, 'article');
  assert.match(section, /data-badge="internal"/);
  assert.ok(strip(section).includes('社内で相談'));
  assert.ok(!strip(section).includes('業者へ連絡'));
  assert.ok(!strip(section).includes('業者に送る文面'));
});

test('実装は外部ライブラリを使わない', () => {
  for (const file of readdirSync(join(ROOT, 'plugin/renderer'))) {
    const source = readFileSync(join(ROOT, 'plugin/renderer', file), 'utf8');
    for (const [, specifier] of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      assert.ok(specifier.startsWith('.') || specifier.startsWith('node:'), `${file}: ${specifier}`);
    }
  }
});
