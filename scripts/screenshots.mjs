#!/usr/bin/env node
// 取扱説明書の HTML を、iPhone の幅（375px）、2列の幅（1024px）、3列の幅（1440px）で全画面撮影する。見た目の確認用。
// 依存なし。インストール済みの Chrome を、Node 標準の WebSocket で操作する。外部へは通信しない。
//
// 使い方：node scripts/screenshots.mjs <入力.html> <出力フォルダ>
//         node scripts/screenshots.mjs <スマホ向けの束のフォルダ> <出力フォルダ>（JavaScript なしで全ファイルを撮る）
//         どちらも --baseline <前回の出力フォルダ> を付けると、前回と画素で比べ、変わった画像の名前を表示する（comparison.json）。
//         差分は問題とは数えない。意図した変更でも出るので、名前を見て判断する
// 環境変数 CHROME_PATH で Chrome の場所を変えられる。
// 終了コード：0＝成功、1＝画面の検査で問題あり（理由を表示）、2＝引数の誤りや Chrome の起動失敗
//
// 撮るもの：<出力フォルダ>/<phone|tablet|pc>/<light|dark>-<画面>.png。はじめに、各タブ、各手順ページ。
// ほかに nojs-all.png（JavaScript なしの全文）、nojs-target.png（症状を開いたときの強調）、print.pdf（印刷の見え方）。
// あわせて実際の画面で、横のはみ出し、文字の大きさ、コントラスト、押す部品の高さ、手順の配置、列の幅、
// 仕様（docs/design/visual-spec.md）の値を測る。一覧は scripts/visual-spec-checks.mjs にある。

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compareAndReport } from './compare-shots.mjs';
import { CHECKS, COLOR_CHECKS, VIEWPORTS } from './visual-spec-checks.mjs';
import { phoneFileProblems } from '../plugin/renderer/phone.mjs';

// 操作の図の検査。LIB-013 の文面が ① にあるページにだけ3枚あり、見えていて、枠の中に収まり、暖色の印と赤い×の色が正しいこと
const FIGURE_PART_TEXT = JSON.parse(readFileSync(new URL('../plugin/library/procedures.json', import.meta.url), 'utf8')).procedures.find((part) => part.id === 'LIB-013').text;
const figureCheck = (rootExpression) => `JSON.stringify((() => {
  const root = ${rootExpression};
  const firsts = [...root.querySelectorAll('.first-body')];
  const expected = firsts.some((el) => el.textContent.includes(${JSON.stringify(FIGURE_PART_TEXT)})) ? 3 : 0;
  const figures = [...root.querySelectorAll('.step-figure')];
  const resolved = (name) => {
    const probe = document.createElement('div');
    probe.style.color = 'var(' + name + ')';
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  };
  const shown = (el) => { const box = el.getBoundingClientRect(); return getComputedStyle(el).display !== 'none' && box.width >= 200 && box.height > 0; };
  const inside = (el) => { const box = el.getBoundingClientRect(); const outer = el.closest('.first').getBoundingClientRect(); return box.left >= outer.left && box.right <= outer.right; };
  const marks = (name) => [...root.querySelectorAll('.step-figure [style*="' + name + '"]')];
  return {
    expected,
    count: figures.length,
    inFirst: figures.every((el) => el.closest('.first-body')),
    shown: figures.every(shown),
    inside: figures.every(inside),
    accent: marks('--accent').length === figures.length && marks('--accent').every((el) => getComputedStyle(el).stroke === resolved('--accent')),
    cross: marks('--danger-fg').length === (figures.length ? 1 : 0) && marks('--danger-fg').every((el) => getComputedStyle(el).stroke === resolved('--danger-fg')),
    text: [...root.querySelectorAll('.step-figure text')].every((el) => getComputedStyle(el).fill === resolved('--ink')),
  };
})())`;
const figureProblems = (result, label) => {
  if (result.count !== result.expected) return [`${label}：操作の図の数が ${result.expected} 枚のはずが ${result.count} 枚`];
  if (!result.count) return [];
  return Object.entries({ inFirst: '① の中にありません', shown: '見えていません', inside: '① の枠からはみ出しています', accent: '暖色の印の色が違います', cross: '×の色が赤ではありません', text: '文字の色が違います' })
    .filter(([key]) => !result[key])
    .map(([, message]) => `${label}：操作の図 ${message}`);
};

// 長いページは分割して撮る。1枚が大きすぎると Chrome が応答しなくなるため
const SLICE_HEIGHT = 5000;
// 応答がなければ止める。夜間の作業が固まらないようにするため
const CALL_TIMEOUT_MS = 60000;
const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

class Usage extends Error {}

/** Chrome を起動して、DevTools の接続先を返す。 */
async function launchChrome(chromePath) {
  const profile = mkdtempSync(join(tmpdir(), 'hikitsugi-chrome-'));
  const child = spawn(
    chromePath,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-sync',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const stop = async () => {
    const exited = new Promise((done) => child.once('exit', done));
    child.kill('SIGKILL');
    await exited;
    // Chrome の補助プロセスが書き込みを終えるまで、少し待って消す
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  };
  const endpoint = await new Promise((done, fail) => {
    let buffer = '';
    const timer = setTimeout(() => fail(new Usage('Chrome の起動を待ちきれませんでした')), 30000);
    child.stderr.on('data', (chunk) => {
      buffer += chunk;
      const match = buffer.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timer);
        done(match[1]);
      }
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      fail(new Usage(`Chrome を起動できません：${error.message}`));
    });
  });
  return { endpoint, stop };
}

