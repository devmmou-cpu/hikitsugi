// 表示プログラム初版（T1）の合格テスト。夜間の作業ではこのファイルを変更しない。
//
// 実装との約束（見た目の作り方は自由。ここに書いたことだけを守る）：
// - plugin/renderer/render.mjs が renderManual(manual) を export し、HTML の文字列を返す
// - 同じファイルをコマンドとして実行できる：node plugin/renderer/render.mjs <入力.json> <出力.html>
//   終了コードは 0＝成功、1＝入力の異常（出力ファイルを作らない）、2＝引数の誤り
// - 手順ページの目安の時間は「2分」のように「数字＋分」で書く。文字の判定バッジには data-badge="self" などを付ける
// - 押す部品（button、summary、電話リンク、nav のリンク、チェックボックスの label）には class="tap" を付ける
// - 症状の一覧から #symptom-T1 へリンクし、手順ページの要素の id を symptom-T1 にする
// - JavaScript なしでは動かない部品には class="js-only" を付ける（初期状態で隠してよいのはこれだけ）
// - JavaScript が動くと html 要素に class="js" が付く。隠す CSS は .js か html.js で始まるセレクターに書く

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderManual } from '../plugin/renderer/render.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_PATH = join(ROOT, 'test/fixtures/manual-t1.json');
const RENDERER_DIR = join(ROOT, 'plugin/renderer');
const fixture = () => JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
const textOf = (manual, id) => manual.statements.find((s) => s.id === id).text;

const render = (mutate) => {
  const manual = fixture();
  mutate?.(manual);
  return renderManual(manual);
};
const html = render();

// ---- 解析の補助 ----
const decode = (text) =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;|&apos;/g, "'")
    .replace(/&amp;/g, '&');

/** JavaScript もスタイルも効かない環境で読める文字列。 */
const visibleText = (source) =>
  decode(
    source
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<script\b[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ''),
  );

