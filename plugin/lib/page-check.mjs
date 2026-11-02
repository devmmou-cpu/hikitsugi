// 手順ページの形の検査。後任が迷わないように、Writer の出力をプログラムで確かめる。
// /hikitsugi:start と評価の両方で使う。

/** 手順の文か。部品を使わない文章は、最後の文が「〜してください」で終わるものだけを手順と認める。禁止は説明に置く。 */
export function isActionText(text) {
  const last = text.split('。').map((sentence) => sentence.trim()).filter(Boolean).at(-1) ?? '';
  return /ください$/.test(last) && !/ないでください$/.test(last);
}

/** 手順に置かれた、やることではない文章の一覧。部品の文面は確認済みなので対象にしない。 */
export function nonActionSteps(manual) {
  const byId = new Map(manual.statements.map((statement) => [statement.id, statement]));
  return manual.symptom_pages.flatMap((page) =>
    page.steps
      .filter((id) => byId.has(id) && !byId.get(id).library && !isActionText(byId.get(id).text))
      .map((id) => ({ page: page.id, statement: id })),
  );
}

const DRIVE_ROW = /^(?:(.+)の )?([A-Z]) ドライブは (\\\\[^\\]+\\.+) です。$/;

/**
 * 共有フォルダの表の行を、文章から読む。形が違えば null。
 * 値を別に持たないので、画面に出す値と検証した文章がずれない。
 */
export function parseDriveRow(text) {
  const match = text.match(DRIVE_ROW);
  return match ? { target: match[1] ?? null, drive: match[2], path: match[3] } : null;
}

/** ページの形の問題を、Writer に伝えられる文で返す。 */
export function pageProblems(manual) {
  const byId = new Map(manual.statements.map((statement) => [statement.id, statement]));
  const problems = nonActionSteps(manual).map(
    ({ page, statement }) => `${page}: ${statement} はやることではありません。事実や注意は notes へ移してください`,
  );
  // 途中で書くのをやめた出力を、合格させない
  if (manual.symptom_pages.length === 0) problems.push('手順ページが1つもありません。最初から全体を書いてください');
  for (const { id, text, library } of manual.statements) {
    if (!library && !text.trim()) problems.push(`${id}: 文章が空です`);
    if (!library && /聞き取り|調査データ/.test(text)) problems.push(`${id}: 作り方の言葉（聞き取り、調査データ）を書かないでください`);
  }
  for (const page of manual.symptom_pages) {
    if (page.badge.value === 'vendor' && !page.fallback) {
      problems.push(`${page.id}: vendor のページには業者の連絡先（fallback）が必要です。相談相手が社内の人なら internal にしてください`);
    }
    for (const id of page.notes) {
      if (page.steps.includes(id)) problems.push(`${page.id}: ${id} が手順と notes の両方にあります`);
      if (byId.get(id)?.library) problems.push(`${page.id}: ${id} は部品なので notes に置けません`);
    }
    for (const id of page.drive_rows) {
      if (page.steps.includes(id) || page.notes.includes(id)) problems.push(`${page.id}: ${id} は表の行なので、手順や notes に置けません`);
      const statement = byId.get(id);
      if (statement && !parseDriveRow(statement.text)) {
        problems.push(`${page.id}: ${id} は表の行の形ではありません。「<PC>の Z ドライブは <接続先> です。」の形にしてください（すべての PC で同じなら PC は書きません）`);
      }
    }
  }
  return problems;
}
