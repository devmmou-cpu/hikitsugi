// 表示の直前にかける変換。manual.json の文は変えない。検証は元の文で済んでいる。
// 文の入れ替えと移動だけをして、読む人が止まらないようにする（内容レビュー R1）。

import { firstInternal, hasMeans } from './dead-end.mjs';
import { loadLibrary } from './procedures.mjs';
import { isSelfReplyPage, withPcInBranch } from './reply.mjs';
import { topicWords } from './symptom-check.mjs';

const WINDOWS_10_PART = 'LIB-021';
const INTERNAL_PHRASE = '社内で相談してください';
// 「〜のときは〜へ」の分岐。手順を試したあとの話（「しても」など）は手順の後に残す
const ROUTE = /(?:とき|場合)は、.*(?:連絡|相談|聞いて|見て)[^。]*ください。$/;
const AFTER_TRYING = /しても|直らない|動かない|それでも/;
const STOP_WORDS = new Set(['内容', '次', '連絡', '相談']);
const SAME_RATIO = 0.6;
const DRIVE_LIST = /共有フォルダは、(.+?)の\d+つです/;
const PATH_TAIL = /[^\\]+$/;

const compact = (text) => text.normalize('NFKC').replace(/\s+/g, '').replace(/[。、]/g, '');
const bigrams = (text) => new Set([...Array(Math.max(0, text.length - 1)).keys()].map((index) => text.slice(index, index + 2)));

/** 2つの文がほぼ同じか。言い回しが少し違う同じ内容を落とすため。 */
export function nearlySame(a, b) {
  const left = bigrams(compact(a));
  const right = bigrams(compact(b));
  if (!left.size || !right.size) return false;
  const shared = [...left].filter((pair) => right.has(pair)).length;
  return (2 * shared) / (left.size + right.size) >= SAME_RATIO;
}

/** ページに合う社内の相手。伝えることに題名の語があれば、その相手。次にそのページの社内の相手、最後に社内の最初の相談先。 */
export function internalFor(page, manual, textOf) {
  const title = textOf(page.title) ?? '';
  const names = manual.contacts.map((contact) => contact.name);
  const internal = manual.contacts.filter((contact) => contact.id.startsWith('INH-'));
  // ページに「社内で相談するときは、〈相手〉に聞いてください」があれば、同じ相手にそろえる
  const stated = page.notes.map((id) => textOf(id)?.match(/社内で相談するときは、(.+?)に聞いて/)?.[1]).find(Boolean);
  const named = stated ? internal.find((contact) => contact.name === stated) : null;
  if (named) return named;
  const matched = internal.find((contact) => contact.what_to_tell && topicWords(textOf(contact.what_to_tell) ?? '', names).some((word) => !STOP_WORDS.has(word) && title.includes(word)));
  const own = page.fallback?.contact?.startsWith('INH-') ? manual.contacts.find((contact) => contact.id === page.fallback.contact) : null;
  return matched ?? own ?? firstInternal(manual);
}

/** PC の操作のページか。部品の属性が付いていれば、その部品があるページだけにする。 */
function usesPcParts(page, byId, library) {
  const attributed = new Set(library.procedures.filter((part) => part.windows11_only).map((part) => part.id));
  const parts = [...page.first_steps, ...page.steps].map((id) => byId.get(id)?.library).filter((part) => part && part !== WINDOWS_10_PART);
  return attributed.size ? parts.some((part) => attributed.has(part)) : parts.length > 0;
}

const pageBody = (page) => [...page.first_steps, ...page.steps];

/** 表にないフォルダの注記。説明の「共有フォルダは、…の5つです」と表の接続先の差を見る。 */
function missingFolders(page, textOf, name) {
  const paths = page.info_rows.map((id) => textOf(id)?.match(/ドライブは (\\\\\S+) です/)?.[1]).filter(Boolean);
  if (!paths.length) return null;
  const listed = page.notes.map((id) => textOf(id)?.match(DRIVE_LIST)?.[1]).find(Boolean);
  if (!listed) return null;
  const inTable = new Set(paths.map((path) => path.match(PATH_TAIL)?.[0]));
  const missing = listed.split('、').map((item) => item.trim()).filter((item) => !inTable.has(item));
  return missing.length ? `表にないフォルダ（${missing.join('、')}）の接続先は記録がありません。${name}に聞いてください。` : null;
}

/** 機器の一覧の補い。台数の内訳と、同じ種類の機器から分かる「止まると」。 */
function deviceText(manual, statements, textOf) {
  const out = new Map(statements);
  const names = manual.devices.map((device) => ({ device, name: textOf(device.name) ?? '' }));
  for (const { device, name } of names) {
    const total = name.match(/^(.+PC)（全(\d+)台）$/);
    if (total) {
      const parts = names.filter((other) => other.device !== device && /PC/.test(other.name)).map((other) => other.name.split('（')[0]);
      if (parts.length) out.set(device.name, { ...out.get(device.name), text: `${total[1]}（全 ${total[2]} 台。うち ${parts.length} 台が${parts.join('、')}）` });
    }
    const kind = name.match(/^(.+)（(.+)）$/);
    if (kind && /影響の記録がありません/.test(textOf(device.impact) ?? '')) {
      const sibling = names.find((other) => other.device !== device && other.name.startsWith(`${kind[1]}（`));
      const place = sibling?.name.match(/（(.+)）$/)?.[1];
      const impact = sibling ? textOf(sibling.device.impact) ?? '' : '';
      const noted = manual.statements.some((statement) => statement.text.includes(`${kind[2]}の`) && statement.text.includes('Wi-Fi'));
      if (place && impact.includes(place) && noted) out.set(device.impact, { ...out.get(device.impact), text: impact.replace(place, kind[2]) });
    }
  }
  return out;
}

