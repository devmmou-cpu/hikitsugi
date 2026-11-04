// プログラムが組む文。AI に書かせず、決まった型に検証済みの文章を差し込む。Verifier にはかける。
// - 社員に返す文（reply_to_staff）：後任が社員にそのまま返す文
// - 業者に伝える文（call_script）：連絡先に読み上げ、貼り付けもできる文。fallback.message に置く

import { pageStatementIds } from './page-check.mjs';
import { loadLibrary } from './procedures.mjs';

export const REPLY_LINES_MAX = 5;
export const REPLY_USAGE = 'reply_to_staff';
export const CALL_USAGE = 'call_script';
export const PC_NOTE_USAGE = 'pc_note';
const WINDOWS_10_PART = 'LIB-021';

const CHECKING = 'いま確認しています。';
const AGAIN_OPEN = '開かなければ、もう一度知らせてください。';
const AGAIN_FIX = '直らなければ、もう一度知らせてください。';
const TRY_THESE = '次を試してみてください。';
const willContact = (name) => `${name}に連絡します。`;
const willConsult = (name) => `${name}に相談します。`;
const CALL_END = '確認をお願いします。';
const NO_RECORD = /記録がありません/;
const PLACE_LINE = '機器の場所：';

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
  // 最後は「もう一度知らせて」。5行を超えるなら、ゴールの文より優先する
  const again = goal?.text.startsWith('開けば') ? AGAIN_OPEN : AGAIN_FIX;
  const withGoal = goal && lines.length + 2 <= REPLY_LINES_MAX;
  const withAgain = lines.length + 1 <= REPLY_LINES_MAX;
  return { lines: [...lines, ...(withGoal ? [goal.text] : []), ...(withAgain ? [again] : [])], used: withGoal ? [...steps, goal] : steps };
}

/** ① の手順を社員に返す文に入れるページか。 */
export const isSelfReplyPage = (page, manual, library = loadLibrary()) => page.badge.value === 'self' && Boolean(usableFirstSteps(page, mapById(manual), library));

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

// 機器の名前の言葉。括弧の中は区別の情報で、「と」は複数の機器を並べている。「生産管理サーバー」は「サーバー」でも呼ばれる
const deviceWords = (name) => {
  const base = name.replace(/[（(][^）)]*[）)]/g, ' ');
  const tokens = base.split(/[\s]*と[\s]*/).map((piece) => piece.replace(/\s+/g, '')).filter(Boolean);
  const ascii = base.match(/[A-Za-z][A-Za-z0-9-]+/g) ?? [];
  const katakana = base.match(/[ァ-ヶー]{3,}/g) ?? [];
  return [...new Set([...tokens, ...ascii, ...katakana])].filter((word) => word.length >= 2);
};

/**
 * 題名か ① に出てくる機器を1つに絞る。括弧の中の区別（工場など）も文に出ている機器を優先する。
 * 絞れないときは null。別の機器の置き場所を、その機器のものとして伝えないため。
 */
function deviceFor(page, manual, byId) {
  const flat = [page.title, ...page.first_steps].map((id) => byId.get(id)?.text ?? '').join('\n').replace(/\s+/g, '');
  const scored = (manual.devices ?? []).map((device) => {
    const name = byId.get(device.name)?.text ?? '';
    if (!deviceWords(name).some((word) => flat.includes(word))) return null;
    const notes = name.match(/[（(]([^）)]*)[）)]/)?.[1] ?? '';
    return { device, score: notes && flat.includes(notes.split(/[、,の]/)[0].replace(/\s+/g, '')) ? 1 : 0 };
  }).filter(Boolean);
  const top = Math.max(0, ...scored.map((entry) => entry.score));
  const best = scored.filter((entry) => entry.score === top);
  return best.length === 1 ? best[0].device : null;
}

