// 完成した取扱説明書を、あとから直すための部品。hikitsugi update の流れで使う。
// manual.json は、作業フォルダがなくても更新を始められるように、render が説明書の隣に置く。

import { pageStatementIds } from './page-check.mjs';
import { hasCredential } from './transcript.mjs';

export const BUNDLE_NAME = 'manual.json';
export const CREDENTIAL_MEMO = '（パスワードらしい値があるので、この文は残していません）';

const compact = (text) => text.normalize('NFKC').replace(/\s+/g, '');

/**
 * manual.json の中身を作る。OneDrive に置くので、説明書が引用している調査と聞き取りだけを入れる。
 * 連絡先の名前と番号の照合に使う回答も入れる。「分からない」の回答と、退職する本人向けの一覧は入れない。
 */
export function bundleOf({ manual, survey, transcript, state }) {
  const { before_leaving: _private, ...shared } = manual;
  const cited = new Set(manual.statements.flatMap((statement) => statement.evidence));
  const contactWords = manual.contacts.flatMap((contact) => [contact.name, contact.phone]).filter(Boolean).map(compact);
  const entries = transcript.entries.filter((entry) => entry.status === 'answered' && (cited.has(entry.id) || contactWords.some((word) => compact(entry.answer).includes(word))));
  const items = survey.items.filter((item) => cited.has(item.id) || contactWords.some((word) => compact(`${item.key} ${item.value}`).includes(word)));
  return {
    schema_version: 1,
    kind: 'hikitsugi-manual',
    company: state.company,
    company_name: state.company_name,
    retiree: state.retiree,
    round: state.round,
    round_base: state.round_base ?? 0,
    manual: shared,
    sources: { survey: { ...survey, items }, transcript: { ...transcript, entries } },
  };
}

/** 更新の対象の種類を返す。 */
export function targetKind(manual, id) {
  if (manual.symptom_pages.some((page) => page.id === id)) return 'page';
  if (manual.contacts.some((contact) => contact.id === id)) return 'contact';
  if (manual.devices.some((device) => device.id === id)) return 'device';
  return null;
}

/**
 * 連絡先の番号が変わったとき、文の中に書かれた古い番号も新しい番号にする。
 * 番号だけの機械的な置き換えで、根拠に今回の回答を足す。文が変わるので Verifier の照合にかかる。
 * ほかの連絡先が同じ番号を使っているときは、どちらの番号か分からないので置き換えない。
 */
export function withContactPhone(manual, contactId, oldPhone, newPhone, evidence) {
  if (!oldPhone || !newPhone || oldPhone === newPhone) return manual;
  if (manual.contacts.some((contact) => contact.id !== contactId && contact.phone === oldPhone)) return manual;
  return {
    ...manual,
    statements: manual.statements.map((statement) => (statement.text.includes(oldPhone) ? { ...statement, text: statement.text.replaceAll(oldPhone, newPhone), evidence: [...new Set([...statement.evidence, evidence])] } : statement)),
  };
}

/** 更新の対象の連絡先を使っているページ。 */
export const pagesOfContact = (manual, id) => manual.symptom_pages.filter((page) => page.fallback?.contact === id).map((page) => page.id);

/** 連絡先を使うページと、文の中にその番号を書いているページ。更新の行を出すページ。 */
function pagesWithContact(manual, id) {
  const { phone } = manual.contacts.find((contact) => contact.id === id);
  const byId = new Map(manual.statements.map((statement) => [statement.id, statement]));
  const named = phone ? manual.symptom_pages.filter((page) => pageStatementIds(page).some((ref) => byId.get(ref)?.text.includes(phone))).map((page) => page.id) : [];
  return manual.symptom_pages.map((page) => page.id).filter((pageId) => pagesOfContact(manual, id).includes(pageId) || named.includes(pageId));
}

const SUMMARY_MAX = 60;

