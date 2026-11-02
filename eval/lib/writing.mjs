// Writer と Editor の実行。渡すのは調査データ、聞き取り記録、前の段階の出力だけ。

import { applyEdits } from '../../plugin/lib/apply-edits.mjs';
import { plainProblems } from '../../plugin/lib/plain-check.mjs';
import { composeProcedures, libraryForAgents } from '../../plugin/lib/procedures.mjs';
import { buildRequest, callAgent, clientOf, LiveFailure, loadAgent, responseSchema, tagged } from './adapters/live.mjs';

const WRITER_KEYS = ['statements', 'symptom_pages', 'contacts', 'routines', 'devices', 'glossary'];
const MAX_STRUCTURE_RETRIES = 1;

const EDITOR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['rewrites', 'glossary'],
  properties: {
    rewrites: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'text'],
        properties: { id: { type: 'string', pattern: '^STM-\\d{3}$' }, text: { type: 'string' } },
      },
    },
    glossary: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['term', 'text', 'evidence'],
        properties: {
          term: { type: 'string' },
          text: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string', pattern: '^(INV|INT)-\\d{3}$' } },
        },
      },
    },
  },
};

export function buildWriterRequest({ survey, transcript, revision, structure, agent = loadAgent('plugin/agents/writer.md') }) {
  const sections = { survey, transcript, library: libraryForAgents() };
  if (revision) sections.revision = revision;
  if (structure) sections.structure_problems = structure;
  const ask = structure || revision ? '指摘された問題を直して、取扱説明書の全体を返してください。' : '取扱説明書の中身を書いてください。';
  const content = `${tagged(sections)}\n\n${ask}`;
  return buildRequest(agent, responseSchema('manual', WRITER_KEYS), content);
}

export function buildEditorRequest({ manual, survey, transcript, findings, agent = loadAgent('plugin/agents/plain-japanese-editor.md') }) {
  const sections = { manual, survey, transcript };
  if (findings) sections.findings = findings;
  const content = `${tagged(sections)}\n\n${findings ? 'findings の問題だけを直してください。' : 'manual の文章を直し、用語の説明を作ってください。'}`;
  return buildRequest(agent, EDITOR_SCHEMA, content);
}

export async function runWriterLive({ survey, transcript, companyName, revision, client, record = () => {} }) {
  const api = await clientOf(client);
  const agent = loadAgent('plugin/agents/writer.md');
  // 部品の文面はプログラムが組み立てる。部品の指定やページの形の問題は、1回だけ伝えて直してもらう
  let structure;
  let problems = [];
  for (let attempt = 0; attempt <= MAX_STRUCTURE_RETRIES; attempt += 1) {
    const parsed = await callAgent({ api, agent, params: buildWriterRequest({ survey, transcript, revision, structure, agent }), record });
    const composed = composeProcedures(parsed, { survey, transcript });
    problems = composed.problems;
    // 会社の情報はプログラムが付ける。モデルの出力で上書きさせない
    if (!problems.length) return { ...composed.manual, schema_version: 1, company: survey.company, company_name: companyName, as_of: survey.as_of };
    // ページが1つもない出力は途中でやめたものなので、見せずに最初から書いてもらう
    structure = parsed.symptom_pages.length ? { previous_output: parsed, problems } : undefined;
  }
  throw new LiveFailure('library', problems.slice(0, 10).join(' / '));
}

/**
 * Editor を実行する。
 * @param changed 差し戻しのあとに、Writer が変えた文章の ID。指定があれば、これと残った問題だけを直す
 */
export async function runEditorLive({ manual, survey, transcript, revert = true, changed, client, record = () => {} }) {
  const api = await clientOf(client);
  const agent = loadAgent('plugin/agents/plain-japanese-editor.md');
  const edit = async (current, findings) => {
    const params = buildEditorRequest({ manual: current, survey, transcript, findings, agent });
    return applyEdits(current, await callAgent({ api, agent, params, record }), { revert });
  };
  const remaining = (current) => {
    const problems = plainProblems(current);
    return problems.long_sentences.length || problems.unexplained_terms.length ? problems : null;
  };

  let result;
  if (changed) {
    const problems = plainProblems(manual);
    const nothingToDo = changed.length === 0 && !remaining(manual);
    result = nothingToDo ? { manual, changes: [] } : await edit(manual, { changed_statements: changed, ...problems });
  } else {
    result = await edit(manual);
  }
  // 長さと用語はプログラムで判定できるので、残った分だけ1回だけ直させる
  const problems = remaining(result.manual);
  if (!problems) return result;
  const second = await edit(result.manual, problems);
  return { manual: second.manual, changes: [...result.changes, ...second.changes] };
}
