// Writer と Editor の実行。渡すのは調査データ、聞き取り記録、前の段階の出力だけ。

import { applyEdits } from '../../plugin/lib/apply-edits.mjs';
import { plainProblems } from '../../plugin/lib/plain-check.mjs';
import { composeProcedures, libraryForAgents } from '../../plugin/lib/procedures.mjs';
import { buildRequest, callAgent, clientOf, LiveFailure, loadAgent, responseSchema, tagged } from './adapters/live.mjs';

const WRITER_KEYS = ['statements', 'symptom_pages', 'contacts', 'routines', 'devices', 'glossary'];

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

export function buildWriterRequest({ survey, transcript, revision, agent = loadAgent('plugin/agents/writer.md') }) {
  const sections = { survey, transcript, library: libraryForAgents() };
  if (revision) sections.revision = revision;
  const content = `${tagged(sections)}\n\n${revision ? '指摘された文章を直して、取扱説明書の全体を返してください。' : '取扱説明書の中身を書いてください。'}`;
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
  const parsed = await callAgent({ api, agent, params: buildWriterRequest({ survey, transcript, revision, agent }), record });
  // 部品の文面はプログラムが組み立てる。指定の誤りや根拠にない値は、失敗として記録する
  const { manual, problems } = composeProcedures(parsed, { survey, transcript });
  if (problems.length) throw new LiveFailure('library', problems.slice(0, 10).join(' / '));
  // 会社の情報はプログラムが付ける。モデルの出力で上書きさせない
  return { ...manual, schema_version: 1, company: survey.company, company_name: companyName, as_of: survey.as_of };
}

export async function runEditorLive({ manual, survey, transcript, revert = true, client, record = () => {} }) {
  const api = await clientOf(client);
  const agent = loadAgent('plugin/agents/plain-japanese-editor.md');
  const edits = await callAgent({ api, agent, params: buildEditorRequest({ manual, survey, transcript, agent }), record });
  const first = applyEdits(manual, edits, { revert });
  // 長さと用語はプログラムで判定できるので、残った分だけ1回だけ直させる
  const problems = plainProblems(first.manual);
  if (problems.long_sentences.length === 0 && problems.unexplained_terms.length === 0) return first;
  const params = buildEditorRequest({ manual: first.manual, survey, transcript, findings: problems, agent });
  const fixes = await callAgent({ api, agent, params, record });
  const second = applyEdits(first.manual, fixes, { revert });
  return { manual: second.manual, changes: [...first.changes, ...second.changes] };
}
