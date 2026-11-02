// 出力を用意するアダプター。評価の仕組みそのものを確かめるための基準の出力と、保存済みの出力を扱う。
// oracle は正解をそのまま返す基準であり、エージェントの評価には使わない。
// live（API を呼ぶもの）は context.input だけを渡す。今は Verifier だけに対応する。

import { readFileSync } from 'node:fs';
import { NotImplementedError, UsageError } from './errors.mjs';
import { runVerifierLive } from './live.mjs';

export { NotImplementedError, UsageError };

const envelope = (context, body) => ({ schema_version: 1, company: context.input.survey.company, ...body });

const verifierOutput = (context, verdictOf) =>
  envelope(context, {
    round: 1,
    results: context.answers.verifier.statements.map((statement) => ({
      statement: statement.id,
      verdict: verdictOf(statement),
      reason: '',
      checked: [],
      conflicts_with: [],
    })),
  });

const gapsOutput = (context, stateOf, askAbout) => {
  const items = context.answers.gaps.items;
  const asked = items.filter(askAbout).map((item) => item.item);
  return envelope(context, {
    coverage: items.map((item) => {
      const state = stateOf(item);
      return { item: item.item, state, evidence: state === 'gap' ? [] : item.evidence };
    }),
    gaps: asked.length
      ? [{ id: 'GAP-001', items: asked, why: '基準の出力', priority: 'mid', question_hint: '基準の出力' }]
      : [],
  });
};

function fromFile(context) {
  if (!context.outputPath) throw new UsageError('fixture アダプターには --output でファイルを指定してください');
  return JSON.parse(readFileSync(context.outputPath, 'utf8'));
}

function live() {
  throw new NotImplementedError('この対象の live アダプターは未実装です。今は verifier だけに対応しています');
}

// 正解を渡せないよう、input、client、record だけを取り出して渡す
const verifierLive = ({ input, client, record }) => runVerifierLive({ input, client, record });

const ADAPTERS = {
  verifier: {
    oracle: (c) => verifierOutput(c, (s) => s.expected),
    'all-correct': (c) => verifierOutput(c, () => 'correct'),
    'all-flag': (c) => verifierOutput(c, () => 'contradiction'),
    fixture: fromFile,
    live: verifierLive,
  },
  gaps: {
    oracle: (c) => gapsOutput(c, (i) => i.state, (i) => i.state !== 'filled'),
    // 全項目を「埋まっている」と答える。evidence を持たない項目は調査の根拠がない
    'all-correct': (c) => gapsOutput(c, () => 'filled', () => false),
    'all-flag': (c) => gapsOutput(c, () => 'gap', () => true),
    fixture: fromFile,
    live,
  },
  interview: {
    oracle: (c) => c.input.transcript,
    empty: (c) => envelope(c, { entries: [] }),
    fixture: fromFile,
    live,
  },
  manual: {
    fixture: fromFile,
    live,
  },
  troubles: {
    oracle: (c) => ({
      results: c.answers.troubles.troubles.map((t) => ({ trouble: t.id, action: t.action, contact: t.contact })),
    }),
    empty: () => ({ results: [] }),
    fixture: fromFile,
    live,
  },
};

export const adapterNames = (target) => Object.keys(ADAPTERS[target] ?? {});

export function getAdapter(target, name) {
  const adapter = ADAPTERS[target]?.[name];
  if (!adapter) {
    throw new UsageError(`${target} に ${name} アダプターはありません（使えるもの：${adapterNames(target).join('、')}）`);
  }
  return adapter;
}
