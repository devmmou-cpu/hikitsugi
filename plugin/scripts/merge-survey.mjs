#!/usr/bin/env node
// 複数 PC の調査結果を1つの調査データにまとめるコマンド。通信はしない。
// 使い方：node merge-survey.mjs <出力.json> <会社の ID> <生データ1.json> [生データ2.json ...]
// 終了コード：0＝成功、1＝内容の問題（出力ファイルを作らない）、2＝引数の誤り

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mergeSurveys } from '../lib/merge-survey.mjs';

const USAGE = '使い方：node merge-survey.mjs <出力.json> <会社の ID> <生データ1.json> [生データ2.json ...]';

function fail(message, code) {
  console.error(message);
  process.exitCode = code;
}

/** 調査スクリプトの結果を読む。BOM があっても読める。JSON の解析エラーの文は、値の一部を含むので出さない。 */
function readRaw(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`${path} を読めません。ファイルの場所を確かめてください`);
  }
  try {
    return JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new Error(`${path} は JSON として読めません。調査スクリプトの結果のファイルか確かめてください`);
  }
}

function main([output, company, ...inputs]) {
  if (!output || !company?.trim() || inputs.length === 0) return fail(USAGE, 2);
  if (inputs.some((input) => resolve(input) === resolve(output))) return fail('出力のファイルと生データのファイルを同じにはできません', 2);
  try {
    const survey = mergeSurveys(inputs.map(readRaw), { company });
    writeFileSync(output, `${JSON.stringify(survey, null, 2)}\n`);
    console.log(`${inputs.length} 台分、${survey.items.length} 件をまとめました：${output}`);
  } catch (error) {
    fail(`まとめられませんでした：${error.message}`, 1);
  }
}

main(process.argv.slice(2));
