// 操作の図。部品と同じ承認制で、本人が承認した図だけを、共有フォルダの ① の3手順にだけ付ける。

import { readFileSync } from 'node:fs';
import { loadLibrary } from './procedures.mjs';

const FIGURES_PATH = new URL('../library/figures.json', import.meta.url);
const FIGURE_SEQUENCE = 'network-drive';

export const loadFigures = () => JSON.parse(readFileSync(FIGURES_PATH, 'utf8')).figures;

/**
 * ページの ① に付ける図を、文章の ID ごとの svg で返す。
 * ① が共有フォルダの手順と同じ部品の並びのときだけ。同じ部品を別のページや「それでも直らなければ」で使っても付けない。
 */
export function firstStepFigures(page, manual, { figures = loadFigures(), library = loadLibrary() } = {}) {
  const byId = new Map(manual.statements.map((statement) => [statement.id, statement]));
  const order = library.sequences.find((sequence) => sequence.id === FIGURE_SEQUENCE).first;
  const used = page.first_steps.map((id) => byId.get(id)?.library);
  if (used.length !== order.length || used.some((part, index) => part !== order[index])) return new Map();
  return new Map(page.first_steps.flatMap((id) => {
    const figure = figures[byId.get(id).library];
    return figure?.status === 'approved' ? [[id, figure.svg.replace('<svg ', '<svg class="step-figure" ')]] : [];
  }));
}
