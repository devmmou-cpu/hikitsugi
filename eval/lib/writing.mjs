// Writer と Editor の実行。渡すのは調査データ、聞き取り記録、前の段階の出力だけ。

import { applyEdits } from '../../plugin/lib/apply-edits.mjs';
import { plainProblems } from '../../plugin/lib/plain-check.mjs';
import { assembleManual, checkCommon, checkPage, commonSchema, contactSchema, droppedFromCommon, mergeRewritten, ownersOf, pageSchema, previousPiece, symptomSchema } from '../../plugin/lib/assemble.mjs';
import { additionProblems, applySymptomAnswer, basisProblems, symptomGaps } from '../../plugin/lib/symptom-check.mjs';
import { coverageLeaks } from '../../plugin/lib/coverage-check.mjs';
import { pagesForPhrases, phraseProblems } from '../../plugin/lib/search-index.mjs';
import { composeProcedures, libraryForAgents } from '../../plugin/lib/procedures.mjs';
import { buildRequest, callAgent, clientOf, LiveFailure, loadAgent, responseSchema, stripUnsupported, tagged } from './adapters/live.mjs';

// 共通部分のあとにページを同時に書く数。前置きのキャッシュが効くので、費用は同時に書いても変わらない
const PAGE_CONCURRENCY = 4;
const MAX_ATTEMPTS = 2;

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
        required: ['term', 'one_line', 'analogy', 'company', 'evidence', 'help_page'],
        properties: {
          term: { type: 'string' },
          one_line: { type: 'string' },
          analogy: { type: 'string' },
          company: { type: 'string' },
          help_page: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string', pattern: '^(INV-\\d{3,5}|INT-\\d{3})$' } },
        },
      },
    },
  },
};

/**
 * Writer のリクエスト。調査データ、聞き取り、部品は全部分で同じなので、先頭に置いてキャッシュする。
 * @param task 書く部分。{ part: 'common' } か { part: 'page', entry, contacts }。書き直しなら revision を持つ
 */
export function buildWriterRequest({ survey, transcript, retiree, task = { part: 'common' }, structure, agent = loadAgent('plugin/agents/writer.md') }) {
  const stable = tagged({ survey, transcript, library: libraryForAgents() });
  const dynamic = { task: JSON.stringify(retiree ? { ...task, retiree } : task) };
  if (structure) dynamic.structure_problems = structure;
  const what = task.part === 'common' ? '共通部分' : task.part === 'symptoms' ? '手順ページのない困りごとの判断' : task.part === 'contact' ? '連絡先' : `手順ページ ${task.entry.id}`;
  const schema = stripUnsupported(task.part === 'common' ? commonSchema() : task.part === 'symptoms' ? symptomSchema() : task.part === 'contact' ? contactSchema() : pageSchema());
  return buildRequest(agent, schema, [
    { type: 'text', text: stable, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: `${tagged(dynamic)}\n\n${structure || task.revision ? `${what}の問題を直して、この部分の全体を返してください。` : `${what}を書いてください。`}` },
  ]);
}

export function buildPhraseRequest({ manual, pages, structure, agent = loadAgent('plugin/agents/phrase-writer.md') }) {
  const sections = { pages: pages ?? pagesForPhrases(manual) };
  if (structure) sections.structure_problems = structure;
  return buildRequest(agent, responseSchema('search-index', ['pages']), `${tagged(sections)}\n\n${structure ? '問題を直して、全部のページを返してください。' : '全部のページの言い方を作ってください。'}`);
}

/** 症状ごとの言い方を作る。形の問題は1回だけ直してもらう。 */
export async function runPhraseWriterLive({ manual, retiree, client, record = () => {} }) {
  const api = await clientOf(client);
  const agent = loadAgent('plugin/agents/phrase-writer.md');
  let structure;
  let problems = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const parsed = await callAgent({ api, agent, params: buildPhraseRequest({ manual, structure, agent }), record, estimate: false });
    problems = phraseProblems(parsed, manual, retiree);
    if (!problems.length) return parsed;
    structure = { previous_output: parsed, problems };
  }
  throw new LiveFailure('phrases', problems.slice(0, 10).join(' / '));
}

export function buildEditorRequest({ manual, survey, transcript, retiree, findings, agent = loadAgent('plugin/agents/plain-japanese-editor.md') }) {
  const sections = { manual, survey, transcript };
  if (retiree) sections.retiree = retiree;
  if (findings) sections.findings = findings;
  const content = `${tagged(sections)}\n\n${findings ? 'findings の問題だけを直してください。' : 'manual の文章を直し、用語の説明を作ってください。'}`;
  return buildRequest(agent, EDITOR_SCHEMA, content);
}

