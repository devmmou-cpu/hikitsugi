#!/usr/bin/env node
// 撮影した画像を前回と比べ、変わった画像の名前を返す。画面の変更に気づくための検査で、外部ライブラリを使わない。
// 使い方：node scripts/compare-shots.mjs <今回のフォルダ> <前回のフォルダ> [--threshold 0.001] [--tolerance 8]
// 結果は <今回のフォルダ>/comparison.json にも保存する。
// 終了コード：0＝差分なし、1＝差分あり（名前を表示）、2＝引数の誤り

import { existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';

// 変わった画素の割合がこれを超えたら「差分あり」。全画面の撮影で、小さな変更（短い文1行など）に気づける値
export const DEFAULT_THRESHOLD = 0.001;
// 1色（0〜255）の差がこれ以下の画素は同じと見なす。文字のにじみの揺れで騒がないため
export const DEFAULT_TOLERANCE = 8;

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS = { 2: 3, 6: 4 };

const paeth = (left, up, corner) => {
  const estimate = left + up - corner;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toCorner = Math.abs(estimate - corner);
  if (toLeft <= toUp && toLeft <= toCorner) return left;
  return toUp <= toCorner ? up : corner;
};

/** PNG を読む。Chrome の撮影が使う形（8bit の RGB か RGBA、飛び越しなし）だけに対応する。 */
export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('PNG ではありません');
  let width = 0;
  let height = 0;
  let channels = 0;
  const compressed = [];
  for (let at = 8; at < buffer.length; ) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.toString('latin1', at + 4, at + 8);
    const body = buffer.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      channels = CHANNELS[body[9]];
      if (body[8] !== 8 || !channels || body[12] !== 0) throw new Error('対応していない形式の PNG です');
    }
    if (type === 'IDAT') compressed.push(body);
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(compressed));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const start = y * (stride + 1);
    const filter = raw[start];
    for (let x = 0; x < stride; x += 1) {
      const value = raw[start + 1 + x];
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const corner = y > 0 && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      const base = [0, left, up, (left + up) >> 1, paeth(left, up, corner)][filter];
      if (base === undefined) throw new Error('対応していない PNG のフィルターです');
      pixels[y * stride + x] = (value + base) & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

/** 2枚を比べ、変わった画素の割合（0〜1）を返す。大きさが違えば 1。 */
export function changedRatio(a, b, tolerance = DEFAULT_TOLERANCE) {
  if (a.width !== b.width || a.height !== b.height) return 1;
  let changed = 0;
  for (let i = 0, p = 0; i < a.width * a.height; i += 1, p += a.channels) {
    // RGB だけを比べる。透明の値は撮影で変わらない
    for (let c = 0; c < 3; c += 1) {
      if (Math.abs(a.pixels[p + c] - b.pixels[i * b.channels + c]) > tolerance) {
        changed += 1;
        break;
      }
    }
  }
  return changed / (a.width * a.height);
}

const pngsIn = (dir, root = dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pngsIn(path, root);
    return name.endsWith('.png') ? [relative(root, path)] : [];
  });

/** フォルダどうしを比べる。名前はフォルダからの相対パス。 */
export function compareFolders(current, baseline, { threshold = DEFAULT_THRESHOLD, tolerance = DEFAULT_TOLERANCE } = {}) {
  const now = new Set(pngsIn(current));
  const before = new Set(pngsIn(baseline));
  const changed = [];
  let same = 0;
  for (const name of [...now].filter((candidate) => before.has(candidate)).sort()) {
    const left = readFileSync(join(current, name));
    const right = readFileSync(join(baseline, name));
    // 中身が同じなら、読まなくても同じ
    const ratio = left.equals(right) ? 0 : changedRatio(decodePng(left), decodePng(right), tolerance);
    if (ratio > threshold) changed.push({ name, ratio: Number(ratio.toFixed(5)) });
    else same += 1;
  }
  return {
    threshold,
    tolerance,
    same,
    changed,
    added: [...now].filter((name) => !before.has(name)).sort(),
    removed: [...before].filter((name) => !now.has(name)).sort(),
  };
}

export const hasDifference = ({ changed, added, removed }) => changed.length + added.length + removed.length > 0;

/** 比較の結果を、画像の名前の一覧にする。 */
export function comparisonLines({ same, changed, added, removed }) {
  return [
    `前回との比較：同じ ${same} 枚、変わった ${changed.length} 枚、増えた ${added.length} 枚、なくなった ${removed.length} 枚`,
    ...changed.map(({ name, ratio }) => `変わった：${name}（${(ratio * 100).toFixed(2)}%）`),
    ...added.map((name) => `増えた：${name}`),
    ...removed.map((name) => `なくなった：${name}`),
  ];
}

/** 比べて、comparison.json に保存し、名前を表示する。 */
export function compareAndReport(current, baseline, options) {
  const result = compareFolders(current, baseline, options);
  writeFileSync(join(current, 'comparison.json'), JSON.stringify({ baseline: resolve(baseline), ...result }, null, 2) + '\n');
  for (const line of comparisonLines(result)) console.log(line);
  return result;
}

function main(args) {
  const [current, baseline] = args.filter((arg, index) => !arg.startsWith('--') && !args[index - 1]?.startsWith('--'));
  const option = (name, fallback) => (args.includes(name) ? Number(args[args.indexOf(name) + 1]) : fallback);
  const threshold = option('--threshold', DEFAULT_THRESHOLD);
  const tolerance = option('--tolerance', DEFAULT_TOLERANCE);
  if (!current || !baseline || !existsSync(current) || !existsSync(baseline) || Number.isNaN(threshold) || Number.isNaN(tolerance)) {
    console.error('使い方：node scripts/compare-shots.mjs <今回のフォルダ> <前回のフォルダ> [--threshold 0.001] [--tolerance 8]');
    return 2;
  }
  return hasDifference(compareAndReport(current, baseline, { threshold, tolerance })) ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