/** 機器の置き場所の文章。「業者へ連絡」のページで、根拠があり、「記録がありません」でないときだけ使う。 */
function placeOf(page, manual, byId) {
  if (page.badge.value !== 'vendor' || manual.call_without_place?.includes(page.id)) return null;
  const device = deviceFor(page, manual, byId);
  const place = device ? byId.get(device.location) : null;
  return place?.evidence?.length && !NO_RECORD.test(place.text) ? place : null;
}

/** 「試しました」と書ける ①。すべてが手順部品のときだけで、操作ではない ① を試したことにしない。 */
const triedSteps = (page, byId) => {
  const steps = page.first_steps.map((id) => byId.get(id));
  return steps.length && steps.every((statement) => statement?.library) ? steps : [];
};

const triedLine = (steps) => `説明書の手順${steps.map((statement) => `「${withoutStop(statement.text)}」`).join('、')}は試しました。直りません。`;

// 社内の相談先に言う文。業者と違い、名乗らず、同僚に言う形にする
const CONSULT_END = 'どうすればよいですか。';
const consultFirst = (title) => `「${withoutStop(title.text)}」の件で相談です。`;
const consultTried = (steps) => `説明書の手順${steps.map((statement) => `「${withoutStop(statement.text)}」`).join('、')}は試しました。`;
const isInternal = (page) => page.fallback?.contact?.startsWith('INH-');

/** 業者に伝える文を作る。{ text, evidence } を返す。 */
export function composeCallScript(page, manual) {
  const byId = mapById(manual);
  const title = byId.get(page.title);
  const steps = triedSteps(page, byId);
  if (isInternal(page)) {
    const lines = [consultFirst(title), ...(steps.length ? [consultTried(steps)] : []), CONSULT_END];
    return { text: lines.join('\n'), evidence: [...new Set([title, ...steps].flatMap((statement) => (statement.library ? [statement.library] : statement.evidence)))] };
  }
  const place = placeOf(page, manual, byId);
  const lines = [
    `${manual.company_name}です。`,
    `「${withoutStop(title.text)}」件で連絡しました。`,
    ...(steps.length ? [triedLine(steps)] : []),
    ...(place ? [`${PLACE_LINE}${withoutStop(place.text)}`] : []),
    CALL_END,
  ];
  return { text: lines.join('\n'), evidence: [...new Set([title, ...steps, ...(place ? [place] : [])].flatMap((statement) => (statement.library ? [statement.library] : statement.evidence)))] };
}

/**
 * Verifier が業者に伝える文を指摘したページでは、機器の場所の行を外す。
 * プログラムが組む文は Writer では直せず、この行は無くても連絡できる。外すだけなので、事実は増えない。
 * 外すページがなければ、同じオブジェクトを返す。
 */
export function withoutFlaggedPlace(manual, findings) {
  const flagged = new Set(findings.map((finding) => finding.statement));
  const byId = mapById(manual);
  const pages = manual.symptom_pages.filter((page) => flagged.has(page.fallback?.message) && byId.get(page.fallback.message)?.text.includes(PLACE_LINE)).map((page) => page.id);
  return pages.length ? { ...manual, call_without_place: [...new Set([...(manual.call_without_place ?? []), ...pages])] } : manual;
}

/** プログラムが組む文かどうか。Writer と Editor には直せない。 */
export const isComposedStatement = (statement) => Boolean(statement?.usage);

/** 該当する PC の行を外す。Writer と Editor には渡さない。 */
export function withoutPcNotes(manual) {
  const notes = new Set(manual.statements.filter((statement) => statement.usage === PC_NOTE_USAGE).map((statement) => statement.id));
  return {
    ...manual,
    statements: manual.statements.filter((statement) => !notes.has(statement.id)),
    symptom_pages: manual.symptom_pages.map((page) => ({ ...page, branches: page.branches.filter((id) => !notes.has(id)) })),
  };
}

/**
 * 「Windows 10 の PC は手順が違う」の分岐に、調査データから該当する PC 名を足す。
 * 該当する PC がなければ、分岐そのものを出さない。
 */
