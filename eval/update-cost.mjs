// 完成後の更新1回の費用と時間を測る（模擬評価）。
// プラグインの進行のプログラムをそのまま動かし、担当の呼び出しだけを API にする。人の確認は「このままでよい」とする。
// 使い方：node --env-file=.env eval/update-cost.mjs --bundle <manual.json> [--limit 3]

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { nextStep, run } from '../plugin/scripts/hikitsugi.mjs';
import { buildPhraseRequest, buildEditorRequest, buildWriterRequest } from './lib/writing.mjs';
import { callAgent, clientOf, loadAgent, loadVerifierAgent, buildVerifierRequest } from './lib/adapters/live.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UPDATER = '佐藤';
const MAX_ATTEMPTS = 2;

/** 測る3種類。文は架空の会社の模擬の答え。 */
export const CASES = [
  { name: 'contact', label: '連絡先の変更', target: (manual) => manual.contacts.find((contact) => contact.name.includes('カワウソ')).id, command: 'update-fix', comment: '電話番号が 03-0000-0188 に変わりました。' },
  { name: 'page', label: '手順の修正', target: (manual) => manual.symptom_pages[0].id, command: 'update-fix', comment: '手順の前に、同じ部屋のほかの PC でも同じ症状かを確かめてください。ほかの PC も同じなら、カワウソシステムサービスに電話します。' },
  { name: 'add', label: '症状の追加', target: () => null, command: 'update-add', comment: '社内サーバーのランプが赤いときは、電源を切らずにイイズナソフトに電話します。' },
];

/** 1回の更新を、完成の表示に戻るまで進める。 */
export async function driveUpdate({ work, api, record, overBudget = () => false }) {
  const read = (name) => JSON.parse(readFileSync(join(work, name), 'utf8'));
  const write = (name, value) => writeFileSync(join(work, name), JSON.stringify(value, null, 2));
  const tool = (command, args = [], stdin = '') => run(command, args, { work, stdin });
  const state = () => read('state.json');
  const sources = () => ({ survey: read('survey.json'), transcript: read('transcript.json'), retiree: state().retiree });
  const writerAgent = loadAgent('plugin/agents/writer.md');
  const editorAgent = loadAgent('plugin/agents/plain-japanese-editor.md');
  const verifierAgent = loadVerifierAgent();
  const phraseAgent = loadAgent('plugin/agents/phrase-writer.md');

  for (;;) {
    if (overBudget()) throw new Error('費用の上限を超えたので止めました');
    const step = nextStep(work);
    if (step.step === 'writer') {
      tool('writer-task', [String(step.round), step.part]);
      const task = read('writer-task.json');
      const file = `writer-${step.round}-${step.part}.json`;
      let structure;
      for (let attempt = 1; ; attempt += 1) {
        const parsed = await callAgent({ api, agent: writerAgent, params: buildWriterRequest({ ...sources(), task, structure, agent: writerAgent }), record, estimate: false });
        write(file, parsed);
        try {
          tool('check-writer', [String(step.round), step.part]);
          break;
        } catch (error) {
          if (attempt >= MAX_ATTEMPTS) throw error;
          structure = { previous_output: parsed, problems: [error.message] };
        }
      }
    } else if (step.step === 'editor') {
      const findingsFile = `editor-findings-${step.round}.json`;
      const findings = existsSync(join(work, findingsFile)) ? read(findingsFile) : undefined;
      const manual = read(`manual-${step.round}.json`);
      const first = await callAgent({ api, agent: editorAgent, params: buildEditorRequest({ ...sources(), manual, findings, agent: editorAgent }), record });
      write(`editor-${step.round}.json`, first);
      tool('merge-edits', [String(step.round)]);
      const left = read(`plain-findings-${step.round}.json`);
      if (left.long_sentences.length || left.unexplained_terms.length) {
        const second = await callAgent({ api, agent: editorAgent, params: buildEditorRequest({ ...sources(), manual, findings: left, agent: editorAgent }), record });
        write(`editor-${step.round}.json`, { rewrites: [...first.rewrites, ...second.rewrites], glossary: [...first.glossary, ...second.glossary] });
        tool('merge-edits', [String(step.round)]);
      }
    } else if (step.step === 'verifier') {
      const edited = read(`edited-${step.round}.json`);
      const scope = new Set(read(`verify-scope-${step.round}.json`).statements);
      const { survey, transcript, retiree } = sources();
      const input = { survey, transcript, retiree, statements: { schema_version: 1, company: survey.company, statements: edited.statements.filter((statement) => scope.has(statement.id)) } };
      const parsed = await callAgent({ api, agent: verifierAgent, params: buildVerifierRequest(input, verifierAgent), record });
      write(`verification-${step.round}.json`, { results: parsed.results });
      tool('check-verification', [String(step.round)]);
    } else if (step.step === 'phrases') {
      tool('phrase-task');
      const parsed = await callAgent({ api, agent: phraseAgent, params: buildPhraseRequest({ pages: read('phrase-pages.json').pages, agent: phraseAgent }), record, estimate: false });
      write('phrases.json', parsed);
      tool('check-phrases');
    } else if (step.step === 'review') {
      tool('review-ok', [step.page]);
    } else if (step.step === 'render') {
      tool('render');
    } else {
      return step.step;
    }
  }
}

async function main() {
  const { values } = parseArgs({ options: { bundle: { type: 'string' }, limit: { type: 'string' }, 'results-dir': { type: 'string' } } });
  if (!values.bundle) throw new Error('使い方：node --env-file=.env eval/update-cost.mjs --bundle <manual.json> [--limit 3]');
  const limit = Number(values.limit ?? 3);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
  const dir = join(values['results-dir'] ?? join(ROOT, 'eval/results'), `${stamp}-update-cost`);
  mkdirSync(dir, { recursive: true });
  const api = await clientOf();
  const summary = { label: '模擬評価', bundle: values.bundle, cases: [] };
  let spent = 0;
  for (const item of CASES) {
    const base = join(dir, item.name);
    mkdirSync(base, { recursive: true });
    copyFileSync(values.bundle, join(base, 'manual.json'));
    const work = join(base, 'hikitsugi-work');
    run('update-start', [UPDATER], { work, stdin: '' });
    const manual = JSON.parse(readFileSync(join(work, 'manual-final.json'), 'utf8'));
    const target = item.target(manual);
    run(item.command, target ? [target] : [], { work, stdin: item.comment });
    const calls = [];
    const record = ({ raw_text: _raw, ...call }) => {
      calls.push(call);
      spent += call.cost_usd ?? 0;
    };
    const started = Date.now();
    let status;
    let error;
    try {
      status = await driveUpdate({ work, api, record, overBudget: () => spent > limit });
    } catch (failure) {
      status = 'error';
      error = failure.message;
    }
    const cost = calls.reduce((total, call) => total + (call.cost_usd ?? 0), 0);
    const byAgent = {};
    for (const call of calls) byAgent[call.agent] = (byAgent[call.agent] ?? 0) + 1;
    const result = { name: item.name, label: item.label, target, status, ...(error ? { error } : {}), cost_usd: Number(cost.toFixed(4)), seconds: Math.round((Date.now() - started) / 1000), calls: byAgent };
    summary.cases.push(result);
    writeFileSync(join(base, 'calls.json'), JSON.stringify(calls, null, 2));
    console.log(JSON.stringify(result));
    if (spent > limit) break;
  }
  writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(`保存先：${dir}`);
  return summary.cases.every((item) => item.status === 'update') && summary.cases.length === CASES.length ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main();
}
