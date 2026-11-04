// 取扱説明書の HTML に埋め込む CSS。値の正は docs/design/visual-spec.md の第6章と第7章。
// - 色の値は変数の定義の中にだけ書く。ダークは OS の設定と data-theme の両方で効く
// - 文字は 14px 以上。13px はタブのラベルと社外秘のチップだけ
// - 暖色は押す場所と「いまやること」にだけ使う。見出しと番号と飾りには使わない
// - JavaScript なしでは何も隠さない。隠す指定は .js か .js-only で始める
// - スマホを基本に書き、768px で2列、1200px で3列にする

export const STYLES = String.raw`
:root {
  color-scheme: light;
  --bg: #F7F6F1;
  --card: #FFFFFF;
  --card-2: #F1EFE9;
  --line: #DCD9D1;
  --line-strong: #8E8A82;
  --ink: #1E2124;
  --ink-2: #5B6066;
  --ink-3: #6B7076;
  --accent: #8A4E22;
  --accent-ink: #FFFFFF;
  --accent-soft: #FBF1E6;
  --accent-strong: #6E3B16;
  --ok-fg: #1E6B3F;
  --ok-bg: #E4F1E7;
  --warn-fg: #7A4F00;
  --warn-bg: #FBEFD0;
  --call-fg: #FFFFFF;
  --call-bg: #1E2124;
  --ask-fg: #2D5A8A;
  --ask-bg: #E1EBF6;
  --danger-fg: #B00020;
  --danger-bg: #FBE9EC;
  --shadow-card: 0 1px 2px rgba(30, 33, 36, .06);
  --shadow-hero: 0 6px 20px rgba(138, 78, 34, .14), 0 1px 2px rgba(30, 33, 36, .06);
  --okojo-body: #FFFFFF;
  --okojo-tip: #1E2124;
  --okojo-line: #5B6066;
  --s1: 4px;
  --s2: 8px;
  --s3: 12px;
  --s4: 16px;
  --s5: 24px;
  --s6: 32px;
  --s7: 48px;
  --mono: ui-monospace, monospace;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --bg: #151718;
    --card: #1F2224;
    --card-2: #26292C;
    --line: #363A3E;
    --line-strong: #6F746B;
    --ink: #ECEAE3;
    --ink-2: #B3AFA6;
    --ink-3: #9A9690;
    --accent: #E2A66F;
    --accent-ink: #151718;
    --accent-soft: #2B2520;
    --accent-strong: #F0BE8E;
    --ok-fg: #8FD3A5;
    --ok-bg: #1C3426;
    --warn-fg: #F2C46B;
    --warn-bg: #3A2E12;
    --call-fg: #151718;
    --call-bg: #ECEAE3;
    --ask-fg: #9CC3EC;
    --ask-bg: #1C2E42;
    --danger-fg: #FF8A80;
    --danger-bg: #3A1F1F;
    --shadow-card: none;
    --shadow-hero: 0 0 0 1px var(--accent);
    --okojo-line: #B3AFA6;
  }
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --bg: #151718;
  --card: #1F2224;
  --card-2: #26292C;
  --line: #363A3E;
  --line-strong: #6F746B;
  --ink: #ECEAE3;
  --ink-2: #B3AFA6;
  --ink-3: #9A9690;
  --accent: #E2A66F;
  --accent-ink: #151718;
  --accent-soft: #2B2520;
  --accent-strong: #F0BE8E;
  --ok-fg: #8FD3A5;
  --ok-bg: #1C3426;
  --warn-fg: #F2C46B;
  --warn-bg: #3A2E12;
  --call-fg: #151718;
  --call-bg: #ECEAE3;
  --ask-fg: #9CC3EC;
  --ask-bg: #1C2E42;
  --danger-fg: #FF8A80;
  --danger-bg: #3A1F1F;
  --shadow-card: none;
  --shadow-hero: 0 0 0 1px var(--accent);
  --okojo-line: #B3AFA6;
}

* {
  box-sizing: border-box;
}

html {
  font-family: system-ui, sans-serif;
  font-size: 17px;
  line-height: 1.7;
  color: var(--ink);
  background: var(--bg);
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
  scroll-behavior: smooth;
}

@media (prefers-reduced-motion: reduce) {
  html {
    scroll-behavior: auto;
  }
  * {
    transition: none !important;
  }
}

/* 下部のタブは sticky にする。流れの中に場所を持つので、文字が大きくなっても内容に重ならない */
body {
  margin: 0;
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--ink);
  overflow-wrap: anywhere;
  /* 行末に1文字だけ残る折り返しを避ける。対応していないブラウザーでは、ふつうに折り返す */
  text-wrap: pretty;
}

main {
  flex: 1 0 auto;
  min-width: 0;
}

[id] {
  scroll-margin-top: 72px;
}

h1, h2, h3, h4, p, ul, ol, dl, dd, blockquote {
  margin: 0;
}

ul, ol {
  padding: 0;
  list-style: none;
}

h2:focus, h3:focus {
  outline: none;
}

a {
  color: var(--accent);
}

code, .num {
  font-variant-numeric: tabular-nums;
}

.tap {
  min-height: 44px;
}

/* 押す部品に共通のフォーカスと手触り */
a:focus-visible, button:focus-visible, summary:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}

.icon-defs {
  position: absolute;
  width: 0;
  height: 0;
}

.icon {
  width: 24px;
  height: 24px;
  flex: none;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* ---- JavaScript があるときだけの部品 ---- */
.js-only {
  display: none;
}

.js .js-only {
  display: inline-flex;
}

.js [hidden] {
  display: none !important;
}

.js .panel:not(.is-active) {
  display: none;
}

/* ---- 社外秘のチップと、上部 ---- */
.chip-secret {
  display: inline-flex;
  align-items: center;
  flex: none;
  padding: 2px 8px;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: .04em;
  color: var(--ink);
  border: 1.5px solid var(--ink);
  border-radius: 4px;
}

.draft-band {
  padding: var(--s2) var(--s4);
  font-size: 15px;
  font-weight: 700;
  text-align: center;
  color: var(--warn-fg);
  background: var(--warn-bg);
}

.topbar {
  min-height: 56px;
  padding: var(--s2) var(--s4);
  background: var(--card);
  border-bottom: 1px solid var(--line);
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--s2);
  line-height: 1.4;
}

.brand-company {
  font-size: 15px;
  color: var(--ink-2);
}

.brand-title {
  font-size: 15px;
  font-weight: 700;
}

.top-status {
  display: flex;
  align-items: center;
  gap: var(--s1);
  font-size: 14px;
  line-height: 1.5;
  color: var(--ink-2);
}

.top-status-text span {
  white-space: pre-wrap;
}

.top-mark {
  width: 18px;
  height: 18px;
  stroke-width: 2;
}

.topnav {
  display: none;
}

/* スマホの「はじめに」は表紙なので、上部を重ねない */
.js[data-view="intro"] .topbar {
  display: none;
}

/* ---- 後任のメモ ---- */
.js .memo {
  margin-top: var(--s4);
  padding: var(--s3);
  border: 2px dotted var(--ink-3);
  border-radius: 8px;
}

.memo-label {
  display: block;
  margin-bottom: var(--s2);
  font-size: 15px;
  font-weight: 700;
  color: var(--ink-2);
}

.memo-input {
  display: block;
  width: 100%;
  min-height: 72px;
  padding: var(--s2);
  field-sizing: content;
  resize: none;
  overflow: hidden;
  font: inherit;
  font-size: 16px;
  line-height: 1.6;
  color: var(--ink);
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 6px;
}

.memo-input::placeholder {
  color: var(--ink-3);
  opacity: 1;
}

.js .memo-print {
  display: none;
  white-space: pre-wrap;
}

.js .memo-date:empty {
  display: none;
}

.memo-date, .memo-note {
  margin-top: var(--s1);
  font-size: 14px;
  color: var(--ink-2);
}

.memo-nojs {
  margin-top: var(--s3);
  font-size: 15px;
  color: var(--ink-2);
}

.js .memo-nojs {
  display: none;
}

.top-side {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--s1) var(--s3);
  min-width: 0;
}

/* 狭い幅では、メモがあるときだけ出す。上部の高さを空のまま増やさない */
.js .btn-memo-copy {
  display: none;
  min-height: 44px;
  padding: 0 var(--s3);
  font-size: 14px;
  white-space: nowrap;
}

.js.has-memos .btn-memo-copy {
  display: inline-flex;
}

.js .memo-copy-status:empty {
  display: none;
}

.memo-copy-status {
  font-size: 14px;
}

/* ---- 下部タブ ---- */
.tabs {
  position: sticky;
  bottom: 0;
  z-index: 5;
  display: flex;
  min-height: 64px;
  padding-bottom: env(safe-area-inset-bottom);
  background: var(--card);
  border-top: 1px solid var(--line);
}

.tabs a {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-height: 64px;
  padding: var(--s1) 2px;
  color: var(--ink-2);
  text-decoration: none;
  text-align: center;
  transition: background .15s;
}

.tabs a span {
  font-size: 13px;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: .04em;
  word-break: keep-all;
}

.tabs a[aria-current] {
  color: var(--accent);
  box-shadow: inset 0 3px 0 var(--accent);
}

/* ---- 見出しと、よく使う文字 ---- */
.panel > h2 {
  font-size: 28px;
  font-weight: 700;
  line-height: 1.3;
  letter-spacing: .01em;
}

.lead {
  margin-top: var(--s2);
  font-size: 17px;
}

.note {
  margin-top: var(--s1);
  font-size: 15px;
  line-height: 1.6;
  color: var(--ink-2);
}

.empty {
  margin-top: var(--s4);
  color: var(--ink-2);
}

.label {
  font-size: 14px;
  font-weight: 700;
  line-height: 1.5;
  letter-spacing: .04em;
  color: var(--ink-2);
}

.group-title {
  margin: var(--s5) 0 var(--s2);
  font-size: 14px;
  font-weight: 700;
  line-height: 1.5;
  letter-spacing: .04em;
  color: var(--ink-2);
}

.section-title {
  margin: var(--s6) 0 var(--s3);
  font-size: 22px;
  font-weight: 700;
  line-height: 1.4;
}

.sub-title {
  margin-bottom: var(--s3);
  font-size: 18px;
  font-weight: 700;
  line-height: 1.5;
}

.text-link {
  display: inline-flex;
  align-items: center;
  font-size: 16px;
  font-weight: 700;
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
}

.tab-link {
  margin-top: var(--s4);
}

.card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 12px;
}

/* ---- 電話番号。文字のハイフンを入れず、区切りは余白で見せる ---- */
.tel {
  white-space: nowrap;
  -webkit-user-select: all;
  user-select: all;
}

.tel > span + span {
  margin-left: .3em;
}

/* 「まず誰に言うか」は3列の幅でだけ出す。同じ相手は連絡先の画面にある */
.js .pick-rail {
  display: none;
}

/* ---- 普段の言葉で探す（JavaScript があるときだけ） ---- */
.js .search-box {
  display: block;
  margin: var(--s3) 0 var(--s5);
}

.search-label {
  display: block;
  margin-bottom: var(--s2);
  font-weight: 700;
}

.search-input {
  display: block;
  width: 100%;
  min-height: 48px;
  padding: 0 var(--s3);
  font-family: inherit;
  font-size: 17px;
  color: var(--ink);
  background: var(--card);
  border: 2px solid var(--line-strong);
  border-radius: 8px;
}

.search-input:focus {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.js .search-box:not(.has-input) .search-area {
  display: none;
}

.search-status {
  margin: var(--s3) 0 var(--s2);
  font-size: 15px;
  color: var(--ink-2);
}

.search-more {
  margin: var(--s4) 0 var(--s2);
}

/* ---- 画面の枠 ---- */
.panel {
  padding: var(--s5) var(--s4) var(--s7);
}

.no-js .panel + .panel, .no-js .workspace + .panel {
  border-top: 1px solid var(--line);
}

/* ---- はじめに（8-1）。紙の表紙らしく、カードに入れず静かに置く ---- */
#intro {
  padding-top: var(--s7);
  padding-bottom: var(--s7);
}

.intro-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  min-height: 64px;
  margin-bottom: var(--s6);
}

.update-log {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
  color: var(--ink-2);
}

.update-log th,
.update-log td {
  padding: var(--s2) var(--s3) var(--s2) 0;
  border-bottom: 1px solid var(--line);
  text-align: left;
  vertical-align: top;
  overflow-wrap: anywhere;
}

.update-log th {
  font-weight: 700;
  white-space: nowrap;
}

.update-log .update-date {
  white-space: nowrap;
}

.seal {
  display: block;
  flex: none;
  color: var(--ink);
}

.intro-company {
  font-size: 17px;
  color: var(--ink-2);
}

.intro-title {
  margin-top: var(--s1);
  font-size: 34px;
  font-weight: 700;
  line-height: 1.3;
  letter-spacing: .01em;
}

.intro-role {
  margin-top: var(--s3);
  font-weight: 700;
}

.intro-date {
  margin-top: var(--s5);
  font-size: 17px;
  font-weight: 700;
}

.intro-text {
  margin-top: var(--s1);
  font-size: 17px;
}

.intro-more {
  margin-top: var(--s2);
  text-align: center;
}

.intro-label {
  margin-top: var(--s7);
  margin-bottom: var(--s3);
  padding-top: var(--s4);
  border-top: 1px solid var(--line);
}

.can-list {
  display: grid;
  gap: var(--s3);
}

.can-list li {
  display: flex;
  gap: var(--s3);
  align-items: flex-start;
}

.can-list .icon {
  margin-top: 3px;
  color: var(--ink);
}

.legend {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--s4) var(--s3);
}

.legend-text {
  display: block;
  margin-top: var(--s1);
  font-size: 15px;
  line-height: 1.5;
  color: var(--ink-2);
}

/* ---- ボタン（7-6、7-7） ---- */
.btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-weight: 700;
  text-decoration: none;
  border-radius: 12px;
  cursor: pointer;
  font-family: inherit;
  transition: transform .08s, background .15s;
}

.btn-primary {
  min-height: 56px;
  margin-top: var(--s5);
  padding: 0 var(--s4);
  font-size: 18px;
  color: var(--accent-ink);
  background: var(--accent);
}

.btn-call {
  width: 100%;
  min-height: 56px;
  padding: var(--s2) var(--s4);
  color: var(--accent-ink);
  background: var(--accent);
}

.btn-call-quiet {
  width: 100%;
  min-height: 56px;
  padding: var(--s2) var(--s3);
  color: var(--accent);
  background: transparent;
  border: 2px solid var(--accent);
}

.btn-text {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}

.btn-label {
  font-size: 16px;
  line-height: 1.2;
}

.btn .num {
  font-size: 22px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: .02em;
  -webkit-user-select: all;
  user-select: all;
}

.btn-copy {
  display: none;
  min-height: 48px;
  padding: 0 var(--s4);
  font-size: 16px;
  color: var(--accent);
  background: transparent;
  border: 2px solid var(--accent);
}

.js .btn-copy {
  display: inline-flex;
}

/* 番号のコピーは、電話を押せない PC のためのもの。スマホでは出さない */
.js .btn-copy-num {
  display: none;
}

.btn-copy.is-done {
  color: var(--ok-fg);
  background: var(--ok-bg);
  border-color: transparent;
}

.btn-reset {
  align-items: center;
  margin-top: var(--s3);
  padding: 0;
  font-family: inherit;
  font-size: 15px;
  font-weight: 700;
  color: var(--accent);
  background: none;
  border: 0;
  cursor: pointer;
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
}

.copy-status {
  font-size: 15px;
  line-height: 1.6;
  color: var(--ink-2);
}

.js .copy-status:empty {
  display: none;
}

.btn:active, .sym:active, .step label:active {
  transform: translateY(1px);
}

@media (hover: hover) {
  .btn-primary:hover, .btn-call:hover {
    background: var(--accent-strong);
  }
  .btn-copy:hover, .btn-call-quiet:hover {
    background: var(--accent-soft);
  }
  .sym:hover {
    background: var(--card-2);
  }
}

/* ---- 判定バッジ（7-2）。形は4種で完全に同じ ---- */
.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px 0 10px;
  font-size: 15px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  border-radius: 999px;
}

.badge .icon {
  width: 16px;
  height: 16px;
  stroke-width: 2.2;
}

.badge[data-badge="self"] {
  color: var(--ok-fg);
  background: var(--ok-bg);
}

.badge[data-badge="check_first"] {
  color: var(--warn-fg);
  background: var(--warn-bg);
}

.badge[data-badge="vendor"] {
  color: var(--call-fg);
  background: var(--call-bg);
}

.badge[data-badge="internal"] {
  color: var(--ask-fg);
  background: var(--ask-bg);
}

.eta {
  font-size: 15px;
  font-weight: 400;
  line-height: 1.6;
  color: var(--ink-2);
}

/* ---- 症状カード（7-1） ---- */
.jump {
  display: flex;
  gap: var(--s4);
  margin-top: var(--s3);
  overflow-x: auto;
  white-space: nowrap;
  scrollbar-width: none;
}

.jump a {
  display: inline-flex;
  align-items: center;
  flex: none;
  font-size: 15px;
  font-weight: 700;
  text-underline-offset: 3px;
}

.sym-group {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 12px;
  overflow: hidden;
}

.sym-group-last {
  margin-top: var(--s5);
}

.sym-group li + li {
  border-top: 1px solid var(--line);
}

.sym {
  display: grid;
  grid-template-columns: 1fr 24px;
  gap: 8px 12px;
  align-items: center;
  min-height: 72px;
  padding: var(--s4);
  color: var(--ink);
  text-decoration: none;
  transition: transform .08s, background .15s;
}

.sym:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: -3px;
}

.sym-title {
  grid-column: 1;
  font-size: 18px;
  font-weight: 700;
  line-height: 1.5;
  word-break: auto-phrase;
}

.sym-meta {
  grid-column: 1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s1) var(--s3);
}

.chev {
  grid-column: 2;
  grid-row: 1 / span 2;
  color: var(--ink-3);
}

/* 2列以上で中央の列に出す案内。スマホでは一覧の冒頭に同じ文がある */
.js .pick-prompt {
  display: none;
}

/* ---- 手順ページ ---- */
.back {
  display: inline-flex;
  align-items: center;
  gap: var(--s1);
  font-size: 16px;
  font-weight: 700;
  text-decoration: none;
  margin-left: -6px;
}

.symptom-title {
  margin-top: var(--s2);
  font-size: 26px;
  font-weight: 700;
  line-height: 1.35;
  letter-spacing: .01em;
  word-break: auto-phrase;
}

.verdict {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s2) var(--s3);
  margin-top: var(--s3);
}

.verdict-text {
  margin-top: var(--s3);
}

/* 手順ページの部と部のあいだ */
.band-safe + .first, .band-safe + .part, .band-safe + .page-notes {
  margin-top: var(--s5);
}

.first + .page-notes, .first + .part {
  margin-top: var(--s6);
}

.page-notes, .part, .info-block, .terms-block, .tab-link {
  margin-top: var(--s6);
}

/* 帯（7-9） */
.band {
  display: flex;
  gap: 10px;
  margin-top: var(--s3);
  padding: 12px 16px;
  font-size: 16px;
  line-height: 1.65;
  border-radius: 8px;
}

.band .icon {
  width: 20px;
  height: 20px;
  margin-top: 3px;
}

.band-safe {
  color: var(--ink);
  background: var(--card-2);
}

.band-branch {
  color: var(--warn-fg);
  background: var(--warn-bg);
}

.band-exception {
  color: var(--danger-fg);
  background: var(--danger-bg);
}

/* まずこれだけ（7-4）。ページ内で唯一の暖色の枠と影 */
.first {
  padding: 20px;
  background: var(--card);
  border: 2px solid var(--accent);
  border-radius: 12px;
  box-shadow: var(--shadow-hero);
}

.first-kicker {
  font-size: 15px;
  font-weight: 700;
  line-height: 1.5;
  color: var(--accent);
}

.first-steps {
  display: grid;
  gap: var(--s3);
  margin-top: var(--s2);
  counter-reset: first-step;
}

.first-body {
  font-size: 19px;
  font-weight: 500;
  line-height: 1.7;
  word-break: auto-phrase;
}

.first-steps.is-many .first-body {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  gap: var(--s2);
}

.first-steps.is-many .first-body::before {
  counter-increment: first-step;
  content: counter(first-step);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin-top: 5px;
  font-size: 14px;
  font-weight: 700;
  line-height: 1;
  border: 2px solid var(--ink);
  border-radius: 50%;
}

.step-figure {
  display: block;
  width: 100%;
  max-width: 320px;
  height: auto;
  margin-top: var(--s2);
  color: var(--ink);
  break-inside: avoid;
}

kbd {
  display: inline-block;
  padding: 0 8px;
  font: inherit;
  font-size: 17px;
  line-height: 1.5;
  background: var(--card-2);
  border: 1px solid var(--line-strong);
  border-bottom-width: 2px;
  border-radius: 6px;
}

.goal {
  display: flex;
  gap: 8px;
  margin-top: var(--s4);
  padding: 12px 16px;
  font-weight: 700;
  color: var(--ok-fg);
  background: var(--ok-bg);
  border-radius: 8px;
  box-shadow: inset 4px 0 0 var(--ok-fg);
}

.goal .icon {
  width: 20px;
  height: 20px;
  margin-top: 4px;
  stroke-width: 2.4;
}

/* 説明（notes） */
.page-notes li {
  position: relative;
  padding-left: var(--s4);
}

.page-notes li + li {
  margin-top: var(--s2);
}

.page-notes li::before {
  content: "";
  position: absolute;
  top: .72em;
  left: 2px;
  width: 6px;
  height: 6px;
  background: var(--ink-3);
  border-radius: 50%;
}

.page-notes.is-main ul {
  padding: var(--s4);
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 12px;
}

/* ①②③ の見出し */
.part-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0 var(--s3);
}

.part-title {
  font-size: 22px;
  font-weight: 700;
  line-height: 1.4;
}

.part-contact > .part-title {
  margin-bottom: var(--s3);
}

.progress {
  font-size: 15px;
  line-height: 1.6;
  color: var(--ink-2);
}

.count-live {
  display: none;
}

.js .count-static {
  display: none;
}

.js .count-live {
  display: inline;
}

.steps-note {
  margin: var(--s2) 0 var(--s3);
  font-size: 15px;
  line-height: 1.6;
  color: var(--ink-2);
}

.part-head + .band {
  margin-top: var(--s3);
}

/* 手順カード（7-3） */
.steps {
  list-style: none;
  padding: 0;
  display: grid;
  gap: var(--s2);
}

.step {
  overflow: hidden;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 12px;
}

.step label {
  position: relative;
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) 28px;
  gap: 12px;
  align-items: start;
  min-height: 64px;
  padding: 16px;
  cursor: pointer;
  transition: transform .08s;
}

/* 本物のチェック欄を、見た目の枠にぴったり重ねる */
.step input {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 28px;
  height: 28px;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}

.step-n {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 32px;
  height: 32px;
  font-size: 15px;
  font-weight: 700;
  line-height: 1;
  color: var(--ink);
  border: 2px solid var(--ink);
  border-radius: 50%;
}

.step-body {
  grid-column: 2;
  font-size: 17px;
  font-weight: 400;
  line-height: 1.7;
}

.step-body.is-short {
  word-break: auto-phrase;
}

.step-box {
  grid-column: 3;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: var(--card);
  border: 2px solid var(--line-strong);
  border-radius: 6px;
  transition: background .15s;
}

.step-box .icon {
  width: 20px;
  height: 20px;
  stroke-width: 3;
  color: var(--card);
  opacity: 0;
}

.step input:checked ~ .step-box {
  background: var(--ok-fg);
  border-color: var(--ok-fg);
}

.step input:checked ~ .step-box .icon {
  opacity: 1;
}

.step input:focus-visible ~ .step-box {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}

.step:has(input:checked) .step-body {
  color: var(--ink-3);
}

.step:has(input:checked) .step-n {
  color: var(--ink-3);
  border-color: var(--ink-3);
}

/* いまここ。JavaScript があるときだけ */
.step.is-current {
  background: var(--accent-soft);
  box-shadow: inset 4px 0 0 var(--accent);
}

.step-now {
  grid-column: 1 / -1;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.3;
  color: var(--accent);
}

/* 「いまここ」の行のぶん、チェック欄も下がる */
.step.is-current input {
  top: 46px;
}

.step-note {
  padding: 0 16px 12px 60px;
  font-size: 15px;
  line-height: 1.6;
  color: var(--ink-2);
}

.step-terms {
  display: flex;
  flex-wrap: wrap;
  gap: 0 var(--s4);
  padding: 0 16px 6px 60px;
}

.step-terms a {
  display: inline-flex;
  align-items: center;
  font-size: 15px;
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
}

/* 連絡先カード（7-5） */
.contact-box {
  display: flex;
  flex-direction: column;
  gap: var(--s3);
  padding: 20px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 12px;
}

.contact-name {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: baseline;
  gap: 0 var(--s3);
  font-size: 20px;
  font-weight: 700;
  line-height: 1.5;
}

.contact-role {
  font-size: 14px;
  font-weight: 400;
  color: var(--ink-2);
}

.call-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s2);
}

.call-row .btn-call {
  flex: 1 1 240px;
  width: auto;
}

.call-row .btn-copy-num {
  flex: none;
  align-self: center;
}

.phone-text {
  font-weight: 700;
}

.contact-hours {
  display: flex;
  gap: var(--s2);
  align-items: flex-start;
}

.contact-hours .icon {
  width: 20px;
  height: 20px;
  margin-top: 4px;
  color: var(--ink-2);
}

.facts {
  display: grid;
  grid-template-columns: 5em minmax(0, 1fr);
  gap: var(--s2) var(--s2);
  align-items: baseline;
}

.facts dt {
  font-size: 15px;
  color: var(--ink-2);
}

.say-label {
  margin-bottom: calc(var(--s2) * -1);
  font-size: 15px;
  line-height: 1.6;
  color: var(--ink-2);
}

.say {
  padding: 12px 16px;
  background: var(--card-2);
  border-left: 4px solid var(--line-strong);
  border-radius: 0 8px 8px 0;
  -webkit-user-select: all;
  user-select: all;
}

.contact-box > .btn-copy, .reply-box > .btn-copy {
  width: 100%;
}

.reply-box {
  margin-top: var(--s4);
}

.reply-box .btn-copy {
  margin-top: var(--s2);
}

.reply {
  white-space: pre-line;
}

.note + .terms {
  margin-top: var(--s2);
}

/* 会社の情報の表。狭い幅では行を積む */
.info-card {
  padding: var(--s1) var(--s4);
}

.info-table {
  display: block;
  width: 100%;
  border-collapse: collapse;
}

.info-table thead {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}

.info-table tbody {
  display: block;
}

.info-table tr {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  gap: 2px var(--s2);
  align-items: center;
  padding: var(--s3) 0;
  border-top: 1px solid var(--line);
}

.info-table tbody tr:first-child {
  border-top: 0;
}

.info-table td {
  display: block;
  padding: 0;
}

.info-table .info-drive {
  grid-column: 1;
  grid-row: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  font-size: 18px;
  font-weight: 700;
  line-height: 1;
  color: var(--ink);
  background: var(--card-2);
  border-radius: 6px;
}

.info-drives .info-target {
  grid-column: 2;
  grid-row: 1;
  font-size: 15px;
  line-height: 1.5;
  color: var(--ink-2);
}

.info-drives .info-path {
  grid-column: 1 / -1;
}

.info-values tr {
  grid-template-columns: minmax(0, 1fr);
}

.info-values .info-target {
  font-size: 15px;
  line-height: 1.5;
  color: var(--ink-2);
}

/* 語の途中で折り返さない。入らない長さの語だけ、はみ出さないよう最後の手段で折り返す */
.nb {
  white-space: nowrap;
}

code.path,
.info-target {
  word-break: keep-all;
}

code.path {
  display: inline-block;
  padding: 1px 6px;
  font-family: var(--mono);
  font-size: 16px;
  font-weight: 500;
  line-height: 1.5;
  color: var(--ink);
  background: var(--card-2);
  border-radius: 6px;
  -webkit-user-select: all;
  user-select: all;
}

/* 用語（7-8） */
.terms {
  overflow: hidden;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 12px;
}

.terms details + details {
  border-top: 1px solid var(--line);
}

details.term summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s2);
  min-height: 48px;
  padding: var(--s2) var(--s4);
  font-weight: 700;
  line-height: 1.5;
  list-style: none;
  cursor: pointer;
  transition: background .15s;
}

details.term summary::-webkit-details-marker {
  width: 0;
  height: 0;
  margin: 0;
  opacity: 0;
}

details.term > dl,
details.term > p {
  padding: 0 var(--s4) var(--s4);
}

/* plain-words.md の §7。段の見出しを本文の上に積む */
.term-rows dt {
  margin-top: var(--s3);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: .04em;
  color: var(--ink-2);
}

.term-rows dt:first-child {
  margin-top: 0;
}

.term-rows dd {
  margin: 0;
  font-size: 17px;
}

details.term > p {
  color: var(--ink-2);
}

details.term:target {
  box-shadow: inset 0 0 0 2px var(--accent);
  border-color: var(--accent);
}

.plus {
  width: 20px;
  height: 20px;
  color: var(--ink-2);
}

details[open] .plus-v {
  opacity: 0;
}

/* カードの余白と左端をそろえ、カードの底に置く */
.contact-more {
  margin: auto -20px -20px;
  border-top: 1px solid var(--line);
}

.contact-more summary, .contact-more > p {
  padding-left: 20px;
  padding-right: 20px;
}

/* 確認の印と、もとにした情報 */
.evidence {
  display: flex;
  gap: var(--s3);
  align-items: flex-start;
  margin-top: var(--s6);
  padding-top: var(--s4);
  border-top: 1px solid var(--line);
}

.evidence p {
  font-size: 14px;
  line-height: 1.6;
  color: var(--ink-3);
}

.evidence span {
  display: block;
}

.evidence + .back {
  margin-top: var(--s4);
}

/* 右の列は、3列の幅でだけ出す */
.rail {
  display: none;
}

/* ---- 連絡先 ---- */
.contact-grid {
  display: grid;
  gap: var(--s4);
}

/* ---- 毎月やること ---- */
.toc {
  display: flex;
  gap: var(--s4);
  margin-top: var(--s2);
}

.toc a {
  display: inline-flex;
  align-items: center;
  font-size: 16px;
  font-weight: 700;
  text-underline-offset: 3px;
}

.routine-cards {
  display: grid;
  gap: var(--s3);
}

.card.routine {
  overflow: hidden;
}

.routine-title {
  font-size: 18px;
  font-weight: 700;
  line-height: 1.5;
}

.card.routine > .routine-title {
  padding: var(--s4) var(--s4) var(--s3);
}

.routine-steps {
  border-top: 1px solid var(--line);
}

.routine-list {
  display: grid;
  gap: var(--s3);
  padding: 0 var(--s4) var(--s4);
}

.routine-list li {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  gap: var(--s3);
}

.timeline {
  margin-top: var(--s3);
  border-left: 2px solid var(--line-strong);
}

.routine-year {
  display: grid;
  grid-template-columns: 3.5em minmax(0, 1fr);
  gap: var(--s3);
  padding: var(--s2) 0 var(--s2) var(--s3);
}

.routine-month {
  font-size: 18px;
  font-weight: 700;
  line-height: 1.5;
  font-variant-numeric: tabular-nums;
}

.routine-main .routine-steps {
  margin-top: var(--s2);
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 12px;
}

/* ---- 会社のIT ---- */
.device-grid {
  display: grid;
  gap: var(--s3);
}

.device {
  padding: var(--s4);
}

.device-name {
  margin-bottom: var(--s3);
  font-size: 18px;
  font-weight: 700;
  line-height: 1.5;
}

/* ---- フッター（8-3） ---- */
.site-footer {
  padding: var(--s6) var(--s4);
  font-size: 14px;
  line-height: 1.6;
  color: var(--ink-3);
  border-top: 1px solid var(--line);
}

.site-footer p {
  display: flex;
  align-items: flex-start;
  gap: var(--s2);
}

.okojo {
  flex: none;
  margin-top: 3px;
}

.okojo-body {
  fill: var(--okojo-body);
  stroke: var(--okojo-line);
  stroke-width: 1.2;
  stroke-linejoin: round;
}

.okojo-tip {
  fill: var(--okojo-tip);
  stroke: var(--okojo-line);
  stroke-width: 1.2;
  stroke-linejoin: round;
}

.theme-switch {
  flex-wrap: wrap;
  align-items: center;
  gap: 0 var(--s1);
  margin-top: var(--s2);
}

.theme-switch button {
  padding: 0 var(--s2);
  font-family: inherit;
  font-size: 14px;
  color: var(--accent);
  background: none;
  border: 0;
  cursor: pointer;
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
}

.theme-switch button[aria-pressed="true"] {
  font-weight: 700;
  color: var(--ink);
  text-decoration: none;
}

/* JavaScript なしで開いた症状の目印。:target は強調にだけ使い、何も隠さない */
.no-js .symptom {
  border-top: 1px solid var(--line);
}

.no-js .symptom:target {
  box-shadow: inset 4px 0 0 var(--accent);
}

.no-js .symptom:target .symptom-title {
  color: var(--accent);
}

.about-link {
  align-items: center;
}

/* ---- 2列（768px 以上）。上部バーとナビを出し、下部タブを消す ---- */
@media (min-width: 768px) {
  .tabs {
    display: none;
  }

  .topbar {
    position: sticky;
    top: 0;
    z-index: 5;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    grid-template-rows: 64px;
    align-items: center;
    gap: var(--s3);
    height: 64px;
    padding: 0 var(--s5);
  }

  .js[data-view="intro"] .topbar {
    display: grid;
  }

  /* 表紙に同じものがあるので、上部にはナビだけを残す */
  .js[data-view="intro"] .brand, .js[data-view="intro"] .top-status {
    visibility: hidden;
  }

  .brand-names {
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: 1.3;
  }

  .brand-company {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .brand {
    min-width: 0;
  }

  .brand-title {
    overflow: hidden;
    font-size: 17px;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .topnav {
    display: flex;
    height: 100%;
    justify-content: center;
  }

  .topnav a {
    display: flex;
    align-items: center;
    padding: 0 var(--s2);
    font-size: 16px;
    color: var(--ink);
    text-decoration: none;
    white-space: nowrap;
    transition: background .15s;
  }

  .topnav a[aria-current] {
    font-weight: 700;
    color: var(--accent);
    box-shadow: inset 0 -2px 0 var(--accent);
  }

  .js .btn-memo-copy {
    display: inline-flex;
  }

  /* 幅が足りなければ2行にし、それでも長い名前は省略して、バーの高さを守る */
  .top-status {
    justify-content: flex-end;
    gap: var(--s2);
    min-width: 0;
    max-width: 150px;
    line-height: 1.3;
  }

  .top-status-text {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0 var(--s2);
    min-width: 0;
    text-align: right;
  }

  .top-status-text span {
    max-width: 100%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .top-mark {
    width: 24px;
    height: 24px;
    stroke-width: 1.6;
    color: var(--ink);
  }

  .panel > h2 {
    font-size: 32px;
  }

  .panel {
    padding: var(--s6) var(--s5) var(--s7);
  }

  /* はじめに：1枚の紙のように中央に置く */
  #intro {
    max-width: 760px;
    margin: 0 auto;
    padding-top: var(--s7);
  }

  .intro-title {
    font-size: 44px;
  }

  .intro-more {
    text-align: left;
  }

  #intro .btn-primary {
    display: inline-flex;
    min-width: 280px;
  }

  .legend {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  /* 一覧と本文 */
  .workspace {
    display: grid;
    grid-template-columns: 320px minmax(0, 1fr);
    column-gap: var(--s5);
    align-items: start;
    padding-right: var(--s5);
  }

  .js:not([data-view="help"]):not([data-view="symptom"]) .workspace {
    display: none;
  }

  .js[data-view="symptom"] #tab-help {
    display: block;
  }

  .col-list {
    position: sticky;
    top: 64px;
    width: 320px;
    max-height: calc(100vh - 64px);
    padding: var(--s5) var(--s3) var(--s5) var(--s5);
    overflow-y: auto;
    border-right: 1px solid var(--line);
  }

  /* 選ぶ前は本文が短いので、一覧を切らずに全部見せる */
  .js[data-view="help"] .col-list {
    max-height: none;
  }

  #tab-help > h2 {
    font-size: 22px;
  }

  .js .col-list .lead, .js .col-list .note, .js .jump {
    display: none;
  }

  .col-list .group-title {
    margin: var(--s4) 0 var(--s1);
  }

  .col-list .sym-group, .col-list .sym-group-last {
    background: transparent;
    border: 0;
    border-radius: 0;
    overflow: visible;
  }

  .col-list .sym-group li + li {
    border-top: 0;
  }

  .col-list .sym-group-last {
    margin-top: var(--s4);
    padding-top: var(--s3);
    border-top: 1px solid var(--line);
  }

  .col-list .sym {
    position: relative;
    grid-template-columns: 24px minmax(0, 1fr);
    gap: 10px;
    min-height: 44px;
    margin-left: -12px;
    padding: 10px 12px;
    border-radius: 8px;
  }

  .col-list .sym-title {
    grid-column: 2;
    grid-row: 1;
    font-size: 16px;
    font-weight: 500;
    line-height: 1.45;
  }

  .col-list .sym-meta {
    grid-column: 1;
    grid-row: 1;
    display: block;
    align-self: start;
    height: 24px;
  }

  /* 一覧のバッジは、色とアイコンだけに縮める。文字は title と読み上げで分かる */
  .col-list .badge {
    display: flex;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    position: relative;
  }

  .col-list .badge .icon {
    width: 14px;
    height: 14px;
  }

  .col-list .badge-text, .col-list .eta {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .col-list .chev {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
  }

  .col-list .sym[aria-current] {
    background: var(--accent-soft);
    box-shadow: inset 3px 0 0 var(--accent);
    color: var(--ink);
  }

  .col-main {
    min-width: 0;
    padding: var(--s6) 0 var(--s7);
  }

  .symptom {
    padding: 0;
  }

  .no-js .symptom {
    padding-top: var(--s6);
    margin-bottom: var(--s6);
  }

  .js .back {
    display: none;
  }

  .js .symptom-title {
    margin-top: 0;
  }

  .symptom-title {
    font-size: 30px;
  }

  .first {
    padding: 24px;
  }

  .device {
    padding: 20px;
  }

  .js[data-view="help"] .pick-prompt {
    display: block;
    padding-top: var(--s5);
    padding-bottom: var(--s7);
  }

  .pick-note {
    margin-top: var(--s2);
  }

  .pick-label {
    margin: var(--s5) 0 var(--s3);
  }

  .pick-prompt .group-title {
    margin: var(--s5) 0 var(--s2);
  }

  .pick-lead {
    font-size: 22px;
    font-weight: 700;
    line-height: 1.5;
    word-break: auto-phrase;
  }

  .pick-note {
    font-size: 15px;
    line-height: 1.6;
    color: var(--ink-2);
  }

  /* 連絡先：社内の相談先と業者を、2列のカードに */
  .contact-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .js .btn-copy-num {
    display: inline-flex;
  }

  .contact-box > .btn-copy {
    width: auto;
    min-width: 200px;
    align-self: flex-start;
  }

  .site-footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0 var(--s5);
    padding: var(--s4) var(--s5);
  }

  .theme-switch {
    margin-top: 0;
  }

  .screen {
    max-width: 1120px;
    margin: 0 auto;
    width: 100%;
  }

  /* 毎月やること：左に目次 */
  .routines-layout {
    display: grid;
    grid-template-columns: 148px minmax(0, 1fr);
    column-gap: var(--s6);
    align-items: start;
    margin-top: var(--s4);
  }

  .toc {
    position: sticky;
    top: 80px;
    flex-direction: column;
    gap: 0;
    margin-top: 0;
    padding-top: var(--s2);
  }

  .routines-main > .section-title:first-child {
    margin-top: 0;
  }

  /* 会社のIT：機器を2列に */
  .device-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .company-jump {
    margin-top: var(--s2);
  }
}

/* ---- 1024px 以上。本文に十分な幅があるので、上部のナビを中央に置き、表をふつうの表にする ---- */
@media (min-width: 1024px) {
  .topbar {
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  }

  .topnav a {
    padding: 0 var(--s3);
  }

  .top-status {
    max-width: none;
  }

  .symptom-body .info-table {
    display: table;
  }

  .symptom-body .info-table thead {
    position: static;
    display: table-header-group;
    width: auto;
    height: auto;
    overflow: visible;
    clip-path: none;
  }

  .symptom-body .info-table tbody {
    display: table-row-group;
  }

  .symptom-body .info-table tr {
    display: table-row;
    border-top: 0;
  }

  .symptom-body .info-table th, .symptom-body .info-table td {
    display: table-cell;
    padding: 10px var(--s3) 10px 0;
    vertical-align: middle;
    border-top: 1px solid var(--line);
    text-align: left;
  }

  .symptom-body .info-table th {
    font-size: 14px;
    font-weight: 700;
    letter-spacing: .04em;
    color: var(--ink-2);
    border-top: 0;
  }

  .symptom-body .info-drive {
    width: auto;
    height: auto;
    background: transparent;
  }
}

/* ---- 3列（1200px 以上）。右の列を出し、本文は最大 680px ---- */
@media (min-width: 1200px) {
  /* 一覧は左端に、右の列は右端に置き、上部バーの両端とそろえる */
  .workspace {
    max-width: 1440px;
    margin: 0 auto;
  }

  .col-main {
    width: calc(100% - 324px);
    max-width: 680px;
    margin-left: max(0px, calc(100% - 1004px));
  }

  /* 手順ページの枠を、右の列のぶんだけ本文の列の外へ広げる */
  .symptom {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
    column-gap: var(--s5);
    width: calc(100% + 324px);
    align-items: start;
  }

  .rail {
    display: grid;
    gap: var(--s4);
    position: sticky;
    top: 88px;
    width: 300px;
    max-height: calc(100vh - 88px);
    overflow-y: auto;
  }

  .rail-block {
    display: grid;
    gap: var(--s2);
    padding: var(--s4);
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 12px;
  }

  .rail-name {
    font-size: 18px;
    font-weight: 700;
    line-height: 1.5;
  }

  .rail-hours {
    font-size: 15px;
    line-height: 1.6;
    color: var(--ink-2);
  }

  .rail .btn-copy {
    width: 100%;
  }

  /* 開いた直後：右の列に「まず誰に言うか」を置く。手順ページの右の列と同じ幅と位置 */
  .js[data-view="help"] .pick-prompt {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
    column-gap: var(--s5);
    width: calc(100% + 324px);
    align-items: start;
  }

  .pick-main {
    grid-column: 1;
    grid-row: 1;
    min-width: 0;
  }

  .js .pick-rail {
    display: block;
    grid-column: 2;
    grid-row: 1;
    position: sticky;
    top: 88px;
    width: 300px;
  }

  .company-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 360px;
    column-gap: var(--s6);
    align-items: start;
  }

  .company-terms {
    position: sticky;
    top: 80px;
    max-height: calc(100vh - 96px);
    overflow-y: auto;
  }

  .js .company-jump {
    display: none;
  }
}

/* ---- 印刷（第9章）。全文を出し、背景色に頼らない ---- */
@media print {
  :root {
    --bg: #FFFFFF !important;
    --card: #FFFFFF !important;
    --card-2: #FFFFFF !important;
    --line: #808080 !important;
    --ink: #000000 !important;
    --ink-2: #000000 !important;
    --ink-3: #000000 !important;
    --accent: #000000 !important;
    --accent-ink: #000000 !important;
    --accent-soft: #FFFFFF !important;
    --ok-fg: #000000 !important;
    --ok-bg: #FFFFFF !important;
    --warn-fg: #000000 !important;
    --warn-bg: #FFFFFF !important;
    --call-fg: #000000 !important;
    --call-bg: #FFFFFF !important;
    --ask-fg: #000000 !important;
    --ask-bg: #FFFFFF !important;
    --danger-fg: #000000 !important;
    --danger-bg: #FFFFFF !important;
    --shadow-hero: none !important;
  }

  html {
    font-size: 12pt;
    scroll-behavior: auto;
  }

  body {
    display: block;
  }

  .memo-input, .memo-note, .memo-nojs, .memo.is-empty {
    display: none !important;
  }

  .js .memo-print {
    display: block;
  }

  .tabs, .topnav, .topbar, .rail, button, .btn-copy, .back, .jump, .toc, .theme-switch, .js-only, .progress, .steps-note, .tab-link, .intro-more, .btn-primary {
    display: none !important;
  }

  /* はじめには文書の最後に置くが、紙では表紙なので先頭に戻す */
  main {
    display: flex;
    flex-direction: column;
  }

  #intro {
    order: -1;
  }

  .panel, .js .panel:not(.is-active), .workspace, .js:not([data-view="help"]):not([data-view="symptom"]) .workspace, .col-main {
    display: block !important;
    max-width: none;
    margin: 0;
    padding: 0;
    width: auto;
    border: 0;
  }

  .col-list {
    position: static;
    width: auto;
    max-height: none;
    overflow: visible;
    border: 0;
  }

  .symptom, .js .symptom {
    display: block;
    width: auto;
    break-before: page;
  }

  #tab-help, #tab-contacts, #tab-routines, #tab-company {
    break-before: page;
  }

  .badge {
    color: var(--ink);
    background: none;
    border: 1px solid var(--ink);
  }

  /* 紙では「いまここ」に意味がない。チェック欄はペンで使えるので残す */
  .step-now {
    display: none;
  }

  .step.is-current {
    background: none;
    box-shadow: none;
  }

  .step.is-current input {
    top: 16px;
  }

  /* 一覧のバッジは、縮めずに文字まで出す */
  .col-list .sym {
    display: block;
    min-height: 0;
    margin: 0;
    padding: 4pt 0;
  }

  .col-list .sym-meta {
    display: inline-block;
    height: auto;
    margin-left: 8pt;
  }

  .col-list .badge {
    display: inline-flex;
    width: auto;
    height: 24px;
    padding: 0 8px;
  }

  .col-list .badge-text {
    position: static;
    width: auto;
    height: auto;
    overflow: visible;
    clip-path: none;
  }

  .btn-call {
    justify-content: flex-start;
    padding: 0;
    color: var(--ink);
    background: none;
  }

  .btn-label {
    font-size: 12pt;
  }

  details > * {
    display: block;
  }

  summary::marker {
    content: "";
  }

  .plus {
    opacity: 0;
  }

  .step, .contact-box, .first, .card, .band, .goal, .terms {
    break-inside: avoid;
    box-shadow: none;
  }

  .first, .band, .goal, .say, .step {
    border: 1px solid var(--ink);
  }

  a {
    color: var(--ink);
    text-decoration: none;
  }

  a[href^="tel:"]::after {
    content: "";
  }
}
`.trim();
