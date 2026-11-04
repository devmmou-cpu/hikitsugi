// Writer をページ単位で呼ぶための、分けて組み立てる処理。/hikitsugi:start と評価の両方で使う。
// 共通部分（連絡先、定期作業、機器と、手順ページの一覧）を1回、手順ページを1つにつき1回書く。
// 差し戻しや前任者の直しでは、問題のあった部分だけを書き直す。

import { readFileSync } from 'node:fs';
import { contactProblems, pageProblems, pageStatementIds, statementProblems, reassuranceProblems } from './page-check.mjs';
import { composeStatements, contactEvidenceProblems, loadLibrary, pageDetailProblems } from './procedures.mjs';
import { hasCredential } from './transcript.mjs';

const MANUAL_SCHEMA = JSON.parse(readFileSync(new URL('../schemas/manual.schema.json', import.meta.url), 'utf8'));
const CATEGORY = MANUAL_SCHEMA.properties.symptom_pages.items.properties.category;
const STM = /^STM-\d{3}$/;

// プログラムが組む項目は、Writer の出力の形に含めない
const without = (schema, name) => {
  const { [name]: _removed, ...properties } = schema.properties;
  return { ...schema, properties };
};
const WRITER_STATEMENTS = { ...MANUAL_SCHEMA.properties.statements, items: without(MANUAL_SCHEMA.properties.statements.items, 'usage') };

const objectOf = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });

/** 共通部分の出力の形。 */
export const commonSchema = () => {
  const { contacts, routines, devices, before_leaving: beforeLeaving } = MANUAL_SCHEMA.properties;
  return objectOf({
    page_plan: {
      $comment: '作る手順ページの一覧。symptom はページを書く担当へ渡す、症状の短い説明',
      type: 'array',
      items: objectOf({ id: { type: 'string', pattern: '^T\\d+$' }, category: CATEGORY, symptom: { type: 'string', minLength: 1 } }),
    },
    statements: WRITER_STATEMENTS,
    contacts,
    routines,
    devices,
    before_leaving: beforeLeaving,
  });
};

/** 手順ページ1つの出力の形。 */
export const pageSchema = () => {
  const page = without(MANUAL_SCHEMA.properties.symptom_pages.items, 'reply_to_staff');
  return objectOf({ statements: WRITER_STATEMENTS, page: { ...page, properties: { ...page.properties, fallback: without(page.properties.fallback, 'message') } } });
};

// 部品の文は text と evidence を空にする決まり（文面と根拠はプログラムが入れる）なので、組み立ての前の形では空を認める。
// 部品でない文が空でないことは、組み立てのあとに確かめる。API の出力の形（commonSchema、pageSchema）は評価の条件なので変えない
const { minLength: _text, ...TEXT_BEFORE_COMPOSE } = WRITER_STATEMENTS.items.properties.text;
const { minItems: _evidence, ...EVIDENCE_BEFORE_COMPOSE } = WRITER_STATEMENTS.items.properties.evidence;
const STATEMENTS_BEFORE_COMPOSE = {
  ...WRITER_STATEMENTS,
  items: { ...WRITER_STATEMENTS.items, properties: { ...WRITER_STATEMENTS.items.properties, text: TEXT_BEFORE_COMPOSE, evidence: EVIDENCE_BEFORE_COMPOSE } },
};

/** 更新で連絡先1件を書く形。ほかの文が変わらないよう、その連絡先の文だけを書く。 */
export const contactSchema = () => objectOf({ statements: WRITER_STATEMENTS, contact: MANUAL_SCHEMA.properties.contacts.items });

/** 手順ページのない困りごとへの答えの形。 */
export const symptomSchema = () => objectOf({
  decisions: {
    type: 'array',
    items: objectOf({
      gap: { type: 'string', pattern: '^SYM-\\d+$' },
      decision: { type: 'string', enum: ['page', 'exclude'] },
      reason: { type: 'string' },
      // API の形は、列挙に null を混ぜられない。外すときは category を other、symptom を空文字にする
      category: CATEGORY,
      symptom: { type: 'string' },
    }),
  },
});

/** プラグインの Writer が保存する形。part は common、page、contact、symptoms。 */
export const writerFormat = (part) => {
  if (part === 'symptoms') return { $comment: 'Writer が保存する JSON の形。この項目の名前と値のとおりに保存する', ...symptomSchema() };
  const schema = part === 'common' ? commonSchema() : part === 'contact' ? contactSchema() : pageSchema();
  return { $comment: 'Writer が保存する JSON の形。この項目の名前と値のとおりに保存する', ...schema, properties: { ...schema.properties, statements: STATEMENTS_BEFORE_COMPOSE } };
};

/** 共通部分が使う文章の ID を返す。 */
export const commonStatementIds = ({ contacts, routines, devices }) => [
  ...contacts.flatMap((c) => [c.role, c.hours, c.contract_location, c.what_to_tell].filter(Boolean)),
  ...routines.flatMap((r) => [r.title, ...r.steps]),
  ...devices.flatMap((d) => [d.name, d.location, d.purpose, d.impact, d.credential_location, d.caution].filter(Boolean)),
];

