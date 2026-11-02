// 評価セットの読み込み。
// モデルに渡してよいもの（input）と、渡してはいけないもの（hidden、answers）を関数で分ける。
// エージェントへの入力は loadInput だけから作ること。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

export function loadInput(setDir) {
  return {
    survey: readJson(join(setDir, 'input/survey.json')),
    transcript: readJson(join(setDir, 'input/transcript.fixture.json')),
    statements: readJson(join(setDir, 'input/statements.json')),
  };
}

export function loadAnswers(setDir) {
  return {
    verifier: readJson(join(setDir, 'answers/verifier.json')),
    gaps: readJson(join(setDir, 'answers/gaps.json')),
    troubles: readJson(join(setDir, 'answers/troubles.json')),
  };
}

export function loadHidden(setDir) {
  return { facts: readJson(join(setDir, 'hidden/tanaka_facts.json')) };
}

export function loadCase(setDir) {
  return readJson(join(setDir, 'case.json'));
}
