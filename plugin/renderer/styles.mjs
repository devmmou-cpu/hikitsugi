// 取扱説明書の HTML に埋め込む CSS。
// - 文字は印刷用を除いて 16px 以上。大きさは rem で指定する
// - 色の値は変数の定義の中にだけ書く。ライトとダークは同じ変数を定義し直す
// - 余白、角、線の太さも変数にそろえる
// - JavaScript なしでは何も隠さない。隠す指定は html.js か .js-only で始める

export const STYLES = String.raw`
:root {
  color-scheme: light dark;
  --color-bg: #fbfaf8;
  --color-surface: #ffffff;
  --color-text: #2b2a28;
  --color-muted: #5f5a54;
  --color-line: #e6e2dc;
  --color-control: #8f8981;
  --color-accent: #8e5127;
  --color-on-accent: #ffffff;
  --color-accent-soft: #f6ede4;
  --color-self-bg: #e9f2ec;
  --color-self-text: #2c5c44;
  --color-check-bg: #fbf1d9;
  --color-check-text: #6e4e00;
  --color-vendor-bg: #2b2a28;
  --color-vendor-text: #ffffff;
  --color-internal-bg: #e7edf2;
  --color-internal-text: #2f4a5f;
  --color-print: #000000;
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.5rem;
  --space-6: 2rem;
  --radius: 0.75rem;
  --radius-small: 0.375rem;
  --line: 1px;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-bg: #1b1a18;
    --color-surface: #252320;
    --color-text: #ece9e4;
    --color-muted: #b8b2a9;
    --color-line: #3b3834;
    --color-control: #8a847b;
    --color-accent: #dba675;
    --color-on-accent: #2a1c10;
    --color-accent-soft: #352a20;
    --color-self-bg: #21322a;
    --color-self-text: #add8bf;
    --color-check-bg: #3b3019;
    --color-check-text: #eccb82;
    --color-vendor-bg: #ece9e4;
    --color-vendor-text: #22211f;
    --color-internal-bg: #25303a;
    --color-internal-text: #b4cde0;
  }
}

* {
  box-sizing: border-box;
}

html {
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
  scroll-padding-top: var(--space-4);
  scroll-padding-bottom: 5rem;
}

/* 下部のタブは sticky にする。流れの中に場所を持つので、文字が大きくなっても内容に重ならない */
body {
  margin: 0;
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: system-ui, sans-serif;
  font-size: 1.0625rem;
  line-height: 1.7;
  overflow-wrap: anywhere;
}

/* 押す部品の共通の大きさ */
.tap {
  display: flex;
  align-items: center;
  min-height: 48px;
  touch-action: manipulation;
  cursor: pointer;
}

:focus-visible {
  outline: 3px solid var(--color-accent);
  outline-offset: 2px;
}

h2[tabindex]:focus,
h3[tabindex]:focus {
  outline: none;
}

p {
  margin: 0 0 var(--space-3);
}

h1,
h2,
h3,
h4 {
  line-height: 1.4;
  margin: 0;
  font-feature-settings: "palt";
}

.icon {
  flex: none;
  width: 1.25em;
  height: 1.25em;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* 冒頭の帯 */
.masthead {
  width: 100%;
  max-width: 40rem;
  margin-inline: auto;
  padding: var(--space-4) var(--space-4) var(--space-3);
  border-bottom: var(--line) solid var(--color-line);
}

.masthead p {
  margin: 0;
  color: var(--color-muted);
  font-size: 1rem;
  line-height: 1.5;
}

.masthead h1 {
  font-size: 1.125rem;
}

.confidential strong {
  display: inline-block;
  padding: 0 var(--space-2);
  margin-right: var(--space-2);
  border: var(--line) solid var(--color-text);
  border-radius: var(--radius-small);
  color: var(--color-text);
  font-weight: 700;
}

main {
  flex: 1;
  width: 100%;
  max-width: 40rem;
  margin-inline: auto;
  padding: var(--space-4) var(--space-4) var(--space-6);
}

.panel + .panel {
  margin-top: var(--space-6);
  padding-top: var(--space-5);
  border-top: var(--line) solid var(--color-control);
}

.panel h2 {
  font-size: 1.5rem;
  margin-bottom: var(--space-2);
}

.panel h3 {
  font-size: 1.1875rem;
  margin: var(--space-5) 0 var(--space-2);
}

.panel h4 {
  font-size: 1.0625rem;
  margin: var(--space-4) 0 var(--space-2);
}

.lead {
  font-size: 1.125rem;
  margin-bottom: var(--space-1);
}

.note {
  color: var(--color-muted);
  font-size: 1rem;
}

.empty {
  padding: var(--space-4);
  background: var(--color-surface);
  border: var(--line) dashed var(--color-control);
  border-radius: var(--radius);
}

.card {
  padding: var(--space-4);
  background: var(--color-surface);
  border: var(--line) solid var(--color-line);
  border-radius: var(--radius);
}

.card + .card {
  margin-top: var(--space-3);
}

/* 症状の一覧。カテゴリごとに1枚のカードにまとめ、線を減らす */
.symptoms {
  list-style: none;
  margin: 0;
  padding: 0;
  background: var(--color-surface);
  border: var(--line) solid var(--color-line);
  border-radius: var(--radius);
}

.symptoms li + li {
  border-top: var(--line) solid var(--color-line);
}

.symptom-link {
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius);
  color: var(--color-text);
  text-decoration: none;
}

.symptom-link:focus-visible {
  outline-offset: -3px;
}

.symptom-link > .icon {
  color: var(--color-muted);
}

.symptom-name {
  display: block;
  font-weight: 700;
  margin-bottom: var(--space-1);
}

/* 短い文は、文節の切れ目で折り返す。対応していない環境では普通に折り返す */
.symptom-name,
.lead,
.note,
.verdict-text,
.reassure,
.step-text.is-short,
.panel h2,
.panel h4 {
  word-break: auto-phrase;
  text-wrap: pretty;
}

/* 長い文は文節で切るとかえって行がばらつくので、最後の行が短くなりすぎないようにだけする */
.step-text,
.facts dd,
.term > p {
  text-wrap: pretty;
}

/* 判定バッジ。色のほかに、文字、形、印で区別する */
.badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 0 var(--space-2);
  font-size: 1rem;
  font-weight: 700;
  line-height: 1.75;
}

.badge[data-badge="self"] {
  border-radius: 999px;
  background: var(--color-self-bg);
  color: var(--color-self-text);
}

.badge[data-badge="check_first"] {
  border-radius: var(--radius-small);
  background: var(--color-check-bg);
  color: var(--color-check-text);
}

.badge[data-badge="vendor"] {
  border-radius: 0;
  background: var(--color-vendor-bg);
  color: var(--color-vendor-text);
}

.badge[data-badge="internal"] {
  border-radius: var(--radius-small);
  background: var(--color-internal-bg);
  color: var(--color-internal-text);
}

/* 手順ページ */
.back {
  gap: var(--space-1);
  color: var(--color-muted);
  font-weight: 600;
  text-decoration: none;
}

.verdict {
  margin-top: var(--space-3);
}

.verdict-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2) var(--space-3);
  margin-bottom: var(--space-3);
}

.verdict-text {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 700;
  line-height: 1.6;
}

.time {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  margin: 0;
  color: var(--color-muted);
  font-size: 1rem;
}

.reassure {
  margin: var(--space-3) 0 0;
  padding: var(--space-3) var(--space-4);
  background: var(--color-accent-soft);
  border-radius: var(--radius);
}

/* 手順の前の説明欄。手順と違って番号もチェック欄も付けない */
.page-notes {
  margin: 0;
  padding: 0;
  list-style: none;
}

.page-notes li {
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--color-line);
}

.page-notes li:last-child {
  border-bottom: 0;
}

.drive-box {
  padding: 0;
}

.drive-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 1rem;
}

.drive-table th,
.drive-table td {
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--color-line);
  text-align: left;
  vertical-align: top;
}

.drive-table tr:last-child td {
  border-bottom: 0;
}

.drive-table th {
  color: var(--color-muted);
  font-weight: 700;
  white-space: nowrap;
}

.drive-letter {
  font-weight: 700;
}

.drive-table .path {
  overflow-wrap: anywhere;
}

.drive-target {
  display: block;
  margin-top: var(--space-1);
  color: var(--color-muted);
}

.steps-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0 var(--space-3);
}

.progress {
  color: var(--color-muted);
  font-size: 1rem;
}

.steps {
  list-style: none;
  margin: 0;
  padding: 0;
}

.steps > li {
  margin-bottom: var(--space-2);
  background: var(--color-surface);
  border: var(--line) solid var(--color-line);
  border-radius: var(--radius);
}

.step {
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-3);
}

.step-number {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 50%;
  background: var(--color-accent);
  color: var(--color-on-accent);
  font-size: 1rem;
  font-weight: 700;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.step-text {
  flex: 1;
  min-width: 0;
}

/* チェック欄は読み上げの順では先頭、見た目では右端（親指の届く側）に置く */
.step input {
  order: 3;
  flex: none;
  appearance: none;
  -webkit-appearance: none;
  position: relative;
  width: 28px;
  height: 28px;
  margin: 0;
  background: var(--color-bg);
  border: 2px solid var(--color-control);
  border-radius: var(--radius-small);
  cursor: pointer;
}

.step input:checked {
  background: var(--color-accent);
  border-color: var(--color-accent);
}

.step input:checked::after {
  content: "";
  position: absolute;
  left: 8px;
  top: 3px;
  width: 8px;
  height: 14px;
  border-right: 3px solid var(--color-on-accent);
  border-bottom: 3px solid var(--color-on-accent);
  transform: rotate(45deg);
}

.step input:checked ~ .step-text {
  color: var(--color-muted);
}

.step input:checked ~ .step-number {
  background: var(--color-line);
  color: var(--color-muted);
}

/* 次にする手順。線の色に加えて、文字でも示す */
html.js .steps > li.is-next {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 var(--line) var(--color-accent);
}

html.js .is-next .step-text::before {
  content: "次はこれ";
  display: block;
  color: var(--color-accent);
  font-size: 1rem;
  font-weight: 700;
}

/* 接続先。行に収まらなければ、値ごと次の行へ送る。行より長ければ折り返す */
.path {
  display: inline-block;
  max-width: 100%;
  padding: 0 var(--space-1);
  background: var(--color-accent-soft);
  border-radius: var(--radius-small);
  font-weight: 600;
}

/* 用語の開閉 */
summary {
  list-style: none;
}

html.js summary::-webkit-details-marker {
  display: none;
}

.term > summary,
.routine-steps > summary {
  justify-content: space-between;
  gap: var(--space-3);
  font-size: 1rem;
  font-weight: 600;
}

.term > summary {
  padding: var(--space-1) var(--space-3);
  color: var(--color-muted);
}

.term > summary::after,
.routine-steps > summary::after {
  content: "";
  flex: none;
  width: 0.5rem;
  height: 0.5rem;
  margin-right: var(--space-1);
  border-right: 2px solid currentColor;
  border-bottom: 2px solid currentColor;
  transform: rotate(45deg);
}

.term[open] > summary::after,
.routine-steps[open] > summary::after {
  transform: rotate(-135deg);
}

.term > p {
  margin: 0;
  padding: 0 var(--space-3) var(--space-3);
}

/* 手順の下の用語は、手順の文の左端にそろえて横に並べる。次の手順が遠くならないように */
.step-terms {
  display: flex;
  flex-wrap: wrap;
  column-gap: var(--space-4);
  padding: 0 var(--space-3) 0 calc(var(--space-3) * 2 + 1.75rem);
  border-top: var(--line) solid var(--color-line);
}

.step-terms .term > summary {
  padding: var(--space-1) 0;
  text-decoration: underline dotted;
  text-underline-offset: 0.25em;
}

.step-terms .term > summary::after {
  content: none;
}

.step-terms .term[open] {
  flex-basis: 100%;
}

.step-terms .term > p {
  padding: 0 0 var(--space-3);
}

.terms {
  background: var(--color-surface);
  border: var(--line) solid var(--color-line);
  border-radius: var(--radius);
}

.terms .term + .term {
  border-top: var(--line) solid var(--color-line);
}

/* 連絡先 */
.contact-name {
  font-size: 1.125rem;
  font-weight: 700;
  line-height: 1.4;
  margin: 0 0 var(--space-3);
}

.panel h3.contact-name {
  font-size: 1.125rem;
  margin: 0 0 var(--space-3);
}

.card p:last-child,
.card dd:last-child {
  margin-bottom: 0;
}

.call {
  justify-content: center;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
  padding: var(--space-2) var(--space-4);
  background: var(--color-accent);
  border-radius: var(--radius);
  color: var(--color-on-accent);
  font-weight: 700;
  text-align: center;
  text-decoration: none;
}

.message {
  margin-bottom: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: var(--color-surface);
  border: var(--line) solid var(--color-line);
  border-radius: var(--radius);
  white-space: pre-wrap;
}

/* ボタン */
.button {
  width: 100%;
  justify-content: center;
  padding: var(--space-2) var(--space-4);
  background: transparent;
  border: var(--line) solid var(--color-accent);
  border-radius: var(--radius);
  color: var(--color-accent);
  font-family: inherit;
  font-size: 1rem;
  font-weight: 700;
  text-decoration: none;
}

.button.is-done {
  background: var(--color-accent);
  color: var(--color-on-accent);
}

.button-quiet {
  border-color: var(--color-control);
  color: var(--color-text);
  font-weight: 400;
}

/* めったに使わない操作なので、枠を付けずに控えめに見せる */
.reset {
  width: 100%;
  justify-content: center;
  padding: var(--space-2) var(--space-4);
  background: transparent;
  border: 0;
  color: var(--color-muted);
  font-family: inherit;
  font-size: 1rem;
  text-decoration: underline;
  text-underline-offset: 0.25em;
}

.copy-status:not(:empty) {
  margin-top: var(--space-2);
}

.evidence {
  margin: var(--space-5) 0 0;
  padding-top: var(--space-3);
  border-top: var(--line) solid var(--color-line);
  color: var(--color-muted);
  font-size: 1rem;
}

.evidence span {
  display: block;
}

/* 項目と内容の組。連絡先と機器で共通 */
.facts {
  margin: 0;
}

.facts dt {
  margin-top: var(--space-3);
  color: var(--color-muted);
  font-size: 1rem;
  font-weight: 700;
}

.facts dt:first-child {
  margin-top: 0;
}

.facts dd {
  margin: 0;
}

/* 毎月やること */
.routine-month {
  margin: 0 0 var(--space-1);
  color: var(--color-muted);
  font-size: 1rem;
  font-weight: 700;
}

.panel .routine-title {
  margin: 0;
}

.routine-steps {
  margin: var(--space-2) calc(var(--space-4) * -1) calc(var(--space-4) * -1);
  border-top: var(--line) solid var(--color-line);
}

.routine-steps > summary {
  padding: var(--space-1) var(--space-4);
  color: var(--color-muted);
}

.routine-list {
  list-style: none;
  margin: 0;
  padding: var(--space-1) var(--space-4) var(--space-4);
}

.routine-list > li {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
}

.routine-list > li + li {
  margin-top: var(--space-3);
}

.tab-link {
  margin-top: var(--space-5);
}

/* 機器の一覧 */
.panel .device-name {
  margin: 0 0 var(--space-3);
}

/* 下部のタブ */
.tabs {
  position: sticky;
  bottom: 0;
  z-index: 1;
  display: flex;
  background: var(--color-surface);
  border-top: var(--line) solid var(--color-line);
  padding-bottom: env(safe-area-inset-bottom);
}

.tab {
  flex: 1 1 auto;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  padding: var(--space-2) 2px var(--space-1);
  color: var(--color-muted);
  font-size: 1rem;
  font-feature-settings: "palt";
  line-height: 1.3;
  text-align: center;
  text-decoration: none;
  word-break: keep-all;
  overflow-wrap: normal;
}

.tab:focus-visible {
  outline-offset: -3px;
}

.tab[aria-current="page"] {
  color: var(--color-accent);
  font-weight: 700;
  box-shadow: inset 0 3px 0 var(--color-accent);
}

/* JavaScript がないと動かない部品は、最初は隠す */
.js-only {
  display: none;
}

html.js .js-only {
  display: flex;
}

html.js .copy-status,
html.js .progress {
  display: block;
}

/* JavaScript があるときは、タブごとに1画面を表示する */
html.js .panel:not(.is-active) {
  display: none;
}

html.js .panel + .panel {
  margin-top: 0;
  padding-top: 0;
  border-top: 0;
}

@media print {
  :root {
    color-scheme: light;
  }

  * {
    background: transparent !important;
    color: var(--color-print) !important;
    box-shadow: none !important;
  }

  body {
    display: block;
    min-height: 0;
    font-size: 11pt;
  }

  .tabs,
  .back,
  .tab-link,
  button,
  .js-only,
  html.js .js-only,
  html.js .is-next .step-text::before {
    display: none !important;
  }

  html.js .panel:not(.is-active) {
    display: block;
  }

  html.js .panel + .panel,
  .panel + .panel {
    margin-top: 1.5rem;
    padding-top: 1rem;
    border-top: var(--line) solid var(--color-print);
  }

  .card,
  .symptoms,
  .terms,
  .message,
  .empty,
  .steps > li,
  html.js .steps > li.is-next,
  .step input,
  .badge {
    border: var(--line) solid var(--color-print);
  }

  .step-number {
    border: var(--line) solid var(--color-print);
  }

  .step input:checked::after {
    border-color: var(--color-print);
  }

  .tap {
    min-height: 0;
  }

  h2,
  h3,
  h4 {
    break-after: avoid;
  }

  .steps > li,
  .message,
  .card {
    break-inside: avoid;
  }

  /* 閉じた用語も印刷する。対応していない環境では、プログラムが印刷の直前に開く */
  details::details-content {
    display: block;
    content-visibility: visible;
  }
}
`.trim();