/** 共通部分の出力を確かめる。 */
export function checkCommon(output, sources, { library = loadLibrary(), retiree } = {}) {
  const { statements, problems } = composeStatements(output.statements, library);
  const known = new Set(statements.map((s) => s.id));
  const missing = commonStatementIds(output).filter((id) => !known.has(id));
  if (missing.length) problems.push(`statements にない文章を参照しています: ${[...new Set(missing)].join(', ')}`);
  if (output.page_plan.length === 0) problems.push('手順ページの一覧（page_plan）が空です。最初から全体を書いてください');
  // 定期作業には会社の情報の表がないので、表を指す部品を置くと、後任が行き止まりになる
  const tableParts = new Set(library.procedures.filter((part) => part.needs_table).map((part) => part.id));
  const stepOf = new Map(statements.map((statement) => [statement.id, statement]));
  for (const routine of output.routines) {
    for (const id of routine.steps) if (tableParts.has(stepOf.get(id)?.library)) problems.push(`定期作業の手順に、会社の情報の表を指す部品は使えません（${stepOf.get(id).library}）。表がないので、見る場所を根拠のとおりに書くか、記録がないと書いてください`);
  }
  const ids = output.page_plan.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) problems.push('page_plan の id が重複しています');
  const piece = { statements, contacts: output.contacts };
  problems.push(...statementProblems(statements, retiree), ...contactProblems(piece), ...contactEvidenceProblems(output.contacts, sources));
  // 退職前にやることは本人に見せる一覧。根拠は実際の回答だけで、認証情報を書かない
  const answered = new Set(sources.transcript.entries.filter((entry) => entry.status === 'answered').map((entry) => entry.id));
  output.before_leaving.forEach(({ text, evidence }, index) => {
    if (evidence.some((ref) => !answered.has(ref))) problems.push(`before_leaving の ${index + 1} 件目：根拠は回答のある聞き取りだけです`);
    if (hasCredential(text)) problems.push(`before_leaving の ${index + 1} 件目：認証情報の本体を書かないでください`);
  });
  return { output: { ...output, statements }, problems };
}

const contactStatementIds = (contact) => [contact.role, contact.hours, contact.contract_location, contact.what_to_tell].filter(Boolean);

/** 更新で書いた連絡先1件を確かめる。id は対象に固定する。 */
export function checkContact(output, id, sources, { library = loadLibrary(), retiree } = {}) {
  const contact = { ...output.contact, id };
  const { statements, problems } = composeStatements(output.statements, library);
  const known = new Set(statements.map((statement) => statement.id));
  const missing = contactStatementIds(contact).filter((ref) => !known.has(ref));
  if (missing.length) problems.push(`statements にない文章を参照しています: ${missing.join(', ')}`);
  const piece = { statements, contacts: [contact] };
  problems.push(...statementProblems(statements, retiree), ...contactProblems(piece), ...contactEvidenceProblems([contact], sources));
  return { output: { statements, contact }, problems };
}

/** 載せ漏れの書き直しで、前の版の文章や機器が消えていないかを確かめる。足すだけの書き直しなので、消えていれば問題にする。 */
export function droppedFromCommon(previous, output) {
  const kept = new Set(output.statements.map((statement) => statement.id));
  const problems = [];
  const gone = previous.statements.filter((statement) => !kept.has(statement.id)).map((statement) => statement.id);
  if (gone.length) problems.push(`前の版の文章を消さないでください。足りない事実を足すだけで、全体を返してください：${gone.slice(0, 10).join(', ')}`);
  for (const key of ['contacts', 'routines', 'devices']) {
    const ids = new Set(output[key].map((entry) => entry.id));
    const lost = previous[key].filter((entry) => !ids.has(entry.id)).map((entry) => entry.id);
    if (lost.length) problems.push(`前の版の ${key} を消さないでください：${lost.join(', ')}`);
  }
  return problems;
}

/** ページの出力を確かめる。id と category は一覧の値に固定する。連絡先の照合には共通部分を使う。 */
export function checkPage(output, entry, contacts, sources, { library = loadLibrary(), retiree } = {}) {
  const page = { ...output.page, id: entry.id, category: entry.category };
  const { statements, problems } = composeStatements(output.statements, library);
  problems.push(
    ...statementProblems(statements, retiree),
    ...pageProblems({ statements, symptom_pages: [page], contacts }),
    ...pageDetailProblems(page, statements, sources, library),
    ...reassuranceProblems(page, statements),
  );
  return { output: { statements, page }, problems };
}

/** 文章の ID を置き換える。参照も一緒に変える。 */
function renameRefs(value, names) {
  if (typeof value === 'string') return STM.test(value) && names.has(value) ? names.get(value) : value;
  if (Array.isArray(value)) return value.map((item) => renameRefs(item, names));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, renameRefs(item, names)]));
  return value;
}

/**
 * 部分の出力を、全体の番号へ振り直す。参照されない文章は画面に出ないので捨てる。
 * @param keep 前の版でこの部分が使っていた ID。同じ ID はそのまま使うので、変わった文章だけを追える
 */
