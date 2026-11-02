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

  // 次にする手順（上から見て最初の未チェック）に印を付け、進み具合を文字で示す
  function refreshSteps(panel) {
    const items = all('.steps > li', panel);
    if (!items.length) return;
    let next = null;
    let done = 0;
    for (const item of items) {
      item.classList.remove('is-next');
      if (item.querySelector('input[data-check]').checked) done += 1;
      else if (!next) next = item;
    }
    if (next) next.classList.add('is-next');
    const progress = panel.querySelector('.progress');
    if (progress) progress.textContent = next ? '終わった手順：' + done + ' / ' + items.length : 'すべて終わりました';
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

  // ---- タブ ----
  // 画面の切り替えはアドレスの # に合わせる。戻る操作がそのまま使える
  const panels = all('.panel');
  const tabs = all('nav a');
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

  function showPanel(moved) {
    const target = currentTarget();
    const panel = (target && target.closest('.panel')) || panels[0];
    for (const each of panels) each.classList.toggle('is-active', each === panel);
    const tabHref = '#' + (panel.getAttribute('data-tab') || panel.id);
    for (const tab of tabs) {
      if (tab.getAttribute('href') === tabHref) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    }
    // 画面の途中の見出しへ移るリンクは、その見出しまで動かす
    if (target && target !== panel) {
      target.scrollIntoView();
      if (moved && target.focus) target.focus({ preventScroll: true });
      return;
    }
    if (!moved) return;
    const heading = panel.querySelector('h2');
    if (heading) heading.focus({ preventScroll: true });
    const back = panel.id === 'tab-help' && helpScroll !== null;
    window.scrollTo(0, back ? helpScroll : 0);
    if (back) helpScroll = null;
  }

  for (const link of all('a[href^="#symptom-"]')) {
    link.addEventListener('click', () => {
      helpScroll = window.scrollY;
    });
  }

  setUpChecks();
  setUpCopy();
  setUpDetails();
  showPanel(false);
  window.addEventListener('hashchange', () => showPanel(true));
  root.classList.add('js');
})();
`.trim();
