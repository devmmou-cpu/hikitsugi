// プログラムが組む文。AI に書かせず、決まった型に検証済みの文章を差し込む。Verifier にはかける。
// - 社員に返す文（reply_to_staff）：後任が社員にそのまま返す文
// - 業者に伝える文（call_script）：連絡先に読み上げ、貼り付けもできる文。fallback.message に置く

import { loadLibrary } from './procedures.mjs';

export const REPLY_LINES_MAX = 5;
export const REPLY_USAGE = 'reply_to_staff';
export const CALL_USAGE = 'call_script';

const CHECKING = 'いま確認しています。';
const TRY_THESE = '次を試してみてください。';
const willContact = (name) => `${name}に連絡します。`;
const willConsult = (name) => `${name}に相談します。`;
const CALL_END = '確認をお願いします。';
const NO_RECORD = /記録がありません/;

const mapById = (manual) => new Map(manual.statements.map((statement) => [statement.id, statement]));
const contactOf = (page, manual) => (page.fallback ? manual.contacts.find((entry) => entry.id === page.fallback.contact) ?? null : null);
const withoutStop = (text) => text.replace(/。$/, '');

/** ① のすべてが、社員に渡せる部品（表を指さない部品）か。途中が抜けた手順を返さないように、1つでも違えば null。 */
function usableFirstSteps(page, byId, library) {
  if (!page.first_steps.length) return null;
  const parts = new Map(library.procedures.map((part) => [part.id, part]));
  const statements = page.first_steps.map((id) => byId.get(id));
  return statements.every((statement) => statement?.library && parts.get(statement.library) && !parts.get(statement.library).needs_table) ? statements : null;
}

/** 自分で直せるページの行。定型、① の部品、① のゴールの順で、5行を超えるときはゴールを省く。 */
function selfLines(page, byId, library) {
  const steps = usableFirstSteps(page, byId, library);
  if (!steps) return null;
  const lines = [TRY_THESE, ...steps.map((statement) => statement.text)];
  const goal = page.first_goal ? byId.get(page.first_goal) : null;
  return { lines: goal && lines.length < REPLY_LINES_MAX ? [...lines, goal.text] : lines, used: goal && lines.length < REPLY_LINES_MAX ? [...steps, goal] : steps };
}

/** ページの社員に返す文を作る。{ text, evidence } を返す。 */
export function composeReply(page, manual, library = loadLibrary()) {
  const byId = mapById(manual);
  const titleEvidence = byId.get(page.title).evidence;
  const contact = contactOf(page, manual);
  if (page.badge.value === 'self') {
    const built = selfLines(page, byId, library);
    if (built) return { text: built.lines.join('\n'), evidence: [...new Set(built.used.flatMap((statement) => (statement.library ? [statement.library] : statement.evidence)))] };
    return { text: CHECKING, evidence: titleEvidence };
  }
  if (page.badge.value === 'vendor' && contact) return { text: `${CHECKING}\n${willContact(contact.name)}`, evidence: titleEvidence };
  if (page.badge.value === 'internal' && contact) return { text: `${CHECKING}\n${willConsult(contact.name)}`, evidence: titleEvidence };
  return { text: CHECKING, evidence: titleEvidence };
}

// 機器の名前の言葉。括弧の中は区別の情報で、「と」は複数の機器を並べている
const deviceWords = (name) => {
  const base = name.replace(/[（(][^）)]*[）)]/g, ' ');
  const tokens = base.split(/[\s]*と[\s]*/).map((piece) => piece.replace(/\s+/g, '')).filter(Boolean);
  const ascii = base.match(/[A-Za-z][A-Za-z0-9-]+/g) ?? [];
  return [...new Set([...tokens, ...ascii])].filter((word) => word.length >= 2);
};