/** 1つの部分を書く。形の問題や途中で切れた出力は、1回だけ直してもらう。 */
async function writePiece({ api, agent, survey, transcript, retiree, task, check, record }) {
  let structure;
  let last;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const params = buildWriterRequest({ survey, transcript, retiree, task, structure, agent });
    try {
      const { output, problems } = check(await callAgent({ api, agent, params, record, estimate: false }));
      if (!problems.length) return output;
      last = new LiveFailure('library', problems.slice(0, 10).join(' / '));
      structure = { previous_output: output, problems };
    } catch (error) {
      if (error.stage !== 'incomplete' && error.stage !== 'parse') throw error;
      last = error;
      structure = undefined;
    }
  }
  throw last;
}

/** 件数を絞って順に実行する。 */
async function pool(items, limit, work) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await work(queue.shift());
  }));
}

const contactsForPages = (common) => {
  const text = new Map(common.statements.map((statement) => [statement.id, statement.text]));
  return common.contacts.map(({ id, name, role }) => ({ id, name, role: text.get(role) }));
};

/**
 * Writer をページ単位で実行する。
 * revision がなければ全部を書く。あれば、指摘や直しのあった部分だけを書き直す。
 * @param revision { previous_manual, findings }
 * @param store { get(name), set(name, value) }。書き終えた部分を保存して、止まっても続きから再開するため
 */
