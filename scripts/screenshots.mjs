#!/usr/bin/env node
// 取扱説明書の HTML を、iPhone の幅（375px）で全画面撮影する。朝の見た目の確認用。
// 依存なし。インストール済みの Chrome を、Node 標準の WebSocket で操作する。外部へは通信しない。
//
// 使い方：node scripts/screenshots.mjs <入力.html> <出力フォルダ>
// 環境変数 CHROME_PATH で Chrome の場所を変えられる。
// 終了コード：0＝成功、1＝画面の検査で問題あり（理由を表示）、2＝引数の誤りや Chrome の起動失敗
//
// 撮るもの：各タブと各手順ページを、ライト、ダークの両方で。ほかに JavaScript なしの全文と、印刷の見え方。
// あわせて、実際の画面で横のはみ出し、文字の大きさ、押す部品の高さ、手順の配置を測る。

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const WIDTH = 375;
const HEIGHT = 812;
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
        pending.set(id, { resolveCall, rejectCall, method });
        socket.send(JSON.stringify({ id, method, params, sessionId }));
      });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.method) listeners.get(message.method)?.(message.params);
      const call = pending.get(message.id);
      if (!call) return;
      pending.delete(message.id);
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
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const parent = walker.currentNode.parentElement;
    if (!walker.currentNode.textContent.trim() || !parent || !visible(parent)) continue;
    if (parseFloat(getComputedStyle(parent).fontSize) < 16) small.push(describe(parent));
  }
  const low = [...document.querySelectorAll('.tap')].filter(visible).filter((el) => el.getBoundingClientRect().height < 44).map((el) => describe(el) + ' ' + Math.round(el.getBoundingClientRect().height) + 'px');
  // 手順の配置：番号とチェック欄が重ならず、手順の左端が本文の左端とそろっていること
  const layout = [];
  const overlaps = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
  for (const item of document.querySelectorAll('.steps > li')) {
    if (!visible(item)) continue;
    const number = item.querySelector('.step-number');
    const check = item.querySelector('input[type="checkbox"]');
    const box = check && check.getBoundingClientRect();
    if (!number) layout.push('手順の番号の要素（.step-number）がありません');
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
  return JSON.stringify({ overflow, wide, layout: [...new Set(layout)], small: [...new Set(small)].slice(0, 10), low: [...new Set(low)].slice(0, 10), height: Math.ceil(Math.max(root.scrollHeight, document.body.scrollHeight)) });
})()`;

async function main([inputArg, outputArg]) {
  if (!inputArg || !outputArg) throw new Usage('使い方：node scripts/screenshots.mjs <入力.html> <出力フォルダ>');
  const input = resolve(inputArg);
  if (!existsSync(input)) throw new Usage(`入力がありません：${input}`);
  const output = resolve(outputArg);
  mkdirSync(output, { recursive: true });
  const chromePath = process.env.CHROME_PATH ?? DEFAULT_CHROME;
  if (!existsSync(chromePath)) throw new Usage(`Chrome が見つかりません：${chromePath}`);

  const url = pathToFileURL(input).href;
  const { endpoint, stop } = await launchChrome(chromePath);
  const problems = [];
  const shots = [];
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
    await page('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: true });
    // 外部への読み込みがあれば、失敗として見つかるようにする
    await page('Network.enable');
    await page('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] });

    const evaluate = async (expression) => (await page('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
    const settle = () => new Promise((done) => setTimeout(done, 250));
    const go = async (hash) => {
      await page('Page.navigate', { url: `${url}${hash}` });
      await settle();
      await settle();
    };
    const capture = async (name, label) => {
      const metrics = JSON.parse(await evaluate(MEASURE));
      if (metrics.overflow > 0) problems.push(`${label}：横にはみ出しています（${metrics.overflow}px）${metrics.wide.join('、')}`);
      if (metrics.small.length) problems.push(`${label}：16px より小さい文字があります ${metrics.small.join('、')}`);
      if (metrics.low.length) problems.push(`${label}：高さ 44px 未満の押す部品があります ${metrics.low.join('、')}`);
      for (const issue of metrics.layout) problems.push(`${label}：${issue}`);
      await fullPage(name);
    };
    // ビューポートをページの高さまで広げて撮る。広げずに撮ると、固定のタブが画面の途中に写るため
    const fullPage = async (name) => {
      const { height } = JSON.parse(await evaluate(MEASURE));
      await page('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: Math.max(height, HEIGHT), deviceScaleFactor: 2, mobile: true });
      await settle();
      const { data } = await page('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(output, `${name}.png`), Buffer.from(data, 'base64'));
      shots.push(name);
      await page('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: true });
    };

    // 画面の一覧は、HTML のリンクから読み取る
    await go('');
    const targets = JSON.parse(await evaluate(`JSON.stringify({
      tabs: [...document.querySelectorAll('nav.tabs a[href^="#"]')].map((a) => a.getAttribute('href').slice(1)),
      pages: [...document.querySelectorAll('a[href^="#symptom-"]')].map((a) => a.getAttribute('href').slice(1)),
    })`));
    const screens = [...new Set([...targets.tabs, ...targets.pages])];
    if (screens.length === 0) problems.push('タブのリンクが見つかりません');

    // 開いた画面と、それを含む要素のほかに、見えている画面があれば数える
    const otherScreens = (id) => `(() => {
      const target = document.getElementById(${JSON.stringify(id)});
      const shown = (el) => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
      if (!target || !shown(target)) return -1;
      return [...document.querySelectorAll('.panel, article[id^="symptom-"]')].filter((el) => el !== target && !el.contains(target) && !target.contains(el) && shown(el)).length;
    })()`;
    const backgrounds = {};
    for (const [theme, media] of [['light', 'light'], ['dark', 'dark']]) {
      await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: media }] });
      for (const screen of screens) {
        await go(`#${screen}`);
        // JavaScript があるときは、1画面だけを表示する
        const others = await evaluate(otherScreens(screen));
        if (others !== 0) problems.push(`${theme} ${screen}：${others < 0 ? '開いた画面が表示されていません' : `ほかの画面が ${others} 個見えています`}`);
        await capture(`${theme}-${screen}`, `${theme} ${screen}`);
      }
      backgrounds[theme] = await evaluate('getComputedStyle(document.body).backgroundColor');
    }
    if (backgrounds.light === backgrounds.dark) problems.push('ダークモードで背景の色が変わりません');

    // JavaScript なしの全文（OneDrive やファイルアプリのプレビューの想定）
    await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    await page('Emulation.setScriptExecutionDisabled', { value: true });
    await go('');
    await fullPage('nojs-all');
    await page('Emulation.setScriptExecutionDisabled', { value: false });

    // 印刷の見え方
    await go('');
    const { data: pdf } = await page('Page.printToPDF', { printBackground: false, paperWidth: 8.27, paperHeight: 11.69 });
    writeFileSync(join(output, 'print.pdf'), Buffer.from(pdf, 'base64'));
    browser.close();
  } finally {
    await stop();
  }

  writeFileSync(join(output, 'report.json'), JSON.stringify({ width: WIDTH, shots, problems }, null, 2) + '\n');
  console.log(`撮影しました：${shots.length} 枚と print.pdf（${output}）`);
  if (problems.length) {
    console.error(`画面の検査で問題が ${problems.length} 件あります：`);
    for (const problem of problems) console.error(`- ${problem}`);
    return 1;
  }
  console.log('画面の検査：問題なし（横のはみ出し、16px、44px、手順の配置）');
  return 0;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof Usage)) throw error;
  console.error(error.message);
  process.exitCode = 2;
}