export function withWindows10Note(manual, survey) {
  const base = withoutPcNotes(manual);
  const os = survey.items.filter((item) => item.key === 'os.caption' && item.status === 'ok' && String(item.value).includes('Windows 10'));
  const hosts = [...new Set(os.map((item) => item.host))];
  const parts = new Set(base.statements.filter((statement) => statement.library === WINDOWS_10_PART).map((statement) => statement.id));
  if (!hosts.length) {
    const pages = base.symptom_pages.map((page) => ({ ...page, branches: page.branches.filter((id) => !parts.has(id)) }));
    const used = new Set(pages.flatMap(pageStatementIds));
    return { ...base, statements: base.statements.filter((statement) => !parts.has(statement.id) || used.has(statement.id)), symptom_pages: pages };
  }
  let next = Math.max(0, ...base.statements.map((statement) => Number(statement.id.slice(4))));
  const added = [];
  const pages = base.symptom_pages.map((page) => {
    if (!page.branches.some((id) => parts.has(id))) return page;
    const branches = page.branches.flatMap((id) => {
      if (!parts.has(id)) return [id];
      next += 1;
      const note = `STM-${String(next).padStart(3, '0')}`;
      added.push({ id: note, text: `該当する PC：${hosts.join('、')}。`, evidence: os.map((item) => item.id), library: null, usage: PC_NOTE_USAGE });
      return [id, note];
    });
    return { ...page, branches };
  });
  return { ...base, statements: [...base.statements, ...added], symptom_pages: pages };
}

/**
 * 表示のために、分岐と該当する PC の2本を1本にする。「Windows 10 の PC（名前）は、手順が違うので…」。
 * 検証は別々の文のまま済んでいるので、manual.json は変えない。根拠は両方を残す。
 */
export function withPcInBranch(manual) {
  const byId = mapById(manual);
  const merged = new Map();
  const notes = new Set();
  for (const page of manual.symptom_pages) {
    page.branches.forEach((id, index) => {
      const note = byId.get(page.branches[index + 1]);
      if (byId.get(id)?.library !== WINDOWS_10_PART || note?.usage !== PC_NOTE_USAGE) return;
      const hosts = note.text.replace(/^該当する PC：/, '').replace(/。$/, '');
      merged.set(id, { text: byId.get(id).text.replace('Windows 10 の PC は', `Windows 10 の PC（${hosts}）は`), evidence: [...byId.get(id).evidence, ...note.evidence] });
      notes.add(note.id);
    });
  }
  if (!merged.size) return manual;
  return {
    ...manual,
    statements: manual.statements.filter((statement) => !notes.has(statement.id)).map((statement) => (merged.has(statement.id) ? { ...statement, ...merged.get(statement.id) } : statement)),
    symptom_pages: manual.symptom_pages.map((page) => ({ ...page, branches: page.branches.filter((id) => !notes.has(id)) })),
  };
}

/** プログラムが組む文を外した形に戻す。Writer と Editor には渡さない。 */
export function withoutReplies(manual) {
  const composed = new Set(manual.statements.filter((statement) => statement.usage === REPLY_USAGE || statement.usage === CALL_USAGE).map((statement) => statement.id));
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
      else if (statement.text !== built.lines.join('\n')) problems.push(`${page.id}: 社員に返す文は、① の手順部品の文面を順番どおりに写し、「もう一度知らせて」の定型で終えます`);
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
    const steps = triedSteps(page, byId);
    if (isInternal(page)) {
      const expected = [consultFirst(title), ...(steps.length ? [consultTried(steps)] : []), CONSULT_END];
      if (statement.text !== expected.join('\n')) problems.push(`${page.id}: 社内の相談先に言う文は「「症状の題名」の件で相談です。」で始まり、「${CONSULT_END}」で終える型です`);
      if (!sourced(title)) problems.push(`${page.id}: 症状の題名に根拠がありません`);
      if (!steps.every(sourced)) problems.push(`${page.id}: ① の文に根拠がありません`);
      continue;
    }
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
