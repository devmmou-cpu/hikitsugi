// 手順ページの形の検査。後任が迷わないように、Writer の出力をプログラムで確かめる。
// /hikitsugi:start と評価の両方で使う。

const FIRST_STEPS_MAX = 3;
const ROLE_LENGTH_MAX = 15;

/** ページの本文の項目。ゴールは1つか null なので、配列にそろえて返す。 */
export const bodyFields = (page) => ({
  notes: page.notes,
  first_steps: page.first_steps,
  first_goal: page.first_goal ? [page.first_goal] : [],
  branches: page.branches,
  steps: page.steps,
  goal: page.goal ? [page.goal] : [],
  exceptions: page.exceptions,
  info_rows: page.info_rows,
});

/** ページが使う文章の ID をすべて返す。 */
export const pageStatementIds = (page) => [
  page.title,
  page.badge.statement,
  page.reassurance,
  ...Object.values(bodyFields(page)).flat(),
  ...(page.fallback?.message ? [page.fallback.message] : []),
  ...(page.reply_to_staff ? [page.reply_to_staff] : []),
];

const sentencesOf = (text) => text.split('。').map((sentence) => sentence.trim()).filter(Boolean);

/** 操作の文か。1文で、「〜してください」で終わるものだけを認める。禁止は説明に置く。 */
export function isActionText(text) {
  const sentences = sentencesOf(text);
  return sentences.length === 1 && /ください$/.test(sentences[0]) && !/ないでください$/.test(sentences[0]);
}

/** 操作の欄に置かれた、1つの操作ではない文章の一覧。部品の文面は確認済みなので対象にしない。 */
export function nonActionSteps(manual) {
  const byId = new Map(manual.statements.map((statement) => [statement.id, statement]));
  return manual.symptom_pages.flatMap((page) =>
    [...page.first_steps, ...page.steps]
      .filter((id) => byId.has(id) && !byId.get(id).library && !isActionText(byId.get(id).text))
      .map((id) => ({ page: page.id, statement: id })),
  );
}

const DRIVE_ROW = /^(?:(.+)の )?([A-Z]) ドライブは (\\\\[^\\]+\\.+) です。$/;
const VALUE_ROW = /^(.+?)は (\S(?:.*\S)?) です。$/;

/**
 * 会社の情報の表の行を、文章から読む。形が違えば null。
 * 値を別に持たないので、画面に出す値と検証した文章がずれない。
 */
export function parseInfoRow(text) {
  const drive = text.match(DRIVE_ROW);
  if (drive) return { type: 'drive', target: drive[1] ?? null, drive: drive[2], path: drive[3] };
  const row = text.match(VALUE_ROW);
  return row ? { type: 'value', label: row[1], value: row[2] } : null;
}

/** 文章そのものの問題。retiree があれば、本人の名前を後任向けの文章に書いていないかも確かめる。 */
export function statementProblems(statements, retiree) {
  const problems = [];
  const name = retiree?.trim().replace(/(さん|様|氏)$/, '').split(/\s+/)[0];
  for (const { id, text, library } of statements) {
    if (name && !library && text.includes(name)) problems.push(`${id}: 退職する担当者の名前を、後任向けの文章に書かないでください。本人にしかできない作業は before_leaving に入れてください`);
    if (!library && !text.trim()) problems.push(`${id}: 文章が空です`);
    if (!library && /聞き取り|調査データ/.test(text)) problems.push(`${id}: 作り方の言葉（聞き取り、調査データ）を書かないでください`);
  }
  return problems;
}

// 安心帯に書かない保証の言い切り。裏づけのある事実か、聞き取りにある決まりだけを書く
export const GUARANTEE = /大丈夫|安心して|問題ありません|心配いりません/;

/** 安心帯に保証の言い切りがあれば、Writer に伝える文で返す。 */
export function reassuranceProblems(page, statements) {
  const text = statements.find((statement) => statement.id === page.reassurance)?.text ?? '';
  const found = text.match(GUARANTEE);
  return found ? [`${page.id}: reassurance に保証の言い切り（${found[0]}）を書かないでください。調査か聞き取りで裏づけられる事実か、聞き取りにある決まりだけを書いてください`] : [];
}

