// 書き出す HTML の大きさの上限。超えたファイルは .blocked に改名して、そのまま配れないようにする。

import { rmSync, writeFileSync } from 'node:fs';

export const PC_FILE_LIMIT = 1024 * 1024;
export const PC_FILE_TARGET = 500 * 1024;
export const PHONE_FILE_LIMIT = 200 * 1024;

export const fileSize = (text) => Buffer.byteLength(text);

/** 上限の範囲なら path に書き、超えていれば path.blocked に書く。古い出力は残さない。超えたら true を返す。 */
export function writeWithinLimit(path, text, limit) {
  const blocked = fileSize(text) > limit;
  rmSync(blocked ? path : `${path}.blocked`, { force: true });
  writeFileSync(blocked ? `${path}.blocked` : path, text);
  return blocked;
}

const kb = (bytes) => `${Math.ceil(bytes / 1024)}KB`;
export const oversizeMessage = (path, text, limit) => `ファイルが上限の ${kb(limit)} を超えたので止めました（${kb(fileSize(text))}）。${path}.blocked に保存しました`;