/** DevTools Protocol の最小の窓口。 */
function connect(endpoint) {
  return new Promise((done, fail) => {
    const socket = new WebSocket(endpoint);
    const pending = new Map();
    const listeners = new Map();
    let nextId = 1;
    const send = (method, params = {}, sessionId) =>
      new Promise((resolveCall, rejectCall) => {
        const id = nextId++;
        const timer = setTimeout(() => {
          pending.delete(id);
          rejectCall(new Usage(`Chrome の応答がありません：${method}`));
        }, CALL_TIMEOUT_MS);
        pending.set(id, { resolveCall, rejectCall, method, timer });
        socket.send(JSON.stringify({ id, method, params, sessionId }));
      });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.method) listeners.get(message.method)?.(message.params);
      const call = pending.get(message.id);
      if (!call) return;
      pending.delete(message.id);
      clearTimeout(call.timer);
      if (message.error) call.rejectCall(new Error(`${call.method}: ${message.error.message}`));
      else call.resolveCall(message.result);
    });
    socket.addEventListener('open', () => done({ send, on: (method, fn) => listeners.set(method, fn), close: () => socket.close() }));
    socket.addEventListener('error', () => fail(new Usage('Chrome に接続できません')));
  });
}

// ページの中で実行する測定。結果は JSON で返す。
const MEASURE = `(() => {
  const visible = (el) => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  };
  const describe = (el) => (el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : '') + '「' + (el.textContent || '').trim().slice(0, 14) + '」');
  const root = document.documentElement;
  const overflow = root.scrollWidth - root.clientWidth;
  const wide = [...document.querySelectorAll('body *')].filter((el) => visible(el) && el.getBoundingClientRect().right > root.clientWidth + 1).slice(0, 5).map(describe);
  const small = [];
  const lowContrast = [];
  const channels = (color) => {
    const m = color.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,\/]+/).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
  };
  const luminance = ({ r, g, b }) => {
    const c = [r, g, b].map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const textContrast = (el) => {
    const fg = channels(getComputedStyle(el).color);
    let node = el;
    let bg = null;
    while (node) {
      const c = channels(getComputedStyle(node).backgroundColor);
      if (c && c.a === 1) { bg = c; break; }
      node = node.parentElement;
    }
    if (!fg || !bg) return null;
    const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const parent = walker.currentNode.parentElement;
    if (!walker.currentNode.textContent.trim() || !parent || !visible(parent)) continue;
    const size = parseFloat(getComputedStyle(parent).fontSize);
    // 13px を認めるのは、タブのラベルと社外秘のチップだけ。それ以外は 14px 以上
    if (size < 13 || (size < 14 && !parent.closest('.chip-secret, .tabs'))) small.push(describe(parent) + ' ' + size + 'px');
    const ratio = textContrast(parent);
    if (ratio !== null && ratio < 4.5) lowContrast.push(describe(parent) + ' ' + ratio.toFixed(2));
  }
  // 語の途中で折り返していないこと
  const brokenWords = [...document.querySelectorAll('.nb')].filter(visible).filter((el) => new Set([...el.getClientRects()].map((r) => Math.round(r.top))).size > 1).map(describe);
  const low = [...document.querySelectorAll('.tap')].filter(visible).filter((el) => el.getBoundingClientRect().height < 44).map((el) => describe(el) + ' ' + Math.round(el.getBoundingClientRect().height) + 'px');
  // 手順の配置：番号とチェック欄が重ならず、手順の左端が本文の左端とそろっていること
  const layout = [];
  const overlaps = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
  for (const item of document.querySelectorAll('.steps > li')) {
    if (!visible(item)) continue;
    const number = item.querySelector('.step-n');
    const check = item.querySelector('input[type="checkbox"]');
    const box = check && check.getBoundingClientRect();
    if (!number) layout.push('手順の番号の要素（.step-n）がありません');
    else if (box && overlaps(number.getBoundingClientRect(), box)) layout.push('手順の番号とチェック欄が重なっています');
    if (box && (box.width < 24 || box.height < 24)) layout.push('チェック欄が小さすぎます');
  }
  for (const list of document.querySelectorAll('.steps')) {
    if (!visible(list)) continue;
    const panel = list.closest('article, section');
    const para = panel && [...panel.querySelectorAll('h2, h3, p')].find(visible);
    const first = list.querySelector('li');
    if (para && first && Math.abs(first.getBoundingClientRect().left - para.getBoundingClientRect().left) > 1) {
      layout.push('手順の一覧の左端が、本文の左端とそろっていません（' + Math.round(first.getBoundingClientRect().left - para.getBoundingClientRect().left) + 'px）');
    }
  }
  return JSON.stringify({ overflow, wide, layout: [...new Set(layout)], small: [...new Set(small)].slice(0, 10), lowContrast: [...new Set(lowContrast)].slice(0, 10), brokenWords: [...new Set(brokenWords)].slice(0, 10), low: [...new Set(low)].slice(0, 10), height: Math.ceil(Math.max(root.scrollHeight, document.body.scrollHeight)) });
})()`;

