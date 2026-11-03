// 社員に返す文（reply_to_staff）。後任が社員にそのまま返す文を、プログラムで組む。
// AI に書かせない。使えるのは ① の手順部品の文面と、決まった形の定型文だけ。Verifier にはかける。

import { loadLibrary } from './procedures.mjs';

export const REPLY_LINES_MAX = 5;
export const REPLY_USAGE = 'reply_to_staff';
const CHECKING = 'いま確認しています。';
const contacted = (name) => `${name}に連絡しました。`;
// ① の操作を返してよい判定。ほかのページは、操作を含まない定型文にする
const ACTION_BADGES = new Set(['self', 'check_first']);

const usableParts = (page, byId, library) => {
  const parts = new Map(library.procedures.map((part) => [part.id, part]));
  return page.first_steps.map((id) => byId.get(id)).filter((statement) => {
    const part = statement?.library ? parts.get(statement.library) : null;
    return part && !part.needs_table;
  });
};

/** ① のすべてが、社員に渡せる部品か。途中が抜けた手順を返さないように、1つでも違えば定型文にする。 */
function actionStatements(page, byId, library) {
  if (!ACTION_BADGES.has(page.badge.value) || !page.first_steps.length) return null;
  const usable = usableParts(page, byId, library);
  return usable.length === page.first_steps.length && usable.length <= REPLY_LINES_MAX ? usable : null;
}

/** ページの社員に返す文を作る。{ text, evidence } を返す。 */
export function composeReply(page, manual, library = loadLibrary()) {
  const byId = new Map(manual.statements.map((statement) => [statement.id, statement]));
  const action = actionStatements(page, byId, library);
  if (action) return { text: action.map((statement) => statement.text).join('\n'), evidence: [...new Set(action.map((statement) => statement.library))] };
  const contact = page.fallback ? manual.contacts.find((entry) => entry.id === page.fallback.contact) : null;
  if (!contact) return { text: CHECKING, evidence: byId.get(page.title).evidence };
  return { text: `${CHECKING}\n${contacted(contact.name)}`, evidence: byId.get(page.fallback.message).evidence };
}

/** 社員に返す文を外した形に戻す。Writer と Editor には渡さない。 */
export function withoutReplies(manual) {
  const replies = new Set(manual.symptom_pages.map((page) => page.reply_to_staff).filter(Boolean));
  return {
    ...manual,
    statements: manual.statements.filter((statement) => !replies.has(statement.id) && statement.usage !== REPLY_USAGE),
    symptom_pages: manual.symptom_pages.map(({ reply_to_staff: _reply, ...page }) => page),
  };
}

/** 全ページに社員に返す文を付ける。何度呼んでも同じ結果になる。 */
export function withReplies(manual, library = loadLibrary()) {
  const base = withoutReplies(manual);
  let next = Math.max(0, ...base.statements.map((statement) => Number(statement.id.slice(4))));
  const added = [];
  const pages = base.symptom_pages.map((page) => {
    next += 1;
    const id = `STM-${String(next).padStart(3, '0')}`;
    added.push({ id, ...composeReply(page, base, library), library: null, usage: REPLY_USAGE });
    return { ...page, reply_to_staff: id };
  });
  return { ...base, statements: [...base.statements, ...added], symptom_pages: pages };
}

/**
 * 社員に返す文の問題を返す。5行以内、部品の文面と完全に一致、① の順番どおり、定型文は決まった形だけ。
 * 組み立てと別に確かめる。組み立ての誤りや、あとからの書き換えを止めるため。
 */
export function replyProblems(manual, library = loadLibrary()) {
  const byId = new Map(manual.statements.map((statement) => [statement.id, statement]));
  const problems = [];
  for (const page of manual.symptom_pages) {
    const statement = byId.get(page.reply_to_staff);
    if (!statement) {
      problems.push(`${page.id}: 社員に返す文がありません`);
      continue;
    }
    const lines = statement.text.split('\n');
    if (lines.length > REPLY_LINES_MAX) problems.push(`${page.id}: 社員に返す文は ${REPLY_LINES_MAX} 行以内です`);
    const contact = page.fallback ? manual.contacts.find((entry) => entry.id === page.fallback.contact) : null;
    const allowedStatus = [CHECKING, ...(contact ? [`${CHECKING}\n${contacted(contact.name)}`] : [])];
    if (allowedStatus.includes(statement.text)) {
      // 操作を返せるページで定型文にしていないか
      if (actionStatements(page, byId, library)) problems.push(`${page.id}: ① の部品を返せるページです`);
      continue;
    }
    if (!ACTION_BADGES.has(page.badge.value)) {
      problems.push(`${page.id}: この判定のページの社員に返す文は、決まった定型文だけです`);
      continue;
    }
    const parts = usableParts(page, byId, library).map((part) => part.text);
    if (parts.length !== page.first_steps.length || lines.join('\n') !== parts.join('\n')) {
      problems.push(`${page.id}: 社員に返す文は、① の手順部品の文面を順番どおりに写したものだけです`);
    }
    if (lines.some((line) => !/ください。$/.test(line))) problems.push(`${page.id}: 社員に返す文の操作は「〜してください。」で終えます`);
  }
  return problems;
}
