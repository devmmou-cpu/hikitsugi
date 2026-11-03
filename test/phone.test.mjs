// スマホ向けの束の決まりを確かめる。iPhone の OneDrive では、JavaScript もページ内リンクも動かない（本人の実機）。

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PHONE_FILE_LIMIT } from '../plugin/lib/limits.mjs';
import { phoneFileName, phoneFileProblems, renderPhoneBundle, safeSymptomName, writePhoneBundle } from '../plugin/renderer/phone.mjs';
import { CATEGORY_LABELS } from '../plugin/renderer/render.mjs';
import { checkSecretFiles } from '../scripts/check-secrets.mjs';
import { manualHtmlProblems, withPhoneBundles, writtenHtmlPaths } from '../scripts/hooks/check-manual-html.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const fixture = (name = 'manual-full') => JSON.parse(readFileSync(join(ROOT, `test/fixtures/${name}.json`), 'utf8'));
const manual = fixture();
const bundle = renderPhoneBundle(manual);
const textOf = new Map(manual.statements.map((s) => [s.id, s.text]));
const plain = (html) => html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const fileFor = (page) => bundle.find(({ html }) => plain(html).includes(textOf.get(page.title)) && html.includes(`<title>${textOf.get(page.title)}`));
const position = (html, text) => plain(html).indexOf(text);

test('ファイル名：番号_【判定】症状.html。例のとおりになる', () => {
  assert.equal(phoneFileName(3, 'self', '共有フォルダが見えません'), '03_【自分で直せる】共有フォルダが見えません.html');
  assert.equal(phoneFileName(12, 'vendor', '複合機が故障した'), '12_【業者へ連絡】複合機が故障した.html');
});

