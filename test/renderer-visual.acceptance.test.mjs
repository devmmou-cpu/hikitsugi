// 画面の作り直しの合格テスト。作業の中ではこのファイルを変更しない。
// 正は docs/design/visual-spec.md。値は実際の画面で scripts/screenshots.mjs が測り、一覧は scripts/visual-spec-checks.mjs にある。
//
// 仕様の第7章の名前に加えて、次の名前を守る。
// - 全体：<html class="no-js">。先頭の script で js に替える。JavaScript なしでは全文が読める
// - はじめに：<section id="intro" class="panel">、題名は .intro-title、主ボタンは a.btn-primary[href="#tab-help"]、凡例は .legend
// - 上部：<header class="topbar">、社外秘は .chip-secret、PC のナビは nav.topnav（4項目）、下部タブは nav.tabs（4項目）
// - 困ったとき：<section id="tab-help" class="panel">。グループ見出しは .group-title、ジャンプ行は nav.jump、症状は a.sym（中に .sym-title、.badge）
// - 手順ページ：<article id="symptom-T1" class="panel">。題名は .symptom-title、①②③の見出しは .part-title、右の列は aside.rail
// - 列：一覧は .col-list、本文は .col-main
// - 帯：.band と .band-safe（安心）、.band-branch（分岐）、.band-exception（例外）
// - 手順：<ol class="steps"> の <li class="step">。番号 .step-n、本文 .step-body、チェック枠 .step-box、補足 .step-note
// - 連絡先：.contact-box、.contact-name、.contact-role、電話は a.btn-call（中に .btn-label、.num）、コピーは button.btn-copy、接続先は code.path
// - 用語：details.term。手順の下のリンクは .step-terms a[href^="#g-"]、説明は details.term[id^="g-"]
// - 確認の印：svg.seal（確認が済んだときだけ）、下書きの帯：.draft-band（確認の前だけ）
// - フッター：<footer class="site-footer">、オコジョのシルエットは svg.okojo

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderManual } from '../plugin/renderer/render.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = () => JSON.parse(readFileSync(join(ROOT, 'test/fixtures/manual-full.json'), 'utf8'));
const manual = fixture();
const html = renderManual(manual);
const draftHtml = (() => {
  const m = fixture();
  delete m.review;
  return renderManual(m);
})();
const css = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
const strip = (source) => source.replace(/<style\b[\s\S]*?<\/style>/gi, '').replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const textOf = (id) => manual.statements.find((s) => s.id === id).text;

/** 選択子の入れ物の中身を返す。@media の中も含めて探す。 */
function blockAfter(source, selectorPattern) {
  const match = source.match(selectorPattern);
  if (!match) return null;
  const open = source.indexOf('{', match.index);
  let depth = 1;
  let i = open + 1;
  while (i < source.length && depth > 0) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') depth -= 1;
    i += 1;
  }
  return source.slice(open + 1, i - 1);
}
const declarations = (block) => Object.fromEntries([...(block ?? '').matchAll(/(--[a-z0-9-]+)\s*:\s*([^;}]+)/gi)].map((m) => [m[1], m[2].trim().toLowerCase()]));

