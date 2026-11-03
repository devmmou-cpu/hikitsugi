// 撮影の前回比較。変わった画像の名前を返し、小さな揺れでは騒がない。

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { changedRatio, compareFolders, decodePng, hasDifference } from '../scripts/compare-shots.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const chunk = (type, body) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), body])) >>> 0, 0);
  return Buffer.concat([head, body, tail]);
};

const paeth = (a, b, c) => {
  const p = a + b - c;
  const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** 見本の PNG を作る。行ごとにフィルターの種類を変えて、読む側の全種類を通す。 */
function png(width, height, pixelAt, { channels = 3, colorType = 2 } = {}) {
  const stride = width * channels;
  const flat = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) pixelAt(x, y).forEach((value, c) => { flat[y * stride + x * channels + c] = value; });
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const filter = y % 5;
    const row = Buffer.alloc(stride + 1);
    row[0] = filter;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? flat[y * stride + x - channels] : 0;
      const up = y > 0 ? flat[(y - 1) * stride + x] : 0;
      const corner = y > 0 && x >= channels ? flat[(y - 1) * stride + x - channels] : 0;
      row[x + 1] = (flat[y * stride + x] - [0, left, up, (left + up) >> 1, paeth(left, up, corner)][filter]) & 0xff;
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = colorType;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

const gradient = (x, y) => [(x * 7) & 0xff, (y * 11) & 0xff, (x * y) & 0xff];

function folders(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'hikitsugi-shots-'));
  const now = join(dir, 'now');
  const before = join(dir, 'before');
  const put = (root, name, data) => {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), data);
  };
  try {
    mkdirSync(now);
    mkdirSync(before);
    return fn({ now, before, put });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('PNG を読む：RGB と RGBA、全種類のフィルターを元の画素に戻す', () => {
  const rgb = decodePng(png(16, 15, gradient));
  assert.deepEqual([rgb.width, rgb.height, rgb.channels], [16, 15, 3]);
  for (let y = 0; y < 15; y += 1) for (let x = 0; x < 16; x += 1) assert.deepEqual([...rgb.pixels.subarray((y * 16 + x) * 3, (y * 16 + x) * 3 + 3)], gradient(x, y));
  const rgba = decodePng(png(4, 5, (x, y) => [...gradient(x, y), 255], { channels: 4, colorType: 6 }));
  assert.equal(rgba.channels, 4);
  assert.throws(() => decodePng(Buffer.from('not a png')), /PNG ではありません/);
});

test('差分の割合：しきい値の中の揺れは同じと見なし、大きさが違えば全部違う', () => {
  const base = decodePng(png(10, 10, () => [100, 100, 100]));
  const shaken = decodePng(png(10, 10, () => [108, 92, 100]));
  assert.equal(changedRatio(base, shaken), 0);
  const onePixel = decodePng(png(10, 10, (x, y) => (x === 0 && y === 0 ? [200, 100, 100] : [100, 100, 100])));
  assert.equal(changedRatio(base, onePixel), 0.01);
  assert.equal(changedRatio(base, decodePng(png(10, 11, () => [100, 100, 100]))), 1);
  // RGB と RGBA でも比べられる
  assert.equal(changedRatio(base, decodePng(png(10, 10, () => [100, 100, 100, 255], { channels: 4, colorType: 6 }))), 0);
});

test('フォルダの比較：変わった画像、増えた画像、なくなった画像の名前を返す', () =>
  folders(({ now, before, put }) => {
    const same = png(40, 40, gradient);
    put(now, 'pc/light-same.png', same);
    put(before, 'pc/light-same.png', same);
    // 全画面で1画素だけの揺れは、しきい値の中
    const quiet = (flip) => png(100, 100, (x, y) => (flip && x === 0 && y === 0 ? [255, 255, 255] : [0, 0, 0]));
    put(now, 'pc/light-quiet.png', quiet(true));
    put(before, 'pc/light-quiet.png', quiet(false));
    put(now, 'phone/dark-t1.png', png(40, 40, () => [255, 255, 255]));
    put(before, 'phone/dark-t1.png', png(40, 40, () => [0, 0, 0]));
    put(now, 'pc/new.png', same);
    put(before, 'pc/gone.png', same);
    put(now, 'report.json', '{}');

    const result = compareFolders(now, before, { threshold: 0.001, tolerance: 8 });
    assert.equal(result.same, 2);
    assert.deepEqual(result.changed, [{ name: join('phone', 'dark-t1.png'), ratio: 1 }]);
    assert.deepEqual(result.added, [join('pc', 'new.png')]);
    assert.deepEqual(result.removed, [join('pc', 'gone.png')]);
    assert.equal(hasDifference(result), true);
  }));

test('コマンド：差分がなければ 0、あれば名前を表示して 1、引数の誤りは 2', () =>
  folders(({ now, before, put }) => {
    const run = (...args) => spawnSync(process.execPath, [join(ROOT, 'scripts/compare-shots.mjs'), ...args], { encoding: 'utf8' });
    put(now, 'a.png', png(8, 8, gradient));
    put(before, 'a.png', png(8, 8, gradient));
    const quiet = run(now, before);
    assert.equal(quiet.status, 0, quiet.stderr);
    assert.match(quiet.stdout, /同じ 1 枚、変わった 0 枚/);

    put(now, 'a.png', png(8, 8, () => [255, 0, 0]));
    const loud = run(now, before, '--threshold', '0.5');
    assert.equal(loud.status, 1);
    assert.match(loud.stdout, /変わった：a\.png/);
    const saved = JSON.parse(readFileSync(join(now, 'comparison.json'), 'utf8'));
    assert.equal(saved.threshold, 0.5);
    assert.equal(saved.changed[0].name, 'a.png');

    assert.equal(run(now).status, 2);
    assert.equal(run(now, join(before, 'missing')).status, 2);
  }));
