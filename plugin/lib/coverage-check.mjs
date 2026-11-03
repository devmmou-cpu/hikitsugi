// 載せ漏れの検査。聞き取りや調査で答えがあったのに、取扱説明書に載っていない事実を見つける。
// AI の判断ではなくプログラムで確かめる。/hikitsugi:start と評価の両方で使う。

const compact = (text) => text.normalize('NFKC').replace(/\s+/g, '');

// 機器の置き場所の言い方。「に入れて」「に貼って」は、ソフトや掲示の文にも使うので、認証情報の文でだけ認める
const PLACED = /(?:にあります|に設置され|に置いて|に保管)/;
const CREDENTIAL_PLACED = /(?:にあります|に設置され|に置いて|に保管|に入れて|に貼)/;
const CREDENTIAL_WORD = /パスワード|暗証番号/;

/** 文の中の場所の語句を取り出す。述語の直前の、読点や「は」で区切られた部分。 */
function placeOf(sentence) {
  const match = sentence.match(CREDENTIAL_WORD.test(sentence) ? CREDENTIAL_PLACED : PLACED);
  if (!match) return null;
  const before = sentence.slice(0, match.index);
  const part = before.split(/[、,]|(?:は|で)(?=[^、]*$)/).at(-1)?.trim() ?? '';
  return part.length >= 2 ? part : null;
}

/** 文章に場所の語句が出ているか。言い換えがあるので、語句の後ろの部分で照合する。 */
function mentions(texts, place) {
  const pieces = place.split(/と、|と|、/).map(compact).filter((piece) => piece.length >= 2);
  return pieces.some((piece) => texts.some((text) => text.includes(piece) || text.includes(piece.slice(-4))));
}

/**
 * 載せ漏れの一覧を返す。
 * @returns { kind, source, detail }[] kind は credential_location、device_location、feature_update
 */
export function coverageLeaks(manual, { survey, transcript }) {
  const texts = manual.statements.map((statement) => compact(statement.text));
  const leaks = [];
  for (const entry of transcript.entries) {
    if (entry.status !== 'answered') continue;
    for (const sentence of entry.answer.split('。')) {
      const place = placeOf(sentence);
      if (!place) continue;
      const kind = CREDENTIAL_WORD.test(sentence) ? 'credential_location' : 'device_location';
      if (!mentions(texts, place)) leaks.push({ kind, source: entry.id, detail: sentence.trim() });
    }
  }
  const held = survey.items.filter((item) => item.key === 'security.feature_update' && item.status === 'ok' && /保留/.test(String(item.value)) && !/なし/.test(String(item.value)));
  if (held.length && !texts.some((text) => text.includes('大型更新'))) {
    for (const item of held) leaks.push({ kind: 'feature_update', source: item.id, detail: `${item.host} は大型更新を保留しています` });
  }
  return leaks;
}

// 部屋らしい語。ない置き場所は、後任が探せないかもしれないので警告する。止めない
const ROOM_WORD = /室|事務所|工場|倉庫|階|棟|部屋|詰所/;
const NO_PLACE_RECORD = /記録がありません/;

/** 置き場所に部屋らしい語がない機器の一覧を返す。記録がないと書いた機器は、別に検査しているので除く。 */
export function locationWarnings(manual) {
  const text = new Map(manual.statements.map((statement) => [statement.id, statement.text]));
  return (manual.devices ?? [])
    .map((device) => ({ device: text.get(device.name) ?? '', place: text.get(device.location) ?? '' }))
    .filter(({ place }) => place && !NO_PLACE_RECORD.test(place) && !ROOM_WORD.test(place));
}
