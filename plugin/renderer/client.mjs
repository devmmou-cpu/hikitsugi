// 取扱説明書の HTML に埋め込むプログラム。入力のデータを含まない固定の文字列にして、
// 文面が script の中に入らないようにする（コピーする文面は画面の要素から読む）。
//
// 2つに分ける。
// - CLIENT_HEAD_SCRIPT：最初の描画の前に js のクラスとテーマを付ける。画面がちらつかないようにするため
// - CLIENT_SCRIPT：本文のあとで動く。準備がすべて終わったら data-ready を付ける
// 本文のプログラムが途中で失敗した環境では、data-ready が付かないので、
// CLIENT_HEAD_SCRIPT が no-js に戻す。JavaScript なしと同じ全文表示のまま読める。

export const CLIENT_HEAD_SCRIPT = String.raw`
(function () {
  var root = document.documentElement;
  root.classList.replace('no-js', 'js');
  try {
    var theme = window.localStorage.getItem('hikitsugi-theme');
    if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  } catch (error) {
    // 保存を読めない環境では、OS の設定に従う
  }
  document.addEventListener('DOMContentLoaded', function () {
    if (!root.hasAttribute('data-ready')) root.classList.replace('js', 'no-js');
  });
})();
`.trim();

export const CLIENT_SCRIPT = String.raw`
(function () {
  'use strict';

  const root = document.documentElement;
  const all = (selector, base) => Array.from((base || document).querySelectorAll(selector));

  // ---- チェックの保存。保存できない環境では、開いている間だけ覚える ----
  const storageKey = 'hikitsugi-checks:' + (root.getAttribute('data-company') || '');

  function loadChecks() {
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey));
      return saved && typeof saved === 'object' ? saved : {};
    } catch (error) {
      return {};
    }
  }

  function saveChecks(checks) {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(checks));
    } catch (error) {
      // 保存できなくても、画面の操作は続けられる
    }
  }

  const checks = loadChecks();

  // 次にする手順（上から見て最初の未チェック）に「いまここ」を付け、進み具合を文字で示す
  function refreshSteps(panel) {
    const items = all('.steps > li', panel);
    if (!items.length) return;
    let next = null;
    let done = 0;
    for (const item of items) {
      item.classList.remove('is-current');
      for (const label of all('.step-now', item)) label.remove();
      if (item.querySelector('input[data-check]').checked) done += 1;
      else if (!next) next = item;
    }
    if (next) {
      next.classList.add('is-current');
      const label = document.createElement('span');
      label.className = 'step-now';
      label.textContent = 'いまここ';
      next.querySelector('label').prepend(label);
    }
    const live = panel.querySelector('.count-live');
    if (live) live.textContent = next ? '終わった手順 ' + done + ' / ' + items.length : 'すべて終わりました';
    const reset = panel.querySelector('button[data-reset]');
    if (reset) reset.hidden = done === 0;
  }

  function setUpChecks() {
    for (const box of all('input[data-check]')) {
      const key = box.getAttribute('data-check');
      box.checked = checks[key] === true;
      box.addEventListener('change', () => {
        checks[key] = box.checked;
        saveChecks(checks);
        refreshSteps(box.closest('.panel'));
      });
    }
    for (const button of all('button[data-reset]')) {
      button.addEventListener('click', () => {
        const panel = button.closest('.panel');
        for (const box of all('input[data-check]', panel)) {
          box.checked = false;
          checks[box.getAttribute('data-check')] = false;
        }
        saveChecks(checks);
        refreshSteps(panel);
      });
    }
    for (const panel of all('.panel')) refreshSteps(panel);
  }

  // ---- コピー ----
  function selectText(element) {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return selection;
  }

  // 新しい方法が使えない環境のための、古い方法。失敗しても文面は選択したまま残す
  function copyBySelection(element) {
    if (!element) return false;
    try {
      const selection = selectText(element);
      const copied = document.execCommand('copy');
      if (copied) selection.removeAllRanges();
      return copied;
    } catch (error) {
      return false;
    }
  }

  function copyText(text, element) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(
        () => true,
        () => copyBySelection(element),
      );
    }
    return Promise.resolve(copyBySelection(element));
  }

  function setUpCopy() {
    for (const button of all('button[data-copy], button[data-copy-text]')) {
      const label = button.textContent;
      const id = button.getAttribute('data-copy');
      const message = id ? document.getElementById(id) : null;
      const status = document.getElementById(button.getAttribute('data-status'));
      let timer = null;
      button.addEventListener('click', () => {
        const text = message ? message.textContent : button.getAttribute('data-copy-text');
        copyText(text, message).then((copied) => {
          clearTimeout(timer);
          button.classList.toggle('is-done', copied);
          button.textContent = copied ? 'コピーしました' : label;
          status.textContent = copied ? 'メールやチャットに貼り付けて送れます。' : '自動でコピーできませんでした。文面を長く押して、コピーしてください。';
          if (!copied) return;
          timer = setTimeout(() => {
            button.classList.remove('is-done');
            button.textContent = label;
            status.textContent = '';
          }, 2000);
        });
      });
    }
  }

  // ---- 開閉 ----
  // HTML では開いておき（JavaScript なしで全文を読むため）、ここで閉じる。印刷のときだけ全部開く
  function setUpDetails() {
    const details = all('details');
    let openBeforePrint = [];
    for (const each of details) each.open = false;
    window.addEventListener('beforeprint', () => {
      openBeforePrint = details.filter((each) => each.open);
      for (const each of details) each.open = true;
    });
    window.addEventListener('afterprint', () => {
      for (const each of details) each.open = openBeforePrint.includes(each);
    });
  }

  // ---- 表示の切り替え（テーマ） ----
  function setUpTheme() {
    const buttons = all('button[data-theme-set]');
    const mark = (value) => {
      for (const button of buttons) button.setAttribute('aria-pressed', String(button.getAttribute('data-theme-set') === value));
    };
    mark(root.getAttribute('data-theme') || 'auto');
    for (const button of buttons) {
      button.addEventListener('click', () => {
        const value = button.getAttribute('data-theme-set');
        if (value === 'auto') root.removeAttribute('data-theme');
        else root.setAttribute('data-theme', value);
        try {
          if (value === 'auto') window.localStorage.removeItem('hikitsugi-theme');
          else window.localStorage.setItem('hikitsugi-theme', value);
        } catch (error) {
          // 保存できなくても、開いている間は切り替わる
        }
        mark(value);
      });
    }
  }

  // ---- 画面 ----
  // 画面の切り替えはアドレスの # に合わせる。戻る操作がそのまま使える
  const panels = all('.panel');
  const tabs = all('nav.topnav a, nav.tabs a');
  const symptoms = all('a.sym[href^="#symptom-"]');
  // 手順ページから一覧へ戻ったとき、押した症状の位置に戻すための控え
  let helpScroll = null;

  function currentTarget() {
    let id = window.location.hash.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch (error) {
      id = '';
    }
    return id ? document.getElementById(id) : null;
  }

  function viewOf(panel) {
    if (panel.id === 'intro') return 'intro';
    if (panel.id === 'tab-help') return 'help';
    if (panel.hasAttribute('data-tab')) return 'symptom';
    return panel.id.replace('tab-', '');
  }

  function scrollNow(top) {
    window.scrollTo({ top: top, left: 0, behavior: 'instant' });
  }

  function showPanel(moved) {
    const target = currentTarget();
    const panel = (target && target.closest('.panel')) || panels[0];
    for (const each of panels) each.classList.toggle('is-active', each === panel);
    root.setAttribute('data-view', viewOf(panel));
    const tabHref = '#' + (panel.getAttribute('data-tab') || panel.id);
    for (const tab of tabs) {
      if (tab.getAttribute('href') === tabHref) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    }
    // 2列以上の幅で、いま開いている症状を一覧に示す
    const symptomHref = '#' + panel.id;
    for (const link of symptoms) {
      if (link.getAttribute('href') === symptomHref) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    }
    // 画面の途中の用語や見出しへ移るリンクは、そこまで動かす
    if (target && target !== panel) {
      if (target.tagName === 'DETAILS') target.open = true;
      target.scrollIntoView();
      if (moved && target.focus) target.focus({ preventScroll: true });
      return;
    }
    if (!moved) return;
    const heading = panel.querySelector('h2');
    if (heading) heading.focus({ preventScroll: true });
    const back = panel.id === 'tab-help' && helpScroll !== null;
    scrollNow(back ? helpScroll : 0);
    if (back) helpScroll = null;
  }

  for (const link of symptoms) {
    link.addEventListener('click', () => {
      helpScroll = window.scrollY;
    });
  }

  setUpChecks();
  setUpCopy();
  setUpDetails();
  setUpTheme();
  showPanel(false);
  window.addEventListener('hashchange', () => showPanel(true));
  root.setAttribute('data-ready', '');
})();
`.trim();