function place(piece, refsOf, keep, allocate) {
  const used = new Set(refsOf(piece));
  const names = new Map();
  for (const { id } of piece.statements) {
    if (!used.has(id)) continue;
    names.set(id, keep.has(id) ? id : allocate());
  }
  const { statements, ...rest } = piece;
  return {
    statements: statements.filter((s) => names.has(s.id)).map((s) => ({ ...s, id: names.get(s.id) })),
    rest: renameRefs(rest, names),
  };
}

const counter = (start) => {
  let next = start;
  return () => {
    next += 1;
    return `STM-${String(next).padStart(3, '0')}`;
  };
};

/** 最初の版を組み立てる。 */
export function assembleManual(common, pages, header) {
  const allocate = counter(0);
  const none = new Set();
  const { page_plan: plan, ...commonPiece } = common;
  const placedCommon = place(commonPiece, commonStatementIds, none, allocate);
  const placedPages = plan.map((entry) => place(pages[entry.id], (piece) => pageStatementIds(piece.page), none, allocate));
  return {
    ...header,
    statements: [...placedCommon.statements, ...placedPages.flatMap((piece) => piece.statements)],
    symptom_pages: placedPages.map((piece) => piece.rest.page),
    contacts: placedCommon.rest.contacts,
    routines: placedCommon.rest.routines,
    devices: placedCommon.rest.devices,
    before_leaving: placedCommon.rest.before_leaving,
    glossary: [],
  };
}

/** 指摘の文章が、どの部分のものかを返す。用語の説明は Editor が作り直すので含めない。 */
export function ownersOf(manual, findings) {
  const owner = new Map();
  for (const page of manual.symptom_pages) for (const id of pageStatementIds(page)) owner.set(id, page.id);
  for (const id of commonStatementIds(manual)) owner.set(id, 'common');
  const byOwner = new Map();
  for (const finding of findings) {
    const name = owner.get(finding.statement);
    if (!name) continue;
    byOwner.set(name, [...(byOwner.get(name) ?? []), finding]);
  }
  return byOwner;
}

/** 書き直しのときに Writer へ見せる、前の版の部分を返す。 */
export function previousPiece(manual, owner) {
  const byId = new Map(manual.statements.map((statement) => [statement.id, statement]));
  const pick = (ids) => [...new Set(ids)].map((id) => byId.get(id));
  const contact = manual.contacts.find((candidate) => candidate.id === owner);
  if (contact) return { statements: pick(contactStatementIds(contact)), contact };
  if (owner === 'common') {
    const { contacts, routines, devices } = manual;
    return { statements: pick(commonStatementIds(manual)), contacts, routines, devices, before_leaving: manual.before_leaving ?? [] };
  }
  const page = manual.symptom_pages.find((candidate) => candidate.id === owner);
  // 更新で足す新しいページには、前の版がない
  return page ? { statements: pick(pageStatementIds(page)), page } : { statements: [], page: null };
}

/**
 * 書き直した部分を、前の版へ差し替える。ほかの部分の文章と ID は変わらない。
 * @param previous 用語の説明を外した前の版
 * @param rewritten { common?, pages: { T1: 出力 }, contacts?: { VEN-01: 出力 } }。前の版にないページは、末尾に足す
 */
export function mergeRewritten(previous, rewritten) {
  const allocate = counter(Math.max(0, ...previous.statements.map((s) => Number(s.id.slice(4)))));
  const owners = [...(rewritten.common ? ['common'] : []), ...Object.keys(rewritten.pages), ...Object.keys(rewritten.contacts ?? {})];
  const removed = new Set(owners.flatMap((owner) => previousPiece(previous, owner).statements.map((s) => s.id)));
  const statements = previous.statements.filter((s) => !removed.has(s.id));
  let merged = { ...previous };
  if (rewritten.common) {
    const { page_plan: _plan, ...piece } = rewritten.common;
    const placed = place(piece, commonStatementIds, new Set(previousPiece(previous, 'common').statements.map((s) => s.id)), allocate);
    statements.push(...placed.statements);
    merged = { ...merged, ...placed.rest };
  }
  for (const [id, output] of Object.entries(rewritten.contacts ?? {})) {
    const placed = place(output, (piece) => contactStatementIds(piece.contact), new Set(previousPiece(previous, id).statements.map((s) => s.id)), allocate);
    statements.push(...placed.statements);
    merged = { ...merged, contacts: merged.contacts.map((contact) => (contact.id === id ? placed.rest.contact : contact)) };
  }
  const placePage = (output, keep) => {
    const placed = place(output, (piece) => pageStatementIds(piece.page), keep, allocate);
    statements.push(...placed.statements);
    return placed.rest.page;
  };
  const known = new Set(merged.symptom_pages.map((page) => page.id));
  const pages = merged.symptom_pages.map((page) => {
    const output = rewritten.pages[page.id];
    if (!output) return page;
    return placePage(output, new Set(previousPiece(previous, page.id).statements.map((s) => s.id)));
  });
  const added = Object.entries(rewritten.pages).filter(([id]) => !known.has(id)).map(([, output]) => placePage(output, new Set()));
  return { ...merged, symptom_pages: [...pages, ...added], statements };
}