/** 題名か ① に出てくる機器を探す。括弧の中の区別（工場など）も文に出ている機器を優先する。 */
function deviceFor(page, manual, byId) {
  const text = [page.title, ...page.first_steps].map((id) => byId.get(id)?.text ?? '').join('\n');
  const flat = text.replace(/\s+/g, '');
  const scored = (manual.devices ?? []).map((device, order) => {
    const name = byId.get(device.name)?.text ?? '';
    const words = deviceWords(name);
    if (!words.some((word) => flat.includes(word.replace(/\s+/g, '')))) return null;
    const notes = name.match(/[（(]([^）)]*)[）)]/)?.[1] ?? '';
    return { device, order, score: notes && flat.includes(notes.split(/[、,の]/)[0].replace(/\s+/g, '')) ? 1 : 0 };
  }).filter(Boolean);
  return scored.sort((a, b) => b.score - a.score || a.order - b.order)[0]?.device ?? null;
}

/** 機器の置き場所の文章。根拠があり、「記録がありません」でないときだけ使う。 */
function placeOf(page, manual, byId) {
  const device = deviceFor(page, manual, byId);
  const place = device ? byId.get(device.location) : null;
  return place?.evidence?.length && !NO_RECORD.test(place.text) ? place : null;
}

const triedLine = (steps) => `説明書の手順${steps.map((statement) => `「${withoutStop(statement.text)}」`).join('、')}は試しました。直りません。`;

/** 業者に伝える文を作る。{ text, evidence } を返す。 */
export function composeCallScript(page, manual) {
  const byId = mapById(manual);
  const title = byId.get(page.title);
  const steps = page.first_steps.map((id) => byId.get(id));
  const place = placeOf(page, manual, byId);
  const lines = [
    `${manual.company_name}です。`,
    `「${withoutStop(title.text)}」件で連絡しました。`,
    ...(steps.length ? [triedLine(steps)] : []),
    ...(place ? [`機器の場所：${withoutStop(place.text)}`] : []),
    CALL_END,
  ];
  return { text: lines.join('\n'), evidence: [...new Set([title, ...steps, ...(place ? [place] : [])].flatMap((statement) => (statement.library ? [statement.library] : statement.evidence)))] };
}

/** プログラムが組む文を外した形に戻す。Writer と Editor には渡さない。 */
export function withoutReplies(manual) {
  const composed = new Set(manual.statements.filter((statement) => statement.usage).map((statement) => statement.id));
  for (const page of manual.symptom_pages) {
    if (page.reply_to_staff) composed.add(page.reply_to_staff);
    if (page.fallback?.message) composed.add(page.fallback.message);
  }
  return {
    ...manual,
    statements: manual.statements.filter((statement) => !composed.has(statement.id)),
    symptom_pages: manual.symptom_pages.map(({ reply_to_staff: _reply, ...page }) => (page.fallback ? { ...page, fallback: { contact: page.fallback.contact } } : page)),
  };
}

/** 全ページに、社員に返す文と業者に伝える文を付ける。何度呼んでも同じ結果になる。 */
export function withReplies(manual, library = loadLibrary()) {
  const base = withoutReplies(manual);
  let next = Math.max(0, ...base.statements.map((statement) => Number(statement.id.slice(4))));
  const nextId = () => {
    next += 1;
    return `STM-${String(next).padStart(3, '0')}`;
  };
  const added = [];
  const pages = base.symptom_pages.map((page) => {
    const replyId = nextId();
    added.push({ id: replyId, ...composeReply(page, base, library), library: null, usage: REPLY_USAGE });
    if (!page.fallback) return { ...page, reply_to_staff: replyId };
    const callId = nextId();
    added.push({ id: callId, ...composeCallScript(page, base), library: null, usage: CALL_USAGE });
    return { ...page, reply_to_staff: replyId, fallback: { ...page.fallback, message: callId } };
  });
  return { ...base, statements: [...base.statements, ...added], symptom_pages: pages };
}