/**
 * 表示用の manual を返す。
 * display_links：文の後ろに付けるリンク（{ page, title } か { contacts: true }）
 * page.first_lead：① の上の固定文。page.info_note：表の下の注記
 */
export function forDisplay(input, { library = loadLibrary() } = {}) {
  const merged = withPcInBranch(input);
  const original = new Map(merged.statements.map((statement) => [statement.id, statement]));
  const textOf = (id) => original.get(id)?.text;
  let statements = new Map(original);
  const links = {};
  const addLink = (id, link) => { links[id] = [...(links[id] ?? []), link]; };
  const replaceText = (id, text) => statements.set(id, { ...statements.get(id), text });
  const withName = (id, contact) => {
    const statement = original.get(id);
    if (!statement || statement.library || statement.usage || !statement.text.includes(INTERNAL_PHRASE) || !contact) return;
    replaceText(id, statement.text.replace(INTERNAL_PHRASE, `${contact.name}に聞いてください（連絡先）`));
  };
  const first = firstInternal(merged);

  const pages = merged.symptom_pages.map((page) => {
    const contact = page.fallback ? merged.contacts.find((candidate) => candidate.id === page.fallback.contact) : null;
    // 帯：PC の操作がないページには出さない
    const hideBand = !usesPcParts(page, original, library);
    const branches = hideBand ? page.branches.filter((id) => original.get(id)?.library !== WINDOWS_10_PART) : [...page.branches];
    // 「〜のときは〜へ」は ② の見出しの直下へ
    const moved = page.steps.length ? page.exceptions.filter((id) => !original.get(id)?.library && ROUTE.test(textOf(id)) && !AFTER_TRYING.test(textOf(id))) : [];
    const exceptions = page.exceptions.filter((id) => !moved.includes(id));
    // 連絡先の枠と同じ内容の説明は落とす
    const cardTexts = contact ? [contact.hours, contact.what_to_tell].filter(Boolean).map(textOf) : [];
    const notes = page.notes.filter((id) => !cardTexts.some((text) => nearlySame(text, textOf(id))));

    const person = internalFor(page, merged, textOf);
    for (const id of [...notes, ...branches, ...moved, ...exceptions, ...page.steps, page.badge.statement, page.reassurance]) withName(id, person);

    for (const id of [...notes, ...moved, ...exceptions]) {
      const text = textOf(id) ?? '';
      if (original.get(id)?.library) continue;
      // 業者へ連絡のページでは、ほかのページの操作を説明に出さず、リンク1行にする
      if (page.badge.value === 'vendor' && text.includes('電源ボタン')) {
        const other = merged.symptom_pages.find((candidate) => candidate !== page && pageBody(candidate).some((step) => (textOf(step) ?? '').includes('電源ボタン')));
        if (other) {
          replaceText(id, '電源を入れる手順は、次のページにあります。');
          addLink(id, { page: other.id, title: textOf(other.title) });
          continue;
        }
      }
      for (const other of merged.contacts) {
        if (other.id === contact?.id || !text.includes(other.name) || other.id.startsWith('INH-')) continue;
        const targets = merged.symptom_pages.filter((candidate) => candidate !== page && candidate.fallback?.contact === other.id);
        addLink(id, targets.length === 1 ? { page: targets[0].id, title: textOf(targets[0].title) } : { contacts: true });
      }
      for (const other of merged.symptom_pages) if (other !== page && text.includes(textOf(other.title))) addLink(id, { page: other.id, title: textOf(other.title) });
    }
    const note = person ? missingFolders({ ...page, notes: page.notes }, textOf, person.name) : null;
    return {
      ...page,
      notes,
      branches: [...branches, ...moved],
      exceptions,
      ...(isSelfReplyPage(page, merged, library) ? { first_lead: `社員に、次の ${page.first_steps.length} つをしてもらいます。下の「社員に返す文」をそのまま送れます。` } : {}),
      ...(note ? { info_note: note } : {}),
    };
  });

  // 手順ページの外の文は、社内の最初の相談先を指す
  const inPages = new Set(pages.flatMap((page) => [...page.notes, ...page.branches, ...page.exceptions, ...page.steps]));
  for (const statement of merged.statements) if (!inPages.has(statement.id)) withName(statement.id, first);
  statements = deviceText(merged, statements, (id) => statements.get(id)?.text);

  return { ...merged, statements: [...statements.values()], symptom_pages: pages, display_links: links };
}

/** 聞き取りの「分からない」「あとで」の質問を短くする。退職する本人の名前は「前任者」にする。 */
export function shortQuestion(question, retiree = '') {
  const name = retiree.replace(/(さん|様|氏)$/, '');
  const plain = question.replace(/^【[^】]*】\s*/, '').replace(/[\s　]+/g, ' ').trim();
  const sentence = plain.split('。')[0];
  const cut = sentence.length > 60 ? `${sentence.slice(0, 60).replace(/[、,][^、,]*$/, '')}…` : `${sentence}。`;
  return name ? cut.replace(new RegExp(`${name}さんご自身|${name}さん|${name}`, 'g'), '前任者') : cut;
}

/** 表紙の「まだ分かっていないこと」の項目。 */
export const unknownItems = (transcript, retiree) => [...new Set((transcript?.entries ?? []).filter((entry) => entry.status !== 'answered').map((entry) => shortQuestion(entry.question, retiree)))];

export { hasMeans };
