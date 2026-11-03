// 複数 PC の調査結果（生データ）を確かめて、1つの調査データ（survey）にまとめる。
// 生データは PC ごとの手元のファイルなので信用せず、約束の項目と形だけを通す。
// エラーの文に値そのものは出さない。認証情報が混ざっていても画面やログに残さないため。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hasCredential } from './transcript.mjs';
import { validate } from './validate.mjs';

const schema = JSON.parse(readFileSync(fileURLToPath(new URL('../schemas/survey.schema.json', import.meta.url)), 'utf8'));

const MAX_ITEMS = 999;
const RAW_FIELDS = new Set(['schema_version', 'host', 'collected_at', 'items']);
const ITEM_FIELDS = new Set(['category', 'key', 'value', 'status']);
const CATEGORIES = new Set(schema.properties.items.items.properties.category.enum);
const STATUSES = new Set(schema.properties.items.items.properties.status.enum);

// 約束の項目名と、その区分
const KEYS = [
  [/^os\.(caption|version)$/, 'os'],
  [/^(hw\.(maker|model|memory_gb)|disk\.c_free_gb)$/, 'hardware'],
  [/^net\.(ip_mode|gateway|dns|wifi_ssid)$/, 'network'],
  [/^share\.drive\.[A-Z]$/, 'share'],
  [/^printer\.\d+$/, 'printer'],
  [/^software\.\d+$/, 'software'],
  [/^security\.(last_update|feature_update|antivirus|bitlocker)$/, 'security'],
  [/^account\.(join_type|m365_signed_in)$/, 'account'],
];

// 文字列以外の値を持つ項目。PowerShell の型の違いをここで止める
const INTEGER_KEYS = new Set(['hw.memory_gb', 'disk.c_free_gb']);
const BOOLEAN_KEYS = new Set(['account.m365_signed_in']);

const COLLECTED_AT = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(Z|[+-]\d{2}:\d{2})$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** 13月や2月30日のような、形だけ合っている日付を止める。 */
function isRealDay(year, month, day) {
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day);
}

function checkOkValue(where, key, value) {
  if (value === null || value === '') throw new Error(`${where}：状態が ok なのに値（value）がありません`);
  if (INTEGER_KEYS.has(key)) {
    if (!Number.isInteger(value) || value < 0) throw new Error(`${where}：値（value）は 0 以上の整数にしてください`);
    return;
  }
  if (BOOLEAN_KEYS.has(key)) {
    if (typeof value !== 'boolean') throw new Error(`${where}：値（value）は true か false にしてください`);
    return;
  }
  if (typeof value !== 'string') throw new Error(`${where}：値（value）は文字列にしてください`);
  if (key === 'net.ip_mode' && value !== 'DHCP' && value !== '固定') throw new Error(`${where}：値（value）は DHCP か 固定 にしてください`);
  if (key === 'security.last_update') {
    const day = DAY.exec(value);
    if (!day || !isRealDay(day[1], day[2], day[3])) throw new Error(`${where}：値（value）は yyyy-MM-dd の日付にしてください`);
  }
}

function checkItem(item, position, host) {
  const label = `${host} の ${position} 件目`;
  if (!isObject(item)) throw new Error(`${label}：項目の形が違います`);
  if (Object.keys(item).some((field) => !ITEM_FIELDS.has(field))) throw new Error(`${label}：項目に約束にない欄があります`);
  if (typeof item.key !== 'string' || item.key === '') throw new Error(`${label}：項目名（key）がありません`);
  if (hasCredential(item.key) || (typeof item.value === 'string' && hasCredential(item.value))) {
    throw new Error(`${label}：認証情報らしい値があります。値は表示しません。元のファイルを開いて確かめてください`);
  }
  if (!CATEGORIES.has(item.category)) throw new Error(`${label}：区分（category）が約束にありません`);
  const known = KEYS.find(([pattern]) => pattern.test(item.key));
  if (!known) throw new Error(`${label}：項目 ${item.key} は約束にありません`);
  const where = `${host} の ${item.key}`;
  if (known[1] !== item.category) throw new Error(`${where}：項目と区分（category）が合いません`);
  if (!STATUSES.has(item.status)) throw new Error(`${where}：状態（status）は ok、unavailable、denied のどれかにしてください`);
  if (!('value' in item)) throw new Error(`${where}：値（value）の欄がありません`);
  if (item.status === 'ok') checkOkValue(where, item.key, item.value);
  else if (item.value !== null) throw new Error(`${where}：状態が ${item.status} のときの値（value）は null にしてください`);
}

