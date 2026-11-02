// 出力を用意するアダプター。評価の仕組みそのものを確かめるための基準の出力と、保存済みの出力を扱う。
// oracle は正解をそのまま返す基準であり、エージェントの評価には使わない。
// live（API を呼ぶもの）は context.input だけを渡す。今は Verifier だけに対応する。

import { readFileSync } from 'node:fs';
import { NotImplementedError, UsageError } from './errors.mjs';
import { runInterviewLive } from '../interview-loop.mjs';
import { runEditorLive, runWriterLive } from '../writing.mjs';
import { runGapFinderLive, runVerifierLive } from './live.mjs';

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
// Gap Finder には調査データだけを渡す。聞き取り記録は、これから作るものなので渡さない
const gapFinderLive = ({ input, client, record }) => runGapFinderLive({ survey: input.survey, client, record });
// 前の段階の出力は --from で受け取る。固定の聞き取り記録と正解は渡さない
const requireFrom = (context, what) => {
  if (!context.from) throw new UsageError(`live には --from で${what}を指定してください`);
  return context.from;
};
const interviewLive = (context) =>
  runInterviewLive({
    survey: context.input.survey,
    gaps: requireFrom(context, ' Gap Finder の出力（output.json）'),
    hidden: context.hidden.facts,
    client: context.client,
    record: context.record,
  });

// 単体の評価では、固定の聞き取り記録から書く。入力が同じなら結果を比べられるため
const writerLive = ({ input, companyName, client, record }) =>
  runWriterLive({ survey: input.survey, transcript: input.transcript, companyName, client, record });
// 事実が変わった文章を元に戻さず、そのまま採点に回す
const editorLive = async (context) =>
  (
    await runEditorLive({
      manual: requireFrom(context, ' Writer の出力（output.json）'),
      survey: context.input.survey,
      transcript: context.input.transcript,
      revert: false,
      client: context.client,
      record: context.record,
    })
  ).manual;

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
    live: gapFinderLive,
  },
  interview: {
    oracle: (c) => c.input.transcript,
    empty: (c) => envelope(c, { entries: [] }),
    fixture: fromFile,
    live: interviewLive,
  },
  manual: {
    fixture: fromFile,
    live: writerLive,
  },
  editor: {
    fixture: fromFile,
    live: editorLive,
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
