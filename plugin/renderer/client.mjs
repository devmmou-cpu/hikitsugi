// 取扱説明書の HTML に埋め込むプログラム。入力のデータを含まない固定の文字列にして、
// 文面が script の中に入らないようにする（コピーする文面は画面の要素から読む）。
//
// html に js のクラスを付けるのは、準備がすべて終わった最後にする。
// 途中で失敗した環境では、JavaScript なしと同じ全文表示のまま読める。

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

  function setUpChecks() {
    for (const box of all('input[data-check]')) {
      const key = box.getAttribute('data-check');
      box.checked = checks[key] === true;
      box.addEventListener('change', () => {
        checks[key] = box.checked;
        saveChecks(checks);
      });
    }
    for (const button of all('button[data-reset]')) {
      button.addEventListener('click', () => {
        for (const box of all('input[data-check]', button.closest('.panel'))) {
          box.checked = false;
          checks[box.getAttribute('data-check')] = false;
        }
        saveChecks(checks);
      });
    }
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
    try {
      const selection = selectText(element);
      const copied = document.execCommand('copy');
      if (copied) selection.removeAllRanges();
      return copied;
    } catch (error) {
      return false;
    }
  }

  function copyText(element) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(element.textContent).then(
        () => true,
        () => copyBySelection(element),
      );
    }
    return Promise.resolve(copyBySelection(element));
  }

  function setUpCopy() {
    for (const button of all('button[data-copy]')) {
      const label = button.textContent;
      const message = document.getElementById(button.getAttribute('data-copy'));
      const status = document.getElementById(button.getAttribute('data-status'));
      let timer = null;
      button.addEventListener('click', () => {
        copyText(message).then((copied) => {
          clearTimeout(timer);
          button.classList.toggle('is-done', copied);
          button.textContent = copied ? '✓ コピーしました' : label;
          status.textContent = copied
            ? 'メールやチャットに貼り付けて送れます。'
            : '自動でコピーできませんでした。文面を長く押して、コピーしてください。';
          if (!copied) return;
          timer = setTimeout(() => {
            button.classList.remove('is-done');
            button.textContent = label;
            status.textContent = '';
          }, 4000);
        });
      });
    }
  }

  // ---- 用語の開閉 ----
  // HTML では開いておき（JavaScript なしで全文を読むため）、ここで閉じる。印刷のときだけ全部開く
  function setUpTerms() {
    const terms = all('details');
    let openBeforePrint = [];
    for (const term of terms) term.open = false;
    window.addEventListener('beforeprint', () => {
      openBeforePrint = terms.filter((term) => term.open);
      for (const term of terms) term.open = true;
    });
    window.addEventListener('afterprint', () => {
      for (const term of terms) term.open = openBeforePrint.includes(term);
    });
  }

  // ---- タブ ----
  // 画面の切り替えはアドレスの # に合わせる。戻る操作がそのまま使える
  const panels = all('.panel');
  const tabs = all('nav a');

  function currentPanel() {
    let id = window.location.hash.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch (error) {
      id = '';
    }
    const target = id ? document.getElementById(id) : null;
    return (target && target.closest('.panel')) || panels[0];
  }

  function showPanel(moveFocus) {
    const panel = currentPanel();
    for (const each of panels) each.classList.toggle('is-active', each === panel);
    const tabHref = '#' + (panel.getAttribute('data-tab') || panel.id);
    for (const tab of tabs) {
      if (tab.getAttribute('href') === tabHref) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    }
    if (!moveFocus) return;
    const heading = panel.querySelector('h2');
    if (heading) heading.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  setUpChecks();
  setUpCopy();
  setUpTerms();
  showPanel(false);
  window.addEventListener('hashchange', () => showPanel(true));
  root.classList.add('js');
})();
`.trim();