export async function runWriterLive({ survey, transcript, companyName, retiree, revision, client, record = () => {}, store = { get: () => undefined, set: () => {} }, onLeaks = () => {}, onSymptoms = () => {} }) {
  const api = await clientOf(client);
  const agent = loadAgent('plugin/agents/writer.md');
  const sources = { survey, transcript };
  const once = async (name, task, check) => {
    const saved = store.get(name);
    if (saved) return saved;
    const output = await writePiece({ api, agent, survey, transcript, retiree, task, check, record });
    store.set(name, output);
    return output;
  };

  // 載せ漏れは、共通部分を1回だけ書き直して埋める。それでも残れば止める
  const fillLeaks = async (manual) => {
    const found = coverageLeaks(manual, sources);
    if (!found.length) {
      onLeaks({ found: 0, remaining: 0, kinds: [] });
      return finishWriter(manual, sources, retiree);
    }
    const piece = { ...previousPiece(manual, 'common'), page_plan: manual.symptom_pages.map(({ id, category, title }) => ({ id, category, symptom: manual.statements.find((s) => s.id === title).text })) };
    const output = await once('common-leaks', { part: 'common', revision: { previous: piece, findings: [], missing: found } }, (raw) => {
      const checked = checkCommon({ ...raw, page_plan: piece.page_plan }, sources, { retiree });
      return { ...checked, problems: [...checked.problems, ...droppedFromCommon(piece, raw)] };
    });
    const filled = mergeRewritten(manual, { common: output, pages: {} });
    const remaining = coverageLeaks(filled, sources);
    onLeaks({ found: found.length, remaining: remaining.length, kinds: found.map((leak) => leak.kind) });
    if (remaining.length) throw new LiveFailure('coverage', `載せ漏れが残っています：${remaining.map((leak) => `${leak.kind} ${leak.source}`).join('、')}`);
    return finishWriter(filled, sources, retiree);
  };

  // 手順ページのない困りごとは、最初の版で1回だけ Writer に判断してもらう。足したページがなければ止める
  const fillSymptoms = async (manual) => {
    const gaps = symptomGaps(manual, transcript, retiree);
    if (!gaps.length) {
      onSymptoms({ found: 0, pages: [], excluded: 0 });
      return manual;
    }
    const plan = manual.symptom_pages.map(({ id, category, title }) => ({ id, category, symptom: manual.statements.find((s) => s.id === title).text }));
    const applied = (raw) => applySymptomAnswer(raw, gaps, plan);
    const answer = await once('symptoms', { part: 'symptoms', gaps, pages: plan.map(({ id, symptom }) => ({ id, symptom })) }, (raw) => ({ output: raw, problems: applied(raw).problems }));
    const { additions, exclusions } = applied(answer);
    onSymptoms({ found: gaps.length, pages: additions.map(({ id, symptom }) => ({ id, symptom })), excluded: exclusions.length });
    const withExclusions = (target) => (exclusions.length ? { ...target, symptom_exclusions: exclusions } : target);
    if (!additions.length) return withExclusions(manual);
    const rows = additions.map(({ id, category, symptom }) => ({ id, category, symptom }));
    const piece = { ...previousPiece(manual, 'common'), page_plan: plan };
    const common = await once('common-symptoms', { part: 'common', revision: { previous: piece, findings: [], add_symptoms: rows } }, (raw) => {
      const checked = checkCommon({ ...raw, page_plan: [...plan, ...rows] }, sources, { retiree });
      return { ...checked, problems: [...checked.problems, ...droppedFromCommon(piece, raw)] };
    });
    const contacts = contactsForPages(common);
    const pages = {};
    await pool(additions, PAGE_CONCURRENCY, async (addition) => {
      const entry = rows.find((row) => row.id === addition.id);
      pages[entry.id] = await once(entry.id, { part: 'page', entry, contacts, basis: { sources: addition.sources, detail: addition.detail } }, (output) => {
        const checked = checkPage(output, entry, common.contacts, sources, { retiree });
        return { ...checked, problems: [...checked.problems, ...basisProblems(checked.output.statements, addition)] };
      });
    });
    const filled = finishWriter(mergeRewritten(manual, { common, pages }), sources, retiree);
    const left = additionProblems(filled, additions);
    if (left.length) throw new LiveFailure('coverage', `手順ページのない困りごとが残っています：${left.join(' / ')}`);
    return withExclusions(filled);
  };

  if (!revision) {
    const common = await once('common', { part: 'common' }, (output) => checkCommon(output, sources, { retiree }));
    const contacts = contactsForPages(common);
    const pages = {};
    await pool(common.page_plan, PAGE_CONCURRENCY, async (entry) => {
      pages[entry.id] = await once(entry.id, { part: 'page', entry, contacts }, (output) => checkPage(output, entry, common.contacts, sources, { retiree }));
    });
    // 会社の情報はプログラムが付ける。モデルの出力で上書きさせない
    const manual = assembleManual(common, pages, { schema_version: 1, company: survey.company, company_name: companyName, as_of: survey.as_of });
    return fillSymptoms(await fillLeaks(manual));
  }

  const previous = revision.previous_manual;
  const owners = ownersOf(previous, revision.findings);
  const rewritten = { pages: {} };
  const contacts = previous.contacts.map(({ id, name, role }) => ({ id, name, role: previous.statements.find((s) => s.id === role)?.text }));
  await pool([...owners], PAGE_CONCURRENCY, async ([owner, findings]) => {
    const taskRevision = { previous: previousPiece(previous, owner), findings };
    if (owner === 'common') {
      const plan = previous.symptom_pages.map(({ id, category, title }) => ({ id, category, symptom: previous.statements.find((s) => s.id === title).text }));
      rewritten.common = await once('common', { part: 'common', revision: { ...taskRevision, previous: { ...taskRevision.previous, page_plan: plan } } }, (output) => checkCommon({ ...output, page_plan: plan }, sources, { retiree }));
      return;
    }
    const page = previous.symptom_pages.find((candidate) => candidate.id === owner);
    const entry = { id: page.id, category: page.category, symptom: previous.statements.find((s) => s.id === page.title).text };
    rewritten.pages[owner] = await once(owner, { part: 'page', entry, contacts, revision: taskRevision }, (output) => checkPage(output, entry, previous.contacts, sources, { retiree }));
  });
  return fillLeaks(mergeRewritten(previous, rewritten));
}

/** 全体を確かめる。部分ごとの検査を通っているので、ここで見つかるのは組み立ての誤りだけ。 */
function finishWriter(manual, sources, retiree) {
  const { manual: composed, problems } = composeProcedures(manual, sources, { retiree });
  if (problems.length) throw new LiveFailure('library', problems.slice(0, 10).join(' / '));
  return composed;
}

/**
 * Editor を実行する。
 * @param changed 差し戻しのあとに、Writer が変えた文章の ID。指定があれば、これと残った問題だけを直す
 */
export async function runEditorLive({ manual, survey, transcript, retiree, revert = true, changed, client, record = () => {} }) {
  const api = await clientOf(client);
  const agent = loadAgent('plugin/agents/plain-japanese-editor.md');
  const edit = async (current, findings) => {
    const params = buildEditorRequest({ manual: current, survey, transcript, retiree, findings, agent });
    return applyEdits(current, await callAgent({ api, agent, params, record }), { revert, retiree, sources: { survey, transcript } });
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