const cssOf = (source) => [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
const scriptOf = (source) => [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join('\n');

/** 条件に合う @media ブロックを取り除く。 */
function stripMedia(css, pattern) {
  let result = '';
  let index = 0;
  const media = /@media[^{]*\{/g;
  let match;
  while ((match = media.exec(css))) {
    if (!pattern.test(match[0])) continue;
    result += css.slice(index, match.index);
    let depth = 1;
    let i = media.lastIndex;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth += 1;
      if (css[i] === '}') depth -= 1;
      i += 1;
    }
    index = i;
    media.lastIndex = i;
  }
  return result + css.slice(index);
}

const startTags = (source, name) => [...source.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map((m) => m[0]);
const classesOf = (tag) => (tag.match(/\bclass="([^"]*)"/i)?.[1] ?? '').split(/\s+/).filter(Boolean);
const hasTap = (tag) => classesOf(tag).includes('tap');

const SECTION_OF_T1 = () => {
  const start = html.search(/\bid="symptom-T1"/);
  assert.ok(start >= 0, 'id="symptom-T1" の要素がありません');
  return html.slice(start);
};

// ---- HTML 1ファイルとしての基本 ----
test('完全な HTML 文書で、日本語とスマホの指定がある', () => {
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<html\b[^>]*\blang="ja"/i);
  assert.match(html, /<meta\b[^>]*charset="?utf-8"?/i);
  assert.match(html, /<meta\b[^>]*name="viewport"[^>]*width=device-width/i);
  assert.match(html, /<title>[^<]*取扱説明書[^<]*<\/title>/);
  assert.equal(startTags(html, 'h1').length, 1);
  assert.equal(startTags(html, 'main').length, 1);
});

test('外部への読み込みがない', () => {
  assert.doesNotMatch(html, /https?:\/\//i);
  assert.doesNotMatch(html, /(?:src|href|action|data)=["']\/\//i);
  assert.doesNotMatch(html, /<(?:link|img|iframe|object|embed|base|form)\b/i);
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc=/i);
  const css = cssOf(html);
  assert.doesNotMatch(css, /@import|@font-face|url\(/i);
  for (const tag of startTags(html, 'a')) {
    const href = tag.match(/\bhref="([^"]*)"/i)?.[1] ?? '';
    assert.match(href, /^(#|tel:)/, `リンク先は # か tel: だけです: ${tag}`);
  }
});

test('外部へ送信するプログラムがない', () => {
  assert.doesNotMatch(scriptOf(html), /fetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|\beval\(|new Function|import\(/);
});

test('ファイルの大きさは 200KB 以下', () => {
  assert.ok(Buffer.byteLength(html) <= 200 * 1024);
});

// ---- JavaScript なしで全文が読める ----
test('JavaScript なしで全部の記述が読める', () => {
  const text = visibleText(html);
  for (const statement of fixture().statements) {
    assert.ok(text.includes(statement.text), `読めない記述: ${statement.id} ${statement.text}`);
  }
});

test('連絡先の名前と電話番号が、JavaScript なしで読める', () => {
  const text = visibleText(html);
  assert.ok(text.includes('カワウソシステムサービス'));
  assert.ok(text.includes('03-0000-0102'));
});

test('JavaScript なしの状態で、内容を隠していない', () => {
  assert.doesNotMatch(html, /<template\b/i);
  // script と style の中身は、タグと見間違えないよう先に除く
  const markup = html.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '');
  for (const [tag] of markup.matchAll(/<[a-z][a-z0-9]*\b[^>]*\bhidden\b[^>]*>/gi)) {
    assert.ok(classesOf(tag).includes('js-only'), `hidden は js-only の部品だけです: ${tag}`);
  }
  for (const [tag] of markup.matchAll(/<[a-z][a-z0-9]*\b[^>]*\bclass="[^"]*\bjs-only\b[^"]*"[^>]*>/gi)) {
    assert.match(tag, /^<(button|span)\b/i, `js-only は button か span だけです: ${tag}`);
  }
  assert.doesNotMatch(markup, /<[a-z][^>]*\bstyle="[^"]*(?:display\s*:\s*none|visibility\s*:\s*hidden)/i);

  const css = stripMedia(cssOf(html), /print/).replace(/\/\*[\s\S]*?\*\//g, '');
  // 同じ内容が別の場所にある部品は、幅によって隠してよい（ナビ、右の列）。JavaScript がないと動かないコピーのボタンも隠してよい
  const duplicated = /^(\.tabs|\.topnav|\.rail|\.btn-copy|\.count-live)\b/;
  for (const [, selector] of css.matchAll(/([^{}]+)\{[^{}]*(?:display\s*:\s*none|visibility\s*:\s*hidden)[^{}]*\}/gi)) {
    for (const part of selector.split(',').map((s) => s.trim())) {
      if (duplicated.test(part)) continue;
      assert.match(part, /^(html)?\.js\b|\.js-only\b/, `JavaScript なしで隠れる指定です: ${part}`);
    }
  }
});

test('JavaScript がある場合、html に js のクラスを付ける', () => {
  assert.match(scriptOf(html), /classList\.(?:add\(\s*|replace\(\s*['"]no-js['"]\s*,\s*)['"]js['"]\s*\)|className\s*\+?=\s*['"][^'"]*\bjs\b/);
});

test('ブラウザーの保存機能が使えない環境でも止まらない', () => {
  const script = scriptOf(html);
  if (/localStorage|sessionStorage/.test(script)) {
    assert.match(script, /try\s*\{/);
    assert.match(script, /catch\b/);
  }
});

// ---- 画面の構成 ----
test('下部のタブが4つあり、リンク先が存在する', () => {
  const nav = html.match(/<nav\b[\s\S]*?<\/nav>/i)?.[0];
  assert.ok(nav, 'nav がありません');
  assert.match(startTags(nav, 'nav')[0], /aria-label="/);
  const links = startTags(nav, 'a');
  assert.equal(links.length, 4);
  const text = visibleText(nav);
  for (const label of ['困ったとき', '連絡先', '毎月やること', '会社のIT']) {
    assert.ok(text.includes(label), `タブがありません: ${label}`);
  }
  for (const tag of links) {
    const target = tag.match(/\bhref="#([^"]+)"/)?.[1];
    assert.ok(target, `リンク先がありません: ${tag}`);
    assert.ok(html.includes(`id="${target}"`), `リンク先の要素がありません: ${target}`);
  }
});

test('冒頭に社外秘と会社名がある', () => {
  const text = visibleText(html);
  const first = text.indexOf('社外秘');
  assert.ok(first >= 0, '社外秘の表示がありません');
  assert.ok(first < text.indexOf('共有フォルダが見えない'));
  assert.ok(text.includes('オコジョ精工'));
});

test('困ったときに、症状のカテゴリと一覧から手順ページへ移れる', () => {
  const start = html.search(/\bid="symptom-T1"/);
  assert.ok(start >= 0, 'id="symptom-T1" の要素がありません');
  // 手順ページより前（カテゴリと一覧）だけを見る。記述の中の「ファイル」に当たらないように
  const menu = html.slice(0, start);
  const text = visibleText(menu);
  assert.ok(text.includes('ファイル'), 'カテゴリの表示がありません');
  assert.ok(text.includes('共有フォルダが見えない'), '症状の一覧がありません');
  assert.match(menu, /<a\b[^>]*href="#symptom-T1"/);
});

test('連絡先のタブに業者のカードがあり、全項目が読める', () => {
  const manual = fixture();
  const contact = manual.contacts[0];
  const text = visibleText(html);
  for (const id of [contact.role, contact.hours, contact.contract_location, contact.what_to_tell]) {
    assert.ok(text.includes(textOf(manual, id)), id);
  }
  assert.ok(startTags(html, 'a').filter((tag) => /href="tel:/.test(tag)).length >= 2, '手順ページと連絡先の両方に電話リンクが必要です');
});

test('用語は押して開閉でき、説明が読める', () => {
  const manual = fixture();
  const details = [...html.matchAll(/<details\b[\s\S]*?<\/details>/gi)].map((m) => m[0]);
  for (const { term, explanation } of manual.glossary) {
    const found = details.find((d) => visibleText(d).includes(term) && visibleText(d).includes(textOf(manual, explanation)));
    assert.ok(found, `用語の開閉がありません: ${term}`);
    assert.match(found, /<summary\b/i);
  }
});

// ---- 手順ページの型 ----
test('手順ページは決まった順番で並ぶ', () => {
  const manual = fixture();
  const page = manual.symptom_pages[0];
  const text = visibleText(SECTION_OF_T1());
  const order = [
    ['症状', textOf(manual, page.title)],
    ['判定バッジ', '自分で直せる'],
    ['目安の時間', '2分'],
    ['安心のひとこと', textOf(manual, page.reassurance)],
    ['最初の手順', textOf(manual, page.steps[0])],
    ['最後の手順', textOf(manual, page.steps.at(-1))],
    ['それでもだめなら', 'それでもだめなら'],
    ['業者に送る文面', textOf(manual, page.fallback.message)],
    ['根拠', '確認済み'],
  ];
  let position = -1;
  for (const [label, expected] of order) {
    const next = text.indexOf(expected, position + 1);
    assert.ok(next > position, `「${label}」が正しい位置にありません`);
    position = next;
  }
});

test('手順は番号つきの一覧で、1つの手順に1つのチェックがある', () => {
  const manual = fixture();
  const section = SECTION_OF_T1();
  const list = section.match(/<ol\b[\s\S]*?<\/ol>/i)?.[0];
  assert.ok(list, 'ol がありません');
  const count = manual.symptom_pages[0].steps.length;
  assert.equal(startTags(list, 'li').length, count);
  assert.equal(startTags(list, 'input').filter((tag) => /type="checkbox"/.test(tag)).length, count);
  // JavaScript なしでも、順番どおりに読める
  const text = visibleText(list);
  let position = -1;
  for (const id of manual.symptom_pages[0].steps) {
    const next = text.indexOf(textOf(manual, id));
    assert.ok(next > position, `手順の順番が違います: ${id}`);
    position = next;
  }
});

test('チェックは label の中にあり、文字を押しても切り替わる', () => {
  const list = SECTION_OF_T1().match(/<ol\b[\s\S]*?<\/ol>/i)[0];
  const labels = [...list.matchAll(/<label\b[^>]*>[\s\S]*?<\/label>/gi)].map((m) => m[0]);
  assert.equal(labels.length, fixture().symptom_pages[0].steps.length);
  for (const label of labels) assert.match(label, /<input\b[^>]*type="checkbox"/i);
});

test('それでもだめなら：電話ボタンとコピーボタンがあり、文面は JavaScript なしで読める', () => {
  const section = SECTION_OF_T1();
  const fallback = section.slice(section.indexOf('それでもだめなら'));
  const tel = startTags(fallback, 'a').find((tag) => /href="tel:/.test(tag));
  assert.ok(tel, '電話のリンクがありません');
  assert.match(tel, /href="tel:03-?0000-?0102"/);
  assert.match(fallback, /カワウソシステムサービス/);
  const buttons = [...fallback.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/gi)].map((m) => m[0]);
  assert.ok(buttons.some((b) => visibleText(b).includes('コピー')), 'コピーのボタンがありません');
  // コピーボタンは JavaScript がないと動かないので、js-only にする
  for (const button of buttons.filter((b) => visibleText(b).includes('コピー'))) {
    assert.ok(classesOf(startTags(button, 'button')[0]).includes('js-only'), 'コピーボタンは js-only です');
  }
});

test('直らなかったときの連絡先がないページは、その欄を出さない', () => {
  const output = render((m) => {
    m.symptom_pages[0].fallback = null;
    m.contacts = [];
    m.statements = m.statements.filter((s) => !['STM-011', 'STM-012', 'STM-013', 'STM-014', 'STM-015'].includes(s.id));
  });
  assert.ok(!visibleText(output).includes('それでもだめなら'));
  assert.doesNotMatch(output, /href="tel:/);
});

for (const [value, label] of [
  ['self', '自分で直せる'],
  ['check_first', '確認してから'],
  ['vendor', '業者へ連絡'],
  ['internal', '社内で相談'],
]) {
  test(`判定バッジ ${value} は「${label}」と文字で表示する`, () => {
    const output = render((m) => {
      m.symptom_pages[0].badge.value = value;
    });
    const page = output.slice(output.search(/\bid="symptom-T1"/));
    assert.ok(visibleText(page).includes(label));
    assert.match(page, new RegExp(`data-badge="${value}"`));
  });
}

test('根拠：調査データの日付と聞き取りを表示する', () => {
  const text = visibleText(SECTION_OF_T1());
  assert.ok(text.includes('調査データ'));
  assert.ok(text.includes('2026年11月5日'));
  assert.ok(text.includes('聞き取り'));
  assert.ok(text.includes('確認済み'));
});

test('根拠：手順ページの記述に調査データがなければ、調査データとは書かない', () => {
  const output = render((m) => {
    for (const s of m.statements) s.evidence = ['INT-018'];
  });
  const page = output.slice(output.search(/\bid="symptom-T1"/));
  const note = visibleText(page);
  const at = note.indexOf('確認済み');
  assert.ok(at >= 0);
  assert.ok(!note.slice(Math.max(0, at - 60), at).includes('調査データ'));
});

// ---- 見た目の決まり ----
test('押す部品は tap のクラスを持ち、高さ 44px 以上', () => {
  const css = cssOf(html);
  const rule = css.match(/\.tap\b[^{]*\{([^}]*)\}/)?.[1];
  assert.ok(rule, '.tap の指定がありません');
  const height = rule.match(/min-height\s*:\s*(\d+)px/)?.[1];
  assert.ok(height && Number(height) >= 44, `.tap の min-height は 44px 以上です: ${height}`);

  for (const name of ['button', 'summary']) {
    for (const tag of startTags(html, name)) assert.ok(hasTap(tag), `tap がありません: ${tag}`);
  }
  for (const tag of startTags(html, 'a').filter((t) => /href="tel:/.test(t))) assert.ok(hasTap(tag), `tap がありません: ${tag}`);
  const nav = html.match(/<nav\b[\s\S]*?<\/nav>/i)[0];
  for (const tag of startTags(nav, 'a')) assert.ok(hasTap(tag), `tap がありません: ${tag}`);
  for (const [label] of html.matchAll(/<label\b[^>]*>(?=[\s\S]*?<input\b[^>]*type="checkbox")/gi)) {
    assert.ok(hasTap(label), `tap がありません: ${label}`);
  }
});

test('幅 375px でも横にはみ出さない作り', () => {
  const css = stripMedia(cssOf(html), /print|min-width/);
  for (const [, value] of css.matchAll(/(?:^|[;{\s])(?:min-)?width\s*:\s*(\d+)px/g)) {
    assert.ok(Number(value) <= 375, `固定の幅が大きすぎます: ${value}px`);
  }
  // 長い接続先（\\OKOJO-NAS\図面 など）を折り返す指定
  assert.match(css, /overflow-wrap\s*:\s*(?:anywhere|break-word)|word-break\s*:\s*break-(?:all|word)/);
});

test('ダークモードと印刷用の指定がある', () => {
  const css = cssOf(html);
  assert.match(css, /@media[^{]*prefers-color-scheme\s*:\s*dark/);
  assert.match(css, /@media[^{]*\bprint\b/);
});

// ---- 安全 ----
test('記述の中の記号は文字として表示し、タグとして解釈しない', () => {
  const attack = '<script>alert(1)</script>&<img src=x onerror=alert(2)>"\'';
  const output = render((m) => {
    m.statements[0].text = attack;
  });
  assert.ok(!output.includes('<script>alert(1)'));
  assert.ok(!output.includes('<img src=x'));
  assert.ok(visibleText(output).includes(attack));
});

test('業者名や電話番号も属性の中で壊れない', () => {
  const output = render((m) => {
    m.contacts[0].name = '<b>"業者"</b>';
    m.contacts[0].phone = '03-0000-0102"><script>alert(1)</script>';
  });
  assert.ok(!output.includes('<script>alert(1)'));
  assert.ok(!output.includes('<b>"業者"'));
});

test('コピーする文面が script の中にあっても、閉じタグで壊れない', () => {
  const output = render((m) => {
    m.statements.find((s) => s.id === 'STM-011').text = '</script><script>alert(3)</script>';
  });
  assert.ok(!output.includes('<script>alert(3)'));
});

test('パスワード本体を含む記述は、出力せずに止める', () => {
  assert.throws(
    () =>
      render((m) => {
        m.statements[0].text = 'パスワードは abcd1234 です。';
      }),
    /認証情報/,
  );
});

test('保管場所の記述は止めない', () => {
  const output = render((m) => {
    m.statements[0].text = 'パスワードは総務課の書庫に保管しています。';
  });
  assert.ok(visibleText(output).includes('パスワードは総務課の書庫に保管しています。'));
});

// ---- 入力の異常 ----
test('形式の違う入力は止める', () => {
  assert.throws(() => renderManual({ schema_version: 1 }));
  assert.throws(() => render((m) => { m.symptom_pages[0].badge.value = 'たぶん'; }));
});

test('存在しない記述や連絡先を参照している入力は止める', () => {
  assert.throws(() => render((m) => { m.symptom_pages[0].steps.push('STM-999'); }), /STM-999/);
  assert.throws(() => render((m) => { m.symptom_pages[0].fallback.contact = 'VEN-99'; }), /VEN-99/);
});

// ---- 再現性 ----
test('同じ入力からは必ず同じ出力になる', () => {
  assert.equal(render(), render());
});

test('入力のデータを書き換えない', () => {
  const manual = fixture();
  const before = JSON.stringify(manual);
  renderManual(manual);
  assert.equal(JSON.stringify(manual), before);
});

test('実装は時刻や乱数に依存せず、外部ライブラリを使わない', () => {
  const files = readdirSync(RENDERER_DIR).filter((f) => /\.(mjs|js)$/.test(f));
  assert.ok(files.includes('render.mjs'));
  for (const file of files) {
    const source = readFileSync(join(RENDERER_DIR, file), 'utf8');
    assert.doesNotMatch(source, /Date\.now|new Date\(|Math\.random|performance\.now/, file);
    for (const [, target] of source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      assert.match(target, /^(node:|\.\/|\.\.\/lib\/)/, `${file} の読み込み先: ${target}`);
    }
  }
});

test('ルートの package.json に依存を足していない', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
});

// ---- コマンド ----
function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'hikitsugi-render-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const cli = (...args) => spawnSync(process.execPath, [join(RENDERER_DIR, 'render.mjs'), ...args], { encoding: 'utf8' });

test('コマンド：入力から HTML ファイルを作る', () =>
  withDir((dir) => {
    const out = join(dir, 'manual.html');
    const result = cli(FIXTURE_PATH, out);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(out, 'utf8'), html);
  }));

test('コマンド：引数の誤りは終了コード 2', () => {
  assert.equal(cli().status, 2);
  assert.equal(cli(FIXTURE_PATH).status, 2);
});

test('コマンド：入力の異常は終了コード 1 で、出力ファイルを作らない', () =>
  withDir((dir) => {
    const out = join(dir, 'manual.html');
    assert.equal(cli(join(dir, 'ない.json'), out).status, 1);
    const broken = join(dir, 'broken.json');
    writeFileSync(broken, '{ 壊れた');
    assert.equal(cli(broken, out).status, 1);
    const invalid = join(dir, 'invalid.json');
    writeFileSync(invalid, JSON.stringify({ schema_version: 1 }));
    assert.equal(cli(invalid, out).status, 1);
    const secret = join(dir, 'secret.json');
    const manual = fixture();
    manual.statements[0].text = 'パスワードは abcd1234 です。';
    writeFileSync(secret, JSON.stringify(manual));
    const result = cli(secret, out);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /認証情報/);
    assert.ok(!existsSync(out));
  }));