/** スマホ向けの束を撮る。iPhone の OneDrive と同じ条件にするため、JavaScript を止める。 */
async function shootBundle(input, output, chromePath) {
  const names = readdirSync(input).filter((name) => name.endsWith('.html')).sort();
  if (!names.length) throw new Usage(`HTML がありません：${input}`);
  const { endpoint, stop } = await launchChrome(chromePath);
  const problems = [];
  const shots = [];
  const figureFiles = [];
  try {
    const browser = await connect(endpoint);
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
    const page = (method, params) => browser.send(method, params, sessionId);
    browser.on('Network.requestWillBeSent', ({ request }) => {
      if (!/^(file|data|about):/.test(request.url)) problems.push(`外部への読み込みがあります：${request.url}`.slice(0, 200));
    });
    await page('Page.enable');
    await page('Runtime.enable');
    await page('Network.enable');
    await page('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] });
    await page('Emulation.setScriptExecutionDisabled', { value: true });
    const evaluate = async (expression) => (await page('Runtime.evaluate', { expression, returnByValue: true })).result.value;
    const settle = () => new Promise((done) => setTimeout(done, 200));
    for (const name of names) {
      const path = join(input, name);
      for (const problem of phoneFileProblems(readFileSync(path, 'utf8'))) problems.push(`${name}：${problem}`);
      const number = name.slice(0, 2);
      await page('Page.navigate', { url: pathToFileURL(path).href });
      await settle();
      // 小さい iPhone の幅でも、はみ出さないこと
      await page('Emulation.setDeviceMetricsOverride', { width: 320, height: 640, deviceScaleFactor: 2, mobile: true });
      await settle();
      const narrow = JSON.parse(await evaluate(MEASURE));
      if (narrow.overflow > 0) problems.push(`${name} 320px：横にはみ出しています（${narrow.overflow}px）${narrow.wide.join('、')}`);
      problems.push(...figureProblems(JSON.parse(await evaluate(figureCheck('document.body'))), `${name} 320px`));
      await page('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
      for (const theme of ['light', 'dark']) {
        await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
        await settle();
        const metrics = JSON.parse(await evaluate(MEASURE));
        const label = `${name} ${theme}`;
        if (metrics.overflow > 0) problems.push(`${label}：横にはみ出しています（${metrics.overflow}px）${metrics.wide.join('、')}`);
        if (metrics.small.length) problems.push(`${label}：小さすぎる文字があります ${metrics.small.join('、')}`);
        if (metrics.lowContrast.length) problems.push(`${label}：コントラスト比が 4.5 未満の文字があります ${metrics.lowContrast.join('、')}`);
        if (metrics.brokenWords.length) problems.push(`${label}：語の途中で折り返しています ${metrics.brokenWords.join('、')}`);
        const figures = JSON.parse(await evaluate(figureCheck('document.body')));
        problems.push(...figureProblems(figures, label));
        if (figures.count && !figureFiles.includes(name)) figureFiles.push(name);
        const { data } = await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 375, height: Math.min(metrics.height, 8000), scale: 1 } });
        writeFileSync(join(output, `${number}-${theme}.png`), Buffer.from(data, 'base64'));
        shots.push(`${number}-${theme}`);
      }
      // 連絡先のファイルで、番号と案内が実機で確かめた形になっていること。03 に番号がない会社でも確かめられるように
      if (number === '00') {
        const parts = JSON.parse(await evaluate(`JSON.stringify((() => {
          const num = document.querySelector('.num');
          if (!num) return {};
          const tel = num.querySelector('.tel');
          const style = getComputedStyle(num);
          return { contactTel: /^\\d+$/.test(tel?.textContent ?? '') && (getComputedStyle(tel).userSelect === 'all' || getComputedStyle(tel).webkitUserSelect === 'all'), contactNum: style.fontSize === '22px' && style.fontWeight === '700', contactNote: num.nextElementSibling?.classList.contains('note') && num.nextElementSibling.textContent.includes('番号を長押しすると、発信できます。') };
        })())`));
        for (const [key, ok] of Object.entries(parts)) if (!ok) problems.push(`${name}：実機で確かめた形になっていません（${key}）`);
      }
      // 03 のファイルで、実機で確かめた形（番号と案内、枠と案内、開いた用語）が映っていること
      if (number === '03') {
        const parts = JSON.parse(await evaluate(`JSON.stringify((() => {
          const shown = (el) => el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
          const note = (el, text) => shown(el) && el.nextElementSibling?.classList.contains('note') && shown(el.nextElementSibling) && el.nextElementSibling.textContent.includes(text);
          const num = document.querySelector('.num');
          const tel = document.querySelector('.num .tel');
          const selectAll = (el) => el && (getComputedStyle(el).userSelect === 'all' || getComputedStyle(el).webkitUserSelect === 'all');
          // 連絡先か番号のないページは、番号の確認を除く
          if (!document.querySelector('.contact') || !num) return { say: [...document.querySelectorAll('.say')].length > 0 && [...document.querySelectorAll('.say')].every((el) => note(el, '長押しして選択し、コピーしてください。')), term: [...document.querySelectorAll('.terms dd')].some(shown), closed: document.querySelectorAll('details').length === 0 };
          
          return { telOneRun: /^\\d+$/.test(tel?.textContent ?? '') && selectAll(tel), sayAll: [...document.querySelectorAll('.say')].every(selectAll), num: shown(num) && getComputedStyle(num).fontSize === '22px' && getComputedStyle(num).fontWeight === '700', numNote: note(num, '番号を長押しすると、発信できます。'), say: [...document.querySelectorAll('.say')].length > 0 && [...document.querySelectorAll('.say')].every((el) => note(el, '長押しして選択し、コピーしてください。')), noteSize: getComputedStyle(document.querySelector('.note') ?? document.body).fontSize === '15px', term: [...document.querySelectorAll('.terms dd')].some(shown), closed: document.querySelectorAll('details').length === 0 };
        })())`));
        for (const [key, ok] of Object.entries(parts)) if (!ok) problems.push(`${name}：実機で確かめた形になっていません（${key}）`);
      }
    }
    browser.close();
  } finally {
    await stop();
  }
  writeFileSync(join(output, 'report.json'), JSON.stringify({ files: names, shots, figure_files: figureFiles, problems }, null, 2) + '\n');
  console.log(`撮影しました：${names.length} ファイル、${shots.length} 枚（${output}）`);
  if (problems.length) {
    console.error(`画面の検査で問題が ${problems.length} 件あります：`);
    for (const problem of problems) console.error(`- ${problem}`);
    return 1;
  }
  console.log('画面の検査：問題なし（JavaScript なし、外部読み込みなし、リンクなし、200KB 以内、横のはみ出し、文字の大きさ、コントラスト、操作の図）');
  return 0;
}