/** 更新の記録の種類の名前。機器は「手順を直す」から直すので、手順の修正に入れる。 */
export const UPDATE_KIND_LABELS = { contact: '連絡先の変更', page: '手順の修正', device: '手順の修正', add: '症状の追加', memo: 'メモの取り込み' };

/**
 * 更新の記録に残す、内容の一言。本人の答えが60字に収まればそのまま。
 * 超えるときは、60字の中で最後の「。」か「、」で切って「…」を付ける。切れ目がなければ60字で切る。
 */
export function updateSummary(answer) {
  const chars = [...answer.replace(/\s+/g, ' ').trim()];
  if (chars.length <= SUMMARY_MAX) return chars.join('');
  const head = chars.slice(0, SUMMARY_MAX);
  const breakAt = Math.max(head.lastIndexOf('。'), head.lastIndexOf('、'));
  return `${head.slice(0, breakAt > 0 ? breakAt : SUMMARY_MAX).join('')}…`;
}

/** 更新の印を付ける。角印は更新で確認した人と最新の確認日を出し、前任者の確認の記録は残す。 */
export function withUpdateMark(manual, { target, by, date, summary, kind: updateKind }) {
  const kind = targetKind(manual, target);
  const pages = kind === 'page' ? [target] : kind === 'contact' ? pagesWithContact(manual, target) : [];
  const updates = [...(manual.updates ?? []), { target, pages, by, date, ...(updateKind ? { kind: updateKind } : {}), ...(summary ? { summary } : {}) }];
  return {
    ...manual,
    review: { ...manual.review, updated_by: [...new Set(updates.map((update) => update.by))].join('・'), updated_on: date },
    updates,
  };
}

/** 更新の印から、ページの最新の更新を返す。なければ null。 */
export const latestUpdateOf = (manual, pageId) => (manual.updates ?? []).filter((update) => update.pages.includes(pageId)).at(-1) ?? null;

/** 検証の言い方を作り直すページ。題名、判定の文、① のどれかが変わったページと、新しいページ。 */
export function pagesNeedingPhrases(before, after) {
  const textsOf = (manual, page) => {
    const text = new Map(manual.statements.map((statement) => [statement.id, statement.text]));
    return JSON.stringify([page.title, page.badge.statement, ...page.first_steps].map((id) => text.get(id)));
  };
  const old = new Map(before.symptom_pages.map((page) => [page.id, page]));
  return after.symptom_pages.filter((page) => !old.has(page.id) || textsOf(before, old.get(page.id)) !== textsOf(after, page)).map((page) => page.id);
}

/** メモのまとめの文を、ページごとに分ける。1行目は「ページ名：メモ」で、続きの行はそのメモに足す。 */
export function parseMemos(text, manual) {
  const names = new Map();
  const statement = new Map(manual.statements.map((entry) => [entry.id, entry.text]));
  for (const page of manual.symptom_pages) names.set(statement.get(page.title), page.id);
  for (const contact of manual.contacts) names.set(contact.name, contact.id);
  for (const device of manual.devices) names.set(statement.get(device.name), device.id);
  const known = [...names.keys()].sort((a, b) => b.length - a.length);
  const items = [];
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf('：');
    const found = known.find((candidate) => line.startsWith(`${candidate}：`));
    const name = at > 0 ? line.slice(0, at).trim() : null;
    if (found) items.push({ target: names.get(found), name: found, text: line.slice(found.length + 1).trim() });
    else if (name && !items.length) items.push({ target: null, name, text: line.slice(at + 1).trim() });
    else if (line.trim() && items.length) items.at(-1).text = `${items.at(-1).text}\n${line.trim()}`;
    else if (line.trim()) items.push({ target: null, name: '', text: line.trim() });
  }
  // パスワードらしい値のあるメモは、本文を列にも担当にも渡さない。保管場所を本人に聞く
  return items.filter((item) => item.text.trim()).map((item) => (hasCredential(item.text) ? { ...item, text: CREDENTIAL_MEMO, has_credential: true } : { ...item, has_credential: false }));
}
