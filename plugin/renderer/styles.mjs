// 取扱説明書の HTML に埋め込む CSS。
// - 文字は印刷用を除いて 16px 以上。大きさは rem で指定する
// - 色はすべて変数で定義し、ライトとダークを切り替える（コントラスト比は報告書を参照）
// - JavaScript なしでは何も隠さない。隠す指定は html.js か .js-only で始める

export const STYLES = String.raw`
:root {
  color-scheme: light dark;
  --bg: #f6f4ef;
  --surface: #ffffff;
  --text: #23282b;
  --muted: #4f5a5e;
  --line: #d9d6ce;
  --control-line: #6f7a7e;
  --accent: #1f5f6b;
  --accent-text: #ffffff;
  --accent-soft: #e3eff0;
  --reassure-bg: #e8f1ea;
  --reassure-line: #2f6b45;
  --self-bg: #e4f1e6;
  --self-text: #1c5a2c;
  --check-bg: #fbeecd;
  --check-text: #6a4a00;
  --vendor-bg: #fae5e1;
  --vendor-text: #8a2a1c;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #15191b;
    --surface: #1f2528;
    --text: #edf0ef;
    --muted: #b7c0c2;
    --line: #3a4347;
    --control-line: #8f9a9e;
    --accent: #8fd0da;
    --accent-text: #10282d;
    --accent-soft: #21363a;
    --reassure-bg: #1d3226;
    --reassure-line: #8fd3a6;
    --self-bg: #1f3a27;
    --self-text: #b6e6c1;
    --check-bg: #40330f;
    --check-text: #f5d98c;
    --vendor-bg: #47221c;
    --vendor-text: #f8c1b6;
  }
}

* {
  box-sizing: border-box;
}

html {
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
  scroll-padding-bottom: 5rem;
}

/* 下部のタブは sticky にする。流れの中に場所を持つので、文字が大きくなっても内容に重ならない */
body {
  margin: 0;
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--text);
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
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}

h2[tabindex]:focus {
  outline: none;
}

p {
  margin: 0 0 0.75rem;
}

h1,
h2,
h3,
h4 {
  line-height: 1.4;
  margin: 0;
}

.masthead {
  padding: 0.75rem 1rem 0.5rem;
  width: 100%;
  max-width: 40rem;
  margin-inline: auto;
}

.masthead p {
  margin: 0;
  color: var(--muted);
}

.masthead h1 {
  font-size: 1.125rem;
}

.confidential strong {
  display: inline-block;
  padding: 0 0.5em;
  margin-right: 0.5em;
  border: 2px solid currentColor;
  border-radius: 0.25rem;
  color: var(--text);
}

main {
  flex: 1;
  width: 100%;
  max-width: 40rem;
  margin-inline: auto;
  padding: 0.5rem 1rem 1.5rem;
}

.panel + .panel {
  margin-top: 2rem;
  padding-top: 1.5rem;
  border-top: 2px solid var(--line);
}

.panel h2 {
  font-size: 1.5rem;
  margin-bottom: 0.5rem;
}

.panel h3 {
  font-size: 1.1875rem;
  margin: 1.5rem 0 0.5rem;
}

.panel h4 {
  font-size: 1.0625rem;
  margin: 1.25rem 0 0.5rem;
}

.lead {
  font-size: 1.125rem;
}

.empty {
  padding: 1rem;
  background: var(--surface);
  border: 1px dashed var(--control-line);
  border-radius: 0.75rem;
}

/* 症状の一覧 */
.symptoms {
  list-style: none;
  margin: 0;
  padding: 0;
}

.symptoms li + li {
  margin-top: 0.75rem;
}

.symptom-link {
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  background: var(--surface);
  border: 1px solid var(--control-line);
  border-radius: 0.75rem;
  color: var(--text);
  text-decoration: none;
}

.symptom-link::after {
  content: "\203A";
  font-size: 1.5rem;
  line-height: 1;
  color: var(--accent);
}

.symptom-name {
  display: block;
  font-weight: 700;
  margin-bottom: 0.25rem;
}

/* 判定バッジ。色のほかに、文字、形、印で区別する */
.badge {
  display: inline-flex;
  align-items: center;
  gap: 0.35em;
  padding: 0.1em 0.6em;
  border: 2px solid currentColor;
  font-weight: 700;
  line-height: 1.5;
}

.badge[data-badge="self"] {
  border-radius: 999px;
  background: var(--self-bg);
  color: var(--self-text);
}

.badge[data-badge="self"]::before {
  content: "\2713";
}

.badge[data-badge="check_first"] {
  border-radius: 0.25rem;
  background: var(--check-bg);
  color: var(--check-text);
}

.badge[data-badge="check_first"]::before {
  content: "!";
}

.badge[data-badge="vendor"] {
  border-style: double;
  border-width: 4px;
  border-radius: 0;
  background: var(--vendor-bg);
  color: var(--vendor-text);
}

.badge[data-badge="vendor"]::before {
  content: "\260E\FE0E";
}

/* 手順ページ */
.back {
  color: var(--accent);
  font-weight: 600;
  text-decoration: none;
}

.verdict {
  margin: 0.75rem 0 0.5rem;
}

.time {
  color: var(--muted);
  font-weight: 600;
}

.reassure {
  padding: 0.75rem 1rem;
  background: var(--reassure-bg);
  border-left: 6px solid var(--reassure-line);
  border-radius: 0.25rem;
  font-weight: 600;
}

.steps {
  margin: 0;
  padding-left: 1.75rem;
}

.steps > li {
  margin-bottom: 0.75rem;
}

.steps > li::marker {
  color: var(--accent);
  font-weight: 700;
}

.step {
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.75rem;
  background: var(--surface);
  border: 1px solid var(--control-line);
  border-radius: 0.75rem;
}

.step input {
  flex: none;
  width: 28px;
  height: 28px;
  margin: 0;
  accent-color: var(--accent);
}

.step input:checked + span {
  color: var(--muted);
}

/* 用語の開閉。印は標準の三角をそのまま使う */
.term > summary {
  display: list-item;
  padding-block: 0.65rem;
  color: var(--accent);
  font-weight: 600;
}

.term > p {
  margin: 0 0 0.5rem;
  padding: 0.5rem 0.75rem;
  background: var(--accent-soft);
  border-radius: 0.5rem;
}

/* 直らなかったら */
.contact-box {
  padding: 1rem;
  background: var(--surface);
  border: 1px solid var(--control-line);
  border-radius: 0.75rem;
}

.contact-name {
  font-weight: 700;
  font-size: 1.125rem;
  margin-bottom: 0.5rem;
}

.contact-box p:last-child,
.contact-box dd:last-child {
  margin-bottom: 0;
}

.call {
  justify-content: center;
  margin-bottom: 0.75rem;
  padding: 0.5rem 1rem;
  background: var(--accent);
  border-radius: 0.75rem;
  color: var(--accent-text);
  font-weight: 700;
  text-align: center;
  text-decoration: none;
}

.message {
  margin-bottom: 0.75rem;
  padding: 0.75rem 1rem;
  background: var(--surface);
  border: 1px solid var(--control-line);
  border-radius: 0.5rem;
  white-space: pre-wrap;
}

/* ボタン */
.button {
  width: 100%;
  justify-content: center;
  padding: 0.5rem 1rem;
  background: var(--surface);
  border: 2px solid var(--accent);
  border-radius: 0.75rem;
  color: var(--accent);
  font-family: inherit;
  font-size: 1rem;
  font-weight: 700;
}

.button.is-done {
  background: var(--accent);
  color: var(--accent-text);
}

.button-quiet {
  border-color: var(--control-line);
  color: var(--text);
  font-weight: 400;
}

.copy-status:not(:empty) {
  margin-top: 0.5rem;
}

.evidence {
  margin-top: 1.5rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--line);
  color: var(--muted);
}

/* 連絡先のカード */
.card dt {
  margin-top: 0.75rem;
  color: var(--muted);
  font-weight: 700;
}

.card dd {
  margin: 0;
}

.card dl {
  margin: 0;
}

.terms .term {
  border-bottom: 1px solid var(--line);
}

/* 下部のタブ */
.tabs {
  position: sticky;
  bottom: 0;
  z-index: 1;
  display: flex;
  background: var(--surface);
  border-top: 1px solid var(--control-line);
  padding-bottom: env(safe-area-inset-bottom);
}

.tab {
  flex: 1 1 auto;
  justify-content: center;
  padding: 0.25rem 0.125rem;
  border-top: 4px solid transparent;
  color: var(--muted);
  font-size: 1rem;
  line-height: 1.3;
  text-align: center;
  text-decoration: none;
}

.tab[aria-current="page"] {
  background: var(--accent-soft);
  border-top-color: var(--accent);
  color: var(--text);
  font-weight: 700;
}

/* JavaScript がないと動かない部品は、最初は隠す */
.js-only {
  display: none;
}

html.js .js-only {
  display: flex;
}

html.js .copy-status {
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
    color: #000 !important;
  }

  body {
    display: block;
    min-height: 0;
    font-size: 11pt;
  }

  .tabs,
  .back,
  .js-only,
  html.js .js-only {
    display: none !important;
  }

  html.js .panel:not(.is-active) {
    display: block;
  }

  html.js .panel + .panel,
  .panel + .panel {
    margin-top: 1.5rem;
    padding-top: 1rem;
    border-top: 1px solid #000;
  }

  .step,
  .contact-box,
  .message,
  .symptom-link,
  .empty {
    border-color: #000;
  }

  .reassure {
    border-left-color: #000;
  }

  .tap {
    min-height: 0;
  }

  h2,
  h3,
  h4 {
    break-after: avoid;
  }

  .step,
  .message,
  .contact-box {
    break-inside: avoid;
  }

  /* 閉じた用語も印刷する。対応していない環境では、プログラムが印刷の直前に開く */
  details::details-content {
    display: block;
    content-visibility: visible;
  }
}
`.trim();
