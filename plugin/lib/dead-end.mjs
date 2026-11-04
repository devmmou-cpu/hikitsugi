// 行き止まりの検査。前任者の確認の前に、連絡の相手か手段が分からないページをプログラムが挙げる。
// 判定が「社内で相談」か「業者へ連絡」のページは、相手、手段、「社内で相談」の相手を見る。
// ほかの判定のページは、③ に名前のある連絡先がなく、「社内で相談」とだけあるときに挙げる。
// 挙がったページは、前任者に1回だけ聞いて書き直す。

// 連絡の手段が書かれているかを見る語
const MEANS = /内線|電話|携帯|席|メール|Teams|チャット|声をかけ|直接/;
const NO_TARGET = /社内で相談/;
const LOOKED_AT = new Set(['internal', 'vendor']);

const statementIds = (page) => [page.badge.statement, page.reassurance, ...page.notes, ...page.first_steps, ...page.branches, ...page.steps, ...page.exceptions];

/** 連絡の手段があるか。電話番号があるか、受付の文に手段の語があれば、あるとする。 */
export function hasMeans(contact, textOf) {
  return Boolean(contact.phone) || MEANS.test(textOf(contact.hours) ?? '');
}

/**
 * 行き止まりのページの一覧を返す。
 * @returns { page, title, contact, contact_id, kinds, reasons }[]。kinds は no_contact、no_means、no_target
 */
export function deadEnds(manual) {
  const byId = new Map(manual.statements.map((statement) => [statement.id, statement.text]));
  const textOf = (id) => byId.get(id);
  return manual.symptom_pages.flatMap((page) => {
    const contact = page.fallback ? manual.contacts.find((candidate) => candidate.id === page.fallback.contact) : null;
    const saysInternal = statementIds(page).some((id) => NO_TARGET.test(textOf(id) ?? ''));
    if (!LOOKED_AT.has(page.badge.value)) {
      return !contact && saysInternal ? [{ page: page.id, title: textOf(page.title), contact: null, contact_id: null, kinds: ['no_target'], reasons: ['「社内で相談してください」の相手がいません'] }] : [];
    }
    const kinds = [];
    const reasons = [];
    if (!contact) {
      kinds.push('no_contact');
      reasons.push('相談先や連絡先の名前がありません');
    } else if (!hasMeans(contact, textOf)) {
      kinds.push('no_means');
      reasons.push(`「${contact.name}」への連絡の手段がありません`);
    }
    if (!contact?.id.startsWith('INH-') && saysInternal) {
      kinds.push('no_target');
      reasons.push('「社内で相談してください」の相手がいません');
    }
    return kinds.length ? [{ page: page.id, title: textOf(page.title), contact: contact?.name ?? null, contact_id: contact?.id ?? null, kinds, reasons }] : [];
  });
}

/** 「分からない」のときに聞く相手。社内の相談先のうち、連絡の手段があるものの先頭。なければ社内の先頭。 */
export function firstInternal(manual) {
  const byId = new Map(manual.statements.map((statement) => [statement.id, statement.text]));
  const internal = manual.contacts.filter((contact) => contact.id.startsWith('INH-'));
  return internal.find((contact) => hasMeans(contact, (id) => byId.get(id))) ?? internal[0] ?? null;
}

/**
 * 「分からない」のときの定型の文。
 * 相手がいないだけのページ（no_target）は業者の連絡先の記録があるので、「記録がありません」と書くと事実と矛盾する。
 */
export function unknownSentence(manual, kinds = []) {
  const contact = firstInternal(manual);
  if (kinds.length === 1 && kinds[0] === 'no_target') return contact ? `社内で相談するときは、${contact.name}に聞いてください。` : '社内で相談してください。';
  return contact ? `連絡先の記録がありません。${contact.name}に聞いてください。` : '連絡先の記録がありません。社内で相談してください。';
}

const compact = (text) => text.normalize('NFKC').replace(/\s+/g, '');

/** 書き直したページが、答えを根拠にしているか。定型の文があるか。 */
export function deadEndFixProblems(statements, page, fix) {
  const problems = [];
  if (!statements.some((statement) => statement.evidence.includes(fix.evidence))) problems.push(`${page}: このページの根拠に ${fix.evidence} を入れてください`);
  if (fix.must_include && !statements.some((statement) => compact(statement.text).includes(compact(fix.must_include)))) problems.push(`${page}: 次の文をそのまま入れてください：${fix.must_include}`);
  return problems;
}