async function main([inputArg, outputArg]) {
  if (!inputArg || !outputArg) throw new Usage('使い方：node scripts/screenshots.mjs <入力.html> <出力フォルダ>');
  const input = resolve(inputArg);
  if (!existsSync(input)) throw new Usage(`入力がありません：${input}`);
  const output = resolve(outputArg);
  mkdirSync(output, { recursive: true });
  const chromePath = process.env.CHROME_PATH ?? DEFAULT_CHROME;
  if (!existsSync(chromePath)) throw new Usage(`Chrome が見つかりません：${chromePath}`);
  if (statSync(input).isDirectory()) return shootBundle(input, output, chromePath);

  const url = pathToFileURL(input).href;
  const { endpoint, stop } = await launchChrome(chromePath);
  const problems = [];
  const shots = [];
  const report = {};
  try {
    const browser = await connect(endpoint);
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
    const page = (method, params) => browser.send(method, params, sessionId);
    browser.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
      problems.push(`JavaScript の実行で異常があります：${exceptionDetails.exception?.description ?? exceptionDetails.text}`.slice(0, 200));
    });
    browser.on('Network.requestWillBeSent', ({ request }) => {
      if (!/^(file|data|about):/.test(request.url)) problems.push(`外部への読み込みがあります：${request.url}`.slice(0, 200));
    });
    await page('Page.enable');
    await page('Runtime.enable');
    // 外部への読み込みがあれば、失敗として見つかるようにする
    await page('Network.enable');
    await page('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] });
    // コピーの確かめのため、画面に焦点がある状態にする
    await page('Emulation.setFocusEmulationEnabled', { enabled: true });
    await browser.send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }).catch(() => {});

    const evaluate = async (expression) => (await page('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true })).result.value;
    const settle = () => new Promise((done) => setTimeout(done, 250));
    const go = async (hash) => {
      await page('Page.navigate', { url: `${url}${hash}` });
      await settle();
      await settle();
    };

    let viewport = VIEWPORTS[0];
    const setSize = (height = viewport.height) =>
      page('Emulation.setDeviceMetricsOverride', { width: viewport.width, height, deviceScaleFactor: viewport.mobile ? 2 : 1, mobile: viewport.mobile });
    const shotPath = (name) => join(output, viewport.name, `${name}.png`);
    // 長いページは分割して撮る。ビューポートを広げずに撮るので、固定の部品が途中に写らない
    const slices = async (name, path = shotPath) => {
      const { height } = JSON.parse(await evaluate(MEASURE));
      const count = Math.max(1, Math.ceil(height / SLICE_HEIGHT));
      for (let i = 0; i < count; i += 1) {
        const clip = { x: 0, y: i * SLICE_HEIGHT, width: viewport.width, height: Math.min(SLICE_HEIGHT, height - i * SLICE_HEIGHT), scale: 1 };
        const { data } = await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip });
        const file = i === 0 ? name : `${name}-${i + 1}`;
        writeFileSync(path(file), Buffer.from(data, 'base64'));
        shots.push(`${viewport.name}/${file}`);
      }
    };
    const fullPage = async (name) => {
      const { height } = JSON.parse(await evaluate(MEASURE));
      if (height * (viewport.mobile ? 2 : 1) > 16000) {
        await slices(name);
        return;
      }
      await setSize(Math.max(height, viewport.height));
      await settle();
      const { data } = await page('Page.captureScreenshot', { format: 'png' });
      writeFileSync(shotPath(name), Buffer.from(data, 'base64'));
      shots.push(`${viewport.name}/${name}`);
      await setSize();
    };
    const capture = async (name, label) => {
      const metrics = JSON.parse(await evaluate(MEASURE));
      if (metrics.overflow > 0) problems.push(`${label}：横にはみ出しています（${metrics.overflow}px）${metrics.wide.join('、')}`);
      if (metrics.small.length) problems.push(`${label}：小さすぎる文字があります ${metrics.small.join('、')}`);
      if (metrics.lowContrast.length) problems.push(`${label}：コントラスト比が 4.5 未満の文字があります ${metrics.lowContrast.join('、')}`);
      if (metrics.brokenWords.length) problems.push(`${label}：語の途中で折り返しています ${metrics.brokenWords.join('、')}`);
      if (metrics.low.length) problems.push(`${label}：高さ 44px 未満の押す部品があります ${metrics.low.join('、')}`);
      for (const issue of metrics.layout) problems.push(`${label}：${issue}`);
      await fullPage(name);
    };

    // 開いた画面と、それを含む要素のほかに、見えている画面があれば数える。
    // 2列と3列では、手順ページの横に症状の一覧（#tab-help）を出すので、数えない
    const otherScreens = (id) => `(() => {
      const target = document.getElementById(${JSON.stringify(id)});
      const shown = (el) => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
      if (!target || !shown(target)) return -1;
      const beside = innerWidth >= 768 && ${JSON.stringify(id)}.startsWith('symptom-');
      return [...document.querySelectorAll('.panel, article[id^="symptom-"]')].filter((el) => el !== target && !el.contains(target) && !target.contains(el) && shown(el) && !(beside && el.id === 'tab-help')).length;
    })()`;

    // 仕様の値を測る
    const readCheck = (selector, props) => `(() => {
      const shown = [...document.querySelectorAll(${JSON.stringify(selector)})].find((el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0; });
      if (!shown) return 'null';
      const style = getComputedStyle(shown);
      const out = {};
      for (const prop of ${JSON.stringify(props)}) out[prop] = prop === 'width' || prop === 'height' ? shown.getBoundingClientRect()[prop] + 'px' : style[prop];
      return JSON.stringify(out);
    })()`;
    const cssVar = (name) => evaluate(`(() => { const d = document.createElement('div'); d.style.color = 'var(${name})'; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; })()`);

    await setSize();
    await go('');
    // ハッシュなしで開いたら、困ったときの一覧を出す
    const opened = JSON.parse(await evaluate(`JSON.stringify({ view: document.documentElement.getAttribute('data-view'), help: getComputedStyle(document.getElementById('tab-help')).display !== 'none', intro: getComputedStyle(document.getElementById('intro')).display !== 'none' })`));
    if (opened.view !== 'help' || !opened.help || opened.intro) problems.push(`ハッシュなしで開くと、困ったときの一覧が出ません（${JSON.stringify(opened)}）`);
    let replyFlow = null;
    // 普段の言葉で探す（索引のある HTML だけ）。「フォルダが消えた」で共有フォルダのページが1番に出ること
    const trySearch = async (name) => {
      const typed = JSON.parse(await evaluate(`JSON.stringify((() => {
        const input = document.getElementById('search-input');
        if (!input) return null;
        input.value = 'フォルダが消えた';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const cards = [...document.querySelectorAll('.search-results a.sym')];
        const fallback = document.querySelector('.search-fallback a.sym');
        return { height: input.getBoundingClientRect().height, count: cards.length, first: cards[0]?.querySelector('.sym-title')?.textContent ?? '', badge: Boolean(cards[0]?.querySelector('.badge')), fallback: fallback?.getAttribute('href') ?? '', more: document.querySelector('.search-more')?.textContent ?? '', fallbackBelow: fallback && cards.at(-1) ? fallback.getBoundingClientRect().top > cards.at(-1).getBoundingClientRect().top : false };
      })())`));
      if (!typed) return;
      if (typed.height < 48) problems.push(`${name}：入力欄の高さが 48px 未満です（${typed.height}）`);
      if (!typed.first.includes('共有フォルダ')) problems.push(`${name}：「フォルダが消えた」で共有フォルダのページが1番に出ません（${typed.first}）`);
      if (typed.count > 3) problems.push(`${name}：候補が3件を超えています`);
      if (!typed.badge) problems.push(`${name}：候補に判定のバッジがありません`);
      if (typed.fallback !== '#tab-contacts' || !typed.more.includes('当てはまらないとき') || !typed.fallbackBelow) problems.push(`${name}：候補の下に「当てはまらないとき」の行き先がありません`);
      const { data } = await page('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(output, `${name}.png`), Buffer.from(data, 'base64'));
      shots.push(name);
      // 後任が返信を送るまで：開く → 探す（入力して候補を押す）→ コピー の3操作
      await evaluate(`document.querySelector('.search-results a.sym').click()`);
      await settle();
      const copied = JSON.parse(await evaluate(`(async () => {
        const panel = document.querySelector('.panel.is-active');
        const button = panel?.querySelector('.reply-box .btn-copy');
        if (!button) return JSON.stringify({ opened: panel?.id ?? '', button: false });
        const box = panel.querySelector('.reply').getBoundingClientRect();
        const wanted = panel.querySelector('.reply').textContent;
        button.click();
        await new Promise((done) => setTimeout(done, 300));
        const pasted = await navigator.clipboard.readText().catch(() => null);
        return JSON.stringify({ opened: panel.id, button: true, visible: box.height > 0, done: button.classList.contains('is-done'), same: pasted === null || pasted === wanted, read_back: pasted !== null });
      })()`));
      if (!copied.opened.startsWith('symptom-')) problems.push(`${name}：候補を押しても症状のページが開きません（${copied.opened}）`);
      if (!copied.button || !copied.visible || !copied.done || !copied.same) problems.push(`${name}：3操作目の「文面をコピー」ができません（${JSON.stringify(copied)}）`);
      replyFlow = { steps: ['開く', '探す', 'コピー'], read_back: copied.read_back };
      const shot = await page('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(output, `${name}-reply.png`), Buffer.from(shot.data, 'base64'));
      shots.push(`${name}-reply`);
    };
    const targets = JSON.parse(await evaluate(`JSON.stringify({
      tabs: [...document.querySelectorAll('nav.tabs a[href^="#"]')].map((a) => a.getAttribute('href').slice(1)),
      pages: [...document.querySelectorAll('a[href^="#symptom-"]')].map((a) => a.getAttribute('href').slice(1)),
      firstPage: (document.querySelector('article[id^="symptom-"] .first') || { closest: () => null }).closest('article[id^="symptom-"]')?.id ?? null,
      fullPage: [...document.querySelectorAll('article[id^="symptom-"]')].find((a) => a.querySelector('.first') && a.querySelector('.band') && a.querySelector('.goal') && a.querySelector('code.path') && a.querySelector('details.term') && a.querySelector('.step-note'))?.id ?? null,
    })`));
    const screens = [...new Set(['intro', ...targets.tabs, ...targets.pages])];
    if (targets.tabs.length === 0) problems.push('タブのリンクが見つかりません');
    if (!targets.fullPage) problems.push('全部品がそろった手順ページが見本にありません');
    const screenOf = { intro: 'intro', help: 'tab-help', contacts: 'tab-contacts', symptom: targets.fullPage ?? targets.firstPage };

    // 操作の図は、どのページにあるかを先に確かめる。開いている画面によらない数え方にする
    const figurePages = [];
    for (const id of new Set(targets.pages)) {
      const result = JSON.parse(await evaluate(figureCheck(`document.getElementById('${id}')`)));
      if (result.count !== result.expected) problems.push(`${id}：操作の図の数が ${result.expected} 枚のはずが ${result.count} 枚`);
      if (result.count) figurePages.push(id);
    }
    report.figure_pages = figurePages;

    const backgrounds = {};
    for (const current of VIEWPORTS) {
      viewport = current;
      mkdirSync(join(output, viewport.name), { recursive: true });
      await setSize();
      for (const theme of ['light', 'dark']) {
        await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
        for (const screen of screens) {
          await go(`#${screen}`);
          // JavaScript があるときは、1画面だけを表示する
          const others = await evaluate(otherScreens(screen));
          if (others !== 0) problems.push(`${viewport.name} ${theme} ${screen}：${others < 0 ? '開いた画面が表示されていません' : `ほかの画面が ${others} 個見えています`}`);
          await capture(`${theme}-${screen}`, `${viewport.name} ${theme} ${screen}`);
          if (figurePages.includes(screen)) problems.push(...figureProblems(JSON.parse(await evaluate(figureCheck(`document.getElementById('${screen}')`))), `${viewport.name} ${theme} ${screen}`));
        }
        backgrounds[theme] = await evaluate('getComputedStyle(document.body).backgroundColor');
      }
      if (backgrounds.light === backgrounds.dark) problems.push('ダークモードで背景の色が変わりません');
      // ハッシュなしで開いて、探す
      await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
      await go('');
      await go('');
      // 開いた直後の画面。2列以上では、中央に「はじめに」の中身を出す。症状は左の一覧にあるので大きなカードは出さない
      if (viewport.name !== 'phone') {
        const home = JSON.parse(await evaluate(`JSON.stringify((() => {
          const box = document.getElementById('pick-home');
          const shown = (el) => el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
          const main = document.querySelector('.col-main').getBoundingClientRect();
          const rect = box ? box.getBoundingClientRect() : null;
          const first = document.querySelector('.pick-first');
          return {
            shown: shown(box),
            legend: box ? [...box.querySelectorAll('.legend .badge')].filter(shown).length : 0,
            cards: box ? [...box.querySelectorAll('a.sym')].filter(shown).length : 0,
            inMain: rect ? rect.left >= main.left - 1 && rect.right <= main.right + 1 : false,
            role: box ? shown(box.querySelector('.intro-role')) && box.textContent.includes('一次受け') : false,
            first: first ? shown(first) : !document.querySelector('[id^="contact-INH-"], .contact[data-inhouse]'),
            log: Boolean(box && box.querySelector('.update-log')) === Boolean(document.querySelector('#intro .update-log')),
            rail: Boolean(document.querySelector('.pick-rail')),
          };
        })())`));
        if (!home.shown || home.legend !== 4) problems.push(`${viewport.name} 開いた直後：判定4種の凡例が中央にありません（${JSON.stringify(home)}）`);
        if (home.cards || home.rail) problems.push(`${viewport.name} 開いた直後：症状のカードか右の列が残っています（${JSON.stringify(home)}）`);
        if (!home.inMain || !home.role || !home.first || !home.log) problems.push(`${viewport.name} 開いた直後：はじめにの中身がそろっていません（${JSON.stringify(home)}）`);
        await capture(`opened-${viewport.name}`, `${viewport.name} 開いた直後`);
      }
      await trySearch(`search-${viewport.name}`);
      const memoPage = targets.firstPage?.replace('symptom-', '');
      if (viewport.name === 'pc' && memoPage && !JSON.parse(await evaluate(`JSON.stringify(Boolean(document.querySelector('[data-memo="${memoPage}"]')))`))) {
        problems.push('メモ：欄がありません（古い版の HTML かもしれません）');
      } else if (viewport.name === 'pc' && memoPage) {
        const id = memoPage;
        await page('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }).catch(() => {});
        await go(`#${targets.firstPage}`);
        const before = JSON.parse(await evaluate(`JSON.stringify((() => {
          const box = document.querySelector('[data-memo="${id}"]');
          const shown = (el) => el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
          const terms = box.closest('article').querySelector('.terms-block');
          return { shown: shown(box), empty: box.querySelector('.memo-input').value === '', date: shown(box.querySelector('.memo-date')), note: box.querySelector('.memo-note').textContent, beforeTerms: !terms || Boolean(box.compareDocumentPosition(terms) & Node.DOCUMENT_POSITION_FOLLOWING), cards: document.querySelectorAll('.contact-grid [data-memo]').length, devices: document.querySelectorAll('.device-grid [data-memo]').length };
        })())`));
        if (!before.shown || !before.empty || before.date) problems.push(`メモ：空の欄が正しく出ていません（${JSON.stringify(before)}）`);
        if (!before.beforeTerms) problems.push('メモ：欄が「このページのことば」の前にありません');
        if (!before.note.includes('このブラウザーにだけ保存')) problems.push('メモ：保存場所の説明がありません');
        await evaluate(`document.querySelector('[data-memo="${id}"]').scrollIntoView({ block: 'center' })`);
        await settle();
        writeFileSync(join(output, 'memo-empty.png'), Buffer.from((await page('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
        shots.push('memo-empty');
        const MEMO = '共有の棚の鍵は総務課で借ります。\n2行目のメモです。\n3行目のメモです。\n4行目のメモです。';
        const written = JSON.parse(await evaluate(`JSON.stringify((() => {
          const box = document.querySelector('[data-memo="${id}"]');
          const input = box.querySelector('.memo-input');
          const low = input.getBoundingClientRect().height;
          input.value = ${JSON.stringify(MEMO)};
          input.dispatchEvent(new Event('input', { bubbles: true }));
          return { grew: input.getBoundingClientRect().height > low, date: box.querySelector('.memo-date').textContent, stored: localStorage.getItem('hikitsugi:' + document.documentElement.dataset.company + ':${id}') };
        })())`));
        if (!written.grew) problems.push('メモ：書いても欄が伸びません');
        if (!written.date.startsWith('最後に書いた日：')) problems.push('メモ：最後に書いた日が出ません');
        if (!written.stored?.includes('2行目')) problems.push('メモ：入力しても保存されません');
        await evaluate(`location.reload()`);
        await settle();
        await settle();
        const kept = JSON.parse(await evaluate(`JSON.stringify({ value: document.querySelector('[data-memo="${id}"] .memo-input').value, date: document.querySelector('[data-memo="${id}"] .memo-date').textContent })`));
        if (kept.value !== MEMO || !kept.date) problems.push('メモ：開き直すと残っていません');
        await evaluate(`document.querySelector('[data-memo="${id}"]').scrollIntoView({ block: 'center' })`);
        await settle();
        writeFileSync(join(output, 'memo-written.png'), Buffer.from((await page('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
        shots.push('memo-written');
        const copied = JSON.parse(await evaluate(`(async () => {
          document.querySelector('button[data-memo-copy]').click();
          await new Promise((done) => setTimeout(done, 300));
          const pasted = await navigator.clipboard.readText().catch(() => null);
          return JSON.stringify({ pasted, name: document.querySelector('[data-memo="${id}"]').getAttribute('data-memo-name') });
        })()`));
        if (copied.pasted !== `${copied.name}：${MEMO}`) problems.push(`メモ：まとめてコピーの内容が違います（${JSON.stringify(copied.pasted)}）`);
        // 印刷：書いたメモの内容だけが出て、入力欄と空の欄は出ない
        await page('Emulation.setEmulatedMedia', { media: 'print', features: [{ name: 'prefers-color-scheme', value: 'light' }] });
        await settle();
        const printed = JSON.parse(await evaluate(`JSON.stringify((() => {
          const shown = (el) => getComputedStyle(el).display !== 'none';
          const box = document.querySelector('[data-memo="${id}"]');
          return { text: shown(box) && shown(box.querySelector('.memo-print')) ? box.querySelector('.memo-print').textContent : null, inputs: [...document.querySelectorAll('.memo-input')].filter(shown).length, others: [...document.querySelectorAll('.memo.is-empty')].filter(shown).length };
        })())`));
        if (printed.text !== MEMO) problems.push('メモ：印刷にメモの内容が出ません');
        if (printed.inputs || printed.others) problems.push(`メモ：印刷に入力欄か空の欄が出ています（${JSON.stringify(printed)}）`);
        await evaluate(`document.querySelector('[data-memo="${id}"]').scrollIntoView({ block: 'center' })`);
        await settle();
        writeFileSync(join(output, 'memo-print.png'), Buffer.from((await page('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
        shots.push('memo-print');
        await page('Emulation.setEmulatedMedia', { media: '', features: [{ name: 'prefers-color-scheme', value: 'light' }] });
        // ほかの撮影に残さない
        await evaluate(`localStorage.removeItem('hikitsugi:' + document.documentElement.dataset.company + ':${id}')`);
        await evaluate(`location.reload()`);
        await settle();
        await settle();
        report.memo = { cards: before.cards, devices: before.devices };
      }

      // 仕様の値
      await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
      for (const screenName of Object.keys(screenOf)) {
        await go(`#${screenOf[screenName]}`);
        for (const check of CHECKS.filter((item) => item.screen === screenName && (!item.only || item.only === viewport.name))) {
          const props = [...Object.keys(check.exact ?? {}), ...Object.keys(check.min ?? {})];
          const values = JSON.parse(await evaluate(readCheck(check.selector, props)));
          const where = `${viewport.name} ${screenName} ${check.selector}`;
          if (!values) {
            problems.push(`${where}：要素が見つかりません`);
            continue;
          }
          for (const [prop, expected] of Object.entries(check.exact ?? {})) {
            const same = /px$/.test(expected) ? Math.abs(parseFloat(values[prop]) - parseFloat(expected)) < 0.51 : values[prop] === expected;
            if (!same) problems.push(`${where}：${prop} は ${expected} のはずが ${values[prop]}`);
          }
          for (const [prop, minimum] of Object.entries(check.min ?? {})) {
            if (!(parseFloat(values[prop]) >= minimum)) problems.push(`${where}：${prop} は ${minimum}px 以上のはずが ${values[prop]}`);
          }
        }
        for (const check of COLOR_CHECKS.filter((item) => item.screen === screenName)) {
          const values = JSON.parse(await evaluate(readCheck(check.selector, ['backgroundColor', 'color', 'borderTopColor'])));
          const where = `${viewport.name} ${screenName} ${check.selector}`;
          if (!values) {
            problems.push(`${where}：要素が見つかりません`);
            continue;
          }
          for (const [key, prop] of [['backgroundVar', 'backgroundColor'], ['colorVar', 'color'], ['borderColorVar', 'borderTopColor']]) {
            if (check[key] && values[prop] !== (await cssVar(check[key]))) problems.push(`${where}：${prop} は ${check[key]} のはず`);
          }
        }
      }

      // 列の組み立て
      await go(`#${screenOf.symptom}`);
      const layout = JSON.parse(await evaluate(`(() => {
        const box = (selector, base = document) => { const el = base.querySelector(selector); if (!el) return null; const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display === 'none' || r.width === 0 ? null : { left: r.left, right: r.right, width: r.width, position: s.position }; };
        const article = document.getElementById(${JSON.stringify(screenOf.symptom)});
        return JSON.stringify({ list: box('.col-list'), main: box('.col-main'), rail: box('.rail', article), tabs: box('.tabs'), topnav: box('.topnav') });
      })()`));
      const near = (value, expected) => value && Math.abs(value.width - expected) < 1;
      if (viewport.name === 'phone') {
        if (!layout.tabs) problems.push('phone：下部タブが見えません');
        if (layout.topnav) problems.push('phone：上部のナビが見えています');
        if (layout.rail) problems.push('phone：右の列が見えています');
      } else {
        if (layout.tabs) problems.push(`${viewport.name}：下部タブが見えています`);
        if (!layout.topnav) problems.push(`${viewport.name}：上部のナビが見えません`);
        if (!near(layout.list, 320)) problems.push(`${viewport.name}：症状の一覧の幅が 320px ではありません（${layout.list?.width}）`);
        if (layout.list?.position !== 'sticky') problems.push(`${viewport.name}：症状の一覧が sticky ではありません`);
        if (!layout.main) problems.push(`${viewport.name}：中央の列がありません`);
        else if (layout.list && layout.main.left < layout.list.right) problems.push(`${viewport.name}：一覧と中央の列が重なっています`);
      }
      if (viewport.name === 'tablet' && layout.rail) problems.push('tablet：右の列が見えています（2列の幅では中央の列の末尾に戻します）');
      if (viewport.name === 'pc') {
        if (layout.main && layout.main.width > 680.5) problems.push(`pc：中央の列が 680px を超えています（${layout.main.width}）`);
        if (!near(layout.rail, 300)) problems.push(`pc：右の列の幅が 300px ではありません（${layout.rail?.width}）`);
        if (layout.rail?.position !== 'sticky') problems.push('pc：右の列が sticky ではありません');
        if (layout.rail && layout.main && layout.rail.left < layout.main.right) problems.push('pc：中央の列と右の列が重なっています');
      }
    }

    // JavaScript なしの全文（OneDrive やファイルアプリのプレビューの想定）
    viewport = VIEWPORTS[0];
    await setSize();
    await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    await page('Emulation.setScriptExecutionDisabled', { value: true });
    await go('');
    await slices('nojs-all', (file) => join(output, `${file}.png`));
    // 入力欄は JavaScript があるときだけ
    if (await evaluate(`(() => { const el = document.getElementById('search-box'); return Boolean(el) && getComputedStyle(el).display !== 'none'; })()`)) problems.push('JavaScript なしで入力欄が見えています');
    // ハッシュなしでも、全文が順に読める。:target は強調にだけ使う
    const readAll = `JSON.stringify((() => {
      const shown = (el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.height > 0; };
      const parts = [...document.querySelectorAll('.panel, article[id^="symptom-"]')];
      const top = (id) => document.getElementById(id).getBoundingClientRect().top + scrollY;
      const emphasis = (el) => ({ id: el.id, band: getComputedStyle(el).boxShadow !== 'none', color: getComputedStyle(el.querySelector('.symptom-title')).color });
      return {
        noJs: document.documentElement.classList.contains('no-js'),
        hidden: parts.filter((el) => !shown(el)).map((el) => el.id),
        count: parts.length,
        firstIsHelp: parts.every((el) => el.id === 'tab-help' || top('tab-help') <= top(el.id)),
        introLast: parts.every((el) => el.id === 'intro' || top(el.id) < top('intro')),
        emphasized: [...document.querySelectorAll('article[id^="symptom-"]')].map(emphasis).filter((e) => e.band),
        plainTitle: emphasis(document.querySelector('article[id^="symptom-"]:not(:target)')).color,
        accent: (() => { const d = document.createElement('div'); d.style.color = 'var(--accent)'; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; })(),
      };
    })())`;
    const whole = JSON.parse(await evaluate(readAll));
    const memoNoJs = JSON.parse(await evaluate(`JSON.stringify({ boxes: [...document.querySelectorAll('.memo')].filter((el) => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0).length, lines: [...document.querySelectorAll('.memo-nojs')].filter((el) => getComputedStyle(el).display !== 'none').length })`));
    if (memoNoJs.boxes) problems.push(`JavaScript なし：メモの欄が出ています（${memoNoJs.boxes} 件）`);
    if (!memoNoJs.lines) problems.push('JavaScript なし：「メモは PC 版で書けます」がありません');
    if (!whole.noJs) problems.push('JavaScript なしの確認：no-js のままではありません');
    if (whole.hidden.length) problems.push(`JavaScript なし、ハッシュなし：見えない画面があります ${whole.hidden.join('、')}`);
    if (!whole.firstIsHelp) problems.push('JavaScript なし：困ったときの一覧が最初にありません');
    if (!whole.introLast) problems.push('JavaScript なし：はじめにが最後にありません');
    if (whole.emphasized.length) problems.push('JavaScript なし、ハッシュなし：強調された症状があります');
    await go(`#${screenOf.symptom}`);
    const aimed = JSON.parse(await evaluate(readAll));
    if (aimed.hidden.length) problems.push(`JavaScript なしで症状を開くと、見えなくなる画面があります ${aimed.hidden.join('、')}`);
    if (aimed.count !== whole.count) problems.push('JavaScript なしで症状を開くと、画面の数が変わります');
    if (aimed.emphasized.length !== 1 || aimed.emphasized[0].id !== screenOf.symptom) problems.push(`JavaScript なし：開いた症状の左の帯がありません（${JSON.stringify(aimed.emphasized)}）`);
    else if (aimed.emphasized[0].color !== aimed.accent || aimed.plainTitle === aimed.accent) problems.push('JavaScript なし：開いた症状の見出しの色が変わっていません');
    await evaluate(`document.getElementById(${JSON.stringify(screenOf.symptom)}).scrollIntoView()`);
    await settle();
    writeFileSync(join(output, 'nojs-target.png'), Buffer.from((await page('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    shots.push('nojs-target');
    await page('Emulation.setScriptExecutionDisabled', { value: false });

    // 印刷の見え方
    await go('');
    // PDF は分割で受け取る。1回の応答には上限（4MiB）があり、超えると返事が来ないため
    const { stream } = await page('Page.printToPDF', { printBackground: false, paperWidth: 8.27, paperHeight: 11.69, generateTaggedPDF: true, generateDocumentOutline: true, transferMode: 'ReturnAsStream' });
    const chunks = [];
    for (;;) {
      const { data, base64Encoded, eof } = await page('IO.read', { handle: stream, size: 1024 * 1024 });
      chunks.push(Buffer.from(data, base64Encoded ? 'base64' : 'utf8'));
      if (eof) break;
    }
    await page('IO.close', { handle: stream });
    writeFileSync(join(output, 'print.pdf'), Buffer.concat(chunks));
    report.reply_flow = replyFlow;
    browser.close();
  } finally {
    await stop();
  }

  writeFileSync(join(output, 'report.json'), JSON.stringify({ viewports: VIEWPORTS.map((v) => v.name), shots, problems, ...report }, null, 2) + '\n');
  console.log(`撮影しました：${shots.length} 枚と print.pdf（${output}）`);
  if (problems.length) {
    console.error(`画面の検査で問題が ${problems.length} 件あります：`);
    for (const problem of problems) console.error(`- ${problem}`);
    return 1;
  }
  console.log('画面の検査：問題なし（横のはみ出し、文字の大きさ、コントラスト、44px、手順の配置、列の幅、仕様の値、操作の図）');
  return 0;
}

try {
  const args = process.argv.slice(2);
  const at = args.indexOf('--baseline');
  const baseline = at >= 0 ? args[at + 1] : null;
  const rest = at >= 0 ? args.filter((_, index) => index !== at && index !== at + 1) : args;
  if (at >= 0 && (!baseline || !existsSync(baseline))) {
    console.error('--baseline には、前回の出力フォルダを指定してください');
    process.exitCode = 2;
  } else {
    process.exitCode = await main(rest);
    if (baseline && process.exitCode !== 2) compareAndReport(rest[1], baseline);
  }
} catch (error) {
  if (!(error instanceof Usage)) throw error;
  console.error(error.message);
  process.exitCode = 2;
}