function checkRaw(raw, position) {
  const label = `${position} 台目の生データ`;
  if (!isObject(raw)) throw new Error(`${label}：形式が違います`);
  if (raw.schema_version !== 1) throw new Error(`${label}：形式の版（schema_version）が 1 ではありません`);
  if (Object.keys(raw).some((field) => !RAW_FIELDS.has(field))) throw new Error(`${label}：約束にない欄があります（形式が違います）`);
  if (typeof raw.host !== 'string' || raw.host.trim() === '') throw new Error(`${label}：PC 名（host）がありません`);
  if (hasCredential(raw.host)) throw new Error(`${label}：PC 名に認証情報らしい値があります。値は表示しません`);
  const stamp = typeof raw.collected_at === 'string' ? COLLECTED_AT.exec(raw.collected_at) : null;
  if (!stamp || !isRealDay(stamp[1], stamp[2], stamp[3])) throw new Error(`${raw.host}：取得日時（collected_at）はタイムゾーンつきの日時にしてください`);
  if (!Array.isArray(raw.items)) throw new Error(`${raw.host}：項目の一覧（items）がありません`);
  const seen = new Set();
  raw.items.forEach((item, index) => {
    checkItem(item, index + 1, raw.host);
    if (seen.has(item.key)) throw new Error(`${raw.host}：項目 ${item.key} が重複しています`);
    seen.add(item.key);
  });
}

const compare = (x, y) => (x < y ? -1 : x > y ? 1 : 0);

/**
 * 生データの配列を survey の形にまとめる。問題があれば例外を投げる。
 * ID は PC 名、項目名の順に振るので、入力の順番によらず同じ結果になる。
 */
export function mergeSurveys(raws, { company } = {}) {
  if (typeof company !== 'string' || company.trim() === '') throw new Error('会社の ID がありません');
  if (!Array.isArray(raws) || raws.length === 0) throw new Error('生データが1台分もありません');
  raws.forEach((raw, index) => checkRaw(raw, index + 1));

  const hosts = new Set();
  for (const raw of raws) {
    // Windows の PC 名は大文字と小文字を区別しない
    const name = raw.host.toUpperCase();
    if (hosts.has(name)) throw new Error(`${raw.host}：同じ PC の結果が重複しています。新しいファイルだけを渡してください`);
    hosts.add(name);
  }

  const items = raws
    .flatMap((raw) => raw.items.map((item) => ({ host: raw.host, category: item.category, key: item.key, value: item.value, collected_at: raw.collected_at, status: item.status })))
    .sort((x, y) => compare(x.host, y.host) || compare(x.key, y.key));
  if (items.length > MAX_ITEMS) throw new Error(`項目が ${items.length} 件あり、ID を振れる ${MAX_ITEMS} 件を超えています。PC の台数を分けて確かめてください`);

  const survey = {
    schema_version: 1,
    company,
    as_of: raws.map((raw) => raw.collected_at.slice(0, 10)).sort(compare).at(-1),
    items: items.map((item, index) => ({ id: `INV-${String(index + 1).padStart(3, '0')}`, ...item })),
  };
  const problems = validate(schema, survey);
  if (problems.length) throw new Error(`まとめた結果の形式が違います：\n${problems.slice(0, 10).join('\n')}`);
  return survey;
}