/** ページの形の問題を、Writer に伝えられる文で返す。contacts は連絡先の照合に使う。 */
export function pageProblems(manual) {
  const byId = new Map(manual.statements.map((statement) => [statement.id, statement]));
  const contacts = new Set(manual.contacts.map((contact) => contact.id));
  const problems = nonActionSteps(manual).map(
    ({ page, statement }) => `${page}: ${statement} は1つの操作ではありません。手順は「〜してください」で終わる1文にしてください。確認は goal、条件は branches、例外は exceptions、事実や注意は notes に置いてください`,
  );
  for (const page of manual.symptom_pages) {
    const missing = pageStatementIds(page).filter((id) => !byId.has(id));
    if (missing.length) problems.push(`${page.id}: statements にない文章を参照しています: ${[...new Set(missing)].join(', ')}`);
    const body = Object.values(bodyFields(page)).flat();
    const repeated = body.filter((id, index) => body.indexOf(id) !== index);
    if (repeated.length) problems.push(`${page.id}: 同じ文章を2か所に置いています: ${[...new Set(repeated)].join(', ')}`);
    if (page.first_steps.length > FIRST_STEPS_MAX) problems.push(`${page.id}: first_steps は${FIRST_STEPS_MAX}つまでです。1分で済む操作だけにしてください`);
    if (page.first_goal && !page.first_steps.length) problems.push(`${page.id}: first_goal があるのに first_steps がありません`);
    if (page.goal && !page.steps.length) problems.push(`${page.id}: goal があるのに steps がありません`);
    for (const id of [page.first_goal, page.goal]) {
      if (id && /ください。?$/.test(byId.get(id)?.text ?? '')) problems.push(`${page.id}: ${id} はゴールなので、直ったと分かる状態を書いてください`);
    }
    for (const id of page.info_rows) {
      const statement = byId.get(id);
      if (statement && !parseInfoRow(statement.text)) {
        problems.push(`${page.id}: ${id} は表の行の形ではありません。「<PC>の Z ドライブは <接続先> です。」か「<項目>は <値> です。」の形にしてください`);
      }
    }
    if (page.fallback && !contacts.has(page.fallback.contact)) problems.push(`${page.id}: 存在しない連絡先です: ${page.fallback.contact}`);
    if (page.badge.value === 'self' && !page.first_steps.length && !page.steps.length) {
      problems.push(`${page.id}: self のページには、後任が行う操作（first_steps か steps）が必要です。操作がなければ vendor か internal にしてください`);
    }
    if (page.badge.value === 'check_first' && !page.fallback) {
      problems.push(`${page.id}: check_first のページには、確かめたあとの連絡先（fallback）が必要です。業者の連絡先がなければ社内の相談先（INH-）にしてください`);
    }
    if (page.badge.value === 'vendor' && !page.fallback?.contact.startsWith('VEN-')) {
      problems.push(`${page.id}: vendor のページには、使える連絡先の中の業者（VEN-）の fallback が必要です。電話番号の記録がない業者も連絡先に載せます`);
    }
    // 番号の記録がない業者へ案内するページでは、番号の調べ方を手順に入れる
    const target = page.fallback && manual.contacts.find((contact) => contact.id === page.fallback.contact);
    if (target?.id.startsWith('VEN-') && !target.phone && ![...page.first_steps, ...page.steps].some((id) => byId.get(id)?.library === 'LIB-030')) {
      problems.push(`${page.id}: ${target.id} は電話番号の記録がないので、steps の先頭に部品 LIB-030 を入れてください`);
    }
    if (page.badge.value === 'internal' && !page.fallback?.contact.startsWith('INH-')) {
      problems.push(`${page.id}: internal のページには社内の相談先（INH-）の fallback が必要です`);
    }
  }
  return problems;
}

/** 連絡先の形の問題。 */
export function contactProblems(manual) {
  const byId = new Map(manual.statements.map((statement) => [statement.id, statement]));
  const problems = [];
  for (const contact of manual.contacts) {
    const vendor = contact.id.startsWith('VEN-');
    // 電話番号の記録がない業者も載せる。画面に「電話番号の記録がありません」と出す
    if (vendor && contact.phone && (!contact.hours || !contact.contract_location)) problems.push(`${contact.id}: 業者の hours と contract_location は文章の ID にしてください。記録がなければ「記録がありません」と書きます`);
    const role = byId.get(contact.role)?.text ?? '';
    if (role.length > ROLE_LENGTH_MAX || role.includes('。')) problems.push(`${contact.id}: role は${ROLE_LENGTH_MAX}字以内の短いラベルにしてください（「。」を付けません）`);
  }
  return problems;
}

/** 取扱説明書の全体の形の問題。 */
export function manualProblems(manual, retiree) {
  const problems = [...statementProblems(manual.statements, retiree), ...pageProblems(manual), ...contactProblems(manual)];
  // 途中で書くのをやめた出力を、合格させない
  if (manual.symptom_pages.length === 0) problems.push('手順ページが1つもありません。最初から全体を書いてください');
  return problems;
}