/** 社員に返す文の問題を返す。組み立てと別に、判定ごとの決まりを確かめる。 */
export function replyProblems(manual, library = loadLibrary()) {
  const byId = mapById(manual);
  const problems = [];
  for (const page of manual.symptom_pages) {
    const statement = byId.get(page.reply_to_staff);
    if (!statement) {
      problems.push(`${page.id}: 社員に返す文がありません`);
      continue;
    }
    const lines = statement.text.split('\n');
    if (lines.length > REPLY_LINES_MAX) problems.push(`${page.id}: 社員に返す文は ${REPLY_LINES_MAX} 行以内です`);
    const contact = contactOf(page, manual);
    const same = (expected, message) => {
      if (statement.text !== expected) problems.push(`${page.id}: ${message}`);
    };
    if (page.badge.value === 'check_first') same(CHECKING, '確認してからのページの社員に返す文は「いま確認しています。」だけです');
    else if (page.badge.value === 'vendor') same(contact ? `${CHECKING}\n${willContact(contact.name)}` : CHECKING, '業者へ連絡のページの社員に返す文は、決まった定型文だけです');
    else if (page.badge.value === 'internal') same(contact ? `${CHECKING}\n${willConsult(contact.name)}` : CHECKING, '社内で相談のページの社員に返す文は、決まった定型文だけです');
    else {
      const built = selfLines(page, byId, library);
      if (!built) same(CHECKING, '① が手順部品だけでないページの社員に返す文は「いま確認しています。」だけです');
      else if (lines[0] !== TRY_THESE) problems.push(`${page.id}: 社員に返す文は「${TRY_THESE}」で始めます`);
      else if (statement.text !== built.lines.join('\n')) problems.push(`${page.id}: 社員に返す文は、① の手順部品の文面を順番どおりに写し、① のゴール文で終えます`);
    }
  }
  return problems;
}

/** 業者に伝える文の問題を返す。各行が決まった型で、差し込んだ値がすべて根拠のある文章から来ていること。 */
export function callScriptProblems(manual) {
  const byId = mapById(manual);
  const problems = [];
  const sourced = (statement) => Boolean(statement?.evidence?.length);
  for (const page of manual.symptom_pages) {
    if (!page.fallback) continue;
    const statement = byId.get(page.fallback.message);
    if (!statement) {
      problems.push(`${page.id}: 業者に伝える文がありません`);
      continue;
    }
    if (statement.usage !== CALL_USAGE) problems.push(`${page.id}: 業者に伝える文はプログラムが組みます`);
    const lines = statement.text.split('\n');
    const title = byId.get(page.title);
    const steps = page.first_steps.map((id) => byId.get(id));
    if (lines[0] !== `${manual.company_name}です。`) problems.push(`${page.id}: 1行目は「会社名です。」の型です`);
    if (lines[1] !== `「${withoutStop(title.text)}」件で連絡しました。`) problems.push(`${page.id}: 2行目は「「症状の題名」件で連絡しました。」の型です`);
    if (!sourced(title)) problems.push(`${page.id}: 症状の題名に根拠がありません`);
    let at = 2;
    if (steps.length) {
      if (lines[at] !== triedLine(steps)) problems.push(`${page.id}: 3行目は ① の文を差し込んだ型です`);
      if (!steps.every(sourced)) problems.push(`${page.id}: ① の文に根拠がありません`);
      at += 1;
    }
    const place = placeOf(page, manual, byId);
    if (lines[at]?.startsWith('機器の場所：')) {
      if (!place || lines[at] !== `機器の場所：${withoutStop(place.text)}`) problems.push(`${page.id}: 機器の場所が、根拠のある置き場所の文章と合いません`);
      at += 1;
    } else if (place) problems.push(`${page.id}: 機器の場所の行がありません`);
    if (lines[at] !== CALL_END || lines.length !== at + 1) problems.push(`${page.id}: 最後の行は「${CALL_END}」です`);
  }
  return problems;
}