// ---- 配色（6-1） ----
const LIGHT = {
  '--bg': '#f7f6f1', '--card': '#ffffff', '--card-2': '#f1efe9', '--line': '#dcd9d1', '--line-strong': '#8e8a82',
  '--ink': '#1e2124', '--ink-2': '#5b6066', '--ink-3': '#6b7076',
  '--accent': '#8a4e22', '--accent-ink': '#ffffff', '--accent-soft': '#fbf1e6', '--accent-strong': '#6e3b16',
  '--ok-fg': '#1e6b3f', '--ok-bg': '#e4f1e7', '--warn-fg': '#7a4f00', '--warn-bg': '#fbefd0',
  '--call-fg': '#ffffff', '--call-bg': '#1e2124', '--ask-fg': '#2d5a8a', '--ask-bg': '#e1ebf6',
  '--danger-fg': '#b00020', '--danger-bg': '#fbe9ec',
};
const DARK = {
  '--bg': '#151718', '--card': '#1f2224', '--card-2': '#26292c', '--line': '#363a3e', '--line-strong': '#6f746b',
  '--ink': '#eceae3', '--ink-2': '#b3afa6', '--ink-3': '#9a9690',
  '--accent': '#e2a66f', '--accent-ink': '#151718', '--accent-soft': '#2b2520', '--accent-strong': '#f0be8e',
  '--ok-fg': '#8fd3a5', '--ok-bg': '#1c3426', '--warn-fg': '#f2c46b', '--warn-bg': '#3a2e12',
  '--call-fg': '#151718', '--call-bg': '#eceae3', '--ask-fg': '#9cc3ec', '--ask-bg': '#1c2e42',
  '--danger-fg': '#ff8a80', '--danger-bg': '#3a1f1f',
};
const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const luminance = (hex) => {
  const [r, g, b] = hexToRgb(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('ライトの配色は仕様の値どおり', () => {
  const root = declarations(blockAfter(css, /:root\s*\{/));
  for (const [name, value] of Object.entries(LIGHT)) assert.equal(root[name], value, name);
});

test('ダークの配色は仕様の値どおりで、OS の設定と data-theme の両方で効く', () => {
  const media = blockAfter(css, /@media[^{]*prefers-color-scheme\s*:\s*dark[^{]*/);
  assert.ok(media, 'ダークモードの @media がありません');
  const auto = declarations(blockAfter(media, /:root:not\(\[data-theme="?light"?\]\)\s*\{/));
  const forced = declarations(blockAfter(css, /:root\[data-theme="?dark"?\]\s*\{/));
  for (const [name, value] of Object.entries(DARK)) {
    assert.equal(auto[name], value, `OS の設定 ${name}`);
    assert.equal(forced[name], value, `data-theme ${name}`);
  }
});

test('仕様の組み合わせのコントラスト比は 4.5 以上。操作部品の枠は 3 以上', () => {
  const pairs = [['--ink', '--card'], ['--ink', '--bg'], ['--ink-2', '--card'], ['--ink-3', '--card'], ['--accent', '--card'], ['--accent-ink', '--accent'], ['--ok-fg', '--ok-bg'], ['--warn-fg', '--warn-bg'], ['--call-fg', '--call-bg'], ['--ask-fg', '--ask-bg'], ['--danger-fg', '--card'], ['--danger-fg', '--danger-bg']];
  for (const colors of [LIGHT, DARK]) {
    for (const [fg, bg] of pairs) assert.ok(contrast(colors[fg], colors[bg]) >= 4.5, `${fg} / ${bg}`);
    assert.ok(contrast(colors['--line-strong'], colors['--card']) >= 3);
  }
});

test('色の値は変数の定義の中にだけ書く', () => {
  const withoutDefinitions = css.replace(/--[a-z0-9-]+\s*:[^;}]*[;}]/gi, '');
  assert.deepEqual(withoutDefinitions.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g) ?? [], []);
});

test('差し色は番号に使わない', () => {
  const rule = blockAfter(css, /\.step-n\s*\{/) ?? '';
  assert.ok(rule, '.step-n の指定がありません');
  assert.doesNotMatch(rule, /--accent/);
});

test('余白の単位を変数で定義する', () => {
  const root = declarations(blockAfter(css, /:root\s*\{/));
  const expected = { '--s1': '4px', '--s2': '8px', '--s3': '12px', '--s4': '16px', '--s5': '24px', '--s6': '32px', '--s7': '48px' };
  for (const [name, value] of Object.entries(expected)) assert.equal(root[name], value, name);
});

test('文字の大きさは 14px 以上。13px はタブのラベルと社外秘のチップだけ', () => {
  const noPrint = css.replace(/@media[^{]*print[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  for (const match of noPrint.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const size = match[2].match(/font-size\s*:\s*([\d.]+)px/)?.[1];
    if (!size) continue;
    const value = Number(size);
    if (value < 14) {
      assert.ok(value === 13 && /\.chip-secret|\.tabs/.test(match[1]), `${match[1].trim()} の ${value}px`);
    }
  }
});

test('文字の設定：本文 17px、行間 1.7、実在のフォント名を書かない', () => {
  const rule = blockAfter(css, /(^|\})\s*html\s*\{/m) ?? '';
  assert.match(rule, /font-size\s*:\s*17px/);
  assert.match(rule, /line-height\s*:\s*1\.7/);
  assert.match(rule, /font-family\s*:\s*system-ui,\s*sans-serif\s*;/);
  assert.match(css, /--mono\s*:\s*ui-monospace,\s*monospace\s*;/);
  // design.md の 11/2 の決定：指定できるのは総称の名前だけ
  for (const [, value] of css.matchAll(/font-family\s*:\s*([^;}]+)/g)) assert.match(value.trim(), /^(?:system-ui, sans-serif|ui-monospace, monospace|inherit|var\(--mono\))$/, value);
  assert.match(css, /tabular-nums/);
});

test('動きを減らす設定を尊重する', () => {
  assert.match(css, /scroll-behavior\s*:\s*smooth/);
  assert.match(css, /prefers-reduced-motion\s*:\s*reduce/);
});

// ---- 列（第4章） ----
test('幅の切り替えは 768px と 1200px', () => {
  assert.match(css, /@media[^{]*min-width\s*:\s*768px/);
  assert.match(css, /@media[^{]*min-width\s*:\s*1200px/);
  const pc = blockAfter(css, /@media[^{]*min-width\s*:\s*768px[^{]*/) ?? '';
  assert.match(pc, /\.tabs[^{]*\{[^}]*display\s*:\s*none/, '768px 以上では下部タブを出しません');
});

test('全ページに右の列があり、会社の情報と連絡先を持つ。本文にも残す', () => {
  for (const page of manual.symptom_pages) {
    const start = html.search(new RegExp(`<article\\b[^>]*\\bid="symptom-${page.id}"`));
    const article = html.slice(start, html.indexOf('</article>', start));
    if (!page.info_rows.length && !page.fallback) continue;
    const rail = article.match(/<aside\b[^>]*class="[^"]*\brail\b[\s\S]*?<\/aside>/)?.[0];
    assert.ok(rail, `${page.id} に右の列がありません`);
    if (page.info_rows.length) {
      assert.ok(strip(rail).includes('この症状で使う会社の情報'), page.id);
      assert.ok(strip(article.replace(rail, '')).includes('この症状で使う会社の情報'), `${page.id} の本文`);
    }
    if (page.fallback) {
      const contact = manual.contacts.find((c) => c.id === page.fallback.contact);
      assert.ok(strip(rail).includes(contact.name), page.id);
      assert.ok(strip(article.replace(rail, '')).includes(contact.name), `${page.id} の本文`);
    }
  }
});

test('右の列は 1200px 未満と印刷では出さない', () => {
  const base = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  assert.match(base, /\.rail[^{]*\{[^}]*display\s*:\s*none/);
  const print = blockAfter(css, /@media[^{]*\bprint\b[^{]*/) ?? '';
  assert.match(print, /\.rail/);
});

test('HTML の id に重複がない', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  const repeated = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual([...new Set(repeated)], []);
});

// ---- 手順ページ（第5章） ----
test('手順の見出しと順番：① まずこれだけ、② それでも直らなければ、③ それでもだめなら、会社の情報、確認の文', () => {
  const page = manual.symptom_pages.find((p) => p.first_steps.length && p.steps.length && p.fallback && p.info_rows.length);
  const start = html.search(new RegExp(`<article\\b[^>]*\\bid="symptom-${page.id}"`));
  const article = html.slice(start, html.indexOf('</article>', start));
  const rail = article.match(/<aside\b[^>]*class="[^"]*\brail\b[\s\S]*?<\/aside>/)?.[0] ?? '';
  const text = strip(article.replace(rail, ''));
  let position = -1;
  for (const expected of ['まずこれだけ', 'それでも直らなければ', 'それでもだめなら', 'この症状で使う会社の情報']) {
    const next = text.indexOf(expected);
    assert.ok(next > position, expected);
    position = next;
  }
});

test('まずこれだけは唯一の暖色の枠と影で、kbd でキーを示す', () => {
  const rule = blockAfter(css, /\.first\s*\{/) ?? '';
  assert.match(rule, /border\s*:\s*2px\s+solid\s+var\(--accent\)/);
  assert.match(rule, /box-shadow\s*:\s*var\(--shadow-hero\)/);
  const hero = css.match(/box-shadow\s*:\s*var\(--shadow-hero\)/g) ?? [];
  assert.equal(hero.length, 1, '影はこの1枚だけ');
  assert.match(html, /<section class="first[^"]*">[\s\S]*?<kbd>[^<]+<\/kbd>/);
});

test('文字の中身は手順の部品のまま。kbd で囲んでも文は変わらない', () => {
  const page = manual.symptom_pages.find((p) => p.first_steps.length);
  const start = html.search(new RegExp(`<article\\b[^>]*\\bid="symptom-${page.id}"`));
  const article = strip(html.slice(start, html.indexOf('</article>', start)));
  for (const id of page.first_steps) assert.ok(article.includes(textOf(id)), id);
});

test('チェックは本物の input で、JavaScript なしでも済んだ手順を薄くする。打ち消し線を使わない', () => {
  assert.match(css, /\.step:has\([^)]*:checked\)/);
  assert.doesNotMatch(css, /line-through/);
  assert.match(css, /input:focus-visible/);
});

test('「いまここ」は JavaScript があるときだけで、暖色の左の線を使う', () => {
  assert.match(css, /\.is-current/);
  assert.match(css, /\.is-current[^{]*\{[^}]*box-shadow\s*:\s*inset\s+4px\s+0\s+0\s+var\(--accent\)/);
  assert.ok(!strip(html).includes('いまここ'), 'HTML に固定で書かず、JavaScript が付けます');
  const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join('\n');
  assert.ok(script.includes('いまここ'));
  assert.ok(script.includes('is-current'));
});

test('進捗：JavaScript なしでは固定の文で、ありでは数える', () => {
  const page = manual.symptom_pages.find((p) => p.steps.length);
  assert.ok(strip(html).includes(`手順は ${page.steps.length} つです`));
  assert.match(html, /class="count-static"/);
  assert.match(html, /class="count-live"/);
});

test('用語：手順からはリンクで飛び、説明はページ末尾の details にある。「とは？」の前に空白を入れない', () => {
  assert.match(html, /class="step-terms"[\s\S]*?href="#g-[^"]+"/);
  assert.match(html, /<details class="term[^"]*" id="g-/);
  assert.doesNotMatch(strip(html), /[^\s] とは？/);
  assert.match(css, /details\.term:target/);
});

test('伝える文面はひとまとまりで選べる', () => {
  assert.match(css, /\.say[^{]*\{[^}]*user-select\s*:\s*all/);
  assert.match(css, /-webkit-user-select\s*:\s*all/);
  assert.match(html, /<blockquote class="say"/);
});

// ---- 一覧（3-3） ----
test('一覧にジャンプ行があり、判定と目安を出す', () => {
  const jump = html.match(/<nav\b[^>]*class="[^"]*\bjump\b[\s\S]*?<\/nav>/)?.[0];
  assert.ok(jump, 'ジャンプ行がありません');
  assert.ok([...jump.matchAll(/href="#([^"]+)"/g)].length >= 2);
  for (const [, id] of jump.matchAll(/href="#([^"]+)"/g)) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(html, /<a\b[^>]*class="[^"]*\bsym\b[\s\S]*?class="sym-title"[\s\S]*?class="badge[\s\S]*?class="eta"/);
});

test('4種のバッジは形が同じで、アイコンを持つ', () => {
  for (const value of ['self', 'check_first', 'vendor', 'internal']) {
    const badge = html.match(new RegExp(`<span class="badge[^"]*"[^>]*data-badge="${value}"[^>]*>[\\s\\S]*?</span>`))?.[0];
    assert.ok(badge, value);
    assert.match(badge, /<svg/, value);
  }
  const rule = blockAfter(css, /\.badge\s*\{/) ?? '';
  assert.match(rule, /border-radius\s*:\s*999px/);
  assert.match(rule, /height\s*:\s*32px/);
});

// ---- はじめに（第8章） ----
test('はじめに：文書の最後にあり、確認の文と凡例と主ボタンを持つ', () => {
  const start = html.search(/<section\b[^>]*\bid="intro"/);
  assert.ok(start >= 0, 'はじめにの画面がありません');
  for (const id of ['tab-help', 'tab-contacts', 'tab-routines', 'tab-company']) assert.ok(start > html.search(new RegExp(`<section\\b[^>]*\\bid="${id}"`)), id);
  const intro = html.slice(start, html.indexOf('</section>', start));
  const text = strip(intro);
  assert.ok(text.includes(manual.company_name));
  assert.ok(text.includes('ITの取扱説明書'));
  assert.ok(text.includes('2026年11月5日時点の内容です。'));
  assert.ok(text.includes(`この取扱説明書は、AIがもとの情報と照らし合わせ、前任の${manual.review.reviewer}さんが全ページを確認したものです。`));
  assert.ok(!text.includes('手順は人が確認したものだけ'), '事実と合わないので使いません');
  assert.match(intro, /<a\b[^>]*class="[^"]*\bbtn-primary\b[^>]*href="#tab-help"|<a\b[^>]*href="#tab-help"[^>]*class="[^"]*\bbtn-primary\b/);
  for (const label of ['自分で直せる', '確認してから', '業者へ連絡', '社内で相談']) assert.ok(text.includes(label), label);
});

test('開いたとき：困ったときの一覧が文書の最初の画面で、はじめには下からリンクで開ける', () => {
  const main = html.slice(html.indexOf('<main>'));
  assert.match(main.slice(0, 200), /<main>\s*<div class="workspace">\s*<section\b[^>]*\bid="tab-help"/);
  assert.match(html, /<span class="js-only about-link"><a\b[^>]*href="#intro"/);
});

test(':target は強調にだけ使い、JavaScript なしでは何も隠さない', () => {
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  const rules = [...css.matchAll(/([^{}]*:target[^{}]*)\{([^}]*)\}/g)];
  assert.ok(rules.length >= 2);
  for (const [, selector, body] of rules) assert.doesNotMatch(body, /display|visibility|opacity|height|clip|position/, selector);
  assert.match(css, /\.no-js \.symptom:target \.symptom-title\s*\{\s*color:\s*var\(--accent\)/);
  assert.match(css, /\.no-js \.symptom:target\s*\{\s*box-shadow:\s*inset 4px/);
  // 隠す指定は .js で始める
  assert.doesNotMatch(css, /\.no-js[^{}]*\{[^}]*display:\s*none/);
});

test('確認の印：確認が済むと、確認した人と日付を SVG の角印で出す', () => {
  // 図形の定義は先頭の symbol にまとめ、文字はこの中に持つ。はじめにが印の本体を出す
  const intro = html.slice(html.search(/<section\b[^>]*\bid="intro"/));
  const seal = intro.match(/<svg\b[^>]*class="[^"]*\bseal\b[\s\S]*?<\/svg>/)?.[0];
  assert.ok(seal, '角印がありません');
  const words = [...seal.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join(' ');
  assert.ok(words.includes(manual.review.reviewer), words);
  assert.ok(words.includes('確認'), words);
  assert.match(words, /11\.05|11\.5|11月5日/);
  assert.match(seal, /role="img"/);
  assert.match(seal, /aria-label="[^"]*確認/);
});

test('確認の前：下書きの帯を上部に出し、角印と確認の文を出さない', () => {
  assert.match(draftHtml, /class="draft-band"[^>]*>[^<]*下書き（前任者の確認前）/);
  assert.ok(draftHtml.search(/class="draft-band"/) < draftHtml.search(/<section\b[^>]*\bid="intro"/));
  assert.doesNotMatch(draftHtml, /class="[^"]*\bseal\b/);
  assert.ok(!strip(draftHtml).includes('全ページを確認したものです'));
  assert.ok(!strip(html).includes('下書き（前任者の確認前）'));
});

test('フッター：作品の名前と、新しく描いたオコジョのシルエットを 16px で出す', () => {
  const footer = html.match(/<footer\b[^>]*class="[^"]*\bsite-footer\b[\s\S]*?<\/footer>/)?.[0];
  assert.ok(footer, 'フッターがありません');
  assert.ok(strip(footer).includes('このファイルは Okojyo-Soft のヒキツギで作られました。'));
  const okojo = footer.match(/<svg\b[^>]*class="[^"]*\bokojo\b[\s\S]*?<\/svg>/)?.[0];
  assert.ok(okojo, 'オコジョの SVG がありません');
  assert.match(okojo, /<path\b/);
  assert.match(okojo, /width="16"/);
  assert.match(okojo, /height="16"/);
  assert.doesNotMatch(okojo, /<image\b|href=|data:/, '画像や外部の素材を使いません');
  // 黒い尾先と白い体の2色
  assert.ok((okojo.match(/<path\b/g) ?? []).length >= 2, '体と尾先を分けて描きます');
});

test('テーマの切り替えは JavaScript があるときだけ出し、保存できなくても動く', () => {
  assert.match(html, /<html\b[^>]*class="no-js"/);
  const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join('\n');
  assert.ok(script.includes("classList.replace('no-js', 'js')") || script.includes("classList.replace('no-js','js')"));
  assert.ok(script.includes('data-theme'));
  assert.match(script, /try\s*\{[\s\S]*?localStorage/);
  assert.match(strip(html), /表示：/);
});

// ---- 印刷（第9章） ----
test('印刷：ナビとボタンを隠し、details を開き、手順ページごとに改ページし、背景色に頼らない', () => {
  const print = blockAfter(css, /@media[^{]*\bprint\b[^{]*/) ?? '';
  assert.match(print, /\.tabs/);
  assert.match(print, /\.topnav/);
  assert.match(print, /\.btn-copy|button/);
  assert.match(print, /break-before\s*:\s*page/);
  assert.match(print, /details/);
  assert.match(print, /\.badge[^{]*\{[^}]*border/);
});

// ---- 実際の画面 ----
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

test('用語とカタカナの語は語の途中で折り返さず、値は区切りでだけ折り返す。文字は変えない', () => {
  assert.match(html, /<span class="nb">ドライブ文字<\/span>/);
  assert.match(html, /<span class="nb">ネットワーク ドライブ<\/span>/);
  assert.match(css, /\.nb\s*\{[^}]*white-space\s*:\s*nowrap/);
  for (const term of manual.glossary.filter((g) => g.term.length <= 16)) {
    const uses = manual.statements.find((s) => s.text.includes(term.term) && !s.library);
    if (uses) assert.ok(html.includes(`<span class="nb">${term.term.replace(/&/g, '&amp;')}</span>`) || html.includes(`>${term.term}`), term.term);
  }
  // 接続先の中の区切りのあとに wbr があり、文字は同じ
  assert.match(html, /<code class="path">\\\\OKOJO-<wbr>NAS\\<wbr>/);
  assert.ok(strip(html).includes('\\\\OKOJO-NAS\\'));
  // キーの印は残る
  assert.match(html, /<kbd>Windows<\/kbd>/);
});

// 表に長い値があっても、スマホの幅からはみ出さないことも、実際の画面で確かめる
function withLongValues() {
  const m = fixture();
  const page = m.symptom_pages.find((p) => p.info_rows.length);
  const texts = [
    `Q ドライブは \\\\OKOJO-NAS\\${'とても長いフォルダの名前'.repeat(5)} です。`,
    `${'とても長い項目の名前'.repeat(4)}は ${'LONG-VALUE-'.repeat(8)} です。`,
    `区切りのない値は ${'A'.repeat(90)} です。`,
  ];
  for (const [index, text] of texts.entries()) {
    const id = `STM-${900 + index}`;
    m.statements.push({ id, text, evidence: ['INT-001'] });
    page.info_rows.push(id);
  }
  return renderManual(m);
}

test('実際の画面（375px、1024px、1440px）で、全画面の検査と仕様の値に合格し、撮影できる', { skip: existsSync(CHROME) ? false : 'Chrome がありません' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'hikitsugi-visual-'));
  try {
    const input = join(dir, 'manual.html');
    writeFileSync(input, withLongValues());
    const output = join(dir, 'shots');
    const result = spawnSync(process.execPath, [join(ROOT, 'scripts/screenshots.mjs'), input, output], { encoding: 'utf8', timeout: 1200000 });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    for (const viewport of ['phone', 'tablet', 'pc']) {
      const files = readdirSync(join(output, viewport));
      for (const theme of ['light', 'dark']) {
        for (const screen of ['intro', 'tab-help', 'tab-contacts', 'tab-routines', 'tab-company', ...manual.symptom_pages.map((p) => `symptom-${p.id}`)]) {
          assert.ok(files.includes(`${theme}-${screen}.png`), `${viewport} ${theme}-${screen}`);
        }
      }
    }
    assert.ok(existsSync(join(output, 'nojs-all.png')) && existsSync(join(output, 'print.pdf')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