test('ファイル名：使えない文字と、先頭と末尾の空白とピリオドを置き換え、30字で切る', () => {
  assert.equal(safeSymptomName('a\\b/c:d*e?f"g<h>i|j'), 'a_b_c_d_e_f_g_h_i_j');
  assert.equal(safeSymptomName(' .共有. '), '__共有__');
  assert.equal(safeSymptomName('　全角の空白'), '_全角の空白');
  assert.equal([...safeSymptomName('あ'.repeat(40))].length, 30);
  // 切ったあとの末尾にピリオドが来ても置き換える
  assert.equal(safeSymptomName(`${'あ'.repeat(29)}.いう`), `${'あ'.repeat(29)}_`);
  assert.ok(!/[\\/:*?"<>|]/.test(safeSymptomName('改行\nや\tタブ/も')));
});

test('並び：00_連絡先 が先頭、99_当てはまる症状がないとき が末尾で、番号は PC 版の分類の順', () => {
  const names = bundle.map((file) => file.name);
  assert.equal(names[0], '00_連絡先.html');
  assert.equal(names.at(-1), '99_当てはまる症状がないとき.html');
  assert.deepEqual([...names].sort(), names, 'フォルダの一覧の並びと同じ');
  const order = CATEGORY_LABELS.flatMap(([category]) => manual.symptom_pages.filter((p) => p.category === category));
  assert.equal(names.length, order.length + 2);
  order.forEach((page, index) => {
    const label = { self: '自分で直せる', check_first: '確認してから', vendor: '業者へ連絡', internal: '社内で相談' }[page.badge.value];
    assert.ok(names[index + 1].startsWith(`${String(index + 1).padStart(2, '0')}_【${label}】`), names[index + 1]);
  });
});

test('各ファイル：script、リンク、操作する部品、外部の読み込みを持たず、200KB 以内', () => {
  for (const { name, html } of bundle) {
    assert.deepEqual(phoneFileProblems(html), [], name);
    assert.ok(Buffer.byteLength(html) < PHONE_FILE_LIMIT, name);
    assert.doesNotMatch(html, /tel:|#[a-z]+-|<details/i, name);
    assert.match(html, /^<!doctype html>/, name);
  }
});

test('検査は、script、リンク、大きすぎるファイルを見つける', () => {
  const page = (body) => `<!doctype html><html><body>${body}</body></html>`;
  assert.match(phoneFileProblems(page('<script>1</script>')).join(), /script/);
  assert.match(phoneFileProblems(page('<a href="#x">x</a>')).join(), /リンク/);
  assert.match(phoneFileProblems(page('<a href="other.html">x</a>')).join(), /リンク/);
  assert.match(phoneFileProblems(page('<details>x</details>')).join(), /部品/);
  assert.match(phoneFileProblems(page('<svg><use href="#x"/></svg>')).join(), /リンク|部品/);
  assert.match(phoneFileProblems(page('<img src="https://x.example/a.png">')).join(), /読み込/);
  assert.match(phoneFileProblems(page('あ'.repeat(70 * 1024))).join(), /上限/);
  assert.deepEqual(phoneFileProblems(page('本文')), []);
});

test('判定は PC 用と同じバッジで、色とアイコンを持ち、ページ内の参照を使わない', () => {
  const css = bundle[0].html.match(/<style>([\s\S]*?)<\/style>/)[1];
  for (const [value, fg, bg] of [['self', '--ok-fg', '--ok-bg'], ['check_first', '--warn-fg', '--warn-bg'], ['vendor', '--call-fg', '--call-bg'], ['internal', '--ask-fg', '--ask-bg']]) {
    assert.match(css, new RegExp(`\\.badge\\[data-badge="${value}"\\]\\s*\\{\\s*color:\\s*var\\(${fg}\\);\\s*background:\\s*var\\(${bg}\\)`), value);
  }
  for (const page of manual.symptom_pages) {
    const { name, html } = fileFor(page);
    assert.match(html, new RegExp(`<span class="badge" data-badge="${page.badge.value}"><svg[^>]*>.+?</svg>`), name);
    assert.doesNotMatch(html, /<use\b/, name);
  }
});

test('各ファイルは1症状だけで、上から ① → ② → ③ の順に、表と連絡先を同梱する', () => {
  for (const page of manual.symptom_pages) {
    const { name, html } = fileFor(page);
    const text = plain(html);
    assert.equal((html.match(/<h1>/g) ?? []).length, 1, name);
    for (const other of manual.symptom_pages) {
      if (other.id === page.id || !other.fallback || other.fallback.message === page.fallback?.message) continue;
      assert.ok(!text.includes(textOf.get(other.fallback.message)), `${name} に ${other.id} の文面があります`);
    }
    for (const id of [...page.first_steps, ...page.steps]) {
      const head = textOf.get(id).split('。')[0];
      if (head) assert.ok(text.includes(head), `${name}: ${id}`);
    }
    if (page.first_steps.length && page.steps.length) {
      assert.ok(position(html, 'まずこれだけ') < position(html, 'それでも直らなければ'), name);
    }
    if (page.fallback) {
      const contact = manual.contacts.find((c) => c.id === page.fallback.contact);
      assert.ok(text.includes(contact.name), `${name}: 連絡先の名前`);
      if (contact.phone) assert.ok(text.includes(contact.phone.replaceAll('-', '')), `${name}: 電話番号`);
      if (page.first_steps.length || page.steps.length) {
        assert.ok(position(html, page.first_steps.length ? 'まずこれだけ' : 'やること') < position(html, 'それでもだめなら'), name);
      }
      assert.match(html, /<blockquote class="say">/, `${name}: 送る文面`);
    }
    if (page.info_rows.length) assert.match(html, /この症状で使う会社の情報[\s\S]*<table class="info-table/, name);
  }
});

test('実機の結果の形：番号は 22px 太字の文字で案内つき、コピー欄は枠で案内つき、用語は開いたまま', () => {
  const css = bundle[0].html.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.match(css, /\.num\s*\{[^}]*font-size:\s*22px;\s*font-weight:\s*700/);
  assert.match(css, /\.note\s*\{[^}]*font-size:\s*15px/);
  for (const { name, html } of bundle) {
    for (const [tag] of html.matchAll(/<p class="num">[^<]*<\/p>/g)) assert.ok(html.includes(`${tag}\n<p class="note">番号を長押しすると、発信できます。</p>`), name);
    for (const [tag] of html.matchAll(/<blockquote class="say">[\s\S]*?<\/blockquote>/g)) assert.ok(html.includes(`${tag}\n<p class="note">長押しして選択し、コピーしてください。</p>`), name);
  }
  assert.match(css, /\.say\s*\{[^}]*user-select:\s*all/);
  assert.match(css, /\.info-table th\s*\{[^}]*white-space:\s*nowrap/, '表の見出しを語の途中で折り返さない');
  const withTerm = bundle.find(({ html }) => html.includes('このページのことば'));
  assert.ok(withTerm, '用語のあるページがありません');
  assert.match(withTerm.html, /<dl>\s*<dt>[^<]+<\/dt>\s*<dd>[^<]+<\/dd>/);
});

test('社員に返す文は ① の直下で、② より前。① がなければ本文の最初に置く', () => {
  for (const page of manual.symptom_pages) {
    const { name, html } = fileFor(page);
    assert.match(html, /<h2>社員に返す文<\/h2>\s*<blockquote class="say">/, name);
    const text = plain(html);
    const reply = text.indexOf('社員に返す文');
    if (page.first_steps.length) assert.ok(text.indexOf('まずこれだけ') < reply, name);
    for (const later of ['それでも直らなければ', 'やること', 'それでもだめなら', '相談してください', '連絡してください']) {
      if (text.includes(`${later}\n`)) assert.ok(reply < text.indexOf(`${later}\n`), `${name}: ${later}`);
    }
  }
});

test('電話番号：文字のハイフンを入れず、桁ごとの要素に分け、全体を選べるようにする', () => {
  const css = bundle[0].html.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.match(css, /\.tel\s*\{[^}]*-webkit-user-select:\s*all;[^}]*user-select:\s*all/);
  assert.match(css, /\.tel > span \+ span\s*\{\s*margin-left/);
  assert.match(css, /\.say\s*\{[^}]*-webkit-user-select:\s*all;[^}]*user-select:\s*all/);
  for (const { name, html } of bundle) {
    const body = html.replace(/<style>[\s\S]*?<\/style>/, '');
    assert.doesNotMatch(plain(body), /0\d{0,4}-\d{1,4}-\d{3,4}/, `${name}: ハイフンの文字が残っています`);
  }
  assert.match(bundle[0].html, /<p class="num"><span class="tel"><span>03<\/span><span>0000<\/span><span>01\d\d<\/span><\/span><\/p>/);
});

test('連絡先の順：会社名 → 役割 → 受付 → 番号 → 注記 → 送る文面', () => {
  for (const { name, html } of bundle) {
    for (const [card] of html.matchAll(/<div class="contact">[\s\S]*?<\/div>/g)) {
      const at = (mark) => card.indexOf(mark);
      if (!card.includes('class="num"')) continue;
      assert.ok(at('contact-name') < at('contact-role'), name);
      const hours = card.match(/<\/h3>\s*<p>/);
      if (hours) assert.ok(hours.index < at('class="num"'), `${name}: 受付は番号の上`);
      assert.ok(at('class="num"') < at('class="note"'), name);
      if (card.includes('class="say"')) assert.ok(at('class="note"') < at('class="say"'), name);
    }
  }
});

test('連絡先のファイルは全員を載せ、社内の相談先を先にする。99 も同じ相手へ案内する', () => {
  for (const { name, html } of [bundle[0], bundle.at(-1)]) {
    const text = plain(html);
    for (const contact of manual.contacts) assert.ok(text.includes(contact.name), `${name}: ${contact.name}`);
    const inside = manual.contacts.find((c) => c.id.startsWith('INH-'));
    const vendor = manual.contacts.find((c) => c.id.startsWith('VEN-'));
    if (inside && vendor) assert.ok(text.indexOf(inside.name) < text.indexOf(vendor.name), name);
  }
});

test('下書きには帯を出し、確認が済んだら確認した人を書く', () => {
  const { review, ...draft } = fixture();
  assert.ok(review);
  assert.ok(renderPhoneBundle(draft).every(({ html }) => html.includes('下書き（前任者の確認前）')));
  assert.ok(bundle.every(({ html }) => !html.includes('下書き（前任者の確認前）')));
  assert.ok(bundle.slice(1, -1).every(({ html }) => html.includes(`前任の${manual.review.reviewer}さんが確認済み`)));
});

test('形の問題がある取扱説明書からは、1つも作らない', () => {
  const broken = fixture();
  broken.statements.find((s) => s.id === broken.contacts[0].role).text = '十五文字を超えるとても長い役割の説明です';
  assert.throws(() => renderPhoneBundle(broken), /手順ページの形/);
});

test('上限の 200KB を超えるファイルは .blocked で保存し、理由を返す', () => {
  const big = fixture();
  const page = big.symptom_pages[0];
  big.statements.find((s) => s.id === page.reassurance).text = `${'あ'.repeat(49)}。`.repeat(1500);
  const dir = mkdtempSync(join(tmpdir(), 'hikitsugi-phone-'));
  try {
    const written = writePhoneBundle(big, dir);
    assert.equal(written.blocked.length, 1);
    assert.match(written.blocked[0], /200KB/);
    assert.equal(readdirSync(dir).filter((name) => name.endsWith('.blocked')).length, 1);
    assert.equal(readdirSync(dir).filter((name) => name.endsWith('.html')).length, bundle.length - 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('フォルダに書き出すと、古い症状のファイルが残らない', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hikitsugi-phone-'));
  try {
    writeFileSync(join(dir, '50_【自分で直せる】古い症状.html'), 'x');
    writeFileSync(join(dir, '51_古い.html.blocked'), 'x');
    writeFileSync(join(dir, 'メモ.txt'), 'x');
    writePhoneBundle(manual, dir);
    const names = readdirSync(dir);
    assert.ok(!names.some((name) => name.startsWith('5')));
    assert.ok(names.includes('メモ.txt'));
    assert.equal(names.length, bundle.length + 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('書き出し後の検査：束の全ファイルが合格する。問題のあるファイルだけを .blocked に改名する', () => {
  for (const { name, html } of bundle) assert.deepEqual(manualHtmlProblems(html), [], name);
  const dir = mkdtempSync(join(tmpdir(), 'hikitsugi-phone-'));
  try {
    const phone = join(dir, 'phone');
    writePhoneBundle(manual, phone);
    writeFileSync(join(dir, 'manual.html'), '<!doctype html><p>本文</p>');
    const bad = join(phone, '03_【自分で直せる】悪い.html');
    writeFileSync(bad, '<!doctype html><p>電話は 06-0000-0000 です。</p>');
    const withLink = join(phone, '04_【自分で直せる】リンク.html');
    writeFileSync(withLink, '<!doctype html><a href="#x">x</a>');
    assert.ok(withPhoneBundles([join(dir, 'manual.html')]).includes(bad));
    const hook = spawnSync(process.execPath, [join(ROOT, 'scripts/hooks/check-manual-html.mjs'), '--file', join(dir, 'manual.html')], { encoding: 'utf8' });
    assert.equal(hook.status, 2);
    assert.ok(!hook.stderr.includes('06-0000-0000'));
    assert.ok(!existsSync(bad) && existsSync(`${bad}.blocked`));
    assert.ok(!existsSync(withLink) && existsSync(`${withLink}.blocked`));
    assert.ok(existsSync(join(phone, bundle[0].name)), '問題のないファイルは残る');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('書き出し後の検査：桁ごとに分けた電話番号も、架空の形式かを調べる', () => {
  const tel = (a, b, c) => `<span class="tel"><span>${a}</span><span>${b}</span><span>${c}</span></span>`;
  assert.match(manualHtmlProblems(`<p>${tel('06', '0000', '0000')}</p>`).join(), /電話番号/);
  assert.deepEqual(manualHtmlProblems(`<p>${tel('03', '0000', '0101')}</p>`), []);
});

test('書き出し後の検査：phone.mjs の出力先のフォルダを、ツールの実行から探す', () => {
  const found = writtenHtmlPaths({ cwd: '/work', tool_name: 'Bash', tool_input: { command: 'node plugin/renderer/phone.mjs in.json out/phone' } });
  assert.deepEqual(found, ['/work/out/phone']);
});

test('秘密情報の点検：束のフォルダにキーの形があれば見つけ、値は出さない', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hikitsugi-phone-'));
  try {
    writePhoneBundle(manual, dir);
    assert.deepEqual(checkSecretFiles([dir]), []);
    // 見本のキーは実行時に組み立てる。リポジトリにキーの形を置かないため
    const key = `sk-ant-${'a'.repeat(30)}`;
    writeFileSync(join(dir, bundle[1].name), `<p>${key}</p>`);
    const found = checkSecretFiles([dir]);
    assert.equal(found.length, 1);
    assert.ok(!found[0].includes(key));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('実際の画面：JavaScript なしで全ファイルが、はみ出さず、外部を読まず、撮影できる', { skip: existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') || process.env.CHROME_PATH ? false : 'Chrome がありません' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'hikitsugi-phone-'));
  try {
    const input = join(dir, 'phone');
    const output = join(dir, 'shots');
    writePhoneBundle(manual, input);
    mkdirSync(output);
    const stdout = execFileSync(process.execPath, [join(ROOT, 'scripts/screenshots.mjs'), input, output], { encoding: 'utf8', timeout: 240000 });
    assert.match(stdout, /問題なし/);
    assert.ok(existsSync(join(output, '00-light.png')) && existsSync(join(output, '99-dark.png')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('後任のメモ：束には欄を出さず、PC 版で書けることだけを1行で伝える', () => {
  const manual = JSON.parse(readFileSync(join(ROOT, 'test/fixtures/manual-full.json'), 'utf8'));
  const files = renderPhoneBundle(manual);
  for (const { name, html } of files) {
    assert.doesNotMatch(html, /<textarea|data-memo|localStorage/, name);
    assert.deepEqual(phoneFileProblems(html), [], name);
  }
  const lined = files.filter(({ html }) => html.includes('メモは PC 版で書けます'));
  assert.equal(lined.length, manual.symptom_pages.length + 2, '手順ページ、連絡先、当てはまる症状がないとき');
  for (const { html } of lined) assert.equal(html.match(/メモは PC 版で書けます/g).length, 1);
});
